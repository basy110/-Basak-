-- ==============================================================================
-- Migration: 20261116000003_admin_students.sql
--
-- The students pages of the redesigned dashboard (docs/canvas/AdmStudents*,
-- AdmStudent*, AdmPlatStudents*, AdmPlatCorrections*). Additive only: five new
-- functions; nothing that exists changes. get_company_students_page,
-- platform_students, decide_student_correction (which already takes p_note, the
-- reason of a refusal) and the direct subscription update stay as they are, so
-- the dashboard in production keeps working.
--
--   get_company_students_page_v2(company, search, status, line, university, sort,
--       limit, offset, student)  one page of the company's members with their
--       subscriptions to it, the status shown for each, the open name/university
--       corrections and password request, the total of the filter and the count
--       per status (the filter chips), in one request. `student` answers one member
--       (the page opened at ?student=<id> from the top bar's search).
--   admin_subscription_action(subscription, action)  the named moves that replace
--       the status select: activate (cash) · cancel · end · revert · reactivate,
--       each allowed only from the statuses that make sense. «قيد المراجعة» and
--       «إيصال مرفوض» are never set by hand.
--   platform_students_counts(search, company)  the three chips of «كل الطلاب».
--   platform_student_details(student)  one account: study, every membership with
--       its active subscriptions, the corrections waiting.
--   platform_correction_requests(status, limit)  the corrections queue with the
--       student, the company, who wrote it, and the companies the change reaches.
-- ==============================================================================

-- What a subscription is called on screen (ui/Status.tsx · STATUS).
CREATE OR REPLACE FUNCTION public.subscription_display_status(s public.subscriptions, p_today date)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN s.status = 'expired' OR s.end_date < p_today THEN 'ended'
    WHEN s.status = 'pending_review' THEN 'review'
    WHEN s.status = 'rejected' THEN 'rejected'
    WHEN s.status = 'pending_payment' THEN 'unpaid'
    WHEN s.status = 'active' AND s.start_date > p_today THEN 'soon'
    WHEN s.status = 'active' THEN 'active'
    ELSE 'ended'
  END
$$;

CREATE OR REPLACE FUNCTION public.get_company_students_page_v2(
  p_company_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_line_id uuid DEFAULT NULL,
  p_university_id uuid DEFAULT NULL,
  p_sort text DEFAULT 'newest',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_student_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_digits text := NULLIF(regexp_replace(translate(COALESCE(p_search, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_sort text := COALESCE(NULLIF(p_sort, ''), 'newest');
  v_rows jsonb;
  v_counts jsonb;
  v_total integer;
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك عرض طلاب هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'review', 'unpaid', 'rejected', 'soon', 'ended', 'none') THEN
    RAISE EXCEPTION 'حالة غير معروفة.' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('newest', 'oldest', 'name') THEN
    RAISE EXCEPTION 'ترتيب غير معروف.' USING ERRCODE = '22023';
  END IF;

  -- The members the search, line and university keep, each with the status of the
  -- subscription the list shows: an open one before an ended one, the current
  -- period before the next, the newest first; 'none' with no subscription at all.
  WITH members AS MATERIALIZED (
    SELECT st.id, st.full_name, m.joined_at, st.created_at,
           COALESCE((SELECT public.subscription_display_status(s, v_today)
                     FROM public.subscriptions s
                     WHERE s.student_id = st.id AND s.company_id = p_company_id
                     ORDER BY (public.subscription_display_status(s, v_today) = 'ended'),
                              (s.start_date > v_today) NULLS LAST, s.created_at DESC
                     LIMIT 1), 'none') AS shown
    FROM public.company_students m
    JOIN public.students st ON st.id = m.student_id
    WHERE m.company_id = p_company_id AND m.status = 'active'
      AND (p_student_id IS NULL OR st.id = p_student_id)
      AND (v_search IS NULL
           OR st.full_name ILIKE '%' || v_search || '%'
           OR st.university ILIKE '%' || v_search || '%'
           OR (v_digits IS NOT NULL AND st.phone LIKE '%' || v_digits || '%'))
      AND (p_university_id IS NULL OR st.university_id = p_university_id)
      AND (p_line_id IS NULL OR EXISTS (SELECT 1 FROM public.subscriptions s
                                        WHERE s.student_id = st.id AND s.company_id = p_company_id AND s.line_id = p_line_id))
  ), totals AS (
    SELECT jsonb_build_object(
             'all', count(*),
             'active', count(*) FILTER (WHERE shown = 'active'),
             'review', count(*) FILTER (WHERE shown = 'review'),
             'unpaid', count(*) FILTER (WHERE shown = 'unpaid'),
             'rejected', count(*) FILTER (WHERE shown = 'rejected'),
             'soon', count(*) FILTER (WHERE shown = 'soon'),
             'ended', count(*) FILTER (WHERE shown = 'ended'),
             'none', count(*) FILTER (WHERE shown = 'none')) AS counts,
           count(*) FILTER (WHERE v_status IS NULL OR shown = v_status) AS total
    FROM members
  ), page AS (
    SELECT mb.*, row_number() OVER (ORDER BY
      CASE WHEN v_sort = 'name' THEN mb.full_name END ASC,
      CASE WHEN v_sort = 'oldest' THEN COALESCE(mb.joined_at, mb.created_at) END ASC,
      CASE WHEN v_sort = 'newest' THEN COALESCE(mb.joined_at, mb.created_at) END DESC,
      mb.id) AS n
    FROM members mb
    WHERE v_status IS NULL OR mb.shown = v_status
    ORDER BY n
    LIMIT v_limit OFFSET v_offset
  )
  SELECT (SELECT counts FROM totals), (SELECT total FROM totals),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'id', st.id, 'phone', st.phone, 'full_name', st.full_name, 'university', st.university,
           'university_id', st.university_id, 'college', st.college, 'specialisation', st.specialisation,
           'profile_image_url', st.profile_image_url, 'created_at', st.created_at, 'joined_at', p.joined_at,
           'status', p.shown,
           'subscriptions', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', s.id, 'status', s.status, 'shown', public.subscription_display_status(s, v_today),
                      'type', s.type, 'price', s.price, 'created_at', s.created_at, 'paid_at', s.paid_at,
                      'start_date', s.start_date, 'end_date', s.end_date,
                      'period_label', public.period_label(s), 'period_phase', public.period_phase(s),
                      'departure_time', s.departure_time, 'return_time', s.return_time,
                      'line_id', s.line_id, 'line_name', l.name, 'station_name', sta.name,
                      'trip_label', t.label, 'trip_university', u.name)
                    ORDER BY s.created_at DESC)
             FROM public.subscriptions s
             LEFT JOIN public.lines l ON l.id = s.line_id
             LEFT JOIN public.stations sta ON sta.id = s.station_id
             LEFT JOIN public.line_trips t ON t.id = s.departure_trip_id
             LEFT JOIN public.universities u ON u.id = t.university_id
             WHERE s.student_id = st.id AND s.company_id = p_company_id), '[]'::jsonb),
           'corrections', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', r.id, 'field', r.field, 'old_value', r.old_value,
                                                 'new_value', r.new_value, 'created_at', r.created_at) ORDER BY r.created_at)
             FROM public.student_correction_requests r
             WHERE r.student_id = st.id AND r.company_id = p_company_id AND r.status = 'pending'), '[]'::jsonb),
           'open_reset', (
             SELECT jsonb_build_object('id', pr.id, 'status', pr.status, 'requested_at', pr.requested_at)
             FROM public.password_reset_requests pr
             WHERE pr.student_id = st.id AND pr.status IN ('pending', 'code_issued')
             ORDER BY pr.requested_at DESC LIMIT 1))
         ORDER BY p.n)
         FROM page p JOIN public.students st ON st.id = p.id), '[]'::jsonb)
  INTO v_counts, v_total, v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total, 'counts', v_counts,
                            'has_next', v_offset + v_limit < v_total);
