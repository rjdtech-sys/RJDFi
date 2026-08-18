const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./auth');

const dbPath = path.resolve(__dirname, '../pisowifi.sqlite');
const DATA_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Self-Healing Database Recovery (Pure Node.js — no sqlite3 CLI needed) ───
// Opens each DB file, runs integrity_check, and if corrupt:
// backs up the file, deletes it, and lets init() recreate fresh.
const ALL_DB_FILES = {
  'pisowifi.sqlite': dbPath,
  'sales.sqlite': path.join(DATA_DIR, 'sales.sqlite'),
  'network.sqlite': path.join(DATA_DIR, 'network.sqlite'),
  'devices.sqlite': path.join(DATA_DIR, 'devices.sqlite'),
  'hardware.sqlite': path.join(DATA_DIR, 'hardware.sqlite')
};

function checkAndRecoverSync(dbFilePath, dbName) {
  if (!fs.existsSync(dbFilePath)) return false;
  if (fs.statSync(dbFilePath).size === 0) return false;

  return new Promise((resolve) => {
    const checkDb = new sqlite3.Database(dbFilePath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) {
        console.error(`[DB] Cannot open ${dbName}: ${openErr.message}`);
        checkDb.close(() => {});
        resolve(true);
        return;
      }
      checkDb.get('PRAGMA integrity_check', (err, row) => {
        checkDb.close(() => {});
        if (err || !row || row['integrity_check'] !== 'ok') {
          console.error(`[DB] CORRUPTION DETECTED in ${dbName}: ${(err && err.message) || 'integrity check failed'}`);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
    setTimeout(() => {
      try { checkDb.close(() => {}); } catch {}
      resolve(true);
    }, 5000);
  });
}

async function recoverDatabase(dbFilePath, dbName) {
  const backupPath = dbFilePath + '.corrupted.' + Date.now();
  console.log(`[DB] Recovering ${dbName}...`);

  try {
    fs.renameSync(dbFilePath, backupPath);
    console.log(`[DB] Corrupted ${dbName} backed up to ${path.basename(backupPath)}`);
  } catch (e) {
    console.error(`[DB] Failed to backup ${dbName}: ${e.message}`);
    return;
  }

  try { fs.unlinkSync(dbFilePath + '-wal'); } catch {}
  try { fs.unlinkSync(dbFilePath + '-shm'); } catch {}

  const recoveredData = {};
  const corruptedDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY);
  try {
    const tables = await new Promise((resolve) => {
      corruptedDb.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
        resolve(rows || []);
      });
    });

    for (const table of tables) {
      const tableName = table.name;
      if (tableName.startsWith('sqlite_')) continue;
      try {
        const rows = await new Promise((resolve) => {
          corruptedDb.all(`SELECT * FROM "${tableName}"`, (err, rows) => {
            resolve(rows || []);
          });
        });
        if (rows.length > 0) {
          recoveredData[tableName] = rows;
        }
      } catch (e) {
        console.log(`[DB] Table '${tableName}' in ${dbName} is unreadable — will be recreated`);
      }
    }
  } catch (e) {
    console.log(`[DB] Could not read any data from corrupted ${dbName}`);
  }
  corruptedDb.close(() => {});

  const freshDb = await new Promise((resolve) => {
    const newDb = new sqlite3.Database(dbFilePath);
    newDb.run('PRAGMA journal_mode=WAL');
    newDb.run('PRAGMA synchronous=NORMAL');
    setTimeout(() => resolve(newDb), 500);
  });

  let restoredCount = 0;
  for (const [tableName, rows] of Object.entries(recoveredData)) {
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const colNames = cols.map(c => `"${c}"`).join(', ');
    const stmt = freshDb.prepare(`INSERT OR IGNORE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`);
    for (const row of rows) {
      try {
        stmt.run(cols.map(c => row[c]));
        restoredCount++;
      } catch (e) {}
    }
    stmt.finalize(() => {});
  }

  await new Promise((resolve) => freshDb.close(resolve));

  if (restoredCount > 0) {
    console.log(`[DB] Recovered ${restoredCount} rows into fresh ${dbName}`);
  }
  console.log(`[DB] ${dbName} reset to clean state. init() will recreate schema.`);
}

// ─── Open DB connection SYNCHRONOUSLY so server.js can use it immediately ───
let db = new sqlite3.Database(dbPath);

// Enable WAL mode and busy timeout
db.run('PRAGMA journal_mode=WAL');
db.run('PRAGMA busy_timeout=5000');
db.run('PRAGMA synchronous=NORMAL');
db.run('PRAGMA cache_size=-2000');
db.run('PRAGMA temp_store=MEMORY');
db.run('PRAGMA wal_autocheckpoint=1000');

// ─── Async integrity check runs AFTER connection is open ───
// If corruption is found, it recovers and re-initializes.
(async () => {
  try {
    console.log('[DB] Running integrity check on all databases...');
    for (const [name, filePath] of Object.entries(ALL_DB_FILES)) {
      if (fs.existsSync(filePath)) {
        const needsRecovery = await checkAndRecoverSync(filePath, name);
        if (needsRecovery) {
          await recoverDatabase(filePath, name);
        }
      }
    }
    console.log('[DB] All databases OK.');
  } catch (e) {
    console.error('[DB] Integrity check error:', e.message);
  }
})();

const DB_FILES = {
  sales: path.join(DATA_DIR, 'sales.sqlite'),
  network: path.join(DATA_DIR, 'network.sqlite'),
  devices: path.join(DATA_DIR, 'devices.sqlite'),
  hardware: path.join(DATA_DIR, 'hardware.sqlite')
};

// Table to Database Mapping
// If a table is not listed here, it stays in 'main' (pisowifi.sqlite)
const TABLE_MAPPING = {
  // Sales & Vouchers
  'sales': 'sales',
  'vouchers': 'sales',
  'rates': 'sales',
  'pppoe_sales': 'sales',

  // Network
  'vlans': 'network',
  'bridges': 'network',
  'multi_wan_config': 'network',
  'wan_interfaces': 'network',
  'pppoe_server': 'network',
  'pppoe_users': 'network',
  'pppoe_profiles': 'network',
  'pppoe_billing_profiles': 'network',
  'pppoe_pools': 'network',
  'pppoe_invoices': 'network',
  'gaming_rules': 'network',
  'mikrotik_routers': 'network',
  'mikrotik_billing_plans': 'network',
  'mikrotik_sales': 'network',
  'mikrotik_secret_duedates': 'network',

  // Devices & Sessions
  'wifi_devices': 'devices',
  'device_sessions': 'devices',
  'sessions': 'devices',
  'referral_codes': 'devices',
  'referral_events': 'devices',

  // Hardware
  'wireless_settings': 'hardware',
  'hotspots': 'hardware',
};

