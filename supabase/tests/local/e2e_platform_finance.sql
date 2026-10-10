-- e2e · platform finance and analytics (migration 20261119000002_platform_finance.sql)
--
-- Run against a database that has the migration (or paste the migration's body,
-- without its BEGIN/COMMIT, right after the BEGIN below). Everything runs inside
-- one transaction that is rolled back: nothing persists. Any failed check raises.
--
-- It takes the platform admin and a company admin, adds three synthetic companies
-- with 3,000 students, ~70 ride days of confirmations and boarding scans, paid
-- subscriptions with receipts, and a few push devices on old app versions (triggers
-- off: session_replication_role = replica), then checks, as the platform admin:
-- plans and their history, bills made and made again (idempotent), paid / waived,
-- operating costs (recurring ones carried forward), platform_billing and
-- platform_analytics (shape, numbers, insights, timings); as a company admin: every
-- function refused and the tables empty to it; signed out: no access at all.
BEGIN;

CREATE TEMP TABLE t_fx ON COMMIT DROP AS
SELECT (SELECT a.id FROM public.admins a WHERE a.role = 'super_admin' ORDER BY a.created_at LIMIT 1) AS super_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' ORDER BY a.created_at LIMIT 1) AS company_admin,
       gen_random_uuid() AS co_a, gen_random_uuid() AS co_b, gen_random_uuid() AS co_c;
CREATE TEMP TABLE t_out (label text, ms numeric, info jsonb) ON COMMIT DROP;
GRANT SELECT ON t_fx TO authenticated, anon;
GRANT SELECT, INSERT ON t_out TO authenticated;

-- 1. Synthetic companies, students, rides, receipts and devices (no triggers, no foreign-key checks).
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  f record;
  v_today date := public.cairo_today();
  v_uni uuid;
BEGIN
  SELECT * INTO f FROM t_fx;
  -- The university with the fewest lines (the students make it an opportunity).
  SELECT u.id INTO v_uni FROM public.universities u
  ORDER BY (SELECT count(*) FROM public.line_universities x WHERE x.university_id = u.id), u.name LIMIT 1;

  INSERT INTO public.companies (id, name, status, is_active, created_at) VALUES
    (f.co_a, 'شركة تجريبية أ', 'active', true, now() - interval '400 days'),
    (f.co_b, 'شركة تجريبية ب', 'active', true, now() - interval '200 days'),
    (f.co_c, 'شركة تجريبية ج', 'active', true, now() - interval '100 days');

  CREATE TEMP TABLE t_lines ON COMMIT DROP AS
  SELECT n, gen_random_uuid() AS id, gen_random_uuid() AS station_id, (ARRAY[f.co_a, f.co_b, f.co_c])[1 + (n - 1) / 2] AS company
  FROM generate_series(1, 6) n;
  INSERT INTO public.lines (id, company_id, name, price_termly, price_yearly, price_daily, is_active, bus_capacity)
  SELECT id, company, 'خط تجريبي ' || n, 3500, 6500, 50, true, 50 FROM t_lines;
  INSERT INTO public.stations (id, line_id, name, order_index, is_active, company_id)
  SELECT station_id, id, 'محطة ' || n, 0, true, company FROM t_lines;

  -- 3,000 students: line n gets every sixth; company C's subscriptions end ten days ago (it declines).
  CREATE TEMP TABLE t_stu ON COMMIT DROP AS
  SELECT i, gen_random_uuid() AS id, gen_random_uuid() AS sub_id, l.id AS line_id, l.station_id, l.company
  FROM generate_series(1, 3000) i JOIN t_lines l ON l.n = 1 + i % 6;
  INSERT INTO public.students (id, phone, full_name, university, university_id, college, specialisation, created_at)
  SELECT s.id, '0158' || lpad(s.i::text, 7, '0'), 'طالب تجريبي ' || s.i, u.name, v_uni,
         (ARRAY['الهندسة', 'الطب', 'التجارة', 'غير محدد', ' الهندسة '])[1 + s.i % 5], (ARRAY['مدني', NULL, 'محاسبة'])[1 + s.i % 3],
         now() - make_interval(days => s.i % 150)
  FROM t_stu s JOIN public.universities u ON u.id = v_uni;
  INSERT INTO public.company_students (company_id, student_id, status, joined_at)
  SELECT company, id, 'active', now() - interval '140 days' FROM t_stu;
  INSERT INTO public.subscriptions (id, student_id, company_id, line_id, station_id, departure_time, return_time, type, status, start_date, end_date, price, paid_at, period_code, academic_year, created_at)
  SELECT s.sub_id, s.id, s.company, s.line_id, s.station_id, time '07:00', time '14:00', 'termly', CASE WHEN s.company = f.co_c THEN 'expired' ELSE 'active' END,
         v_today - 110, CASE WHEN s.company = f.co_c THEN v_today - 10 ELSE v_today + 60 END, 3500,
         now() - make_interval(days => 20 + s.i % 80), 'first', 2026, now() - interval '112 days'
  FROM t_stu s;
  INSERT INTO public.receipts (subscription_id, company_id, image_url, status, attempt_number, amount, created_at, reviewed_at)
  SELECT s.sub_id, s.company, 'test-platform/' || s.sub_id || '.jpg', 'approved', 1, 3400,
         now() - make_interval(days => 20 + s.i % 80) - CASE WHEN s.company = f.co_b THEN interval '40 hours' ELSE interval '3 hours' END,
         now() - make_interval(days => 20 + s.i % 80)
  FROM t_stu s;

  CREATE TEMP TABLE t_days ON COMMIT DROP AS
  SELECT d::date AS d FROM generate_series(v_today - 100, v_today, interval '1 day') d WHERE extract(dow FROM d) BETWEEN 0 AND 4;
  INSERT INTO public.daily_ride_status (student_id, ride_date, is_riding, is_returning, company_id, subscription_id)
  SELECT s.id, d.d, true, true, s.company, s.sub_id
  FROM t_stu s CROSS JOIN t_days d
  WHERE abs(hashtext(s.i::text || d.d::text)) % 100 < 70 AND (s.company <> f.co_c OR d.d <= v_today - 10)
  ON CONFLICT (student_id, ride_date) DO NOTHING;
  INSERT INTO public.supervisor_scan_events (company_id, line_id, student_id, subscription_id, ride_date, direction, result, scanned_at)
  SELECT r.company_id, s.line_id, r.student_id, r.subscription_id, r.ride_date, 'departure', 'checked_in', r.ride_date + time '07:05'
  FROM public.daily_ride_status r JOIN t_stu s ON s.sub_id = r.subscription_id
  WHERE r.ride_date >= v_today - 30 AND abs(hashtext(r.id::text)) % 10 < 8;

  -- Ten Android devices, six of them older than the latest version.
  INSERT INTO public.push_devices (user_id, installation_id, platform, token, app_version)
  SELECT s.id, 'test-install-' || s.i, 'android', 'ExponentPushToken[test-platform-' || s.i || ']', CASE WHEN s.i <= 6 THEN '0.0.1' ELSE '999.0.0' END
  FROM t_stu s WHERE s.i <= 10;
