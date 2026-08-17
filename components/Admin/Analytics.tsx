import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from 'recharts';
import { io, Socket } from 'socket.io-client';
import { UserSession, SystemStats } from '../../types';
import { apiClient } from '../../lib/api';

interface CoinLogEntry {
  id: number;
  timestamp: number;
  type: 'coin_pulse' | 'session_credit';
  event: string;
  amount?: number;
  slot?: string;
  slot_name?: string;
  source?: string;
  mac?: string;
  ip?: string;
  token?: string;
  seconds?: number;
  minutes?: number;
}

interface AnalyticsProps {
  sessions: UserSession[];
  salesHistory?: any[];
}

const STATS_POLL_INTERVAL = 2000; // 2s for real-time CPU monitoring
const API_TIMEOUT_MS = 6000; // 6s timeout for API calls on embedded hardware

// Helper: race a promise against a timeout, with real abort support
const withTimeoutAndAbort = <T,>(
  makePromise: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T
): { promise: Promise<T>; abort: () => void } => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), ms);

  const promise = makePromise(ctrl.signal)
    .then((val) => { clearTimeout(timeout); return val; })
    .catch(() => { clearTimeout(timeout); return fallback; });

  return {
    promise,
    abort: () => { clearTimeout(timeout); ctrl.abort(); }
  };
};

