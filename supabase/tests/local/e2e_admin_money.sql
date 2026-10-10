-- e2e · admin area «money» (migration 20261116000006_admin_money.sql)
--
-- Run against a database that has the migration (or paste the migration's body,
-- without its BEGIN/COMMIT, right after the BEGIN below). Everything runs inside
-- one transaction that is rolled back: nothing persists. Any failed check raises.
--
-- Fixtures: the company with the most subscriptions, one of its admins, an
-- admin of another company and a platform admin. Skips (with a notice) when none.
BEGIN;

CREATE TEMP TABLE t_fx ON COMMIT DROP AS
SELECT c.id AS company,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id = c.id LIMIT 1) AS own_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id IS DISTINCT FROM c.id LIMIT 1) AS other_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'super_admin' LIMIT 1) AS super_admin
FROM public.companies c
ORDER BY (SELECT count(*) FROM public.subscriptions s WHERE s.company_id = c.id) DESC
LIMIT 1;
GRANT SELECT ON t_fx TO authenticated;
CREATE TEMP TABLE t_out (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON t_out TO authenticated;
-- The company's own copy of the terms (as the table owner: the function is internal).
SELECT public.copy_default_terms(company) FROM t_fx;

-- ── As the company's own admin ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', own_admin, 'role', 'authenticated')::text, true) FROM t_fx;

-- 1. The breakdown adds up: by line = by option = by method = total; it follows the baseline.
DO $$
DECLARE f record; b jsonb; b_all jsonb; r jsonb; v_total numeric; v_lines numeric; v_opts numeric; v_methods numeric;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RAISE NOTICE 'no company admin: skipped'; RETURN; END IF;
  b := public.company_revenue_breakdown(f.company);
  v_total := (b->'totals'->>'revenue')::numeric;
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_lines FROM jsonb_array_elements(b->'by_line') x;
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_opts FROM jsonb_array_elements(b->'by_option') x;
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_methods FROM jsonb_array_elements(b->'by_method') x;
  ASSERT v_total = v_lines AND v_total = v_opts AND v_total = v_methods,
    format('breakdown does not add up: total %s, lines %s, options %s, methods %s', v_total, v_lines, v_opts, v_methods);
  ASSERT jsonb_array_length(b->'by_option') = 5, 'five options expected';
  ASSERT jsonb_array_length(b->'by_line') = (SELECT count(*) FROM public.lines WHERE company_id = f.company), 'every line listed, even at zero';

  -- The same totals as the report (same filters, same baseline).
  r := public.admin_subscription_report(jsonb_build_object('company_id', f.company, 'limit', 1));
  ASSERT (r->'totals'->>'revenue')::numeric = v_total, format('report %s vs breakdown %s', r->'totals'->>'revenue', v_total);
  ASSERT (r->'totals'->>'paid')::int = (b->'totals'->>'paid')::int, 'paid count differs from the report';
  ASSERT (r->'totals'->>'unpaid')::int = (b->'totals'->>'unpaid')::int, 'unpaid count differs from the report';
  -- Rows now carry the student.
  ASSERT jsonb_array_length(r->'rows') = 0 OR (r->'rows'->0 ? 'student_id'), 'report rows have no student_id';

  -- A filter narrows both alike.
  r := public.admin_subscription_report(jsonb_build_object('company_id', f.company, 'period', 'first', 'limit', 1));
  b := public.company_revenue_breakdown(f.company, NULL, NULL, '{"period":"first"}');
  ASSERT (r->'totals'->>'revenue')::numeric = (b->'totals'->>'revenue')::numeric, 'filtered totals differ';

  -- A reset (no phrase typed by the admin; the dashboard passes the function's own constant) zeroes the count …
  b_all := public.company_revenue_breakdown(f.company);
  PERFORM public.admin_reset_reports('financial', 'RESET FINANCIAL DATA', 'e2e', f.company);
  b := public.company_revenue_breakdown(f.company);
  ASSERT (b->'totals'->>'revenue')::numeric = 0 AND (b->'totals'->>'paid')::int = 0, 'a reset did not zero the breakdown';
  ASSERT b->>'baseline' IS NOT NULL, 'baseline missing after a reset';
  -- … the history switch still sees everything …
  b := public.company_revenue_breakdown(f.company, NULL, NULL, '{"include_before_reset":true}');
  ASSERT (b->'totals'->>'revenue')::numeric >= (b_all->'totals'->>'revenue')::numeric, 'history lost after a reset';
  -- … the log names who did it, and undoing brings the numbers back.
  r := public.company_report_resets(f.company);
  ASSERT r->0->>'note' = 'e2e' AND r->0->>'reset_by_name' IS NOT NULL, 'reset log without the reset or its author';
  PERFORM public.admin_undo_report_reset((r->0->>'id')::uuid);
  b := public.company_revenue_breakdown(f.company);
  ASSERT (b->'totals'->>'revenue')::numeric = (b_all->'totals'->>'revenue')::numeric, 'undo did not restore the numbers';
  INSERT INTO t_out VALUES ('breakdown', b);
END $$;

-- 2. Terms: the impact preview changes nothing and matches what a save moves.
DO $$
DECLARE f record; t record; before jsonb; after jsonb; imp jsonb; saved jsonb; v_terms jsonb; bad text;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RETURN; END IF;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) INTO before FROM public.company_terms x WHERE x.company_id = f.company;
  SELECT * INTO t FROM public.company_terms WHERE company_id = f.company AND code = 'first';
  -- One week later end of the first term (keeps the order valid in the usual calendar).
  v_terms := jsonb_build_array(jsonb_build_object('code', 'first',
    'end_month', extract(month FROM make_date(2026, t.end_month, t.end_day) - 7)::int,
    'end_day', extract(day FROM make_date(2026, t.end_month, t.end_day) - 7)::int));
  imp := public.company_terms_impact(f.company, v_terms);
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) INTO after FROM public.company_terms x WHERE x.company_id = f.company;
  ASSERT before = after, 'the impact preview changed the terms';
  ASSERT imp ? 'open' AND imp ? 'moved_total', 'impact answer incomplete';

  -- An impossible date is refused with the save's own message.
  BEGIN
    PERFORM public.company_terms_impact(f.company, '[{"code":"summer","end_month":6,"end_day":31}]');
    bad := 'accepted';
  EXCEPTION WHEN OTHERS THEN bad := SQLERRM;
  END;
  ASSERT bad <> 'accepted' AND bad <> 'basak.terms_impact.rollback', 'an invalid date was not refused: ' || bad;

  -- The all-in-one save moves exactly what the preview said, and saves the switches with it.
  saved := public.save_company_subscription_settings(f.company, v_terms, '{"summer": false}', true, NULL, NULL);
  ASSERT (saved->>'moved_subscriptions')::int = (imp->>'moved_total')::int,
    format('preview %s vs save %s', imp->>'moved_total', saved->>'moved_subscriptions');
  ASSERT (saved->>'advance_enabled')::boolean AND NOT (saved->'on_sale'->>'summer')::boolean, 'switches not saved';
  INSERT INTO t_out VALUES ('impact', imp);
