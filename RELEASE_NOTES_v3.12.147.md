# RELEASE NOTES v3.12.147 (Code 179)

## Multi-WAN Null-Safety Fix

This release fixes a 500 error when clicking the Apply button on WAN interfaces. The issue was caused by missing null checks when calling network module functions.

### Fixed: Apply Button 500 Error

**The Problem:** Clicking Apply on a WAN interface could throw a 500 server error if the network module wasn't fully initialized or if certain functions were unavailable.

**The Fix:** Added comprehensive null checks and type validation for all network module function calls in the Multi-WAN module:
- `network.getDefaultRouteInterface()`
- `network.isProtectedInterface()`
- `network.getWanGateway()`
- `network.getWanStatus()`

All calls now verify the function exists before invoking, preventing TypeError exceptions.

### Changes

- `lib/multiwan.js`: Added null checks to all network module calls in `apply()` and `teardown()` functions
- Improved error handling to gracefully skip operations when network functions are unavailable
