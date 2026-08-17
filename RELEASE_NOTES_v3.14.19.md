# RELEASE NOTES v3.14.19 (Code 205)

## Fix: Portal Coinslot Dropdown Not Showing Bound NodeMCU

### Problem

The portal HTML always displayed the notice **"No coinslot is assigned to your area"** even when a NodeMCU/coinslot was properly bound to the client's VLAN. However, inserting coins still worked — the session received time correctly.

### Root Cause

The `availableSlots` array (which populates the coinslot dropdown) was fetched **only once** during portal initialization (`init()`). If the NodeMCU device was not yet online at that moment, the array stayed empty. The `pollSession()` function re-rendered the coinslot selector every 5 seconds but **never re-fetched** the slot list — so the "No coinslot" notice persisted indefinitely.

Coin insertion worked because NodeMCU devices send pulses directly to the server via HTTP, completely independent of the portal's dropdown display.

### Fix

**File:** `public/js/portal.js`

Added `availableSlots = await fetchAvailableSlots(clientVlanId)` inside `pollSession()` before `renderCoinslotSelector()`. Now every 5-second poll cycle refreshes the coinslot list from the server.

```javascript
// Re-fetch available coinslots (VLAN-isolated) — NodeMCU devices may come online after init
if (clientVlanId !== null && clientVlanId !== undefined) {
  availableSlots = await fetchAvailableSlots(clientVlanId);
}

// Re-render dynamic sections
renderCoinslotSelector();
autoSelectSlot();
```

### Result

- Portal now detects NodeMCU devices within seconds of them coming online
- Coinslot dropdown appears correctly when a device is bound to the client's VLAN
- No more false "No coinslot is assigned to your area" notices

---

## Files Changed

| File | Changes |
|------|---------|
| `public/js/portal.js` | Re-fetch `availableSlots` in `pollSession()` before rendering coinslot selector |
| `metadata.json` | version_code 204→205, version_name 3.14.18→3.14.19 |
| `package.json` | version 3.14.18→3.14.19 |

---

## Upgrade Notes

- **No database migration required**
- **No server restart required** — portal JS is served statically
- Clients already connected to the portal will see the fix after a page refresh
