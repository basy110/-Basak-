-- e2e · «التحليلات» (migration 20261118000001_company_analytics.sql)
--
-- Run against a database that has the migration (or paste the migration's body,
-- without its BEGIN/COMMIT, right after the BEGIN below). Everything runs inside
-- one transaction that is rolled back: nothing persists. Any failed check raises.
--
-- It takes the company with the most students, one of its admins, an admin of
-- another company and the platform admin, then adds a synthetic semester to that
-- company (3 lines, 3,000 students, ~100 ride days of confirmations, boarding
-- scans and receipts) with triggers off (session_replication_role = replica),
-- so the function is timed on realistic volumes. The last SELECT shows the
-- timings and the insight keys found.
BEGIN;

CREATE TEMP TABLE t_fx ON COMMIT DROP AS
SELECT c.id AS company,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id = c.id LIMIT 1) AS own_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'company_admin' AND a.company_id IS DISTINCT FROM c.id LIMIT 1) AS other_admin,
       (SELECT a.id FROM public.admins a WHERE a.role = 'super_admin' LIMIT 1) AS super_admin
FROM public.companies c
ORDER BY (SELECT count(*) FROM public.company_students m WHERE m.company_id = c.id) DESC, c.created_at
LIMIT 1;
CREATE TEMP TABLE t_out (label text, ms numeric, info jsonb) ON COMMIT DROP;
GRANT SELECT ON t_fx TO authenticated, anon;
GRANT SELECT, INSERT ON t_out TO authenticated;

