// This module simulates the GPIO interactions required for real hardware.
// In a production Node.js environment, this would use 'onoff' or 'orange-pi-gpio'.

const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// Generic/placeholder values that indicate "no real data"
const GENERIC_VALUES = new Set([
  'none', 'to be filled by o.e.m.', 'default string', 'not specified',
  'not available', 'n/a', 'unknown', 'o.e.m.', 'system product name',
  'system manufacturer', 'system version', 'system serial number',
]);

function isGenericValue(val) {
  if (!val) return true;
  return GENERIC_VALUES.has(val.toLowerCase().trim());
}

/**
 * Detect if a UUID is a generic/placeholder BIOS UUID that is NOT unique per board.
 * Examples of generic UUIDs:
 *   - 03000200-0400-0500-0006-000700080009 (sequential bytes — BIOSTAR, generic AMI BIOS)
 *   - 00000000-0000-0000-0000-000000000000 (all zeros)
 *   - 03000200040005000006000700080009 (same pattern, dashes stripped)
 */
function isGenericUuid(uuid) {
  if (!uuid) return true;
  const hex = uuid.replace(/-/g, '').toLowerCase();

  // All zeros
  if (/^0+$/.test(hex)) return true;

  // All ones (FF)
  if (/^f+$/.test(hex)) return true;

  // Sequential byte pattern: 000102030405060708090a0b0c0d0e0f or reversed
  if (hex === '03000200040005000006000700080009') return true;
  if (hex === '000102030405060708090a0b0c0d0e0f') return true;

  // Check for sequential ascending bytes (any rotation)
  const bytes = hex.match(/.{2}/g) || [];
  if (bytes.length === 16) {
    let sequential = 0;
    for (let i = 1; i < bytes.length; i++) {
      const prev = parseInt(bytes[i - 1], 16);
      const curr = parseInt(bytes[i], 16);
      if (curr === (prev + 1) % 256 || curr === prev) sequential++;
    }
    // If 14+ of 15 consecutive pairs are sequential, it's generic
    if (sequential >= 14) return true;
  }

  // Known generic UUID prefixes from common BIOS vendors
  // (These are not real unique UUIDs)
  if (hex.startsWith('0300020004000500')) return true;

  return false;
}

/**
 * Safely read a sysfs/procfs file, returning trimmed content or null.
 */
function safeReadFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').replace(/\0/g, '').trim();
      return content || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Safely read a DMI sysfs file — returns value only if it's a real (non-generic) value.
 */
function readDmiField(label, sysfsPath) {
  const val = safeReadFile(sysfsPath);
  if (val && !isGenericValue(val)) {
    return val;
  }
  return null;
}

/**
 * Execute a command with sudo, trying multiple approaches.
 * Returns stdout or null.
 */
