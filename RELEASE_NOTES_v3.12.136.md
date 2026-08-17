# Release Notes v3.12.136

## 🚨 CRITICAL: Free Internet at 0 Time Fix (Session Expiry Re-Blocking)

**Version:** 3.12.136 (code 168)  
**Release Date:** August 9, 2026

---

## 🐛 Bug Fixes

### Devices With 0 Time Could Keep Internet — No Portal Popup After Time Consumed
- **Fixed: after a device's time was consumed, it could keep browsing the internet freely and the captive portal never popped up again**
- Root cause: when a session first expires, the system stamps `expired_at` and blocks the device. But when the user inserted another coin / used credit, every top-up path added time **without clearing `expired_at`**. The expiry detector only picks sessions with `expired_at IS NULL OR expired_at = 0` — so the second (and later) expiries were never detected, `blockMAC` never ran again, and the device kept its whitelist/DNS-bypass rules forever.

### Changes
- **All session top-up paths now reset `expired_at = NULL`** when adding time:
  - Coin insert API (token match, MAC match, upsert)
  - Credit-based purchase (all 3 session-update branches)
  - NodeMCU coin listener paths
  - Rewards/redeem time, admin device connect, free-internet claim
  - Cloud/roaming sync (`edge-sync.js`) — conditional reset only when synced time is positive
- **Startup repair sweep**: 20s after boot, the system scans the firewall NAT table for stale whitelist (DNS-bypass) rules belonging to MACs whose session is at 0 time and re-blocks them — this instantly repairs devices that are leaking internet right now, without waiting for their next coin insert
- Expiry flow after the fix: time reaches 0 → session detected → `blockMAC` (whitelist removed, DNS hijacked to portal, conntrack flushed) → `session-expired` socket event → portal popup ✅

---

## 📊 Technical Details

### Files Modified
- `server.js` — `expired_at = NULL` on 12 session top-up UPDATE statements; startup whitelist-repair sweep in `startBackgroundTimers()`
- `lib/edge-sync.js` — 4 roaming/cloud sync UPDATEs reset `expired_at` conditionally (`CASE WHEN remaining > 0`)

### Database
- No schema changes required

### Backward Compatibility
- ✅ First-time expiry behavior unchanged
- ✅ Pause/resume, roaming, token migration flows unchanged
- ✅ Whitelisted devices without session rows (rentals/NodeMCU) are untouched by the startup sweep
- ✅ No breaking changes to any API

---

## 🚀 Upgrade Instructions

1. **Download update via admin panel** or manually:
   ```bash
   cd /root
   pm2 stop rjd-pisowifi
   ```
2. **Install update:**
   ```bash
   ./install.sh RJD-PisoWiFi-v3.12.136-Update.nxs
   ```
3. **Start system:**
   ```bash
   pm2 start rjd-pisowifi
   ```
4. **Verify:**
   ```bash
   pm2 logs rjd-pisowifi --lines 50
   ```

---

## 🧪 Testing Checklist

- [ ] Device buys time → internet works
- [ ] Time reaches 0 → internet cut, portal popup appears
- [ ] **Same device buys time AGAIN → internet works**
- [ ] **Second time reaches 0 → internet cut again, portal popup appears again** (the regression case)
- [ ] Repeat 3+ charge/expire cycles on the same device
- [ ] After reboot, `pm2 logs` shows `[SESSION] STARTUP-FIX: Re-blocking ...` for any previously-leaking devices and those devices lose internet
- [ ] Paused sessions and rental devices unaffected

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
