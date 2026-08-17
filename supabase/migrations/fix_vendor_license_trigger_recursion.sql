-- Prevent 27000 conflicts by limiting vendors license trigger scope and skipping nested executions

CREATE OR REPLACE FUNCTION public.handle_vendor_license_v3()
RETURNS TRIGGER AS $$
DECLARE
  found_license RECORD;
BEGIN
  -- If this update is happening inside another trigger chain (e.g., licenses -> vendors),
  -- do not attempt to touch licenses again.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only run when license_key or hardware_id changed.
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.license_key IS NOT DISTINCT FROM OLD.license_key)
       AND (NEW.hardware_id IS NOT DISTINCT FROM OLD.hardware_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- If no license key is provided, just proceed but mark as unlicensed
  IF NEW.license_key IS NULL OR NEW.license_key = '' THEN
    NEW.is_licensed := false;
    RETURN NEW;
  END IF;

  SELECT * INTO found_license FROM public.licenses WHERE license_key = NEW.license_key;

  IF FOUND THEN
    IF found_license.hardware_id IS NULL THEN
      UPDATE public.licenses
      SET hardware_id = NEW.hardware_id,
          is_active = true,
          activated_at = now()
      WHERE license_key = NEW.license_key;

      NEW.is_licensed := true;
      NEW.activated_at := now();
    ELSIF found_license.hardware_id = NEW.hardware_id THEN
      NEW.is_licensed := found_license.is_active;
      NEW.activated_at := found_license.activated_at;
    ELSE
      NEW.is_licensed := false;
    END IF;
  ELSE
    INSERT INTO public.licenses (
      license_key,
      hardware_id,
      is_active,
      notes
    ) VALUES (
      NEW.license_key,
      NEW.hardware_id,
      false,
      'Self-registered by machine - pending verification'
    ) ON CONFLICT (license_key) DO NOTHING;

    NEW.is_licensed := false;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.is_licensed := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger so it only fires when license fields change.
DROP TRIGGER IF EXISTS tr_handle_vendor_license_v3 ON public.vendors;
CREATE TRIGGER tr_handle_vendor_license_v3
BEFORE INSERT OR UPDATE OF license_key, hardware_id ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.handle_vendor_license_v3();

