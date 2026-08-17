-- Add payment_method column to rental_sessions table
-- This tracks how the customer paid (coinslot, cash, gcash, etc.)

-- Add payment_method column if it doesn't exist
ALTER TABLE rental_sessions ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';

-- Add index for filtering by payment method
CREATE INDEX IF NOT EXISTS idx_rental_sessions_payment_method ON rental_sessions(payment_method);

-- Update existing records to default to 'cash'
UPDATE rental_sessions SET payment_method = 'cash' WHERE payment_method IS NULL;
