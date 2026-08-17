-- Update upsert_rental_session function to include payment_method column
-- This ensures cloud sync includes payment method data

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
  p_kiosk_logout_reason TEXT     DEFAULT NULL,
  p_payment_method      TEXT     DEFAULT 'cash'
)
RETURNS JSON AS $$
DECLARE
  existing_session RECORD;
  new_session_id UUID;
BEGIN
  -- Find existing session by device_id and start_time
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
      payment_method   = COALESCE(p_payment_method,   payment_method),
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
      payment_method,
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
      COALESCE(p_payment_method, 'cash'),
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
