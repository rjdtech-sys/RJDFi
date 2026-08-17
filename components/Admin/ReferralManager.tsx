import React, { useState, useEffect } from 'react';
import { Users, Save, TrendingUp, Copy, RefreshCw } from 'lucide-react';

function adminHeaders() {
  const token = localStorage.getItem('rjd_admin_token') || '';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

interface ReferralConfig {
  enabled: boolean;
  referrerPointsPerPesos: number;
  refereeBonusMinutes: number;
  minPesosToTrigger: number;
}

interface ReferralStats {
  totalReferrals: number;
  totalPointsAwarded: number;
  topReferrers: Array<{
    mac_address: string;
    code: string;
    points: number;
    referral_count: number;
  }>;
  recentEvents: Array<{
    id: number;
    referrer_mac: string;
    referee_mac: string;
    referee_ip: string;
    referral_code: string;
    pesos_spent: number;
    points_earned: number;
    referee_bonus_minutes: number;
    created_at: string;
  }>;
}

export default function ReferralManager() {
  const [config, setConfig] = useState<ReferralConfig>({
    enabled: false,
    referrerPointsPerPesos: 20,
    refereeBonusMinutes: 5,
    minPesosToTrigger: 20
  });
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedMac, setCopiedMac] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [cfgRes, statsRes] = await Promise.all([
        fetch('/api/referral/config', { headers: adminHeaders() }).then(r => r.json()),
        fetch('/api/referral/stats', { headers: adminHeaders() }).then(r => r.json())
      ]);
      setConfig(cfgRes);
      setStats(statsRes);
    } catch (e) {
      console.error('[ReferralManager] Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const rpp = parseInt(String(config.referrerPointsPerPesos), 10);
    const rbm = parseInt(String(config.refereeBonusMinutes), 10);
    const mpt = parseInt(String(config.minPesosToTrigger), 10);

    if (!rpp || rpp <= 0 || isNaN(rbm) || rbm < 0 || !mpt || mpt <= 0) {
      alert('Invalid referral configuration.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/referral/config', {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          enabled: config.enabled,
          referrerPointsPerPesos: rpp,
          refereeBonusMinutes: rbm,
          minPesosToTrigger: mpt
        })
      });
      if (!res.ok) throw new Error('Save failed');
      alert('Referral settings saved.');
    } catch (e) {
      console.error(e);
      alert('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = (text: string, mac: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMac(mac);
      setTimeout(() => setCopiedMac(null), 1500);
    });
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-xs">
        Loading referral settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Settings Card */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500 rounded-lg text-white">
              <Users size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Referral Program</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Customers earn points when referred friends pay
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${config.enabled ? 'text-indigo-600' : 'text-slate-400'}`}>
              {config.enabled ? 'Active' : 'Disabled'}
            </span>
            <button
              onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${config.enabled ? 'bg-indigo-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Pesos Per Point (Referrer)
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">₱</span>
              <input
                type="number"
                min={1}
                value={config.referrerPointsPerPesos}
                onChange={e => setConfig(c => ({ ...c, referrerPointsPerPesos: parseInt(e.target.value) || 0 }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Referrer earns 1 credit point per this many pesos spent by referee
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Referee Bonus Minutes
            </label>
            <input
              type="number"
              min={0}
              value={config.refereeBonusMinutes}
              onChange={e => setConfig(c => ({ ...c, refereeBonusMinutes: parseInt(e.target.value) || 0 }))}
              className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-[9px] text-slate-400 mt-1">
              Free minutes given to new customer when they use a referral code
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Min Pesos To Trigger
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">₱</span>
              <input
                type="number"
                min={1}
                value={config.minPesosToTrigger}
                onChange={e => setConfig(c => ({ ...c, minPesosToTrigger: parseInt(e.target.value) || 0 }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Minimum single payment to count toward referrer points
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save size={14} />
            Save Settings
          </button>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-[9px] text-indigo-800 font-bold uppercase tracking-tight">
          Example: With ₱20 per point, when a referred customer inserts ₱20, the referrer earns 1 credit point (₱1 credit).
        </div>
      </div>

      {/* Stats Card */}
      {stats && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500 rounded-lg text-white">
                <TrendingUp size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Referral Statistics</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Program performance overview
                </p>
              </div>
            </div>
            <button
              onClick={() => { setLoading(true); loadData(); }}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Refresh stats"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-indigo-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-indigo-600">{stats.totalReferrals}</div>
              <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Total Referrals</div>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-emerald-600">{stats.totalPointsAwarded}</div>
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Points Awarded</div>
            </div>
            <div className="bg-purple-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-purple-600">{stats.topReferrers?.length || 0}</div>
              <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Active Referrers</div>
            </div>
          </div>

          {/* Top Referrers */}
          {stats.topReferrers && stats.topReferrers.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">Top Referrers</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">MAC Address</th>
                      <th className="text-left py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Code</th>
                      <th className="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Referrals</th>
                      <th className="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topReferrers.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-[11px]">{r.mac_address}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">{r.code}</span>
                            <button
                              onClick={() => handleCopy(r.code, r.mac_address)}
                              className="text-slate-400 hover:text-slate-600"
                              title="Copy code"
                            >
                              <Copy size={12} />
                            </button>
                            {copiedMac === r.mac_address && (
                              <span className="text-[9px] text-green-600 font-bold">Copied!</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center font-bold">{r.referral_count}</td>
                        <td className="py-2 px-3 text-center font-bold text-emerald-600">{r.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Events */}
          {stats.recentEvents && stats.recentEvents.length > 0 && (
            <div>
              <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">Recent Referral Events</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Date</th>
                      <th className="text-left py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Referrer</th>
                      <th className="text-left py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Referee</th>
                      <th className="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Pesos</th>
                      <th className="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Points</th>
                      <th className="text-center py-2 px-3 font-bold text-slate-500 uppercase tracking-wider text-[10px]">Bonus Min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentEvents.slice(0, 20).map((e) => (
                      <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 text-[11px] text-slate-500">
                          {new Date(e.created_at).toLocaleDateString()} {new Date(e.created_at).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-3 font-mono text-[10px]">{e.referrer_mac}</td>
                        <td className="py-2 px-3 font-mono text-[10px]">{e.referee_mac}</td>
                        <td className="py-2 px-3 text-center">{e.pesos_spent > 0 ? `₱${e.pesos_spent}` : '-'}</td>
                        <td className="py-2 px-3 text-center font-bold text-emerald-600">{e.points_earned > 0 ? e.points_earned : '-'}</td>
                        <td className="py-2 px-3 text-center">{e.referee_bonus_minutes > 0 ? `${e.referee_bonus_minutes}m` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!stats.topReferrers?.length && !stats.recentEvents?.length && (
            <div className="text-center py-8 text-slate-400">
              <Users size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-xs font-bold">No referral activity yet</p>
              <p className="text-[10px]">Enable the program and share codes with customers to get started.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
