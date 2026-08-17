# Release Notes v3.12.105 (Build 137)

**Release Date:** July 27, 2026  
**Version:** 3.12.105  
**Build Code:** 137

## 🎯 Highlights

This release focuses on **captive portal reliability** and **session management**, with a major improvement to force captive portal popups when session time expires. The network stack has been significantly refactored for better stability and performance.

---

## ✨ New Features

### Session Management
- **Session Expiration Events**: Implemented persistent socket connection to emit expiration events
  - Captive portal now automatically pops up when session time reaches 0
  - Ensures users are immediately notified when their session expires
  - Improves user experience with seamless re-authentication flow

### Analytics
- **Top Vendo Identification**: Added ability to identify top-performing vendo machines by monthly revenue
  - Simplified analytics display to show main vendo performance
  - Removed complex dynamic calculations for better performance

### Device Management
- **NodeMCU Device Filtering**: Registered NodeMCU devices are now automatically excluded from device lists
  - Cleaner device management interface
  - Prevents confusion between user devices and system hardware

### Voucher System
- **Alphanumeric Code Support**: Vouchers now support both numeric and alphanumeric codes
  - Expanded voucher code possibilities
  - Enhanced input validation to prevent errors
  - Fixed activation network errors
  - Prevented double-tap activation to avoid duplicate redemptions

---

## 🔧 Improvements & Optimizations

### Captive Portal
- **DNS Hijack Mode**: Switched firewall to DNS hijack mode for captive portal
  - More reliable captive portal detection
  - Improved redirect behavior across different devices
  - Better compatibility with modern mobile operating systems

- **Portal Serving Logic**: Corrected captive portal and admin panel serving logic
  - Fixed routing issues between portal and admin interfaces
  - Improved request handling and response times

### Network Stack
- **iptables Optimization**: Comprehensive refactoring of MAC whitelist/block handling
  - Added timeout-safe shell command execution to all iptables calls
  - Implemented race condition guards for concurrent operations
  - Reduced code complexity by 170+ lines while improving reliability
  - Optimized iptables rule management for better performance

- **Connection Tracking**: Fixed "valid time but no internet" bug
  - Implemented aggressive conntrack flushing
  - Resolves connectivity issues after session state changes
  - Improves overall network stability

### Portal UI/UX
- **Double-Tap Prevention**: Added safeguards to prevent double-tap coin confirmation
  - Prevents accidental multiple coin insertions
  - Improved input validation and UI feedback
  - Enhanced voucher activation flow

---

## 🐛 Bug Fixes

### Critical Fixes
- Fixed session expiration not triggering captive portal popup
- Resolved "valid time but no internet" connectivity bug
- Fixed captive portal detection issues on various devices
- Corrected admin panel and portal routing conflicts

### Network Fixes
- Fixed race conditions in MAC address blocking/whitelisting
- Resolved iptables timeout issues during high-load scenarios
- Fixed conntrack state management issues
- Improved error handling for network operations

### Voucher Fixes
- Fixed network errors during voucher activation
- Prevented double-tap voucher activation
- Enhanced input validation for alphanumeric codes

---

## 📊 Technical Details

### Files Modified
- **Server**: `server.js` - Session event handling, captive portal logic
- **Network**: `lib/network.js` - Major refactoring of iptables and firewall rules
- **Portal**: `public/js/portal.js` - Session expiration handling, UI improvements
- **Components**: Multiple admin components for device management and analytics
- **Configuration**: `metadata.json`, `package.json` - Version bump to 3.12.105

### Build Information
- **Total Files in Update**: 115 files
- **Update Package Size**: 0.49 MB
- **Update Format**: `.nxs` (RJD PisoWiFi Update Package)

---

## 🔄 Upgrade Notes

### For Existing Installations
- This update will automatically apply to machines running version 3.12.x
- Machines below build code 137 will see "Update Available" notification
- Machines already on v3.12.105 (code 137) will see "Already up to date"

### Recommended Actions After Update
1. Verify captive portal popup behavior on test devices
2. Check session expiration handling with short-duration sessions
3. Confirm network connectivity remains stable after session state changes
4. Test voucher activation with both numeric and alphanumeric codes

---

## 📝 Commit Summary

Recent commits included in this release:
- `5a429fd` - fix(session): emit expiration event and handle with persistent socket
- `6ae2f27` - fix(network): optimize whitelist/block MAC iptables handling
- `73ee534` - refactor(network): add timeout-safe shell command execution
- `5cc1f82` - fix(server): correct captive portal and admin panel serving logic
- `4b860a2` - refactor(network): optimize MAC block and whitelist handling
- `a65b44b` - refactor(network): switch firewall to DNS hijack mode
- `9d70dce` - fix(captive-portal): improve captive portal detection
- `4a7a47a` - feat(devices): exclude registered NodeMCU devices
- `cf9cc6c` - feat(analytics): add top vendo identification
- `030054a` - fix(network): resolve "valid time but no internet" bug
- `205dd71` - feat(voucher): support alphanumeric codes

---

## 🎓 Notes

This release represents a significant improvement to the captive portal system, addressing long-standing issues with session expiration handling and network stability. The DNS hijack mode implementation provides more reliable captive portal detection across a wider range of devices and operating systems.

The network stack refactoring not only improves reliability but also reduces code complexity, making future maintenance easier. The addition of timeout-safe command execution and race condition guards ensures stable operation even under high-load conditions.

---

**Build System**: RJD PisoWiFi Update System  
**Upload Status**: ✅ Successfully uploaded to Supabase Storage  
**Distribution**: Available for automatic update on all connected machines