function trySudoExec(command) {
  // Try 1: sudo (may work if NOPASSWD or cached credentials)
  try {
    const output = execSync(`sudo ${command} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (output) return output;
  } catch (e) {}

  // Try 2: pkexec (PolicyKit — may work on desktop Ubuntu)
  try {
    const output = execSync(`pkexec ${command} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim();
    if (output) return output;
  } catch (e) {}

  return null;
}

/**
 * Try reading product_uuid with elevated privileges (multiple methods)
 */
function tryReadProductUuidElevated() {
  const uuid = trySudoExec('cat /sys/class/dmi/id/product_uuid');
  if (uuid && !isGenericValue(uuid) && uuid !== '03000200-0400-0500-0006-000700080009') {
    return uuid.replace(/-/g, '');
  }
  return null;
}

/**
 * Try reading a specific dmidecode field via sudo
 */
function tryDmidecodeField(field) {
  const val = trySudoExec(`dmidecode -s ${field}`);
  if (val && !isGenericValue(val)) {
    return val;
  }
  return null;
}

/**
 * Parse full dmidecode output for serial/UUID fields
 */
function tryParseDmidecodeFull() {
  try {
    const output = trySudoExec('dmidecode -t system');
    if (!output) return null;
    
    // Look for UUID/Serial in the output
    const uuidMatch = output.match(/UUID:\s*(.+)/i);
    if (uuidMatch && uuidMatch[1] && !isGenericValue(uuidMatch[1].trim())) {
      return uuidMatch[1].trim().replace(/-/g, '');
    }
    
    const serialMatch = output.match(/Serial Number:\s*(.+)/i);
    if (serialMatch && serialMatch[1] && !isGenericValue(serialMatch[1].trim())) {
      return serialMatch[1].trim().replace(/-/g, '');
    }
  } catch (e) {}
  return null;
}

/**
 * Build a composite hardware fingerprint from ALL available DMI/system sources.
 * Combines multiple fields via SHA-256 for uniqueness.
 */
function buildCompositeFingerprint() {
  const parts = [];
  const found = {};

  // === Phase 1: Read ALL DMI sysfs fields (world-readable ones) ===
  const dmiSysfsFields = [
    { label: 'product_uuid', path: '/sys/class/dmi/id/product_uuid' },
    { label: 'product_serial', path: '/sys/class/dmi/id/product_serial' },
    { label: 'product_name', path: '/sys/class/dmi/id/product_name' },
    { label: 'product_family', path: '/sys/class/dmi/id/product_family' },
    { label: 'board_vendor', path: '/sys/class/dmi/id/board_vendor' },
    { label: 'board_name', path: '/sys/class/dmi/id/board_name' },
    { label: 'board_serial', path: '/sys/class/dmi/id/board_serial' },
    { label: 'board_version', path: '/sys/class/dmi/id/board_version' },
    { label: 'board_asset_tag', path: '/sys/class/dmi/id/board_asset_tag' },
    { label: 'chassis_vendor', path: '/sys/class/dmi/id/chassis_vendor' },
    { label: 'chassis_type', path: '/sys/class/dmi/id/chassis_type' },
    { label: 'chassis_serial', path: '/sys/class/dmi/id/chassis_serial' },
    { label: 'chassis_asset_tag', path: '/sys/class/dmi/id/chassis_asset_tag' },
    { label: 'bios_vendor', path: '/sys/class/dmi/id/bios_vendor' },
    { label: 'bios_version', path: '/sys/class/dmi/id/bios_version' },
    { label: 'bios_date', path: '/sys/class/dmi/id/bios_date' },
    { label: 'sys_vendor', path: '/sys/class/dmi/id/sys_vendor' },
  ];

  for (const { label, path } of dmiSysfsFields) {
    const val = readDmiField(label, path);
    if (val) {
      // Skip product_uuid if it's a generic/fake UUID (would make hash non-unique)
      if (label === 'product_uuid' && isGenericUuid(val)) {
        console.log(`[Hardware] Skipping generic product_uuid from fingerprint: ${val}`);
        continue;
      }
      parts.push(`${label}=${val}`);
      found[label] = val;
    }
  }

  console.log(`[Hardware] DMI sysfs: found ${parts.length} readable fields: ${Object.keys(found).join(', ') || '(none)'}`);

  // If we have at least 2 meaningful fields, hash them
  if (parts.length >= 2) {
    const hash = crypto.createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
    console.log(`[Hardware] Composite DMI fingerprint: ${hash} (from ${parts.length} fields)`);
    return hash;
  }

  // === Phase 2: Try dmidecode via sudo (may work even when sysfs doesn't) ===
  const dmidecodeFields = [
    'baseboard-manufacturer', 'baseboard-product-name', 'baseboard-version',
    'baseboard-serial-number', 'baseboard-asset-tag',
    'chassis-manufacturer', 'chassis-serial-number', 'chassis-asset-tag',
    'system-manufacturer', 'system-product-name', 'system-serial-number', 'system-uuid',
    'bios-vendor', 'bios-version', 'bios-release-date',
  ];

  const dmidecodeParts = [];
  for (const field of dmidecodeFields) {
    const val = tryDmidecodeField(field);
    if (val) {
      dmidecodeParts.push(`${field}=${val}`);
    }
  }

  console.log(`[Hardware] dmidecode: found ${dmidecodeParts.length} fields via sudo`);

  if (dmidecodeParts.length >= 2) {
    const hash = crypto.createHash('sha256').update(dmidecodeParts.join('|')).digest('hex').substring(0, 32);
    console.log(`[Hardware] dmidecode fingerprint: ${hash}`);
    return hash;
  }

  // === Phase 3: Try full dmidecode -t system parse ===
  const fullDmi = tryParseDmidecodeFull();
  if (fullDmi) {
    console.log(`[Hardware] Full dmidecode parse: ${fullDmi}`);
    return fullDmi;
  }

  return null;
}

/**
 * Extract a hardware-unique identifier from the system.
 * Priority order:
 *   1. DMI product_uuid (direct read or sudo) — truly unique per board
 *   2. Composite DMI fingerprint (SHA-256 of all readable DMI fields)
 *   3. /proc/cpuinfo Serial (Raspberry Pi) / Hardware+Revision (Orange Pi)
 *   4. Device tree serial (ARM boards)
 *   5. Sunxi SID (Orange Pi Allwinner)
 *   6. machine-id + MAC + hostname hash (last resort — always unique per physical machine)
 */
function getHardwareSerial() {
  try {
    const arch = process.arch; // x64, arm, arm64, etc.
    console.log(`[Hardware] Detecting unique ID on arch=${arch}, platform=${process.platform}`);

    // ======= Source 1: DMI product_uuid (x86_64 PCs) — MOST UNIQUE =======
    const directUuid = readDmiField('product_uuid', '/sys/class/dmi/id/product_uuid');
    if (directUuid && !isGenericUuid(directUuid)) {
      console.log(`[Hardware] Source 1 (DMI product_uuid direct): ${directUuid.replace(/-/g, '')}`);
      return directUuid.replace(/-/g, '');
    }
    if (directUuid && isGenericUuid(directUuid)) {
      console.log(`[Hardware] Source 1 (DMI product_uuid): GENERIC/FAKE UUID detected: ${directUuid} — falling through to composite fingerprint`);
    }

    // Try elevated read (sudo / pkexec)
    const elevatedUuid = tryReadProductUuidElevated();
    if (elevatedUuid && !isGenericUuid(elevatedUuid)) {
      console.log(`[Hardware] Source 1b (DMI product_uuid via sudo): ${elevatedUuid}`);
      return elevatedUuid;
    }
    if (!directUuid && !elevatedUuid) {
      console.log(`[Hardware] Source 1 (DMI product_uuid): not accessible without root`);
    }

    // ======= Source 2: Composite DMI fingerprint =======
    const composite = buildCompositeFingerprint();
    if (composite) {
      console.log(`[Hardware] Source 2 (composite DMI fingerprint): ${composite}`);
      return composite;
    }
    console.log(`[Hardware] Source 2 (composite DMI): insufficient fields found`);

    // ======= Source 3: /proc/cpuinfo Serial field (Raspberry Pi) =======
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
      
      const serialMatch = cpuInfo.match(/^Serial\s*:\s*([0-9a-fA-F]+)$/m);
      if (serialMatch && serialMatch[1]) {
        console.log(`[Hardware] Source 3 (cpuinfo Serial): ${serialMatch[1].trim()}`);
        return serialMatch[1].trim();
      }
      
      // Hardware + Revision (Orange Pi fallback)
      const hardwareMatch = cpuInfo.match(/^Hardware\s*:\s*(.+)$/m);
      const revisionMatch = cpuInfo.match(/^Revision\s*:\s*([0-9a-fA-F]+)$/m);
      
      if (hardwareMatch && revisionMatch) {
        const val = `${hardwareMatch[1].trim()}-${revisionMatch[1].trim()}`;
        console.log(`[Hardware] Source 3 (cpuinfo Hardware+Revision): ${val}`);
        return val;
      }
    }
    
    // ======= Source 4: Device tree serial number (ARM boards) =======
    const dtPaths = [
      '/sys/firmware/devicetree/base/serial-number',
      '/proc/device-tree/serial-number'
    ];
    for (const dtPath of dtPaths) {
      const serial = safeReadFile(dtPath);
      if (serial && /^[0-9a-fA-F]+$/.test(serial)) {
        console.log(`[Hardware] Source 4 (device-tree serial): ${serial}`);
        return serial;
      }
    }

    // ======= Source 5: Sunxi SID (Orange Pi Allwinner boards) =======
    const sunxiPaths = [
      '/sys/bus/sunxi_info/devices/sunxi_info/serial',
      '/sys/class/sunxi_info/sys_info'
    ];
    for (const sunxiPath of sunxiPaths) {
      const content = safeReadFile(sunxiPath);
      if (content) {
        const sidMatch = content.match(/([0-9a-fA-F]{16,})/);
        if (sidMatch) {
          console.log(`[Hardware] Source 5 (Sunxi SID): ${sidMatch[1]}`);
          return sidMatch[1];
        }
      }
    }

    // ======= Source 6: machine-id + MAC + hostname hash (LAST RESORT) =======
    // This is GUARANTEED unique per physical machine because MAC is unique per NIC
    let machineId = null;
    const machineIdPaths = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
    for (const mIdPath of machineIdPaths) {
      const mId = safeReadFile(mIdPath);
      if (mId && mId.length >= 32) {
        machineId = mId;
        break;
      }
    }

    // Get ALL MAC addresses
    let macs = [];
    try {
      const macOutput = execSync('ip link show 2>/dev/null | grep "link/ether" | head -5', { encoding: 'utf-8', timeout: 2000 });
      macs = (macOutput.match(/([0-9a-fA-F:]{17})/g) || []);
    } catch (e) {
      // Windows fallback
      if (process.platform === 'win32') {
        try {
          const output = execSync('getmac /fo csv /nh', { encoding: 'utf-8' });
          macs = output.split('\n').filter(l => l.trim()).map(l => l.split(',')[0].replace(/"/g, '').trim());
        } catch (e2) {}
      }
    }

    // Get hostname for additional entropy
    let hostname = '';
    try {
      hostname = execSync('hostname 2>/dev/null', { encoding: 'utf-8', timeout: 1000 }).trim();
    } catch (e) {
      try { hostname = require('os').hostname(); } catch (e2) {}
    }

    if (machineId && macs.length > 0) {
      const combined = [machineId, ...macs, hostname].join('|');
      const hash = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
      console.log(`[Hardware] Source 6 (machine-id + ${macs.length} MACs + hostname hash): ${hash}`);
      return hash;
    }

    if (machineId) {
      // machine-id + hostname at least
      const combined = machineId + '|' + hostname;
      const hash = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
      console.warn(`[Hardware] Source 6 (machine-id + hostname only, NO MAC): ${hash} — may not be unique on cloned images`);
      return hash;
    }

    // Absolute last resort: MAC + hostname only
    if (macs.length > 0) {
      const combined = macs.join('|') + '|' + hostname;
      const hash = crypto.createHash('sha256').update(combined).digest('hex').substring(0, 32);
      console.log(`[Hardware] Source 6b (MAC + hostname hash): ${hash}`);
      return hash;
    }
    
    console.error('[Hardware] CRITICAL: Could not extract ANY hardware identifier!');
    return null;
  } catch (error) {
    console.error('[Hardware] Error extracting hardware serial:', error);
    return null;
  }
}

/**
 * Get a unique hardware identifier for this device
 * Falls back to MAC address if CPU serial is unavailable
 */
async function getUniqueHardwareId() {
  const serial = getHardwareSerial();
  if (serial) {
    return `CPU-${serial}`;
  }
  
  // Fallback to MAC address of primary network interface
  try {
    // Windows fallback
    if (process.platform === 'win32') {
      const output = execSync('getmac /fo csv /nh', { encoding: 'utf-8' });
      const firstMac = output.split('\n')[0].split(',')[0].replace(/"/g, '');
      if (firstMac) return `WIN-${firstMac.replace(/-/g, '')}`;
    }

    const output = execSync('ip link show | grep "link/ether" | head -1', { 
      encoding: 'utf-8' 
    });
    const macMatch = output.match(/([0-9a-fA-F:]{17})/);
    if (macMatch && macMatch[1]) {
      return `MAC-${macMatch[1].replace(/:/g, '')}`;
    }
  } catch (error) {
    console.error('[Hardware] Error extracting MAC address:', error);
  }
  
  throw new Error('Unable to determine unique hardware identifier');
}

class HardwareController {
  constructor() {
    this.coinPulses = 0;
    this.onPulseCallback = () => {};
    console.log('Hardware Controller Initialized (GPIO Pin 3)');
  }

  // Simulate a hardware interrupt from the coin slot
  // In real Node: gpio.on('interrupt', (val) => { ... })
  simulateCoinInsert(pesos) {
    const pulses = pesos === 1 ? 1 : pesos === 5 ? 5 : 10;
    this.coinPulses += pulses;
    this.onPulseCallback(pesos);
  }

  onCreditDetected(callback) {
    this.onPulseCallback = callback;
  }

  resetPulses() {
    this.coinPulses = 0;
  }

  getStatus() {
    return {
      board: 'Raspberry Pi / Orange Pi',
      pin: 3,
      mode: 'Input',
      pull: 'Up'
    };
  }
}

const hardware = new HardwareController();

module.exports.getHardwareSerial = getHardwareSerial;
module.exports.getUniqueHardwareId = getUniqueHardwareId;
module.exports.HardwareController = HardwareController;
module.exports.hardware = hardware;