-- Add columns to nodemcu_devices for "Last Coins Out" display
ALTER TABLE nodemcu_devices 
ADD COLUMN IF NOT EXISTS last_coins_out_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_coins_out_gross DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS last_coins_out_net DECIMAL(10, 2);

-- Add columns to nodemcu_sales for history tracking
ALTER TABLE nodemcu_sales
ADD COLUMN IF NOT EXISTS net_amount DECIMAL(10, 2),
ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'coin_insert';

-- Update the trigger function to handle 'coins_out'
CREATE OR REPLACE FUNCTION update_nodemcu_revenue()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.transaction_type = 'coins_out' THEN
         -- For coins out, we primarily use this for history.
         -- The actual revenue reset is handled by the device syncing its state (sending total_revenue = 0).
         -- So we do NOT modify the revenue here to avoid double-counting or negative values if sync overlaps.
         -- We just return the row so it gets inserted into the table.
         RETURN NEW;
    ELSE
         -- Normal coin insert behavior
         UPDATE nodemcu_devices
         SET total_pulses = total_pulses + 1,
             total_revenue = total_revenue + NEW.amount,
             last_seen = now()
         WHERE id = NEW.device_id;
         
         -- Also update the main machine's (vendor) total revenue
         UPDATE vendors
         SET total_revenue = total_revenue + NEW.amount,
                 coin_slot_pulses = coin_slot_pulses + 1,
                 last_seen = now()
         WHERE id = (SELECT machine_id FROM nodemcu_devices WHERE id = NEW.device_id);
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';
