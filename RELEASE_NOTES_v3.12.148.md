# RELEASE NOTES v3.12.148 (Code 180)

## Combined Bandwidth Display & ECMP Pool Visibility

This release adds a visual indicator showing the combined bandwidth from all active WANs, and a detailed ECMP pool status showing which WANs are actively participating in load balancing.

### New: Combined Bandwidth Display

**What it shows:**
- Total available bandwidth from all alive WANs (e.g., "1G" if you have two 500Mbps links)
- Number of active WANs currently in the ECMP pool
- Per-WAN status: speed, weight, and whether it's "IN POOL" or "REMOVED"

**Why it helps:**
- You can immediately see if both ISPs are being used
- If a WAN shows "REMOVED", it means the health check is failing (no internet on that WAN)
- Weights are displayed so you can verify the distribution ratio

### How ECMP Load Balancing Works

ECMP (Equal-Cost Multi-Path) distributes traffic **per-connection** using kernel-level hashing:
- A single TCP connection (e.g., one download) uses **one WAN**
- Multiple simultaneous connections are spread across all active WANs
- Weights control the ratio (e.g., w2 gets 2x the traffic of w1)

**To test combined speed:**
1. Open multiple browser tabs to different sites
2. Or use a multi-threaded download manager
3. Or run multiple speed tests simultaneously

A single speed test will only use one WAN. To see combined bandwidth, you need multiple concurrent connections.

### Requirements for Combined Speed

1. **Multi-WAN topology must be enabled** — select "Multi-WAN" and save
2. **Both WANs must be enabled** — check the "Enable" checkbox for each
3. **Both WANs must pass health checks** — if a WAN shows "DEAD" or "REMOVED", it's not being used
4. **Both WANs must have gateways** — auto-detected for DHCP, or manually configured for static

### Troubleshooting

If a WAN is not in the pool:
- Check the health monitor — if ping targets are 0/3, the WAN has no internet
- Verify the gateway is correct (check your ISP router)
- Ensure the interface has an IP address (shown in the WAN card)
- Check that the subnet doesn't overlap with the hotspot subnet
