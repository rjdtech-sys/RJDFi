# Release Notes v3.12.138

## 🚨 CRITICAL: Self-Healing Session Blocking — Free Internet at 0 Time Fully Eliminated

**Version:** 3.12.138 (code 170)  
**Release Date:** August 9, 2026

---

## 🐛 Bug Fixes

### Devices With 0 Time Could Still Browse — Blocking Only Applied When Visiting the Portal Manually
- **Fixed: a device whose time reached 0 could keep browsing the internet. The block only took effect when the user manually opened the captive portal in a browser**
- Root cause: the timer-driven block had three silent failure modes that the manual (portal-visit) block did not:
  1. **Stale `expired_at` marker** — the expiry detector only picked up sessions whose marker was clean; any stale marker made the expiry invisible forever
  2. **15-minute `blockMAC` cooldown** — if the same MAC had been blocked recently for any reason, the exact-expiry block was silently skipped
  3. **Leaked whitelist rule** — a leftover paid-bypass NAT rule let the device keep browsing even with 0 time
- The manual portal visit worked because it resolves the device live from ARP and re-applies the block — proof that the timer path was the broken one

### Changes
- **Self-healing firewall reconciliation (every 60 seconds per device)**: for EVERY session at 0 time — regardless of the `expired_at` marker — the system now verifies the actual firewall state with `iptables -C`:
  - Stale whitelist (paid bypass) rule present with 0 time → **force-block** (removes whitelist, re-applies DNS hijack) — log: `[SESSION] GUARD: <MAC> has stale whitelist with 0 time — force-blocking`
  - Missing FORWARD `REJECT` rule → inserted (legacy silent `DROP` replaced automatically)
  - Missing `expired_at` marker → stamped for UI consistency
  - `session-expired` socket event re-emitted to force the portal popup
- **Exact-expiry block is now forced** — the 15-minute cooldown can no longer skip the block at the moment time hits 0
- **Rental protection**: reconciliation skips active rental devices so they are never accidentally cut
- Combined with v3.12.137's `REJECT --reject-with tcp-reset`, OS probes fail instantly → device re-queries DNS → hijacked to portal → **captive portal popup**

---

## 📊 Technical Details

### Files Modified
- `server.js` — `expiredGuardTimer` rewritten as a self-healing reconciliation loop (60s per-MAC verification, ignores stale markers, whitelist-leak detection, force-block); exact-expiry `blockMAC` now forced
- `lib/network.js` — `blockMAC(mac, ip, force)` — new `force` parameter bypasses the 15-minute cooldown for verified-missing rules

### Database
- No schema changes required

### Backward Compatibility
- ✅ Paid devices unaffected — `whitelistMAC` removes all block rules on payment
- ✅ Rental and NodeMCU devices without session rows untouched
- ✅ Pause/resume, roaming, voucher, PPPoE flows unchanged
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
   ./install.sh RJD-PisoWiFi-v3.12.138-Update.nxs
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
- [ ] **Do NOT open the portal manually** — wait for time to reach 0
- [ ] Within 60 seconds: internet is cut AND the captive portal popup appears
- [ ] `pm2 logs` shows `[SESSION] EXPIRED: Blocking ...` at 0 time, and `[SESSION] GUARD: ... stale whitelist ...` if a leaked rule was repaired
- [ ] `sudo iptables -S FORWARD | grep <MAC>` shows `-j REJECT --reject-with tcp-reset`
- [ ] `sudo iptables -t nat -S PREROUTING | grep <MAC>` shows NO `-j ACCEPT` and NO `8.8.8.8` rule for the expired device
- [ ] Device buys time again → internet restored instantly
- [ ] Repeat charge/expire cycles 3+ times — always blocked at 0, never free internet
- [ ] Rental devices keep internet as usual

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