// ─── Runtime Corruption Auto-Recovery ───
let _isRecovering = false;
let _corruptDetected = false;

async function handleCorruption() {
  if (_isRecovering) return;
  _isRecovering = true;
  _corruptDetected = true;
  console.error('[DB] SQLITE_CORRUPT detected at runtime — initiating emergency recovery...');
  try {
    // Close current connection
    await new Promise((resolve) => {
      try { db.close(() => resolve()); } catch { resolve(); }
    });

    // Backup and delete corrupted main DB
    const backupPath = dbPath + '.corrupted.' + Date.now();
    try { fs.renameSync(dbPath, backupPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    console.log(`[DB] Corrupted DB backed up, creating fresh database...`);

    // Reopen fresh connection
    db = new sqlite3.Database(dbPath);
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA busy_timeout=5000');
    db.run('PRAGMA synchronous=NORMAL');
    db.run('PRAGMA cache_size=-2000');
    db.run('PRAGMA temp_store=MEMORY');
    db.run('PRAGMA wal_autocheckpoint=1000');
    // Re-init schema
    await init();
    console.log('[DB] Emergency recovery complete — fresh database created with schema.');
  } catch (e) {
    console.error('[DB] Emergency recovery failed:', e.message);
  }
  _isRecovering = false;
}

const run = (query, params = [], maxRetries = 3) => {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount) => {
      if (!db) return reject(new Error('DB not ready'));
      db.run(query, params, function(err) {
        if (err) {
          if (err.code === 'SQLITE_CORRUPT') {
            handleCorruption().catch(() => {});
            return reject(err);
          }
          if (err.code === 'SQLITE_BUSY' && retryCount < maxRetries) {
            console.log(`[DB] SQLITE_BUSY, retrying (${retryCount + 1}/${maxRetries})...`);
            setTimeout(() => attempt(retryCount + 1), 100 * (retryCount + 1));
          } else {
            reject(err);
          }
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    };
    attempt(0);
  });
};

const all = (query, params = [], maxRetries = 3) => {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount) => {
      if (!db) return reject(new Error('DB not ready'));
      db.all(query, params, (err, rows) => {
        if (err) {
          if (err.code === 'SQLITE_CORRUPT') {
            handleCorruption().catch(() => {});
            return reject(err);
          }
          if (err.code === 'SQLITE_BUSY' && retryCount < maxRetries) {
            console.log(`[DB] SQLITE_BUSY, retrying (${retryCount + 1}/${maxRetries})...`);
            setTimeout(() => attempt(retryCount + 1), 100 * (retryCount + 1));
          } else {
            reject(err);
          }
        } else {
          resolve(rows);
        }
      });
    };
    attempt(0);
  });
};

const get = (query, params = [], maxRetries = 3) => {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount) => {
      if (!db) return reject(new Error('DB not ready'));
      db.get(query, params, (err, row) => {
        if (err) {
          if (err.code === 'SQLITE_CORRUPT') {
            handleCorruption().catch(() => {});
            return reject(err);
          }
          if (err.code === 'SQLITE_BUSY' && retryCount < maxRetries) {
            console.log(`[DB] SQLITE_BUSY, retrying (${retryCount + 1}/${maxRetries})...`);
            setTimeout(() => attempt(retryCount + 1), 100 * (retryCount + 1));
          } else {
            reject(err);
          }
        } else {
          resolve(row);
        }
      });
    };
    attempt(0);
  });
};

const close = () => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Helper to get qualified table name (e.g., 'sales.vouchers')
const getQualifiedTableName = (tableName) => {
  const targetDb = TABLE_MAPPING[tableName] || 'main';
  return targetDb === 'main' ? tableName : `${targetDb}.${tableName}`;
};

async function createTable(tableName, schemaBody) {
  const targetDb = TABLE_MAPPING[tableName] || 'main';
  const qualifiedName = getQualifiedTableName(tableName);
  
  // Migration Logic: Check if table exists in MAIN but belongs to ATTACHED
  if (targetDb !== 'main') {
    try {
      const mainExists = await get(`SELECT name FROM main.sqlite_master WHERE type='table' AND name='${tableName}'`);
      if (mainExists) {
        console.log(`[DB] Migrating table '${tableName}' from main to '${targetDb}'...`);
        
        // 1. Create table in target DB
        await run(`CREATE TABLE IF NOT EXISTS ${qualifiedName} ${schemaBody}`);
        
        // 2. Copy data
        // Check if table is empty before copying to avoid duplicates if migration partially failed before
        const targetCount = await get(`SELECT count(*) as count FROM ${qualifiedName}`);
        if (targetCount.count === 0) {
           await run(`INSERT INTO ${qualifiedName} SELECT * FROM main.${tableName}`);
           console.log(`[DB] Data copied for '${tableName}'`);
        } else {
           console.log(`[DB] Target table '${qualifiedName}' not empty, skipping data copy.`);
        }
        
        // 3. Drop from main
        // await run(`DROP TABLE main.${tableName}`); // DISABLED for safety during first run, user can delete manually or we uncomment later
        // Actually, we should rename it to backup just in case
        await run(`ALTER TABLE main.${tableName} RENAME TO backup_${tableName}_migrated`);
        console.log(`[DB] Original table renamed to 'backup_${tableName}_migrated'`);
        return;
      }
    } catch (e) {
      console.error(`[DB] Migration check failed for ${tableName}:`, e.message);
    }
  }
  
  await run(`CREATE TABLE IF NOT EXISTS ${qualifiedName} ${schemaBody}`);
}

async function factoryResetDB() {
  const tables = [
    'rates', 'sessions', 'config', 'hotspots', 'wireless_settings', 
    'wifi_devices', 'device_sessions', 'vlans', 'bridges', 
    'pppoe_server', 'pppoe_users', 'pppoe_profiles', 'pppoe_billing_profiles', 'pppoe_pools',
    'chat_messages', 'gaming_rules', 'vouchers', 'license_info', 'multi_wan_config', 'admin',
    'sales',
    'mikrotik_routers',
    'mikrotik_billing_plans',
    'mikrotik_sales',
    'mikrotik_secret_duedates',
    'employees',
    'dtr_records',
    'payroll_records',
    'equipment',
    'equipment_withdrawals',
    'equipment_withdrawal_items',
    'rental_devices',
    'rental_sessions',
    'rental_payments',
    'rental_device_config',
    'referral_codes',
    'referral_events'
  ];
  
  // Truncate admin_sessions instead of dropping
  try {
    await run('DELETE FROM admin_sessions');
  } catch (e) {}

  for (const table of tables) {
    const qualified = getQualifiedTableName(table);
    await run(`DROP TABLE IF EXISTS ${qualified}`);
  }
  await init();
}

