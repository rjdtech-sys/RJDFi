import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient } from '../../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────
interface SaleRecord {
  id: string;
  mac: string;
  ip: string;
  amount: number;
  minutes: number;
  type: string;
  createdAt: string;
  machineId: string;
}

interface SalesData {
  sales: SaleRecord[];
  coinslots: string[];
  totals: Record<string, { amount: number; count: number }>;
  grandTotal: { amount: number; count: number };
  todayTotal: { amount: number; count: number };
}

// ── Constants ────────────────────────────────────────────────────────────────
const TYPE_BADGES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  coin:         { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  label: 'Coin' },
  voucher:      { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   label: 'Voucher' },
  cash:         { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Cash' },
  eload:        { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', label: 'E-Load' },
  subscription: { bg: 'bg-cyan-50',   text: 'text-cyan-700',   border: 'border-cyan-200',   label: 'Subscription' },
  cash_in:      { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   label: 'Cash-in' },
  bills_payment:{ bg: 'bg-rose-50',   text: 'text-rose-700',   border: 'border-rose-200',   label: 'Bills Payment' },
};

const DATE_PRESETS = [
  { value: 'today',            label: 'Today' },
  { value: 'yesterday',        label: 'Yesterday' },
  { value: 'this_week',        label: 'This Week' },
  { value: 'this_month',       label: 'This Month' },
  { value: 'since_last_month', label: 'Since Last Month' },
  { value: 'last_2_months',    label: 'Last 2 Months' },
  { value: 'this_year',        label: 'This Year' },
];

// ── Helper: compute date range from preset ───────────────────────────────────
function getDateRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  let from = todayStr;
  let to = todayStr;

  if (preset === 'yesterday') {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    from = d.toISOString().slice(0, 10); to = from;
  } else if (preset === 'this_week') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    from = new Date(d.setDate(diff)).toISOString().slice(0, 10);
  } else if (preset === 'this_month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  } else if (preset === 'since_last_month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  } else if (preset === 'last_2_months') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  } else if (preset === 'this_year') {
    from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  }
  return { from, to };
}