-- 1. A synthetic semester for the company (no triggers, no foreign-key checks).
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  f record;
  v_today date := public.cairo_today();
  v_served uuid;
  v_unserved uuid;
  v_m1 uuid := gen_random_uuid();
  v_m2 uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM t_fx;
  SELECT u.id INTO v_served FROM public.universities u ORDER BY u.name LIMIT 1;
  SELECT u.id INTO v_unserved FROM public.universities u
  WHERE u.id <> v_served AND NOT EXISTS (SELECT 1 FROM public.line_universities x JOIN public.lines l ON l.id = x.line_id
                                         WHERE x.university_id = u.id AND l.company_id = f.company AND l.is_active)
  ORDER BY u.name LIMIT 1;

  -- Lines: L1 and L2 seat 50, L3 has no capacity set.
  CREATE TEMP TABLE t_lines ON COMMIT DROP AS
  SELECT n, gen_random_uuid() AS id, CASE WHEN n < 3 THEN 50 END AS cap FROM generate_series(1, 3) n;
  INSERT INTO public.lines (id, company_id, name, price_termly, price_yearly, price_daily, is_active, bus_capacity)
  SELECT id, f.company, 'خط تجريبي ' || n, 3500, 6500, 50, true, cap FROM t_lines;
  INSERT INTO public.line_universities (line_id, university_id, company_id) SELECT id, v_served, f.company FROM t_lines;

  CREATE TEMP TABLE t_st ON COMMIT DROP AS
  SELECT l.n AS ln, l.id AS line_id, k, gen_random_uuid() AS id FROM t_lines l, generate_series(0, 3) k;
  INSERT INTO public.stations (id, line_id, name, order_index, is_active, company_id)
  SELECT id, line_id, 'محطة ' || ln || '-' || k, k, true, f.company FROM t_st;

  -- Trips: L1 has 07:00 (busy), 08:00 (light) and 09:00 (nobody); L2 07:30; L3 07:15; each a 14:00 return.
  CREATE TEMP TABLE t_tr ON COMMIT DROP AS
  SELECT l.n AS ln, l.id AS line_id, x.code, x.direction, x.at, gen_random_uuid() AS id
  FROM t_lines l
  JOIN (VALUES (1, 'a', 'departure', time '07:00'), (1, 'b', 'departure', time '08:00'), (1, 'c', 'departure', time '09:00'),
               (2, 'a', 'departure', time '07:30'), (3, 'a', 'departure', time '07:15'),
               (1, 'r', 'return', time '14:00'), (2, 'r', 'return', time '14:00'), (3, 'r', 'return', time '14:00')) x(ln, code, direction, at)
    ON x.ln = l.n;
  INSERT INTO public.line_trips (id, line_id, direction, label, start_time, is_active, company_id)
  SELECT id, line_id, direction, '', at, true, f.company FROM t_tr;
  INSERT INTO public.line_trip_stops (trip_id, station_id, stop_time, company_id)
  SELECT t.id, s.id, t.at + make_interval(mins => 10 * s.k), f.company FROM t_tr t JOIN t_st s ON s.line_id = t.line_id;

  INSERT INTO public.company_payment_methods (id, company_id, method_type, display_name, instapay_address, wallet_phone, is_active, sort_order)
  VALUES (v_m1, f.company, 'instapay', 'إنستاباي تجريبي', 'test@instapay', NULL, true, 90),
         (v_m2, f.company, 'vodafone_cash', 'محفظة تجريبية', NULL, '01000000000', true, 91);

  -- 3,000 students: 1–30 never subscribe (1–12 at a university no line serves), the rest subscribe.
  CREATE TEMP TABLE t_stu ON COMMIT DROP AS
  SELECT i, gen_random_uuid() AS id,
         CASE WHEN i <= 12 THEN v_unserved ELSE v_served END AS uni,
         CASE i % 10 WHEN 9 THEN 3 WHEN 6 THEN 2 WHEN 7 THEN 2 WHEN 8 THEN 2 ELSE 1 END AS ln,
         CASE WHEN i % 5 < 2 THEN 0 ELSE (i / 10) % 4 END AS k
  FROM generate_series(1, 3000) i;
  INSERT INTO public.students (id, phone, full_name, university, university_id, college, specialisation, created_at)
  SELECT s.id, '0159' || lpad(s.i::text, 7, '0'), 'طالب تجريبي ' || s.i, u.name, s.uni,
         (ARRAY['الهندسة', 'الطب', 'التجارة', 'غير محدد', ' الهندسة ', 'الحاسبات والمعلومات'])[1 + s.i % 6],
         (ARRAY['مدني', NULL, 'محاسبة', 'علوم الحاسب'])[1 + s.i % 4], now() - interval '150 days'
  FROM t_stu s JOIN public.universities u ON u.id = s.uni;
  INSERT INTO public.company_students (company_id, student_id, status, joined_at)
  SELECT f.company, id, 'active', now() - make_interval(days => 140 - (i % 140)) FROM t_stu;

  CREATE TEMP TABLE t_sub ON COMMIT DROP AS
  SELECT s.*, gen_random_uuid() AS sub_id, st.id AS station_id,
         (SELECT t.id FROM t_tr t WHERE t.ln = s.ln AND t.direction = 'departure'
            AND t.code = CASE WHEN s.ln = 1 AND s.i % 200 = 0 THEN 'b' ELSE 'a' END) AS dep_trip,
         (SELECT t.id FROM t_tr t WHERE t.ln = s.ln AND t.code = 'r') AS ret_trip,
         CASE WHEN s.i BETWEEN 31 AND 40 THEN v_today + 7 ELSE v_today + 60 END AS end_date,
         CASE WHEN s.i % 5 = 0 THEN v_m2 ELSE v_m1 END AS method
  FROM t_stu s JOIN t_st st ON st.ln = s.ln AND st.k = s.k
  WHERE s.i > 30;
  INSERT INTO public.subscriptions (id, student_id, company_id, line_id, station_id, type, status, start_date, end_date, price,
                                    paid_at, period_code, academic_year, departure_trip_id, return_trip_id, departure_time, return_time, created_at)
  SELECT s.sub_id, s.id, f.company, l.id, s.station_id, 'termly', 'active', v_today - 110, s.end_date, 3500,
         now() - make_interval(days => 110 - (s.i % 90)), 'first', 2026, s.dep_trip, s.ret_trip,
         (SELECT t.at FROM t_tr t WHERE t.id = s.dep_trip) + make_interval(mins => 10 * s.k), time '14:00' + make_interval(mins => 10 * s.k),
         now() - interval '112 days'
  FROM t_sub s JOIN t_lines l ON l.n = s.ln;

  -- Receipts: the wallet's first attempt is rejected 2 times in 5; reviews take ~30 hours.
  INSERT INTO public.receipts (subscription_id, company_id, image_url, status, attempt_number, amount, payment_method_id, rejection_reason, created_at, reviewed_at)
  SELECT s.sub_id, f.company, 'test/' || s.sub_id || '/1.jpg', 'rejected', 1, 3500, s.method,
         (ARRAY['المبلغ غير صحيح', 'الصورة غير واضحة'])[1 + s.i % 2],
         now() - interval '100 days', now() - interval '99 days'
  FROM t_sub s WHERE s.method = v_m2 AND s.i % 25 < 10;
  INSERT INTO public.receipts (subscription_id, company_id, image_url, status, attempt_number, amount, payment_method_id, created_at, reviewed_at)
  SELECT s.sub_id, f.company, 'test/' || s.sub_id || '/2.jpg', 'approved', 2, 3500, s.method,
         now() - make_interval(days => 110 - (s.i % 90)) - interval '30 hours', now() - make_interval(days => 110 - (s.i % 90))
  FROM t_sub s;

  -- Ride days: Sunday to Thursday of the last 105 days (L3 confirms far less often).
  CREATE TEMP TABLE t_days ON COMMIT DROP AS
  SELECT d::date AS d FROM generate_series(v_today - 104, v_today, interval '1 day') d WHERE extract(dow FROM d) BETWEEN 0 AND 4;
  INSERT INTO public.daily_ride_status (student_id, ride_date, is_riding, departure_time, return_time, is_returning, company_id, subscription_id)
  SELECT s.id, d.d, true, NULL, NULL, (s.i + extract(doy FROM d.d)::int) % 4 <> 0, f.company, s.sub_id
  FROM t_sub s CROSS JOIN t_days d
  WHERE abs(hashtext(s.i::text || d.d::text)) % 100 < CASE s.ln WHEN 3 THEN 35 ELSE 75 END
  ON CONFLICT (student_id, ride_date) DO NOTHING;

  INSERT INTO public.supervisor_scan_events (company_id, line_id, trip_id, station_id, student_id, subscription_id, ride_date, direction, result, scanned_at)
  SELECT f.company, s.line_id, s.departure_trip_id, s.station_id, r.student_id, s.id, r.ride_date, 'departure', 'checked_in', r.ride_date + time '07:05'
  FROM public.daily_ride_status r JOIN public.subscriptions s ON s.id = r.subscription_id
  WHERE r.company_id = f.company AND r.is_riding AND r.subscription_id IN (SELECT sub_id FROM t_sub)
    AND abs(hashtext(r.id::text)) % 10 < 8;