END $$;

-- 3. All or nothing: a refused part leaves the rest unsaved.
DO $$
DECLARE f record; adv boolean; ok boolean := false;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RETURN; END IF;
  SELECT advance_subscription_enabled INTO adv FROM public.companies WHERE id = f.company;
  BEGIN
    PERFORM public.save_company_subscription_settings(f.company, '[{"code":"summer","end_month":2,"end_day":30}]', NULL, NOT COALESCE(adv, false));
  EXCEPTION WHEN OTHERS THEN ok := true;
  END;
  ASSERT ok, 'an invalid date was saved';
  ASSERT (SELECT advance_subscription_enabled FROM public.companies WHERE id = f.company) IS NOT DISTINCT FROM adv, 'half a save stayed';
END $$;

-- 4. Payment methods: a full new order is saved at once; a partial or foreign list is refused.
RESET ROLE;
INSERT INTO public.company_payment_methods (company_id, method_type, display_name, instapay_address, sort_order)
SELECT company, 'instapay', n, n || '@instapay', 90 FROM t_fx, unnest(ARRAY['e2e1', 'e2e2']) n;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; ids uuid[]; out jsonb; ok boolean := false;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RETURN; END IF;
  SELECT array_agg(id ORDER BY sort_order DESC, created_at DESC) INTO ids FROM public.company_payment_methods WHERE company_id = f.company;
  out := public.reorder_payment_methods(f.company, ids);
  ASSERT (out->0->>'id')::uuid = ids[1] AND (out->0->>'sort_order')::int = 0, 'new order not saved';
  BEGIN PERFORM public.reorder_payment_methods(f.company, ids[1:1]); EXCEPTION WHEN OTHERS THEN ok := true; END;
  ASSERT ok, 'a partial order was accepted';
END $$;

-- ── As another company's admin: refused everywhere ─────────────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; n int := 0;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.other_admin IS NULL THEN RAISE NOTICE 'no other company admin: skipped'; RETURN; END IF;
  -- The breakdown and the log read the caller's own company, whatever id is passed.
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.company_revenue_breakdown(f.company)->'by_line') x
                     JOIN public.lines l ON l.id = (x->>'line_id')::uuid WHERE l.company_id = f.company), 'another company''s lines leaked';
  BEGIN PERFORM public.company_terms_impact(f.company, '[]'); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  BEGIN PERFORM public.save_company_subscription_settings(f.company, NULL, NULL, true); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  BEGIN PERFORM public.reorder_payment_methods(f.company, ARRAY[]::uuid[]); EXCEPTION WHEN insufficient_privilege THEN n := n + 1; END;
  ASSERT n = 3, format('another company''s admin got through %s of 3 writes', 3 - n);
END $$;

-- ── As the platform admin: the company's numbers by id ──────────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', super_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; b jsonb;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.super_admin IS NULL THEN RETURN; END IF;
  b := public.company_revenue_breakdown(f.company);
  ASSERT (b->'totals'->>'revenue') IS NOT NULL, 'platform admin cannot read a company''s breakdown';
END $$;

-- anon has no access.
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.company_revenue_breakdown(uuid, timestamptz, timestamptz, jsonb)', 'EXECUTE'), 'anon may run the breakdown';
  ASSERT NOT has_function_privilege('anon', 'public.save_company_subscription_settings(uuid, jsonb, jsonb, boolean, boolean, boolean)', 'EXECUTE'), 'anon may save settings';
  ASSERT NOT has_function_privilege('anon', 'public.reorder_payment_methods(uuid, uuid[])', 'EXECUTE'), 'anon may reorder';
END $$;

SELECT k, v FROM t_out;
ROLLBACK;