// ── Helper: export sales to CSV ──────────────────────────────────────────────
function exportToCSV(sales: SaleRecord[], getLabel: (id: string) => string) {
  const header = 'Amount,Type,Coinslot,MAC,IP,Date\n';
  const rows = sales.map(s =>
    `${s.amount || 0},"${s.type || 'unknown'}","${getLabel(s.machineId)}","${s.mac || ''}","${s.ip || ''}","${s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}"`
  ).join('\n');
  const blob = new Blob([header + rows], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sales-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────
const SalesInventory: React.FC = () => {
  // Filters
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [datePreset, setDatePreset] = useState('today');
  const [typeFilter, setTypeFilter] = useState('all');
  const [coinSlotFilter, setCoinSlotFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showOldestFirst, setShowOldestFirst] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Data
  const [salesData, setSalesData] = useState<SalesData>({
    sales: [], coinslots: [], totals: {},
    grandTotal: { amount: 0, count: 0 },
    todayTotal: { amount: 0, count: 0 }
  });
  const [loading, setLoading] = useState(false);
  const [nodeMcuDevices, setNodeMcuDevices] = useState<any[]>([]);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Load NodeMCU devices (for coinslot labels)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const devices = await apiClient.getNodeMCUDevices();
        if (!cancelled && Array.isArray(devices)) {
          setNodeMcuDevices(devices.filter((d: any) => d.status === 'accepted' || d.status === 'connected'));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch sales data when filters change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await apiClient.getSalesInventory({
          from: fromDate, to: toDate,
          coinslot: coinSlotFilter, type: typeFilter
        });
        if (!cancelled) setSalesData(data);
      } catch (e) {
        console.error('Failed to load sales inventory data:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromDate, toDate, coinSlotFilter, typeFilter]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [fromDate, toDate, coinSlotFilter, typeFilter, searchTerm, showOldestFirst]);

  // Date preset handler
  const handleDatePreset = useCallback((preset: string) => {
    setDatePreset(preset);
    const { from, to } = getDateRange(preset);
    setFromDate(from);
    setToDate(to);
  }, []);

  // Coinslot label resolver
  const getCoinSlotLabel = useCallback((machineId: string) => {
    if (!machineId || machineId === 'main') return 'MAIN';
    const device = nodeMcuDevices.find(d => d.macAddress?.toUpperCase() === machineId.toUpperCase());
    return device?.name || machineId;
  }, [nodeMcuDevices]);

  // Filtered + sorted sales
  const filteredSales = useMemo(() => {
    let result = [...salesData.sales];
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toUpperCase();
      result = result.filter(s =>
        (s.mac || '').toUpperCase().includes(q) ||
        (s.machineId || '').toUpperCase().includes(q) ||
        (s.ip || '').includes(q) ||
        (s.type || '').toUpperCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return showOldestFirst ? da - db : db - da;
    });
    return result;
  }, [salesData.sales, searchTerm, showOldestFirst]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / itemsPerPage));
  const paginated = useMemo(
    () => filteredSales.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filteredSales, currentPage, itemsPerPage]
  );

  // Coinslot options with totals
  const coinslotOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; total: number }>();
    map.set('main', { key: 'main', label: 'MAIN', total: salesData.totals['main']?.amount || 0 });
    nodeMcuDevices.forEach(d => {
      const key = d.macAddress;
      if (!map.has(key)) {
        map.set(key, { key, label: d.name || d.macAddress, total: salesData.totals[key]?.amount || 0 });
      }
    });
    salesData.coinslots.forEach(id => {
      if (!map.has(id)) {
        map.set(id, { key: id, label: getCoinSlotLabel(id), total: salesData.totals[id]?.amount || 0 });
      }
    });
    return Array.from(map.values());
  }, [nodeMcuDevices, salesData, getCoinSlotLabel]);

  // Clear inventory handler
  const handleClearInventory = async () => {
    setIsClearing(true);
    try {
      // Re-fetch to refresh (server doesn't have a clear endpoint yet — just refresh)
      const data = await apiClient.getSalesInventory({ from: fromDate, to: toDate });
      setSalesData(data);
    } catch { /* ignore */ }
    setIsClearing(false);
    setShowClearConfirm(false);
  };

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Sales Inventory</h1>
          <p className="text-xs text-slate-500">Monitor all sales by coinslot, type, and date.</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl px-5 py-3 shadow-sm border border-emerald-400 flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Total Sales (All Time)</span>
            <span className="text-2xl font-black text-white">₱{salesData.grandTotal.amount.toFixed(2)}</span>
            <span className="text-[10px] text-emerald-200 font-bold">{salesData.grandTotal.count} txns</span>
          </div>
          <div className="bg-white rounded-xl px-4 py-2 shadow-sm border border-slate-100 flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sales Today</span>
            <span className="text-lg font-black text-emerald-600">₱{salesData.todayTotal.amount.toFixed(2)}</span>
            <span className="text-[10px] text-slate-400 font-bold">{salesData.todayTotal.count} txns</span>
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* From */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full admin-input text-xs" />
          </div>
          {/* To */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full admin-input text-xs" />
          </div>
          {/* Date preset */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Quick Date</label>
            <select value={datePreset} onChange={e => handleDatePreset(e.target.value)} className="w-full admin-input text-xs">
              {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {/* Type */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full admin-input text-xs">
              <option value="all">All Types</option>
              <option value="coin">Coin</option>
              <option value="voucher">Voucher</option>
              <option value="cash">Cash</option>
              <option value="eload">E-Load</option>
              <option value="subscription">Subscription</option>
              <option value="cash_in">Cash-in</option>
              <option value="bills_payment">Bills Payment</option>
            </select>
          </div>
          {/* Coinslot */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Coinslot</label>
            <select value={coinSlotFilter} onChange={e => setCoinSlotFilter(e.target.value)} className="w-full admin-input text-xs">
              <option value="all">All Coinslots (₱{salesData.grandTotal.amount.toFixed(2)})</option>
              {coinslotOptions.map(s => (
                <option key={s.key} value={s.key}>{s.label} (₱{(s.total || 0).toFixed(2)})</option>
              ))}
            </select>
          </div>
          {/* Search */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Search</label>
            <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="w-full admin-input text-xs" placeholder="MAC, IP, type..." />
          </div>
          {/* Items per page */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Per Page</label>
            <select value={itemsPerPage} onChange={e => { setItemsPerPage(parseInt(e.target.value, 10)); setCurrentPage(1); }}
              className="w-full admin-input text-xs">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-2 border-t border-slate-50">
          <div className="flex flex-wrap items-center gap-4 text-[11px]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showOldestFirst} onChange={e => setShowOldestFirst(e.target.checked)}
                className="w-3 h-3 rounded border-slate-300" />
              <span className="font-semibold text-slate-600">Oldest first</span>
            </label>
            <span className="text-slate-400 font-bold">
              {filteredSales.length} record{filteredSales.length !== 1 ? 's' : ''} found
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => exportToCSV(filteredSales, getCoinSlotLabel)}
              className="admin-btn-secondary px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest">
              ↓ Download CSV
            </button>
            <button type="button" onClick={() => setShowClearConfirm(true)}
              className="admin-btn-danger px-4 py-2 rounded-xl text-[11px] font-bold uppercase tracking-widest">
              Clear Inventory
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2.5 text-left font-bold">#</th>
                <th className="px-4 py-2.5 text-left font-bold">Amount</th>
                <th className="px-4 py-2.5 text-left font-bold">Type</th>
                <th className="px-4 py-2.5 text-left font-bold">Coinslot</th>
                <th className="px-4 py-2.5 text-left font-bold">MAC</th>
                <th className="px-4 py-2.5 text-left font-bold">IP</th>
                <th className="px-4 py-2.5 text-left font-bold">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[11px] text-slate-400 animate-pulse">Loading sales data...</td></tr>
              )}
              {!loading && paginated.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-[11px] text-slate-400">No sales found for the selected filters.</td></tr>
              )}
              {!loading && paginated.map((s, idx) => {
                const badge = TYPE_BADGES[s.type] || { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', label: s.type || 'Unknown' };
                const rowNum = (currentPage - 1) * itemsPerPage + idx + 1;
                return (
                  <tr key={(s.id || s.mac || 'row') + idx} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-2 text-[10px] text-slate-400 font-mono">{rowNum}</td>
                    <td className="px-4 py-2 font-bold text-slate-800">₱{(s.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg} ${badge.text} ${badge.border}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-700 font-semibold">{getCoinSlotLabel(s.machineId)}</td>
                    <td className="px-4 py-2 text-[11px] font-mono text-slate-600">{s.mac || '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-600">{s.ip || '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-slate-500">{s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50">
            <span className="text-[10px] text-slate-500 font-bold">
              Page {currentPage} of {totalPages} ({filteredSales.length} records)
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="px-2 py-1 rounded text-[10px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                «
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-2 py-1 rounded text-[10px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                ‹
              </button>
              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button key={page} onClick={() => setCurrentPage(page)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold border ${
                      page === currentPage
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}>
                    {page}
                  </button>
                );
              })}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="px-2 py-1 rounded text-[10px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                ›
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="px-2 py-1 rounded text-[10px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Clear Confirmation Modal ───────────────────────────── */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-rose-50">
              <h3 className="text-[10px] font-black text-rose-700 uppercase tracking-widest">Clear Sales Inventory</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600">
                This will remove all sales records. This action cannot be undone.
              </p>
              <p className="text-[10px] text-slate-400 font-bold uppercase">
                Current records: {salesData.grandTotal.count} transactions totaling ₱{salesData.grandTotal.amount.toFixed(2)}
              </p>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={handleClearInventory} disabled={isClearing}
                className="flex-1 px-4 py-2 bg-rose-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 transition-all disabled:opacity-50">
                {isClearing ? 'Clearing...' : 'Yes, Clear All'}
              </button>
              <button onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesInventory;
