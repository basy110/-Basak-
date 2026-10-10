-- e2e · «الإيصالات» › «السجل» (migration 20261117000001_admin_receipts_history.sql)
--
-- Run against a database that has the migration (or paste the migration's body,
-- without its BEGIN/COMMIT, right after the BEGIN below). Everything runs inside
-- one transaction that is rolled back: nothing persists. Any failed check raises.
--
-- Fixtures: the company with the most decided receipts, one of its company
-- admins, a company admin of another company and a platform admin. Skips (with
-- a notice) when the database has none.
BEGIN;

CREATE TEMP TABLE t_fx ON COMMIT DROP AS
SELECT r.company_id AS company,
       count(*) FILTER (WHERE r.status = 'approved') AS approved,
       count(*) FILTER (WHERE r.status = 'rejected') AS rejected,
       COALESCE(sum(COALESCE(r.amount, s.price)) FILTER (WHERE r.status = 'approved'), 0) AS approved_amount,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id = r.company_id LIMIT 1) AS own_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id IS DISTINCT FROM r.company_id LIMIT 1) AS other_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'super_admin' LIMIT 1) AS super_admin
FROM public.receipts r
LEFT JOIN public.subscriptions s ON s.id = r.subscription_id
WHERE r.status IN ('approved', 'rejected') AND r.company_id IS NOT NULL
GROUP BY r.company_id
ORDER BY count(*) DESC
LIMIT 1;
GRANT SELECT ON t_fx TO authenticated;

-- 1. Granted to authenticated only.
DO $$
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.admin_reviewed_receipts(uuid, text, date, date, text, integer, integer, uuid)', 'EXECUTE'),
    'authenticated cannot run admin_reviewed_receipts';
  ASSERT NOT has_function_privilege('anon', 'public.admin_reviewed_receipts(uuid, text, date, date, text, integer, integer, uuid)', 'EXECUTE'),
    'anon can run admin_reviewed_receipts';
END $$;

-- 2. As the company's admin: counts, sums, outcome filter, paging, search, days.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', own_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v jsonb; v_rej jsonb; v_page jsonb; v_row jsonb; v_name text; v_future jsonb; v_today jsonb;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.company IS NULL OR f.own_admin IS NULL THEN RAISE NOTICE 'no decided receipts or no company admin: skipped'; RETURN; END IF;

  v := public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, NULL, 5000, 0);
  ASSERT (v->>'total')::int = f.approved + f.rejected, format('total %s, expected %s', v->>'total', f.approved + f.rejected);
  ASSERT (v->'counts'->>'approved')::int = f.approved, 'approved count differs';
  ASSERT (v->'counts'->>'rejected')::int = f.rejected, 'rejected count differs';
  ASSERT (v->>'approved_amount')::numeric = f.approved_amount, format('approved amount %s, expected %s', v->>'approved_amount', f.approved_amount);
  ASSERT jsonb_array_length(v->'rows') = f.approved + f.rejected, 'not every row returned';
  -- Newest decision first.
  ASSERT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v->'rows') WITH ORDINALITY a(x, i)
    JOIN jsonb_array_elements(v->'rows') WITH ORDINALITY b(y, j) ON j = i + 1
    WHERE (a.x->>'reviewed_at')::timestamptz < (b.y->>'reviewed_at')::timestamptz), 'rows not ordered by reviewed_at desc';
  -- The lines add up to the total.
  ASSERT (SELECT COALESCE(sum((x->>'count')::int), 0) FROM jsonb_array_elements(v->'lines') x) <= (v->>'total')::int, 'line counts exceed total';

  v_rej := public.admin_reviewed_receipts(f.company, 'rejected', NULL, NULL, NULL, 5000, 0);
  ASSERT (v_rej->>'total')::int = f.rejected, 'rejected filter total differs';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rej->'rows') x WHERE x->>'status' <> 'rejected'), 'rejected filter returned another status';
  ASSERT (v_rej->'counts'->>'approved')::int = f.approved, 'counts must ignore the outcome filter';

  v_page := public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, NULL, 1, 1);
  ASSERT jsonb_array_length(v_page->'rows') = LEAST(1, GREATEST(f.approved + f.rejected - 1, 0)), 'paging: second page of one';
  IF f.approved + f.rejected > 1 THEN
    ASSERT v_page->'rows'->0->>'id' = v->'rows'->1->>'id', 'paging: offset 1 is not the second row';
  END IF;

  -- Search by the first row's student name and by its phone digits.
  v_row := v->'rows'->0;
  v_name := split_part(COALESCE(v_row->>'student_name', ''), ' ', 1);
  IF v_name <> '' THEN
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, v_name, 5000, 0)->'rows') x
                   WHERE x->>'id' = v_row->>'id'), 'search by name misses the row';
  END IF;
  IF length(regexp_replace(COALESCE(v_row->>'student_phone', ''), '\D', '', 'g')) >= 4 THEN
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_reviewed_receipts(f.company, NULL, NULL, NULL,
                     right(regexp_replace(v_row->>'student_phone', '\D', '', 'g'), 4), 5000, 0)->'rows') x
                   WHERE x->>'id' = v_row->>'id'), 'search by phone misses the row';
  END IF;
  ASSERT (public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, 'zzzz-لا-أحد-بهذا-الاسم', 25, 0)->>'total')::int = 0, 'nonsense search matched';

  -- Days: the first row's own Cairo day includes it; a future range is empty.
  v_today := public.admin_reviewed_receipts(f.company, NULL,
    ((v_row->>'reviewed_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date,
    ((v_row->>'reviewed_at')::timestamptz AT TIME ZONE 'Africa/Cairo')::date, NULL, 5000, 0);
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_today->'rows') x WHERE x->>'id' = v_row->>'id'), 'day range misses its own row';
  v_future := public.admin_reviewed_receipts(f.company, NULL, public.cairo_today() + 1, public.cairo_today() + 30, NULL, 25, 0);
  ASSERT (v_future->>'total')::int = 0 AND (v_future->'counts'->>'approved')::int = 0, 'future range not empty';

  -- Line filter.
  IF v_row->>'line_id' IS NOT NULL THEN
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, NULL, 5000, 0, (v_row->>'line_id')::uuid)->'rows') x
                       WHERE x->>'line_id' IS DISTINCT FROM v_row->>'line_id'), 'line filter returned another line';
  END IF;

  -- A bad outcome is refused in Arabic.
  BEGIN
    PERFORM public.admin_reviewed_receipts(f.company, 'pending', NULL, NULL, NULL, 25, 0);
    RAISE EXCEPTION 'outcome pending was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RAISE NOTICE 'own admin ok: % approved (% ج.م), % rejected', f.approved, f.approved_amount, f.rejected;
END $$;
RESET ROLE;

-- 3. Another company's admin is refused.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.company IS NULL OR f.other_admin IS NULL THEN RAISE NOTICE 'no other company admin: skipped'; RETURN; END IF;
  BEGIN
    PERFORM public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, NULL, 25, 0);
    RAISE EXCEPTION 'another company''s admin read the history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'other admin refused: ok';
END $$;
RESET ROLE;

-- 4. The platform admin reads any company.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', super_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.company IS NULL OR f.super_admin IS NULL THEN RAISE NOTICE 'no platform admin: skipped'; RETURN; END IF;
  v := public.admin_reviewed_receipts(f.company, NULL, NULL, NULL, NULL, 25, 0);
  ASSERT (v->>'total')::int = f.approved + f.rejected, 'platform admin total differs';
  RAISE NOTICE 'platform admin ok';
END $$;
RESET ROLE;

ROLLBACK;
