import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AdminTab, UserSession, Rate, WifiDevice, NodeMCUDevice } from './types';
import Analytics from './components/Admin/Analytics';
import RatesManager from './components/Admin/RatesManager';
import NetworkSettings from './components/Admin/NetworkSettings';
import HardwareManager from './components/Admin/HardwareManager';
import SystemUpdater from './components/Admin/SystemUpdater';
import SystemSettings from './components/Admin/SystemSettings';
import DeviceManager from './components/Admin/DeviceManager';
import Login from './components/Admin/Login';
import ThemeSettings from './components/Admin/ThemeSettings';
import PortalEditor from './components/Admin/PortalEditor';
import PPPoEServer from './components/Admin/PPPoEServer';
import MikroTikManagement from './components/Admin/MikroTikManagement';
import { MyMachines } from './components/Admin/MyMachines';
import BandwidthManager from './components/Admin/BandwidthManager';
import MultiWanSettings from './components/Admin/MultiWanSettings';
import ChatManager from './components/Admin/ChatManager';
import VoucherManager from './components/Admin/VoucherManager';
import RemoteManager from './components/Admin/RemoteManager';
import RewardsSettings from './components/Admin/RewardsSettings';
import CompanySettings from './components/Admin/CompanySettings';
import ToolsPage from './components/Admin/ToolsPage';
import EmployeeManagement from './components/Admin/EmployeeManagement';
import EquipmentInventory from './components/Admin/EquipmentInventory';
import PhoneRental from './components/Admin/PhoneRental';
import SalesInventory from './components/Admin/SalesInventory';
import ReferralManager from './components/Admin/ReferralManager';
import WireGuardSettings from './components/Admin/WireGuardSettings';
import { apiClient } from './lib/api';
import { initAdminTheme, setAdminTheme, applyAdminTheme } from './lib/theme';

