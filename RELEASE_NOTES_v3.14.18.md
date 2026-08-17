# RELEASE NOTES v3.14.18 (Code 204)

## Major Performance & CPU Fixes

This release addresses two critical system-level issues: (1) the system hanging with massive CPU usage when 200+ VLANs are configured, and (2) unnecessary CPU load from GPIO always polling even when no client is waiting for coin insertion. Both are now resolved with dramatic process-spawning reductions.

---

## Fix 1: 200+ VLAN CPU Hang — Batch iptables & Legacy Code Removal

### Problem

Background timers (`expiredGuardTimer`, `tcCleanupTimer`) and the `removeSpeedLimit()` function were spawning hundreds of `fork/exec` shell processes per cycle. With 200+ VLANs, this resulted in **5,000+ processes per minute**, completely overwhelming the ARM CPU on Orange Pi and causing the system to hang.

### Root Cause

- `expiredGuardTimer` called `iptables -C` per MAC per check — each call spawns a process
- `tcCleanupTimer` called `tc filter show` 3 times per interface, and called `removeSpeedLimit()` for every inactive session regardless of whether QoS marks existed
- `removeSpeedLimit()` scanned all VLAN interfaces, ran legacy IFB/WAN/bridge cleanup, and re-detected the WAN device on every call

### Fixes Applied

**File: `server.js` — expiredGuardTimer (Phase 1 & 2)**
- Replaced per-MAC `iptables -C` checks with a single batch `iptables-save` dump at the top of each timer cycle
- Parsed whitelisted and forward-reject MAC sets in memory using regex
- Eliminated duplicate iptables-save calls between Phase 1 and Phase 2 of the guard loop

**File: `server.js` — tcCleanupTimer**
- Added batch mangle table check (`iptables-save -t mangle`) — only call `removeSpeedLimit()` for IPs that actually have QoS marks
- Throttled TC orphan scan from every 60s to every 5 minutes
- Reduced from 3 `tc filter show` calls per interface to 1

**File: `lib/network.js` — removeSpeedLimit()**
- Removed legacy IFB cleanup (4 processes per call)
- Removed legacy WAN/bridge cleanup (8 processes per call)
- Removed legacy VLAN scan that iterated all VLAN interfaces (1 + 3×N processes where N = number of VLANs)
- Added 30-second TTL cache for WAN interface detection (`_cachedWanDev`, `_cachedBridgeMaster`)

### Result

Process spawning reduced from **~5,000+/min to ~75/min** — a **98% reduction**. The system no longer hangs with 200+ VLANs.

---

## Fix 2: GPIO On-Demand Activation — Zero Idle CPU Usage

### Problem

GPIO coin detection was always active (polling or interrupt-watching) even when no portal client had pressed the INSERT COIN button. This wasted CPU cycles and could accept stray coin pulses that no one was expecting.

### Solution

GPIO now starts **paused** on boot. It only activates when a portal client presses INSERT COIN, and pauses when the coin modal closes.

**File: `lib/gpio.js`**
- Added `pauseGPIO()`, `resumeGPIO()`, `isGPIOPaused()` functions
- Both polling and interrupt modes now start with `_gpioPaused = true`
- When paused: polling stops scheduling new reads, interrupt watcher ignores edges
- When resumed: polling restarts at the appropriate rate, interrupt watcher re-enables

**File: `server.js`**
- Added reference counter `_gpioActiveClients` for multi-client support
- Added Socket.IO handlers: `gpio-resume`, `gpio-pause`, `disconnect` (cleanup on disconnect)
- Added `_notifyNodeMCUListening()` helper — sends HTTP GET to each NodeMCU device's `/api/listening` endpoint
- Auto-pauses GPIO after `initGPIO()` completes as a safety net

**File: `public/js/portal.js`**
- `startCoinDetection()` emits `gpio-resume` after socket listeners are set up
- `stopCoinDetection()` emits `gpio-pause` before socket disconnect

---

## Fix 3: NodeMCU Firmware v2.1 — On-Demand Pulse Gating

### Problem

NodeMCU devices were always detecting and reporting coin pulses, even when no portal client was waiting for payment.

### Solution

**File: `firmware/NodeMCU_ESP8266/NodeMCU_ESP8266.ino`**
- Added `volatile bool isListening = false` flag
- Added `/api/listening?state=true|false` HTTP endpoint for the server to control listening state
- ISR (interrupt service routine) now checks `isListening` — ignores coin pulses when not listening
- Main loop also checks `isListening` before sending pending pulses to the server
- Firmware version bumped to `2.1`

### Behavior

| State | Coin Pulses Detected? | Pulses Sent to Server? |
|-------|----------------------|----------------------|
| `isListening = false` (idle) | No | No |
| `isListening = true` (INSERT COIN pressed) | Yes | Yes |

---

## Files Changed

| File | Changes |
|------|---------|
| `server.js` | expiredGuardTimer batch iptables, tcCleanupTimer optimization, GPIO pause/resume Socket.IO handlers, `_notifyNodeMCUListening()` helper |
| `lib/gpio.js` | `pauseGPIO()`, `resumeGPIO()`, `isGPIOPaused()`, both modes start paused |
| `lib/network.js` | `removeSpeedLimit()` legacy code removal, WAN interface caching |
| `public/js/portal.js` | `gpio-resume`/`gpio-pause` socket emissions in coin detection flow |
| `firmware/NodeMCU_ESP8266/NodeMCU_ESP8266.ino` | v2.1 — `isListening` flag, `/api/listening` endpoint, ISR/loop gates |
| `metadata.json` | version_code 203→204, version_name 3.14.17→3.14.18 |
| `package.json` | version 3.14.17→3.14.18 |

---

## Upgrade Notes

- **No database migration required** — all changes are backward-compatible
- **NodeMCU OTA**: After updating the server, push firmware v2.1 to your NodeMCU devices via the admin panel OTA update
- Existing installations will immediately benefit from the CPU reduction — no reboot required