async function init() {
  console.log('[DB] Initializing database system...');
  
  // 1. Attach Databases
  for (const [alias, filePath] of Object.entries(DB_FILES)) {
    try {
      // Check if file exists, if not sqlite creates it
      await run(`ATTACH DATABASE '${filePath}' AS ${alias}`);
    } catch (e) {
      if (!e.message.includes('already in use')) {
        console.error(`[DB] Failed to attach ${alias}:`, e.message);
      }
    }
  }

  // 2. Create Tables (Using helper for migration support)
  
  // --- SALES DB ---
  await createTable('rates', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pesos INTEGER,
    minutes INTEGER,
    expiration_hours INTEGER,
    is_pausable INTEGER DEFAULT 1,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0
  )`);

  await createTable('sales', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac TEXT,
    ip TEXT,
    amount INTEGER,
    minutes INTEGER,
    type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    machine_id TEXT
  )`);

  await createTable('pppoe_sales', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_number TEXT,
    username TEXT NOT NULL,
    billing_profile_id INTEGER,
    billing_profile_name TEXT,
    profile_name TEXT,
    amount REAL DEFAULT 0,
    gross_amount REAL DEFAULT 0,
    discount_days INTEGER DEFAULT 0,
    net_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    prev_expires_at DATETIME,
    new_expires_at DATETIME,
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT
  )`);

  await createTable('vouchers', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL,
    time_minutes INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    used_by_mac TEXT,
    used_by_ip TEXT,
    is_used INTEGER DEFAULT 0,
    created_by TEXT,
    voucher_type TEXT DEFAULT 'time_based',
    duration_days INTEGER,
    expires_at DATETIME,
    status TEXT DEFAULT 'unused',
    activated_at DATETIME
  )`);
  
  // --- DEVICES DB ---
  await createTable('sessions', `(
    mac TEXT PRIMARY KEY,
    ip TEXT,
    remaining_seconds INTEGER,
    total_paid INTEGER,
    connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0,
    token TEXT,
    is_paused INTEGER DEFAULT 0,
    pausable INTEGER DEFAULT 1,
    expired_at DATETIME,
    updated_at DATETIME,
    rate_expires_at INTEGER
  )`);

  await createTable('wifi_devices', `(
    id TEXT PRIMARY KEY,
    mac TEXT NOT NULL,
    ip TEXT NOT NULL,
    hostname TEXT,
    interface TEXT NOT NULL,
    ssid TEXT,
    signal INTEGER DEFAULT 0,
    connected_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    session_time INTEGER,
    is_active INTEGER DEFAULT 0,
    custom_name TEXT,
    credit_pesos INTEGER DEFAULT 0,
    credit_minutes INTEGER DEFAULT 0,
    download_limit INTEGER DEFAULT 0,
    upload_limit INTEGER DEFAULT 0
  )`);

  await createTable('device_sessions', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER DEFAULT 0,
    data_used INTEGER DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES wifi_devices(id)
  )`);

  // Referral Codes (one unique code per device MAC)
  await createTable('referral_codes', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Referral Events (audit log of referral redemptions and point awards)
  await createTable('referral_events', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_mac TEXT NOT NULL,
    referee_mac TEXT NOT NULL,
    referee_ip TEXT,
    referral_code TEXT NOT NULL,
    pesos_spent INTEGER DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    referee_bonus_minutes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Player Credits (token-based, for game winnings)
  await createTable('player_credits', `(
    token TEXT PRIMARY KEY,
    credits INTEGER DEFAULT 0,
    total_earned INTEGER DEFAULT 0,
    total_redeemed INTEGER DEFAULT 0,
    last_spin_at DATETIME,
    spins_today INTEGER DEFAULT 0,
    spins_date TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Game Spins Audit Log
  await createTable('game_spins', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    prize_value INTEGER DEFAULT 0,
    prize_label TEXT DEFAULT '',
    cost INTEGER DEFAULT 0,
    spun_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- HARDWARE DB ---
  await createTable('hotspots', `(
    interface TEXT PRIMARY KEY,
    ip_address TEXT,
    dhcp_range TEXT,
    bandwidth_limit INTEGER,
    enabled INTEGER DEFAULT 0
  )`);

  await createTable('wireless_settings', `(
    interface TEXT PRIMARY KEY,
    ssid TEXT,
    password TEXT,
    channel INTEGER DEFAULT 1,
    hw_mode TEXT DEFAULT 'g',
    bridge TEXT
  )`);

  // --- NETWORK DB ---
  await createTable('vlans', `(
    name TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    id INTEGER NOT NULL
  )`);

  await createTable('bridges', `(
    name TEXT PRIMARY KEY,
    members TEXT NOT NULL, -- JSON array of interface names
    stp INTEGER DEFAULT 0
  )`);

  await createTable('multi_wan_config', `(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER DEFAULT 0,
    topology TEXT DEFAULT 'single', -- 'single' or 'multi'
    mode TEXT DEFAULT 'pcc', -- 'pcc' or 'ecmp'
    pcc_method TEXT DEFAULT 'both_addresses', -- 'both_addresses', 'both_addresses_ports'
    interfaces TEXT DEFAULT '[]' -- JSON array of interfaces
  )`);

  await createTable('wan_interfaces', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'dhcp', -- 'dhcp', 'static', 'pppoe'
    config TEXT DEFAULT '{}', -- JSON config object
    gateway TEXT,
    weight INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    is_vlan INTEGER DEFAULT 0,
    vlan_parent TEXT,
    vlan_id INTEGER,
    status TEXT DEFAULT 'down',
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('gaming_rules', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL, -- 'tcp', 'udp', 'both'
    port_start INTEGER NOT NULL,
    port_end INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1
  )`);

  await createTable('pppoe_server', `(
    interface TEXT PRIMARY KEY,
    local_ip TEXT NOT NULL,
    ip_pool_start TEXT NOT NULL,
    ip_pool_end TEXT NOT NULL,
    dns1 TEXT DEFAULT '8.8.8.8',
    dns2 TEXT DEFAULT '8.8.4.4',
    service_name TEXT DEFAULT '',
    enabled INTEGER DEFAULT 0
  )`);

  await createTable('pppoe_users', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_number TEXT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    ip_address TEXT,
    billing_profile_id INTEGER,
    full_name TEXT,
    address TEXT,
    contact_number TEXT,
    email TEXT,
    billing_start_at DATETIME,
    billing_cycle_day INTEGER,
    form_pdf_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_profiles', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rate_limit_dl INTEGER DEFAULT 0,
    rate_limit_ul INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_billing_profiles', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (profile_id) REFERENCES pppoe_profiles(id)
  )`);

  await createTable('pppoe_pools', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    ip_pool_start TEXT NOT NULL,
    ip_pool_end TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('pppoe_invoices', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    account_number TEXT,
    username TEXT NOT NULL,
    billing_profile_id INTEGER,
    billing_profile_name TEXT,
    profile_name TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    period_start DATETIME,
    period_end DATETIME,
    expires_at DATETIME,
    pdf_path TEXT,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('mikrotik_routers', `(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 8728,
    connection_type TEXT NOT NULL DEFAULT 'api',
    rest_scheme TEXT NOT NULL DEFAULT 'http',
    username TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    last_checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('mikrotik_billing_plans', `(
    id TEXT PRIMARY KEY,
    router_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    pppoe_profile TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
  )`);

  await createTable('mikrotik_sales', `(
    id TEXT PRIMARY KEY,
    router_id TEXT NOT NULL,
    secret_id TEXT,
    username TEXT NOT NULL,
    billing_plan_id TEXT,
    plan_name TEXT,
    amount REAL NOT NULL DEFAULT 0,
    original_amount REAL NOT NULL DEFAULT 0,
    num_months INTEGER DEFAULT 1,
    discount_days INTEGER DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'PHP',
    payment_date DATETIME NOT NULL,
    next_duedate DATETIME NOT NULL,
    expired_profile TEXT,
    payment_method TEXT DEFAULT 'cash',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
  )`);

  // Migration: Add discount columns to existing mikrotik_sales table
  await run('ALTER TABLE mikrotik_sales ADD COLUMN original_amount REAL NOT NULL DEFAULT 0').catch(() => {});
  await run('ALTER TABLE mikrotik_sales ADD COLUMN num_months INTEGER DEFAULT 1').catch(() => {});
  await run('ALTER TABLE mikrotik_sales ADD COLUMN discount_days INTEGER DEFAULT 0').catch(() => {});
  await run('ALTER TABLE mikrotik_sales ADD COLUMN discount_amount REAL DEFAULT 0').catch(() => {});

  // Table for storing PPPoE secret due dates (MikroTik doesn't support this natively)
  // Migration: Drop old table and recreate with correct UNIQUE constraint on username
  await run('DROP TABLE IF EXISTS mikrotik_secret_duedates').catch(() => {});
  await createTable('mikrotik_secret_duedates', `(
    id TEXT PRIMARY KEY,
    router_id TEXT NOT NULL,
    secret_id TEXT,
    username TEXT NOT NULL,
    duedate DATETIME NOT NULL,
    expired_profile TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
    UNIQUE(router_id, username)
  )`);

  // Migration: Backfill due dates from mikrotik_sales to mikrotik_secret_duedates
  try {
    const latestPayments = await db.all(`
      SELECT DISTINCT username, router_id, next_duedate, expired_profile
      FROM mikrotik_sales
      WHERE id IN (
        SELECT MAX(id) FROM mikrotik_sales GROUP BY username, router_id
      )
    `);
    
    if (latestPayments && latestPayments.length > 0) {
      const crypto = require('crypto');
      for (const payment of latestPayments) {
        const dueDateId = crypto.randomUUID();
        await run(
          'INSERT OR IGNORE INTO mikrotik_secret_duedates (id, router_id, secret_id, username, duedate, expired_profile) VALUES (?, ?, ?, ?, ?, ?)',
          [dueDateId, payment.router_id, '', payment.username, payment.next_duedate, payment.expired_profile || '']
        ).catch(() => {});
      }
      console.log(`[Migration] Backfilled ${latestPayments.length} due dates from sales records`);
    }
  } catch (err) {
    console.error('[Migration] Failed to backfill due dates:', err);
  }

  // --- MAIN DB (System) ---
  await createTable('config', `(
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  await createTable('admin', `(
    username TEXT PRIMARY KEY,
    password_hash TEXT,
    salt TEXT
  )`);

  await createTable('admin_sessions', `(
    token TEXT PRIMARY KEY,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  )`);

  await createTable('chat_messages', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    recipient TEXT,
    message TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  )`);

  await createTable('license_info', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hardware_id TEXT UNIQUE NOT NULL,
    license_key TEXT,
    is_active INTEGER DEFAULT 0,
    is_revoked INTEGER DEFAULT 0,
    activated_at DATETIME,
    expires_at DATETIME,
    trial_started_at DATETIME,
    trial_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- EMPLOYEE MANAGEMENT TABLES ---
  await createTable('employees', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    position TEXT NOT NULL,
    contact_number TEXT,
    email TEXT,
    address TEXT,
    daily_rate REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('dtr_records', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    record_date DATE NOT NULL,
    time_in DATETIME,
    time_out DATETIME,
    total_hours REAL DEFAULT 0,
    status TEXT DEFAULT 'present',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )`);

  await createTable('payroll_records', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_days INTEGER DEFAULT 0,
    total_hours REAL DEFAULT 0,
    daily_rate REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    net_pay REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
  )`);

  // --- EQUIPMENT INVENTORY TABLES ---
  await createTable('equipment', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    serial_number TEXT,
    mac_address TEXT,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('equipment_withdrawals', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    withdrawal_date DATE NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('equipment_withdrawal_items', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    withdrawal_id INTEGER NOT NULL,
    equipment_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (withdrawal_id) REFERENCES equipment_withdrawals(id),
    FOREIGN KEY (equipment_id) REFERENCES equipment(id)
  )`);

  // --- PHONE RENTAL TABLES ---
  await createTable('rental_devices', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_name TEXT NOT NULL,
    mac_address TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    android_id TEXT,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    rental_rate_per_hour REAL NOT NULL DEFAULT 20,
    max_rental_hours INTEGER NOT NULL DEFAULT 8,
    total_revenue REAL DEFAULT 0,
    total_rentals INTEGER DEFAULT 0,
    last_rented_at DATETIME,
    last_returned_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await createTable('rental_sessions', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    customer_name TEXT,
    customer_contact TEXT,
    start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    duration_minutes INTEGER NOT NULL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    kiosk_logout_at DATETIME,
    paused_remaining_seconds INTEGER,
    kiosk_logout_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES rental_devices(id)
  )`);

  await createTable('rental_payments', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (session_id) REFERENCES rental_sessions(id)
  )`);

  await createTable('rental_device_config', `(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL UNIQUE,
    allowed_apps TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES rental_devices(id)
  )`);

  // Initialize phone rental rates config if not exists
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('phoneRentalRates', '[{"id":"1","pesos":10,"minutes":60,"label":"1 Hour"},{"id":"2","pesos":20,"minutes":130,"label":"2 Hours"},{"id":"3","pesos":50,"minutes":360,"label":"6 Hours"}]')`);

  // 3. Post-Creation Migrations (Column additions for existing tables)
  // Helper to safely run ALTER TABLE on correct DB
  const safeAlter = async (tableName, sqlSuffix) => {
    const qualified = getQualifiedTableName(tableName);
    try {
      await run(`ALTER TABLE ${qualified} ${sqlSuffix}`);
    } catch (e) {
      // Ignore "duplicate column name" error
    }
  };

  // Rates
  await safeAlter('rates', "ADD COLUMN expiration_hours INTEGER");

  await safeAlter('pppoe_users', "ADD COLUMN expires_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN expired_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN last_billed_at DATETIME");
  await safeAlter('rates', "ADD COLUMN is_pausable INTEGER DEFAULT 1");
  await safeAlter('rates', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('rates', "ADD COLUMN upload_limit INTEGER DEFAULT 0");

  // Sessions
  await safeAlter('sessions', "ADD COLUMN token TEXT");
  await safeAlter('sessions', "ADD COLUMN pausable INTEGER DEFAULT 1");
  await safeAlter('sessions', "ADD COLUMN is_paused INTEGER DEFAULT 0");
  await safeAlter('sessions', "ADD COLUMN expired_at DATETIME");
  await safeAlter('sessions', "ADD COLUMN updated_at DATETIME");
  await safeAlter('sessions', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('sessions', "ADD COLUMN upload_limit INTEGER DEFAULT 0");
  await safeAlter('sessions', "ADD COLUMN rate_expires_at INTEGER");

  // Wifi Devices
  await safeAlter('wifi_devices', "ADD COLUMN credit_pesos INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN credit_minutes INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN download_limit INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN upload_limit INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN pending_reward_amount INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN total_rewards_earned INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN referral_code TEXT");
  await safeAlter('wifi_devices', "ADD COLUMN referred_by TEXT");
  await safeAlter('wifi_devices', "ADD COLUMN referral_points INTEGER DEFAULT 0");
  await safeAlter('wifi_devices', "ADD COLUMN first_seen_at DATETIME");
  await safeAlter('wifi_devices', "ADD COLUMN subscription_type TEXT");
  await safeAlter('wifi_devices', "ADD COLUMN subscription_expires_at INTEGER");

  // Wireless Settings
  await safeAlter('wireless_settings', "ADD COLUMN bridge TEXT");

  // License Info
  await safeAlter('license_info', "ADD COLUMN is_revoked INTEGER DEFAULT 0");
  await safeAlter('license_info', "ADD COLUMN expires_at DATETIME");

  // PPPoE Users
  await safeAlter('pppoe_users', "ADD COLUMN billing_profile_id INTEGER");
  await safeAlter('pppoe_users', "ADD COLUMN account_number TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN is_online INTEGER DEFAULT 0");
  await safeAlter('pppoe_users', "ADD COLUMN last_online_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN last_offline_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN billing_start_at DATETIME");
  await safeAlter('pppoe_users', "ADD COLUMN billing_cycle_day INTEGER");
  await safeAlter('pppoe_users', "ADD COLUMN full_name TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN address TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN contact_number TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN email TEXT");
  await safeAlter('pppoe_users', "ADD COLUMN form_pdf_path TEXT");

  await safeAlter('pppoe_sales', "ADD COLUMN gross_amount REAL DEFAULT 0");
  await safeAlter('pppoe_sales', "ADD COLUMN discount_days INTEGER DEFAULT 0");
  await safeAlter('pppoe_sales', "ADD COLUMN net_amount REAL DEFAULT 0");
  await safeAlter('pppoe_sales', "ADD COLUMN prev_expires_at DATETIME");
  await safeAlter('pppoe_sales', "ADD COLUMN new_expires_at DATETIME");

  // MikroTik Routers
  await safeAlter('mikrotik_routers', "ADD COLUMN connection_type TEXT NOT NULL DEFAULT 'api'");
  await safeAlter('mikrotik_routers', "ADD COLUMN rest_scheme TEXT NOT NULL DEFAULT 'http'");

  // Rental Devices - Activation columns
  await safeAlter('rental_devices', "ADD COLUMN activation_status TEXT NOT NULL DEFAULT 'trial'"); // pending|trial|active|expired|deactivated|rejected
  await safeAlter('rental_devices', "ADD COLUMN activation_key TEXT");
  await safeAlter('rental_devices', "ADD COLUMN trial_started_at DATETIME");
  await safeAlter('rental_devices', "ADD COLUMN trial_expires_at DATETIME");
  await safeAlter('rental_devices', "ADD COLUMN license_expires_at DATETIME");
  await safeAlter('rental_devices', "ADD COLUMN accepted_by_vendor INTEGER DEFAULT 0");
  await safeAlter('rental_devices', "ADD COLUMN cloud_device_id TEXT"); // Supabase UUID
  await safeAlter('rental_devices', "ADD COLUMN deactivated_at DATETIME");
  await safeAlter('rental_devices', "ADD COLUMN total_sessions INTEGER DEFAULT 0");
  await safeAlter('rental_devices', "ADD COLUMN wallpaper_path TEXT");

  // Rental Sessions - Kiosk logout columns
  await safeAlter('rental_sessions', "ADD COLUMN kiosk_logout_at DATETIME");
  await safeAlter('rental_sessions', "ADD COLUMN paused_remaining_seconds INTEGER");
  await safeAlter('rental_sessions', "ADD COLUMN kiosk_logout_reason TEXT");
  await safeAlter('rental_sessions', "ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash'");

  // 4. Seeding Defaults
  const gamingRulesCount = await get(`SELECT COUNT(*) as count FROM ${getQualifiedTableName('gaming_rules')}`);
  if (gamingRulesCount.count === 0) {
    console.log('[DB] Seeding default gaming rules...');
    const defaultRules = [
      { name: 'Mobile Legends', protocol: 'both', port_start: 30000, port_end: 30300 },
      { name: 'Mobile Legends (Voice)', protocol: 'udp', port_start: 5000, port_end: 5200 },
      { name: 'Call of Duty Mobile', protocol: 'udp', port_start: 7000, port_end: 9000 },
      { name: 'PUBG Mobile', protocol: 'udp', port_start: 10000, port_end: 20000 },
      { name: 'League of Legends: Wild Rift', protocol: 'both', port_start: 10001, port_end: 10010 },
      { name: 'Roblox', protocol: 'udp', port_start: 49152, port_end: 65535 }
    ];

    for (const rule of defaultRules) {
      await run(`INSERT INTO ${getQualifiedTableName('gaming_rules')} (name, protocol, port_start, port_end, enabled) VALUES (?, ?, ?, ?, ?)`, 
        [rule.name, rule.protocol, rule.port_start, rule.port_end, 1]);
    }
  }

  // Create Admin
  const { salt, hash } = hashPassword('admin');
  await run(`INSERT OR IGNORE INTO admin (username, password_hash, salt) VALUES (?, ?, ?)`, ['admin', hash, salt]);

  // Dynamic Hardware Board Auto-Detection (Raspberry Pi vs Orange Pi / Armbian vs x64 PC)
  const fs = require('fs');
  let detectedBoardType = 'raspberry_pi';
  let detectedBoardModel = 'raspberry_pi_4b';
  let detectedCoinPin = '2';

  try {
    if (fs.existsSync('/proc/device-tree/model')) {
      const dtModel = fs.readFileSync('/proc/device-tree/model', 'utf8');
      if (dtModel.includes('Raspberry Pi')) {
        detectedBoardType = 'raspberry_pi';
        if (dtModel.includes('Pi 5')) detectedBoardModel = 'raspberry_pi_5';
        else if (dtModel.includes('Pi 3') || dtModel.includes('Pi 2')) detectedBoardModel = 'raspberry_pi_2b_3b';
        else if (dtModel.includes('Zero')) detectedBoardModel = 'raspberry_pi_zero';
      }
    }

    if (fs.existsSync('/etc/armbian-release') || (fs.existsSync('/proc/cpuinfo') && fs.readFileSync('/proc/cpuinfo', 'utf8').toLowerCase().includes('orange pi'))) {
      detectedBoardType = 'orange_pi';
      detectedBoardModel = 'orange_pi_one';
      detectedCoinPin = '3';
      if (fs.existsSync('/etc/armbian-release')) {
        const armbian = fs.readFileSync('/etc/armbian-release', 'utf8');
        const m = armbian.match(/^BOARD\s*=\s*"?(.+?)"?$/m);
        if (m) {
          const b = m[1].trim().toLowerCase();
          if (b.includes('one')) detectedBoardModel = 'orange_pi_one';
          else if (b.includes('pc2')) detectedBoardModel = 'orange_pi_pc2';
          else if (b.includes('pc')) detectedBoardModel = 'orange_pi_pc';
          else if (b.includes('lite')) detectedBoardModel = 'orange_pi_lite';
          else if (b.includes('zero3')) detectedBoardModel = 'orange_pi_zero3';
          else if (b.includes('zero')) detectedBoardModel = 'orange_pi_zero';
          else if (b.includes('3b')) detectedBoardModel = 'orange_pi_3b';
          else if (b.includes('5')) detectedBoardModel = 'orange_pi_5';
        }
      }
    } else if (process.arch === 'x64') {
      detectedBoardType = 'x64_pc';
      detectedBoardModel = null;
      detectedCoinPin = null;
    }
  } catch (e) {}

  // Auto-correct boardType on Armbian / Orange Pi systems if wrongly defaulted to raspberry_pi
  if (detectedBoardType === 'orange_pi') {
    try {
      const currentBoard = await get("SELECT value FROM config WHERE key = 'boardType'");
      if (!currentBoard || currentBoard.value === 'raspberry_pi') {
        if (fs.existsSync('/etc/armbian-release') && !fs.existsSync('/proc/device-tree/model')) {
          await run("UPDATE config SET value = 'orange_pi' WHERE key = 'boardType'");
          await run("INSERT OR REPLACE INTO config (key, value) VALUES ('boardModel', ?)", [detectedBoardModel]);
          console.log(`[DB] Auto-detected Orange Pi / Armbian system! Auto-updated boardType to 'orange_pi' (${detectedBoardModel}).`);
        }
      }
    } catch (e) {}
  }

  // Seed Config
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('boardType', ?)`, [detectedBoardType]);
  if (detectedBoardModel) {
    await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('boardModel', ?)`, [detectedBoardModel]);
  }
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('coinPin', ?)`, [detectedCoinPin]);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('qos_discipline', 'cake')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('serialPort', '/dev/ttyUSB0')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('espIpAddress', '192.168.4.1')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('espPort', '80')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('coinSlots', '[]')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('latestFirmwareVersion', '2.0')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('nodemcuDevices', '[]')`);

  // Game & Rewards Config
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('game_enabled', 'false')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('game_cost_per_spin', '5')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('game_cooldown_ms', '300000')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('game_daily_spin_limit', '20')`);
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('game_segments', '[{"label":"₱10","value":10,"weight":40,"color":"#3b82f6"},{"label":"₱25","value":25,"weight":25,"color":"#22c55e"},{"label":"₱50","value":50,"weight":15,"color":"#eab308"},{"label":"₱100","value":100,"weight":10,"color":"#ef4444"},{"label":"₱200","value":200,"weight":5,"color":"#a855f7"},{"label":"Try Again","value":0,"weight":5,"color":"#6b7280"}]')`);
  
    // Referral Config
  await run(`INSERT OR IGNORE INTO config (key, value) VALUES ('referral_config', '{"enabled":false,"referrerPointsPerPesos":20,"refereeBonusMinutes":5,"minPesosToTrigger":20}')`);

  // ─── nodemcu_devices table (replaces JSON blob in config) ───
  await run(`CREATE TABLE IF NOT EXISTS nodemcu_devices (
    id TEXT PRIMARY KEY,
    name TEXT,
    ip_address TEXT,
    mac_address TEXT UNIQUE NOT NULL,
    pin INTEGER DEFAULT 12,
    coin_pin_label TEXT DEFAULT 'D6',
    coin_pin INTEGER DEFAULT 12,
    relay_pin_label TEXT DEFAULT 'D5',
    relay_pin INTEGER DEFAULT 14,
    status TEXT DEFAULT 'pending',
    vlan_id INTEGER DEFAULT 13,
    last_seen TEXT,
    authentication_key TEXT,
    created_at TEXT,
    rates TEXT DEFAULT '[]',
    total_pulses INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    last_coins_out_date TEXT,
    last_coins_out_gross REAL,
    last_coins_out_net REAL
  )`);

  // Migrate from JSON blob to table (one-time)
  try {
    const blobRow = await get('SELECT value FROM config WHERE key = ?', ['nodemcuDevices']);
    if (blobRow?.value) {
      const devices = JSON.parse(blobRow.value);
      if (Array.isArray(devices) && devices.length > 0) {
        const tableCount = await get('SELECT COUNT(*) as cnt FROM nodemcu_devices');
        if (!tableCount || tableCount.cnt === 0) {
          console.log(`[DB] Migrating ${devices.length} NodeMCU devices from JSON blob to table...`);
          for (const d of devices) {
            await run(
              `INSERT OR IGNORE INTO nodemcu_devices (id, name, ip_address, mac_address, pin, coin_pin_label, coin_pin, relay_pin_label, relay_pin, status, vlan_id, last_seen, authentication_key, created_at, rates, total_pulses, total_revenue, last_coins_out_date, last_coins_out_gross, last_coins_out_net)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [d.id, d.name || '', d.ipAddress || '', (d.macAddress || '').toUpperCase(), d.pin || 12, d.coinPinLabel || 'D6', d.coinPin || 12, d.relayPinLabel || 'D5', d.relayPin || 14, d.status || 'pending', d.vlanId || 13, d.lastSeen || null, d.authenticationKey || '', d.createdAt || null, JSON.stringify(d.rates || []), d.totalPulses || 0, d.totalRevenue || 0, d.lastCoinsOutDate || null, d.lastCoinsOutGross || null, d.lastCoinsOutNet || null]
            );
          }
          console.log(`[DB] NodeMCU migration complete. ${devices.length} devices migrated.`);
        }
      }
    }
  } catch (e) {
    console.error('[DB] NodeMCU migration error (non-fatal):', e.message);
  }

  // Migrate multi_wan_config: add topology column if missing (must run BEFORE insert)
  try {
    const mwTable = getQualifiedTableName('multi_wan_config');
    await run(`ALTER TABLE ${mwTable} ADD COLUMN topology TEXT DEFAULT 'single'`);
  } catch (e) { /* column may already exist */ }

  // Migrate nodemcu_devices: add firmware_version column if missing
  try {
    await run(`ALTER TABLE nodemcu_devices ADD COLUMN firmware_version TEXT DEFAULT ''`);
  } catch (e) { /* column may already exist */ }

  // Migrate nodemcu_devices: add debounce_ms column if missing
  try {
    await run(`ALTER TABLE nodemcu_devices ADD COLUMN debounce_ms INTEGER DEFAULT 50`);
  } catch (e) { /* column may already exist */ }

  await run(`INSERT OR IGNORE INTO multi_wan_config (id, enabled, topology, mode, pcc_method, interfaces) VALUES (1, 0, 'single', 'pcc', 'both_addresses', '[]')`);

  // Indexes for Vouchers (qualified)
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_code ON vouchers(code)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_is_used ON vouchers(is_used)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_created_at ON vouchers(created_at)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_used_at ON vouchers(used_at)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_status ON vouchers(status)`);
    await run(`CREATE INDEX IF NOT EXISTS ${TABLE_MAPPING['vouchers']}.idx_vouchers_expires_at ON vouchers(expires_at)`);
  } catch (e) {
    // console.log(e);
  }

  // Migrate Vouchers table: add new columns for voucher types and status tracking
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`ALTER TABLE ${vTable} ADD COLUMN voucher_type TEXT DEFAULT 'time_based'`);
  } catch (e) { /* column may already exist */ }
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`ALTER TABLE ${vTable} ADD COLUMN duration_days INTEGER`);
  } catch (e) { /* column may already exist */ }
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`ALTER TABLE ${vTable} ADD COLUMN expires_at DATETIME`);
  } catch (e) { /* column may already exist */ }
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`ALTER TABLE ${vTable} ADD COLUMN status TEXT DEFAULT 'unused'`);
  } catch (e) { /* column may already exist */ }
  try {
    const vTable = getQualifiedTableName('vouchers');
    await run(`ALTER TABLE ${vTable} ADD COLUMN activated_at DATETIME`);
  } catch (e) { /* column may already exist */ }

  // ─── Self-healing: mark stale expired sessions ───
  // After DB corruption/recovery, expired_at may be NULL for all old sessions.
  // Mark them immediately so the session timer doesn't pick them up repeatedly.
  try {
    const qualified = getQualifiedTableName('sessions');
    const now = Date.now();
    const staleCheck = await get(`SELECT COUNT(*) as cnt FROM ${qualified} WHERE remaining_seconds <= 0 AND (expired_at IS NULL OR expired_at = 0)`);
    if (staleCheck && staleCheck.cnt > 0) {
      console.log(`[DB] Self-healing: marking ${staleCheck.cnt} stale expired sessions as expired...`);
      await run(`UPDATE ${qualified} SET expired_at = ? WHERE remaining_seconds <= 0 AND (expired_at IS NULL OR expired_at = 0)`, [now]);
      console.log(`[DB] Self-healing: done.`);
    }
  } catch (e) {
    console.error('[DB] Self-healing stale sessions failed:', e.message);
  }

  // ─── Coin Detection Log (persistent ring buffer) ───
  await run(`CREATE TABLE IF NOT EXISTS coin_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    event TEXT,
    amount REAL,
    slot TEXT,
    slot_name TEXT,
    source TEXT,
    mac TEXT,
    ip TEXT,
    token TEXT,
    seconds INTEGER,
    minutes REAL
  )`);
  // Trim old entries (keep last 500 in DB — in-memory shows last 100)
  try {
    await run(`DELETE FROM coin_log WHERE id NOT IN (SELECT id FROM coin_log ORDER BY id DESC LIMIT 500)`);
  } catch (e) { /* non-fatal */ }

  console.log('[DB] Initialization complete.');
}

// ─── NodeMCU Device Helpers (table-based, replaces JSON blob) ───

// Get all devices in the same format as the old JSON blob (camelCase fields)
async function getAllNodeMCUDevices() {
  const rows = await all('SELECT * FROM nodemcu_devices');
  return (rows || []).map(rowToDeviceFormat);
}

// Get a single device by MAC address
async function getNodeMCUDevice(macAddress) {
  const row = await get('SELECT * FROM nodemcu_devices WHERE mac_address = ?', [(macAddress || '').toUpperCase()]);
  return row ? rowToDeviceFormat(row) : null;
}

// Get a single device by its unique ID
async function getNodeMCUDeviceById(deviceId) {
  const row = await get('SELECT * FROM nodemcu_devices WHERE id = ?', [deviceId]);
  return row ? rowToDeviceFormat(row) : null;
}

// Get just the MAC addresses of all registered NodeMCU devices (uppercase)
async function getNodeMCUMacs() {
  const rows = await all('SELECT mac_address FROM nodemcu_devices');
  return (rows || []).map(r => r.mac_address.toUpperCase());
}

// Insert or update a device (full upsert)
async function upsertNodeMCUDevice(device) {
  const mac = (device.macAddress || '').toUpperCase();
  await run(
    `INSERT INTO nodemcu_devices (id, name, ip_address, mac_address, pin, coin_pin_label, coin_pin, relay_pin_label, relay_pin, status, vlan_id, last_seen, authentication_key, created_at, rates, total_pulses, total_revenue, last_coins_out_date, last_coins_out_gross, last_coins_out_net)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mac_address) DO UPDATE SET
       name = excluded.name, ip_address = excluded.ip_address, pin = excluded.pin,
       coin_pin_label = excluded.coin_pin_label, coin_pin = excluded.coin_pin,
       relay_pin_label = excluded.relay_pin_label, relay_pin = excluded.relay_pin,
       status = excluded.status, vlan_id = excluded.vlan_id, last_seen = excluded.last_seen,
       authentication_key = excluded.authentication_key, rates = excluded.rates,
       total_pulses = excluded.total_pulses, total_revenue = excluded.total_revenue,
       last_coins_out_date = excluded.last_coins_out_date,
       last_coins_out_gross = excluded.last_coins_out_gross,
       last_coins_out_net = excluded.last_coins_out_net`,
    [device.id, device.name || '', device.ipAddress || '', mac, device.pin || 12, device.coinPinLabel || 'D6', device.coinPin || 12, device.relayPinLabel || 'D5', device.relayPin || 14, device.status || 'pending', device.vlanId || 13, device.lastSeen || null, device.authenticationKey || '', device.createdAt || null, JSON.stringify(device.rates || []), device.totalPulses || 0, device.totalRevenue || 0, device.lastCoinsOutDate || null, device.lastCoinsOutGross || null, device.lastCoinsOutNet || null]
  );
}

// Update specific fields of a device by MAC
async function updateNodeMCUDevice(macAddress, fields) {
  const sets = [];
  const values = [];
  const fieldMap = {
    name: 'name', ipAddress: 'ip_address', ip_address: 'ip_address',
    status: 'status', lastSeen: 'last_seen', last_seen: 'last_seen',
    vlanId: 'vlan_id', pin: 'pin', coinPin: 'coin_pin', coinPinLabel: 'coin_pin_label',
    relayPin: 'relay_pin', relayPinLabel: 'relay_pin_label',
    debounceMs: 'debounce_ms',
    rates: 'rates', totalPulses: 'total_pulses', totalRevenue: 'total_revenue',
    lastCoinsOutDate: 'last_coins_out_date', lastCoinsOutGross: 'last_coins_out_gross',
    lastCoinsOutNet: 'last_coins_out_net',
    authenticationKey: 'authentication_key', createdAt: 'created_at',
    firmwareVersion: 'firmware_version', firmware_version: 'firmware_version'
  };
  for (const [key, val] of Object.entries(fields)) {
    const col = fieldMap[key];
    if (!col) continue;
    if (key === 'rates') {
      sets.push(`${col} = ?`);
      values.push(JSON.stringify(val));
    } else {
      sets.push(`${col} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push((macAddress || '').toUpperCase());
  await run(`UPDATE nodemcu_devices SET ${sets.join(', ')} WHERE mac_address = ?`, values);
}

