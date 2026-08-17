-- =================================================================
-- FIX: VENDOR DASHBOARD REALTIME TRIGGER BUG
-- =================================================================
-- Run this SQL in your Supabase Dashboard SQL Editor
-- This fixes the issue where sales fail to sync due to a Foreign Key constraint error.
-- =================================================================

-- 1. Drop the problematic trigger first (if it exists)
DROP TRIGGER IF EXISTS on_sales_log_insert ON sales_logs;
DROP FUNCTION IF EXISTS update_realtime_dashboard();

-- 2. Create the correct function that uses MACHINE ID (machine_id) instead of USER ID (vendor_id)
--    The vendor_dashboard_realtime table is keyed by Machine ID (linked to vendors table).
CREATE OR REPLACE FUNCTION update_realtime_dashboard()
RETURNS TRIGGER AS $$
BEGIN
    -- Try to update existing record for this MACHINE
    UPDATE vendor_dashboard_realtime
    SET 
        total_sales = total_sales + NEW.amount,
        order_count = order_count + 1,
        last_updated = NOW()
    WHERE vendor_id = NEW.machine_id; -- Use machine_id, not vendor_id!

    -- If no record was updated (because it doesn't exist), insert a new one
    IF NOT FOUND THEN
        INSERT INTO vendor_dashboard_realtime (vendor_id, total_sales, order_count, last_updated)
        VALUES (NEW.machine_id, NEW.amount, 1, NOW()); -- Use machine_id, not vendor_id!
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Recreate the trigger
CREATE TRIGGER on_sales_log_insert
AFTER INSERT ON sales_logs
FOR EACH ROW
EXECUTE FUNCTION update_realtime_dashboard();

-- 4. Verify the fix
-- You should see "CREATE TRIGGER" success message.