const Analytics: React.FC<AnalyticsProps> = ({ sessions, salesHistory }) => {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [sysInfo, setSysInfo] = useState<{manufacturer: string, model: string, distro: string, arch: string} | null>(null);
  const [activeGraphs, setActiveGraphs] = useState<string[]>([]);
  const [availableInterfaces, setAvailableInterfaces] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pppoeOnline, setPppoeOnline] = useState<number>(0);
  const [machineMetrics, setMachineMetrics] = useState<{ cpuTemp?: number; uptime?: number; storageUsed?: number; storageTotal?: number } | null>(null);
  const [cpuHistory, setCpuHistory] = useState<{ time: string; load: number }[]>([]);
  const [coreLoads, setCoreLoads] = useState<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // NodeMCU device name map (MAC -> friendly name)
  const [vendoNameMap, setVendoNameMap] = useState<Record<string, string>>({});

  // Coin Detection Log
  const [coinLog, setCoinLog] = useState<CoinLogEntry[]>([]);

  useEffect(() => {
    const fetchCoinLog = async () => {
      try {
        const token = localStorage.getItem('rjd_admin_token');
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res = await fetch('/api/coin-log', { headers });
        if (res.ok) {
          const data = await res.json();
          setCoinLog(Array.isArray(data) ? data : []);
        }
      } catch (e) { /* non-critical */ }
    };
    fetchCoinLog();

    const socket = io();
    socket.on('coin-log-entry', (entry: CoinLogEntry) => {
      setCoinLog(prev => [entry, ...prev].slice(0, 100));
    });
    return () => { socket.disconnect(); };
  }, []);

  // Lightweight init data fetch — renders dashboard immediately, fills data async
  useEffect(() => {
    mountedRef.current = true;

    // Fetch NodeMCU device names for Top Vendo display
    const loadVendoNames = async () => {
      try {
        const devices = await apiClient.getNodeMCUDevices();
        if (!mountedRef.current || !Array.isArray(devices)) return;
        const map: Record<string, string> = {};
        devices.forEach((d: any) => {
          if (d.macAddress) map[d.macAddress.toUpperCase()] = d.name || d.macAddress;
        });
        setVendoNameMap(map);
      } catch (e) { /* non-critical */ }
    };
    loadVendoNames();

    const t1 = withTimeoutAndAbort((s) => apiClient.getSystemInterfaces(s), API_TIMEOUT_MS, [] as string[]);
    const t2 = withTimeoutAndAbort((s) => apiClient.getSystemInfo(s), API_TIMEOUT_MS, null);
    const t3 = withTimeoutAndAbort((s) => apiClient.getPPPoESessions(s), API_TIMEOUT_MS, [] as any[]);
    const t4 = withTimeoutAndAbort((s) => apiClient.getMachineStatus(s), API_TIMEOUT_MS, null);

    const fetchInitData = async () => {
      try {
        const [ifaceData, infoData, pppoeData, machineData] = await Promise.all([
          t1.promise, t2.promise, t3.promise, t4.promise
        ]);

        if (!mountedRef.current) return;

        setAvailableInterfaces(ifaceData);
        if (infoData) setSysInfo(infoData);
        setPppoeOnline(Array.isArray(pppoeData) ? pppoeData.length : 0);
        if (machineData && machineData.metrics) {
          const m = machineData.metrics;
          setMachineMetrics({
            cpuTemp: m.cpuTemp ?? m.cpu_temp,
            uptime: m.uptime ?? m.uptime_seconds,
            storageUsed: m.storageUsed ?? m.storage_used,
            storageTotal: m.storageTotal ?? m.storage_total
          });
        }
      } catch (err) {
        console.error('Failed to fetch init data', err);
      }
    };
    fetchInitData();

    return () => {
      mountedRef.current = false;
      t1.abort();
      t2.abort();
      t3.abort();
      t4.abort();
    };
  }, []);

  // Stats polling – slower interval, safe cleanup, real abort
  useEffect(() => {
    let active = true;
    let currentAbort: (() => void) | null = null;

    const fetchStats = async () => {
      // Abort any previous in-flight request before starting a new one
      if (currentAbort) { currentAbort(); currentAbort = null; }

      const t = withTimeoutAndAbort((s) => apiClient.getSystemStats(s), API_TIMEOUT_MS, null);
      currentAbort = t.abort;

      try {
        const data = await t.promise;
        if (!active) return;
        if (!data) return;

        setStats(data);

        const now = new Date().toLocaleTimeString();
        setCpuHistory(prev => [...prev, { time: now, load: data.cpu?.load || 0 }].slice(-30));
        const avg = data.cpu?.load || 0;
        const t2 = Date.now() / 1000;
        const vary = (b: number) => Math.max(0, Math.min(100, b));

        // If server sends real per-core loads, use them; otherwise simulate
        if (data.cpu?.cpus && data.cpu.cpus.length > 0) {
          setCoreLoads(data.cpu.cpus);
        } else {
          // Animated simulation — number of bars = physical cores (fallback 4)
          const numCores = data.cpu?.cores || 4;
          setCoreLoads(
            Array.from({ length: numCores }, (_, i) =>
              vary(avg * (0.90 + 0.10 * Math.abs(Math.sin(t2 * (0.7 + i * 0.13)))))
            )
          );
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to fetch system stats', err);
      }
    };

    fetchStats();
    intervalRef.current = setInterval(fetchStats, STATS_POLL_INTERVAL);

    return () => {
      active = false;
      if (currentAbort) currentAbort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const addGraph = (iface: string) => {
    if (!activeGraphs.includes(iface)) {
      setActiveGraphs([...activeGraphs, iface]);
    }
    setIsDropdownOpen(false);
  };

  const removeGraph = (iface: string) => {
    setActiveGraphs(activeGraphs.filter(g => g !== iface));
  };

  const sumRevenue = useCallback((range: 'today' | '7d' | 'month' | 'year') => {
    const now = new Date();
    // Prefer salesHistory (transactions) over sessions (active state)
    const data = (salesHistory && salesHistory.length > 0) ? salesHistory : sessions;
    
    return data
      .filter((s: any) => {
        // Handle both transaction timestamp and session connectedAt
        const dateStr = s.timestamp || s.connectedAt;
        if (!dateStr) return false;
        
        const d = new Date(dateStr);
        if (range === 'today') {
          return d.toDateString() === now.toDateString();
        }
        if (range === '7d') {
          const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
          return diff <= 7;
        }
        if (range === 'month') {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return d.getFullYear() === now.getFullYear();
      })
      .reduce((acc, s: any) => acc + (s.amount || s.totalPaid || 0), 0);
  }, [salesHistory, sessions]);

  const revenueToday  = useMemo(() => sumRevenue('today'),  [sumRevenue]);
  const revenue7d     = useMemo(() => sumRevenue('7d'),     [sumRevenue]);
  const revenueMonth  = useMemo(() => sumRevenue('month'),  [sumRevenue]);
  const revenueYear   = useMemo(() => sumRevenue('year'),   [sumRevenue]);

  const hotspotConnected = sessions.filter(s => !s.isPaused && s.remainingSeconds > 0).length;
  const hotspotPaused = sessions.filter(s => s.isPaused).length;
  const hotspotDisconnected = 0;

  // ─── Top Vendo Ranking ───
  const [topVendoRange, setTopVendoRange] = useState<'month' | 'today'>('today');

  const topVendos = useMemo(() => {
    const data = (salesHistory && salesHistory.length > 0) ? salesHistory : sessions;
    const now = new Date();

    const filtered = data.filter((s: any) => {
      const dateStr = s.timestamp || s.connectedAt;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (topVendoRange === 'today') return d.toDateString() === now.toDateString();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Group by machine_id
    const vendoMap: Record<string, number> = {};
    filtered.forEach((s: any) => {
      const id = s.machine_id || s.machineId || 'main';
      vendoMap[id] = (vendoMap[id] || 0) + (s.amount || s.totalPaid || 0);
    });

    // Sort descending — show all vendos
    return Object.entries(vendoMap)
      .map(([id, total]) => ({ id, total }))
      .sort((a, b) => b.total - a.total);
  }, [salesHistory, sessions, topVendoRange]);

  // Dashboard renders immediately — no full-page spinner
  // Data populates asynchronously via effects above
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System Info</h3>
                {!stats && <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                </span>}
              </div>
              <div className="text-sm font-black text-slate-800 mt-0.5">{sysInfo ? `${sysInfo.manufacturer} ${sysInfo.model}` : 'Device'}</div>
              <div className="text-[10px] font-bold text-slate-500 mt-0.5">{sysInfo ? `${sysInfo.distro} / ${sysInfo.arch}` : ''}</div>
            </div>
            <div className="bg-slate-100 text-slate-700 p-2 rounded-lg">🖥️</div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Device Model</span>
              <span className="text-blue-600">{sysInfo ? `${sysInfo.manufacturer} ${sysInfo.model}` : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>System</span>
              <span>{sysInfo ? `${sysInfo.distro}` : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>CPU Temp</span>
              <span>{((stats?.cpu?.temp ?? machineMetrics?.cpuTemp) != null) ? (stats?.cpu?.temp ?? machineMetrics?.cpuTemp ?? 0).toFixed(1) + '°C' : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>RAM Usage</span>
              <span>{stats ? ((stats.memory.used / stats.memory.total) * 100).toFixed(1) + '%' : '...'}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Storage</span>
              <span>
                {stats?.storage
                  ? `${((stats.storage.used / stats.storage.total) * 100).toFixed(1)}% (${(stats.storage.used / 1024 / 1024 / 1024).toFixed(1)} / ${(stats.storage.total / 1024 / 1024 / 1024).toFixed(1)} GB)`
                  : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between text-[10px] font-bold text-slate-500">
              <span>Uptime</span>
              <span>
                {machineMetrics?.uptime
                  ? (() => { const s = machineMetrics.uptime as number; const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`; })()
                  : 'N/A'}
              </span>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100">
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Supported Boards</div>
              <div className="flex flex-wrap gap-1">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orange Pi 3 LTS</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orange Pi Zero 3</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orange Pi One</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orange Pi PC</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orange Pi 5</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-50 text-green-700 border border-green-100">Raspberry Pi 4B</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-50 text-green-700 border border-green-100">Raspberry Pi 5</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-100">NodeMCU ESP</span>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CPU Usage</h3>
              <div className="text-sm font-black text-slate-800 mt-0.5">
                {stats?.cpu?.brand ? stats.cpu.brand : sysInfo ? `${sysInfo.manufacturer} ${sysInfo.model}` : 'CPU'}
              </div>
              <div className="text-[10px] font-bold text-slate-500 mt-0.5">
                {stats?.cpu
                  ? `${stats.cpu.cores} Core${stats.cpu.cores > 1 ? 's' : ''}${stats.cpu.physicalCores && stats.cpu.physicalCores !== stats.cpu.cores ? ` / ${stats.cpu.physicalCores} Physical` : ''} @ ${stats.cpu.speed}GHz`
                  : ''}
              </div>
            </div>
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg">⚡</div>
          </div>
          <div className="overflow-y-auto pr-1 max-h-[220px]">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-center">
              {/* AVG row */}
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }}></div>
                <span className="text-[10px] font-bold text-slate-700">AVG</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${stats?.cpu?.load || 0}%`, backgroundColor: '#3b82f6' }}></div>
                </div>
                <div className="text-[10px] font-bold text-slate-600 w-10 text-right">{stats?.cpu?.load?.toFixed(1) || 0}%</div>
              </div>

              {/* Per-core rows — dynamic based on actual CPU */}
              {(stats?.cpu?.cpus?.length ? stats.cpu.cpus : coreLoads).map((load, i) => {
                const colors = [
                  '#06b6d4', '#f59e0b', '#a78bfa', '#10b981', '#ef4444', '#8b5cf6',
                  '#f97316', '#14b8a6', '#e11d48', '#6366f1', '#84cc16', '#d946ef',
                  '#0ea5e9', '#f43f5e', '#22c55e', '#a855f7', '#eab308', '#3b82f6'
                ];
                const color = colors[i % colors.length];
                const isReal = stats?.cpu?.cpus && i < stats.cpu.cpus.length;
                return (
                  <React.Fragment key={i}>
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }}></div>
                      <span className="text-[10px] font-bold text-slate-700">CPU {i + 1}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${load}%`, backgroundColor: color }}
                        ></div>
                      </div>
                      <div className="text-[10px] font-bold text-slate-600 w-10 text-right">
                        {isReal ? load : (load || 0).toFixed(1)}%
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-slate-400 font-bold mt-2 px-1">
            <span>0%</span><span>20%</span><span>40%</span><span>60%</span><span>80%</span><span>100%</span>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Clients Status</h3>
            </div>
            <div className="bg-emerald-50 text-emerald-600 p-2 rounded-lg">👥</div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-1">
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Hotspot</div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Connected</span><span className="font-black">{hotspotConnected}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Paused</span><span className="font-black">{hotspotPaused}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Disconnected</span><span className="font-black">{hotspotDisconnected}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">PPPoE</div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Online</span><span className="font-black">{pppoeOnline}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Offline</span><span className="font-black">0</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-700">
                <span>Expired</span><span className="font-black">0</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <RevenueCard title="Daily Revenue" amount={revenueToday} subtitle="Today" />
        <RevenueCard title="Weekly Revenue" amount={revenue7d} subtitle="Last 7 Days" />
        <RevenueCard title="Monthly Revenue" amount={revenueMonth} subtitle="This Month" />
        <RevenueCard title="Yearly Revenue" amount={revenueYear} subtitle="This Year" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top Vendo</div>
            <select
              className="text-[10px] border border-slate-200 rounded-md px-2 py-1"
              value={topVendoRange}
              onChange={(e) => setTopVendoRange(e.target.value as 'month' | 'today')}
            >
              <option value="month">This Month</option>
              <option value="today">Today</option>
            </select>
          </div>
          <div className="space-y-2">
            {topVendos.length > 0 ? topVendos.map((v, idx) => (
              <div key={v.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                    idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                    idx === 1 ? 'bg-slate-100 text-slate-600' :
                    idx === 2 ? 'bg-orange-50 text-orange-600' :
                    'bg-slate-50 text-slate-500'
                  }`}>#{idx + 1}</span>
                  <span className="text-[11px] font-bold text-slate-700 truncate max-w-[120px]">
                    {v.id === 'main' ? 'Main Vendo' : (vendoNameMap[v.id.toUpperCase()] || v.id)}
                  </span>
                </div>
                <div className="text-[11px] font-black text-slate-800">₱{v.total.toFixed(2)}</div>
              </div>
            )) : (
              <div className="text-center text-[10px] font-bold text-slate-400">No sales data</div>
            )}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top 5 Clients by Sales</div>
            <select className="text-[10px] border border-slate-200 rounded-md px-2 py-1">
              <option>This Month</option>
              <option>Today</option>
            </select>
          </div>
          <div className="space-y-2">
            {sessions
              .slice()
              .sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0))
              .slice(0, 5)
              .map((s, idx) => (
                <div key={idx} className="flex items-center justify-between border border-slate-100 rounded-lg p-2">
                  <div className="text-[10px] font-bold text-slate-600">User: {s.mac}</div>
                  <div className="text-[10px] font-black text-slate-800">₱{(s.totalPaid || 0).toFixed(2)}</div>
                </div>
              ))
            }
            {sessions.length === 0 && (
              <div className="text-center text-[10px] font-bold text-slate-400">No data</div>
            )}
          </div>
        </div>
      </div>

      {/* Coin Detection Log */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-base">🪙</span>
            <h3 className="text-xs font-bold text-slate-800">Coin Detection Log</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-slate-400">{coinLog.length} events</span>
            <span className="bg-amber-100 text-amber-700 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Live</span>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase font-bold tracking-wider sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Slot</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">MAC</th>
                <th className="px-3 py-2">Session Token</th>
                <th className="px-3 py-2">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coinLog.length > 0 ? coinLog.map((entry) => (
                <tr key={entry.id} className={`hover:bg-slate-50 transition-colors ${entry.type === 'session_credit' ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-3 py-2 text-[10px] font-mono font-bold text-slate-500 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-2">
                    {entry.type === 'coin_pulse' ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        COIN PULSE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        SESSION CREDIT
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-bold text-slate-600">
                    {entry.slot_name || (entry.slot && entry.slot.includes(':') ? (vendoNameMap[entry.slot.toUpperCase()] || entry.slot) : entry.slot) || '—'}
                    {entry.source && <span className="ml-1 text-[8px] text-slate-400 uppercase">({entry.source})</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-black text-slate-800">
                    {entry.amount != null ? `₱${entry.amount}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-mono font-bold text-slate-600">
                    {entry.mac || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-mono text-slate-500 truncate max-w-[120px]">
                    {entry.token ? `${entry.token.substring(0, 12)}...` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px] font-bold text-slate-600">
                    {entry.type === 'session_credit' ? (
                      <div>
                        <div className="text-emerald-600">₱{entry.amount} / {entry.minutes}min</div>
                        <div className="text-[8px] text-slate-400">{entry.seconds}s total</div>
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                    No coin events yet. Insert a coin to see activity here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const StatItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="min-w-0">
        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 truncate">{label}</span>
        <span className="block text-sm font-bold text-slate-700 truncate">{value}</span>
    </div>
);

const RevenueCard: React.FC<{ title: string; amount: number; subtitle: string }> = ({ title, amount, subtitle }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</div>
    <div className="text-2xl font-black text-slate-800">₱{amount.toFixed(2)}</div>
    <div className="text-[10px] font-bold text-slate-400 mt-1">{subtitle}</div>
  </div>
);

export default Analytics;
