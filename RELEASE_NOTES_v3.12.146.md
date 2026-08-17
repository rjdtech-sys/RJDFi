# RELEASE NOTES v3.12.146 (Code 178)

## Multi-WAN Hotspot Detection Fix & Auto-Registration

This release fixes a critical bug where the Multi-WAN feature incorrectly flagged second-ISP WAN interfaces as the hotspot interface, blocking them from being added to the load-balancing pool. It also ensures both ISPs are automatically included in ECMP load balancing without manual configuration.

### Fixed: Second ISP WAN Misidentified as Hotspot

**The Problem:** The system protected any interface with a `10.x` or `192.168.x` IP address, assuming it must be the LAN/hotspot. Since secondary ISPs commonly hand out private IPs via DHCP, the second WAN (e.g., `enp5s0` with IP `192.168.1.4`) was falsely flagged as the hotspot and blocked from Multi-WAN configuration.

**The Fix:** Protection is now based on authoritative sources instead of IP-subnet heuristics:
- Interfaces registered in the `hotspots` database table (your actual hotspot)
- Bridge member ports of protected bridges (so bridged hotspot interfaces stay protected)
- Interfaces actively serving hotspot DHCP (`/etc/dnsmasq.d/rjd_<iface>.conf`)
- Name patterns (`br-lan`, `docker`, `veth`, etc.) and loopback

The old IP-subnet heuristic is kept only as a last-resort fallback when no hotspot is registered, and any interface explicitly registered as a WAN is always exempted from protection.

### Fixed: Default WAN Auto-Registration

**The Problem:** When enabling Multi-WAN, the system only built ECMP routes from WANs registered in the `wan_interfaces` database table. The primary ISP (default route interface) was typically not registered, so enabling Multi-WAN with only the second ISP would drop the primary ISP's route entirely.

**The Fix:** The system now auto-registers the current default-route interface into the WAN pool if it's not already registered and not protected. This ensures both ISPs are included in ECMP load balancing and health-monitored automatically.

### Fixed: UI Shows Correct WAN Status

**The Problem:** Auto-registered WANs showed "No IP" and "DN" (down) in the UI because the database was never updated with live IP/status data.

**The Fix:** On every `apply()` call, the system now queries live IP/status from the OS for all WANs and updates the database, ensuring the UI always reflects the actual state of each interface.

### Hotspot Protection Unchanged

Your hotspot interface remains fully protected:
- The actual hotspot (from the `hotspots` table) is never selectable as a WAN
- Bridge members of the hotspot are protected
- DHCP-serving interfaces are protected
- The Multi-WAN sandbox chains (`RJD_MW_NAT`, `RJD_MW`) never touch hotspot firewall rules

### Requirements

- Multi-WAN topology must be set to "Multi-WAN" in the UI
- Both ISPs must have distinct subnets (no overlap with hotspot subnet)
- Health checks ping 3 targets every 5 seconds per WAN; dead WANs are automatically removed from ECMP
