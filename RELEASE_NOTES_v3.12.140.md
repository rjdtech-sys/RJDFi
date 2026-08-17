# Release Notes v3.12.140

## 🚨 CRITICAL: Captive Portal Popup Without pm2 Restart — Built-in Portal DNS Responder

**Version:** 3.12.140 (code 172)  
**Release Date:** August 9, 2026

---

## 🐛 Bug Fixes

### Portal Popup Only Appeared After `pm2 restart`
- **Symptom confirmed by logs:** internet was correctly cut at 0 time and the server was receiving the device's probe requests, but the captive portal popup never appeared — UNTIL a full `pm2 restart`, after which the redirect worked
- **Root cause:** `blockMAC` hijacked blocked devices' DNS with a **cross-subnet DNAT to 10.0.0.1:53**. For devices on VLAN segments (e.g. `end0.22` → 10.0.22.x), 10.0.0.1 is on a *different subnet*, and delivery depends on the system dnsmasq's runtime interface bindings — which only become fully correct after a restart (full firewall + DNS re-init). Without a restart, blocked VLAN devices got **no DNS answers at all** → the OS could never re-resolve its probe domains → never hit the portal → **no popup**

### The Fix: Built-in Captive-Portal DNS Responder
- **A lightweight DNS responder now runs inside the Node process on port 5354** (zero external dependencies, no dnsmasq reliance, survives without restart)
- Blocked devices' DNS is now `REDIRECT`ed (local delivery — works on ANY segment/bridge/VLAN) to port 5354
- The responder answers **every query with the device's own /24 gateway IP** — guaranteed locally reachable, and the portal listens there on port 80 → OS probe resolves → HTTP probe → 302 → **popup** ✅
- TTL 10s so devices re-resolve quickly after paying
- **Segment self-heal**: the ARP guard now also verifies each segment has the portal HTTP redirect + DNS + HTTPS-reject rules; segments that missed them (VLANs created after boot) get them added automatically at runtime — previously this only happened on restart

### Changes Summary
- `lib/network.js` — `blockMAC` DNS hijack: `DNAT → 10.0.0.1:53` replaced with `REDIRECT → 5354`; cleanup loops handle both new and legacy rules
- `server.js` — new `startCaptivePortalDns()` responder (port 5354, auto-restart on socket error); ARP guard adds missing per-segment portal rules pointing at the responder

---

## 📊 Technical Details

### Database
- No schema changes required

### Backward Compatibility
- ✅ Paid devices unaffected (their 8.8.8.8 DNS bypass sits at PREROUTING position 1 and matches first)
- ✅ Legacy 10.0.0.1 DNAT rules are cleaned up automatically on every block/whitelist cycle
- ✅ Rentals, NodeMCU coinslots, PPPoE, roaming unchanged
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
   ./install.sh RJD-PisoWiFi-v3.12.140-Update.nxs
   ```
3. **Start system:**
   ```bash
   pm2 start rjd-pisowifi
   ```
4. **Verify:**
   ```bash
   pm2 logs rjd-pisowifi --lines 50
   ```
   You should see: `[CAPTIVE-DNS] Built-in portal DNS responder listening on :5354`

---

## 🧪 Testing Checklist

- [ ] On boot, logs show `[CAPTIVE-DNS] Built-in portal DNS responder listening on :5354`
- [ ] Charge ₱1 on a VLAN device → internet works
- [ ] Let it reach 0 (NO pm2 restart, NO manual portal visit) → internet cut AND **portal popup appears within ~1 minute**
- [ ] Pay again → internet restores instantly
- [ ] Repeat 3+ charge/expire cycles — popup every time, no restart needed
- [ ] A brand-new device that never paid gets the portal popup within ~1 minute of connecting

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