END;
$$;

-- ------------------------------------------------------------------------------
-- The named moves of a subscription. Answers the row as the students list shows it.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_subscription_action(p_subscription_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  s public.subscriptions%ROWTYPE;
  v_next text;
BEGIN
  SELECT * INTO s FROM public.subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_company(s.company_id) THEN
    RAISE EXCEPTION 'الاشتراك غير موجود أو خارج صلاحياتك.' USING ERRCODE = '42501';
  END IF;

  v_next := CASE
    WHEN p_action = 'activate' AND s.status IN ('pending_payment', 'rejected') THEN 'active'
    WHEN p_action = 'cancel' AND s.status IN ('pending_payment', 'rejected') THEN 'expired'
    WHEN p_action = 'end' AND s.status = 'active' THEN 'expired'
    WHEN p_action = 'revert' AND s.status = 'active' THEN 'pending_payment'
    WHEN p_action = 'reactivate' AND s.status = 'expired' AND (s.end_date IS NULL OR s.end_date >= v_today) THEN 'active'
  END;
  IF p_action NOT IN ('activate', 'cancel', 'end', 'revert', 'reactivate') THEN
    RAISE EXCEPTION 'إجراء غير معروف.' USING ERRCODE = '22023';
  END IF;
  IF v_next IS NULL THEN
    IF s.status = 'pending_review' THEN
      RAISE EXCEPTION 'لهذا الاشتراك إيصال ينتظر المراجعة. قرّر فيه من صفحة الإيصالات.' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'تغيّرت حالة الاشتراك منذ فتحت الصفحة. حدّث الصفحة وحاول مرة أخرى.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    UPDATE public.subscriptions SET status = v_next WHERE id = p_subscription_id RETURNING * INTO s;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'للطالب اشتراك آخر مفتوح في الفترة نفسها، فلا يمكن تفعيل هذا.' USING ERRCODE = '23P01';
  END;

  RETURN jsonb_build_object(
    'id', s.id, 'status', s.status, 'shown', public.subscription_display_status(s, v_today),
    'start_date', s.start_date, 'end_date', s.end_date, 'paid_at', s.paid_at,
    'period_label', public.period_label(s), 'period_phase', public.period_phase(s));
END;
$$;

-- ------------------------------------------------------------------------------
-- Platform: the chips of «كل الطلاب».
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_students_counts(p_search text DEFAULT NULL, p_company_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_search text := NULLIF(btrim(p_search), '');
  v_digits text := regexp_replace(translate(COALESCE(p_search, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g');
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('all', count(*), 'none', count(*) FILTER (WHERE n = 0), 'multiple', count(*) FILTER (WHERE n > 1))
  INTO v_result
  FROM (
    SELECT (SELECT count(*) FROM public.company_students m WHERE m.student_id = s.id AND m.status = 'active') AS n
    FROM public.students s
    WHERE (v_search IS NULL OR s.full_name ILIKE '%' || v_search || '%' OR s.university ILIKE '%' || v_search || '%'
           OR (v_digits <> '' AND s.phone LIKE '%' || v_digits || '%'))
      AND (p_company_id IS NULL OR EXISTS (SELECT 1 FROM public.company_students m
                                           WHERE m.student_id = s.id AND m.company_id = p_company_id AND m.status = 'active'))
  ) x;
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- Platform: one account.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_student_details(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', st.id, 'full_name', st.full_name, 'phone', st.phone, 'university', st.university, 'college', st.college,
    'specialisation', st.specialisation, 'created_at', st.created_at,
    'active_subscriptions', (SELECT count(*) FROM public.subscriptions sub
                             WHERE sub.student_id = st.id AND sub.status = 'active'
                               AND (sub.end_date IS NULL OR sub.end_date >= v_today)),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'company_id', c.id, 'company', c.name, 'status', cs.status, 'joined_at', cs.joined_at, 'removed_at', cs.removed_at,
               'active_subscriptions', (SELECT count(*) FROM public.subscriptions sub
                                        WHERE sub.student_id = st.id AND sub.company_id = c.id AND sub.status = 'active'
                                          AND (sub.end_date IS NULL OR sub.end_date >= v_today)))
             ORDER BY cs.status, cs.joined_at)
      FROM public.company_students cs JOIN public.companies c ON c.id = cs.company_id
      WHERE cs.student_id = st.id), '[]'::jsonb),
    'corrections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'field', r.field, 'old_value', r.old_value, 'new_value', r.new_value,
                                          'created_at', r.created_at, 'company_id', r.company_id, 'company', c.name)
                       ORDER BY r.created_at)
      FROM public.student_correction_requests r LEFT JOIN public.companies c ON c.id = r.company_id
      WHERE r.student_id = st.id AND r.status = 'pending'), '[]'::jsonb))
  INTO v_result
  FROM public.students st WHERE st.id = p_student_id;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'الحساب غير موجود.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- Platform: the corrections queue, each with what the decision needs.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_correction_requests(p_status text DEFAULT 'pending', p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(row ORDER BY created_at), '[]'::jsonb) INTO v_result FROM (
    SELECT r.created_at, jsonb_build_object(
      'id', r.id, 'student_id', r.student_id, 'company_id', r.company_id, 'field', r.field,
      'old_value', r.old_value, 'new_value', r.new_value, 'note', r.note, 'status', r.status,
      'created_at', r.created_at, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
      'company', c.name, 'requested_by_name', a.full_name,
      'student_name', st.full_name, 'student_phone', st.phone,
      'student_companies', COALESCE((SELECT jsonb_agg(c2.name ORDER BY cs.joined_at)
                                     FROM public.company_students cs JOIN public.companies c2 ON c2.id = cs.company_id
                                     WHERE cs.student_id = r.student_id AND cs.status = 'active'), '[]'::jsonb),
      'active_subscriptions', (SELECT count(*) FROM public.subscriptions sub
                               WHERE sub.student_id = r.student_id AND sub.status = 'active'
                                 AND (sub.end_date IS NULL OR sub.end_date >= v_today))) AS row
    FROM public.student_correction_requests r
    LEFT JOIN public.companies c ON c.id = r.company_id
    LEFT JOIN public.admins a ON a.id = r.requested_by
    LEFT JOIN public.students st ON st.id = r.student_id
    WHERE p_status IS NULL OR r.status = p_status
    ORDER BY r.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
  ) x;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_display_status(public.subscriptions, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_students_page_v2(uuid, text, text, uuid, uuid, text, integer, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_subscription_action(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_students_counts(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_student_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_correction_requests(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscription_display_status(public.subscriptions, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_students_page_v2(uuid, text, text, uuid, uuid, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_subscription_action(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_students_counts(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_student_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_correction_requests(text, integer) TO authenticated;
