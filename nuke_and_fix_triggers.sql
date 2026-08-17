-- =================================================================
-- FINAL FIX: NUKE AND REBUILD TRIGGERS
-- =================================================================
-- Run this in Supabase SQL Editor.
-- This script deletes ALL triggers on 'sales_logs' to remove any "Ghost/Duplicate" triggers
-- that might be causing the Foreign Key error, and then cleanly recreates only the correct ones.
-- =================================================================

-- 1. DROP ALL TRIGGERS ON sales_logs
-- We use a dynamic block to find and drop any trigger attached to this table.
DO $$ 
DECLARE 
    t_name text;
BEGIN 
    FOR t_name IN 
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'sales_logs'
    LOOP 
        EXECUTE 'DROP TRIGGER IF EXISTS ' || t_name || ' ON sales_logs'; 
    END LOOP; 
END $$;

-- 2. RECREATE: Standard Revenue Update Trigger (from original schema)
DROP TRIGGER IF EXISTS update_revenue_on_sale ON sales_logs;
CREATE TRIGGER update_revenue_on_sale 
AFTER INSERT ON sales_logs
FOR EACH ROW EXECUTE FUNCTION update_vendor_revenue();

-- 3. RECREATE: Realtime Dashboard Trigger (The Fix)
DROP FUNCTION IF EXISTS update_realtime_dashboard();

CREATE OR REPLACE FUNCTION update_realtime_dashboard()
RETURNS TRIGGER AS $$
BEGIN
    -- Try to update existing record for this MACHINE
    UPDATE vendor_dashboard_realtime
    SET 
        total_sales = total_sales + NEW.amount,
        order_count = order_count + 1,
        last_updated = NOW()
    WHERE vendor_id = NEW.machine_id; -- Correctly using machine_id

    -- If no record was updated, insert a new one
    IF NOT FOUND THEN
        INSERT INTO vendor_dashboard_realtime (vendor_id, total_sales, order_count, last_updated)
        VALUES (NEW.machine_id, NEW.amount, 1, NOW());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_sales_log_insert
AFTER INSERT ON sales_logs
FOR EACH ROW
EXECUTE FUNCTION update_realtime_dashboard();

-- 4. CONFIRMATION
SELECT 'All triggers reset. Ghost triggers removed.' as result;
