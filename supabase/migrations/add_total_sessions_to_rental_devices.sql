-- Ensure total_sessions column exists in rental_devices table
-- This column tracks the total number of rental sessions for a device

-- Add total_sessions column if it doesn't exist
ALTER TABLE rental_devices ADD COLUMN IF NOT EXISTS total_sessions INTEGER DEFAULT 0;

-- Update existing devices to have correct session count
UPDATE rental_devices 
SET total_sessions = COALESCE(
  (SELECT COUNT(*) FROM rental_sessions WHERE rental_sessions.device_id = rental_devices.id),
  0
)
WHERE total_sessions IS NULL OR total_sessions = 0;