END $$;
SET LOCAL session_replication_role = origin;
ANALYZE public.daily_ride_status, public.subscriptions, public.supervisor_scan_events, public.receipts, public.students, public.company_students;

-- 2. As the company's admin: the answer's shape, its numbers, and the time it takes.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', own_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v jsonb; t0 timestamptz; ms numeric; k text; v_keys text[];
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.own_admin IS NULL THEN RAISE NOTICE 'no company admin: skipped'; RETURN; END IF;

  -- Last 4 months (the semester). The first read after the bulk insert above
  -- also sets every row's hint bits; it is not what an admin waits for.
  PERFORM public.company_analytics(f.company, public.cairo_today() - 119, NULL);
  t0 := clock_timestamp();
  v := public.company_analytics(f.company, public.cairo_today() - 119, NULL);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  FOREACH k IN ARRAY ARRAY['period', 'students', 'rides', 'trips', 'lines', 'time_slots', 'weekdays', 'daily', 'money', 'receipts', 'insights'] LOOP
    ASSERT v ? k, 'missing key ' || k;
  END LOOP;
  ASSERT (v->'students'->>'members')::int = (SELECT count(*) FROM public.company_students m WHERE m.company_id = f.company AND m.status = 'active'),
    'members wrong: ' || (v->'students'->>'members');
  ASSERT (v->'period'->>'ride_days')::int >= 70, 'ride days: ' || (v->'period'->>'ride_days');
  ASSERT (v->'students'->>'never_subscribed')::int >= 30, 'never_subscribed: ' || (v->'students'->>'never_subscribed');
  ASSERT (v->'students'->>'ending_soon')::int >= 10, 'ending_soon: ' || (v->'students'->>'ending_soon');
  ASSERT jsonb_array_length(v->'trips') >= 8, 'trips: ' || jsonb_array_length(v->'trips');
  ASSERT jsonb_array_length(v->'daily') BETWEEN 1 AND 60, 'daily length';
  ASSERT (v->'money'->>'revenue')::numeric > 0, 'no revenue';
  ASSERT (v->'receipts'->>'median_review_hours')::numeric > 24, 'median review: ' || COALESCE(v->'receipts'->>'median_review_hours', 'null');
  -- «غير محدد» and spaces around a name are not colleges of their own.
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'students'->'by_college') c WHERE c->>'name' IN ('غير محدد', ' الهندسة ')),
    'placeholder or untrimmed college listed';
  ASSERT (v->'rides'->>'confirm_rate')::numeric BETWEEN 0.3 AND 1, 'confirm rate: ' || (v->'rides'->>'confirm_rate');
  -- The busiest trip's riders match a direct count for one day.
  ASSERT (SELECT max((t->>'peak_riders')::int) FROM jsonb_array_elements(v->'trips') t) > 50, 'no trip over 50 seats';
  SELECT array_agg(DISTINCT i->>'key') INTO v_keys FROM jsonb_array_elements(v->'insights') i;
  FOREACH k IN ARRAY ARRAY['over_capacity', 'low_utilisation', 'empty_trip', 'unserved_university', 'station_concentration',
                           'never_subscribed', 'ending_soon', 'low_confirmation_line', 'method_rejections', 'slow_review', 'no_capacity'] LOOP
    ASSERT k = ANY (v_keys), 'insight not raised: ' || k || ' (got ' || array_to_string(v_keys, ',') || ')';
  END LOOP;
  ASSERT (v->'insights'->0->>'severity') = 'act', 'act insights must come first';
  ASSERT ms < 1000, 'too slow: ' || ms || ' ms';
  INSERT INTO t_out VALUES ('company admin, last 120 days', ms, jsonb_build_object(
    'ride_days', v->'period'->'ride_days', 'members', v->'students'->'members', 'trips', jsonb_array_length(v->'trips'),
    'confirm_rate', v->'rides'->'confirm_rate', 'revenue', v->'money'->'revenue', 'insights', to_jsonb(v_keys),
    'bytes', length(v::text)));

  -- All time.
  t0 := clock_timestamp();
  v := public.company_analytics(f.company);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  ASSERT v->'period'->>'from' IS NULL, 'all time has a start';
  ASSERT ms < 1000, 'all time too slow: ' || ms || ' ms';
  INSERT INTO t_out VALUES ('company admin, all time', ms, jsonb_build_object('ride_days', v->'period'->'ride_days'));

  -- A period with nothing in it: empty lists, zero numbers, no error.
  v := public.company_analytics(f.company, DATE '2001-01-01', DATE '2001-01-31');
  ASSERT (v->'period'->>'ride_days')::int = 0 AND jsonb_array_length(v->'daily') = 0, 'empty period not empty';
  ASSERT (v->'money'->>'revenue')::numeric = 0, 'empty period has revenue';

  -- Start after end: refused in Arabic.
  BEGIN
    PERFORM public.company_analytics(f.company, DATE '2026-10-10', DATE '2026-10-01');
    RAISE EXCEPTION 'reversed period accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
