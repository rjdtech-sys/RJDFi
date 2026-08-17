/**
 * lib/wireguard.js — WireGuard VPN Manager
 *
 * Manages WireGuard VPN configuration, activation, and routing.
 * Handles default route switching with safety auto-revert.
 *
 * Architecture:
 *   - Parse and validate .conf files
 *   - Save configs to /etc/wireguard/<name>.conf
 *   - Activate/deactivate via wg-quick
 *   - Manage default route (save original, set VPN, restore on disable)
 *   - Health monitoring with auto-revert on connectivity loss
 *   - Persist state in SQLite config table
 */

const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);

// ─── Module State ───────────────────────────────────────────────────────────
let db = null;
let io = null;
let healthTimer = null;
let isInitialized = false;

// Auto-revert safety: if no internet after 30s, restore original route
const AUTO_REVERT_DELAY_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 10000;
const STALE_HANDSHAKE_THRESHOLD_S = 180; // 3 minutes

let autoRevertTimer = null;
let logBuffer = [];
const MAX_LOG_ENTRIES = 100;

// ─── Helpers ────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run(cmd) {
  try {
    const { stdout, stderr } = await execPromise(cmd, { timeout: 15000 });
    return { stdout: stdout || '', stderr: stderr || '', success: true };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || e.message, success: false };
  }
}

function log(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  console.log(`[WireGuard] ${msg}`);
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }
}

function warn(msg) {
  const entry = `[${new Date().toISOString()}] WARN: ${msg}`;
  console.warn(`[WireGuard] ${msg}`);
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }
}

function emitStatus() {
  if (io) {
    getStatus().then(status => {
      io.emit('wireguard:status', status);
    }).catch(() => {});
  }
}

// ─── Dependency Check ───────────────────────────────────────────────────────
async function checkDependencies() {
  try {
    const wgQuick = await run('which wg-quick');
    const wg = await run('which wg');
    if (wgQuick.success && wg.success) {
      return { installed: true };
    }
    return { 
      installed: false, 
      message: 'wireguard-tools not installed. Run: sudo apt install wireguard-tools' 
    };
  } catch (e) {
    return { installed: false, message: e.message };
  }
}

// ─── Config Parsing ─────────────────────────────────────────────────────────
function parseConfig(confText) {
  const lines = confText.split('\n').map(l => l.trim());
  const result = {
    name: null,
    address: null,
    dns: null,
    listenPort: null,
    privateKey: null,
    peers: []
  };

  let currentSection = null;
  let currentPeer = null;

  for (const line of lines) {
    // Skip comments and empty lines
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    // Section headers
    if (line.startsWith('[') && line.endsWith(']')) {
      const section = line.slice(1, -1).toLowerCase();
      if (section === 'interface') {
        currentSection = 'interface';
        currentPeer = null;
      } else if (section === 'peer') {
        currentSection = 'peer';
        currentPeer = {
          publicKey: null,
          presharedKey: null,
          allowedIPs: null,
          endpoint: null,
          persistentKeepalive: null
        };
        result.peers.push(currentPeer);
      }
      continue;
    }

    // Key = Value parsing
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const value = line.slice(eqIdx + 1).trim();

    if (currentSection === 'interface') {
      switch (key) {
        case 'address':
          result.address = value;
          break;
        case 'dns':
          result.dns = value;
          break;
        case 'listenport':
          result.listenPort = parseInt(value, 10) || null;
          break;
        case 'privatekey':
          result.privateKey = value;
          break;
      }
    } else if (currentSection === 'peer' && currentPeer) {
      switch (key) {
        case 'publickey':
          currentPeer.publicKey = value;
          break;
        case 'presharedkey':
          currentPeer.presharedKey = value;
          break;
        case 'allowedips':
          currentPeer.allowedIPs = value;
          break;
        case 'endpoint':
          currentPeer.endpoint = value;
          break;
        case 'persistentkeepalive':
          currentPeer.persistentKeepalive = parseInt(value, 10) || null;
          break;
      }
    }
  }

  // Derive interface name from address or default to wg0
  result.name = 'wg0';

  // Validate required fields
  if (!result.privateKey) {
    throw new Error('Missing PrivateKey in [Interface] section');
  }
  if (result.peers.length === 0) {
    throw new Error('No [Peer] section found in configuration');
  }
  for (const peer of result.peers) {
    if (!peer.publicKey) {
      throw new Error('Missing PublicKey in [Peer] section');
    }
  }

  return result;
}

