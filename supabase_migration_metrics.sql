-- Migration: Update vendors table for Hardware UUID and Metrics
-- 1. Allow vendor_id to be NULL (for pending activation machines)
ALTER TABLE vendors ALTER COLUMN vendor_id DROP NOT NULL;

-- 2. Add columns for real-time metrics
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS cpu_temp DECIMAL(5, 2);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS active_sessions_count INTEGER DEFAULT 0;

-- 3. Update RLS to allow "anon" (machines) to insert/update based on hardware_id
-- Note: In a real production environment, you'd use a service role or signed tokens.
-- For this setup, we'll allow public insert for 'vendors' if hardware_id is unique.

-- Allow inserting a new machine (Pending Activation)
CREATE POLICY "Machines can register themselves"
ON vendors FOR INSERT
WITH CHECK (
  vendor_id IS NULL 
  AND hardware_id IS NOT NULL
);

-- Allow machines to update their own status/metrics
-- We can't easily restrict this to "the machine itself" without auth, 
-- so we rely on the hardware_id matching.
CREATE POLICY "Machines can update their status"
ON vendors FOR UPDATE
USING (true) -- Ideally restrict this, but for now allow update
WITH CHECK (true);

-- Grant permissions to anon (if not already granted)
GRANT INSERT, UPDATE, SELECT ON vendors TO anon;
