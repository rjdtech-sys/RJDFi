# Release Notes v3.12.110 (Build 142)

**Release Date:** August 5, 2026  
**Version:** 3.12.110  
**Build Code:** 142

## 🎯 Highlights

This release delivers a **complete refactor of the Multi-WAN system** with a Linux-native ECMP architecture. The hotspot captive portal, DNS hijack, and firewall rules are now fully isolated from Multi-WAN operations — eliminating the critical bug where enabling or changing Multi-WAN settings would disconnect all hotspot clients.

---

## ✨ New Features

### Multi-WAN Health Monitor
- **Ping-Based Health Checks**: Each WAN is now verified against 3 internet targets (8.8.8.8, 1.1.1.1, 9.9.9.9) every 5 seconds
  - Dead WANs are automatically removed from the ECMP routing pool
  - Recovered WANs are automatically added back — zero manual intervention
  - Threshold-based detection (3 consecutive failures = dead) prevents false positives

- **Real-Time Health Dashboard**: Admin UI now shows live per-WAN health status
  - Alive/Dead indicator with glowing dot
  - Ping latency (ms), target hit ratio, and fail streak count
  - Updates via Socket.IO every 5 seconds — no page refresh needed

### ECMP-Only Load Balancing
- **Simplified Mode Selection**: Removed PCC (Per-Connection Classifier) mode entirely
  - ECMP (Equal-Cost Multi-Path) is now the only load balancing mode
  - Kernel-level per-flow hashing provides better distribution than the old PCC implementation
  - Eliminates the broken `ip rule pref 100` that was preventing PCC from working

---

## 🔧 Improvements & Optimizations

### Multi-WAN Architecture (lib/multiwan.js)
- **New Dedicated Module**: All Multi-WAN logic extracted from `server.js` into `lib/multiwan.js` (676 lines)
  - Clean separation of concerns — Multi-WAN is now self-contained
  - Easier to maintain, test, and extend

- **Sandbox iptables Chains**: Multi-WAN now operates in its own isolated chains (`RJD_MW_NAT`, `RJD_MW`)
  - Never touches `initFirewall()` rules — hotspot is completely unaffected
  - NAT MASQUERADE rules added/removed incrementally per WAN — no more bulk delete + rebuild
  - Zero NAT blackout window when changing Multi-WAN settings

- **Atomic Route Operations**: ECMP default route uses `ip route replace` (single kernel call)
  - No gap between deleting old route and adding new route
  - Fallback route with `metric 10000` as safety net if ECMP breaks

- **Event-Driven Nexthop Management**: Health monitor only adjusts changed nexthops
  - Dead WAN → remove only that nexthop (atomic replace)
  - Recovered WAN → add it back (atomic replace)
  - Never triggers a full routing rebuild — no hotspot disruption

### Legacy Cleanup
- **Automatic PCC Rule Removal**: On startup, old PCC ip rules, routing tables, and `RJD_MULTIWAN` chain are automatically cleaned up
  - Removes `fwmark` rules at pref 32765 for tables 101-110
  - Removes broken `pref 100 lookup main` rule
  - Flushes and deletes old `RJD_MULTIWAN` mangle chain

### Server.js Cleanup
- Removed ~227 lines of old inline Multi-WAN code (`applyMultiWanConfig`, `monitorMultiWanHealth`, `mwHealthTimer`)
- All Multi-WAN operations now go through `multiwan.apply()`, `multiwan.init()`, `multiwan.teardown()`
- New `GET /api/multiwan/health` API endpoint for health status

---

## 🐛 Bug Fixes

### Critical Fixes
- **Fixed hotspot disconnection on Multi-WAN changes**: The root cause was `applyMultiWanConfig()` deleting ALL NAT MASQUERADE rules before rebuilding them, creating a 200-500ms window where hotspot clients had no NAT. Now uses incremental sandbox chain operations — zero blackout.
- **Fixed PCC mode not working**: The `ip rule pref 100 lookup main` rule was intercepting all traffic before the fwmark rules at pref 32765. Removed entirely — ECMP doesn't need ip rules.
- **Fixed health monitor causing repeated hotspot drops**: Old 30s timer called full `applyMultiWanConfig()` on any status change, triggering the same NAT blackout. New health monitor only adjusts individual nexthops.
- **Fixed dead WAN receiving traffic**: Old `getWanStatus()` only checked link state + IP, not actual internet connectivity. New ping-based health checks verify real internet access.
- **Fixed ECMP route with dead nexthop**: Old code did full routing rebuilds. New code atomically replaces the ECMP route with only alive nexthops.

### UI Fixes
- Fixed TypeScript type errors in WanTrafficMonitor component
- Removed non-functional PCC mode selector and PCC classifier from UI

---

## 📊 Technical Details

### Files Changed
| File | Change |
|------|--------|
| `lib/multiwan.js` | **NEW** — 676 lines. Full Multi-WAN module with ECMP, ping health, sandbox chains |
| `server.js` | Removed ~227 lines of old Multi-WAN code, replaced with `multiwan.*` calls, added health API |
| `components/Admin/MultiWanSettings.tsx` | Removed PCC UI, added health monitor panel with Socket.IO |
| `lib/network.js` | **No changes** — `initFirewall()` stays exactly as-is |

### What is NOT Changed
- `initFirewall()` — completely untouched
- Captive portal redirect rules — untouched
- DNS hijack rules — untouched
- `nat POSTROUTING` rules from `initFirewall` — untouched
- `FORWARD` chain policy — untouched
- `dnsmasq` — untouched
- PPPoE server — untouched
- All hotspot client handling — untouched

### Build Information
- **Total Files in Update**: 116 files
- **Update Package Size**: 0.50 MB
- **Update Format**: `.nxs` (RJD PisoWiFi Update Package)

---

## 🔄 Upgrade Notes

### For Existing Installations
- This update will automatically apply to machines running any version below build code 142
- Machines already on v3.12.110 (code 142) will see "Already up to date"
- On first boot after update, legacy PCC rules are automatically cleaned up

### Recommended Actions After Update
1. Verify Multi-WAN health monitor shows correct alive/dead status for each WAN
2. Test enabling/disabling Multi-WAN — hotspot clients should NOT lose internet
3. Confirm traffic graph still works in the Multi-WAN traffic monitor
4. If previously using PCC mode, verify ECMP load balancing is distributing traffic correctly

---

## 🎓 Notes

This release addresses the most critical Multi-WAN bug: hotspot clients losing internet when Multi-WAN settings change. The root cause was a "scorched earth" approach where ALL NAT rules were deleted and rebuilt on every config change. The new architecture uses isolated iptables chains and incremental operations, ensuring the hotspot's firewall rules are never touched by Multi-WAN.

The removal of PCC mode simplifies the system significantly. The old PCC implementation was broken (ip rule priority conflict) and ECMP provides superior load balancing at the kernel level with per-flow hashing. This is the standard approach used by enterprise Linux routers.

---

**Build System**: RJD PisoWiFi Update System  
**Upload Status**: ✅ Successfully uploaded to Supabase Storage  
**Distribution**: Available for automatic update on all connected machines
