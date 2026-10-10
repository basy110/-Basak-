-- ==============================================================================
-- Migration: 20261116000002_admin_receipts.sql
-- Run AFTER 20261115000001_supervisor_sees_student_photo.sql. Safe to re-run. Additive only.
--
-- «طلبات كلمة المرور» for the platform admin lists every company's requests with
-- the student's company («شركته» on the board, «بلا شركة» when there is none).
-- admin_list_password_reset_requests cannot gain a column without being dropped
-- (its RETURNS TABLE is fixed, and the dashboard in production calls it), so the
-- richer list is a new function next to it. Same checks, same 30 days, same order.
--
-- Rows: {id, student_id, student_name, student_phone, status, requested_at,
--        code_issued_at, code_expires_at, failed_attempts, closed_at, companies}
--   companies: the names of the companies the student is an active member of,
--              for the platform admin only (a company admin gets null: another
--              company's name is not theirs to see).
-- ==============================================================================
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

COMMIT;