// ─── Config Storage ─────────────────────────────────────────────────────────

/**
 * Strip DNS= line from config text for wg-quick compatibility.
 * Our system uses dnsmasq for DNS, so we don't need wg-quick to manage resolv.conf.
 * This prevents "resolvconf: command not found" errors on minimal systems.
 */
function stripDnsFromConfig(confText) {
  return confText.split('\n').map(line => {
    const trimmed = line.trim().toLowerCase();
    // Remove DNS = ... lines in [Interface] section
    if (trimmed.startsWith('dns') && (trimmed.includes('=') && !trimmed.startsWith('dnssec'))) {
      return `# ${line.trim()} # stripped by RJD (DNS managed by dnsmasq)`;
    }
    return line;
  }).join('\n');
}

async function saveConfig(name, confText, parsed) {
  if (!db) throw new Error('Database not initialized');

  // Save the raw config text (with DNS for reference)
  await db.run(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
    ['wireguard_config_text', confText]
  );

  // Save parsed metadata as JSON
  const metadata = {
    name: name || parsed.name,
    address: parsed.address,
    dns: parsed.dns,
    listenPort: parsed.listenPort,
    peers: parsed.peers.map(p => ({
      publicKey: p.publicKey,
      endpoint: p.endpoint,
      allowedIPs: p.allowedIPs
    }))
  };
  await db.run(
    "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
    ['wireguard_config', JSON.stringify(metadata)]
  );

  // Write to /etc/wireguard/<name>.conf for wg-quick
  // Strip DNS line to avoid resolvconf dependency (we use dnsmasq)
  const confDir = '/etc/wireguard';
  const confPath = path.join(confDir, `${name || parsed.name}.conf`);
  const wgQuickConf = stripDnsFromConfig(confText);
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(confDir)) {
      await run(`mkdir -p ${confDir}`);
    }
    fs.writeFileSync(confPath, wgQuickConf, { mode: 0o600 });
    log(`Config saved to ${confPath} (DNS stripped for wg-quick compatibility)`);
  } catch (e) {
    warn(`Failed to write config file: ${e.message}`);
    // Continue anyway — we have it in DB
  }

  return metadata;
}

async function loadConfig() {
  if (!db) return null;
  
  const row = await db.get("SELECT value FROM config WHERE key = ?", ['wireguard_config']);
  if (!row) return null;
  
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return null;
  }
}

async function loadConfigText() {
  if (!db) return null;
  
  const row = await db.get("SELECT value FROM config WHERE key = ?", ['wireguard_config_text']);
  return row ? row.value : null;
}

async function deleteConfig() {
  if (!db) return;
  
  // Deactivate first if active
  const status = await getStatus();
  if (status.active) {
    await deactivate();
  }

  // Remove from DB
  await db.run("DELETE FROM config WHERE key IN ('wireguard_config', 'wireguard_config_text', 'wireguard_enabled', 'wireguard_original_route')");

  // Remove file
  const confPath = '/etc/wireguard/wg0.conf';
  try {
    if (fs.existsSync(confPath)) {
      fs.unlinkSync(confPath);
      log(`Deleted config file: ${confPath}`);
    }
  } catch (e) {
    warn(`Failed to delete config file: ${e.message}`);
  }

  log('Configuration deleted');
}

// ─── Route Management ───────────────────────────────────────────────────────
async function getCurrentDefaultRoute() {
  const result = await run('ip -j route show default');
  if (!result.success) return null;
  
  try {
    const routes = JSON.parse(result.stdout || '[]');
    if (routes && routes[0]) {
      return {
        gateway: routes[0].gateway || null,
        dev: routes[0].dev || null
      };
    }
  } catch (e) {
    // Fallback parsing
    const result2 = await run("ip route show default | awk '{print $3, $5}' | head -1");
    if (result2.success) {
      const parts = result2.stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        return { gateway: parts[0], dev: parts[1] };
      }
    }
  }
  return null;
}