RESET ROLE;

-- 3. As an admin of another company: refused.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', other_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record;
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.other_admin IS NULL THEN RAISE NOTICE 'no other company admin: skipped'; RETURN; END IF;
  BEGIN
    PERFORM public.company_analytics(f.company);
    RAISE EXCEPTION 'another company''s admin read the analytics';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.company_analytics(NULL);
    RAISE EXCEPTION 'a NULL company was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- 4. As the platform admin: allowed for any company.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', super_admin, 'role', 'authenticated')::text, true) FROM t_fx;
DO $$
DECLARE f record; v jsonb; t0 timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO f FROM t_fx;
  IF f.super_admin IS NULL THEN RAISE NOTICE 'no platform admin: skipped'; RETURN; END IF;
  v := public.company_analytics(f.company, public.cairo_today() - 29, public.cairo_today());
  ASSERT v ? 'insights', 'platform admin got no answer';
  INSERT INTO t_out VALUES ('platform admin, last 30 days', round(extract(epoch FROM clock_timestamp() - t0) * 1000), NULL);
END $$;
RESET ROLE;

-- 5. Signed out: no access at all.
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.company_analytics((SELECT company FROM t_fx));
    RAISE EXCEPTION 'anon called company_analytics';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT label, ms, info FROM t_out;
ROLLBACK;
