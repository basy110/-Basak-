-- Test of 20261116000001_admin_today (company_today, platform_today).
-- Plain SQL, one transaction, rolled back: run it after the migration, or paste
-- the migration right after the BEGIN below. Nothing persists. The last
-- statement lists every check; all must say ok = true.
--
-- Fixture (triggers off while it is written, so no live announcements, wallet
-- passes or receipts are produced): company A with lines LA1 (active, a bus of
-- one seat, a supervisor, three subscribers of whom two ride and one returns),
-- LA2 (one of its two universities has no departure trip) and LA3 (stopped); two
-- receipts waiting (one on its fifth attempt); one open password request; no
-- payment method. Company B with its own admin. A platform admin.
BEGIN;

CREATE SCHEMA tt;
GRANT USAGE ON SCHEMA tt TO authenticated, anon;
CREATE TABLE tt.results (n serial PRIMARY KEY, step text, ok boolean, detail text);
CREATE FUNCTION tt.ok(p_step text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO tt.results(step, ok, detail) VALUES (p_step, COALESCE(p_ok, false), p_detail) $$;
-- Runs SQL as the current role; the error's SQLSTATE, or NULL.
CREATE FUNCTION tt.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
CREATE TABLE tt.out (who text PRIMARY KEY, body jsonb);
CREATE FUNCTION tt.keep(p_who text, p_body jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO tt.out VALUES (p_who, p_body) $$;
CREATE FUNCTION tt.login(p_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tt TO authenticated, anon;

-- =============================================================================
-- Fixture (as postgres, triggers off)
-- =============================================================================
SET LOCAL session_replication_role = replica;

CREATE TEMP TABLE tt_ids AS SELECT
  '7d000000-0000-4000-8000-0000000000a5'::uuid AS su,   -- platform admin
  '7d000000-0000-4000-8000-0000000000aa'::uuid AS aa,   -- admin of A
  '7d000000-0000-4000-8000-0000000000ab'::uuid AS ab,   -- admin of B
  '7d000000-0000-4000-8000-00000000c00a'::uuid AS ca,
  '7d000000-0000-4000-8000-00000000c00b'::uuid AS cb,
  COALESCE(public.next_votable_ride_date(NULL), public.cairo_today() + 1) AS ride;

INSERT INTO auth.users (id, email)
SELECT ('7d000000-0000-4000-8000-0000000000' || x)::uuid, 'tt-' || x || '@example.invalid'
FROM unnest(ARRAY['a5', 'aa', 'ab', 'e1', '51', '52', '53']) x;

INSERT INTO public.companies (id, name, status, is_active) VALUES
  ('7d000000-0000-4000-8000-00000000c00a', 'اختبار اليوم أ', 'active', true),
  ('7d000000-0000-4000-8000-00000000c00b', 'اختبار اليوم ب', 'active', true);

INSERT INTO public.admins (id, email, full_name, role, company_id, created_by_admin_id) VALUES
  ('7d000000-0000-4000-8000-0000000000a5', 'tt-a5@example.invalid', 'مدير المنصة', 'super_admin', NULL, NULL),
  ('7d000000-0000-4000-8000-0000000000aa', 'tt-aa@example.invalid', 'مدير أ', 'company_admin', '7d000000-0000-4000-8000-00000000c00a', '7d000000-0000-4000-8000-0000000000a5'),
  ('7d000000-0000-4000-8000-0000000000ab', 'tt-ab@example.invalid', 'مدير ب', 'company_admin', '7d000000-0000-4000-8000-00000000c00b', '7d000000-0000-4000-8000-0000000000a5');

INSERT INTO public.universities (id, name, city, is_active) VALUES
  ('7d000000-0000-4000-8000-0000000000f1', 'جامعة اختبار أولى', 'دمياط', true),
  ('7d000000-0000-4000-8000-0000000000f2', 'جامعة اختبار ثانية', 'دمياط', true);

INSERT INTO public.lines (id, company_id, name, origin_name, destination_university_id, price_termly, price_yearly, price_daily, is_active, bus_capacity, created_at) VALUES
  ('7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000c00a', 'خط أ', 'البداية', '7d000000-0000-4000-8000-0000000000f1', 3500, 6500, 0, true, 1, now() - interval '3 days'),
  ('7d000000-0000-4000-8000-00000000a002', '7d000000-0000-4000-8000-00000000c00a', 'خط ب', 'البداية', '7d000000-0000-4000-8000-0000000000f1', 3500, 6500, 0, true, 50, now() - interval '2 days'),
  ('7d000000-0000-4000-8000-00000000a003', '7d000000-0000-4000-8000-00000000c00a', 'خط ج', 'البداية', '7d000000-0000-4000-8000-0000000000f1', 3500, 6500, 0, false, 50, now() - interval '1 day');
INSERT INTO public.line_universities (line_id, university_id, company_id) VALUES
  ('7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-0000000000f1', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000a002', '7d000000-0000-4000-8000-0000000000f1', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000a002', '7d000000-0000-4000-8000-0000000000f2', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000a003', '7d000000-0000-4000-8000-0000000000f1', '7d000000-0000-4000-8000-00000000c00a');
INSERT INTO public.line_period_prices (line_id, company_id, option, price, is_enabled)
SELECT l, '7d000000-0000-4000-8000-00000000c00a', o, CASE o WHEN 'both' THEN 6500 ELSE 3500 END, o <> 'summer'
FROM unnest(ARRAY['7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000a002', '7d000000-0000-4000-8000-00000000a003']::uuid[]) l,
     unnest(ARRAY['first', 'second', 'both', 'summer']) o;
INSERT INTO public.stations (id, line_id, name, order_index, company_id, is_active) VALUES
  ('7d000000-0000-4000-8000-00000000b001', '7d000000-0000-4000-8000-00000000a001', 'محطة 1', 0, '7d000000-0000-4000-8000-00000000c00a', true),
  ('7d000000-0000-4000-8000-00000000b002', '7d000000-0000-4000-8000-00000000a001', 'محطة 2', 1, '7d000000-0000-4000-8000-00000000c00a', true),
  ('7d000000-0000-4000-8000-00000000b003', '7d000000-0000-4000-8000-00000000a002', 'محطة 3', 0, '7d000000-0000-4000-8000-00000000c00a', true),
  ('7d000000-0000-4000-8000-00000000b004', '7d000000-0000-4000-8000-00000000a003', 'محطة 4', 0, '7d000000-0000-4000-8000-00000000c00a', true);
INSERT INTO public.line_trips (id, line_id, company_id, direction, label, start_time, university_id, is_active) VALUES
  ('7d000000-0000-4000-8000-00000000d001', '7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000c00a', 'departure', 'الأولى', '07:00', NULL, true),
  ('7d000000-0000-4000-8000-00000000d002', '7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000c00a', 'departure', 'الثانية', '08:00', NULL, true),
  ('7d000000-0000-4000-8000-00000000e001', '7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000c00a', 'return', 'العودة', '14:00', NULL, true),
  ('7d000000-0000-4000-8000-00000000d003', '7d000000-0000-4000-8000-00000000a002', '7d000000-0000-4000-8000-00000000c00a', 'departure', 'الأولى', '07:30', '7d000000-0000-4000-8000-0000000000f1', true),
  ('7d000000-0000-4000-8000-00000000d004', '7d000000-0000-4000-8000-00000000a003', '7d000000-0000-4000-8000-00000000c00a', 'departure', 'الأولى', '07:30', NULL, true);
INSERT INTO public.line_trip_stops (trip_id, station_id, stop_time, company_id) VALUES
  ('7d000000-0000-4000-8000-00000000d001', '7d000000-0000-4000-8000-00000000b001', '07:00', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000d001', '7d000000-0000-4000-8000-00000000b002', '07:10', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000d002', '7d000000-0000-4000-8000-00000000b001', '08:00', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000d002', '7d000000-0000-4000-8000-00000000b002', '08:10', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000e001', '7d000000-0000-4000-8000-00000000b001', '14:30', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000d003', '7d000000-0000-4000-8000-00000000b003', '07:30', '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-00000000d004', '7d000000-0000-4000-8000-00000000b004', '07:30', '7d000000-0000-4000-8000-00000000c00a');

INSERT INTO public.supervisors (id, phone, full_name, company_id, is_active) VALUES
  ('7d000000-0000-4000-8000-0000000000e1', '01099990001', 'مشرف الاختبار', '7d000000-0000-4000-8000-00000000c00a', true);
INSERT INTO public.supervisor_lines (supervisor_id, line_id, company_id) VALUES
  ('7d000000-0000-4000-8000-0000000000e1', '7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000c00a');

INSERT INTO public.students (id, phone, full_name, university, college, university_id)
SELECT ('7d000000-0000-4000-8000-0000000000' || x)::uuid, '0109999000' || right(x, 1), 'طالب ' || x, 'جامعة اختبار أولى', 'الهندسة',
       '7d000000-0000-4000-8000-0000000000f1'
FROM unnest(ARRAY['51', '52', '53']) x;
INSERT INTO public.company_students (company_id, student_id, status)
SELECT '7d000000-0000-4000-8000-00000000c00a', ('7d000000-0000-4000-8000-0000000000' || x)::uuid, 'active' FROM unnest(ARRAY['51', '52', '53']) x;
INSERT INTO public.subscriptions (id, student_id, line_id, station_id, type, status, price, company_id, paid_at, start_date, end_date,
                                  departure_trip_id, return_trip_id, departure_time, return_time)
SELECT ('7d000000-0000-4000-8000-00000000' || '5b' || x)::uuid, ('7d000000-0000-4000-8000-0000000000' || x)::uuid,
       '7d000000-0000-4000-8000-00000000a001', '7d000000-0000-4000-8000-00000000b001', 'termly', 'active', 3500,
       '7d000000-0000-4000-8000-00000000c00a', now() - interval '5 days', public.cairo_today() - 10, public.cairo_today() + 60,
       '7d000000-0000-4000-8000-00000000d001', '7d000000-0000-4000-8000-00000000e001', '07:00', '14:30'
FROM unnest(ARRAY['51', '52', '53']) x;
-- s1 rides and returns, s2 rides one way, s3 does not ride.
INSERT INTO public.daily_ride_status (student_id, ride_date, is_riding, is_returning, company_id, subscription_id)
SELECT ('7d000000-0000-4000-8000-0000000000' || x)::uuid, (SELECT ride FROM tt_ids), x <> '53', x = '51',
       '7d000000-0000-4000-8000-00000000c00a', ('7d000000-0000-4000-8000-00000000' || '5b' || x)::uuid
FROM unnest(ARRAY['51', '52', '53']) x;
INSERT INTO public.receipts (subscription_id, image_url, status, attempt_number, created_at, amount, company_id) VALUES
  ('7d000000-0000-4000-8000-000000005b53', 'tt/a.jpg', 'pending', 5, now() - interval '3 hours', 3500, '7d000000-0000-4000-8000-00000000c00a'),
  ('7d000000-0000-4000-8000-000000005b52', 'tt/b.jpg', 'pending', 1, now() - interval '1 hour', 3500, '7d000000-0000-4000-8000-00000000c00a');
INSERT INTO public.password_reset_requests (student_id, status, requested_at) VALUES
  ('7d000000-0000-4000-8000-000000000051', 'pending', now() - interval '1 hour'),
  ('7d000000-0000-4000-8000-000000000052', 'completed', now() - interval '2 hours');

SET LOCAL session_replication_role = origin;
-- The ride day the fixture rides on must be the one company A is confirming for.
SELECT tt.ok('fixture rides on A''s next ride day', public.next_votable_ride_date('7d000000-0000-4000-8000-00000000c00a') = (SELECT ride FROM tt_ids));

-- =============================================================================
-- Who may call
-- =============================================================================
SET LOCAL ROLE anon;
SELECT tt.ok('anon cannot call company_today', tt.err($$SELECT public.company_today('7d000000-0000-4000-8000-00000000c00a')$$) = '42501');
SELECT tt.ok('anon cannot call platform_today', tt.err($$SELECT public.platform_today()$$) = '42501');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT tt.login('7d000000-0000-4000-8000-0000000000ab');
SELECT tt.ok('another company''s admin is refused', tt.err($$SELECT public.company_today('7d000000-0000-4000-8000-00000000c00a')$$) = '42501');
SELECT tt.ok('a company admin cannot read the platform', tt.err($$SELECT public.platform_today()$$) = '42501');
SELECT tt.ok('a company admin reads their own company', tt.err($$SELECT public.company_today('7d000000-0000-4000-8000-00000000c00b')$$) IS NULL);

SELECT tt.login('7d000000-0000-4000-8000-0000000000aa');
SELECT tt.keep('A', public.company_today('7d000000-0000-4000-8000-00000000c00a'));
SELECT tt.ok('company_overview still answers', (public.company_overview('7d000000-0000-4000-8000-00000000c00a')->>'members')::int = 3);

SELECT tt.login('7d000000-0000-4000-8000-0000000000a5');
SELECT tt.keep('A by platform', public.company_today('7d000000-0000-4000-8000-00000000c00a'));
SELECT tt.keep('platform', public.platform_today());
RESET ROLE;

-- =============================================================================
-- What company A sees
-- =============================================================================
CREATE TEMP VIEW tt_a AS SELECT body FROM tt.out WHERE who = 'A';
CREATE TEMP VIEW tt_l AS SELECT l->>'name' AS name, l FROM tt.out, jsonb_array_elements(body->'lines') l WHERE who = 'A';

SELECT tt.ok('platform admin reads the same company', (SELECT body FROM tt.out WHERE who = 'A by platform') = (SELECT body FROM tt_a));
SELECT tt.ok('ride date', (SELECT (body->>'ride_date')::date FROM tt_a) = (SELECT ride FROM tt_ids));
SELECT tt.ok('members and subscribers', (SELECT (body->>'members')::int = 3 AND (body->>'subscribers')::int = 3 FROM tt_a));
SELECT tt.ok('going 2, returning 1, confirmed 2', (SELECT (body->>'going')::int = 2 AND (body->>'returning')::int = 1 AND (body->>'confirmed')::int = 2 FROM tt_a),
             (SELECT body::text FROM tt_a));
SELECT tt.ok('three lines, busiest first', (SELECT jsonb_array_length(body->'lines') = 3 AND body->'lines'->0->>'name' = 'خط أ' FROM tt_a));
SELECT tt.ok('LA1 counts', (SELECT (l->>'going')::int = 2 AND (l->>'returning')::int = 1 AND (l->>'subscribers')::int = 3 AND (l->>'bus_capacity')::int = 1 FROM tt_l WHERE name = 'خط أ'));
SELECT tt.ok('LA1 busiest departure trip', (SELECT l->'top_trip'->>'time' = '07:00' AND (l->'top_trip'->>'riders')::int = 2 FROM tt_l WHERE name = 'خط أ'),
             (SELECT l->>'top_trip' FROM tt_l WHERE name = 'خط أ'));
SELECT tt.ok('LA1 departure over its one seat', (SELECT jsonb_array_length(l->'over') = 1 AND l->'over'->0->>'direction' = 'departure' AND (l->'over'->0->>'riders')::int = 2 FROM tt_l WHERE name = 'خط أ'),
             (SELECT l->>'over' FROM tt_l WHERE name = 'خط أ'));
SELECT tt.ok('LA1 supervisor', (SELECT l->'supervisors'->0->>'name' = 'مشرف الاختبار' FROM tt_l WHERE name = 'خط أ'));
SELECT tt.ok('LA2 has no supervisor', (SELECT jsonb_array_length(l->'supervisors') = 0 FROM tt_l WHERE name = 'خط ب'));
SELECT tt.ok('LA2 hidden: a university without a departure trip',
             (SELECT l->>'hidden' = 'unserved_university' AND l->>'unserved_university' = 'جامعة اختبار ثانية' AND NOT (l->>'visible')::boolean FROM tt_l WHERE name = 'خط ب'));
SELECT tt.ok('LA3 hidden: stopped', (SELECT l->>'hidden' = 'line_inactive' FROM tt_l WHERE name = 'خط ج'));
SELECT tt.ok('LA1 visibility follows what is on sale',
             (SELECT ((l->>'visible')::boolean AND l->>'hidden' IS NULL) = EXISTS (
                SELECT 1 FROM public.line_sale_options_for('7d000000-0000-4000-8000-00000000a001', NULL, NULL) o WHERE o.available)
              FROM tt_l WHERE name = 'خط أ'), (SELECT l::text FROM tt_l WHERE name = 'خط أ'));
SELECT tt.ok('receipts: 2 waiting, oldest 3 hours, 1 on the last attempt',
             (SELECT (body->'receipts'->>'waiting')::int = 2 AND (body->'receipts'->>'last_attempt')::int = 1
                     AND (body->'receipts'->>'oldest_at')::timestamptz < now() - interval '170 minutes' FROM tt_a));
SELECT tt.ok('one open password request', (SELECT (body->>'password_requests')::int = 1 FROM tt_a));
SELECT tt.ok('setup', (SELECT (s->>'lines')::int = 3 AND (s->>'payment_methods')::int = 0 AND (s->>'supervisors')::int = 1
                              AND s->'first_line'->>'name' = 'خط أ' AND (s->'first_line'->>'stations')::int = 2
                              AND (s->'first_line'->>'departures')::int = 2 AND (s->'first_line'->>'returns')::int = 1
                              AND NOT (s->>'receipt_info')::boolean AND NOT (s->>'wallet_custom')::boolean
                       FROM (SELECT body->'setup' AS s FROM tt_a) x), (SELECT (body->'setup')::text FROM tt_a));
SELECT tt.ok('vote hours present', (SELECT body->>'vote_closes_at' ~ '^\d{2}:\d{2}$' AND body ? 'vote_open' FROM tt_a));

-- =============================================================================
-- What the platform admin sees
-- =============================================================================
CREATE TEMP VIEW tt_p AS SELECT body FROM tt.out WHERE who = 'platform';
CREATE TEMP VIEW tt_pa AS SELECT r FROM tt_p, jsonb_array_elements(body->'per_company') r WHERE r->'company'->>'name' = 'اختبار اليوم أ';
SELECT tt.ok('every company has a row', (SELECT jsonb_array_length(body->'per_company') = (SELECT count(*) FROM public.companies) FROM tt_p));
SELECT tt.ok('A''s row', (SELECT (r->>'pending_receipts')::int = 2 AND (r->>'payment_methods')::int = 0 AND (r->>'lines')::int = 3
                                  AND (r->>'active_lines')::int = 2 AND r ? 'selling' AND r ? 'revenue' AND r ? 'riders_next'
                                  AND (r->>'oldest_receipt_at')::timestamptz < now() - interval '170 minutes' FROM tt_pa), (SELECT r::text FROM tt_pa));
SELECT tt.ok('totals add up', (SELECT (body->>'pending_receipts')::int = (SELECT sum((r->>'pending_receipts')::int) FROM jsonb_array_elements(body->'per_company') r)
                                      AND (body->>'receipt_companies')::int >= 1 AND (body->'companies'->>'total')::int = (SELECT count(*) FROM public.companies) FROM tt_p));
SELECT tt.ok('password requests counted, s1 has a company', (SELECT (body->'password_requests'->>'waiting')::int >= 1 FROM tt_p));
SELECT tt.ok('the other parts are there', (SELECT body ? 'corrections' AND body ? 'push_failed_24h' AND jsonb_typeof(body->'app_versions') = 'array'
                                                  AND body ? 'students' AND body ? 'riders_next' FROM tt_p));

SELECT step, ok, detail FROM tt.results ORDER BY n;
ROLLBACK;
