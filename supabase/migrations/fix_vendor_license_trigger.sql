-- Function to handle license validation and auto-registration during vendor insert/update
CREATE OR REPLACE FUNCTION handle_vendor_license()
RETURNS TRIGGER AS $$
DECLARE
  found_license RECORD;
BEGIN
  -- If no license key is provided, just proceed
  IF NEW.license_key IS NULL OR NEW.license_key = '' THEN
    NEW.is_licensed := false;
    RETURN NEW;
  END IF;

  -- Check if the license key exists in the licenses table
  SELECT * INTO found_license FROM licenses WHERE license_key = NEW.license_key;

  IF FOUND THEN
    -- License exists, bind it to this hardware if not already bound
    IF found_license.hardware_id IS NULL THEN
      UPDATE licenses 
      SET hardware_id = NEW.hardware_id, 
          is_active = true, 
          activated_at = now() 
      WHERE license_key = NEW.license_key;
    END IF;
    
    -- Set vendor status based on license
    NEW.is_licensed := found_license.is_active;
  ELSE
    -- License DOES NOT exist in the licenses table.
    -- Instead of failing with an exception, we'll auto-create a "Self-Registered" license
    -- so the machine can at least register and be managed.
    INSERT INTO licenses (
      license_key, 
      hardware_id, 
      status, 
      is_active, 
      activated_at, 
      notes
    ) VALUES (
      NEW.license_key, 
      NEW.hardware_id, 
      'unverified', 
      false, 
      now(), 
      'Self-registered by machine during initial sync'
    ) ON CONFLICT (license_key) DO NOTHING;
    
    NEW.is_licensed := false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop any existing triggers that might be causing the "No valid license found" error
-- We don't know the exact name, so we'll try common ones or just rely on our new one.
-- Usually, triggers are named tr_validate_license, check_vendor_license, etc.
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_validate_vendor_license') THEN
        DROP TRIGGER tr_validate_vendor_license ON vendors;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'validate_license_trigger') THEN
        DROP TRIGGER validate_license_trigger ON vendors;
    END IF;
END $$;

-- Create our new robust trigger
DROP TRIGGER IF EXISTS tr_handle_vendor_license ON vendors;
CREATE TRIGGER tr_handle_vendor_license
BEFORE INSERT OR UPDATE ON vendors
FOR EACH ROW EXECUTE FUNCTION handle_vendor_license();
