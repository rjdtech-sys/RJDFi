-- NUKE ALL TRIGGERS ON VENDORS TABLE
-- This ensures no hidden or manually created triggers interfere with machine registration

DO $$ 
DECLARE
    tr_name RECORD;
BEGIN
    FOR tr_name IN 
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'vendors'
    LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(tr_name.trigger_name) || ' ON vendors;';
        RAISE NOTICE 'Dropped trigger: %', tr_name.trigger_name;
    END LOOP;
END $$;

-- Also drop any potentially conflicting functions
DROP FUNCTION IF EXISTS handle_vendor_license() CASCADE;
DROP FUNCTION IF EXISTS handle_vendor_license_v2() CASCADE;
DROP FUNCTION IF EXISTS validate_vendor_license() CASCADE;
DROP FUNCTION IF EXISTS check_vendor_license() CASCADE;

-- Reinstall the correct, robust function
CREATE OR REPLACE FUNCTION public.handle_vendor_license_v3()
RETURNS TRIGGER AS $$
DECLARE
  found_license RECORD;
BEGIN
  -- If no license key is provided, just proceed but mark as unlicensed
  IF NEW.license_key IS NULL OR NEW.license_key = '' THEN
    NEW.is_licensed := false;
    RETURN NEW;
  END IF;

  -- Check if the license key exists in the licenses table
  SELECT * INTO found_license FROM public.licenses WHERE license_key = NEW.license_key;

  IF FOUND THEN
    -- License exists, bind it to this hardware if not already bound
    IF found_license.hardware_id IS NULL THEN
      UPDATE public.licenses 
      SET hardware_id = NEW.hardware_id, 
          is_active = true, 
          activated_at = now() 
      WHERE license_key = NEW.license_key;
      
      NEW.is_licensed := true;
      NEW.activated_at := now();
    ELSIF found_license.hardware_id = NEW.hardware_id THEN
      -- Already bound to this hardware
      NEW.is_licensed := found_license.is_active;
      NEW.activated_at := found_license.activated_at;
    ELSE
      -- Bound to DIFFERENT hardware!
      -- Mark as unlicensed but don't fail the insert
      NEW.is_licensed := false;
    END IF;
  ELSE
    -- License DOES NOT exist.
    -- Auto-create an unverified license record so sync doesn't fail
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
  -- Complete fallback
  NEW.is_licensed := false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
CREATE TRIGGER tr_handle_vendor_license_v3
BEFORE INSERT OR UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION public.handle_vendor_license_v3();
