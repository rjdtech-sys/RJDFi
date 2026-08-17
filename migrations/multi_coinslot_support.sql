-- Multi-Coin Slot Support Migration
-- Adds support for NodeMCU ESP8266/ESP32 with multiple coin slots

-- Add serial port configuration (for backward compatibility)
INSERT OR IGNORE INTO config (key, value) VALUES ('serialPort', '/dev/ttyUSB0');

-- Add ESP WiFi configuration
INSERT OR IGNORE INTO config (key, value) VALUES ('espIpAddress', '192.168.4.1');
INSERT OR IGNORE INTO config (key, value) VALUES ('espPort', '80');

-- Add coin slots configuration (JSON array)
INSERT OR IGNORE INTO config (key, value) VALUES ('coinSlots', '[]');

-- Add multi-NodeMCU devices configuration
INSERT OR IGNORE INTO config (key, value) VALUES ('nodemcuDevices', '[]');

-- Migration: Add multi-slot tracking to existing tables if needed
-- This would be for future analytics/reporting on per-slot performance

-- Example of what could be added for analytics (optional):
-- CREATE TABLE IF NOT EXISTS coin_slot_analytics (
--   id INTEGER PRIMARY KEY AUTOINCREMENT,
--   slot_id INTEGER NOT NULL,
--   denomination INTEGER NOT NULL,
--   count INTEGER DEFAULT 0,
--   revenue DECIMAL(10, 2) DEFAULT 0.00,
--   recorded_at DATE DEFAULT CURRENT_DATE,
--   UNIQUE(slot_id, denomination, recorded_at)
-- );

-- CREATE INDEX IF NOT EXISTS idx_coin_slot_analytics_date ON coin_slot_analytics(recorded_at);
-- CREATE INDEX IF NOT EXISTS idx_coin_slot_analytics_slot ON coin_slot_analytics(slot_id);

-- Update existing config entries to ensure they have proper defaults
UPDATE config SET value = 'nodemcu_esp' WHERE key = 'boardType' AND value IS NULL;
UPDATE config SET value = '/dev/ttyUSB0' WHERE key = 'serialPort' AND value IS NULL;
UPDATE config SET value = '[]' WHERE key = 'coinSlots' AND value IS NULL;

-- Log the migration
INSERT OR IGNORE INTO config (key, value) VALUES ('migration_multi_coinslot', 'completed');