# RELEASE NOTES v3.12.149 (Code 181)

## Fix: Multi-WAN Sandbox Chains Flushed by initFirewall()

This release fixes a critical bug where the Multi-WAN module's iptables sandbox chains (RJD_MW_NAT, RJD_MW) were being flushed by `initFirewall()` during network restoration and never re-created, causing hotspot devices to lose internet connectivity.

### Root Cause

The startup sequence was:
1. `multiwan.init()` creates RJD_MW_NAT and RJD_MW chains
2. `initFirewall()` runs during network restoration and flushes ALL iptables rules (`iptables -F`, `iptables -X`, etc.)
3. This deletes the multiwan module's sandbox chains
4. `initFirewall()` adds MASQUERADE rules directly to POSTROUTING (for enabled WANs)
5. But it doesn't re-create the multiwan module's sandbox chains
6. Result: No mangle rules (no connection stickiness), no proper NAT chain structure

### Fix: Re-create Sandbox Chains in apply()

The `apply()` function now calls `ensureChains()` at the start, before adding any NAT or mangle rules. This ensures the sandbox chains exist even if `initFirewall()` flushed them earlier.

**File:** `lib/multiwan.js`
```js
async function apply(config) {
  // ...
  
  // CRITICAL: Re-create sandbox chains if they were flushed by initFirewall()
  await ensureChains();
  
  // ... rest of apply logic
}
```

### Fix: Remove Duplicate Default Routes

The DHCP client adds default routes with metrics 1002/1003 for each WAN interface. These are redundant with the ECMP route and could cause routing confusion. The `replaceEcmpRoute()` function now flushes all default routes before applying the ECMP route.

**File:** `lib/multiwan.js`
```js
async function replaceEcmpRoute(nexthops) {
  // Remove DHCP-added default routes (metric 1002, 1003, etc.) to avoid conflicts
  await run('ip route flush default 2>/dev/null');
  
  let cmd = 'ip route replace default scope global';
  // ...
}
```

### What This Fixes

1. **Hotspot devices with valid sessions but no internet** — The missing mangle rules meant no connection stickiness, causing some connections to be routed to the wrong WAN
2. **Missing NAT chain structure** — The RJD_MW_NAT chain is now properly created and populated
3. **Duplicate default routes** — Only the ECMP route remains, no redundant DHCP-added routes

### Verification

After updating, run on your Ubuntu PC:
```bash
# Check that RJD_MW_NAT chain exists
iptables -t nat -L RJD_MW_NAT -n -v

# Check that mangle PREROUTING has the RJD_MW jump
iptables -t mangle -L PREROUTING -n -v | head -5

# Check that only the ECMP route exists (no duplicate routes)
ip route show default
```

Expected output:
- `RJD_MW_NAT` chain should exist with MASQUERADE rules for each WAN
- `PREROUTING` mangle chain should have a jump to `RJD_MW` at position 1
- `ip route show default` should show only the ECMP route (no metric 1002/1003/10000 routes)
