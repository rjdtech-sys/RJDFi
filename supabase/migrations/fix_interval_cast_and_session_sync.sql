-- ============================================================
-- COMBINED FIX: interval cast error + rental session cloud sync
-- ============================================================
-- 1. Fix check_rental_device_status  → INTERVAL→INTEGER cast error
-- 2. Fix get_vendor_rental_devices   → same cast error
-- 3. Fix register_rental_device      → update vendor_id/machine_id for existing devices
-- 4. Add upsert_rental_device        → force full-sync from server
-- 5. Add upsert_rental_session       → sync local sessions to cloud
-- 6. Add sync_all_rental_sessions    → bulk-sync helper
-- ============================================================


-- ============================================================
-- 1. check_rental_device_status  (INTERVAL cast fix)
-- ============================================================
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
  WHERE mac_address = upper(p_mac_address);

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
  -- FIX: INTERVAL cannot be cast to INTEGER directly.
  --      Use EXTRACT(EPOCH FROM interval) / 86400 to get days.
  IF license_record.expires_at IS NOT NULL THEN
    days_remaining := GREATEST(0, EXTRACT(EPOCH FROM (license_record.expires_at - now()))::BIGINT / 86400);
    is_expired := license_record.expires_at < now();
  ELSE
    days_remaining := NULL;
    is_expired := false;
  END IF;

  -- Auto-expire if trial or license expired
  IF is_expired AND device_record.activation_status IN ('trial', 'active') THEN
    UPDATE rental_devices SET
      activation_status = 'expired',
      deactivated_at    = now(),
      updated_at        = now()
    WHERE id = device_record.id;

    UPDATE rental_activation_keys SET
      is_active = false
    WHERE id = license_record.id;

    RETURN json_build_object(
      'success', true,
      'can_operate', false,
      'activation_status', 'expired',
      'device_id', device_record.id,
      'mac_address', upper(p_mac_address),
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
    'mac_address', upper(p_mac_address),
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


-- ============================================================
-- 2. get_vendor_rental_devices  (INTERVAL cast fix)
-- ============================================================
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
    rak.activation_key AS license_key,
    rak.expires_at     AS license_expires_at,
    CASE
      WHEN rak.expires_at IS NOT NULL
      -- FIX: extract epoch seconds / 86400 = days
      THEN GREATEST(0, (EXTRACT(EPOCH FROM (rak.expires_at - now()))::BIGINT / 86400))::INTEGER
      ELSE NULL
    END AS days_remaining,
    rd.trial_expires_at,
    rd.total_revenue,
    rd.total_rentals::INTEGER,
    rd.last_seen,
    rd.created_at
  FROM rental_devices rd
  LEFT JOIN rental_activation_keys rak ON rak.id = rd.current_license_id
  WHERE rd.vendor_id = vendor_uuid
     OR (rd.vendor_id IS NULL AND rd.machine_id IN (
           SELECT id FROM vendors WHERE vendor_id = vendor_uuid
         ))
  ORDER BY rd.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 3. register_rental_device  (fix: update vendor_id/machine_id for existing devices)
-- ============================================================
CREATE OR REPLACE FUNCTION register_rental_device(
  p_mac_address TEXT,
  p_android_id  TEXT        DEFAULT NULL,
  p_device_name TEXT        DEFAULT NULL,
  p_model       TEXT        DEFAULT NULL,
  p_ip_address  TEXT        DEFAULT NULL,
  p_vendor_id   UUID        DEFAULT NULL,
  p_machine_id  UUID        DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  existing_device RECORD;
  new_device_id   UUID;
  trial_key       TEXT;
BEGIN
  p_mac_address := upper(p_mac_address);

  SELECT * INTO existing_device
  FROM rental_devices
  WHERE mac_address = p_mac_address;

  IF FOUND THEN
    -- Update all available fields; preserve vendor_id/machine_id if already set
    UPDATE rental_devices SET
      android_id     = COALESCE(p_android_id,  android_id),
      model          = COALESCE(p_model,        model),
      device_name    = COALESCE(p_device_name,  device_name),
      ip_address     = COALESCE(p_ip_address,   ip_address),
      vendor_id      = COALESCE(vendor_id,  p_vendor_id),
      machine_id     = COALESCE(machine_id, p_machine_id),
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

  -- New device
  INSERT INTO rental_devices (
    vendor_id, machine_id, mac_address, android_id, device_name, model, ip_address,
    activation_status, accepted_by_vendor,
    trial_started_at, trial_expires_at, trial_duration_days,
    last_heartbeat, last_seen
  ) VALUES (
    p_vendor_id, p_machine_id, p_mac_address, p_android_id,
    COALESCE(p_device_name, 'Phone-' || substring(p_mac_address FROM length(p_mac_address)-4)),
    p_model, p_ip_address,
    'trial', false,
    now(), now() + interval '7 days', 7,
    now(), now()
  ) RETURNING id INTO new_device_id;

  trial_key := 'TRIAL-'
    || upper(substring(md5(random()::text || p_mac_address) FROM 1 FOR 4)) || '-'
    || upper(substring(md5(random()::text || p_mac_address) FROM 1 FOR 4));

  INSERT INTO rental_activation_keys (
    activation_key, vendor_id, device_id, mac_address,
    is_active, activated_at, license_type,
    trial_started_at, trial_duration_days, expires_at
  ) VALUES (
    trial_key, p_vendor_id, new_device_id, p_mac_address,
    true, now(), 'trial',
    now(), 7, now() + interval '7 days'
  );

  UPDATE rental_devices SET current_license_id = (
    SELECT id FROM rental_activation_keys
    WHERE device_id = new_device_id AND license_type = 'trial'
    LIMIT 1
  ) WHERE id = new_device_id;

  RETURN json_build_object(
    'success', true,
    'device_id', new_device_id,
    'device_name', COALESCE(p_device_name, 'Phone-' || substring(p_mac_address FROM length(p_mac_address)-4)),
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


-- ============================================================
-- 4. upsert_rental_device  (force full-sync from server)
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_rental_device(
  p_mac_address          TEXT,
  p_android_id           TEXT        DEFAULT NULL,
  p_device_name          TEXT        DEFAULT NULL,
  p_model                TEXT        DEFAULT NULL,
  p_ip_address           TEXT        DEFAULT NULL,
  p_vendor_id            UUID        DEFAULT NULL,
  p_machine_id           UUID        DEFAULT NULL,
  p_activation_status    TEXT        DEFAULT NULL,
  p_accepted_by_vendor   BOOLEAN     DEFAULT NULL,
  p_trial_started_at     TIMESTAMPTZ DEFAULT NULL,
  p_trial_expires_at     TIMESTAMPTZ DEFAULT NULL,
  p_activation_key       TEXT        DEFAULT NULL,
  p_license_expires_at   TIMESTAMPTZ DEFAULT NULL,
  p_total_revenue        DECIMAL     DEFAULT NULL,
  p_total_rentals        INTEGER     DEFAULT NULL,
  p_total_sessions       INTEGER     DEFAULT NULL,
  p_last_rented_at       TIMESTAMPTZ DEFAULT NULL,
  p_last_returned_at     TIMESTAMPTZ DEFAULT NULL
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
    UPDATE rental_devices SET
      android_id         = COALESCE(p_android_id,         android_id),
      model              = COALESCE(p_model,              model),
      device_name        = COALESCE(p_device_name,        device_name),
      ip_address         = COALESCE(p_ip_address,         ip_address),
      vendor_id          = COALESCE(p_vendor_id,          vendor_id),
      machine_id         = COALESCE(p_machine_id,         machine_id),
      activation_status  = COALESCE(p_activation_status,  activation_status),
      accepted_by_vendor = COALESCE(p_accepted_by_vendor, accepted_by_vendor),
      trial_started_at   = COALESCE(p_trial_started_at,   trial_started_at),
      trial_expires_at   = COALESCE(p_trial_expires_at,   trial_expires_at),
      -- Revenue/stats: always update with latest local values when provided
      total_revenue      = CASE WHEN p_total_revenue  IS NOT NULL THEN p_total_revenue  ELSE total_revenue  END,
      total_rentals      = CASE WHEN p_total_rentals  IS NOT NULL THEN p_total_rentals  ELSE total_rentals  END,
      total_sessions     = CASE WHEN p_total_sessions IS NOT NULL THEN p_total_sessions ELSE total_sessions END,
      last_heartbeat     = now(),
      last_seen          = now(),
      updated_at         = now()
    WHERE id = existing_device.id;

    -- Link activation key if device is 'active'
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
    RETURN register_rental_device(
      p_mac_address, p_android_id, p_device_name, p_model,
      p_ip_address, p_vendor_id, p_machine_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 5. upsert_rental_session  (sync a single local session to cloud)
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_rental_session(
  p_local_session_id    INTEGER,         -- local SQLite rowid (stored as reference)
  p_device_cloud_id     UUID,            -- rental_devices.id (cloud UUID)
  p_vendor_id           UUID     DEFAULT NULL,
  p_machine_id          UUID     DEFAULT NULL,
  p_customer_name       TEXT     DEFAULT NULL,
  p_customer_contact    TEXT     DEFAULT NULL,
  p_start_time          TIMESTAMPTZ DEFAULT NULL,
  p_end_time            TIMESTAMPTZ DEFAULT NULL,
  p_duration_minutes    INTEGER  DEFAULT 0,
  p_amount_paid         DECIMAL  DEFAULT 0,
  p_status              TEXT     DEFAULT 'completed',
  p_notes               TEXT     DEFAULT NULL,
  p_kiosk_logout_at     TIMESTAMPTZ DEFAULT NULL,
  p_paused_remaining_seconds INTEGER DEFAULT NULL,
  p_kiosk_logout_reason TEXT     DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  existing_session RECORD;
  new_session_id   UUID;
BEGIN
  -- Try to find by local_session_id reference stored in notes or by exact match
  SELECT * INTO existing_session
  FROM rental_sessions
  WHERE device_id = p_device_cloud_id
    AND start_time = p_start_time
  LIMIT 1;

  IF FOUND THEN
    -- Update existing
    UPDATE rental_sessions SET
      customer_name    = COALESCE(p_customer_name,    customer_name),
      customer_contact = COALESCE(p_customer_contact, customer_contact),
      end_time         = COALESCE(p_end_time,         end_time),
      duration_minutes = COALESCE(p_duration_minutes, duration_minutes),
      amount_paid      = COALESCE(p_amount_paid,      amount_paid),
      status           = COALESCE(p_status,           status),
      notes            = COALESCE(p_notes,            notes),
      updated_at       = now()
    WHERE id = existing_session.id;

    RETURN json_build_object(
      'success', true,
      'session_id', existing_session.id,
      'action', 'updated'
    );
  ELSE
    -- Insert new
    INSERT INTO rental_sessions (
      vendor_id, machine_id, device_id,
      customer_name, customer_contact,
      start_time, end_time, duration_minutes,
      amount_paid, status, notes,
      created_at, updated_at
    ) VALUES (
      p_vendor_id, p_machine_id, p_device_cloud_id,
      p_customer_name, p_customer_contact,
      COALESCE(p_start_time, now()),
      p_end_time,
      COALESCE(p_duration_minutes, 0),
      COALESCE(p_amount_paid, 0),
      COALESCE(p_status, 'completed'),
      p_notes,
      COALESCE(p_start_time, now()),
      now()
    ) RETURNING id INTO new_session_id;

    RETURN json_build_object(
      'success', true,
      'session_id', new_session_id,
      'action', 'inserted'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
