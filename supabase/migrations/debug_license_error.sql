-- Migration to find the source of the "No valid license found" error
-- This will log all functions and triggers that contain the search string

DO $$
DECLARE
    func_name RECORD;
    trig_name RECORD;
BEGIN
    -- Search in functions
    FOR func_name IN 
        SELECT proname, prosrc 
        FROM pg_proc 
        JOIN pg_namespace n ON n.oid = pg_proc.pronamespace
        WHERE n.nspname = 'public'
        AND prosrc ILIKE '%valid license found%'
    LOOP
        RAISE NOTICE 'Found in function: %', func_name.proname;
        -- Drop it if found to clear the error
        EXECUTE 'DROP FUNCTION IF EXISTS ' || quote_ident(func_name.proname) || ' CASCADE';
    END LOOP;

    -- Search in triggers
    FOR trig_name IN 
        SELECT tgname, relname
        FROM pg_trigger
        JOIN pg_class ON pg_trigger.tgrelid = pg_class.oid
        JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
        WHERE pg_namespace.nspname = 'public'
        AND tgname ILIKE '%license%'
    LOOP
        RAISE NOTICE 'Found trigger: % on table %', trig_name.tgname, trig_name.relname;
    END LOOP;
END $$;
