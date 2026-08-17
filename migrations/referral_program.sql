-- ============================================================
-- Referral / Affiliate Program
-- Customers earn credit points when referred friends pay
-- ============================================================

-- Referral codes: one unique code per device MAC
CREATE TABLE IF NOT EXISTS referral_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Referral events: audit log of referral redemptions and point awards
CREATE TABLE IF NOT EXISTS referral_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_mac TEXT NOT NULL,
  referee_mac TEXT NOT NULL,
  referee_ip TEXT,
  referral_code TEXT NOT NULL,
  pesos_spent INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,
  referee_bonus_minutes INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- wifi_devices: add referral tracking columns
ALTER TABLE wifi_devices ADD COLUMN referral_code TEXT;
ALTER TABLE wifi_devices ADD COLUMN referred_by TEXT;
ALTER TABLE wifi_devices ADD COLUMN referral_points INTEGER DEFAULT 0;
ALTER TABLE wifi_devices ADD COLUMN first_seen_at DATETIME;

-- Default referral config (stored in config table as JSON)
INSERT OR IGNORE INTO config (key, value) VALUES (
  'referral_config',
  '{"enabled":false,"referrerPointsPerPesos":20,"refereeBonusMinutes":5,"minPesosToTrigger":20}'
);

-- Index for fast referral code lookups
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_events_referrer ON referral_events(referrer_mac);
CREATE INDEX IF NOT EXISTS idx_referral_events_referee ON referral_events(referee_mac);
