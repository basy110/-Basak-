-- ==============================================================================
-- Migration: 20261116000006_admin_money.sql
-- The dashboard's money pages (docs/admin-redesign · «مواعيد الاشتراك»,
-- «وسائل الدفع», «الإيرادات»). Safe to re-run. Additive: nothing the released
-- app or the deployed dashboard calls changes its name, arguments or answer
-- (admin_subscription_report only gains a `student_id` in each row).
--
-- 1. company_revenue_breakdown: the revenue page's totals by subscription,
--    by line and by payment method in one request, from the company's last
--    report reset (the baseline), with the same filters as the report.
-- 2. company_terms_impact: before term dates are saved, how many open
--    subscriptions each change would move (worked out by really applying the
--    change inside a sub-transaction that is always rolled back), and how many
--    open subscriptions each option has now.
-- 3. save_company_subscription_settings: the subscription-periods page saves
--    term dates, the on-sale switches, paying ahead, «الفصلان معاً» and the
--    daily switch in ONE transaction (all or nothing), through the existing
--    functions and their checks.
-- 4. reorder_payment_methods: the whole order of a company's payment methods
--    in one statement (it was two updates that could half-succeed).
-- 5. company_report_resets: the reset log with who reset and who undid.
-- 6. admin_subscription_report: rows also carry `student_id` (a row opens the
--    student's page).
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Revenue breakdown
-- ------------------------------------------------------------------------------
-- p_from / p_to bound the moment that counts for a row (paid_at, else created_at).
-- p_filters: as admin_subscription_report (university_id, line_id, academic_year,
-- period, phase, search, include_before_reset); `payment` is ignored here.
-- Payment method of a paid subscription: the method of its approved receipt;
-- a paid daily subscription with no receipt is cash; another paid one with no
-- receipt was marked paid by hand ('none'); a receipt whose method was deleted
-- is 'deleted'.
CREATE OR REPLACE FUNCTION public.company_revenue_breakdown(
  p_company_id uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := CASE WHEN public.is_company_admin() THEN public.current_admin_company_id() ELSE p_company_id END;
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_university uuid := NULLIF(v_f->>'university_id', '')::uuid;
  v_line uuid := NULLIF(v_f->>'line_id', '')::uuid;
  v_year int := NULLIF(v_f->>'academic_year', '')::int;
  v_period text := NULLIF(replace(v_f->>'period', 'annual', 'both'), '');
  v_phase text := NULLIF(v_f->>'phase', '');
  v_search text := NULLIF(btrim(v_f->>'search'), '');
  v_history boolean := COALESCE((v_f->>'include_before_reset')::boolean, false);
  v_today date := public.cairo_today();
  v_since timestamptz;
  v_out jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.can_manage_company(v_company) THEN
    RAISE EXCEPTION 'الإيرادات متاحة لإدارة الشركة فقط.' USING ERRCODE = '42501';
  END IF;
  v_since := public.report_baseline('financial', v_company);

  WITH f AS (
    SELECT s.id, s.type, s.status, s.line_id, s.paid_at,
      COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) AS opt,
      CASE WHEN s.status = 'expired' OR s.end_date < v_today THEN 'expired'
           WHEN s.start_date > v_today THEN 'upcoming' ELSE 'current' END AS phase,
      (s.paid_at IS NOT NULL) AS is_paid,
      CASE WHEN s.paid_at IS NOT NULL THEN COALESCE(a.amount, s.price) END AS amount,
      a.receipt_id, a.payment_method_id
    FROM public.subscriptions s
    JOIN public.students st ON st.id = s.student_id
    JOIN public.lines l ON l.id = s.line_id AND l.company_id = v_company
    LEFT JOIN LATERAL (
      SELECT r.id AS receipt_id, r.amount, r.payment_method_id FROM public.receipts r
      WHERE r.subscription_id = s.id AND r.status = 'approved'
      ORDER BY r.reviewed_at DESC NULLS LAST LIMIT 1) a ON true
    WHERE s.company_id = v_company
      AND (v_history OR v_since IS NULL OR COALESCE(s.paid_at, s.created_at) > v_since)
      AND (p_from IS NULL OR COALESCE(s.paid_at, s.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(s.paid_at, s.created_at) < p_to)
      AND (v_university IS NULL OR st.university_id = v_university)
      AND (v_line IS NULL OR s.line_id = v_line)
      AND (v_year IS NULL OR s.academic_year = v_year)
      AND (v_search IS NULL OR st.full_name ILIKE '%' || v_search || '%'
           OR st.phone LIKE '%' || NULLIF(regexp_replace(v_search, '\D', '', 'g'), '') || '%')
      AND (v_period IS NULL OR COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) = v_period)
      AND (v_phase IS NULL OR v_phase = CASE WHEN s.status = 'expired' OR s.end_date < v_today THEN 'expired'
                                             WHEN s.start_date > v_today THEN 'upcoming' ELSE 'current' END)
  ),
  m AS (
    SELECT f.*,
      CASE WHEN f.receipt_id IS NULL THEN CASE WHEN f.type = 'daily' THEN 'cash' ELSE 'none' END
           WHEN pm.id IS NULL THEN 'deleted' ELSE 'method' END AS method_kind,
      pm.id AS method_id, pm.display_name AS method_name, pm.method_type, pm.sort_order AS method_order
    FROM f LEFT JOIN public.company_payment_methods pm ON pm.id = f.payment_method_id AND pm.company_id = v_company
  )
  SELECT jsonb_build_object(
    'baseline', CASE WHEN v_history THEN NULL ELSE v_since END,
    'totals', (SELECT jsonb_build_object(
        'count', count(*),
        'paid', count(*) FILTER (WHERE is_paid),
        'unpaid', count(*) FILTER (WHERE NOT is_paid AND status IN ('pending_payment', 'pending_review', 'rejected')),
        'in_review', count(*) FILTER (WHERE NOT is_paid AND status = 'pending_review'),
        'upcoming', count(*) FILTER (WHERE phase = 'upcoming'),
        'upcoming_paid', count(*) FILTER (WHERE phase = 'upcoming' AND is_paid),
        'daily_paid', count(*) FILTER (WHERE is_paid AND opt = 'daily'),
        'revenue', COALESCE(sum(amount) FILTER (WHERE is_paid), 0)) FROM m),
    'by_option', (SELECT jsonb_agg(jsonb_build_object(
        'option', o.opt,
        'paid', (SELECT count(*) FROM m WHERE m.opt = o.opt AND m.is_paid),
        'amount', (SELECT COALESCE(sum(m.amount), 0) FROM m WHERE m.opt = o.opt AND m.is_paid),
        'upcoming', (SELECT count(*) FROM m WHERE m.opt = o.opt AND m.phase = 'upcoming'),
        'upcoming_paid', (SELECT count(*) FROM m WHERE m.opt = o.opt AND m.phase = 'upcoming' AND m.is_paid)) ORDER BY o.ord)
      FROM (VALUES ('both', 1), ('first', 2), ('second', 3), ('daily', 4), ('summer', 5)) AS o(opt, ord)),
    'by_line', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'line_id', l.id, 'name', l.name, 'is_active', l.is_active,
        'paid', COALESCE(x.paid, 0), 'amount', COALESCE(x.amount, 0)) ORDER BY COALESCE(x.amount, 0) DESC, l.name)
      FROM public.lines l
      LEFT JOIN (SELECT line_id, count(*) AS paid, sum(amount) AS amount FROM m WHERE is_paid GROUP BY line_id) x ON x.line_id = l.id
      WHERE l.company_id = v_company AND (v_line IS NULL OR l.id = v_line)), '[]'::jsonb),
    'by_method', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', g.method_kind, 'method_id', g.method_id, 'name', g.method_name, 'method_type', g.method_type,
        'paid', g.paid, 'amount', g.amount) ORDER BY g.amount DESC, g.method_order NULLS LAST)
      FROM (SELECT method_kind, method_id, method_name, method_type, method_order, count(*) AS paid, sum(amount) AS amount
            FROM m WHERE is_paid GROUP BY method_kind, method_id, method_name, method_type, method_order) g), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. What a change of term dates would do, before it is saved
