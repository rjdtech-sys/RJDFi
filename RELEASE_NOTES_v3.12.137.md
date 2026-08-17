# Release Notes v3.12.137

## 🚨 CRITICAL: Captive Portal Popup at 0 Time Fix

**Version:** 3.12.137 (code 169)  
**Release Date:** August 9, 2026

---

## 🐛 Bug Fixes

### Captive Portal Not Popping Up After Time Consumed (0 Time)
- **Fixed: when a device's time reached 0, the internet was cut but the captive portal popup never appeared on the device**
- Root cause: the expired-device guard inserted a **silent FORWARD DROP** rule per MAC. Devices that were previously paid had the REAL IPs of captive-portal probe servers cached (e.g. `connectivitycheck.gstatic.com`, `captive.apple.com`). After expiry, the OS probe still targets that cached real IP → packet traverses FORWARD → **silently dropped → probe times out**. Android/iOS/Windows interpret a timed-out probe as plain "no internet" and never re-check DNS — so the device never sees the hijacked portal DNS, never receives the 302 redirect, and **the portal never pops up**.
- A probe that gets an instant **TCP RST** instead forces the OS to re-evaluate the connection immediately → it re-queries DNS (hijacked to the portal) → HTTP probe gets 302 → **captive portal popup appears** ✅

### Changes
- **Expired-device guard now uses `REJECT --reject-with tcp-reset`** instead of silent `DROP` — instant RST kills all internet for 0-time devices AND triggers OS captive-portal re-detection on Android, iOS, Windows, and macOS
- **Auto-migration**: any legacy silent DROP rule from v3.12.136 and earlier is automatically replaced with the REJECT rule (within 5 minutes of session expiry, no manual cleanup needed)
- **Cleanup on payment**: `whitelistMAC` and `blockMAC` now also remove the REJECT rule, so internet access restores instantly after a top-up

---

## 📊 Technical Details

### Files Modified
- `server.js` — `expiredGuardTimer` now inserts `iptables -I FORWARD -m mac --mac-source <MAC> -j REJECT --reject-with tcp-reset` (replaces legacy DROP)
- `lib/network.js` — `whitelistMAC()` and `blockMAC()` cleanup loops also delete the REJECT rule

### Database
- No schema changes required

### Backward Compatibility
- ✅ Internet cut for 0-time devices unchanged (still fully blocked — Messenger/cached-IP apps included)
- ✅ Paid devices unaffected (whitelist ACCEPT rules are inserted at FORWARD position 1, before the REJECT)
- ✅ Pause/resume, roaming, rental bypass flows unchanged
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
   ./install.sh RJD-PisoWiFi-v3.12.137-Update.nxs
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
- [ ] Time reaches 0 → internet cut immediately
- [ ] **Portal popup appears on the device within ~1 minute** (toggle Wi-Fi off/on if the OS cached the old state for a long time)
- [ ] Opening any browser on the expired device shows the portal
- [ ] Device buys time again → internet restored instantly
- [ ] Repeat charge/expire cycle 3+ times — popup appears every time
- [ ] `sudo iptables -S FORWARD | grep <MAC>` shows `-j REJECT --reject-with tcp-reset` (NOT `-j DROP`) for expired devices

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
