# Release Notes v3.12.113

## Critical Fix: MAC Blocking CPU Spike

### Problem
After database corruption/recovery, all expired sessions lost their `expired_at` markers. The session timer was picking up ALL expired sessions every 5 seconds, causing:
- Hundreds of `blockMAC` calls per minute
- Massive iptables spawning (10+ iptables calls per block)
- Severe CPU load and system slowdown
- Repeated blocking of the same MAC addresses

### Fix
- **Startup batch-mark**: On boot, all stale expired sessions are immediately marked with `expired_at` so the timer query doesn't pick them up
- **Set expired_at BEFORE blockMAC**: Prevents the query from re-selecting the same session even if blockMAC is slow or fails
- **Query LIMIT**: Capped at 10 sessions per timer tick to prevent mass iptables spam
- **Removed redundant hasActive check**: The `NOT EXISTS` subquery already handles this — removing the extra DB query per session cuts CPU work in half
- **Guard timer LIMIT**: Also capped at 20 to prevent similar mass processing

### Changes
- `server.js` — Session timer refactor: startup batch-mark, LIMIT query, expired_at-first ordering
- `server.js` — Guard timer: added LIMIT 20 to expired session query
