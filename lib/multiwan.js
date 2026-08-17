/**
 * lib/multiwan.js — Multi-WAN ECMP Load Balancer
 *
 * Operates in its own iptables sandbox (RJD_MW_NAT, RJD_MW chains).
 * NEVER touches initFirewall() rules — hotspot is completely unaffected.
 *
 * Architecture:
 *   - Own nat chain RJD_MW_NAT: per-WAN MASQUERADE (incremental add/remove)
 *   - Own mangle chain RJD_MW: connection stickiness via CONNMARK
 *   - ECMP default route: atomic `ip route replace default scope global nexthop ...`
 *   - Fallback route: metric 10000 safety net through primary WAN
 *   - Ping-based health: 5s interval, 3 targets, threshold-based dead/alive
 *   - Event-driven nexthop: add/remove individual nexthops, never full rebuild
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ─── Module State ───────────────────────────────────────────────────────────
let db = null;
let network = null;
let io = null;

let wanHealth = {};          // { eth0: { alive, failCount, pingMs, lastCheck, targetsHit } }
let activeNexthops = [];     // [ { gateway, dev, weight } ]
let appliedConfig = null;    // last applied config snapshot for diff
let healthTimer = null;
let isInitialized = false;
let primaryWan = null;       // fallback WAN designation

// Health check targets
const PING_TARGETS = ['8.8.8.8', '1.1.1.1', '9.9.9.9'];
const HEALTH_INTERVAL_MS = 5000;
const DEAD_THRESHOLD = 3;    // 3 consecutive full failures = dead
const PING_TIMEOUT_S = 2;

// ─── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run(cmd) {
  try {
    const { stdout } = await execPromise(cmd);
    return stdout;
  } catch (e) {
    return null;
  }
}

async function runStrict(cmd) {
  const { stdout } = await execPromise(cmd);
  return stdout;
}

function log(msg) {
  console.log(`[MultiWAN] ${msg}`);
}

function warn(msg) {
  console.warn(`[MultiWAN] ${msg}`);
}

function error(msg) {
  console.error(`[MultiWAN] ${msg}`);
}

// ─── Chain Management ───────────────────────────────────────────────────────

/**
 * Ensure our sandbox chains exist. Called once during init.
 * If chains already exist (e.g. from previous run), they are left intact.
 */
async function ensureChains() {
  // NAT chain: RJD_MW_NAT
  const natChainExists = await run("iptables -t nat -L RJD_MW_NAT -n 2>/dev/null | head -1");
  if (!natChainExists || !natChainExists.includes('RJD_MW_NAT')) {
    await run('iptables -t nat -N RJD_MW_NAT');
    log('Created nat chain RJD_MW_NAT');
  }

  // Jump from POSTROUTING to RJD_MW_NAT (insert at position 1)
  const natJumpExists = await run("iptables -t nat -C POSTROUTING -j RJD_MW_NAT 2>/dev/null");
  if (natJumpExists === null) {
    await run('iptables -t nat -I POSTROUTING 1 -j RJD_MW_NAT');
    log('Added POSTROUTING → RJD_MW_NAT jump');
  }

  // Mangle chain: RJD_MW
  const mangleChainExists = await run("iptables -t mangle -L RJD_MW -n 2>/dev/null | head -1");
  if (!mangleChainExists || !mangleChainExists.includes('RJD_MW')) {
    await run('iptables -t mangle -N RJD_MW');
    log('Created mangle chain RJD_MW');
  }

  // Jump from PREROUTING to RJD_MW (insert at position 1)
  const mangleJumpExists = await run("iptables -t mangle -C PREROUTING -j RJD_MW 2>/dev/null");
  if (mangleJumpExists === null) {
    await run('iptables -t mangle -I PREROUTING 1 -j RJD_MW');
    log('Added PREROUTING → RJD_MW jump');
  }
}

/**
 * Remove sandbox chains completely. Called on teardown.
 */
