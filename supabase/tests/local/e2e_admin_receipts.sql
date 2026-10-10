-- e2e_admin_receipts.sql — re-runnable check of 20261116000002_admin_receipts.sql.
-- Everything runs inside BEGIN … ROLLBACK: nothing persists. Raises on any failure;
-- the last SELECT shows 'ok' rows when every check passed.
BEGIN;


CREATE OR REPLACE FUNCTION public.admin_password_reset_requests(p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_platform boolean := public.is_super_admin();
  v_rows jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'متاح للمسؤولين فقط.' USING ERRCODE = '42501';
  END IF;
  IF p_company_id IS NOT NULL AND NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك عرض طلبات هذه الشركة.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY open_first DESC, requested_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT (r.status IN ('pending', 'code_issued') AND NOT (r.status = 'code_issued' AND r.code_expires_at < now())) AS open_first,
           r.requested_at,
           jsonb_build_object(
             'id', r.id, 'student_id', r.student_id, 'student_name', s.full_name, 'student_phone', s.phone,
             'status', CASE WHEN r.status = 'code_issued' AND r.code_expires_at < now() THEN 'expired' ELSE r.status END,
             'requested_at', r.requested_at, 'code_issued_at', r.code_issued_at, 'code_expires_at', r.code_expires_at,
             'failed_attempts', r.failed_attempts, 'closed_at', r.closed_at,
             'companies', CASE WHEN v_platform THEN (
               SELECT COALESCE(jsonb_agg(c.name ORDER BY cs.joined_at), '[]'::jsonb)
               FROM public.company_students cs JOIN public.companies c ON c.id = cs.company_id
               WHERE cs.student_id = r.student_id AND cs.status = 'active') END
           ) AS row_json
    FROM public.password_reset_requests r JOIN public.students s ON s.id = r.student_id
    WHERE r.requested_at > now() - INTERVAL '30 days'
      AND public.admin_can_manage_student(r.student_id)
      AND (p_company_id IS NULL OR public.is_company_member(p_company_id, r.student_id))
  ) t;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_password_reset_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_password_reset_requests(uuid) TO authenticated;


CREATE TEMP TABLE t_results(check_name text, ok boolean) ON COMMIT DROP;
GRANT ALL ON t_results TO authenticated;

-- A request to look at, whatever the data holds.
DO $$
DECLARE v_student uuid;
BEGIN
  SELECT cs.student_id INTO v_student FROM public.company_students cs
  WHERE cs.status = 'active' AND cs.company_id = '8a0cb247-8bcf-45af-b986-5aad4a49b10b' LIMIT 1;
  IF v_student IS NOT NULL THEN
    UPDATE public.password_reset_requests SET status = 'cancelled', closed_at = now()
    WHERE student_id = v_student AND status IN ('pending', 'code_issued');
    INSERT INTO public.password_reset_requests (student_id) VALUES (v_student);
  END IF;
END $$;

-- 1. Platform admin: same rows as the old list, each with a companies array.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c5ca34e1-0285-45ef-9ee6-8c7e656ca5f6","role":"authenticated"}';
INSERT INTO t_results SELECT 'platform: same count as old list',
  jsonb_array_length(public.admin_password_reset_requests(NULL)) = (SELECT count(*) FROM public.admin_list_password_reset_requests(NULL));
INSERT INTO t_results SELECT 'platform: companies is an array',
  COALESCE(bool_and(jsonb_typeof(e->'companies') = 'array'), true) FROM jsonb_array_elements(public.admin_password_reset_requests(NULL)) e;
INSERT INTO t_results SELECT 'platform: at least one row (the inserted one)',
  jsonb_array_length(public.admin_password_reset_requests(NULL)) > 0;
INSERT INTO t_results SELECT 'platform: open rows first',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.admin_password_reset_requests(NULL)) WITH ORDINALITY a(e, i)
              JOIN jsonb_array_elements(public.admin_password_reset_requests(NULL)) WITH ORDINALITY b(e, i) ON b.i > a.i
              WHERE a.e->>'status' NOT IN ('pending', 'code_issued') AND b.e->>'status' IN ('pending', 'code_issued'));

-- 2. Company admin: own company only, no company names.
SET LOCAL request.jwt.claims = '{"sub":"c33f46bb-8323-4a5f-b1e3-84478e419ad2","role":"authenticated"}';
INSERT INTO t_results SELECT 'company: same count as old list',
  jsonb_array_length(public.admin_password_reset_requests('8a0cb247-8bcf-45af-b986-5aad4a49b10b')) =
  (SELECT count(*) FROM public.admin_list_password_reset_requests('8a0cb247-8bcf-45af-b986-5aad4a49b10b'));
INSERT INTO t_results SELECT 'company: companies hidden',
  COALESCE(bool_and(e->'companies' = 'null'::jsonb OR NOT (e ? 'companies')), true)
  FROM jsonb_array_elements(public.admin_password_reset_requests('8a0cb247-8bcf-45af-b986-5aad4a49b10b')) e;
DO $$ BEGIN
  PERFORM public.admin_password_reset_requests('dc0da050-c563-45e5-8776-64d586425c79');
  INSERT INTO t_results VALUES ('company: other company refused', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO t_results VALUES ('company: other company refused', true);
END $$;

-- 3. Not an admin.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
DO $$ BEGIN
  PERFORM public.admin_password_reset_requests(NULL);
  INSERT INTO t_results VALUES ('non-admin refused', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO t_results VALUES ('non-admin refused', true);
END $$;
RESET role;

-- 4. anon has no EXECUTE.
INSERT INTO t_results SELECT 'anon cannot execute', NOT has_function_privilege('anon', 'public.admin_password_reset_requests(uuid)', 'EXECUTE');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM t_results WHERE NOT ok) THEN
    RAISE EXCEPTION 'e2e_admin_receipts FAILED: %', (SELECT string_agg(check_name, '; ') FROM t_results WHERE NOT ok);
  END IF;
END $$;
SELECT check_name, CASE WHEN ok THEN 'ok' ELSE 'FAILED' END AS result FROM t_results ORDER BY check_name;
ROLLBACK;
