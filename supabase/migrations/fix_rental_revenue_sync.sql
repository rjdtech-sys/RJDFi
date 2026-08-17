-- ============================================================
-- FIX: rental_devices revenue/stats not syncing to Supabase
-- The upsert_rental_device function was missing total_revenue,
-- total_rentals, total_sessions fields.
-- This migration also adds sync_device_revenue() for targeted updates.
-- ============================================================


-- ============================================================
-- 1. upsert_rental_device (with revenue/stats fields added)
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
  -- Revenue & stats
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
      -- Always overwrite stats with latest local values when provided
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
      'mac_address', p_mac_address,
      'total_revenue', COALESCE(p_total_revenue, existing_device.total_revenue)
    );
  ELSE
    -- Insert new via register_rental_device
    RETURN register_rental_device(
      p_mac_address, p_android_id, p_device_name, p_model,
      p_ip_address, p_vendor_id, p_machine_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 2. sync_device_revenue
-- Targeted revenue-only update by cloud device UUID.
-- Called immediately after session end/start on the server.
-- ============================================================
CREATE OR REPLACE FUNCTION sync_device_revenue(
  p_device_cloud_id  UUID,
  p_total_revenue    DECIMAL,
  p_total_rentals    INTEGER,
  p_total_sessions   INTEGER  DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
  UPDATE rental_devices SET
    total_revenue  = p_total_revenue,
    total_rentals  = p_total_rentals,
    total_sessions = COALESCE(p_total_sessions, total_sessions),
    updated_at     = now()
  WHERE id = p_device_cloud_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Device not found');
  END IF;

  RETURN json_build_object(
    'success', true,
    'device_id', p_device_cloud_id,
    'total_revenue', p_total_revenue,
    'total_rentals', p_total_rentals
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