END $$;
SET LOCAL session_replication_role = origin;
ANALYZE public.daily_ride_status, public.subscriptions, public.supervisor_scan_events, public.receipts, public.students, public.company_students;

-- 2. As the platform admin.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', super_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE
  f record; v jsonb; p1 jsonb; p2 jsonb; t0 timestamptz; ms numeric; k text; v_keys text[];
  v_today date := public.cairo_today();
  v_n int; v_charge uuid; v_charge2 uuid; v_exp uuid; v_exp2 uuid;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.super_admin IS NULL THEN RAISE EXCEPTION 'no platform admin in this database'; END IF;

  -- Plans: A monthly from 100 days ago, B termly, C yearly from 400 days ago.
  p1 := public.save_company_plan(f.co_a, 1500, 'monthly', v_today - 100, '  خصم الإطلاق  ');
  ASSERT p1->>'note' = 'خصم الإطلاق', 'note not trimmed';
  ASSERT (p1->>'ended_plan_id') IS NULL, 'a first plan ended something';
  PERFORM public.save_company_plan(f.co_b, 4000, 'termly', v_today - 60, NULL);
  PERFORM public.save_company_plan(f.co_c, 12000, 'yearly', v_today - 400, NULL);

  BEGIN
    PERFORM public.save_company_plan(f.co_a, 1000, 'weekly', v_today, NULL);
    RAISE EXCEPTION 'unknown cycle accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_company_plan(f.co_a, -5, 'monthly', v_today, NULL);
    RAISE EXCEPTION 'negative fee accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_company_plan(f.co_a, 1000, 'monthly', v_today - 200, NULL);
    RAISE EXCEPTION 'a plan starting before the open one was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Bills up to today, then again: nothing new.
  t0 := clock_timestamp();
  v := public.platform_generate_charges(v_today);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  SELECT count(*) INTO v_n FROM public.platform_charges WHERE company_id = f.co_a;
  ASSERT v_n BETWEEN 4 AND 5, 'monthly bills for A: ' || v_n;
  ASSERT (SELECT count(*) FROM public.platform_charges WHERE company_id = f.co_c) = 2, 'yearly bills for C';
  ASSERT (SELECT count(*) FROM public.platform_charges WHERE company_id = f.co_b) >= 1, 'no termly bill for B';
  ASSERT (SELECT bool_and(amount = 1500) FROM public.platform_charges WHERE company_id = f.co_a), 'A billed a wrong amount';
  ASSERT (SELECT min(period_start) FROM public.platform_charges WHERE company_id = f.co_a) = v_today - 100, 'A first period';
  INSERT INTO t_out VALUES ('generate charges', ms, v);
  v := public.platform_generate_charges(v_today);
  ASSERT (v->>'charges_created')::int = 0, 'second run made bills: ' || v::text;

  -- A changes to 2000 from ten days ago: the open plan ends, unpaid bills from then are made again.
  p2 := public.save_company_plan(f.co_a, 2000, 'monthly', v_today - 10, NULL);
  ASSERT p2->>'ended_plan_id' = p1->>'id', 'the old plan was not ended';
  ASSERT (SELECT ends_on FROM public.company_plans WHERE id = (p1->>'id')::uuid) = v_today - 11, 'old plan end date';
  ASSERT (SELECT count(*) FROM public.company_plans WHERE company_id = f.co_a) = 2, 'history not kept';
  ASSERT NOT EXISTS (SELECT 1 FROM public.platform_charges WHERE company_id = f.co_a AND period_end >= v_today - 10 AND plan_id = (p1->>'id')::uuid),
    'a bill of the old plan still runs past the change';
  v := public.platform_generate_charges(v_today);
  ASSERT EXISTS (SELECT 1 FROM public.platform_charges WHERE company_id = f.co_a AND period_start = v_today - 10 AND amount = 2000),
    'the new plan made no bill';

  -- Paid and waived.
  SELECT id INTO v_charge FROM public.platform_charges WHERE company_id = f.co_a ORDER BY period_start LIMIT 1;
  SELECT id INTO v_charge2 FROM public.platform_charges WHERE company_id = f.co_a ORDER BY period_start OFFSET 1 LIMIT 1;
  v := public.set_platform_charge_status(v_charge, 'paid', 'إنستاباي', NULL);
  ASSERT v->>'status' = 'paid' AND v->>'paid_at' IS NOT NULL AND v->>'method' = 'إنستاباي' AND v->>'company_name' = 'شركة تجريبية أ', 'paid: ' || v::text;
  v := public.set_platform_charge_status(v_charge2, 'waived', NULL, 'شهر مجاني');
  ASSERT v->>'status' = 'waived' AND v->>'paid_at' IS NULL AND v->>'note' = 'شهر مجاني', 'waived: ' || v::text;
  BEGIN
    PERFORM public.set_platform_charge_status(v_charge, 'lost', NULL, NULL);
    RAISE EXCEPTION 'unknown status accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.set_platform_charge_status(gen_random_uuid(), 'paid', NULL, NULL);
    RAISE EXCEPTION 'a missing bill was marked';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  -- Operating costs: hosting recurring from three months ago, salaries this month; one edited, one deleted.
  v := public.save_platform_expense(NULL, (date_trunc('month', v_today) - interval '3 months')::date + 9, 'hosting', 800, 'Supabase', true);
  v_exp := (v->>'id')::uuid;
  ASSERT (v->>'month')::date = (date_trunc('month', v_today) - interval '3 months')::date, 'month not its first day';
  v := public.save_platform_expense(NULL, v_today, 'salaries', 90000, NULL, false);
  v_exp2 := (v->>'id')::uuid;
  v := public.save_platform_expense(v_exp2, v_today, 'salaries', 95000, 'الدعم', false);
  ASSERT (v->>'amount')::numeric = 95000 AND v->>'note' = 'الدعم', 'edit: ' || v::text;
  BEGIN
    PERFORM public.save_platform_expense(NULL, v_today, 'hosting', 0, NULL, false);
    RAISE EXCEPTION 'a zero cost was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_platform_expense(NULL, v_today, 'yachts', 10, NULL, false);
    RAISE EXCEPTION 'an unknown category was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  v := public.save_platform_expense(NULL, v_today, 'other', 10, 'للحذف', false);
  v := public.delete_platform_expense((v->>'id')::uuid);
  BEGIN
    PERFORM public.delete_platform_expense((v->>'id')::uuid);
    RAISE EXCEPTION 'a deleted cost was deleted again';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  v := public.platform_generate_charges(v_today);
  ASSERT (v->>'expenses_carried')::int = 3, 'recurring hosting not carried to three months: ' || v::text;
  v := public.platform_generate_charges(v_today);
  ASSERT (v->>'expenses_carried')::int = 0, 'recurring carried twice';

  -- platform_billing.
  t0 := clock_timestamp();
  v := public.platform_billing();
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  FOREACH k IN ARRAY ARRAY['today', 'grace_days', 'mrr', 'companies', 'plans', 'charges', 'expenses', 'pnl'] LOOP
    ASSERT v ? k, 'billing: missing key ' || k;
  END LOOP;
  ASSERT (SELECT (c->'plan'->>'fee_amount')::numeric FROM jsonb_array_elements(v->'companies') c WHERE c->>'id' = f.co_a::text) = 2000, 'billing: A plan';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(v->'plans') p WHERE p->>'company_id' = f.co_a::text) = 2, 'billing: A history';
  ASSERT (v->>'mrr')::numeric >= 2000 + 1000 + 1000, 'mrr: ' || (v->>'mrr');
  ASSERT (SELECT sum((m->>'costs')::numeric) FROM jsonb_array_elements(v->'pnl') m) = 95000 + 4 * 800, 'pnl costs';
  ASSERT (SELECT sum((m->>'collected')::numeric) FROM jsonb_array_elements(v->'pnl') m) = 1500, 'pnl collected';
  INSERT INTO t_out VALUES ('platform_billing', ms, jsonb_build_object('mrr', v->'mrr', 'charges', jsonb_array_length(v->'charges'), 'bytes', length(v::text)));

  -- platform_analytics, last 30 days. The first read after the bulk insert also sets hint bits.
  PERFORM public.platform_analytics(v_today - 29, NULL);
  t0 := clock_timestamp();
  v := public.platform_analytics(v_today - 29, NULL);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  FOREACH k IN ARRAY ARRAY['period', 'finance', 'companies', 'students', 'usage', 'insights'] LOOP
    ASSERT v ? k, 'analytics: missing key ' || k;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['mrr', 'billed', 'collected', 'outstanding', 'overdue', 'costs_total', 'costs_by_category', 'by_month',
                           'profit', 'margin', 'cost_per_company', 'cost_per_student'] LOOP
    ASSERT v->'finance' ? k, 'finance: missing key ' || k;
  END LOOP;
  -- The months the period touches: this one, and the last one when the period starts in it.
  ASSERT (v->'finance'->>'costs_total')::numeric = 95000 + 800 * CASE WHEN date_trunc('month', v_today - 29) < date_trunc('month', v_today) THEN 2 ELSE 1 END,
    'costs_total: ' || (v->'finance'->>'costs_total');
  ASSERT (v->'finance'->>'outstanding')::numeric > 0, 'nothing outstanding';
  ASSERT jsonb_array_length(v->'finance'->'overdue') >= 1, 'nothing overdue';
  ASSERT (SELECT (c->>'students')::int FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_a::text) = 1000, 'A students';
  ASSERT (SELECT (c->>'subscribers')::int FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_a::text) = 1000, 'A subscribers';
  ASSERT (SELECT (c->>'confirm_rate')::numeric FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_a::text) BETWEEN 0.6 AND 0.8,
    'A confirm rate';
  ASSERT (SELECT (c->>'company_revenue')::numeric FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_a::text) > 0, 'A revenue';
  ASSERT (SELECT (c->>'health')::int FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_a::text) BETWEEN 0 AND 100, 'A health';
  ASSERT (SELECT (c->>'median_review_hours')::numeric FROM jsonb_array_elements(v->'companies'->'list') c WHERE c->>'id' = f.co_b::text) > 24, 'B reviews';
  ASSERT (v->'students'->>'total')::int >= 3000, 'students total';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'students'->'by_college') c WHERE c->>'name' IN ('غير محدد', ' الهندسة ')), 'placeholder college listed';
  ASSERT jsonb_array_length(v->'usage'->'daily') BETWEEN 1 AND 60, 'usage daily';
  ASSERT (v->'usage'->'devices'->>'android')::int >= 10, 'devices';
  SELECT array_agg(DISTINCT i->>'key') INTO v_keys FROM jsonb_array_elements(v->'insights') i;
  FOREACH k IN ARRAY ARRAY['company_overdue', 'company_declining', 'slow_reviews', 'old_app_versions', 'unprofitable', 'university_opportunity'] LOOP
    ASSERT k = ANY (v_keys), 'insight not raised: ' || k || ' (got ' || array_to_string(v_keys, ',') || ')';
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM public.company_plans p WHERE p.company_id = c.id AND p.ends_on IS NULL)) THEN
    ASSERT 'no_plan' = ANY (v_keys), 'no_plan not raised';
  END IF;
  ASSERT (v->'insights'->0->>'severity') = 'act', 'act insights must come first';
  ASSERT ms < 1500, 'analytics too slow: ' || ms || ' ms';
  INSERT INTO t_out VALUES ('platform_analytics, last 30 days', ms, jsonb_build_object(
    'finance', (v->'finance') - 'by_month'::text - 'overdue'::text - 'costs_by_category'::text, 'insights', to_jsonb(v_keys), 'bytes', length(v::text)));

  -- All time, and an empty period.
  t0 := clock_timestamp();
  v := public.platform_analytics(NULL, NULL);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  ASSERT v->'period'->>'previous_from' IS NULL, 'all time has a previous period';
  ASSERT ms < 2500, 'all time too slow: ' || ms || ' ms';
  INSERT INTO t_out VALUES ('platform_analytics, all time', ms, jsonb_build_object('months', jsonb_array_length(v->'finance'->'by_month')));
  -- A period whose previous one has subscribers but no costs: a cost per student of 0 before
  -- (a division by it once failed while the plan was being made).
  v := public.platform_analytics(v_today - 105, v_today - 104);
  ASSERT (v->'finance'->>'cost_per_student_before')::numeric = 0, 'cost per student before: ' || COALESCE(v->'finance'->>'cost_per_student_before', 'null');
  v := public.platform_analytics(DATE '2001-01-01', DATE '2001-01-31');
  ASSERT (v->'finance'->>'collected')::numeric = 0 AND jsonb_array_length(v->'usage'->'daily') = 0, 'empty period not empty';
  BEGIN
    PERFORM public.platform_analytics(DATE '2026-10-10', DATE '2026-10-01');
    RAISE EXCEPTION 'reversed period accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- The tables read directly (RLS lets the platform admin in).
  ASSERT (SELECT count(*) FROM public.company_plans) >= 4 AND (SELECT count(*) FROM public.platform_expenses) >= 5, 'platform admin cannot read the tables';
