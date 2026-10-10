-- End-to-end test of 20261116000004_admin_lines:
--   save_line_full        the whole line (details, stations, trips, prices, bus seats) in one request
--   admin_lines_overview  subscribers, tomorrow's riders, per-station / per-trip counts
-- Builds its own two companies in ONE transaction, rolled back at the end. Every
-- step runs with the role and the JWT claims PostgREST uses.
--
-- Company A: line L1 (S1 → S2), going D1 07:00 (S1 07:10, S2 07:20), return R1 15:00,
--   admin AA, student s1 subscribed on S1 / D1 / R1 who confirmed the next ride.
-- Company B: admin AB.
--
-- Run with psql (run_local.sh) or paste the part between the markers into a SQL
-- console inside BEGIN … ROLLBACK (it was run that way against the project with
-- the migration's body inlined before the fixture).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null
BEGIN;
-- ---- 8< ------------------------------------------------------------------------

CREATE SCHEMA al;
GRANT USAGE ON SCHEMA al TO authenticated, anon;
CREATE TABLE al.results (n serial PRIMARY KEY, step text, ok boolean, detail text);
CREATE TABLE al.names (id uuid PRIMARY KEY, name text);
CREATE TABLE al.vars (k text PRIMARY KEY, v text);
GRANT ALL ON al.vars TO authenticated;
CREATE FUNCTION al.ok(p_step text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO al.results(step, ok, detail) VALUES (p_step, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION al.id(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM al.names WHERE name = p_name $$;
CREATE FUNCTION al.login(p_name text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM al.names WHERE name = p_name), 'role', 'authenticated')::text, true) $$;
-- Runs SQL as the current role: 'ok', or the SQLSTATE and message when it failed.
CREATE FUNCTION al.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
-- As postgres, VOLATILE so each call sees the statement before it.
CREATE FUNCTION al.lines_of(p_company text) RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER AS
  $$ SELECT count(*) FROM public.lines WHERE company_id = al.id(p_company) $$;
CREATE FUNCTION al.line(p_id uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER AS $$
  SELECT jsonb_build_object('name', l.name, 'cap', l.bus_capacity, 'termly', l.price_termly, 'yearly', l.price_yearly,
    'daily', l.price_daily, 'stations', (SELECT count(*) FROM public.stations s WHERE s.line_id = l.id AND s.is_active),
    'trips', (SELECT count(*) FROM public.line_trips t WHERE t.line_id = l.id AND t.is_active),
    'prices', (SELECT jsonb_object_agg(p.option, jsonb_build_array(p.price, p.is_enabled)) FROM public.line_period_prices p WHERE p.line_id = l.id))
  FROM public.lines l WHERE l.id = p_id $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA al TO authenticated, anon;

-- =============================================================================
-- Fixture (as postgres)
-- =============================================================================
INSERT INTO al.names VALUES
  ('eb000000-0000-0000-0000-00000000000a', 'co_a'), ('eb000000-0000-0000-0000-00000000000b', 'co_b'),
  ('eb100000-0000-0000-0000-000000000001', 'U1'), ('eb100000-0000-0000-0000-000000000002', 'U2'),
  ('eb200000-0000-0000-0000-000000000001', 'L1'),
  ('eb300000-0000-0000-0000-000000000001', 'S1'), ('eb300000-0000-0000-0000-000000000002', 'S2'),
  ('eb400000-0000-0000-0000-0000000000d1', 'D1'), ('eb400000-0000-0000-0000-0000000000a1', 'R1'),
  ('eb500000-0000-0000-0000-0000000000a1', 'AA'), ('eb500000-0000-0000-0000-0000000000a2', 'AB'),
  ('eb500000-0000-0000-0000-0000000000a0', 'AS'),
  ('eb700000-0000-0000-0000-000000000001', 's1');

INSERT INTO public.companies (id, name) VALUES (al.id('co_a'), 'E2E Lines A'), (al.id('co_b'), 'E2E Lines B');
INSERT INTO public.universities (id, name) VALUES (al.id('U1'), 'E2E Lines Uni 1'), (al.id('U2'), 'E2E Lines Uni 2');
INSERT INTO public.lines (id, company_id, name, price_termly, price_yearly, price_daily) VALUES
  (al.id('L1'), al.id('co_a'), 'خط الاختبار', 3000, 5500, 40);
INSERT INTO public.line_universities (line_id, university_id) VALUES (al.id('L1'), al.id('U1'));
INSERT INTO public.stations (id, line_id, name, order_index) VALUES
  (al.id('S1'), al.id('L1'), 'S1', 1), (al.id('S2'), al.id('L1'), 'S2', 2);
INSERT INTO public.line_trips (id, line_id, direction, start_time) VALUES
  (al.id('D1'), al.id('L1'), 'departure', '07:00'), (al.id('R1'), al.id('L1'), 'return', '15:00');
INSERT INTO public.line_trip_stops (trip_id, station_id, stop_time) VALUES
  (al.id('D1'), al.id('S1'), '07:10'), (al.id('D1'), al.id('S2'), '07:20');

INSERT INTO auth.users (id, email)
SELECT id, CASE name WHEN 's1' THEN '01219990001@busak.app' ELSE lower(name) || '@admin-lines.test' END
FROM al.names WHERE name IN ('AA', 'AB', 'AS', 's1');
INSERT INTO public.admins (id, email, full_name, role) VALUES (al.id('AS'), 'as@admin-lines.test', 'المنصة', 'super_admin');
INSERT INTO public.admins (id, email, full_name, role, company_id, created_by_admin_id) VALUES
  (al.id('AA'), 'aa@admin-lines.test', 'مدير أ', 'company_admin', al.id('co_a'), al.id('AS')),
  (al.id('AB'), 'ab@admin-lines.test', 'مدير ب', 'company_admin', al.id('co_b'), al.id('AS'));
INSERT INTO public.students (id, phone, full_name, university, university_id, college) VALUES
  (al.id('s1'), '01219990001', 'سارة أحمد علي', 'E2E Lines Uni 1', al.id('U1'), 'الهندسة');

INSERT INTO public.subscriptions (student_id, line_id, station_id, type, status, price, start_date, end_date, departure_trip_id)
VALUES (al.id('s1'), al.id('L1'), al.id('S1'), 'daily', 'active', 40, public.cairo_today(), public.cairo_today() + 1, al.id('D1'));
SET LOCAL session_replication_role = replica;
UPDATE public.subscriptions
SET type = 'termly', period_code = 'first', academic_year = 2026, price = 3000, company_id = al.id('co_a'), paid_at = now(),
    start_date = public.cairo_today() - 30, end_date = public.cairo_today() + 30,
    departure_time = '07:10', return_time = '15:00', return_trip_id = al.id('R1')
WHERE student_id = al.id('s1');
INSERT INTO public.company_students (company_id, student_id) VALUES (al.id('co_a'), al.id('s1')) ON CONFLICT DO NOTHING;
INSERT INTO public.daily_ride_status (student_id, ride_date, is_riding, departure_time, return_time, is_returning, subscription_id, company_id)
SELECT al.id('s1'), public.next_votable_ride_date(al.id('co_a')), true, '07:10', '15:00', true,
       (SELECT id FROM public.subscriptions WHERE student_id = al.id('s1')), al.id('co_a');
SET LOCAL session_replication_role = origin;

-- =============================================================================
-- save_line_full
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT al.login('AA');

-- A1 a new line, prices and seats in one request
INSERT INTO al.vars VALUES ('new', (public.save_line_full(jsonb_build_object(
  'id', null, 'company_id', al.id('co_a'), 'name', 'الزرقا', 'university_ids', jsonb_build_array(al.id('U1'), al.id('U2')),
  'price_daily', 45, 'is_active', true, 'bus_capacity', 50,
  'stations', jsonb_build_array(jsonb_build_object('id', null, 'name', 'موقف'), jsonb_build_object('id', null, 'name', 'كوبري')),
  'trips', jsonb_build_array(
    jsonb_build_object('id', null, 'direction', 'departure', 'label', '', 'start_time', '06:15', 'arrival_time', '07:00',
      'university_id', null, 'is_active', true, 'stops', jsonb_build_array(
        jsonb_build_object('station_index', 0, 'time', '06:15'), jsonb_build_object('station_index', 1, 'time', '06:21'))),
    jsonb_build_object('id', null, 'direction', 'return', 'label', 'الظهر', 'start_time', '13:00', 'university_id', null, 'is_active', true, 'stops', '[]'::jsonb)),
  'prices', jsonb_build_array(
    jsonb_build_object('option', 'first', 'price', 3200, 'is_enabled', true),
    jsonb_build_object('option', 'second', 'price', 3200, 'is_enabled', true),
    jsonb_build_object('option', 'both', 'price', 6000, 'is_enabled', true),
    jsonb_build_object('option', 'summer', 'price', null, 'is_enabled', false))))::text));
SELECT al.ok('A1 a new line is saved whole: stations, trips, four prices, seats, the old price columns',
  (SELECT al.line(v::uuid) FROM al.vars WHERE k = 'new') @> jsonb_build_object('name', 'الزرقا', 'cap', 50, 'termly', 3200, 'yearly', 6000,
     'daily', 45, 'stations', 2, 'trips', 2,
     'prices', jsonb_build_object('first', jsonb_build_array(3200, true), 'both', jsonb_build_array(6000, true), 'summer', jsonb_build_array(0, false))),
  (SELECT al.line(v::uuid)::text FROM al.vars WHERE k = 'new'));
SELECT al.ok('A2 the company now has two lines', al.lines_of('co_a') = 2);

-- A3 an option switched on with no price: nothing is written at all
SELECT al.ok('A3 an option on sale without a price is refused in Arabic, before anything is written',
  al.try($q$SELECT public.save_line_full(jsonb_build_object('id', null, 'company_id', al.id('co_a'), 'name', 'خط ناقص',
    'university_ids', jsonb_build_array(al.id('U1')), 'price_daily', 0,
    'stations', jsonb_build_array(jsonb_build_object('name', 'م1')),
    'trips', jsonb_build_array(jsonb_build_object('direction', 'departure', 'start_time', '07:00',
       'stops', jsonb_build_array(jsonb_build_object('station_index', 0, 'time', '07:00')))),
    'prices', jsonb_build_array(jsonb_build_object('option', 'second', 'price', null, 'is_enabled', true))))$q$)
  LIKE '23514 اكتب سعر «الفصل الثاني» أو أوقف بيعه على هذا الخط.' AND al.lines_of('co_a') = 2);

-- A4 seats out of range: nothing is written
SELECT al.ok('A4 601 seats is refused and no line is created',
  al.try($q$SELECT public.save_line_full(jsonb_build_object('id', null, 'company_id', al.id('co_a'), 'name', 'خط',
    'university_ids', jsonb_build_array(al.id('U1')), 'price_daily', 0, 'bus_capacity', 601,
    'stations', jsonb_build_array(jsonb_build_object('name', 'م1')),
    'trips', jsonb_build_array(jsonb_build_object('direction', 'departure', 'start_time', '07:00',
       'stops', jsonb_build_array(jsonb_build_object('station_index', 0, 'time', '07:00')))),
    'prices', '[]'::jsonb))$q$) LIKE '23514 عدد مقاعد الباص%' AND al.lines_of('co_a') = 2);

-- A5 save_line's own checks still apply (stop times out of route order), with its message
SELECT al.ok('A5 stop times out of route order: save_line''s Arabic message, nothing written',
  al.try($q$SELECT public.save_line_full(jsonb_build_object('id', null, 'company_id', al.id('co_a'), 'name', 'خط',
    'university_ids', jsonb_build_array(al.id('U1')), 'price_daily', 0,
    'stations', jsonb_build_array(jsonb_build_object('name', 'م1'), jsonb_build_object('name', 'م2')),
    'trips', jsonb_build_array(jsonb_build_object('direction', 'departure', 'start_time', '07:00',
       'stops', jsonb_build_array(jsonb_build_object('station_index', 0, 'time', '07:30'), jsonb_build_object('station_index', 1, 'time', '07:10')))),
    'prices', jsonb_build_array(jsonb_build_object('option', 'first', 'price', 3000, 'is_enabled', true))))$q$) LIKE '23514 موعد محطة%'
  AND al.lines_of('co_a') = 2);

-- A6 edit: same id, prices changed, seats cleared
INSERT INTO al.vars VALUES ('edit', (public.save_line_full(jsonb_build_object(
  'id', (SELECT v FROM al.vars WHERE k = 'new'), 'company_id', al.id('co_a'), 'name', 'الزرقا',
  'university_ids', jsonb_build_array(al.id('U1'), al.id('U2')), 'price_daily', 45, 'is_active', true, 'bus_capacity', null,
  'stations', (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.order_index) FROM public.stations s
               WHERE s.line_id = (SELECT v::uuid FROM al.vars WHERE k = 'new')),
  'trips', jsonb_build_array(
    jsonb_build_object('direction', 'departure', 'start_time', '06:15', 'stops', jsonb_build_array(
        jsonb_build_object('station_index', 0, 'time', '06:15'), jsonb_build_object('station_index', 1, 'time', '06:21'))),
    jsonb_build_object('direction', 'return', 'start_time', '13:00', 'stops', '[]'::jsonb)),
  'prices', jsonb_build_array(
    jsonb_build_object('option', 'first', 'price', 3300, 'is_enabled', true),
    jsonb_build_object('option', 'second', 'price', 3200, 'is_enabled', false))))::text));
SELECT al.ok('A6 saving again with the id edits the same line (no duplicate); seats cleared; prices updated',
  (SELECT v FROM al.vars WHERE k = 'edit') = (SELECT v FROM al.vars WHERE k = 'new') AND al.lines_of('co_a') = 2
  AND (SELECT al.line(v::uuid) FROM al.vars WHERE k = 'new') @> jsonb_build_object('cap', null, 'termly', 3300,
      'prices', jsonb_build_object('first', jsonb_build_array(3300, true), 'second', jsonb_build_array(3200, false), 'both', jsonb_build_array(6000, true))),
  (SELECT al.line(v::uuid)::text FROM al.vars WHERE k = 'new'));

-- A7 no prices key and no bus_capacity key: both left as they are
SELECT public.save_line_full(jsonb_build_object('id', al.id('L1'), 'company_id', al.id('co_a'), 'name', 'خط الاختبار',
  'university_ids', jsonb_build_array(al.id('U1')), 'price_termly', 3000, 'price_yearly', 5500, 'price_daily', 40,
  'stations', jsonb_build_array(jsonb_build_object('id', al.id('S1'), 'name', 'S1'), jsonb_build_object('id', al.id('S2'), 'name', 'S2')),
  'trips', jsonb_build_array(
    jsonb_build_object('id', al.id('D1'), 'direction', 'departure', 'start_time', '07:00', 'stops', jsonb_build_array(
        jsonb_build_object('station_index', 0, 'time', '07:10'), jsonb_build_object('station_index', 1, 'time', '07:20'))),
    jsonb_build_object('id', al.id('R1'), 'direction', 'return', 'start_time', '15:00', 'stops', '[]'::jsonb))));
SELECT al.ok('A7 without prices or bus_capacity the line keeps them',
  (al.line(al.id('L1'))->>'termly')::numeric = 3000 AND al.line(al.id('L1'))->'cap' = 'null'::jsonb, al.line(al.id('L1'))::text);

-- A8 another company's admin
SELECT al.login('AB');
SELECT al.ok('A8 another company''s admin cannot edit the line (42501)',
  al.try($q$SELECT public.save_line_full(jsonb_build_object('id', al.id('L1'), 'name', 'x', 'university_ids', jsonb_build_array(al.id('U1')),
    'price_daily', 0, 'stations', jsonb_build_array(jsonb_build_object('name', 'م')),
    'trips', jsonb_build_array(jsonb_build_object('direction', 'departure', 'start_time', '07:00',
       'stops', jsonb_build_array(jsonb_build_object('station_index', 0, 'time', '07:00')))), 'prices', '[]'::jsonb))$q$) LIKE '42501%');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT al.ok('A9 a signed-out client cannot call it',
  al.try($q$SELECT public.save_line_full('{}'::jsonb)$q$) LIKE '42501%');
RESET ROLE;

-- =============================================================================
-- admin_lines_overview
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT al.login('AA');
INSERT INTO al.vars VALUES ('ov', public.admin_lines_overview(al.id('co_a'))::text);
SELECT al.ok('B1 the ride date is the next votable one',
  ((SELECT v FROM al.vars WHERE k = 'ov')::jsonb->>'ride_date')::date = public.next_votable_ride_date(al.id('co_a')));
SELECT al.ok('B2 L1: one running subscriber, one rider each way, on D1 and R1',
  (SELECT v FROM al.vars WHERE k = 'ov')::jsonb->'lines'->(al.id('L1')::text) @> jsonb_build_object(
    'subscribers', 1, 'riders_departure', 1, 'riders_return', 1, 'has_history', true,
    'trip_riders', jsonb_build_object(al.id('D1')::text, 1, al.id('R1')::text, 1)),
  (SELECT v FROM al.vars WHERE k = 'ov')::jsonb->'lines'->>(al.id('L1')::text));
SELECT al.ok('B3 L1: current subscribers per station and per trip',
  (SELECT v FROM al.vars WHERE k = 'ov')::jsonb->'lines'->(al.id('L1')::text) @> jsonb_build_object(
    'station_subscribers', jsonb_build_object(al.id('S1')::text, 1),
    'trip_subscribers', jsonb_build_object(al.id('D1')::text, 1, al.id('R1')::text, 1)));
SELECT al.ok('B4 the new line: no one, no history, seats as saved',
  (SELECT v FROM al.vars WHERE k = 'ov')::jsonb->'lines'->((SELECT v FROM al.vars WHERE k = 'new')) @> jsonb_build_object(
    'subscribers', 0, 'riders_departure', 0, 'has_history', false, 'bus_capacity', null));
SELECT al.login('AB');
SELECT al.ok('B5 another company''s admin is refused (42501)',
  al.try($q$SELECT public.admin_lines_overview(al.id('co_a'))$q$) LIKE '42501%');
SELECT al.ok('B6 a company with no line gets an empty map',
  public.admin_lines_overview(al.id('co_b'))->'lines' = '{}'::jsonb);
RESET ROLE;

-- ---- >8 ------------------------------------------------------------------------
\o
\echo
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, step, left(detail, 300) AS detail FROM al.results ORDER BY n;
DO $$ DECLARE f int; BEGIN
  SELECT count(*) INTO f FROM al.results WHERE NOT ok;
  IF f > 0 THEN RAISE EXCEPTION '% test step(s) failed', f; END IF;
  RAISE NOTICE 'all % steps passed', (SELECT count(*) FROM al.results);
END $$;
ROLLBACK;
