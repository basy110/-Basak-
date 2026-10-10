-- End-to-end test of 20261116000003_admin_students (the students pages of the
-- redesigned dashboard). One transaction, rolled back at the end.
--
-- Fixture: company A (admin AA) with lines L1, L2 and seven members, one per
-- status the list shows — s1 نشط, s2 بانتظار الدفع, s3 قيد المراجعة,
-- s4 إيصال مرفوض (line L2), s5 منتهٍ, s6 بلا اشتراك, s7 يبدأ قريباً; company B
-- (admin AB) with s8; the platform admin AS.
--
-- Also run through the Supabase MCP (execute_sql) as: the migration file, then
-- this file without its psql lines (\set, \o, \echo), with the final ROLLBACK
-- replaced by a DO block that raises the results (so nothing can persist).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null
BEGIN;

CREATE SCHEMA st;
GRANT USAGE ON SCHEMA st TO authenticated;
CREATE TABLE st.results (n serial PRIMARY KEY, step text, ok boolean, detail text);
CREATE TABLE st.names (id uuid PRIMARY KEY, name text);
CREATE FUNCTION st.ok(p_step text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO st.results(step, ok, detail) VALUES (p_step, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION st.login(p_name text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM st.names WHERE name = p_name), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION st.id(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM st.names WHERE name = p_name $$;
CREATE FUNCTION st.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
CREATE FUNCTION st.sub(p_name text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
  $$ SELECT id FROM public.subscriptions WHERE student_id = st.id(p_name) ORDER BY created_at DESC LIMIT 1 $$;
-- "s1,s7": the students of a page, in order, by fixture name.
CREATE FUNCTION st.names_of(p_page jsonb) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(string_agg(x.name, ',' ORDER BY i), '')
  FROM jsonb_array_elements(p_page->'rows') WITH ORDINALITY e(r, i) JOIN st.names x ON x.id = (r->>'id')::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA st TO authenticated;

-- =============================================================================
-- Fixture (as postgres)
-- =============================================================================
INSERT INTO st.names VALUES
  ('e8100000-0000-0000-0000-00000000000a', 'co_a'), ('e8100000-0000-0000-0000-00000000000b', 'co_b'),
  ('e8200000-0000-0000-0000-000000000001', 'L1'), ('e8200000-0000-0000-0000-000000000002', 'L2'),
  ('e8200000-0000-0000-0000-000000000003', 'LB'),
  ('e8300000-0000-0000-0000-000000000001', 'S1'), ('e8300000-0000-0000-0000-000000000002', 'S2'),
  ('e8300000-0000-0000-0000-000000000003', 'SBst'),
  ('e8400000-0000-0000-0000-0000000000d1', 'D1'), ('e8400000-0000-0000-0000-0000000000d2', 'D2'),
  ('e8400000-0000-0000-0000-0000000000db', 'DB'),
  ('e8500000-0000-0000-0000-0000000000a0', 'AS'), ('e8500000-0000-0000-0000-0000000000a1', 'AA'),
  ('e8500000-0000-0000-0000-0000000000a2', 'AB'),
  ('e8700000-0000-0000-0000-000000000001', 's1'), ('e8700000-0000-0000-0000-000000000002', 's2'),
  ('e8700000-0000-0000-0000-000000000003', 's3'), ('e8700000-0000-0000-0000-000000000004', 's4'),
  ('e8700000-0000-0000-0000-000000000005', 's5'), ('e8700000-0000-0000-0000-000000000006', 's6'),
  ('e8700000-0000-0000-0000-000000000007', 's7'), ('e8700000-0000-0000-0000-000000000008', 's8');

INSERT INTO public.companies (id, name) VALUES (st.id('co_a'), 'E2E Students A'), (st.id('co_b'), 'E2E Students B');
INSERT INTO public.lines (id, company_id, name, price_termly, price_yearly, price_daily) VALUES
  (st.id('L1'), st.id('co_a'), 'خط الطلاب 1', 3000, 5500, 40),
  (st.id('L2'), st.id('co_a'), 'خط الطلاب 2', 3000, 5500, 40),
  (st.id('LB'), st.id('co_b'), 'خط الطلاب ب', 3000, 5500, 40);
INSERT INTO public.stations (id, line_id, name, order_index) VALUES
  (st.id('S1'), st.id('L1'), 'S1', 1), (st.id('S2'), st.id('L2'), 'S2', 1), (st.id('SBst'), st.id('LB'), 'SB', 1);
INSERT INTO public.line_trips (id, line_id, direction, start_time) VALUES
  (st.id('D1'), st.id('L1'), 'departure', '07:00'), (st.id('D2'), st.id('L2'), 'departure', '07:00'),
  (st.id('DB'), st.id('LB'), 'departure', '07:00');
INSERT INTO public.line_trip_stops (trip_id, station_id, stop_time) VALUES
  (st.id('D1'), st.id('S1'), '07:10'), (st.id('D2'), st.id('S2'), '07:10'), (st.id('DB'), st.id('SBst'), '07:10');

INSERT INTO auth.users (id, email)
SELECT id, CASE WHEN name LIKE 'A_' THEN lower(name) || '@e2e-students.test'
                ELSE '0121888000' || right(id::text, 1) || '@busak.app' END
FROM st.names WHERE name IN ('AS', 'AA', 'AB') OR name LIKE 's_';
INSERT INTO public.admins (id, email, full_name, role) VALUES (st.id('AS'), 'as@e2e-students.test', 'المنصة', 'super_admin');
INSERT INTO public.admins (id, email, full_name, role, company_id, created_by_admin_id) VALUES
  (st.id('AA'), 'aa@e2e-students.test', 'مدير أ', 'company_admin', st.id('co_a'), st.id('AS')),
  (st.id('AB'), 'ab@e2e-students.test', 'مدير ب', 'company_admin', st.id('co_b'), st.id('AS'));
INSERT INTO public.students (id, phone, full_name, university)
SELECT id, '0121888000' || right(id::text, 1), 'طالب ' || name || ' الاختبار الثاني', 'جامعة'
FROM st.names WHERE name LIKE 's_';

-- One subscription each (s6 has none): (student, line, station, trip, status, from, to).
INSERT INTO public.subscriptions (student_id, line_id, station_id, type, status, price, start_date, end_date, departure_trip_id)
SELECT st.id(s), st.id(l), st.id(sta), 'daily', status, 40, public.cairo_today() + f, public.cairo_today() + t, st.id(trip)
FROM (VALUES ('s1', 'L1', 'S1', 'D1', 'active', 0, 1), ('s2', 'L1', 'S1', 'D1', 'pending_payment', 0, 1),
             ('s3', 'L1', 'S1', 'D1', 'pending_payment', 0, 1), ('s4', 'L2', 'S2', 'D2', 'pending_payment', 0, 1),
             ('s5', 'L1', 'S1', 'D1', 'expired', -30, -1), ('s7', 'L1', 'S1', 'D1', 'active', 3, 4),
             ('s8', 'LB', 'SBst', 'DB', 'active', 0, 1)) v(s, l, sta, trip, status, f, t);
SET LOCAL session_replication_role = replica;
UPDATE public.subscriptions SET status = 'pending_review' WHERE student_id = st.id('s3');
UPDATE public.subscriptions SET status = 'rejected' WHERE student_id = st.id('s4');
SET LOCAL session_replication_role = origin;
INSERT INTO public.company_students (company_id, student_id, status)
VALUES (st.id('co_a'), st.id('s6'), 'active') ON CONFLICT (company_id, student_id) DO UPDATE SET status = 'active';
INSERT INTO public.company_students (company_id, student_id, status)
SELECT st.id('co_a'), id, 'active' FROM st.names WHERE name IN ('s1', 's2', 's3', 's4', 's5', 's7')
ON CONFLICT (company_id, student_id) DO NOTHING;
INSERT INTO public.company_students (company_id, student_id, status)
VALUES (st.id('co_b'), st.id('s8'), 'active'), (st.id('co_b'), st.id('s1'), 'active')
ON CONFLICT (company_id, student_id) DO NOTHING;
-- Joined a minute apart, s1 last: "newest first" has one answer.
UPDATE public.company_students m SET joined_at = now() - (right(m.student_id::text, 1)::int) * interval '1 minute'
WHERE m.company_id = st.id('co_a');

-- =============================================================================
-- The company's list
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT st.login('AA');
DO $$
DECLARE p jsonb;
BEGIN
  p := public.get_company_students_page_v2(st.id('co_a'));
  PERFORM st.ok('V1 every member, newest first, with a count per status',
    st.names_of(p) = 's1,s2,s3,s4,s5,s6,s7'
    AND p->'counts' = '{"all":7,"active":1,"unpaid":1,"review":1,"rejected":1,"ended":1,"none":1,"soon":1}'::jsonb
    AND (p->>'total')::int = 7 AND NOT (p->>'has_next')::boolean, p::text);
  PERFORM st.ok('V2 each row says its status and its subscription''s',
    (SELECT string_agg(r->>'status', ',' ORDER BY i) FROM jsonb_array_elements(p->'rows') WITH ORDINALITY e(r, i))
      = 'active,unpaid,review,rejected,ended,none,soon'
    AND p->'rows'->0->'subscriptions'->0->>'shown' = 'active'
    AND p->'rows'->0->'subscriptions'->0->>'station_name' = 'S1');
  PERFORM st.ok('V3 s1''s subscription in company B is not shown in A',
    jsonb_array_length(p->'rows'->0->'subscriptions') = 1);

  p := public.get_company_students_page_v2(st.id('co_a'), p_status => 'unpaid');
  PERFORM st.ok('V4 a status filter keeps the counts of every status',
    st.names_of(p) = 's2' AND (p->>'total')::int = 1 AND (p->'counts'->>'all')::int = 7, p::text);
  p := public.get_company_students_page_v2(st.id('co_a'), p_line_id => st.id('L2'));
  PERFORM st.ok('V5 the line filter', st.names_of(p) = 's4' AND (p->'counts'->>'all')::int = 1, p::text);
  p := public.get_company_students_page_v2(st.id('co_a'), p_search => '٠١٢١٨٨٨٠٠٠٥');
  PERFORM st.ok('V6 a phone typed with Arabic digits', st.names_of(p) = 's5', p::text);
  p := public.get_company_students_page_v2(st.id('co_a'), p_sort => 'oldest', p_limit => 3, p_offset => 3);
  PERFORM st.ok('V7 oldest first, a later page', st.names_of(p) = 's4,s3,s2' AND (p->>'has_next')::boolean, p::text);
  p := public.get_company_students_page_v2(st.id('co_a'), p_status => 'none');
  PERFORM st.ok('V8 بلا اشتراك', st.names_of(p) = 's6' AND jsonb_array_length(p->'rows'->0->'subscriptions') = 0);
  PERFORM st.ok('V9 an unknown status or sort is refused',
    st.err(format('SELECT public.get_company_students_page_v2(%L, p_status => %L)', st.id('co_a'), 'paid')) IS NOT NULL
    AND st.err(format('SELECT public.get_company_students_page_v2(%L, p_sort => %L)', st.id('co_a'), 'x')) IS NOT NULL);

  p := public.get_company_students_page_v2(st.id('co_a'), p_student_id => st.id('s5'));
  PERFORM st.ok('V11 one member by id (the top bar''s search)', st.names_of(p) = 's5' AND (p->>'total')::int = 1);
  p := public.get_company_students_page_v2(st.id('co_a'), p_student_id => st.id('s8'));
  PERFORM st.ok('V12 never a member of another company', st.names_of(p) = '' AND (p->>'total')::int = 0);
  PERFORM public.request_student_correction(st.id('co_a'), st.id('s1'), 'full_name', 'طالب s1 الاختبار الثاني المصحح');
  p := public.get_company_students_page_v2(st.id('co_a'), p_search => 'طالب s1');
  PERFORM st.ok('V10 a pending correction shows on the row',
    p->'rows'->0->'corrections'->0->>'new_value' = 'طالب s1 الاختبار الثاني المصحح', p::text);
END $$;

-- =============================================================================
-- Named subscription moves
-- =============================================================================
DO $$
DECLARE r jsonb;
BEGIN
  r := public.admin_subscription_action(st.sub('s2'), 'activate');
  PERFORM st.ok('A1 cash activation: نشط, paid', r->>'status' = 'active' AND r->>'shown' = 'active' AND r->>'paid_at' IS NOT NULL, r::text);
  r := public.admin_subscription_action(st.sub('s2'), 'revert');
  PERFORM st.ok('A2 back to awaiting payment, unpaid again', r->>'status' = 'pending_payment' AND r->>'paid_at' IS NULL, r::text);
  r := public.admin_subscription_action(st.sub('s2'), 'cancel');
  PERFORM st.ok('A3 cancel ends in منتهٍ', r->>'status' = 'expired' AND r->>'shown' = 'ended', r::text);
  r := public.admin_subscription_action(st.sub('s2'), 'reactivate');
  PERFORM st.ok('A4 an ended subscription still in its dates is reactivated', r->>'status' = 'active', r::text);
  r := public.admin_subscription_action(st.sub('s2'), 'end');
  PERFORM st.ok('A5 end ends in منتهٍ', r->>'status' = 'expired', r::text);
  PERFORM st.ok('A6 a receipt under review is decided only on the receipts page',
    st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s3'), 'activate')) LIKE '%صفحة الإيصالات%');
  PERFORM st.ok('A7 a move that does not fit the status is refused',
    st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s1'), 'activate')) IS NOT NULL
    AND st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s5'), 'reactivate')) IS NOT NULL
    AND st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s1'), 'delete')) IS NOT NULL);
  r := public.admin_subscription_action(st.sub('s4'), 'activate');
  PERFORM st.ok('A8 a rejected receipt can be settled in cash', r->>'status' = 'active', r::text);
END $$;

SELECT st.login('AB');
DO $$
BEGIN
  PERFORM st.ok('X1 another company''s admin gets neither the list nor the moves',
    st.err(format('SELECT public.get_company_students_page_v2(%L)', st.id('co_a'))) IS NOT NULL
    AND st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s1'), 'end')) IS NOT NULL);
  PERFORM st.ok('X2 platform functions are the platform admin''s',
    st.err('SELECT public.platform_students_counts()') IS NOT NULL
    AND st.err(format('SELECT public.platform_student_details(%L)', st.id('s1'))) IS NOT NULL
    AND st.err('SELECT public.platform_correction_requests()') IS NOT NULL);
END $$;
SELECT st.login('s1');
DO $$
BEGIN
  PERFORM st.ok('X3 a student gets nothing',
    st.err(format('SELECT public.get_company_students_page_v2(%L)', st.id('co_a'))) IS NOT NULL
    AND st.err(format('SELECT public.admin_subscription_action(%L, %L)', st.sub('s1'), 'end')) IS NOT NULL);
END $$;

-- =============================================================================
-- The platform
-- =============================================================================
SELECT st.login('AS');
DO $$
DECLARE p jsonb; q jsonb; c jsonb;
BEGIN
  p := public.get_company_students_page_v2(st.id('co_a'));
  PERFORM st.ok('P1 the platform admin reads a company''s list', (p->>'total')::int = 7);
  c := public.platform_students_counts('الاختبار الثاني');
  PERFORM st.ok('P2 chips: all, without a company, in more than one',
    (c->>'all')::int = 8 AND (c->>'none')::int = 0 AND (c->>'multiple')::int = 1, c::text);
  c := public.platform_students_counts('الاختبار الثاني', st.id('co_b'));
  PERFORM st.ok('P3 chips within one company', (c->>'all')::int = 2, c::text);
  p := public.platform_student_details(st.id('s1'));
  PERFORM st.ok('P4 one account: both companies with their active subscriptions, the waiting correction',
    jsonb_array_length(p->'memberships') = 2
    AND (SELECT (m->>'active_subscriptions')::int FROM jsonb_array_elements(p->'memberships') m WHERE m->>'company_id' = st.id('co_a')::text) = 1
    AND p->'corrections'->0->>'company' = 'E2E Students A', p::text);
  q := (SELECT jsonb_agg(x) FROM jsonb_array_elements(public.platform_correction_requests()) x WHERE x->>'student_id' = st.id('s1')::text);
  PERFORM st.ok('P5 the queue says who wrote it and which companies the change reaches',
    q->0->>'requested_by_name' = 'مدير أ' AND q->0->>'student_phone' = '01218880001'
    AND jsonb_array_length(q->0->'student_companies') = 2, q::text);
  PERFORM public.decide_student_correction((q->0->>'id')::uuid, false, 'الاسم لا يطابق البطاقة.');
  PERFORM st.ok('P6 a refusal keeps its reason, and leaves the queue',
    (SELECT decision_note FROM public.student_correction_requests WHERE id = (q->0->>'id')::uuid) = 'الاسم لا يطابق البطاقة.'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.platform_correction_requests()) x WHERE x->>'id' = q->0->>'id'));
END $$;
RESET ROLE;

-- =============================================================================
\o
\echo
SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, step, left(detail, 300) AS detail FROM st.results ORDER BY n;
DO $$ DECLARE f int; BEGIN
  SELECT count(*) INTO f FROM st.results WHERE NOT ok;
  IF f > 0 THEN RAISE EXCEPTION '% test step(s) failed', f; END IF;
  RAISE NOTICE 'all % steps passed', (SELECT count(*) FROM st.results);
END $$;
ROLLBACK;