async function saveOriginalRoute() {
  if (!db) return;
  
  const route = await getCurrentDefaultRoute();
  if (route) {
    await db.run(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
      ['wireguard_original_route', JSON.stringify(route)]
    );
    log(`Saved original route: ${route.gateway} via ${route.dev}`);
  }
  return route;
}

async function getSavedOriginalRoute() {
  if (!db) return null;
  
  const row = await db.get("SELECT value FROM config WHERE key = ?", ['wireguard_original_route']);
  if (!row) return null;
  
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return null;
  }
}

async function restoreOriginalRoute() {
  const savedRoute = await getSavedOriginalRoute();
  if (!savedRoute) {
    warn('No saved original route to restore');
    return false;
  }

  // Restore the original default route
  let cmd = 'ip route replace default';
  if (savedRoute.gateway) cmd += ` via ${savedRoute.gateway}`;
  if (savedRoute.dev) cmd += ` dev ${savedRoute.dev}`;
  
  const result = await run(cmd);
  if (result.success) {
    log(`Restored original route: ${savedRoute.gateway} via ${savedRoute.dev}`);
    // Clean up saved route
    if (db) {
      await db.run("DELETE FROM config WHERE key = ?", ['wireguard_original_route']);
    }
    return true;
  } else {
    warn(`Failed to restore route: ${result.stderr}`);
    return false;
  }
}

// ─── Activation / Deactivation ──────────────────────────────────────────────
async function activate() {
  const deps = await checkDependencies();
  if (!deps.installed) {
    throw new Error(deps.message);
  }

  const configText = await loadConfigText();
  if (!configText) {
    throw new Error('No WireGuard configuration saved');
  }

  // Check if already active
  const wgShow = await run('wg show wg0');
  if (wgShow.success && wgShow.stdout.includes('interface: wg0')) {
    log('WireGuard already active');
    return { success: true, alreadyActive: true };
  }

  // Save current default route before changing
  await saveOriginalRoute();

  // Ensure config file has DNS stripped (fix for existing configs saved before this fix)
  const confPath = '/etc/wireguard/wg0.conf';
  const wgQuickConf = stripDnsFromConfig(configText);
  try {
    const confDir = '/etc/wireguard';
    if (!fs.existsSync(confDir)) {
      await run(`mkdir -p ${confDir}`);
    }
    fs.writeFileSync(confPath, wgQuickConf, { mode: 0o600 });
    log('Config file re-written with DNS stripped for wg-quick');
  } catch (e) {
    warn(`Failed to update config file: ${e.message}`);
  }

  // Bring up the interface
  log('Activating WireGuard interface wg0...');
  const upResult = await run('wg-quick up wg0');
  
  if (!upResult.success) {
    // Check if it's already up
    if (upResult.stderr.includes('already exists')) {
      log('Interface wg0 already exists, attempting to continue...');
    } else {
      throw new Error(`wg-quick up failed: ${upResult.stderr}`);
    }
  }

  // Verify interface is up
  await sleep(1000);
  const verify = await run('wg show wg0');
  if (!verify.success || !verify.stdout.includes('interface: wg0')) {
    throw new Error('WireGuard interface failed to come up');
  }

  // wg-quick with AllowedIPs=0.0.0.0/0 automatically sets default route
  // Verify the route is now via wg0
  const currentRoute = await getCurrentDefaultRoute();
  if (currentRoute && currentRoute.dev === 'wg0') {
    log('Default route now via wg0');
  } else {
    // Force route if wg-quick didn't set it (some configs don't have 0.0.0.0/0)
    log('Setting default route via wg0 manually...');
    await run('ip route replace default dev wg0');
  }

  // Mark as enabled in DB
  if (db) {
    await db.run(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
      ['wireguard_enabled', 'true']
    );
  }

  log('WireGuard activated successfully');
  
  // Start health monitoring
  startHealthMonitor();

  // Start auto-revert safety timer
  startAutoRevertCheck();

  emitStatus();
  return { success: true };
}