const App: React.FC = () => {

  const isCurrentlyAdminPath = () => {
    const path = window.location.pathname.toLowerCase();
    const hasAdminFlag = localStorage.getItem('rjd_admin_mode') === 'true';
    return path === '/admin' || path === '/admin/' || path.startsWith('/admin/') || hasAdminFlag;
  };

  const [isAdmin, setIsAdmin] = useState(isCurrentlyAdminPath());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Initialize activeTab from localStorage if available to persist state across refreshes
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const savedTab = localStorage.getItem('rjd_admin_last_tab');
    // Simple validation to ensure the saved value is a valid enum value
    if (savedTab && Object.values(AdminTab).includes(savedTab as AdminTab)) {
      return savedTab as AdminTab;
    }
    return AdminTab.Analytics;
  });

  // Persist activeTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('rjd_admin_last_tab', activeTab);
  }, [activeTab]);

  const [licenseStatus, setLicenseStatus] = useState<{ isLicensed: boolean, isRevoked: boolean, canOperate: boolean }>({ isLicensed: true, isRevoked: false, canOperate: true });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rates, setRates] = useState<Rate[]>([]);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [salesSessions, setSalesSessions] = useState<UserSession[]>([]);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [devices, setDevices] = useState<WifiDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companySettings, setCompanySettings] = useState<{ companyName: string, companyLogo: string | null }>({
    companyName: 'RJD PISOWIFI',
    companyLogo: null
  });

  const [systemVersion, setSystemVersion] = useState<string>('');

  // Fetch system version on mount
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const token = localStorage.getItem('rjd_admin_token');
        const headers: HeadersInit = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/system/current-version', { headers });
        if (res.ok) {
          const data = await res.json();
          const tag = data.version_name ? `v${data.version_name}-ONLINE-STABLE` : '';
          setSystemVersion(tag);
        }
      } catch {}
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      document.title = `${companySettings.companyName} - Admin Panel`;
    }
  }, [companySettings, isAdmin]);

  const loadData = async () => {
    try {
      setError(null);
      
      // Fetch company settings first to update UI immediately
      try {
        const settings = await apiClient.getCompanySettings();
        setCompanySettings(settings);
      } catch (e) {
        console.warn('Failed to fetch company settings');
      }

      // Check license status first
      try {
        const lic = await fetch('/api/license/status').then(r => r.json());
        setLicenseStatus(lic);
        if (lic.isRevoked) {
          setActiveTab(AdminTab.Machines);
        }
      } catch (e) {
        console.warn('Failed to fetch license status');
      }

      const isAdminRoute = isCurrentlyAdminPath();
      const devicesPromise = isAdminRoute
        ? apiClient.getWifiDevices().catch(() => [])
        : Promise.resolve([]);

      const sessionsPromise = apiClient.getSessions().catch(() => []);
      const salesSessionsPromise = isAdminRoute
        ? apiClient.getSalesSessions().catch(() => [])
        : Promise.resolve([]);
      
      const salesHistoryPromise = isAdminRoute
        ? apiClient.getSalesHistory().catch(() => [])
        : Promise.resolve([]);

      const [fetchedRates, sessions, salesSessionData, fetchedDevices, salesHistoryData] = await Promise.all([
        apiClient.getRates(),
        sessionsPromise,
        salesSessionsPromise,
        devicesPromise,
        salesHistoryPromise
      ]);
      setRates(fetchedRates);
      setActiveSessions(sessions);
      if (isAdminRoute) {
        setSalesSessions(salesSessionData);
        setSalesHistory(salesHistoryData);
      }
      setDevices(fetchedDevices);
    } catch (err: any) {
      console.error('Backend connection failed:', err);
      setError(err.message || 'Connection to RJD Hardware failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initialize theme based on current mode
    if (isCurrentlyAdminPath()) {
      initAdminTheme();
    } else {
      // Ensure portal always uses default theme (or specific portal theme logic)
      applyAdminTheme('default');
    }

    loadData();
    const handleLocationChange = () => {
      const isNowAdmin = isCurrentlyAdminPath();
      setIsAdmin(isNowAdmin);
      
      if (isNowAdmin) {
        initAdminTheme();
      } else {
        applyAdminTheme('default');
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    
    // Check authentication status
    const checkAuth = async () => {
      const token = localStorage.getItem('rjd_admin_token');
      if (token) {
        try {
          const res = await fetch('/api/admin/check-auth', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await res.json();
          if (data.authenticated) {
            setIsAuthenticated(true);
          } else {
            localStorage.removeItem('rjd_admin_token');
            setIsAuthenticated(false);
          }
        } catch (e) {
          setIsAuthenticated(false);
        }
      }
    };
    checkAuth();

    // Restore session on mount
    restoreSession();

    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  // Sync state with backend timer
  useEffect(() => {
    let deviceRefreshInFlight = false;
    let tick = 0;
    const interval = setInterval(async () => {
      // Periodic refresh from server to ensure sync
      try {
        const sessions = await apiClient.getSessions();
        setActiveSessions(sessions);
      } catch (e) {
        // Local decrement as fallback for smooth UI - skip if paused
        setActiveSessions(prev => 
          prev.map(s => ({
            ...s,
            remainingSeconds: s.isPaused ? s.remainingSeconds : Math.max(0, s.remainingSeconds - 1)
          })).filter(s => s.remainingSeconds > 0)
        );
      }

      // Device list refresh — throttled to every 10s and overlap-guarded.
      // /api/devices is expensive on large fleets; fetching it every second used
      // to pile up concurrent requests and hang the Devices page ("Loading devices...").
      tick += 1;
      if (isCurrentlyAdminPath() && !deviceRefreshInFlight && tick % 10 === 0) {
        deviceRefreshInFlight = true;
        try {
          const fetchedDevices = await apiClient.getWifiDevices();
          setDevices(fetchedDevices);
        } catch (e) {
          // Keep the last known device list on transient errors
        } finally {
          deviceRefreshInFlight = false;
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleAdmin = () => {
    const nextState = !isAdmin;
    setIsAdmin(nextState);
    if (nextState) {
      localStorage.setItem('rjd_admin_mode', 'true');
      window.history.pushState({}, '', '/admin');
      initAdminTheme();
    } else {
      localStorage.removeItem('rjd_admin_mode');
      localStorage.removeItem('rjd_admin_token');
      setIsAuthenticated(false);
      window.history.pushState({}, '', '/');
      applyAdminTheme('default');
    }
  };

  const handleAddSession = async (session: UserSession) => {
    try {
      const coinSlot = (session as any).coinSlot as string | undefined;
      const coinSlotLockId = (session as any).coinSlotLockId as string | undefined;
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mac: session.mac,
          minutes: Math.ceil(session.remainingSeconds / 60),
          pesos: session.totalPaid,
          slot: coinSlot || 'main',
          lockId: coinSlotLockId
          // Don't send IP - server will detect it
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) {
          localStorage.setItem('rjd_session_token', data.token);
        }
        loadData();
        if (data.message) {
          alert('✅ ' + data.message);
        } else {
          alert('✅ Internet access granted! Connection should activate automatically.');
        }
        if (window.location.pathname === '/') {
          window.location.reload();
        }
      } else {
        alert('❌ Failed to authorize session: ' + data.error);
      }
    } catch (e) {
      alert('❌ Network error authorizing connection.');
    } finally {
      const coinSlot = (session as any).coinSlot as string | undefined;
      const coinSlotLockId = (session as any).coinSlotLockId as string | undefined;
      if (coinSlot && coinSlotLockId) {
        fetch('/api/coinslot/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: coinSlot, lockId: coinSlotLockId })
        }).catch(() => {});
      }
    }
  };

  const updateRates = async () => {
    await loadData();
  };

  // Check for existing session token and try to restore (Fix for randomized MACs/SSID switching)
  // Trigger OS connectivity probes after session restore/transfer
  // This forces the OS to re-check internet connectivity and close
  // the captive portal mini-browser popup
  const triggerConnectivityProbes = () => {
    fetch('http://connectivitycheck.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://captive.apple.com/hotspot-detect.html', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://www.msftconnecttest.com/connecttest.txt', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    fetch('http://1.1.1.1/', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    setTimeout(() => {
      fetch('http://connectivitycheck.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
      fetch('http://captive.apple.com/hotspot-detect.html', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
    }, 1500);
  };

  const restoreSession = async (retries = 5) => {
    const sessionToken = localStorage.getItem('rjd_session_token');
    if (sessionToken) {
      try {
        const res = await fetch('/api/sessions/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: sessionToken })
        });
        
        // If 400 (Bad Request), it likely means MAC resolution failed temporarily. Retry.
        if (res.status === 400 && retries > 0) {
          console.log(`[Session] Restore failed (400), retrying... (${retries} left)`);
          setTimeout(() => restoreSession(retries - 1), 2000);
          return;
        }

        const data = await res.json();
        if (data.success) {
          console.log('Session restored successfully');
          if (data.migrated) {
            console.log('Session migrated to new network info');
            loadData(); // Reload to see active session
            // Trigger connectivity probes so OS closes captive portal mini-browser
            triggerConnectivityProbes();
          } else {
            // Even for non-migrated restores, probe connectivity
            // to ensure the OS knows internet is available
            triggerConnectivityProbes();
          }
        } else if (res.status === 404) {
          // Token invalid/expired - only remove if we are sure
          console.log('[Session] Token expired or invalid');
          localStorage.removeItem('rjd_session_token');
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
        if (retries > 0) {
          setTimeout(() => restoreSession(retries - 1), 2000);
        }
      }
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-blue-400 font-bold tracking-widest uppercase text-xs">RJD Core Initializing...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-[32px] shadow-2xl border border-red-100 text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">⚠️</div>
          <h2 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">System Offline</h2>
          <p className="text-slate-500 text-sm mb-8 leading-relaxed">{error}</p>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="admin-btn-primary w-full py-4 rounded-2xl font-bold shadow-xl shadow-slate-900/20"
          >
            Retry System Link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed bottom-4 right-4 z-[999] hidden md:block">
        <button
          onClick={handleToggleAdmin}
          className="admin-exit-btn px-5 py-3 rounded-full text-[10px] font-black tracking-widest uppercase shadow-2xl border active:scale-95 transition-all flex items-center gap-2"
        >
          <span>{isAdmin ? '🚪' : '🔐'}</span>
          {isAdmin ? 'Exit Admin' : 'Admin Login'}
        </button>
      </div>

      {isAdmin ? (
        isAuthenticated ? (
          <div className="admin-layout flex h-screen overflow-hidden bg-slate-100 font-sans selection:bg-blue-100">
            {/* Mobile Sidebar Overlay */}
            {sidebarOpen && (
              <div 
                className="fixed inset-0 bg-black/50 z-40 md:hidden animate-in fade-in duration-300" 
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Sidebar */}
            <aside className={`
              admin-sidebar fixed md:relative h-full
              ${sidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64 md:translate-x-0 md:w-20'} 
              bg-slate-900 text-white flex flex-col shrink-0 transition-all duration-300 ease-in-out z-50 border-r border-slate-800
            `}>
              <div className={`p-4 border-b border-white/5 flex items-center ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
                {sidebarOpen ? (
                  <>
                    <div className="flex items-center gap-2 overflow-hidden">
                      {companySettings.companyLogo ? (
                         <img src={companySettings.companyLogo} className="w-8 h-8 object-contain bg-white rounded-md" alt="Logo" />
                      ) : (
                         <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center font-black text-xs shrink-0">
                           {companySettings.companyName.substring(0, 3).toUpperCase()}
                         </div>
                      )}
                      <h1
                        className="text-lg font-bold tracking-tight truncate"
                        style={{ color: document.documentElement.getAttribute('data-theme') === 'aircoins' ? '#FFFFFF' : '#111827' }}
                        title={companySettings.companyName}
                      >
                        {companySettings.companyName}
                      </h1>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 md:hidden shrink-0">
                      ✕
                    </button>
                  </>
                ) : (
                  companySettings.companyLogo ? (
                     <img src={companySettings.companyLogo} className="w-8 h-8 object-contain bg-white rounded-md" alt="Logo" />
                  ) : (
                     <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-xs">
                       {companySettings.companyName.substring(0, 1).toUpperCase()}
                     </div>
                  )
                )}
              </div>
              
          <nav className={`admin-sidebar-nav flex-1 ${sidebarOpen ? 'p-3' : 'p-2'} space-y-1 overflow-y-auto scrollbar-hide`}>
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Analytics} onClick={() => setActiveTab(AdminTab.Analytics)} icon="📊" label="Dashboard" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Rates} onClick={() => setActiveTab(AdminTab.Rates)} icon="💰" label="Pricing" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Network} onClick={() => setActiveTab(AdminTab.Network)} icon="🌐" label="Network" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Devices} onClick={() => setActiveTab(AdminTab.Devices)} icon="📱" label="Devices" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Hardware} onClick={() => setActiveTab(AdminTab.Hardware)} icon="🔌" label="Hardware" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Themes} onClick={() => setActiveTab(AdminTab.Themes)} icon="🎨" label="Themes" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PortalEditor} onClick={() => setActiveTab(AdminTab.PortalEditor)} icon="🖥️" label="Portal" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PPPoE} onClick={() => setActiveTab(AdminTab.PPPoE)} icon="📞" label="PPPoE" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.MikroTik} onClick={() => setActiveTab(AdminTab.MikroTik)} icon="📡" label="MikroTik" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Bandwidth} onClick={() => setActiveTab(AdminTab.Bandwidth)} icon="📶" label="QoS" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.MultiWan} onClick={() => setActiveTab(AdminTab.MultiWan)} icon="🔀" label="Multi-WAN" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.WireGuard} onClick={() => setActiveTab(AdminTab.WireGuard)} icon="🔒" label="WireGuard" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Chat} onClick={() => setActiveTab(AdminTab.Chat)} icon="💬" label="Chat" collapsed={!sidebarOpen} />
            <SidebarItem disabled={false} active={activeTab === AdminTab.Machines} onClick={() => setActiveTab(AdminTab.Machines)} icon="🤖" label="Machines" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Vouchers} onClick={() => setActiveTab(AdminTab.Vouchers)} icon="🎟️" label="Vouchers" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Rewards} onClick={() => setActiveTab(AdminTab.Rewards)} icon="🎮" label="Games & Rewards" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.SalesInventory} onClick={() => setActiveTab(AdminTab.SalesInventory)} icon="📒" label="Sales Inventory" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Employees} onClick={() => setActiveTab(AdminTab.Employees)} icon="👷" label="Employees" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.EquipmentInventory} onClick={() => setActiveTab(AdminTab.EquipmentInventory)} icon="📦" label="Equipment" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.PhoneRental} onClick={() => setActiveTab(AdminTab.PhoneRental)} icon="📲" label="Phone Rental" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Referrals} onClick={() => setActiveTab(AdminTab.Referrals)} icon="🤝" label="Referrals" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Remote} onClick={() => setActiveTab(AdminTab.Remote)} icon="🛰️" label="Remote" collapsed={!sidebarOpen} />
            <SidebarItem active={activeTab === AdminTab.CompanySettings} onClick={() => setActiveTab(AdminTab.CompanySettings)} icon="🏢" label="Company" collapsed={!sidebarOpen} />
            <SidebarItem active={activeTab === AdminTab.System} onClick={() => setActiveTab(AdminTab.System)} icon="⚙️" label="System" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Updater} onClick={() => setActiveTab(AdminTab.Updater)} icon="🚀" label="Updater" collapsed={!sidebarOpen} />
            <SidebarItem disabled={!licenseStatus.canOperate && !licenseStatus.isRevoked} active={activeTab === AdminTab.Tools} onClick={() => setActiveTab(AdminTab.Tools)} icon="🔧" label="Tools" collapsed={!sidebarOpen} />
          </nav>

              <div className={`admin-sidebar-footer p-4 border-t border-white/5 bg-black/20 ${sidebarOpen ? 'block' : 'hidden md:block'}`}>
                 <div className="flex flex-col gap-3">
                   <div className="flex flex-col">
                      <span className="text-white font-black text-sm tracking-tighter uppercase leading-none">RJD PISOWIFI</span>
                      {sidebarOpen && <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">{systemVersion || 'v3.7.8-STABLE'}</span>}
                   </div>
                   
                  {/* Mobile Exit Button */}
                  {sidebarOpen && (
                    <button 
                      onClick={handleToggleAdmin}
                      className="admin-exit-btn w-full px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors md:hidden"
                    >
                      <span>🚪</span> Exit Admin
                    </button>
                  )}
                 </div>
              </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 bg-slate-100 overflow-hidden">
              {/* Compact Top Bar */}
              <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-30">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-tight block">
                    {activeTab}
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="hidden md:flex flex-col items-end mr-2">
                    <span className="text-[10px] font-bold text-slate-900 uppercase">Administrator</span>
                    <span className="text-[9px] text-green-600 font-bold uppercase tracking-tighter">System Verified</span>
                  </div>
                  <div className="w-8 h-8 bg-slate-800 rounded-md flex items-center justify-center text-white font-bold text-xs shadow-sm">
                    AD
                  </div>
                </div>
              </header>

              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 scroll-smooth">
                <div className="max-w-7xl mx-auto space-y-6">
                  {activeTab === AdminTab.Analytics && <Analytics sessions={salesSessions.length ? salesSessions : activeSessions} salesHistory={salesHistory} />}
                  {activeTab === AdminTab.Rates && <RatesManager rates={rates} setRates={updateRates} />}
                  {activeTab === AdminTab.Network && <NetworkSettings />}
                  {activeTab === AdminTab.Devices && <DeviceManager sessions={activeSessions} refreshSessions={loadData} refreshDevices={loadData} />}
                  {activeTab === AdminTab.Hardware && <HardwareManager />}
                  {activeTab === AdminTab.Themes && <ThemeSettings />}
                  {activeTab === AdminTab.PortalEditor && <PortalEditor />}
                  {activeTab === AdminTab.PPPoE && <PPPoEServer />}
                  {activeTab === AdminTab.MikroTik && <MikroTikManagement />}
                  {activeTab === AdminTab.Bandwidth && <BandwidthManager devices={devices} rates={rates} />}
                  {activeTab === AdminTab.MultiWan && <MultiWanSettings />}
                  {activeTab === AdminTab.WireGuard && <WireGuardSettings />}
                  {activeTab === AdminTab.Chat && <ChatManager />}
                  {activeTab === AdminTab.Machines && <MyMachines />}
                  {activeTab === AdminTab.Vouchers && <VoucherManager />}
                  {activeTab === AdminTab.SalesInventory && <SalesInventory />}
                  {activeTab === AdminTab.Employees && <EmployeeManagement />}
                  {activeTab === AdminTab.EquipmentInventory && <EquipmentInventory />}
                  {activeTab === AdminTab.PhoneRental && <PhoneRental />}
                  {activeTab === AdminTab.Referrals && <ReferralManager />}
                  {activeTab === AdminTab.Remote && <RemoteManager />}
                  {activeTab === AdminTab.Rewards && <RewardsSettings />}
                  {activeTab === AdminTab.CompanySettings && <CompanySettings />}
                  {activeTab === AdminTab.System && <SystemSettings />}
                  {activeTab === AdminTab.Updater && <SystemUpdater />}
                  {activeTab === AdminTab.Tools && <ToolsPage />}
                </div>
                {/* Bottom Spacer for Mobile */}
                <div className="h-20 md:hidden" />
              </div>
            </main>
          </div>
        ) : (
          <Login 
            onLoginSuccess={(token) => {
              localStorage.setItem('rjd_admin_token', token);
              setIsAuthenticated(true);
              initAdminTheme();
            }} 
            onBack={() => handleToggleAdmin()} 
          />
        )
      ) : (
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh',flexDirection:'column',gap:'16px'}}>
          <p style={{color:'#fff',fontSize:'18px'}}>Portal is served from the HTML gateway.</p>
          <button onClick={() => handleToggleAdmin()} style={{padding:'10px 24px',borderRadius:'8px',border:'none',background:'#6366f1',color:'#fff',cursor:'pointer',fontSize:'14px'}}>Admin Panel</button>
        </div>
      )}
    </div>
  );
};

const SidebarItem: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string; collapsed?: boolean; disabled?: boolean }> = ({ active, onClick, icon, label, collapsed, disabled }) => (
  <button 
    onClick={disabled ? undefined : onClick} 
    title={collapsed ? label : undefined}
    disabled={disabled}
    className={`sidebar-item w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 group ${
      disabled 
        ? 'sidebar-item-disabled opacity-20 cursor-not-allowed grayscale' 
        : active 
          ? 'sidebar-item-active text-white' 
          : 'sidebar-item-default text-slate-400 hover:bg-white/5 hover:text-white'
    } ${collapsed ? 'sidebar-item-collapsed justify-center' : 'justify-start'}`}
  >
    <span className={`sidebar-icon text-xl ${active ? 'scale-110' : 'group-hover:scale-110'} transition-transform`}>{icon}</span>
    {!collapsed && <span className="sidebar-label uppercase tracking-widest text-[11px] font-black">{label}</span>}
  </button>
);

export default App;
