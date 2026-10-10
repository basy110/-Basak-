-- ==============================================================================
-- Migration: 20261117000001_admin_receipts_history.sql
-- «الإيصالات» › «السجل»: the receipts a company has already decided (accepted or
-- rejected), newest decision first, with who decided and why. Safe to re-run.
-- Additive: a new function and a partial index; nothing existing changes.
--
-- admin_reviewed_receipts(p_company_id, p_outcome, p_from, p_to, p_search,
--                         p_limit, p_offset, p_line_id)
--   p_outcome  'approved' | 'rejected' | NULL (both)
--   p_from/p_to  Cairo calendar days of the decision (reviewed_at), inclusive
--   p_search   part of the student's name, or 3+ digits of the phone
--   p_line_id  one line, or NULL
-- Answers { rows, total, counts: {approved, rejected}, approved_amount, lines }.
-- `total` counts the rows matching every filter; `counts`, `approved_amount` and
-- `lines` ignore the outcome (and `lines` the line) so the page's chips can
-- show how many each choice would give.
-- ==============================================================================
BEGIN;

CREATE INDEX IF NOT EXISTS idx_receipts_company_reviewed
  ON public.receipts (company_id, reviewed_at DESC)
  WHERE status IN ('approved', 'rejected');

CREATE OR REPLACE FUNCTION public.admin_reviewed_receipts(
  p_company_id uuid,
  p_outcome text DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_line_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 5000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_outcome text := NULLIF(btrim(COALESCE(p_outcome, '')), '');
  v_term text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_digits text := regexp_replace(COALESCE(p_search, ''), '\D', '', 'g');
  v_out jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك عرض إيصالات هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF v_outcome IS NOT NULL AND v_outcome NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'نتيجة المراجعة غير معروفة.' USING ERRCODE = '22023';
  END IF;
  IF length(v_digits) < 3 THEN v_digits := NULL; END IF;

  WITH base AS (
    -- Every decided receipt of the company inside the days, the search and the line.
    SELECT r.id, r.status, r.amount, r.reviewed_at, r.created_at, r.reviewed_by, r.rejection_reason,
           r.attempt_number, r.image_url, r.payment_method_id, r.subscription_id,
           s.student_id, s.line_id, s.station_id, s.price
    FROM public.receipts r
    LEFT JOIN public.subscriptions s ON s.id = r.subscription_id
    LEFT JOIN public.students st ON st.id = s.student_id
    WHERE r.company_id = p_company_id
      AND r.status IN ('approved', 'rejected')
      AND (p_from IS NULL OR r.reviewed_at >= (p_from::timestamp AT TIME ZONE 'Africa/Cairo'))
      AND (p_to IS NULL OR r.reviewed_at < ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Cairo'))
      AND (v_term IS NULL
           OR st.full_name ILIKE '%' || v_term || '%'
           OR (v_digits IS NOT NULL AND regexp_replace(COALESCE(st.phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%'))
  ),
  scoped AS (SELECT * FROM base WHERE p_line_id IS NULL OR line_id = p_line_id),
  matching AS (SELECT * FROM scoped WHERE v_outcome IS NULL OR status = v_outcome),
  page AS (
    SELECT * FROM matching
    ORDER BY reviewed_at DESC NULLS LAST, id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'status', p.status, 'amount', COALESCE(p.amount, p.price),
        'reviewed_at', p.reviewed_at, 'created_at', p.created_at,
        'reviewed_by', p.reviewed_by, 'reviewer_name', a.full_name,
        'rejection_reason', p.rejection_reason, 'attempt_number', p.attempt_number, 'image_url', p.image_url,
        'payment_method', pm.display_name,
        'subscription_id', p.subscription_id, 'student_id', p.student_id,
        'student_name', st.full_name, 'student_phone', st.phone,
        'line_id', p.line_id, 'line_name', l.name, 'station_name', sn.name,
        'subscription_type', s.type, 'period_label', public.period_label(s),
        'period_start', s.start_date, 'period_end', s.end_date)
        ORDER BY p.reviewed_at DESC NULLS LAST, p.id)
      FROM page p
      LEFT JOIN public.subscriptions s ON s.id = p.subscription_id
      LEFT JOIN public.students st ON st.id = p.student_id
      LEFT JOIN public.lines l ON l.id = p.line_id
      LEFT JOIN public.stations sn ON sn.id = p.station_id
      LEFT JOIN public.admins a ON a.id = p.reviewed_by
      LEFT JOIN public.company_payment_methods pm ON pm.id = p.payment_method_id), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching),
    'counts', jsonb_build_object(
      'approved', (SELECT count(*) FROM scoped WHERE status = 'approved'),
      'rejected', (SELECT count(*) FROM scoped WHERE status = 'rejected')),
    'approved_amount', (SELECT COALESCE(sum(COALESCE(amount, price)), 0) FROM scoped WHERE status = 'approved'),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('line_id', x.line_id, 'line_name', x.name, 'count', x.n) ORDER BY x.n DESC, x.name)
      FROM (SELECT b.line_id, l.name, count(*) AS n FROM base b JOIN public.lines l ON l.id = b.line_id
            WHERE v_outcome IS NULL OR b.status = v_outcome
            GROUP BY b.line_id, l.name) x), '[]'::jsonb))
  INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reviewed_receipts(uuid, text, date, date, text, integer, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reviewed_receipts(uuid, text, date, date, text, integer, integer, uuid) TO authenticated;

COMMIT;
