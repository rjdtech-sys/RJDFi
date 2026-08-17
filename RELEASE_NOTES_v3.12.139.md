# Release Notes v3.12.139

## 🚨 CRITICAL: Universal ARP Guard — ANY Device With No Time Is Blocked & Redirected to Portal

**Version:** 3.12.139 (code 171)  
**Release Date:** August 9, 2026

---

## 🛡️ New Feature

### Universal Guard: Who-Ever Has 0 Time Gets Blocked and Sent to the Captive Portal
- **The guard no longer depends on session records alone.** Every 60 seconds the system scans the live ARP table (every device actually online on the LAN/VLAN) and for EACH device asks: *does it have an active, paid, running session?*
- If **NO** → the device is force-blocked on the spot:
  - Stale whitelist/paid-bypass rules removed
  - DNS hijacked to the portal
  - FORWARD `REJECT --reject-with tcp-reset` applied (all internet dies instantly, OS probes fail fast → **captive portal popup**)
  - `session-expired` event emitted
- This covers three cases the session-only guard could miss:
  1. Devices whose session row is at 0 time
  2. Devices that **never had a session row** at all (connected to Wi-Fi and never paid)
  3. Paused devices (paused = no internet until resumed)

### Safety Exemptions (never blocked by the sweep)
- ✅ Devices with an active, paid, running session (`remaining_seconds > 0`, not paused)
- ✅ Active **rental** devices (phone rental)
- ✅ Registered **NodeMCU coinslots** (they must always reach the server)
- ✅ Anything on a **WAN interface** (default route + configured Multi-WAN list) — the ISP router itself is never touched
- ✅ Payment race-safe: paying always runs `whitelistMAC`, which removes every block rule

---

## 📊 Technical Details

### Files Modified
- `server.js` —
  - New `getArpSnapshotByDevice()` (5s-cached `/proc/net/arp` reader that keeps the interface column)
  - Guard Phase 2 "ARP sweep": WAN exclusion set, per-MAC 60s throttle, session/rental/NodeMCU exemption checks, whitelist-leak detection + force-block, REJECT verification, throttled portal-popup event

### Database
- No schema changes required

### Backward Compatibility
- ✅ v3.12.138 session-based reconciliation kept as Phase 1 (unchanged)
- ✅ Pause/resume: paused devices are correctly blocked; resume restores instantly
- ✅ PPPoE, roaming, voucher flows unchanged
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
   ./install.sh RJD-PisoWiFi-v3.12.139-Update.nxs
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

- [ ] Connect a phone to the Wi-Fi and never pay → within 60s it has no internet and the portal popup appears
- [ ] Pay ₱1 → internet works instantly
- [ ] Wait for 0 time (do NOT open the portal) → within 60s internet is cut and popup appears
- [ ] `pm2 logs` shows `[SESSION] GUARD-ARP: <MAC> (<IP>) online with no time — force-blocking` for leaked devices
- [ ] Insert a coin while at 0 time → internet restores instantly (no re-block race)
- [ ] Rental device keeps internet; NodeMCU coinslot keeps reporting coins
- [ ] Other machines on the ISP router (WAN side) unaffected

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
