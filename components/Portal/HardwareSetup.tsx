
import React, { useState, useEffect } from 'react';
import { BoardType, SystemConfig, CoinSlotConfig } from '../../types';
import { apiClient } from '../../lib/api';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const HardwareSetup: React.FC<Props> = ({ onClose, onSaved }) => {
  const [board, setBoard] = useState<BoardType>('raspberry_pi');
  const [pin, setPin] = useState(3);
  const [boardModel, setBoardModel] = useState<string>('orange_pi_one');
  const [relayPin, setRelayPin] = useState<number | null>(null);
  const [relayActiveMode, setRelayActiveMode] = useState<'high' | 'low'>('high');

  const [coinSlots, setCoinSlots] = useState<CoinSlotConfig[]>([
    { id: 1, enabled: true, pin: 4, denomination: 1, name: '1 Peso Slot' },
    { id: 2, enabled: true, pin: 5, denomination: 5, name: '5 Peso Slot' },
    { id: 3, enabled: false, pin: 12, denomination: 10, name: '10 Peso Slot' },
    { id: 4, enabled: false, pin: 13, denomination: 1, name: 'Extra Slot' }
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [centralPortalIpEnabled, setCentralPortalIpEnabled] = useState(false);
  const [centralPortalIp, setCentralPortalIp] = useState('');

  useEffect(() => {
    apiClient.getConfig().then(cfg => {
      setBoard(cfg.boardType);
      setPin(cfg.coinPin);
      if (cfg.boardModel) setBoardModel(cfg.boardModel);

      if (cfg.coinSlots && cfg.coinSlots.length > 0) {
        setCoinSlots(cfg.coinSlots);
      }
      if (typeof cfg.relayPin === 'number') {
        setRelayPin(cfg.relayPin);
      }
      if (cfg.relayActiveMode === 'low' || cfg.relayActiveMode === 'high') {
        setRelayActiveMode(cfg.relayActiveMode);
      }
      if (typeof cfg.centralPortalIpEnabled === 'boolean') {
        setCentralPortalIpEnabled(cfg.centralPortalIpEnabled);
      }
      if (cfg.centralPortalIp) {
        setCentralPortalIp(cfg.centralPortalIp);
      }
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.saveConfig({
        boardType: board, 
        coinPin: board === 'x64_pc' ? null : pin,
        boardModel: board === 'orange_pi' ? boardModel : null,

        coinSlots: null,
        centralPortalIpEnabled,
        centralPortalIp: centralPortalIp || '',
        relayPin: board === 'x64_pc' ? null : relayPin,
        relayActiveMode: relayPin != null ? relayActiveMode : 'high'
      });
      onSaved();
      onClose();
    } catch (e) {
      alert('Failed to save hardware configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-slate-950/80 backdrop-blur-xl">
      <div className="w-full max-w-lg bg-white rounded-[40px] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tighter">Hardware Interface</h3>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Configure GPIO & Controller</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center transition-colors">✕</button>
        </div>

        <div className="p-8 space-y-8">
          {/* Board Selection */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Target Board Architecture</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BoardCard 
                active={board === 'raspberry_pi'} 
                onClick={() => setBoard('raspberry_pi')}
                title="Raspberry Pi"
                sub="All Models"
                icon="🍓"
              />
              <BoardCard 
                active={board === 'orange_pi'} 
                onClick={() => setBoard('orange_pi')}
                title="Orange Pi"
                sub="All Models"
                icon="🍊"
              />
              <BoardCard 
                active={board === 'x64_pc'} 
                onClick={() => setBoard('x64_pc')}
                title="x64 PC"
                sub="Ubuntu / Debian"
                icon="🖥️"
              />
            </div>

            {board === 'x64_pc' && (
              <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                  <span className="font-black">ℹ️ x64 PC Mode:</span> No GPIO available. Coin detection is handled exclusively by NodeMCU devices on your VLAN network. Main Machine option will be hidden in the portal.
                </p>
              </div>
            )}
            
            {board === 'orange_pi' && (
              <div className="mt-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Orange Pi Model</label>
                <select 
                   value={boardModel} 
                   onChange={(e) => setBoardModel(e.target.value)}
                   className="w-full p-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none focus:border-blue-500"
                >
                   <option value="orange_pi_one">Orange Pi One</option>
                   <option value="orange_pi_zero_3">Orange Pi Zero 3</option>
                   <option value="orange_pi_pc">Orange Pi PC</option>
                   <option value="orange_pi_5">Orange Pi 5</option>
                </select>
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-slate-200 pt-6">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
              Centralized Portal IP
            </label>
            <p className="text-[10px] text-slate-500 mb-3">
              Kapag naka-on, puwede kang magtakda ng isang portal IP/hostname na gagamiting sentro ng access ng mga kliyente sa iba’t ibang VLAN.
            </p>
            <div className="flex items-center gap-3 mb-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={centralPortalIpEnabled}
                  onChange={(e) => setCentralPortalIpEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-700">
                Enable Centralized Portal
              </span>
            </div>
            <input
              type="text"
              value={centralPortalIp}
              onChange={(e) => setCentralPortalIp(e.target.value)}
              placeholder="Hal. 10.0.0.1 o portal.example.com"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={!centralPortalIpEnabled}
            />
          </div>

          {/* Pin Selection */}
          {/* Pin Selection — hidden for x64_pc (no GPIO) */}
          <div className={`${board === 'x64_pc' ? 'opacity-40 pointer-events-none' : ''}`}>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Coin Slot GPIO Pin (Physical)</label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {[2, 3, 4, 7, 8, 10, 11, 14, 15, 17, 18, 22, 23, 24, 25, 27].map(p => (
                <button
                  key={p}
                  onClick={() => setPin(p)}
                  className={`py-3 rounded-xl border text-xs font-black transition-all ${
                    pin === p 
                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20 scale-105' 
                      : 'border-slate-200 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-4 font-bold flex items-center gap-1.5">
              <span>⚠️</span> Note: Ensure your wiring matches the physical pin number selected.
            </p>
          </div>
          <div className="mt-6">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Relay GPIO Pin (Output)</label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              <button
                onClick={() => setRelayPin(null)}
                className={`py-3 rounded-xl border text-xs font-black transition-all ${
                  relayPin === null
                    ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-500/20 scale-105'
                    : 'border-slate-200 text-slate-400 hover:border-slate-400'
                }`}
              >
                OFF
              </button>
              {[2, 3, 4, 7, 8, 10, 11, 14, 15, 17, 18, 22, 23, 24, 25, 27].map(p => (
                <button
                  key={p}
                  onClick={() => setRelayPin(p)}
                  className={`py-3 rounded-xl border text-xs font-black transition-all ${
                    relayPin === p
                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20 scale-105'
                      : 'border-slate-200 text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Relay Mode</span>
              <div className="flex items-center gap-2 text-[10px] font-bold">
                <button
                  type="button"
                  onClick={() => setRelayActiveMode('high')}
                  className={`px-2 py-1 rounded border ${
                    relayActiveMode === 'high'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600'
                  }`}
                >
                  Active High
                </button>
                <button
                  type="button"
                  onClick={() => setRelayActiveMode('low')}
                  className={`px-2 py-1 rounded border ${
                    relayActiveMode === 'low'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600'
                  }`}
                >
                  Active Low
                </button>
              </div>
            </div>
          </div>
        </div>


        <div className="p-6 pb-10 flex flex-col gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="admin-btn-primary w-full py-5 rounded-2xl font-black text-lg tracking-tight shadow-xl shadow-slate-900/10 active:scale-95 disabled:opacity-50"
          >
            {saving ? 'UPDATING KERNEL MODULES...' : 'COMMIT HARDWARE CHANGES'}
          </button>
        </div>
      </div>
    </div>
  );
};

const BoardCard: React.FC<{ active: boolean; onClick: () => void; title: string; sub: string; icon: string }> = ({ active, onClick, title, sub, icon }) => (
  <button
    onClick={onClick}
    className={`p-4 rounded-2xl border-2 text-left transition-all group ${
      active 
        ? 'bg-blue-50 border-blue-600 shadow-lg shadow-blue-500/10 scale-[1.02]' 
        : 'bg-white border-slate-100 hover:border-slate-300'
    }`}
  >
    <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">{icon}</div>
    <div className={`text-sm font-black tracking-tight ${active ? 'text-blue-700' : 'text-slate-800'}`}>{title}</div>
    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{sub}</div>
  </button>
);

export default HardwareSetup;