-- ------------------------------------------------------------------------------
-- p_terms: as save_company_terms. Answers
--   { moved: { first: n, second: n, summer: n, both: n }, moved_total: n,
--     open: { first: n, second: n, both: n, summer: n, daily: n } }
-- An invalid change raises the same Arabic message the save would.
CREATE OR REPLACE FUNCTION public.company_terms_impact(p_company_id uuid, p_terms jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_moved jsonb := '{}'::jsonb;
  v_total int := 0;
  v_open jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل إعدادات هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF p_terms IS NOT NULL AND jsonb_typeof(p_terms) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'بيانات الفصول غير صحيحة.' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
      'first', count(*) FILTER (WHERE k = 'first'), 'second', count(*) FILTER (WHERE k = 'second'),
      'both', count(*) FILTER (WHERE k = 'both'), 'summer', count(*) FILTER (WHERE k = 'summer'),
      'daily', count(*) FILTER (WHERE k = 'daily'))
  INTO v_open
  FROM (SELECT COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) AS k
        FROM public.subscriptions s
        WHERE s.company_id = p_company_id AND s.status IN ('pending_payment', 'pending_review', 'active')
          AND (s.end_date IS NULL OR s.end_date >= public.cairo_today())) o;

  IF p_terms IS NOT NULL AND jsonb_array_length(p_terms) > 0 THEN
    BEGIN
      PERFORM public.copy_default_terms(p_company_id);
      UPDATE public.company_terms t
      SET start_month = COALESCE(x.start_month, t.start_month), start_day = COALESCE(x.start_day, t.start_day),
          end_month = COALESCE(x.end_month, t.end_month), end_day = COALESCE(x.end_day, t.end_day)
      FROM jsonb_to_recordset(p_terms) AS x(code text, start_month int, start_day int, end_month int, end_day int)
      WHERE t.company_id = p_company_id AND t.code = x.code;
      PERFORM public.assert_terms_valid(p_company_id);

      SELECT COALESCE(jsonb_object_agg(code, n), '{}'::jsonb), COALESCE(sum(n), 0)::int INTO v_moved, v_total
      FROM (SELECT x.period_code AS code, count(*) AS n
            FROM public.subscriptions x
            CROSS JOIN LATERAL public.company_periods(p_company_id, x.academic_year) p
            WHERE x.company_id = p_company_id AND p.period_code = x.period_code
              AND x.status IN ('pending_payment', 'pending_review', 'active')
              AND (x.start_date IS DISTINCT FROM p.start_date OR x.end_date IS DISTINCT FROM p.end_date)
            GROUP BY x.period_code) c;
      -- Nothing of the trial may stay: undo it.
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'basak.terms_impact.rollback';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'basak.terms_impact.rollback' THEN RAISE; END IF;
    END;
  END IF;

  RETURN jsonb_build_object('moved', v_moved, 'moved_total', v_total, 'open', v_open);
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. The subscription-periods page, saved at once
-- ------------------------------------------------------------------------------
-- Every argument is optional (NULL = leave as it is). Runs the existing
-- functions, so every check and message is theirs; one transaction, so a
-- refusal of any part leaves all of it unsaved.
CREATE OR REPLACE FUNCTION public.save_company_subscription_settings(
  p_company_id uuid, p_terms jsonb DEFAULT NULL, p_on_sale jsonb DEFAULT NULL, p_advance boolean DEFAULT NULL,
  p_annual boolean DEFAULT NULL, p_daily boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_terms jsonb;
  v_sale jsonb;
  v_annual jsonb;
  v_daily jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل إعدادات هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF p_terms IS NOT NULL AND jsonb_typeof(p_terms) = 'array' AND jsonb_array_length(p_terms) > 0 THEN
    v_terms := public.save_company_terms(p_company_id, p_terms);
  END IF;
  IF p_on_sale IS NOT NULL OR p_advance IS NOT NULL THEN
    v_sale := public.set_company_sale_settings(p_company_id, p_advance, p_on_sale);
  END IF;
  IF p_annual IS NOT NULL THEN v_annual := public.set_annual_subscription(p_annual, p_company_id); END IF;
  IF p_daily IS NOT NULL THEN v_daily := public.set_daily_subscription(p_daily, p_company_id); END IF;
  RETURN jsonb_build_object(
    'moved_subscriptions', COALESCE((v_terms->>'moved_subscriptions')::int, 0),
    'advance_enabled', (SELECT c.advance_subscription_enabled FROM public.companies c WHERE c.id = p_company_id),
    'on_sale', (SELECT jsonb_object_agg(t.code, t.is_on_sale) FROM public.company_terms t WHERE t.company_id = p_company_id),
    'annual_company', (SELECT c.annual_subscription_enabled FROM public.companies c WHERE c.id = p_company_id),
    'annual_effective', public.annual_subscription_enabled(p_company_id),
    'daily_company', (SELECT c.daily_subscription_enabled FROM public.companies c WHERE c.id = p_company_id),
    'daily_effective', public.daily_subscription_enabled(p_company_id));
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Payment methods in a new order, at once
-- ------------------------------------------------------------------------------
-- p_ids: every method of the company, in the order students should see them.
CREATE OR REPLACE FUNCTION public.reorder_payment_methods(p_company_id uuid, p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل وسائل دفع هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x)
     OR (SELECT array_agg(id ORDER BY id) FROM public.company_payment_methods WHERE company_id = p_company_id)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'تغيّرت وسائل الدفع منذ فتحت الصفحة. حدّث الصفحة ثم رتّبها من جديد.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.company_payment_methods m SET sort_order = o.pos - 1, updated_at = now()
  FROM unnest(p_ids) WITH ORDINALITY AS o(id, pos)
  WHERE m.id = o.id AND m.company_id = p_company_id AND m.sort_order IS DISTINCT FROM o.pos - 1;
  RETURN (SELECT jsonb_agg(jsonb_build_object('id', m.id, 'sort_order', m.sort_order) ORDER BY m.sort_order)
          FROM public.company_payment_methods m WHERE m.company_id = p_company_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. The reset log, with names
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_report_resets(p_company_id uuid, p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := CASE WHEN public.is_company_admin() THEN public.current_admin_company_id() ELSE p_company_id END;
BEGIN
  IF v_company IS NULL OR NOT public.can_manage_company(v_company) THEN
    RAISE EXCEPTION 'سجل التصفير متاح لإدارة الشركة فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'scope', r.scope, 'reset_at', r.reset_at, 'note', r.note, 'undone_at', r.undone_at,
      'company_id', r.company_id, 'reset_by_name', a.full_name, 'undone_by_name', u.full_name) ORDER BY r.reset_at DESC)
    FROM (SELECT * FROM public.report_resets
          WHERE company_id = v_company OR company_id IS NULL
          ORDER BY reset_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)) r
    LEFT JOIN public.admins a ON a.id = r.reset_by
    LEFT JOIN public.admins u ON u.id = r.undone_by), '[]'::jsonb);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. The report's rows carry the student's id (the definition is the live one
--    with `s.student_id` selected and returned; nothing else changes)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_subscription_report(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := NULLIF(p_filters->>'company_id', '')::uuid;
  v_university uuid := NULLIF(p_filters->>'university_id', '')::uuid;
  v_line uuid := NULLIF(p_filters->>'line_id', '')::uuid;
  v_year int := NULLIF(p_filters->>'academic_year', '')::int;
  -- first|second|both|summer|daily ('annual' is the older name of both)
  v_period text := NULLIF(replace(p_filters->>'period', 'annual', 'both'), '');
  v_payment text := NULLIF(p_filters->>'payment', '');      -- paid|unpaid
  v_phase text := NULLIF(p_filters->>'phase', '');          -- current|upcoming|expired
  v_search text := NULLIF(btrim(p_filters->>'search'), '');
  v_history boolean := COALESCE((p_filters->>'include_before_reset')::boolean, false);
  v_today date := public.cairo_today();
  v_limit int := LEAST(GREATEST(COALESCE(NULLIF(p_filters->>'limit', '')::int, 2000), 1), 2000);
  v_offset int := GREATEST(COALESCE(NULLIF(p_filters->>'offset', '')::int, 0), 0);
  v_data jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'التقارير المالية متاحة للإدارة فقط.' USING ERRCODE = '42501';
  END IF;
  IF public.is_company_admin() THEN v_company := public.current_admin_company_id(); END IF;
  IF v_company IS NOT NULL AND NOT public.can_manage_company(v_company) THEN
    RAISE EXCEPTION 'التقارير المالية متاحة للإدارة فقط.' USING ERRCODE = '42501';
  END IF;

  WITH baselines AS (
    SELECT c.id, c.name, public.report_baseline('financial', c.id) AS since FROM public.companies c
    WHERE v_company IS NULL OR c.id = v_company
  ),
  filtered AS (
    SELECT s.id, s.student_id, s.type, s.status, s.academic_year, s.period_code, s.price, s.paid_at, s.start_date, s.end_date,
      s.created_at, s.company_id, st.full_name, st.phone, st.university AS university_name,
      l.name AS line_name, b.name AS company_name,
      COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) AS period_key,
      CASE WHEN s.status = 'expired' OR s.end_date < v_today THEN 'expired'
           WHEN s.start_date > v_today THEN 'upcoming' ELSE 'current' END AS phase,
      (s.paid_at IS NOT NULL) AS is_paid,
      CASE WHEN s.paid_at IS NOT NULL THEN COALESCE(a.amount, s.price) END AS paid_amount
    FROM public.subscriptions s
    JOIN public.students st ON st.id = s.student_id
    JOIN public.lines l ON l.id = s.line_id
    JOIN baselines b ON b.id = l.company_id
    LEFT JOIN (SELECT DISTINCT ON (r.subscription_id) r.subscription_id, r.amount
               FROM public.receipts r WHERE r.status = 'approved' AND (v_company IS NULL OR r.company_id = v_company)
               ORDER BY r.subscription_id, r.reviewed_at DESC NULLS LAST) a ON a.subscription_id = s.id
    WHERE (v_company IS NULL OR s.company_id = v_company)
      AND (v_university IS NULL OR st.university_id = v_university)
      AND (v_line IS NULL OR s.line_id = v_line)
      AND (v_year IS NULL OR s.academic_year = v_year)
      AND (v_search IS NULL OR st.full_name ILIKE '%' || v_search || '%' OR st.phone LIKE '%' || regexp_replace(v_search, '\D', '', 'g') || '%')
      AND (v_history OR b.since IS NULL OR COALESCE(s.paid_at, s.created_at) > b.since)
      AND (v_period IS NULL OR COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) = v_period)
      AND (v_payment IS NULL OR (v_payment = 'paid') = (s.paid_at IS NOT NULL))
      AND (v_phase IS NULL OR v_phase = CASE WHEN s.status = 'expired' OR s.end_date < v_today THEN 'expired'
                                             WHEN s.start_date > v_today THEN 'upcoming' ELSE 'current' END)
  ),
  totals AS (
    SELECT count(*) AS n,
      count(*) FILTER (WHERE is_paid) AS paid,
      count(*) FILTER (WHERE NOT is_paid AND status IN ('pending_payment', 'pending_review', 'rejected')) AS unpaid,
      count(*) FILTER (WHERE phase = 'upcoming') AS upcoming,
      count(*) FILTER (WHERE phase = 'upcoming' AND is_paid) AS upcoming_paid,
      count(*) FILTER (WHERE phase = 'expired') AS expired,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid), 0) AS revenue,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid AND period_key = 'first'), 0) AS revenue_first,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid AND period_key = 'second'), 0) AS revenue_second,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid AND period_key = 'summer'), 0) AS revenue_summer,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid AND period_key = 'both'), 0) AS revenue_both,
      COALESCE(sum(paid_amount) FILTER (WHERE is_paid AND period_key = 'daily'), 0) AS revenue_daily
    FROM filtered
  ),
  shown AS (
    SELECT * FROM filtered ORDER BY paid_at DESC NULLS LAST, created_at DESC, id LIMIT v_limit OFFSET v_offset
  ),
  labels AS (
    SELECT k.company_id, k.academic_year, p.period_code, p.label
    FROM (SELECT DISTINCT company_id, academic_year FROM shown WHERE type <> 'daily') k
    CROSS JOIN LATERAL public.company_periods(k.company_id, k.academic_year) p
  )
  SELECT jsonb_build_object(
    'baseline', (SELECT max(since) FROM baselines),
    'rows_total', (SELECT n FROM totals),
    'totals', (SELECT jsonb_build_object(
      'count', n, 'paid', paid, 'unpaid', unpaid, 'upcoming', upcoming, 'upcoming_paid', upcoming_paid,
      'expired', expired, 'revenue', revenue, 'revenue_first', revenue_first, 'revenue_second', revenue_second,
      'revenue_summer', revenue_summer, 'revenue_both', revenue_both, 'revenue_annual', revenue_both,
      'revenue_daily', revenue_daily) FROM totals),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'student_id', f.student_id, 'student_name', f.full_name, 'phone', f.phone, 'university', f.university_name,
        'company', f.company_name, 'line', f.line_name, 'type', f.type, 'period', f.period_key,
        'academic_year', f.academic_year,
        'label', CASE WHEN f.type = 'daily' THEN 'اشتراك يومي'
                      ELSE (SELECT lb.label FROM labels lb WHERE lb.company_id = f.company_id
                              AND lb.academic_year = f.academic_year AND lb.period_code = f.period_code) END,
        'status', f.status, 'phase', f.phase, 'paid', f.is_paid, 'amount', f.paid_amount, 'price', f.price,
        'paid_at', f.paid_at, 'start_date', f.start_date, 'end_date', f.end_date,
        'payment_method', (SELECT pm.display_name FROM public.receipts r
                           JOIN public.company_payment_methods pm ON pm.id = r.payment_method_id
                           WHERE r.subscription_id = f.id ORDER BY r.created_at DESC LIMIT 1),
        'receipt_no', x.receipt_no, 'receipt_code', x.receipt_code)
        ORDER BY f.paid_at DESC NULLS LAST, f.created_at DESC, f.id)
      FROM shown f LEFT JOIN public.subscription_receipts x ON x.subscription_id = f.id), '[]'::jsonb)
  ) INTO v_data;
  RETURN v_data;
END;
$$;

REVOKE ALL ON FUNCTION public.company_revenue_breakdown(uuid, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_terms_impact(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_company_subscription_settings(uuid, jsonb, jsonb, boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reorder_payment_methods(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_report_resets(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_subscription_report(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_revenue_breakdown(uuid, timestamptz, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_terms_impact(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_company_subscription_settings(uuid, jsonb, jsonb, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_payment_methods(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.company_report_resets(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_subscription_report(jsonb) TO authenticated;

COMMIT;