END $$;
RESET ROLE;

-- 3. As a company admin: every function refused, the tables empty, writes refused.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', company_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v_n int;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.company_admin IS NULL THEN RAISE NOTICE 'no company admin: skipped'; RETURN; END IF;
  BEGIN PERFORM public.platform_billing(); RAISE EXCEPTION 'company admin read platform_billing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.platform_analytics(NULL, NULL); RAISE EXCEPTION 'company admin read platform_analytics';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.save_company_plan(f.co_a, 1, 'monthly', public.cairo_today(), NULL); RAISE EXCEPTION 'company admin saved a plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.platform_generate_charges(NULL); RAISE EXCEPTION 'company admin made bills';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.set_platform_charge_status(gen_random_uuid(), 'paid', NULL, NULL); RAISE EXCEPTION 'company admin marked a bill';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.save_platform_expense(NULL, public.cairo_today(), 'other', 1, NULL, false); RAISE EXCEPTION 'company admin added a cost';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.delete_platform_expense(gen_random_uuid()); RAISE EXCEPTION 'company admin deleted a cost';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT (SELECT count(*) FROM public.company_plans) + (SELECT count(*) FROM public.platform_charges) + (SELECT count(*) FROM public.platform_expenses) INTO v_n;
  ASSERT v_n = 0, 'company admin sees platform rows: ' || v_n;
  BEGIN
    INSERT INTO public.platform_expenses (month, category, amount) VALUES (date_trunc('month', now())::date, 'other', 1);
    RAISE EXCEPTION 'company admin inserted a cost';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.platform_charges SET status = 'paid';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 0, 'company admin updated bills';
END $$;
RESET ROLE;

-- 4. Signed out: no access at all.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM public.platform_billing(); RAISE EXCEPTION 'anon called platform_billing';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.platform_analytics(NULL, NULL); RAISE EXCEPTION 'anon called platform_analytics';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.platform_charges; RAISE EXCEPTION 'anon read platform_charges';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.company_plans; RAISE EXCEPTION 'anon read company_plans';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.platform_expenses; RAISE EXCEPTION 'anon read platform_expenses';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT label, ms, info FROM t_out;
ROLLBACK;
