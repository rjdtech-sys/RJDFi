# Release Notes v3.12.120

## 🎮 Games & Rewards System

**Version:** 3.12.120 (code 152)  
**Release Date:** August 5, 2026

---

## ✨ New Features

### Spin & Win Game
- **Integrated spin-the-wheel game** in the portal
- Users spend credits to spin and win prizes
- Prizes: ₱10, ₱25, ₱50, ₱100, ₱200, or "Try Again"
- Configurable cost per spin (default: ₱5)
- Cooldown system to prevent spam (default: 5 minutes)
- Daily spin limit per player (default: 20 spins)
- Weighted prize probability (admin configurable)

### Enhanced Rewards System
- **Remainder tracking** for purchase rewards
- Credits accumulate across multiple sessions
- Example: Insert ₱10 → pending ₱10 → Insert ₱10 → earn ₱1 credit
- No more lost rewards from partial thresholds
- Lifetime tracking of total rewards earned

### Credit Redemption
- Redeem credits for internet time
- Uses existing pricing rates (₱1 = ~3 minutes)
- Partial redemption allowed (spend only what you need)
- Credits survive MAC changes (token-based storage)

---

## 🔧 Improvements

### Admin Dashboard
- **Renamed:** "Rewards" → "Games & Rewards" (🎮 icon)
- New game settings section
- Wheel segment editor (add/remove prizes, adjust weights & colors)
- Statistics dashboard:
  - Total spins today
  - Credits awarded today
  - Credits redeemed today
  - Active players (last 7 days)

### Database Schema
- Added `pending_reward_amount` column to `wifi_devices`
- Added `total_rewards_earned` column to `wifi_devices`
- New table: `player_credits` (token-based credit storage)
- New table: `game_spins` (audit trail)
- New config entries for game settings

### API Endpoints
- `GET /api/game/balance` — Get player credit balance
- `POST /api/game/spin` — Spin the wheel
- `POST /api/game/redeem` — Redeem credits for time
- `GET /api/game/settings` — Admin: Get game config
- `POST /api/game/settings` — Admin: Save game config
- `GET /api/game/stats` — Admin: Get statistics

---

## 🐛 Bug Fixes

### Rewards Calculation
- **Fixed:** Rewards now track pending amounts across sessions
- **Before:** Only calculated from single transaction (₱25 → 1 point, ₱5 lost)
- **After:** Accumulates remainder (₱25 → 1 point, ₱5 pending toward next)

---

## 📊 Technical Details

### Files Modified
- `lib/db.js` — Added new tables and columns
- `server.js` — Added 6 game API endpoints, fixed rewards logic
- `components/Admin/RewardsSettings.tsx` — Expanded with game settings
- `components/Portal/SpinWheel.tsx` — New React component (created)
- `public/index.html` — Added game container
- `public/js/portal.js` — Added game initialization
- `App.tsx` — Updated sidebar label

### Database Migration
- Automatic migration on first run
- No manual intervention required
- Backward compatible with existing data

### Backward Compatibility
- ✅ Existing sessions continue working
- ✅ Existing credits preserved
- ✅ No breaking changes to API
- ✅ Old rewards config still works

---

## 🎯 How It Works

### For Users
1. **Insert coins** → Earn credits (₱20 = ₱1 credit)
2. **Accumulate credits** → Remainder carries over
3. **Play game** → Spend ₱5 to spin wheel
4. **Win prizes** → ₱10 to ₱200 credits
5. **Redeem** → Convert credits to internet time

### For Admin
1. Go to **Games & Rewards** (🎮 icon in sidebar)
2. Enable/disable game
3. Configure cost, cooldown, daily limit
4. Edit wheel segments (prizes, weights, colors)
5. View statistics
6. Configure purchase rewards

---

## 🔒 Security & Anti-Abuse

- Server-side validation for all game actions
- Cooldown enforcement (prevents rapid spins)
- Daily spin limit per player
- Balance check before spin
- Token-based authentication
- Audit trail for all spins

---

## 📝 Configuration

### Default Game Settings
```json
{
  "game_enabled": false,
  "game_cost_per_spin": 5,
  "game_cooldown_ms": 300000,
  "game_daily_spin_limit": 20,
  "game_segments": [
    {"label": "₱10", "value": 10, "weight": 40, "color": "#3b82f6"},
    {"label": "₱25", "value": 25, "weight": 25, "color": "#22c55e"},
    {"label": "₱50", "value": 50, "weight": 15, "color": "#eab308"},
    {"label": "₱100", "value": 100, "weight": 10, "color": "#ef4444"},
    {"label": "₱200", "value": 200, "weight": 5, "color": "#a855f7"},
    {"label": "Try Again", "value": 0, "weight": 5, "color": "#6b7280"}
  ]
}
```

### Default Rewards Settings
```json
{
  "enabled": false,
  "thresholdPesos": 20,
  "rewardCreditPesos": 1
}
```

---

## 🚀 Upgrade Instructions

1. **Backup your database** (recommended)
2. **Download update:**
   ```bash
   cd /root
   pm2 stop rjd-pisowifi
   ```
3. **Install update:**
   ```bash
   ./install.sh RJD-PisoWiFi-v3.12.120-Update.nxs
   ```
4. **Start system:**
   ```bash
   pm2 start rjd-pisowifi
   ```
5. **Verify:**
   ```bash
   pm2 logs rjd-pisowifi --lines 50
   ```

---

## 🧪 Testing Checklist

- [ ] Insert ₱10 → check pending amount in database
- [ ] Insert ₱10 again → verify ₱1 credit earned
- [ ] Enable game in admin → verify spin wheel appears in portal
- [ ] Spin wheel → verify credits deducted
- [ ] Win prize → verify credits added
- [ ] Redeem credits → verify time added to session
- [ ] Check statistics in admin dashboard
- [ ] Test cooldown (try spinning again immediately)
- [ ] Test daily limit (spin 20 times)

---

## 📞 Support

For issues or questions:
- Check PM2 logs: `pm2 logs rjd-pisowifi`
- Verify database: `sqlite3 pisowifi.sqlite "SELECT * FROM player_credits"`
- Check game spins: `sqlite3 pisowifi.sqlite "SELECT * FROM game_spins ORDER BY spun_at DESC LIMIT 10"`

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community

**Full changelog:** https://github.com/your-repo/commits/v3.12.120
