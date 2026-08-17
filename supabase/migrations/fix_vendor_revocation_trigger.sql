-- Prevent 27000 trigger update conflicts by skipping nested trigger executions

CREATE OR REPLACE FUNCTION public.sync_vendor_revocation_from_license()
RETURNS TRIGGER AS $$
DECLARE
  target_hardware_id text;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_hardware_id := OLD.hardware_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.hardware_id IS NULL AND OLD.hardware_id IS NOT NULL THEN
    target_hardware_id := OLD.hardware_id;
  ELSE
    target_hardware_id := NEW.hardware_id;
  END IF;

  IF target_hardware_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  UPDATE public.vendors
  SET is_revoked = true
  WHERE hardware_id = target_hardware_id
  AND (
    TG_OP = 'DELETE'
    OR TG_OP = 'UPDATE' AND COALESCE(NEW.is_active, false) = false
    OR TG_OP = 'INSERT' AND COALESCE(NEW.is_active, false) = false
  );

  UPDATE public.vendors
  SET is_revoked = false
  WHERE hardware_id = target_hardware_id
  AND (
    TG_OP <> 'DELETE'
    AND COALESCE(NEW.is_active, false) = true
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