async function deactivate() {
  // Bring down the interface
  log('Deactivating WireGuard interface wg0...');
  
  const downResult = await run('wg-quick down wg0');
  if (!downResult.success && !downResult.stderr.includes('not found')) {
    warn(`wg-quick down warning: ${downResult.stderr}`);
  }

  // Restore original default route
  await restoreOriginalRoute();

  // Mark as disabled in DB
  if (db) {
    await db.run(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
      ['wireguard_enabled', 'false']
    );
  }

  // Stop health monitoring
  stopHealthMonitor();
  
  // Clear auto-revert timer
  if (autoRevertTimer) {
    clearTimeout(autoRevertTimer);
    autoRevertTimer = null;
  }

  log('WireGuard deactivated');
  emitStatus();
  return { success: true };
}

// ─── Status ─────────────────────────────────────────────────────────────────
async function getStatus() {
  const config = await loadConfig();
  const configText = await loadConfigText();
  const savedRoute = await getSavedOriginalRoute();
  
  // Check if interface is active
  const wgShow = await run('wg show wg0');
  const isActive = wgShow.success && wgShow.stdout.includes('interface: wg0');

  let peer = null;
  let address = config?.address || null;
  let listenPort = config?.listenPort || null;

  if (isActive) {
    // Parse wg show output for peer info
    const output = wgShow.stdout;
    
    // Get peer details
    const peerResult = await run('wg show wg0 peers');
    if (peerResult.success && peerResult.stdout.trim()) {
      const peerLines = peerResult.stdout.trim().split('\n');
      const peerData = {};
      let currentPeerKey = null;
      
      for (const line of peerLines) {
        if (line && !line.startsWith('\t')) {
          // This is a peer public key line
          currentPeerKey = line.trim();
          peerData[currentPeerKey] = {};
        } else if (currentPeerKey && line.startsWith('\t')) {
          const parts = line.trim().split(/\s*:\s*/);
          if (parts.length >= 2) {
            const key = parts[0].trim().toLowerCase().replace(/\s+/g, '');
            const val = parts.slice(1).join(':').trim();
            peerData[currentPeerKey][key] = val;
          }
        }
      }

      // Get first peer's details
      const peerKeys = Object.keys(peerData);
      if (peerKeys.length > 0) {
        const firstPeer = peerData[peerKeys[0]];
        
        // Parse transfer
        let transferRx = 0, transferTx = 0;
        if (firstPeer.transfer) {
          const transferMatch = firstPeer.transfer.match(/([\d.]+)\s*(\w+),\s*([\d.]+)\s*(\w+)/);
          if (transferMatch) {
            transferRx = parseBytes(transferMatch[1], transferMatch[2]);
            transferTx = parseBytes(transferMatch[3], transferMatch[4]);
          }
        }

        // Parse latest handshake
        let latestHandshake = 0;
        if (firstPeer.latesthandshake) {
          latestHandshake = parseInt(firstPeer.latesthandshake, 10) || 0;
        }

        peer = {
          publicKey: peerKeys[0],
          endpoint: firstPeer.endpoint || config?.peers?.[0]?.endpoint || null,
          allowedIPs: firstPeer.allowedips || config?.peers?.[0]?.allowedIPs || null,
          latestHandshake: latestHandshake,
          transferRx: transferRx,
          transferTx: transferTx
        };
      }
    }

    // Get address from interface if not in config
    if (!address) {
      const addrResult = await run("ip -4 addr show wg0 | grep inet | awk '{print $2}'");
      if (addrResult.success) {
        address = addrResult.stdout.trim() || null;
      }
    }
  }

  // Check if enabled in DB
  let enabled = false;
  if (db) {
    const enabledRow = await db.get("SELECT value FROM config WHERE key = ?", ['wireguard_enabled']);
    enabled = enabledRow?.value === 'true';
  }

  // Check dependencies
  const deps = await checkDependencies();

  return {
    active: isActive,
    enabled: enabled,
    interface: isActive ? 'wg0' : null,
    address: address,
    listenPort: listenPort,
    dns: config?.dns || null,
    peer: peer,
    config: config,
    configText: configText,
    savedRoute: savedRoute,
    dependencies: deps
  };
}

