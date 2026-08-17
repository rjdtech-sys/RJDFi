-- ============================================
-- PHONE RENTAL ACTIVATION SYSTEM
-- ============================================
-- Per-vendor device activation with activation keys and 7-day trial
-- Devices must be accepted + activated by the vendor to continue operating

-- 1. RENTAL DEVICES TABLE (cloud mirror of local rental_devices)
-- Created FIRST because activation_keys references it
CREATE TABLE IF NOT EXISTS rental_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  machine_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  
  -- Device identity
  mac_address TEXT NOT NULL,
  android_id TEXT,
  device_name TEXT,
  model TEXT,
  ip_address TEXT,
  
  -- Activation status
  activation_status TEXT DEFAULT 'pending' CHECK (activation_status IN ('pending', 'trial', 'active', 'expired', 'deactivated', 'rejected')),
  accepted_by_vendor BOOLEAN DEFAULT false,
  accepted_at TIMESTAMPTZ,
  
  -- Trial
  trial_started_at TIMESTAMPTZ,
  trial_expires_at TIMESTAMPTZ,
  trial_duration_days INTEGER DEFAULT 7,
  
  -- Current license (added later as FK after rental_activation_keys is created)
  current_license_id UUID,
  
  -- Stats
  total_revenue DECIMAL(10, 2) DEFAULT 0.00,
  total_rentals INTEGER DEFAULT 0,
  total_sessions INTEGER DEFAULT 0,
  
  -- Timestamps
  last_heartbeat TIMESTAMPTZ,
  last_seen TIMESTAMPTZ DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(mac_address)
);

CREATE INDEX IF NOT EXISTS idx_rental_devices_vendor ON rental_devices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rental_devices_machine ON rental_devices(machine_id);
CREATE INDEX IF NOT EXISTS idx_rental_devices_mac ON rental_devices(mac_address);
CREATE INDEX IF NOT EXISTS idx_rental_devices_status ON rental_devices(activation_status);

-- Enable RLS
ALTER TABLE rental_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can manage all rental devices"
  ON rental_devices FOR ALL
  USING (is_superadmin());

CREATE POLICY "Vendors can view their own rental devices"
  ON rental_devices FOR SELECT
  USING (vendor_id = auth.uid());

CREATE POLICY "Vendors can update their own rental devices"
  ON rental_devices FOR UPDATE
  USING (vendor_id = auth.uid())
  WITH CHECK (vendor_id = auth.uid());

CREATE POLICY "Vendors can insert their own rental devices"
  ON rental_devices FOR INSERT
  WITH CHECK (vendor_id = auth.uid() OR vendor_id IS NULL);


-- 2. RENTAL ACTIVATION KEYS TABLE
-- Pre-generated keys that vendors can assign to rental devices
CREATE TABLE IF NOT EXISTS rental_activation_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_key TEXT UNIQUE NOT NULL,
  
  -- Ownership
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id), -- Superadmin who generated
  
  -- Binding (assigned to a specific device after activation)
  device_id UUID REFERENCES rental_devices(id) ON DELETE SET NULL,
  mac_address TEXT,
  
  -- Status
  is_active BOOLEAN DEFAULT false,
  activated_at TIMESTAMPTZ,
  
  -- License type and expiration
  license_type TEXT DEFAULT 'standard' CHECK (license_type IN ('trial', 'standard', 'premium')),
  expires_at TIMESTAMPTZ,
  
  -- Trial specific
  trial_started_at TIMESTAMPTZ,
  trial_duration_days INTEGER DEFAULT 7,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add the FK from rental_devices.current_license_id -> rental_activation_keys.id
