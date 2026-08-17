import React, { useState, useEffect } from 'react';
import { Gift, Save, Gamepad2, TrendingUp, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

interface GameSegment {
  label: string;
  value: number;
  weight: number;
  color: string;
}

interface GameStats {
  total_spins_today: number;
  total_credits_awarded_today: number;
  total_credits_redeemed_today: number;
  active_players: number;
}

export default function RewardsSettings() {
  // Rewards state
  const [enabled, setEnabled] = useState(false);
  const [thresholdPesos, setThresholdPesos] = useState<string>('20');
  const [rewardCreditPesos, setRewardCreditPesos] = useState<string>('1');
  
  // Game state
  const [gameEnabled, setGameEnabled] = useState(false);
  const [gameCostPerSpin, setGameCostPerSpin] = useState<string>('5');
  const [gameCooldownMs, setGameCooldownMs] = useState<string>('300000');
  const [gameDailyLimit, setGameDailyLimit] = useState<string>('20');
  const [gameSegments, setGameSegments] = useState<GameSegment[]>([
    { label: '₱10', value: 10, weight: 40, color: '#3b82f6' },
    { label: '₱25', value: 25, weight: 25, color: '#22c55e' },
    { label: '₱50', value: 50, weight: 15, color: '#eab308' },
    { label: '₱100', value: 100, weight: 10, color: '#ef4444' },
    { label: '₱200', value: 200, weight: 5, color: '#a855f7' },
    { label: 'Try Again', value: 0, weight: 5, color: '#6b7280' }
  ]);
  
  // Stats state
  const [stats, setStats] = useState<GameStats | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        // Load rewards config
        const rewardsCfg = await apiClient.getRewardsConfig();
        setEnabled(rewardsCfg.enabled);
        setThresholdPesos(String(rewardsCfg.thresholdPesos ?? 20));
        setRewardCreditPesos(String(rewardsCfg.rewardCreditPesos ?? 1));

        // Load game settings
        const gameSettings = await fetch('/api/game/settings').then(r => r.json());
        setGameEnabled(gameSettings.game_enabled);
        setGameCostPerSpin(String(gameSettings.game_cost_per_spin));
        setGameCooldownMs(String(gameSettings.game_cooldown_ms));
        setGameDailyLimit(String(gameSettings.game_daily_spin_limit));
        if (gameSettings.game_segments?.length > 0) {
          setGameSegments(gameSettings.game_segments);
        }

        // Load stats
        const gameStats = await fetch('/api/game/stats').then(r => r.json());
        setStats(gameStats);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSaveGame = async () => {
    const cost = parseInt(gameCostPerSpin, 10);
    const cooldown = parseInt(gameCooldownMs, 10);
    const dailyLimit = parseInt(gameDailyLimit, 10);
    if (!cost || cost <= 0 || !cooldown || cooldown <= 0 || !dailyLimit || dailyLimit <= 0) {
      alert('Invalid game configuration.');
      return;
    }
  
    setSaving(true);
    try {
      await fetch('/api/game/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_enabled: gameEnabled,
          game_cost_per_spin: cost,
          game_cooldown_ms: cooldown,
          game_daily_spin_limit: dailyLimit,
          game_segments: gameSegments
        })
      });
      alert('Game settings saved successfully.');
    } catch (e) {
      console.error(e);
      alert('Failed to save game settings.');
    } finally {
      setSaving(false);
    }
  };
  
  const handleSaveRewards = async () => {
    const t = parseInt(thresholdPesos, 10);
    const r = parseInt(rewardCreditPesos, 10);
    if (!t || t <= 0 || isNaN(t) || isNaN(r) || r < 0) {
      alert('Invalid rewards configuration.');
      return;
    }
  
    setSaving(true);
    try {
      await fetch('/api/game/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewards_enabled: enabled,
          rewards_threshold: t,
          rewards_credit: r
        })
      });
      alert('Purchase rewards saved successfully.');
    } catch (e) {
      console.error(e);
      alert('Failed to save purchase rewards.');
    } finally {
      setSaving(false);
    }
  };

  const addSegment = () => {
    setGameSegments([...gameSegments, { label: '₱0', value: 0, weight: 10, color: '#6b7280' }]);
  };

  const removeSegment = (index: number) => {
    if (gameSegments.length <= 2) {
      alert('Minimum 2 segments required.');
      return;
    }
    setGameSegments(gameSegments.filter((_, i) => i !== index));
  };

  const updateSegment = (index: number, field: keyof GameSegment, value: string | number) => {
    const updated = [...gameSegments];
    updated[index] = { ...updated[index], [field]: value };
    setGameSegments(updated);
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-xs">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Game Settings */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500 rounded-lg text-white">
              <Gamepad2 size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Spin & Win Game</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Let players win credits by spinning the wheel
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                gameEnabled ? 'text-purple-600' : 'text-slate-400'
              }`}
            >
              {gameEnabled ? 'Active' : 'Disabled'}
            </span>
            <button
              onClick={() => setGameEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 ${
                gameEnabled ? 'bg-purple-500' : 'bg-slate-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  gameEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Cost Per Spin
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">₱</span>
              <input
                type="number"
                min={1}
                value={gameCostPerSpin}
                onChange={e => setGameCostPerSpin(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Credits required to spin the wheel
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Cooldown
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                value={Math.floor(parseInt(gameCooldownMs) / 60000)}
                onChange={e => setGameCooldownMs(String(parseInt(e.target.value) * 60000))}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
              />
              <span className="text-xs font-bold text-slate-500">min</span>
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Wait time between spins
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Daily Limit
            </label>
            <input
              type="number"
              min={1}
              value={gameDailyLimit}
              onChange={e => setGameDailyLimit(e.target.value)}
              className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
            />
            <p className="text-[9px] text-slate-400 mt-1">
              Max spins per player per day
            </p>
          </div>
        </div>

        {/* Wheel Segments */}
        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">Wheel Segments</h4>
            <button
              onClick={addSegment}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-purple-600 hover:bg-purple-50 rounded transition-colors"
            >
              <Plus size={12} />
              Add Segment
            </button>
          </div>

          <div className="space-y-2">
            {gameSegments.map((segment, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                <input
                  type="color"
                  value={segment.color}
                  onChange={e => updateSegment(index, 'color', e.target.value)}
                  className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={segment.label}
                  onChange={e => updateSegment(index, 'label', e.target.value)}
                  placeholder="Label"
                  className="flex-1 px-2 py-1 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-500">₱</span>
                  <input
                    type="number"
                    min={0}
                    value={segment.value}
                    onChange={e => updateSegment(index, 'value', parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    value={segment.weight}
                    onChange={e => updateSegment(index, 'weight', parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-xs rounded border border-slate-200 focus:border-purple-500 focus:outline-none"
                  />
                  <span className="text-[10px] font-bold text-slate-500">wt</span>
                </div>
                <button
                  onClick={() => removeSegment(index)}
                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 text-[9px] text-slate-400">
            Weight determines probability. Higher weight = more likely to win.
          </div>
        </div>

        {/* Game Save Button */}
        <div className="border-t border-slate-200 pt-4 flex justify-end">
          <button
            onClick={handleSaveGame}
            disabled={saving}
            className="py-2.5 px-6 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 disabled:opacity-50 transition-colors">
            <Save size={14} />
            Save Game Settings
          </button>
        </div>
      </div>

      {/* Purchase Rewards */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500 rounded-lg text-white">
              <Gift size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Purchase Rewards</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Bonus credits for loyal customers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                enabled ? 'text-amber-600' : 'text-slate-400'
              }`}
            >
              {enabled ? 'Active' : 'Disabled'}
            </span>
            <button
              onClick={() => setEnabled(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                enabled ? 'bg-amber-500' : 'bg-slate-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="col-span-1">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Every Purchase Of
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">₱</span>
              <input
                type="number"
                min={1}
                value={thresholdPesos}
                onChange={e => setThresholdPesos(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Threshold amount. Remainder carries over to next purchase.
            </p>
          </div>

          <div className="col-span-1">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
              Gives Extra Credit
            </label>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-500">₱</span>
              <input
                type="number"
                min={0}
                value={rewardCreditPesos}
                onChange={e => setRewardCreditPesos(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded border border-slate-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-slate-400 mt-1">
              Credit earned per threshold reached.
            </p>
          </div>

          <div className="col-span-1 flex items-end">
            <button
              onClick={handleSaveRewards}
              disabled={saving}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
              <Save size={14} />
              Save Rewards
            </button>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-[9px] text-amber-800 font-bold uppercase tracking-tight">
          Example: With threshold ₱20 and reward ₱1, a customer who inserts ₱25 earns ₱1 credit with ₱5 pending toward the next reward.
        </div>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500 rounded-lg text-white">
              <TrendingUp size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Today's Statistics</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                Game performance overview
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-purple-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-purple-600">{stats.total_spins_today}</div>
              <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Total Spins</div>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-green-600">₱{stats.total_credits_awarded_today}</div>
              <div className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Credits Awarded</div>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-blue-600">₱{stats.total_credits_redeemed_today}</div>
              <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Credits Redeemed</div>
            </div>
            <div className="bg-amber-50 p-3 rounded-lg">
              <div className="text-2xl font-black text-amber-600">{stats.active_players}</div>
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Active Players</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
