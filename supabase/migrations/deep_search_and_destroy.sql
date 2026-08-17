-- Deep search for the error message in the database
-- This checks function bodies and view definitions

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Search in all functions
    FOR r IN 
        SELECT proname, nspname, prosrc
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE prosrc ILIKE '%No valid license found%'
    LOOP
        RAISE NOTICE 'Found error string in function: %.% (Dropping it...)', r.nspname, r.proname;
        EXECUTE 'DROP FUNCTION IF EXISTS ' || quote_ident(r.nspname) || '.' || quote_ident(r.proname) || ' CASCADE';
    END LOOP;

    -- Search in all triggers (just in case)
    -- Triggers don't have source code directly, they call functions
    -- But we can search trigger names
    FOR r IN 
        SELECT tgname, relname
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE tgname ILIKE '%license%'
    LOOP
        RAISE NOTICE 'Found trigger: % on table % (Dropping it...)', r.tgname, r.relname;
        EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident(r.tgname) || ' ON ' || quote_ident(r.relname) || ' CASCADE';
    END LOOP;
END $$;
