import React, { useState, useEffect } from 'react';

interface SpinWheelProps {
  token: string;
  onSessionUpdate?: () => void;
}

interface GameSegment {
  label: string;
  value: number;
  weight: number;
  color: string;
}

interface GameSettings {
  game_enabled: boolean;
  game_cost_per_spin: number;
  game_cooldown_ms: number;
  game_segments: GameSegment[];
}

export default function SpinWheel({ token, onSessionUpdate }: SpinWheelProps) {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [credits, setCredits] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [lastPrize, setLastPrize] = useState<{ label: string; value: number } | null>(null);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeemMinutes, setRedeemMinutes] = useState(0);

  useEffect(() => {
    loadGameSettings();
    loadBalance();
  }, []);

  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setInterval(() => {
        setCooldownRemaining(prev => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownRemaining]);

  const loadGameSettings = async () => {
    try {
      const res = await fetch('/api/game/settings');
      const data = await res.json();
      setSettings(data);
    } catch (e) {
      console.error('Failed to load game settings:', e);
    }
  };

  const loadBalance = async () => {
    try {
      const res = await fetch('/api/game/balance', {
        headers: { 'X-Session-Token': token }
      });
      const data = await res.json();
      setCredits(data.credits || 0);
    } catch (e) {
      console.error('Failed to load balance:', e);
    }
  };

  const handleSpin = async () => {
    if (!settings || isSpinning || cooldownRemaining > 0 || credits < settings.game_cost_per_spin) {
      return;
    }

    setIsSpinning(true);
    setShowResult(false);

    try {
      const res = await fetch('/api/game/spin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': token
        }
      });

      const data = await res.json();

      if (res.ok) {
        // Calculate rotation for animation
        const segmentAngle = 360 / settings.game_segments.length;
        const randomSegment = Math.floor(Math.random() * settings.game_segments.length);
        const targetRotation = rotation + 360 * 5 + (randomSegment * segmentAngle);
        
        setRotation(targetRotation);
        setCredits(data.new_balance);
        setLastPrize(data.prize);

        // Show result after animation
        setTimeout(() => {
          setIsSpinning(false);
          setShowResult(true);
          setCooldownRemaining(Math.ceil(settings.game_cooldown_ms / 1000));
        }, 4000);
      } else {
        alert(data.error || 'Failed to spin');
        setIsSpinning(false);
      }
    } catch (e) {
      console.error('Spin error:', e);
      alert('Failed to spin wheel');
      setIsSpinning(false);
    }
  };

  const handleRedeem = async () => {
    const amount = parseInt(redeemAmount, 10);
    if (!amount || amount <= 0 || amount > credits) {
      alert('Invalid amount');
      return;
    }

    try {
      const res = await fetch('/api/game/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Token': token
        },
        body: JSON.stringify({ amount })
      });

      const data = await res.json();

      if (res.ok) {
        alert(`Successfully redeemed ${data.minutes_added} minutes!`);
        setCredits(data.remaining_credits);
        setShowRedeemModal(false);
        setRedeemAmount('');
        setRedeemMinutes(0);
        if (onSessionUpdate) onSessionUpdate();
      } else {
        alert(data.error || 'Failed to redeem');
      }
    } catch (e) {
      console.error('Redeem error:', e);
      alert('Failed to redeem credits');
    }
  };

  const calculateMinutes = (amount: number) => {
    // This would ideally fetch from rates, but for now use a simple calculation
    // Assuming ₱1 = 3 minutes as a base rate
    return Math.floor(amount * 3);
  };

  if (!settings || !settings.game_enabled) {
    return null;
  }

  const canSpin = !isSpinning && cooldownRemaining === 0 && credits >= settings.game_cost_per_spin;

  return (
    <div className="bg-gradient-to-br from-purple-500 to-pink-500 p-6 rounded-xl shadow-lg text-white">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-black uppercase tracking-wider mb-2">🎰 Spin & Win</h2>
        <p className="text-sm opacity-90">Win credits to redeem for internet time!</p>
      </div>

      {/* Credit Balance */}
      <div className="bg-white/20 backdrop-blur rounded-lg p-3 mb-4 text-center">
        <div className="text-xs uppercase tracking-wider opacity-80">Your Credits</div>
        <div className="text-3xl font-black">₱{credits}</div>
      </div>

      {/* Wheel */}
      <div className="relative w-64 h-64 mx-auto mb-4">
        <div
          className="w-full h-full rounded-full border-4 border-white shadow-2xl transition-transform duration-[4000ms] ease-out"
          style={{
            transform: `rotate(${rotation}deg)`,
            background: `conic-gradient(${settings.game_segments
              .map((seg, i) => {
                const start = (i / settings.game_segments.length) * 100;
                const end = ((i + 1) / settings.game_segments.length) * 100;
                return `${seg.color} ${start}% ${end}%`;
              })
              .join(', ')})`
          }}
        >
          {/* Segment Labels */}
          {settings.game_segments.map((seg, i) => {
            const angle = (i / settings.game_segments.length) * 360 + (180 / settings.game_segments.length);
            const radius = 35;
            const x = 50 + radius * Math.cos((angle - 90) * Math.PI / 180);
            const y = 50 + radius * Math.sin((angle - 90) * Math.PI / 180);
            return (
              <div
                key={i}
                className="absolute text-xs font-black text-white"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`
                }}
              >
                {seg.label}
              </div>
            );
          })}
        </div>

        {/* Pointer */}
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-2">
          <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[24px] border-l-transparent border-r-transparent border-t-white drop-shadow-lg"></div>
        </div>

        {/* Center Button */}
        <button
          onClick={handleSpin}
          disabled={!canSpin}
          className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full font-black text-sm uppercase tracking-wider shadow-lg transition-all ${
            canSpin
              ? 'bg-white text-purple-600 hover:scale-110 active:scale-95'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isSpinning ? '...' : cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'SPIN'}
        </button>
      </div>

      {/* Cost Info */}
      <div className="text-center text-sm opacity-90 mb-4">
        Cost: ₱{settings.game_cost_per_spin} per spin
      </div>

      {/* Redeem Button */}
      {credits > 0 && (
        <button
          onClick={() => setShowRedeemModal(true)}
          className="w-full bg-white text-purple-600 font-black uppercase tracking-wider py-3 rounded-lg hover:bg-purple-50 transition-colors"
        >
          Redeem Credits for Time
        </button>
      )}

      {/* Result Modal */}
      {showResult && lastPrize && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center">
            <div className="text-6xl mb-4">
              {lastPrize.value > 0 ? '🎉' : '😔'}
            </div>
            <h3 className="text-2xl font-black text-slate-900 mb-2">
              {lastPrize.value > 0 ? 'You Won!' : 'Try Again!'}
            </h3>
            {lastPrize.value > 0 && (
              <div className="text-4xl font-black text-purple-600 mb-4">
                ₱{lastPrize.value}
              </div>
            )}
            <button
              onClick={() => setShowResult(false)}
              className="w-full bg-purple-600 text-white font-black uppercase tracking-wider py-3 rounded-lg hover:bg-purple-700 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Redeem Modal */}
      {showRedeemModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-xl font-black text-slate-900 mb-4 text-center">
              Redeem Credits
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Amount (₱1 = ~3 minutes)
              </label>
              <input
                type="number"
                min={1}
                max={credits}
                value={redeemAmount}
                onChange={e => {
                  const val = parseInt(e.target.value, 10) || 0;
                  setRedeemAmount(e.target.value);
                  setRedeemMinutes(calculateMinutes(val));
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-purple-500"
                placeholder="Enter amount"
              />
              {redeemMinutes > 0 && (
                <div className="mt-2 text-sm text-purple-600 font-bold">
                  ≈ {redeemMinutes} minutes
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowRedeemModal(false);
                  setRedeemAmount('');
                  setRedeemMinutes(0);
                }}
                className="flex-1 bg-slate-200 text-slate-700 font-bold py-2 rounded-lg hover:bg-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRedeem}
                disabled={!redeemAmount || parseInt(redeemAmount, 10) <= 0}
                className="flex-1 bg-purple-600 text-white font-bold py-2 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Redeem
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