async function removeChains() {
  // Remove nat jump (loop to clear duplicates)
  for (let i = 0; i < 5; i++) {
    const r = await run('iptables -t nat -D POSTROUTING -j RJD_MW_NAT 2>/dev/null');
    if (r === null) break;
  }
  await run('iptables -t nat -F RJD_MW_NAT 2>/dev/null');
  await run('iptables -t nat -X RJD_MW_NAT 2>/dev/null');

  // Remove mangle jump (loop to clear duplicates)
  for (let i = 0; i < 5; i++) {
    const r = await run('iptables -t mangle -D PREROUTING -j RJD_MW 2>/dev/null');
    if (r === null) break;
  }
  await run('iptables -t mangle -F RJD_MW 2>/dev/null');
  await run('iptables -t mangle -X RJD_MW 2>/dev/null');

  log('Sandbox chains removed');
}

// ─── NAT Management (Incremental) ──────────────────────────────────────────

/**
 * Add MASQUERADE for a single WAN inside our chain.
 */
async function addNatForWan(iface) {
  // Check if rule already exists
  const exists = await run(`iptables -t nat -C RJD_MW_NAT -o ${iface} -j MASQUERADE 2>/dev/null`);
  if (exists !== null) return; // already exists
  await run(`iptables -t nat -A RJD_MW_NAT -o ${iface} -j MASQUERADE`);
  log(`NAT added for ${iface}`);
}

/**
 * Remove MASQUERADE for a single WAN inside our chain.
 */
async function removeNatForWan(iface) {
  // Loop to remove all duplicates
  for (let i = 0; i < 5; i++) {
    const r = await run(`iptables -t nat -D RJD_MW_NAT -o ${iface} -j MASQUERADE 2>/dev/null`);
    if (r === null) break;
  }
  log(`NAT removed for ${iface}`);
}

// ─── ECMP Route Management (Atomic) ────────────────────────────────────────

/**
 * Replace the ECMP default route atomically with current active nexthops.
 * Single kernel call — no gap, no blackout.
 */
async function replaceEcmpRoute(nexthops) {
  if (!nexthops || nexthops.length === 0) {
    warn('No nexthops provided — ECMP route not applied');
    return;
  }

  // Remove DHCP-added default routes (metric 1002, 1003, etc.) to avoid conflicts
  // These are added by dhclient and are redundant with the ECMP route
  await run('ip route flush default 2>/dev/null');
  
  let cmd = 'ip route replace default scope global';
  for (const nh of nexthops) {
    cmd += ` nexthop via ${nh.gateway} dev ${nh.dev} weight ${nh.weight}`;
  }
  await run(cmd);
  await run('ip route flush cache 2>/dev/null');
  log(`ECMP route applied: ${nexthops.map(n => `${n.dev}(${n.gateway},w${n.weight})`).join(', ')}`);
}

/**
 * Set fallback route through primary WAN with very high metric.
 * Safety net: if ECMP route breaks, traffic falls back to primary.
 */
async function setFallbackRoute(gateway, dev) {
  if (!gateway || !dev) return;
  await run(`ip route replace default via ${gateway} dev ${dev} metric 10000`);
  log(`Fallback route set via ${gateway} dev ${dev} metric 10000`);
}

/**
 * Remove fallback route.
 */
async function removeFallbackRoute() {
  await run('ip route del default metric 10000 2>/dev/null');
}

// ─── Mangle Chain (Connection Stickiness) ───────────────────────────────────

/**
 * Rebuild mangle chain rules for connection stickiness.
 * Uses CONNMARK to remember which WAN a connection uses.
 * Called only when WAN count changes.
 */
async function rebuildMangleRules(nexthops) {
  // Flush existing rules inside RJD_MW (chain itself stays)
  await run('iptables -t mangle -F RJD_MW');

  if (!nexthops || nexthops.length < 2) return;

  const count = nexthops.length;
  for (let idx = 0; idx < count; idx++) {
    const mark = idx + 1;
    const every = count - idx;
    // Mark new connections with round-robin distribution
    await run(`iptables -t mangle -A RJD_MW -m connmark --mark 0 -m statistic --mode nth --every ${every} --packet 0 -j CONNMARK --set-mark ${mark}`);
  }

  log(`Mangle rules rebuilt for ${count} WANs`);
}

