-- FIX for NodeMCU License System RPC Functions
-- Run this in your Supabase SQL Editor to fix the "cannot cast type interval to integer" error

-- 1. Fix check_nodemcu_license_status casting error
CREATE OR REPLACE FUNCTION check_nodemcu_license_status(
  device_mac_address TEXT
)
RETURNS JSON AS $$
DECLARE
  license_record RECORD;
  device_record RECORD;
  days_remaining INTEGER;
  is_expired BOOLEAN;
BEGIN
  -- Get the device
  SELECT * INTO device_record
  FROM nodemcu_devices
  WHERE mac_address = device_mac_address;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not found'
    );
  END IF;

  -- Get active license for device
  SELECT * INTO license_record
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND is_active = true
  ORDER BY activated_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', true,
      'has_license', false,
      'has_trial', false,
      'can_start_trial', true,
      'message', 'No license found, trial available'
    );
  END IF;

  -- Calculate expiration status
  IF license_record.expires_at IS NOT NULL THEN
    -- FIX: Use EXTRACT(DAY FROM ...) instead of casting interval directly to int
    days_remaining := GREATEST(0, EXTRACT(DAY FROM (license_record.expires_at - now()))::INTEGER);
    is_expired := license_record.expires_at < now();
  ELSE
    days_remaining := NULL;
    is_expired := false;
  END IF;

  RETURN json_build_object(
    'success', true,
    'has_license', true,
    'is_active', license_record.is_active,
    'is_expired', is_expired,
    'license_key', license_record.license_key,
    'license_type', license_record.license_type,
    'expires_at', license_record.expires_at,
    'days_remaining', days_remaining,
    'trial_started_at', license_record.trial_started_at,
    'can_start_trial', false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Define get_vendor_nodemcu_licenses correctly (was missing or broken)
-- Remove any overloaded version to avoid PostgREST ambiguity (PGRST203)
DROP FUNCTION IF EXISTS public.get_vendor_nodemcu_licenses(uuid);

CREATE OR REPLACE FUNCTION get_vendor_nodemcu_licenses()
RETURNS SETOF nodemcu_licenses AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM nodemcu_licenses
  WHERE vendor_id = auth.uid()
  ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Ensure start_nodemcu_trial is correct
CREATE OR REPLACE FUNCTION start_nodemcu_trial(
  device_mac_address TEXT,
  vendor_id_param UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  trial_license RECORD;
  device_record RECORD;
  vendor_uuid UUID;
BEGIN
  -- Use provided vendor_id or current user
  IF vendor_id_param IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := vendor_id_param;
  END IF;

  -- Check if device exists and belongs to vendor
  SELECT * INTO device_record 
  FROM nodemcu_devices 
  WHERE mac_address = device_mac_address 
    AND vendor_id = vendor_uuid;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not found or does not belong to you'
    );
  END IF;

  -- Check if device already has an active license
  SELECT * INTO trial_license
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND is_active = true;

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already has an active license',
      'license_key', trial_license.license_key,
      'license_type', trial_license.license_type
    );
  END IF;

  -- Check if device already had a trial
  SELECT * INTO trial_license
  FROM nodemcu_licenses
  WHERE device_id = device_record.id 
    AND license_type = 'trial';

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already had a trial period',
      'trial_ended_at', trial_license.trial_started_at + (trial_license.trial_duration_days || ' days')::interval
    );
  END IF;

  -- Create trial license
  INSERT INTO nodemcu_licenses (
    license_key,
    vendor_id,
    created_by,
    device_id,
    mac_address,
    is_active,
    activated_at,
    license_type,
    trial_started_at,
    trial_duration_days,
    expires_at
  ) VALUES (
    'TRIAL-' || device_mac_address || '-' || substring(md5(random()::text) from 1 for 6),
    vendor_uuid,
    auth.uid(),
    device_record.id,
    device_mac_address,
    true,
    now(),
    'trial',
    now(),
    7,
    now() + interval '7 days'
  );

  RETURN json_build_object(
    'success', true,
    'message', 'Trial started successfully',
    'license_key', 'TRIAL-' || device_mac_address,
    'expires_at', now() + interval '7 days',
    'days_remaining', 7
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