function parseBytes(value, unit) {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  
  const units = {
    'b': 1,
    'kib': 1024,
    'mib': 1024 * 1024,
    'gib': 1024 * 1024 * 1024,
    'tib': 1024 * 1024 * 1024 * 1024,
    'kb': 1000,
    'mb': 1000 * 1000,
    'gb': 1000 * 1000 * 1000,
    'tb': 1000 * 1000 * 1000 * 1000
  };
  
  return Math.round(num * (units[unit.toLowerCase()] || 1));
}

// ─── Health Monitoring ──────────────────────────────────────────────────────
function startHealthMonitor() {
  if (healthTimer) return;
  
  log('Starting health monitor');
  healthTimer = setInterval(async () => {
    try {
      const wgShow = await run('wg show wg0');
      if (!wgShow.success || !wgShow.stdout.includes('interface: wg0')) {
        warn('Interface wg0 not found during health check');
        stopHealthMonitor();
        emitStatus();
        return;
      }

      // Check handshake age
      const peerResult = await run('wg show wg0 latest-handshakes');
      if (peerResult.success) {
        const lines = peerResult.stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const handshakeTime = parseInt(parts[1], 10);
            const age = Math.floor(Date.now() / 1000) - handshakeTime;
            
            if (age > STALE_HANDSHAKE_THRESHOLD_S && handshakeTime > 0) {
              warn(`Stale handshake detected: ${age}s since last handshake`);
              if (io) {
                io.emit('wireguard:warning', { 
                  type: 'stale_handshake', 
                  message: `No handshake for ${age} seconds` 
                });
              }
            }
          }
        }
      }

      emitStatus();
    } catch (e) {
      warn(`Health check error: ${e.message}`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthMonitor() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
    log('Health monitor stopped');
  }
}

// ─── Auto-Revert Safety ─────────────────────────────────────────────────────
function startAutoRevertCheck() {
  if (autoRevertTimer) {
    clearTimeout(autoRevertTimer);
  }

  log('Starting auto-revert safety check (30s)');
  autoRevertTimer = setTimeout(async () => {
    try {
      // Check if we have internet connectivity
      const ping = await run('ping -c 2 -W 3 8.8.8.8');
      
      if (!ping.success) {
        warn('No internet connectivity after 30s — auto-reverting to original route');
        await deactivate();
        if (io) {
          io.emit('wireguard:warning', { 
            type: 'auto_revert', 
            message: 'VPN disabled: no internet connectivity' 
          });
        }
      } else {
        log('Connectivity confirmed — VPN working correctly');
      }
    } catch (e) {
      warn(`Auto-revert check error: ${e.message}`);
    }
    autoRevertTimer = null;
  }, AUTO_REVERT_DELAY_MS);
}

// ─── Log Access ─────────────────────────────────────────────────────────────
function getLogs() {
  return logBuffer.slice();
}

function clearLogs() {
  logBuffer = [];
}

// ─── Initialization ─────────────────────────────────────────────────────────
async function init(dbInstance, ioInstance) {
  if (isInitialized) return;
  
  db = dbInstance;
  io = ioInstance;
  
  log('Initializing WireGuard module');

  // Check if interface is already active (e.g., after server restart)
  const wgShow = await run('wg show wg0');
  if (wgShow.success && wgShow.stdout.includes('interface: wg0')) {
    log('WireGuard interface already active on startup — syncing state');
    startHealthMonitor();
    
    // Ensure enabled flag is set
    if (db) {
      await db.run(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
        ['wireguard_enabled', 'true']
      );
    }
  }

  isInitialized = true;
  log('WireGuard module initialized');
}

// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  init,
  parseConfig,
  saveConfig,
  loadConfig,
  loadConfigText,
  deleteConfig,
  activate,
  deactivate,
  getStatus,
  getLogs,
  clearLogs,
  checkDependencies,
  getCurrentDefaultRoute,
  getSavedOriginalRoute
};