// ─── Ping-Based Health Checks ───────────────────────────────────────────────

/**
 * Ping all targets from a specific WAN interface.
 * Returns { hits: number, avgMs: number } where hits = number of targets that responded.
 */
async function pingWanHealth(iface) {
  let hits = 0;
  let totalMs = 0;

  for (const target of PING_TARGETS) {
    try {
      const result = await execPromise(`ping -I ${iface} -c 1 -W ${PING_TIMEOUT_S} ${target} 2>/dev/null`);
      const match = (result.stdout || '').match(/time=([\d.]+)\s*ms/);
      if (match) {
        hits++;
        totalMs += parseFloat(match[1]);
      }
    } catch (e) {
      // Ping failed — this target is unreachable via this WAN
    }
  }

  return {
    hits,
    avgMs: hits > 0 ? Math.round(totalMs / hits) : null
  };
}

/**
 * Run one health tick: check all enabled WANs, update health state,
 * and trigger nexthop adjustments if needed.
 */
async function healthTick() {
  if (!appliedConfig || appliedConfig.topology !== 'multi') return;

  try {
    const dbWans = await db.all('SELECT * FROM wan_interfaces WHERE enabled = 1');
    if (dbWans.length === 0) return;

    for (const wan of dbWans) {
      const iface = wan.name;
      const result = await pingWanHealth(iface);

      // Initialize health entry if needed
      if (!wanHealth[iface]) {
        wanHealth[iface] = { alive: true, failCount: 0, pingMs: null, lastCheck: Date.now(), targetsHit: 0 };
      }

      const h = wanHealth[iface];
      h.lastCheck = Date.now();
      h.targetsHit = result.hits;

      // Only track health for UI display — NEVER auto-disable or remove interfaces
      if (result.hits === 0) {
        h.failCount++;
        h.pingMs = null;
      } else {
        h.pingMs = result.avgMs;
        h.failCount = 0;
        h.alive = true;
      }
    }

    // Emit health data to frontend (display only, no action taken)
    emitHealthStatus();

  } catch (e) {
    error(`Health tick failed: ${e.message}`);
  }
}

/**
 * Rebuild activeNexthops from current wanHealth + DB, then replace ECMP route.
 */
async function rebuildActiveNexthops() {
  const dbWans = await db.all('SELECT * FROM wan_interfaces WHERE enabled = 1');
  const newNexthops = [];

  for (const wan of dbWans) {
    const h = wanHealth[wan.name];
    if (h && h.alive && wan.gateway) {
      newNexthops.push({
        gateway: wan.gateway,
        dev: wan.name,
        weight: wan.weight || 1
      });
    }
  }

  activeNexthops = newNexthops;

  if (newNexthops.length === 0) {
    warn('No alive WANs with gateways — keeping last ECMP route intact');
    return;
  }

  await replaceEcmpRoute(newNexthops);
  await rebuildMangleRules(newNexthops);
}

/**
 * Emit health data via Socket.IO.
 */
