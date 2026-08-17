# Release Notes v3.12.135

## 🔌 False Offline Status Fix & Portal Audio Upload Fix

**Version:** 3.12.135 (code 167)  
**Release Date:** August 9, 2026

---

## 🐛 Bug Fixes

### Device Management — False "Offline" Status
- **Fixed: connected devices (especially on VLAN interfaces like `end0.22`) reported as Offline while actually online**
- Root cause: Online status was derived solely from `wifi_devices.last_seen` (90s window), which was only refreshed by manual scans or coin events — no background refresh existed
- New reachability verification in `GET /api/devices`:
  - Stale devices are checked against the live kernel ARP table (cached 5s `/proc/net/arp` read — negligible CPU cost)
  - Match by IP **or** MAC → marked Online immediately
  - Devices with an active session but missing from ARP get a single throttled quick ping (max once per device per 20s) to force an ARP refresh
  - Confirmed devices persist `last_seen` to the DB so subsequent polls stay correct
- No manual "Scan" click needed anymore for accurate Online/Offline badges

### Portal Audio Upload — "Unexpected end of form" Error
- **Fixed: audio uploads in the Portal Editor failing with a busboy `Unexpected end of form` crash**
- Root cause: the global `express-fileupload` middleware (added for GIF/wallpaper uploads) consumed the multipart body stream before the multer-based audio endpoint could parse it
- Added a bypass list so multer-handled routes keep their body stream intact:
  - `/api/admin/upload-audio`
  - `/api/nodemcu/:deviceId/update`
  - `/api/system/restore`
  - `/api/system/update`
- Audio upload endpoint now returns clean JSON errors (400) instead of dumping stack traces into PM2 logs — the Portal Editor shows the actual rejection reason (e.g. file too big, non-audio file)
- Side effect: NodeMCU firmware updates and system restore/update uploads are un-broken as well

---

## 📊 Technical Details

### Files Modified
- `server.js` — Added ARP snapshot + reachability probe helpers; online-status verification loop in `GET /api/devices`; express-fileupload bypass for multer routes; wrapped multer on audio upload with clean error handling

### Database
- No schema changes required

### Backward Compatibility
- ✅ Existing sessions, whitelist/QoS, and scans unchanged
- ✅ Wallpaper/GIF uploads (express-fileupload) continue to work as before
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
   ./install.sh RJD-PisoWiFi-v3.12.135-Update.nxs
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

- [ ] Device Management → connected device with active session shows **Online** without clicking Scan
- [ ] Device on VLAN interface (e.g. `end0.22`) shows correct Online/Offline state over multiple 30s polls
- [ ] Power off a device → shows Offline after ARP entry ages out
- [ ] Portal Editor → upload an audio file → succeeds and appears in the audio list
- [ ] Upload a file >5MB or non-audio → clean error message shown (no PM2 stack trace)
- [ ] Wallpaper/GIF upload still works
- [ ] System Update / Restore uploads still work

---

## 🎉 Credits

Built with ❤️ for the RJD PisoWiFi community