// Delete a device by MAC
async function deleteNodeMCUDevice(macAddress) {
  await run('DELETE FROM nodemcu_devices WHERE mac_address = ?', [(macAddress || '').toUpperCase()]);
}

// Convert a DB row (snake_case) to the camelCase format used by the API/frontend
function rowToDeviceFormat(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    ipAddress: row.ip_address || '',
    macAddress: row.mac_address || '',
    pin: row.pin || 12,
    coinPinLabel: row.coin_pin_label || 'D6',
    coinPin: row.coin_pin || 12,
    relayPinLabel: row.relay_pin_label || 'D5',
    relayPin: row.relay_pin || 14,
    status: row.status || 'pending',
    vlanId: row.vlan_id || 13,
    lastSeen: row.last_seen || '',
    authenticationKey: row.authentication_key || '',
    createdAt: row.created_at || '',
    rates: (() => { try { return JSON.parse(row.rates || '[]'); } catch { return []; } })(),
    totalPulses: row.total_pulses || 0,
    totalRevenue: row.total_revenue || 0,
    lastCoinsOutDate: row.last_coins_out_date || undefined,
    lastCoinsOutGross: row.last_coins_out_gross || undefined,
    lastCoinsOutNet: row.last_coins_out_net || undefined,
    firmwareVersion: row.firmware_version || '',
    debounceMs: row.debounce_ms != null ? row.debounce_ms : 50
  };
}

// ─── Coin Log Helpers ───

async function addCoinLogDb(entry) {
  try {
    await run(
      `INSERT INTO coin_log (timestamp, type, event, amount, slot, slot_name, source, mac, ip, token, seconds, minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.timestamp || Date.now(), entry.type || '', entry.event || '', entry.amount || null, entry.slot || null, entry.slot_name || null, entry.source || null, entry.mac || null, entry.ip || null, entry.token || null, entry.seconds || null, entry.minutes || null]
    );
  } catch (e) {
    console.error('[DB] Failed to insert coin_log entry:', e.message);
  }
}

async function getCoinLogDb(limit = 100) {
  try {
    return await all(`SELECT * FROM coin_log ORDER BY id DESC LIMIT ?`, [limit]);
  } catch (e) {
    console.error('[DB] Failed to read coin_log:', e.message);
    return [];
  }
}

module.exports = { run, all, get, factoryResetDB, init, close, getAllNodeMCUDevices, getNodeMCUDevice, getNodeMCUDeviceById, getNodeMCUMacs, upsertNodeMCUDevice, updateNodeMCUDevice, deleteNodeMCUDevice, addCoinLogDb, getCoinLogDb };