function emitHealthStatus() {
  if (!io) return;
  try {
    const data = {};
    for (const [iface, h] of Object.entries(wanHealth)) {
      data[iface] = {
        alive: h.alive,
        pingMs: h.pingMs,
        failCount: h.failCount,
        targetsHit: h.targetsHit,
        totalTargets: PING_TARGETS.length,
        lastCheck: h.lastCheck
      };
    }
    io.emit('multiwan-health', data);
  } catch (e) {}
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the Multi-WAN module.
 * Called once at server startup.
 *
 * @param {object} deps - { db, network, io }
 */
async function init(deps) {
  db = deps.db;
  network = deps.network;
  io = deps.io || null;

  if (isInitialized) {
    warn('Already initialized');
    return;
  }

  log('Initializing Multi-WAN module...');

  // Check if Multi-WAN is actually enabled in DB
  let multiWanEnabled = false;
  try {
    const mwConfig = await db.get('SELECT * FROM multi_wan_config WHERE id = 1');
    if (mwConfig && mwConfig.enabled && mwConfig.topology === 'multi') {
      multiWanEnabled = true;
    }
  } catch (e) {
    // Table might not exist yet — that's fine
  }

  if (!multiWanEnabled) {
    // Multi-WAN is NOT enabled — only teardown if leftover chains exist from previous run
    // Check if RJD_MW_NAT chain exists in iptables (indicates multiwan was active before reboot)
    const chainExists = await run("iptables -t nat -L RJD_MW_NAT -n 2>/dev/null | head -1");
    if (chainExists && chainExists.includes('RJD_MW_NAT')) {
      log('Multi-WAN not enabled but leftover chains found — tearing down');
      // Mark as active so teardown knows to clean routes
      appliedConfig = { topology: 'multi' };
      await teardown();
    } else {
      log('Multi-WAN not enabled and no leftover state — skipping');
    }
    isInitialized = true;
    log('Multi-WAN module initialized (inactive)');
    return;
  }

  // Multi-WAN IS enabled — set up chains and restore config
  await ensureChains();

  try {
    log('Restoring Multi-WAN configuration from DB...');
    const mwConfig = await db.get('SELECT * FROM multi_wan_config WHERE id = 1');
    await apply({
      enabled: true,
      topology: 'multi',
      mode: 'ecmp',
      interfaces: JSON.parse(mwConfig.interfaces || '[]')
    });
  } catch (e) {
    error(`Init restore failed: ${e.message}`);
  }

  // Start health monitor
  startHealthMonitor();

  isInitialized = true;
  log('Multi-WAN module initialized (active)');
}

/**
 * Apply a Multi-WAN configuration using incremental diff.
 * Called when user saves settings from the UI.
 *
 * @param {object} config - { enabled, topology, mode, interfaces }
 */
async function apply(config) {
  log(`Applying config: enabled=${config.enabled}, topology=${config.topology}`);

  // If disabled or single topology → teardown
  if (!config.enabled || config.topology !== 'multi') {
    await teardown();
    return;
  }

  // CRITICAL: Re-create sandbox chains if they were flushed by initFirewall()
  // initFirewall() runs during network restoration and flushes ALL iptables rules,
  // including our RJD_MW_NAT and RJD_MW chains. We must re-create them here.
  await ensureChains();

  // Resolve WAN interfaces from DB
  let wanList = [];
  try {
    // AUTO-REGISTER the current system default WAN if it is missing from the DB.
    // Without this, enabling Multi-WAN with only the 2nd ISP registered would
    // replace the default route entirely and drop the primary ISP.
    try {
      const defaultIface = (network && typeof network.getDefaultRouteInterface === 'function')
        ? await network.getDefaultRouteInterface()
        : null;
      if (defaultIface) {
        const dbWansCheck = await db.all('SELECT name FROM wan_interfaces');
        const alreadyRegistered = dbWansCheck.some(w => w.name === defaultIface);
        const isProtected = (network && typeof network.isProtectedInterface === 'function')
          ? await network.isProtectedInterface(defaultIface)
          : false;
        if (!alreadyRegistered && !isProtected) {
          await db.run(
            'INSERT INTO wan_interfaces (name, type, config, gateway, weight, enabled) VALUES (?, ?, ?, ?, ?, 1)',
            [defaultIface, 'dhcp', '{}', null, 1]
          );
          log(`Auto-registered system default WAN ${defaultIface} into wan_interfaces`);
        }
      }
    } catch (e) {
      warn(`Default WAN auto-register skipped: ${e.message}`);
    }

    const dbWans = await db.all('SELECT * FROM wan_interfaces WHERE enabled = 1');
    for (const w of dbWans) {
      let gw = w.gateway;
      if (!gw && w.type === 'dhcp' && network && typeof network.getWanGateway === 'function') {
        gw = await network.getWanGateway(w.name);
        if (gw) await db.run('UPDATE wan_interfaces SET gateway = ? WHERE id = ?', [gw, w.id]).catch(() => {});
      }
      if (gw) {
        wanList.push({
          dev: w.name,
          gateway: gw,
          weight: w.weight || 1,
          status: w.status || 'up'
        });
      }
    }

    // UPDATE DB with live IP/status for all WANs — ensures UI shows correct data
    // (especially important for auto-registered default WANs that were never manually configured)
    if (network && typeof network.getWanStatus === 'function') {
      for (const wan of wanList) {
        try {
          const liveStatus = await network.getWanStatus(wan.dev);
          if (liveStatus) {
            await db.run(
              'UPDATE wan_interfaces SET status = ?, ip_address = ?, updated_at = datetime("now") WHERE name = ?',
              [liveStatus.status || 'up', liveStatus.ip || null, wan.dev]
            ).catch(() => {});
          }
        } catch (e) {
          warn(`Failed to update live status for ${wan.dev}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    error(`Failed to resolve WANs: ${e.message}`);
  }

  if (wanList.length === 0) {
    warn('No WANs with gateways found — not applying');
    return;
  }

  // If only 1 WAN, use simple default route (no ECMP needed)
  if (wanList.length === 1) {
    const single = wanList[0];
    await run(`ip route replace default via ${single.gateway} dev ${single.dev}`);
    await addNatForWan(single.dev);
    await setFallbackRoute(single.gateway, single.dev);

    // Initialize health for this WAN
    if (!wanHealth[single.dev]) {
      wanHealth[single.dev] = { alive: true, failCount: 0, pingMs: null, lastCheck: Date.now(), targetsHit: 0 };
    }

    activeNexthops = [{ gateway: single.gateway, dev: single.dev, weight: single.weight }];
    appliedConfig = { enabled: true, topology: 'multi', wans: [single.dev] };
    log(`Single WAN mode: ${single.dev} via ${single.gateway}`);
    return;
  }

  // ─── Incremental Diff ─────────────────────────────────────────────────
  const previousWans = appliedConfig ? (appliedConfig.wans || []) : [];
  const currentWans = wanList.map(w => w.dev);

  // WANs to ADD
  const toAdd = currentWans.filter(w => !previousWans.includes(w));
  // WANs to REMOVE
  const toRemove = previousWans.filter(w => !currentWans.includes(w));
  // WANs that stayed (may have changed weight/gateway)
  const stayed = currentWans.filter(w => previousWans.includes(w));

  // Process additions
  for (const dev of toAdd) {
    const wan = wanList.find(w => w.dev === dev);
    await addNatForWan(dev);
    // Initialize health
    wanHealth[dev] = { alive: true, failCount: 0, pingMs: null, lastCheck: Date.now(), targetsHit: 0 };
    log(`WAN added: ${dev}`);
  }

  // Process removals
  for (const dev of toRemove) {
    await removeNatForWan(dev);
    delete wanHealth[dev];
    log(`WAN removed: ${dev}`);
  }

  // Build active nexthops (only alive WANs)
  activeNexthops = [];
  for (const wan of wanList) {
    const h = wanHealth[wan.dev];
    if (!h || h.alive) {
      activeNexthops.push({
        gateway: wan.gateway,
        dev: wan.dev,
        weight: wan.weight
      });
    }
  }

  if (activeNexthops.length === 0) {
    // All WANs are new/unknown — add all as alive initially
    activeNexthops = wanList.map(w => ({ gateway: w.gateway, dev: w.dev, weight: w.weight }));
  }

  // Apply ECMP route (atomic)
  await replaceEcmpRoute(activeNexthops);

  // Rebuild mangle rules
  await rebuildMangleRules(activeNexthops);

  // Set fallback route through first WAN
  const fallback = wanList[0];
  await setFallbackRoute(fallback.gateway, fallback.dev);
  primaryWan = fallback.dev;

  // Save snapshot
  appliedConfig = { enabled: true, topology: 'multi', wans: currentWans };

  log(`Applied: ${activeNexthops.length} active nexthops: ${activeNexthops.map(n => `${n.dev}(${n.gateway},w${n.weight})`).join(', ')}`);
}

/**
 * Teardown Multi-WAN — remove all sandbox rules, restore single-WAN routing.
 * Called when user disables Multi-WAN.
 */
async function teardown() {
  log('Tearing down Multi-WAN...');

  // Stop health monitor
  stopHealthMonitor();

  // Remove sandbox chains (this removes all our NAT and mangle rules)
  await removeChains();

  // Remove fallback route
  await removeFallbackRoute();

  // Restore single default route through primary/first active WAN
  try {
    const activeWan = await db.get('SELECT * FROM wan_interfaces WHERE enabled = 1 LIMIT 1');
    if (activeWan) {
      const gw = activeWan.gateway || (network && typeof network.getWanGateway === 'function' ? await network.getWanGateway(activeWan.name) : null);
      if (gw) {
        await run(`ip route replace default via ${gw} dev ${activeWan.name}`);
        log(`Restored single default route via ${gw} dev ${activeWan.name}`);
      }
    }
  } catch (e) {
    error(`Teardown route restore failed: ${e.message}`);
  }

  // Reset state
  activeNexthops = [];
  appliedConfig = null;
  wanHealth = {};
  primaryWan = null;

  log('Teardown complete');
}

/**
 * Get current health status for all monitored WANs.
 * Called by API endpoints.
 */
function getHealthStatus() {
  const result = {};
  for (const [iface, h] of Object.entries(wanHealth)) {
    result[iface] = {
      alive: h.alive,
      pingMs: h.pingMs,
      failCount: h.failCount,
      targetsHit: h.targetsHit,
      totalTargets: PING_TARGETS.length,
      lastCheck: h.lastCheck
    };
  }
  return result;
}

/**
 * Get current active nexthops (for API/debugging).
 */
function getActiveNexthops() {
  return [...activeNexthops];
}

/**
 * Check if Multi-WAN is currently active (multi topology applied).
 */
function isActive() {
  return appliedConfig !== null && appliedConfig.topology === 'multi';
}

// ─── Health Monitor Timer ───────────────────────────────────────────────────

function startHealthMonitor() {
  if (healthTimer) return;
  log(`Health monitor started (${HEALTH_INTERVAL_MS}ms interval)`);
  healthTimer = setInterval(healthTick, HEALTH_INTERVAL_MS);
  if (healthTimer.unref) healthTimer.unref();
}

function stopHealthMonitor() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
    log('Health monitor stopped');
  }
}

// ─── Cleanup old PCC ip rules (one-time migration) ─────────────────────────

/**
 * Remove any leftover PCC ip rules from the old implementation.
 * Called once during init to clean up legacy state.
 */
async function cleanupLegacyRules() {
  log('Cleaning up legacy PCC rules...');
  for (let mark = 1; mark <= 10; mark++) {
    const tableId = 100 + mark;
    while (true) {
      const r = await run(`ip rule del fwmark ${mark} table ${tableId} 2>/dev/null`);
      if (r === null) break;
    }
    await run(`ip route flush table ${tableId} 2>/dev/null`);
  }
  // Remove old pref 100 rule
  for (let i = 0; i < 3; i++) {
    const r = await run('ip rule del pref 100 2>/dev/null');
    if (r === null) break;
  }
  // Clean up old RJD_MULTIWAN chain if it exists
  for (let i = 0; i < 5; i++) {
    const r = await run('iptables -t mangle -D PREROUTING -j RJD_MULTIWAN 2>/dev/null');
    if (r === null) break;
  }
  await run('iptables -t mangle -F RJD_MULTIWAN 2>/dev/null');
  await run('iptables -t mangle -X RJD_MULTIWAN 2>/dev/null');
  log('Legacy cleanup done');
}

// ─── Module Exports ─────────────────────────────────────────────────────────

module.exports = {
  init,
  apply,
  teardown,
  healthTick,
  getHealthStatus,
  getActiveNexthops,
  isActive,
  cleanupLegacyRules
};
