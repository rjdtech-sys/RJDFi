-- Fix: rental_devices not syncing full info to Supabase
-- Problems:
--   1. register_rental_device only updates heartbeat fields for existing devices,
--      vendor_id and machine_id were never updated on re-registration.
--   2. No upsert/force-sync path exists for devices already in the DB.
-- Solution:
--   1. Fix register_rental_device to also update vendor_id, machine_id, android_id, model, ip_address.
--   2. Add upsert_rental_device RPC for force full-sync (called by server on startup).


-- =============================================
-- 5. register_rental_device (fixed)
-- =============================================
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
  -- Normalize MAC
  p_mac_address := upper(p_mac_address);

  -- Check if device already exists
  SELECT * INTO existing_device
  FROM rental_devices
  WHERE mac_address = p_mac_address;

  IF FOUND THEN
    -- Update all available fields including vendor_id and machine_id
    UPDATE rental_devices SET
      android_id    = COALESCE(p_android_id,  android_id),
      model         = COALESCE(p_model,        model),
      device_name   = COALESCE(p_device_name,  device_name),
      ip_address    = COALESCE(p_ip_address,   ip_address),
      -- Only set vendor_id / machine_id if not already assigned
      vendor_id     = COALESCE(vendor_id,  p_vendor_id),
      machine_id    = COALESCE(machine_id, p_machine_id),
      last_heartbeat = now(),
      last_seen      = now(),
      updated_at     = now()
    WHERE id = existing_device.id;

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
        WHEN existing_device.activation_status = 'rejected'    THEN 'Device has been rejected by vendor'
        WHEN existing_device.activation_status = 'expired'     THEN 'Trial or license has expired'
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
  trial_key := 'TRIAL-' ||
    upper(substring(md5(random()::text || p_mac_address) from 1 for 4)) || '-' ||
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
    SELECT id FROM rental_activation_keys
    WHERE device_id = new_device_id AND license_type = 'trial'
    LIMIT 1
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


-- =============================================
-- NEW: upsert_rental_device
-- Force full-sync of a local device to Supabase.
-- Called by server on startup / admin-triggered sync.
-- Will INSERT if not exists, or UPDATE all fields if exists.
-- =============================================
CREATE OR REPLACE FUNCTION upsert_rental_device(
  p_mac_address          TEXT,
  p_android_id           TEXT          DEFAULT NULL,
  p_device_name          TEXT          DEFAULT NULL,
  p_model                TEXT          DEFAULT NULL,
  p_ip_address           TEXT          DEFAULT NULL,
  p_vendor_id            UUID          DEFAULT NULL,
  p_machine_id           UUID          DEFAULT NULL,
  p_activation_status    TEXT          DEFAULT NULL,
  p_accepted_by_vendor   BOOLEAN       DEFAULT NULL,
  p_trial_started_at     TIMESTAMPTZ   DEFAULT NULL,
  p_trial_expires_at     TIMESTAMPTZ   DEFAULT NULL,
  p_activation_key       TEXT          DEFAULT NULL,
  p_license_expires_at   TIMESTAMPTZ   DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  existing_device RECORD;
  key_record      RECORD;
BEGIN
  p_mac_address := upper(p_mac_address);

  SELECT * INTO existing_device
  FROM rental_devices
  WHERE mac_address = p_mac_address;

  IF FOUND THEN
    -- Full update: overwrite all provided fields
    UPDATE rental_devices SET
      android_id          = COALESCE(p_android_id,         android_id),
      model               = COALESCE(p_model,              model),
      device_name         = COALESCE(p_device_name,        device_name),
      ip_address          = COALESCE(p_ip_address,         ip_address),
      vendor_id           = COALESCE(p_vendor_id,          vendor_id),
      machine_id          = COALESCE(p_machine_id,         machine_id),
      activation_status   = COALESCE(p_activation_status,  activation_status),
      accepted_by_vendor  = COALESCE(p_accepted_by_vendor, accepted_by_vendor),
      trial_started_at    = COALESCE(p_trial_started_at,   trial_started_at),
      trial_expires_at    = COALESCE(p_trial_expires_at,   trial_expires_at),
      last_heartbeat      = now(),
      last_seen           = now(),
      updated_at          = now()
    WHERE id = existing_device.id;

    -- If an activation key is provided and this device is 'active', link it
    IF p_activation_key IS NOT NULL AND p_activation_status = 'active' THEN
      SELECT id INTO key_record
      FROM rental_activation_keys
      WHERE activation_key = p_activation_key;

      IF FOUND THEN
        UPDATE rental_activation_keys SET
          device_id    = existing_device.id,
          mac_address  = p_mac_address,
          vendor_id    = COALESCE(p_vendor_id, vendor_id),
          is_active    = true,
          activated_at = COALESCE(activated_at, now()),
          expires_at   = COALESCE(p_license_expires_at, expires_at),
          updated_at   = now()
        WHERE id = key_record.id;

        UPDATE rental_devices SET
          current_license_id = key_record.id
        WHERE id = existing_device.id;
      END IF;
    END IF;

    RETURN json_build_object(
      'success', true,
      'device_id', existing_device.id,
      'action', 'updated',
      'mac_address', p_mac_address
    );
  ELSE
    -- Insert new device
    RETURN register_rental_device(
      p_mac_address,
      p_android_id,
      p_device_name,
      p_model,
      p_ip_address,
      p_vendor_id,
      p_machine_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
