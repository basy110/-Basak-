-- e2e · admin area «team» (migration 20261116000005_admin_team.sql)
--
-- Run against a database that has the migration (or paste the migration's body,
-- without its BEGIN/COMMIT, right after the BEGIN below). Everything runs inside
-- one transaction that is rolled back: nothing persists. Any failed check raises.
--
-- It picks its own fixtures: a supervisor with boarding records, a company
-- admin of that supervisor's company, a company admin of another company and a
-- platform admin. Skips (with a notice) when the database has none.
BEGIN;

CREATE TEMP TABLE t_fx ON COMMIT DROP AS
SELECT s.id AS sup, s.company_id AS company, s.full_name AS sup_name,
       (SELECT count(*) FROM public.supervisor_scan_events e WHERE e.supervisor_id = s.id) AS scans,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id = s.company_id LIMIT 1) AS own_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id IS DISTINCT FROM s.company_id LIMIT 1) AS other_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'super_admin' LIMIT 1) AS super_admin
FROM public.supervisors s
ORDER BY (SELECT count(*) FROM public.supervisor_scan_events e WHERE e.supervisor_id = s.id) DESC
LIMIT 1;
GRANT SELECT ON t_fx TO authenticated;

-- 1. The schema: nullable column, SET NULL foreign key, name snapshot filled.
DO $$
DECLARE v_def text; v_null text; v_missing bigint;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
  WHERE conrelid = 'public.supervisor_scan_events'::regclass AND conname = 'supervisor_scan_events_supervisor_id_fkey';
  ASSERT v_def LIKE '%ON DELETE SET NULL%', 'scan events FK is not ON DELETE SET NULL: ' || COALESCE(v_def, 'missing');
  SELECT is_nullable INTO v_null FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'supervisor_scan_events' AND column_name = 'supervisor_id';
  ASSERT v_null = 'YES', 'supervisor_id is still NOT NULL';
  SELECT count(*) INTO v_missing FROM public.supervisor_scan_events e
  WHERE e.supervisor_id IS NOT NULL AND e.supervisor_name IS NULL;
  ASSERT v_missing = 0, 'scan events without supervisor_name after backfill: ' || v_missing;
END $$;

-- 2. A new record gets the scanner's name whatever is sent.
DO $$
DECLARE f record; v_name text; v_company uuid; v_id uuid;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.sup IS NULL THEN RAISE NOTICE 'no supervisor: skipped'; RETURN; END IF;
  INSERT INTO public.supervisor_scan_events (supervisor_id, ride_date, direction, result, supervisor_name)
  VALUES (f.sup, public.cairo_today(), 'departure', 'not_found', 'someone else') RETURNING id, supervisor_name, company_id INTO v_id, v_name, v_company;
  ASSERT v_name = f.sup_name, 'supervisor_name not taken from the supervisor: ' || COALESCE(v_name, 'null');
  ASSERT v_company = f.company, 'company_id not taken from the supervisor';
  -- Still refused without a supervisor (company_id cannot be derived).
  BEGIN
    INSERT INTO public.supervisor_scan_events (supervisor_id, ride_date, direction, result)
    VALUES (NULL, public.cairo_today(), 'departure', 'not_found');
    RAISE EXCEPTION 'a record without a supervisor was accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END $$;

-- 3. As the company admin: the records preview; the company's admins.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', own_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v jsonb; n int;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RAISE NOTICE 'no company admin: skipped'; RETURN; END IF;
  v := public.admin_supervisor_records(f.sup);
  ASSERT (v->>'scans')::bigint = f.scans + 1, 'scans count wrong: ' || v::text;
  ASSERT (v->>'kept')::boolean, 'kept should be true';
  SELECT count(*) INTO n FROM public.admin_list_company_admins(f.company);
  ASSERT n >= 1, 'own company admins not listed';
  BEGIN
    PERFORM public.admin_list_company_admins(NULL);
    RAISE EXCEPTION 'a company admin listed every company''s admins';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 4. As an admin of another company: refused.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.other_admin IS NULL THEN RAISE NOTICE 'no other company admin: skipped'; RETURN; END IF;
  BEGIN
    PERFORM public.admin_supervisor_records(f.sup);
    RAISE EXCEPTION 'another company''s admin read the supervisor''s records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.admin_list_company_admins(f.company);
    RAISE EXCEPTION 'another company''s admin listed this company''s admins';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 5. As the platform admin: everything, with the sign-in column.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', super_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; n int; m int;
BEGIN
  SELECT * INTO f FROM t_fx;
  SELECT count(*) INTO n FROM public.admin_list_company_admins(NULL);
  SELECT count(*) INTO m FROM public.admins WHERE role = 'company_admin';
  ASSERT n = m, format('platform admin sees %s of %s company admins', n, m);
  ASSERT (public.admin_supervisor_records(f.sup)->>'kept')::boolean;
END $$;
RESET ROLE;

-- 6. Deleting the supervisor keeps his records, their company and his name.
DO $$
DECLARE f record; v_left bigint; v_named bigint; v_company bigint;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.sup IS NULL THEN RETURN; END IF;
  DELETE FROM public.supervisors WHERE id = f.sup;
  SELECT count(*), count(*) FILTER (WHERE supervisor_name = f.sup_name), count(*) FILTER (WHERE company_id = f.company)
  INTO v_left, v_named, v_company
  FROM public.supervisor_scan_events WHERE supervisor_id IS NULL AND supervisor_name = f.sup_name;
  ASSERT v_left = f.scans + 1, format('records after delete: %s, expected %s', v_left, f.scans + 1);
  ASSERT v_named = v_left AND v_company = v_left, 'records lost their name or company';
END $$;

SELECT 'e2e_admin_team: all checks passed' AS result, scans AS records_of_test_supervisor FROM t_fx;
ROLLBACK;