ALTER TABLE rental_devices
  ADD CONSTRAINT fk_rental_devices_current_license
  FOREIGN KEY (current_license_id) REFERENCES rental_activation_keys(id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rental_keys_vendor ON rental_activation_keys(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rental_keys_device ON rental_activation_keys(device_id);
CREATE INDEX IF NOT EXISTS idx_rental_keys_mac ON rental_activation_keys(mac_address);
CREATE INDEX IF NOT EXISTS idx_rental_keys_active ON rental_activation_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_rental_keys_key ON rental_activation_keys(activation_key);

-- Enable RLS
ALTER TABLE rental_activation_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Superadmins can manage all rental activation keys"
  ON rental_activation_keys FOR ALL
  USING (is_superadmin());

CREATE POLICY "Vendors can view their own rental activation keys"
  ON rental_activation_keys FOR SELECT
  USING (vendor_id = auth.uid());

CREATE POLICY "Vendors can update their own rental activation keys"
  ON rental_activation_keys FOR UPDATE
  USING (vendor_id = auth.uid())
  WITH CHECK (vendor_id = auth.uid());


-- 3. RENTAL SESSIONS TABLE (cloud mirror for cross-device sync)
CREATE TABLE IF NOT EXISTS rental_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  machine_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  device_id UUID NOT NULL REFERENCES rental_devices(id) ON DELETE CASCADE,
  
  -- Session details
  customer_name TEXT,
  customer_contact TEXT,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  amount_paid DECIMAL(10, 2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_sessions_device ON rental_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_rental_sessions_vendor ON rental_sessions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_rental_sessions_status ON rental_sessions(status);

ALTER TABLE rental_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors can manage their own rental sessions"
  ON rental_sessions FOR ALL
  USING (vendor_id = auth.uid());


-- ============================================
-- FUNCTIONS
-- ============================================

-- 4. Generate rental activation keys (superadmin only)
CREATE OR REPLACE FUNCTION generate_rental_activation_keys(
  batch_size INTEGER DEFAULT 1,
  assigned_vendor_id UUID DEFAULT NULL,
  license_type_param TEXT DEFAULT 'standard',
  expiration_months INTEGER DEFAULT NULL
)
RETURNS TABLE (
  activation_key TEXT,
  expires_at TIMESTAMPTZ,
  license_type TEXT
) AS $$
DECLARE
  i INTEGER;
  new_key TEXT;
  exp_date TIMESTAMPTZ;
BEGIN
  IF NOT is_superadmin() THEN
    RAISE EXCEPTION 'Only superadmins can generate rental activation keys';
  END IF;

  FOR i IN 1..batch_size LOOP
    new_key := 'RENT-' || 
               upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4)) || '-' ||
               upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4)) || '-' ||
               upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));
    
    IF expiration_months IS NOT NULL THEN
      exp_date := now() + (expiration_months || ' months')::interval;
    ELSE
      exp_date := NULL;
    END IF;
    
    INSERT INTO rental_activation_keys (activation_key, vendor_id, created_by, license_type, expires_at)
    VALUES (new_key, assigned_vendor_id, auth.uid(), license_type_param, exp_date);
    
    activation_key := new_key;
    expires_at := exp_date;
    license_type := license_type_param;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Register a new rental device (called by phone app on first connect)
