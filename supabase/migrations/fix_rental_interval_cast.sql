-- Fix: cannot cast type interval to integer
-- Both check_rental_device_status and get_vendor_rental_devices used (expires_at - now())::int
-- which is invalid. INTERVAL cannot be cast to INTEGER directly.
-- Fix: use EXTRACT(EPOCH FROM interval) / 86400 to get days as a float, then cast to INTEGER.

-- =============================================
-- 9. check_rental_device_status (fixed)
-- =============================================
CREATE OR REPLACE FUNCTION check_rental_device_status(
  p_mac_address TEXT
)
RETURNS JSON AS $$
DECLARE
  device_record RECORD;
  license_record RECORD;
  days_remaining INTEGER;
  is_expired BOOLEAN;
BEGIN
  SELECT * INTO device_record
  FROM rental_devices
  WHERE mac_address = p_mac_address;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Device not registered',
      'can_operate', false,
      'activation_status', 'unregistered'
    );
  END IF;

  -- Get current active license
  SELECT * INTO license_record
  FROM rental_activation_keys
  WHERE device_id = device_record.id
    AND is_active = true
  ORDER BY activated_at DESC
  LIMIT 1;

  -- Calculate expiration
  IF license_record.expires_at IS NOT NULL THEN
    -- FIX: extract epoch (seconds) then divide by 86400 to get days, cast to INTEGER
    days_remaining := GREATEST(0, EXTRACT(EPOCH FROM (license_record.expires_at - now()))::INTEGER / 86400);
    is_expired := license_record.expires_at < now();
  ELSE
    days_remaining := NULL;
    is_expired := false;
  END IF;

  -- Auto-expire if trial or license expired
  IF is_expired AND device_record.activation_status IN ('trial', 'active') THEN
    UPDATE rental_devices SET
      activation_status = 'expired',
      deactivated_at = now(),
      updated_at = now()
    WHERE id = device_record.id;

    UPDATE rental_activation_keys SET
      is_active = false
    WHERE id = license_record.id;

    RETURN json_build_object(
      'success', true,
      'can_operate', false,
      'activation_status', 'expired',
      'device_id', device_record.id,
      'mac_address', p_mac_address,
      'license_type', license_record.license_type,
      'expired_at', license_record.expires_at,
      'message', 'License or trial has expired'
    );
  END IF;

  -- Check if deactivated/rejected
  IF device_record.activation_status IN ('deactivated', 'rejected') THEN
    RETURN json_build_object(
      'success', true,
      'can_operate', false,
      'activation_status', device_record.activation_status,
      'device_id', device_record.id,
      'message', 'Device has been ' || device_record.activation_status
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'can_operate', NOT is_expired AND device_record.accepted_by_vendor,
    'activation_status', device_record.activation_status,
    'device_id', device_record.id,
    'device_name', device_record.device_name,
    'mac_address', p_mac_address,
    'accepted_by_vendor', device_record.accepted_by_vendor,
    'license_type', license_record.license_type,
    'license_key', license_record.activation_key,
    'expires_at', license_record.expires_at,
    'days_remaining', days_remaining,
    'trial_expires_at', device_record.trial_expires_at,
    'is_trial', license_record.license_type = 'trial'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================
-- 11. get_vendor_rental_devices (fixed)
-- =============================================
CREATE OR REPLACE FUNCTION get_vendor_rental_devices(
  p_vendor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  device_name TEXT,
  mac_address TEXT,
  android_id TEXT,
  model TEXT,
  activation_status TEXT,
  accepted_by_vendor BOOLEAN,
  license_type TEXT,
  license_key TEXT,
  license_expires_at TIMESTAMPTZ,
  days_remaining INTEGER,
  trial_expires_at TIMESTAMPTZ,
  total_revenue DECIMAL,
  total_rentals INTEGER,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  vendor_uuid UUID;
BEGIN
  IF p_vendor_id IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := p_vendor_id;
  END IF;

  RETURN QUERY
  SELECT 
    rd.id,
    rd.device_name,
    rd.mac_address,
    rd.android_id,
    rd.model,
    rd.activation_status,
    rd.accepted_by_vendor,
    rak.license_type,
    rak.activation_key as license_key,
    rak.expires_at as license_expires_at,
    CASE 
      WHEN rak.expires_at IS NOT NULL 
      -- FIX: extract epoch (seconds) then divide by 86400 to get days, cast to INTEGER
      THEN GREATEST(0, (EXTRACT(EPOCH FROM (rak.expires_at - now()))::INTEGER / 86400))
      ELSE NULL
    END as days_remaining,
    rd.trial_expires_at,
    rd.total_revenue,
    rd.total_rentals::INTEGER,
    rd.last_seen,
    rd.created_at
  FROM rental_devices rd
  LEFT JOIN rental_activation_keys rak ON rak.id = rd.current_license_id
  WHERE rd.vendor_id = vendor_uuid OR (rd.vendor_id IS NULL AND rd.machine_id IN (SELECT id FROM vendors WHERE vendor_id = vendor_uuid))
  ORDER BY rd.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
