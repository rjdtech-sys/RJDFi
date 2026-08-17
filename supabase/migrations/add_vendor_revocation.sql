-- Add vendor-level revocation flag and keep it in sync with licenses

ALTER TABLE public.vendors
ADD COLUMN IF NOT EXISTS is_revoked boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.sync_vendor_revocation_from_license()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.hardware_id IS NOT NULL THEN
      UPDATE public.vendors
      SET is_revoked = true
      WHERE hardware_id = OLD.hardware_id;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.hardware_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.vendors
  SET is_revoked = NOT COALESCE(NEW.is_active, false)
  WHERE hardware_id = NEW.hardware_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_sync_vendor_revocation ON public.licenses;
CREATE TRIGGER tr_sync_vendor_revocation
AFTER INSERT OR UPDATE OF is_active, hardware_id OR DELETE ON public.licenses
FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_revocation_from_license();