-- Auto-starts 7-day trial
CREATE OR REPLACE FUNCTION register_rental_device(
  p_mac_address TEXT,
  p_android_id TEXT DEFAULT NULL,
  p_device_name TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_vendor_id UUID DEFAULT NULL,
  p_machine_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  existing_device RECORD;
  new_device_id UUID;
  trial_key TEXT;
BEGIN
  -- Check if device already exists
  SELECT * INTO existing_device
  FROM rental_devices
  WHERE mac_address = p_mac_address;

  IF FOUND THEN
    -- Update last seen
    UPDATE rental_devices SET
      android_id = COALESCE(p_android_id, android_id),
      model = COALESCE(p_model, model),
      device_name = COALESCE(p_device_name, device_name),
      ip_address = COALESCE(p_ip_address, ip_address),
      last_heartbeat = now(),
      last_seen = now(),
      updated_at = now()
    WHERE id = existing_device.id;

    -- Return existing device with current status
    RETURN json_build_object(
      'success', true,
      'device_id', existing_device.id,
      'device_name', COALESCE(p_device_name, existing_device.device_name),
      'mac_address', p_mac_address,
      'activation_status', existing_device.activation_status,
      'is_new', false,
      'trial_expires_at', existing_device.trial_expires_at,
      'accepted_by_vendor', existing_device.accepted_by_vendor,
      'message', CASE 
        WHEN existing_device.activation_status = 'deactivated' THEN 'Device has been deactivated'
        WHEN existing_device.activation_status = 'rejected' THEN 'Device has been rejected by vendor'
        WHEN existing_device.activation_status = 'expired' THEN 'Trial or license has expired'
        ELSE 'Device registered'
      END
    );
  END IF;

  -- Create new device with trial status
  INSERT INTO rental_devices (
    vendor_id, machine_id, mac_address, android_id, device_name, model, ip_address,
    activation_status, accepted_by_vendor,
    trial_started_at, trial_expires_at, trial_duration_days,
    last_heartbeat, last_seen
  ) VALUES (
    p_vendor_id, p_machine_id, p_mac_address, p_android_id, 
    COALESCE(p_device_name, 'Phone-' || substring(p_mac_address from length(p_mac_address)-4)),
    p_model, p_ip_address,
    'trial', false,
    now(), now() + interval '7 days', 7,
    now(), now()
  ) RETURNING id INTO new_device_id;

  -- Auto-create a trial activation key
  trial_key := 'TRIAL-' || upper(substring(md5(random()::text || p_mac_address) from 1 for 4)) || '-' ||
               upper(substring(md5(random()::text || p_mac_address) from 1 for 4));

  INSERT INTO rental_activation_keys (
    activation_key, vendor_id, device_id, mac_address,
    is_active, activated_at, license_type,
    trial_started_at, trial_duration_days, expires_at
  ) VALUES (
    trial_key, p_vendor_id, new_device_id, p_mac_address,
    true, now(), 'trial',
    now(), 7, now() + interval '7 days'
  );

  -- Link the trial key to the device
  UPDATE rental_devices SET current_license_id = (
    SELECT id FROM rental_activation_keys WHERE device_id = new_device_id AND license_type = 'trial' LIMIT 1
  ) WHERE id = new_device_id;

  RETURN json_build_object(
    'success', true,
    'device_id', new_device_id,
    'device_name', COALESCE(p_device_name, 'Phone-' || substring(p_mac_address from length(p_mac_address)-4)),
    'mac_address', p_mac_address,
    'activation_status', 'trial',
    'is_new', true,
    'trial_expires_at', now() + interval '7 days',
    'accepted_by_vendor', false,
    'trial_key', trial_key,
    'message', 'New device registered with 7-day trial'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Accept a pending rental device (vendor action)
CREATE OR REPLACE FUNCTION accept_rental_device(
  p_device_id UUID,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  device_record RECORD;
  vendor_uuid UUID;
BEGIN
  IF p_vendor_id IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := p_vendor_id;
  END IF;

  SELECT * INTO device_record
  FROM rental_devices
  WHERE id = p_device_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Device not found');
  END IF;

  -- Assign vendor to device if not yet assigned
  UPDATE rental_devices SET
    vendor_id = COALESCE(vendor_uuid, vendor_id),
    accepted_by_vendor = true,
    accepted_at = now(),
    activation_status = CASE 
      WHEN activation_status = 'pending' THEN 'trial'
      ELSE activation_status
    END,
    updated_at = now()
  WHERE id = p_device_id;

  -- Also assign vendor to the trial key if exists
  UPDATE rental_activation_keys SET
    vendor_id = vendor_uuid
  WHERE device_id = p_device_id AND license_type = 'trial';

  RETURN json_build_object(
    'success', true,
    'message', 'Device accepted',
    'device_id', p_device_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Reject a pending rental device (vendor action)
CREATE OR REPLACE FUNCTION reject_rental_device(
  p_device_id UUID,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  vendor_uuid UUID;
BEGIN
  IF p_vendor_id IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := p_vendor_id;
  END IF;

  UPDATE rental_devices SET
    activation_status = 'rejected',
    accepted_by_vendor = false,
    deactivated_at = now(),
    updated_at = now()
  WHERE id = p_device_id AND vendor_id = vendor_uuid;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Device not found or not yours');
  END IF;

  -- Deactivate any license keys
  UPDATE rental_activation_keys SET
    is_active = false
  WHERE device_id = p_device_id;

  RETURN json_build_object('success', true, 'message', 'Device rejected');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 8. Activate a rental device with an activation key
CREATE OR REPLACE FUNCTION activate_rental_device(
  p_activation_key TEXT,
  p_device_id UUID,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  key_record RECORD;
  device_record RECORD;
  existing_license RECORD;
  vendor_uuid UUID;
BEGIN
  IF p_vendor_id IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := p_vendor_id;
  END IF;

  -- Get the key
  SELECT * INTO key_record
  FROM rental_activation_keys
  WHERE activation_key = p_activation_key;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invalid activation key');
  END IF;

  -- Check key belongs to vendor
  IF key_record.vendor_id IS NOT NULL AND key_record.vendor_id != vendor_uuid THEN
    RETURN json_build_object('success', false, 'error', 'Activation key does not belong to you');
  END IF;

  -- Check key not already active on another device
  IF key_record.is_active AND key_record.device_id IS NOT NULL AND key_record.device_id != p_device_id THEN
    RETURN json_build_object('success', false, 'error', 'Key already activated on another device');
  END IF;

  -- Get the device
  SELECT * INTO device_record
  FROM rental_devices
  WHERE id = p_device_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Device not found');
  END IF;

  -- Check if device already has an active non-trial license
  SELECT * INTO existing_license
  FROM rental_activation_keys
  WHERE device_id = p_device_id
    AND is_active = true
    AND license_type != 'trial';

  IF FOUND THEN
    RETURN json_build_object(
      'success', false, 
      'error', 'Device already has an active license',
      'current_key', existing_license.activation_key
    );
  END IF;

  -- Deactivate the trial key if it exists
  UPDATE rental_activation_keys SET
    is_active = false
  WHERE device_id = p_device_id AND license_type = 'trial';

  -- Activate the key
  UPDATE rental_activation_keys SET
    device_id = p_device_id,
    mac_address = device_record.mac_address,
    vendor_id = vendor_uuid,
    is_active = true,
    activated_at = now(),
    updated_at = now()
  WHERE id = key_record.id;

  -- Update device status
  UPDATE rental_devices SET
    activation_status = 'active',
    accepted_by_vendor = true,
    accepted_at = COALESCE(accepted_at, now()),
    current_license_id = key_record.id,
    vendor_id = vendor_uuid,
    updated_at = now()
  WHERE id = p_device_id;

  RETURN json_build_object(
    'success', true,
    'message', 'Device activated successfully',
    'license_type', key_record.license_type,
    'expires_at', key_record.expires_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 9. Check rental device activation status (called by phone app on heartbeat)
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
    -- FIX: INTERVAL cannot be cast to INTEGER directly; extract epoch in seconds / 86400 = days
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


-- 10. Deactivate a rental device (vendor or auto-expire)
CREATE OR REPLACE FUNCTION deactivate_rental_device(
  p_device_id UUID,
  p_vendor_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  vendor_uuid UUID;
BEGIN
  IF p_vendor_id IS NULL THEN
    vendor_uuid := auth.uid();
  ELSE
    vendor_uuid := p_vendor_id;
  END IF;

  UPDATE rental_devices SET
    activation_status = 'deactivated',
    deactivated_at = now(),
    updated_at = now()
  WHERE id = p_device_id AND (vendor_id = vendor_uuid OR vendor_id IS NULL);

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Device not found or not yours');
  END IF;

  -- Deactivate all keys for this device
  UPDATE rental_activation_keys SET
    is_active = false
  WHERE device_id = p_device_id;

  RETURN json_build_object('success', true, 'message', 'Device deactivated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 11. Get vendor's rental devices with license info
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
      -- FIX: INTERVAL cannot be cast to INTEGER directly; extract epoch in seconds / 86400 = days
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


-- 12. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_rental_device_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_update_rental_device_updated_at ON rental_devices;
CREATE TRIGGER tr_update_rental_device_updated_at
BEFORE UPDATE ON rental_devices
FOR EACH ROW EXECUTE FUNCTION update_rental_device_updated_at();

DROP TRIGGER IF EXISTS tr_update_rental_key_updated_at ON rental_activation_keys;
CREATE TRIGGER tr_update_rental_key_updated_at
BEFORE UPDATE ON rental_activation_keys
FOR EACH ROW EXECUTE FUNCTION update_rental_device_updated_at();
