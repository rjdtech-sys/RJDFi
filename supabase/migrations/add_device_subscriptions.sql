-- Add subscription support to cloud wifi_devices table
-- Enables device subscription plans (weekly, monthly, no expiration) that roam across SSIDs/machines

-- Subscription type: 'weekly', 'monthly', 'none' (permanent), or NULL (pay-per-use)
ALTER TABLE wifi_devices ADD COLUMN IF NOT EXISTS subscription_type TEXT;

-- Unix timestamp (ms) when subscription expires. NULL for 'none' type or no subscription.
ALTER TABLE wifi_devices ADD COLUMN IF NOT EXISTS subscription_expires_at BIGINT;
