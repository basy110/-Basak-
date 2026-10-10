-- Test of 20261116000007_admin_platform (status_changed_at, platform_companies,
-- platform_company_detail, platform_university_counts, editing a university).
-- Plain SQL, one transaction, rolled back: run it after the migration, or paste
-- the migration right after the BEGIN below. Nothing persists. The last
-- statement lists every check; all must say ok = true. (Run on 2026-10-10 against
-- hnwpkkryxovhmsrokdsd with the migration pasted in and a RAISE in place of the last
-- SELECT so the transaction could only roll back: 29 of 29 ok; the save_platform_terms
-- checks were run the same way on their own: 6 of 6 ok.)
--
-- Fixture (triggers off while it is written): company A (active) with two lines —
-- LA1 complete (station, a departure trip, a supervisor), LA2 with a station but
-- no departure trip and no supervisor — one active InstaPay method, two admins and
-- three students at university U1 (two in «الهندسة», one in «الطب»). Company B is
-- active with nothing. A platform admin.
BEGIN;

CREATE SCHEMA tp;
GRANT USAGE ON SCHEMA tp TO authenticated, anon;
CREATE TABLE tp.results (n serial PRIMARY KEY, step text, ok boolean, detail text);
CREATE FUNCTION tp.ok(p_step text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO tp.results(step, ok, detail) VALUES (p_step, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION tp.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
CREATE TABLE tp.out (who text PRIMARY KEY, body jsonb);
CREATE FUNCTION tp.keep(p_who text, p_body jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO tp.out VALUES (p_who, p_body) ON CONFLICT (who) DO UPDATE SET body = excluded.body $$;
CREATE FUNCTION tp.login(p_id uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tp TO authenticated, anon;
GRANT INSERT, SELECT, UPDATE ON tp.results, tp.out TO authenticated;
GRANT USAGE ON SEQUENCE tp.results_n_seq TO authenticated;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
SELECT ('7e000000-0000-4000-8000-0000000000' || x)::uuid, 'tp-' || x || '@example.invalid'
FROM unnest(ARRAY['a5', 'aa', 'ac', 'e1', '51', '52', '53']) x;

INSERT INTO public.companies (id, name, status, is_active, contact_phone, contact_label) VALUES
  ('7e000000-0000-4000-8000-00000000c00a', 'اختبار المنصة أ', 'active', true, '01062162920', 'خدمة العملاء'),
  ('7e000000-0000-4000-8000-00000000c00b', 'اختبار المنصة ب', 'active', true, NULL, NULL);

INSERT INTO public.admins (id, email, full_name, role, company_id, created_by_admin_id) VALUES
  ('7e000000-0000-4000-8000-0000000000a5', 'tp-a5@example.invalid', 'مدير المنصة', 'super_admin', NULL, NULL),
  ('7e000000-0000-4000-8000-0000000000aa', 'tp-aa@example.invalid', 'مدير أ', 'company_admin', '7e000000-0000-4000-8000-00000000c00a', '7e000000-0000-4000-8000-0000000000a5'),
  ('7e000000-0000-4000-8000-0000000000ac', 'tp-ac@example.invalid', 'مديرة أ', 'company_admin', '7e000000-0000-4000-8000-00000000c00a', '7e000000-0000-4000-8000-0000000000a5');

INSERT INTO public.universities (id, name, city, is_active) VALUES
  ('7e000000-0000-4000-8000-0000000000f1', 'جامعة اختبار المنصة', 'دمياط', true),
  ('7e000000-0000-4000-8000-0000000000f2', 'جامعة اختبار بلا خطوط', 'المنصورة', true);
INSERT INTO public.colleges (university_id, name, is_active) VALUES
  ('7e000000-0000-4000-8000-0000000000f1', 'الهندسة', true),
  ('7e000000-0000-4000-8000-0000000000f1', 'الطب', true);

INSERT INTO public.lines (id, company_id, name, origin_name, destination_university_id, price_termly, price_yearly, price_daily, is_active) VALUES
  ('7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-00000000c00a', 'خط المنصة أ', 'البداية', '7e000000-0000-4000-8000-0000000000f1', 3500, 6500, 0, true),
  ('7e000000-0000-4000-8000-00000000a002', '7e000000-0000-4000-8000-00000000c00a', 'خط المنصة ب', 'البداية', '7e000000-0000-4000-8000-0000000000f1', 3500, 6500, 0, true);
INSERT INTO public.line_universities (line_id, university_id, company_id) VALUES
  ('7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-0000000000f1', '7e000000-0000-4000-8000-00000000c00a'),
  ('7e000000-0000-4000-8000-00000000a002', '7e000000-0000-4000-8000-0000000000f1', '7e000000-0000-4000-8000-00000000c00a');
INSERT INTO public.line_period_prices (line_id, company_id, option, price, is_enabled)
SELECT l, '7e000000-0000-4000-8000-00000000c00a', o, CASE o WHEN 'both' THEN 6500 ELSE 3500 END, o <> 'summer'
FROM unnest(ARRAY['7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-00000000a002']::uuid[]) l,
     unnest(ARRAY['first', 'second', 'both', 'summer']) o;
INSERT INTO public.stations (id, line_id, name, order_index, company_id, is_active) VALUES
  ('7e000000-0000-4000-8000-00000000b001', '7e000000-0000-4000-8000-00000000a001', 'محطة 1', 0, '7e000000-0000-4000-8000-00000000c00a', true),
  ('7e000000-0000-4000-8000-00000000b002', '7e000000-0000-4000-8000-00000000a002', 'محطة 2', 0, '7e000000-0000-4000-8000-00000000c00a', true);
INSERT INTO public.line_trips (id, line_id, company_id, direction, label, start_time, university_id, is_active) VALUES
  ('7e000000-0000-4000-8000-00000000d001', '7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-00000000c00a', 'departure', 'الأولى', '07:00', NULL, true),
  ('7e000000-0000-4000-8000-00000000e001', '7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-00000000c00a', 'return', 'العودة', '14:00', NULL, true);
INSERT INTO public.line_trip_stops (trip_id, station_id, stop_time, company_id) VALUES
  ('7e000000-0000-4000-8000-00000000d001', '7e000000-0000-4000-8000-00000000b001', '07:00', '7e000000-0000-4000-8000-00000000c00a');
INSERT INTO public.supervisors (id, phone, full_name, company_id, is_active) VALUES
  ('7e000000-0000-4000-8000-0000000000e1', '01099980001', 'مشرف المنصة', '7e000000-0000-4000-8000-00000000c00a', true);
INSERT INTO public.supervisor_lines (supervisor_id, line_id, company_id) VALUES
  ('7e000000-0000-4000-8000-0000000000e1', '7e000000-0000-4000-8000-00000000a001', '7e000000-0000-4000-8000-00000000c00a');
INSERT INTO public.company_payment_methods (company_id, method_type, display_name, instapay_address, is_active) VALUES
  ('7e000000-0000-4000-8000-00000000c00a', 'instapay', 'إنستاباي أ', 'tp@instapay', true);

INSERT INTO public.students (id, phone, full_name, university, college, university_id)
SELECT ('7e000000-0000-4000-8000-0000000000' || x)::uuid, '0109998000' || right(x, 1), 'طالب ' || x, 'جامعة اختبار المنصة',
       CASE x WHEN '53' THEN 'الطب' ELSE 'الهندسة' END, '7e000000-0000-4000-8000-0000000000f1'
FROM unnest(ARRAY['51', '52', '53']) x;
INSERT INTO public.company_students (company_id, student_id, status)
SELECT '7e000000-0000-4000-8000-00000000c00a', ('7e000000-0000-4000-8000-0000000000' || x)::uuid, 'active' FROM unnest(ARRAY['51', '52', '53']) x;

SET LOCAL session_replication_role = origin;

-- =============================================================================
-- Who may call
-- =============================================================================
SET LOCAL ROLE anon;
SELECT tp.ok('anon cannot list companies', tp.err($$SELECT public.platform_companies()$$) = '42501');
SELECT tp.ok('anon cannot read a company', tp.err($$SELECT public.platform_company_detail('7e000000-0000-4000-8000-00000000c00a')$$) = '42501');
SELECT tp.ok('anon cannot read university counts', tp.err($$SELECT public.platform_university_counts()$$) = '42501');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT tp.login('7e000000-0000-4000-8000-0000000000aa');
SELECT tp.ok('a company admin cannot list companies', tp.err($$SELECT public.platform_companies()$$) = '42501');
SELECT tp.ok('a company admin cannot read even their own detail', tp.err($$SELECT public.platform_company_detail('7e000000-0000-4000-8000-00000000c00a')$$) = '42501');
SELECT tp.ok('a company admin cannot read university counts', tp.err($$SELECT public.platform_university_counts()$$) = '42501');
SELECT tp.err($$UPDATE public.universities SET name = 'x' WHERE id = '7e000000-0000-4000-8000-0000000000f1'$$);
SELECT tp.ok('a company admin cannot rename a university',
             (SELECT name FROM public.universities WHERE id = '7e000000-0000-4000-8000-0000000000f1') = 'جامعة اختبار المنصة');

SELECT tp.login('7e000000-0000-4000-8000-0000000000a5');
SELECT tp.keep('list', public.platform_companies());
SELECT tp.keep('detail A', public.platform_company_detail('7e000000-0000-4000-8000-00000000c00a'));
SELECT tp.keep('detail B', public.platform_company_detail('7e000000-0000-4000-8000-00000000c00b'));
SELECT tp.keep('counts', public.platform_university_counts());
SELECT tp.ok('a missing company is P0002', tp.err($$SELECT public.platform_company_detail('7e000000-0000-4000-8000-0000000000ff')$$) = 'P0002');

-- Editing a university (no new function: the platform admin's policy allows it).
UPDATE public.universities SET name = 'جامعة اختبار المنصة الجديدة', city = 'دمياط الجديدة' WHERE id = '7e000000-0000-4000-8000-0000000000f1';
SELECT tp.ok('the platform admin renamed the university',
             (SELECT name = 'جامعة اختبار المنصة الجديدة' AND city = 'دمياط الجديدة' FROM public.universities WHERE id = '7e000000-0000-4000-8000-0000000000f1'));
SELECT tp.ok('a duplicate name is refused (23505)',
             tp.err($$UPDATE public.universities SET name = 'جامعة اختبار بلا خطوط' WHERE id = '7e000000-0000-4000-8000-0000000000f1'$$) = '23505');

-- Suspending stamps the time; renaming does not.
UPDATE public.companies SET name = 'اختبار المنصة ب' WHERE id = '7e000000-0000-4000-8000-00000000c00b';
SELECT tp.ok('a rename leaves status_changed_at alone',
             (SELECT status_changed_at IS NULL FROM public.companies WHERE id = '7e000000-0000-4000-8000-00000000c00b'));
UPDATE public.companies SET status = 'suspended' WHERE id = '7e000000-0000-4000-8000-00000000c00b';
SELECT tp.ok('suspending stamps status_changed_at',
             (SELECT status_changed_at = now() AND status = 'suspended' FROM public.companies WHERE id = '7e000000-0000-4000-8000-00000000c00b'));
SELECT tp.keep('list after', public.platform_companies());
RESET ROLE;

SELECT tp.ok('students follow the new university name (existing trigger)',
             (SELECT bool_and(university = 'جامعة اختبار المنصة الجديدة') FROM public.students WHERE university_id = '7e000000-0000-4000-8000-0000000000f1'));

-- =============================================================================
-- What the list says
-- =============================================================================
CREATE TEMP VIEW tp_a AS SELECT r FROM tp.out, jsonb_array_elements(body) r WHERE who = 'list' AND r->>'id' = '7e000000-0000-4000-8000-00000000c00a';
CREATE TEMP VIEW tp_b AS SELECT r FROM tp.out, jsonb_array_elements(body) r WHERE who = 'list' AND r->>'id' = '7e000000-0000-4000-8000-00000000c00b';
SELECT tp.ok('every company has a row', (SELECT jsonb_array_length(body) = (SELECT count(*) FROM public.companies) FROM tp.out WHERE who = 'list'));
SELECT tp.ok('A: 2 lines, 2 active, 3 students, 2 admins, 1 supervisor, 1 active payment method',
             (SELECT (r->>'lines')::int = 2 AND (r->>'active_lines')::int = 2 AND (r->>'students')::int = 3 AND (r->>'admins')::int = 2
                     AND (r->>'supervisors')::int = 1 AND (r->>'payment_methods')::int = 1 FROM tp_a), (SELECT r::text FROM tp_a));
SELECT tp.ok('A: selling follows what its lines sell',
             (SELECT (r->>'selling')::boolean = EXISTS (SELECT 1 FROM public.line_sale_options_for('7e000000-0000-4000-8000-00000000a001', NULL, NULL) o WHERE o.available) FROM tp_a));
SELECT tp.ok('A: contact and dates', (SELECT r->>'contact_phone' = '01062162920' AND r->>'contact_label' = 'خدمة العملاء' AND r ? 'created_at' AND r ? 'status_changed_at' FROM tp_a));
SELECT tp.ok('B: empty and not selling', (SELECT (r->>'lines')::int = 0 AND (r->>'students')::int = 0 AND (r->>'payment_methods')::int = 0 AND NOT (r->>'selling')::boolean FROM tp_b));
SELECT tp.ok('B after suspending: status and stamp in the list',
             (SELECT r->>'status' = 'suspended' AND r->>'status_changed_at' IS NOT NULL
              FROM tp.out, jsonb_array_elements(body) r WHERE who = 'list after' AND r->>'id' = '7e000000-0000-4000-8000-00000000c00b'));

-- =============================================================================
-- What the detail says
-- =============================================================================
CREATE TEMP VIEW tp_d AS SELECT body FROM tp.out WHERE who = 'detail A';
CREATE TEMP VIEW tp_dl AS SELECT l->>'name' AS name, l FROM tp_d, jsonb_array_elements(body->'lines') l;
SELECT tp.ok('detail: company, two admins in order', (SELECT body->'company'->>'name' = 'اختبار المنصة أ' AND jsonb_array_length(body->'admins') = 2
                                                            AND body->'admins'->0->>'full_name' = 'مدير أ' FROM tp_d));
SELECT tp.ok('detail: only the active payment method', (SELECT jsonb_array_length(body->'payment_methods') = 1 AND body->'payment_methods'->0->>'method_type' = 'instapay' FROM tp_d));
SELECT tp.ok('detail: one supervisor', (SELECT (body->>'supervisors')::int = 1 FROM tp_d));
SELECT tp.ok('detail: LA2 hidden for lack of a departure trip, unsupervised',
             (SELECT l->>'hidden' = 'no_departure' AND NOT (l->>'supervised')::boolean FROM tp_dl WHERE name = 'خط المنصة ب'), (SELECT l::text FROM tp_dl WHERE name = 'خط المنصة ب'));
SELECT tp.ok('detail: LA1 supervised; hidden only if nothing is on sale',
             (SELECT (l->>'supervised')::boolean AND (l->>'hidden' IS NULL OR l->>'hidden' = 'nothing_on_sale') FROM tp_dl WHERE name = 'خط المنصة أ'), (SELECT l::text FROM tp_dl WHERE name = 'خط المنصة أ'));
SELECT tp.ok('detail: sale options named, each with on_sale',
             (SELECT jsonb_array_length(body->'sale') >= 1 AND bool_and(s ? 'option' AND s ? 'name' AND s ? 'on_sale')
              FROM tp_d, jsonb_array_elements(body->'sale') s GROUP BY body), (SELECT (body->'sale')::text FROM tp_d));
SELECT tp.ok('detail of an empty company', (SELECT jsonb_array_length(body->'lines') = 0 AND jsonb_array_length(body->'payment_methods') = 0
                                                   AND jsonb_array_length(body->'admins') = 0 FROM tp.out WHERE who = 'detail B'));

-- =============================================================================
-- University counts
-- =============================================================================
CREATE TEMP VIEW tp_u AS SELECT u FROM tp.out, jsonb_array_elements(body->'universities') u WHERE who = 'counts';
SELECT tp.ok('U1: 3 students, 2 lines, company A', (SELECT (u->>'students')::int = 3 AND (u->>'lines')::int = 2 AND jsonb_array_length(u->'companies') = 1
                                                           AND u->'companies'->0->>'name' = 'اختبار المنصة أ' FROM tp_u WHERE u->>'id' = '7e000000-0000-4000-8000-0000000000f1'));
SELECT tp.ok('U2: nothing', (SELECT (u->>'students')::int = 0 AND (u->>'lines')::int = 0 AND jsonb_array_length(u->'companies') = 0 FROM tp_u WHERE u->>'id' = '7e000000-0000-4000-8000-0000000000f2'));
SELECT tp.ok('colleges: 2 in الهندسة, 1 in الطب',
             (SELECT bool_and(CASE c->>'college' WHEN 'الهندسة' THEN (c->>'students')::int = 2 WHEN 'الطب' THEN (c->>'students')::int = 1 ELSE true END)
                     AND count(*) = 2
              FROM tp.out, jsonb_array_elements(body->'colleges') c WHERE who = 'counts' AND c->>'university_id' = '7e000000-0000-4000-8000-0000000000f1'));

-- =============================================================================
-- save_platform_terms: all at once, checked once
-- =============================================================================
SET LOCAL ROLE authenticated;
SELECT tp.login('7e000000-0000-4000-8000-0000000000aa');
SELECT tp.ok('a company admin cannot save the default terms', tp.err($$SELECT public.save_platform_terms('[]')$$) = '42501');
SELECT tp.login('7e000000-0000-4000-8000-0000000000a5');
SELECT tp.ok('moving the first term past the second''s old start is saved in one go',
             tp.err($$SELECT public.save_platform_terms('[{"code":"first","start_month":9,"start_day":25,"end_month":2,"end_day":20},{"code":"second","start_month":2,"start_day":25,"end_month":6,"end_day":20}]')$$) IS NULL);
SELECT tp.ok('an overlap is refused (23514)', tp.err($$SELECT public.save_platform_terms('[{"code":"second","start_month":1,"start_day":1}]')$$) = '23514');
SELECT tp.ok('February 31 is refused', tp.err($$SELECT public.save_platform_terms('[{"code":"second","start_month":2,"start_day":31}]')$$) IS NOT NULL);
SELECT tp.ok('it answers with the three terms', jsonb_array_length(public.save_platform_terms('[]')) = 3);
RESET ROLE;
SELECT tp.ok('the saved dates', (SELECT end_month = 2 AND end_day = 20 FROM public.academic_terms WHERE code = 'first')
                                AND (SELECT start_day = 25 FROM public.academic_terms WHERE code = 'second'));

SELECT n, step, ok, detail FROM tp.results ORDER BY n;
ROLLBACK;
