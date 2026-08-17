# RELEASE NOTES v3.12.141 (Code 173)

## Realtime Fleet Roaming — Time Follows the Client Across All Vendo Machines

This release completes the cross-machine roaming system: a client's paid time (MAC, session token, remaining seconds) is stored both locally and on Supabase, and when the client roams to any of your SBC boards — even behind a different ISP — the remaining time is restored automatically. All sync is designed for minimal CPU usage on the Orange Pi.

### Realtime Cloud → Local (near-zero CPU)
- **Supabase Realtime WebSocket hardened**: roaming subscription now receives INSERT + UPDATE events (`*`), so the moment another machine adopts a session, this machine knows instantly.
- **Auto-resubscribe**: on CHANNEL_ERROR / TIMED_OUT / CLOSED, the subscription reconnects automatically after 10 seconds. No more silently-dead realtime channels after network blips.

### Accurate Time Handoff (new presence-aware engine)
- **Anti double-burn**: when a device leaves this machine for another board, the local session is relinquished (zeroed + token cleared) so time is consumed ONLY on the machine currently serving the device. Previously both machines could burn the same time at 2x rate.
- **Anti double-spend**: the reconciliation pull no longer ignores sessions that reached 0 elsewhere — a client who spends all time on Machine B now gets correctly blocked when returning to Machine A.
- **Top-up convergence**: if a top-up happens on another machine while the device is served here, the extra time is adopted immediately — but the serving machine is never downgraded by stale remote rows.
- **ARP presence check** (5s cached, fail-safe) decides every roaming decision, so a momentary ARP miss can never kill an active session.

### Ownership Stamping
- When this machine restores a roaming session (by MAC or by session token), it immediately pushes to Supabase with its own machine_id — moving the cloud session row to the new owner. The original machine sees the handoff in realtime and lets go.
- Restored sessions now keep the original session token, so token-based roaming works across handoffs.

### Fresh Cloud Data (still CPU-friendly)
- New dedicated **60-second batched session push**: one filtered HTTPS request per minute pushes only meaningfully changed sessions (time delta > 45s, paid change, or state flip). Worst-case cloud staleness drops from ~3 minutes to ~1 minute at under 0.5% CPU.

### CPU Impact
- Idle realtime: WebSocket sits dormant — ~0% CPU.
- Push: 1 small batched request/min. Pull fallback: 1 request per 120s only for locally-active MACs.
- Total roaming overhead: **under ~1% CPU per board** — safe for 20ms coin-pulse detection.

### Requirements
- Supabase Realtime must be enabled for the `wifi_devices` table (Replication) for instant handoffs; without it, the 60–120s reconciliation cycles still keep everything consistent.
