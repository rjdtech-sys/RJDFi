# Release Notes v3.12.127

## 🛡️ Anti-Tethering, Coin Log Fix & Multi-WAN UI Fix

**Version:** 3.12.127 (code 159)  
**Release Date:** August 6, 2026

---

## ✨ New Features

### Anti-Tethering (TTL Rules)
- **New card on Network Settings page** — "Anti-Tethering"
- Prevents clients from sharing internet via tethering/hotspot
- Uses iptables mangle table to set TTL on outgoing packets per portal segment
- Configurable TTL value (default: 64)
- Select which portal interfaces to apply rules to
- Auto-detects if `iptables-persistent` is installed; provides Install button if missing
- Rules persist across reboots via `netfilter-persistent save`
- Apply / Remove toggle with real-time status display

---

## 🔧 Improvements

### Coin Detection Log — MAC → Name Resolution
- **Slot column now shows NodeMCU device friendly names** instead of raw MAC addresses
- Server-side auto-resolution: `addCoinLogEntry` looks up `nodemcu_devices` table by MAC and stores `slot_name`
- Client-side fallback: Analytics page uses existing `vendoNameMap` cache for entries without `slot_name`
- Applies to both real-time socket events and historical log entries

### Multi-WAN Configure Button Fix
- **Configure button on system WAN card now opens Edit/Configure modal** instead of Add WAN modal
- Smart routing: if WAN already exists in DB → opens Edit modal with pre-filled data
- If system WAN is not yet in DB → opens dedicated Configure modal with read-only interface name
- New `handleConfigureSave` function handles both create and update flows
- Add WAN remains as a separate button/modal — no confusion between adding and editing

---

## 📊 Technical Details

### Files Modified
- `lib/network.js` — Added 4 anti-tethering functions + restore hook in `restoreNetworkConfig()`
- `server.js` — Added 4 anti-tethering API endpoints; made `addCoinLogEntry` async with MAC resolution; fixed `handleConfigureDefaultWan`
- `lib/api.ts` — Added 4 anti-tethering API client methods
- `components/Admin/NetworkSettings.tsx` — Added Anti-Tethering UI card with install/apply/remove controls
- `components/Admin/Analytics.tsx` — Updated Slot column to use `vendoNameMap` fallback for MAC resolution
- `components/Admin/MultiWanSettings.tsx` — Separated Configure from Add WAN; added Configure modal + `handleConfigureSave`

### API Endpoints Added
- `GET /api/network/anti-tethering/status` — Get anti-tethering state + iptables-persistent status
- `POST /api/network/anti-tethering/install` — Install iptables-persistent package
- `POST /api/network/anti-tethering/apply` — Apply TTL rules (body: `{ ttl, interfaces }`)
- `DELETE /api/network/anti-tethering` — Remove TTL rules and clear config

### Database
- Anti-tethering config stored in `config` table as JSON (`key = 'anti_tethering'`)
- No schema changes required

### Backward Compatibility
- ✅ Existing sessions continue working
- ✅ Coin log entries without `slot_name` resolved client-side via `vendoNameMap`
- ✅ Multi-WAN Add/Edit flows unchanged
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
   ./install.sh RJD-PisoWiFi-v3.12.127-Update.nxs
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

- [ ] Network Settings → Anti-Tethering card visible
- [ ] Select portal interface, set TTL, click Apply → verify iptables rules added
- [ ] Reboot → verify rules restored automatically
- [ ] Remove anti-tethering → verify rules cleared
- [ ] Analytics → Coin Detection Log → verify Slot column shows device names (not MACs)
- [ ] Multi-WAN → System WAN card → Configure opens edit modal (not Add modal)
- [ ] Multi-WAN → + Add WAN still opens Add modal correctly

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
