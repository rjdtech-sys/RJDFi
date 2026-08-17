-- ============================================
-- UPDATE: NodeMCU Automatic Trial Assignment
-- ============================================
-- This function allows automatic trial assignment for new NodeMCU devices
-- even if they don't exist in the nodemcu_devices table yet

CREATE OR REPLACE FUNCTION start_nodemcu_trial(
  device_mac_address TEXT,
  vendor_id_param UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  trial_license RECORD;
  device_record RECORD;
  vendor_uuid UUID;
  device_id UUID;
  trial_key TEXT;
BEGIN
  -- Use provided vendor_id or current user
  IF vendor_id_param IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := vendor_id_param;
  END IF;

  -- Check if device exists in nodemcu_devices table
  SELECT * INTO device_record 
  FROM nodemcu_devices 
  WHERE mac_address = device_mac_address 
    AND vendor_id = vendor_uuid;

  -- If device doesn't exist, we need to handle this case
  -- For now, we'll use a fallback approach or create a temporary device record
  IF NOT FOUND THEN
    -- Check if there's already a trial license for this MAC address
    SELECT * INTO trial_license
    FROM nodemcu_licenses
    WHERE mac_address = device_mac_address
      AND license_type = 'trial';

    IF FOUND THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Device already had a trial period',
        'trial_ended_at', trial_license.trial_started_at + (trial_license.trial_duration_days || ' days')::interval
      );
    END IF;

    -- Create trial license without device_id (MAC address based)
    trial_key := 'TRIAL-' || device_mac_address || '-' || substring(md5(random()::text) from 1 for 6);
    
    INSERT INTO nodemcu_licenses (
      license_key,
      vendor_id,
      created_by,
      mac_address,
      is_active,
      activated_at,
      license_type,
      trial_started_at,
      trial_duration_days,
      expires_at
    ) VALUES (
      trial_key,
      vendor_uuid,
      auth.uid(),
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
      'message', 'Trial started successfully for new device',
      'license_key', trial_key,
      'expires_at', now() + interval '7 days',
      'days_remaining', 7,
      'is_new_device', true
    );
  END IF;

  -- Device exists, proceed with normal trial assignment
  device_id := device_record.id;

  -- Check if device already has an active license
  SELECT * INTO trial_license
  FROM nodemcu_licenses
  WHERE device_id = device_id 
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
  WHERE device_id = device_id 
    AND license_type = 'trial';

  IF FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device already had a trial period',
      'trial_ended_at', trial_license.trial_started_at + (trial_license.trial_duration_days || ' days')::interval
    );
  END IF;

  -- Create trial license for existing device
  trial_key := 'TRIAL-' || device_mac_address || '-' || substring(md5(random()::text) from 1 for 6);
  
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
    trial_key,
    vendor_uuid,
    auth.uid(),
    device_id,
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
    'license_key', trial_key,
    'expires_at', now() + interval '7 days',
    'days_remaining', 7
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also update the check_nodemcu_license_status function to handle MAC-based licenses
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
  -- First try to get license by MAC address (for trial licenses without device_id)
  SELECT * INTO license_record
  FROM nodemcu_licenses
  WHERE mac_address = device_mac_address
    AND is_active = true
  ORDER BY activated_at DESC
  LIMIT 1;

  -- If found a MAC-based license, return it
  IF FOUND THEN
    -- Calculate expiration status
    IF license_record.expires_at IS NOT NULL THEN
      days_remaining := GREATEST(0, (license_record.expires_at - now())::int);
      is_expired := license_record.expires_at < now();
    ELSE
      days_remaining := NULL;
      is_expired := false;
    END IF;

    RETURN json_build_object(
      'success', true,
      'has_license', true,
      'license_key', license_record.license_key,
      'license_type', license_record.license_type,
      'is_active', license_record.is_active,
      'is_expired', is_expired,
      'activated_at', license_record.activated_at,
      'expires_at', license_record.expires_at,
      'days_remaining', days_remaining,
      'trial_started_at', license_record.trial_started_at,
      'trial_duration_days', license_record.trial_duration_days,
      'can_operate', license_record.is_active AND NOT is_expired,
      'is_mac_based', true
    );
  END IF;

  -- If no MAC-based license, try device-based license
  SELECT * INTO device_record
  FROM nodemcu_devices
  WHERE mac_address = device_mac_address;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', true,
      'has_license', false,
      'has_trial', false,
      'can_start_trial', true,
      'message', 'No license found, trial available'
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
    days_remaining := GREATEST(0, (license_record.expires_at - now())::int);
    is_expired := license_record.expires_at < now();
  ELSE
    days_remaining := NULL;
    is_expired := false;
  END IF;

  RETURN json_build_object(
    'success', true,
    'has_license', true,
    'license_key', license_record.license_key,
    'license_type', license_record.license_type,
    'is_active', license_record.is_active,
    'is_expired', is_expired,
    'activated_at', license_record.activated_at,
    'expires_at', license_record.expires_at,
    'days_remaining', days_remaining,
    'trial_started_at', license_record.trial_started_at,
    'trial_duration_days', license_record.trial_duration_days,
    'can_operate', license_record.is_active AND NOT is_expired,
    'is_mac_based', false
  );

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;