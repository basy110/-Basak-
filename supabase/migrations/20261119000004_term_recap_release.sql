-- ==============================================================================
-- Migration: 20261119000004_term_recap_release.sql
-- Run AFTER 20261107000001 (get_my_term_recap) and 20261101000001 (platform
-- notifications). Safe to re-run. Additive: one table, four functions, and
-- get_my_term_recap answers two more keys.
--
-- The platform owner publishes the end-of-term recap for everyone. Until now the
-- app showed it by dates alone; now Home also waits for this switch.
--
-- term_recap_releases: one row per term (academic_year = the year the academic
-- year starts, as in company_periods: 2026 = 2026/2027; period_code first /
-- second / summer). Published = published_at set and unpublished_at empty.
-- Everyone signed in may read it; it is written only through the functions.
--
-- platform_publish_term_recap(p_year, p_period, p_message)
--   Super admin only (42501). Publishes (or publishes again) and, the first
--   time only, sends one notification per active company to its students, as
--   «إشعار من المنصة» does (type announcement.platform), with
--   data = {"route": "recap", "academic_year": "2026", "period_code": "first"}.
--   Answers the release: {academic_year, period_code, published, published_at,
--   published_by_name, unpublished_at, message, notified_at, notified_companies,
--   notified_students, notified_now}.
-- platform_unpublish_term_recap(p_year, p_period)
--   Super admin only. Home stops showing the banner; nothing is sent. Same answer.
-- platform_term_recap_overview(p_year DEFAULT NULL, p_period DEFAULT NULL)
--   Super admin only. The whole platform's term, counted as get_my_term_recap
--   counts one student (a ride = a day with is_riding, from the term's start to
--   the earlier of its end and today, in each company's own dates for that
--   term; a boarding = a checked-in scan on a ride day, per direction; the line
--   and stop of a ride = its subscription's). No year/period: the term whose
--   banner window is open today, else the last that started.
--   {today, term {academic_year, period_code, name, label, start_date, end_date,
--    until, window_opens, window_closes}, options [{academic_year, period_code,
--    label, start_date, end_date, published}], release {…as above} | null,
--    reach {companies, students},
--    totals {students, ride_days, return_days, boardings, companies, lines,
--            stations, universities, median_ride_days},
--    top_stations [{id, name, line_name, company_name, students, ride_days}],
--    top_lines [{id, name, company_name, students, ride_days}],
--    top_universities [{name, students, ride_days}],
--    companies [{id, name, students, ride_days, boardings}]}
-- get_my_term_recap(): unchanged, plus `published` (boolean) and
--   `published_message` (text | null) for the student's term.
-- ==============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The releases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.term_recap_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year integer NOT NULL CHECK (academic_year BETWEEN 2000 AND 2100),
  period_code text NOT NULL CHECK (period_code IN ('first', 'second', 'summer')),
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unpublished_at timestamptz,
  unpublished_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 600),
  -- The notification goes out once per term, however often it is published again.
  notified_at timestamptz,
  notified_companies integer,
  notified_students integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (academic_year, period_code)
);
ALTER TABLE public.term_recap_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.term_recap_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.term_recap_releases TO authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'term_recap_releases'
                 AND policyname = 'term_recap_releases_read') THEN
    CREATE POLICY term_recap_releases_read ON public.term_recap_releases FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- The release as the dashboard shows it.
CREATE OR REPLACE FUNCTION public.term_recap_release_json(p_row public.term_recap_releases, p_now boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_row.id IS NULL THEN NULL ELSE jsonb_build_object(
    'academic_year', p_row.academic_year, 'period_code', p_row.period_code,
    'published', p_row.published_at IS NOT NULL AND p_row.unpublished_at IS NULL,
    'published_at', p_row.published_at,
    'published_by_name', (SELECT a.full_name FROM public.admins a WHERE a.id = p_row.published_by),
    'unpublished_at', p_row.unpublished_at, 'message', p_row.message,
    'notified_at', p_row.notified_at, 'notified_companies', p_row.notified_companies,
    'notified_students', p_row.notified_students, 'notified_now', p_now) END
$$;
REVOKE ALL ON FUNCTION public.term_recap_release_json(public.term_recap_releases, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.term_recap_assert_term(p_year integer, p_period text) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 OR p_period IS NULL OR p_period NOT IN ('first', 'second', 'summer') THEN
    RAISE EXCEPTION 'اختر الفصل الدراسي والعام.' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.term_recap_assert_term(integer, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Publish / stop
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_publish_term_recap(p_year integer, p_period text, p_message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_message text := NULLIF(btrim(COALESCE(p_message, '')), '');
  v_row public.term_recap_releases%ROWTYPE;
  v_term text;
  v_body text;
  v_company uuid;
  v_spec jsonb;
  v_id uuid;
  v_duplicate boolean;
  v_count integer;
  v_companies integer := 0;
  v_students integer := 0;
BEGIN
  IF v_me IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.term_recap_assert_term(p_year, p_period);
  IF char_length(COALESCE(v_message, '')) > 600 THEN
    RAISE EXCEPTION 'الرسالة طويلة (600 حرف على الأكثر).' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.term_recap_releases AS r (academic_year, period_code, published_at, published_by, message)
  VALUES (p_year, p_period, now(), v_me, v_message)
  ON CONFLICT (academic_year, period_code) DO UPDATE SET
    -- Already out: it stays out since then; only the message changes.
    published_at = CASE WHEN r.published_at IS NOT NULL AND r.unpublished_at IS NULL THEN r.published_at ELSE now() END,
    published_by = CASE WHEN r.published_at IS NOT NULL AND r.unpublished_at IS NULL THEN r.published_by ELSE v_me END,
    unpublished_at = NULL, unpublished_by = NULL, message = EXCLUDED.message, updated_at = now()
  RETURNING * INTO v_row;

  IF v_row.notified_at IS NOT NULL THEN
    RETURN public.term_recap_release_json(v_row, false);
  END IF;

  SELECT p.label INTO v_term FROM public.company_periods(NULL, p_year) p
  WHERE p.period_code = p_period AND p.subscription_type = 'termly';
  v_body := COALESCE(v_message, 'افتح التطبيق لترى ملخص ' || COALESCE(v_term, 'الفصل') || ': أيام ركوبك ومحطتك ولقبك هذا الفصل.');

  -- As platform_compose_notification: one notification per active company that
  -- has students to receive it.
  FOR v_company IN SELECT c FROM public.platform_notification_companies(NULL) c LOOP
    SELECT count(*) INTO v_count
    FROM public.notification_audience_users(v_company, '{"kind": "company"}'::jsonb, v_me) u WHERE u.is_student;
    CONTINUE WHEN v_count = 0;
    v_spec := public.notification_audience_resolve(v_company, '{"kind": "company"}'::jsonb, public.cairo_today());
    SELECT o_id, o_duplicate INTO v_id, v_duplicate FROM public.notification_create(
      v_company, v_me, 'admin', 'منصة باصك', 'announcement.platform', 'announcement', 'normal',
      'ملخص فصلك جاهز', v_body, NULL, NULL, v_spec,
      jsonb_build_object('route', 'recap', 'academic_year', p_year::text, 'period_code', p_period),
      NULL, 'term_recap:' || p_year || ':' || p_period);
    v_companies := v_companies + 1;
    v_students := v_students + v_count;
    CONTINUE WHEN v_duplicate;
    PERFORM public.notification_deliver(v_id);
    INSERT INTO public.notification_audit(company_id, actor_id, actor_role, action, notification_id, detail)
    VALUES (v_company, v_me, 'platform', 'send', v_id,
            jsonb_build_object('students', v_count, 'term_recap', jsonb_build_object('academic_year', p_year, 'period_code', p_period)));
  END LOOP;

  UPDATE public.term_recap_releases
  SET notified_at = now(), notified_companies = v_companies, notified_students = v_students
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN public.term_recap_release_json(v_row, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_unpublish_term_recap(p_year integer, p_period text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_row public.term_recap_releases%ROWTYPE;
BEGIN
  IF v_me IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.term_recap_assert_term(p_year, p_period);
  UPDATE public.term_recap_releases
  SET unpublished_at = COALESCE(unpublished_at, now()), unpublished_by = COALESCE(unpublished_by, v_me), updated_at = now()
  WHERE academic_year = p_year AND period_code = p_period AND published_at IS NOT NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ملخص هذا الفصل غير منشور.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.term_recap_release_json(v_row, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The platform's term in numbers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_term_recap_overview(p_year integer DEFAULT NULL, p_period text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_y integer := extract(year FROM public.cairo_today())::integer;
  v_year integer := p_year;
  v_period text := p_period;
  v_term record;
  v_release public.term_recap_releases%ROWTYPE;
  v_out jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  IF v_year IS NULL OR v_period IS NULL THEN
    -- The term whose banner window is open today, else the last that started.
    SELECT p.academic_year, p.period_code INTO v_year, v_period
    FROM (SELECT * FROM public.company_periods(NULL, v_y - 1)
          UNION ALL SELECT * FROM public.company_periods(NULL, v_y)) p
    WHERE p.subscription_type = 'termly' AND p.start_date <= v_today
    ORDER BY (v_today BETWEEN p.end_date - 14 AND p.end_date + 28) DESC, p.start_date DESC
    LIMIT 1;
    IF v_year IS NULL THEN
      v_year := v_y - 1;
      v_period := 'first';
    END IF;
  END IF;
  PERFORM public.term_recap_assert_term(v_year, v_period);

  SELECT p.name, p.label, p.start_date, p.end_date INTO v_term
  FROM public.company_periods(NULL, v_year) p
  WHERE p.period_code = v_period AND p.subscription_type = 'termly';
  SELECT * INTO v_release FROM public.term_recap_releases WHERE academic_year = v_year AND period_code = v_period;

  WITH term AS (
    -- Each company's own dates for this term.
    SELECT c.id AS company_id, c.name AS company_name, p.start_date AS s, LEAST(p.end_date, v_today) AS u
    FROM public.companies c
    CROSS JOIN LATERAL public.company_periods(c.id, v_year) p
    WHERE p.period_code = v_period AND p.subscription_type = 'termly' AND p.start_date <= v_today
  ),
  rides AS (
    SELECT DISTINCT ON (drs.student_id, drs.ride_date)
           drs.student_id, drs.ride_date, drs.company_id, drs.subscription_id, drs.is_returning
    FROM public.daily_ride_status drs
    JOIN term t ON t.company_id = drs.company_id AND drs.ride_date BETWEEN t.s AND t.u
    WHERE drs.is_riding
    ORDER BY drs.student_id, drs.ride_date, drs.subscription_id NULLS LAST
  ),
  -- The subscription a ride was made under, as get_my_term_recap picks it.
  placed AS (
    SELECT DISTINCT ON (r.student_id, r.ride_date)
           r.student_id, r.ride_date, r.company_id, x.line_id, x.station_id
    FROM rides r
    LEFT JOIN public.subscriptions x
      ON x.student_id = r.student_id
     AND (x.id = r.subscription_id
          OR (x.status IN ('active', 'expired') AND x.company_id = r.company_id
              AND COALESCE(x.start_date, r.ride_date) <= r.ride_date
              AND COALESCE(x.end_date, r.ride_date) >= r.ride_date))
    ORDER BY r.student_id, r.ride_date, (x.id = r.subscription_id) DESC NULLS LAST, x.created_at DESC
  ),
  boards AS (
    SELECT DISTINCT e.student_id, e.ride_date, e.direction, e.company_id
    FROM public.supervisor_scan_events e
    JOIN term t ON t.company_id = e.company_id AND e.ride_date BETWEEN t.s AND t.u
    WHERE e.result = 'checked_in'
      AND EXISTS (SELECT 1 FROM rides r WHERE r.student_id = e.student_id AND r.ride_date = e.ride_date)
  ),
  per_student AS (SELECT student_id, count(*) AS days FROM rides GROUP BY student_id),
  unis AS (
    SELECT COALESCE(u.name, NULLIF(btrim(s.university), '')) AS name,
           count(DISTINCT r.student_id) AS students, count(*) AS ride_days
    FROM rides r
    JOIN public.students s ON s.id = r.student_id
    LEFT JOIN public.universities u ON u.id = s.university_id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'students', (SELECT count(*) FROM per_student),
      'ride_days', (SELECT count(*) FROM rides),
      'return_days', (SELECT count(*) FROM rides WHERE is_returning),
      'boardings', (SELECT count(*) FROM boards),
      'companies', (SELECT count(DISTINCT company_id) FROM rides),
      'lines', (SELECT count(DISTINCT line_id) FROM placed),
      'stations', (SELECT count(DISTINCT station_id) FROM placed),
      'universities', (SELECT count(*) FROM unis WHERE name IS NOT NULL),
      'median_ride_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::integer FROM per_student)),
    'top_stations', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ride_days DESC, x.name) FROM (
        SELECT st.id, st.name, l.name AS line_name, c.name AS company_name,
               count(DISTINCT p.student_id) AS students, count(*) AS ride_days
        FROM placed p
        JOIN public.stations st ON st.id = p.station_id
        LEFT JOIN public.lines l ON l.id = st.line_id
        LEFT JOIN public.companies c ON c.id = l.company_id
        GROUP BY st.id, st.name, l.name, c.name
        ORDER BY count(*) DESC, st.name LIMIT 5) x), '[]'::jsonb),
    'top_lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ride_days DESC, x.name) FROM (
        SELECT l.id, l.name, c.name AS company_name,
               count(DISTINCT p.student_id) AS students, count(*) AS ride_days
        FROM placed p
        JOIN public.lines l ON l.id = p.line_id
        LEFT JOIN public.companies c ON c.id = l.company_id
        GROUP BY l.id, l.name, c.name
        ORDER BY count(*) DESC, l.name LIMIT 5) x), '[]'::jsonb),
    'top_universities', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.students DESC, x.name) FROM (
        SELECT name, students, ride_days FROM unis WHERE name IS NOT NULL
        ORDER BY students DESC, name LIMIT 5) x), '[]'::jsonb),
    'companies', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ride_days DESC, x.name) FROM (
        SELECT t.company_id AS id, t.company_name AS name,
               (SELECT count(DISTINCT r.student_id) FROM rides r WHERE r.company_id = t.company_id) AS students,
               (SELECT count(*) FROM rides r WHERE r.company_id = t.company_id) AS ride_days,
               (SELECT count(*) FROM boards b WHERE b.company_id = t.company_id) AS boardings
        FROM term t) x WHERE x.ride_days > 0), '[]'::jsonb))
  INTO v_out;

  RETURN v_out || jsonb_build_object(
    'today', v_today,
    'term', jsonb_build_object(
      'academic_year', v_year, 'period_code', v_period, 'name', v_term.name, 'label', v_term.label,
      'start_date', v_term.start_date, 'end_date', v_term.end_date,
      'until', LEAST(v_term.end_date, v_today),
      'window_opens', v_term.end_date - 14, 'window_closes', v_term.end_date + 28),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'academic_year', o.academic_year, 'period_code', o.period_code, 'label', o.label,
               'start_date', o.start_date, 'end_date', o.end_date,
               'published', EXISTS (SELECT 1 FROM public.term_recap_releases r
                                    WHERE r.academic_year = o.academic_year AND r.period_code = o.period_code
                                      AND r.published_at IS NOT NULL AND r.unpublished_at IS NULL))
             ORDER BY o.start_date DESC)
      FROM (SELECT * FROM public.company_periods(NULL, v_y - 2)
            UNION ALL SELECT * FROM public.company_periods(NULL, v_y - 1)
            UNION ALL SELECT * FROM public.company_periods(NULL, v_y)) o
      WHERE o.subscription_type = 'termly' AND (o.start_date <= v_today OR (o.academic_year = v_year AND o.period_code = v_period))),
      '[]'::jsonb),
    'release', public.term_recap_release_json(v_release, false),
    'reach', (
      SELECT jsonb_build_object('companies', count(DISTINCT c.id), 'students', count(DISTINCT u.user_id))
      FROM public.platform_notification_companies(NULL) c(id),
           LATERAL public.notification_audience_users(c.id, '{"kind": "company"}'::jsonb, auth.uid()) u
      WHERE u.is_student));
END;
$$;

REVOKE ALL ON FUNCTION public.platform_publish_term_recap(integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_unpublish_term_recap(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_term_recap_overview(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_publish_term_recap(integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_unpublish_term_recap(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_term_recap_overview(integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_my_term_recap: as 20261107000001, plus `published` / `published_message`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_term_recap(
  p_subscription_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := auth.uid();
  v_today date := public.cairo_today();
  v_year integer := extract(year FROM public.cairo_today())::integer;
  v_student public.students%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_company uuid;
  v_term_code text;
  v_term_year integer;
  v_term_name text;
  v_term_label text;
  v_term_start date;
  v_term_end date;
  v_from date;
  v_to date;
  v_until date;
  v_rides jsonb;
  v_line uuid;
  v_station uuid;
  v_typical integer;
  v_off_weekdays integer[];
  v_off_dates date[];
  v_release public.term_recap_releases%ROWTYPE;
  v_published boolean;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'متاح للطلاب فقط.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_student FROM public.students WHERE id = v_me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'متاح للطلاب فقط.' USING ERRCODE = '42501';
  END IF;

  -- ---- the subscription the recap is about -------------------------------
  IF p_subscription_id IS NOT NULL THEN
    SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id AND student_id = v_me;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الاشتراك غير موجود.' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT sub.* INTO v_sub
    FROM public.subscriptions sub
    WHERE sub.student_id = v_me AND sub.status IN ('active', 'expired') AND sub.type <> 'daily'
      AND COALESCE(sub.start_date, v_today) <= v_today
    ORDER BY (sub.status = 'active') DESC, sub.start_date DESC NULLS LAST, sub.created_at DESC
    LIMIT 1;
  END IF;
  v_company := v_sub.company_id;
  IF v_company IS NULL THEN
    SELECT drs.company_id INTO v_company
    FROM public.daily_ride_status drs
    WHERE drs.student_id = v_me AND drs.is_riding
    ORDER BY drs.ride_date DESC LIMIT 1;
  END IF;

  -- ---- the term ----------------------------------------------------------
  -- A semester subscription: its own semester. Both semesters: the one that is
  -- running, else the last that started, else the first.
  IF v_sub.id IS NOT NULL AND v_sub.period_code IS NOT NULL AND v_sub.academic_year IS NOT NULL THEN
    SELECT p.period_code, p.academic_year, p.name, p.label, p.start_date, p.end_date
    INTO v_term_code, v_term_year, v_term_name, v_term_label, v_term_start, v_term_end
    FROM public.company_periods(v_sub.company_id, v_sub.academic_year) p
    WHERE p.subscription_type = 'termly'
      AND (p.period_code = v_sub.period_code
           OR (v_sub.period_code NOT IN ('first', 'second', 'summer') AND p.period_code IN ('first', 'second')))
    ORDER BY (p.start_date <= v_today) DESC,
             CASE WHEN p.start_date <= v_today THEN p.start_date END DESC NULLS LAST,
             p.start_date
    LIMIT 1;
  END IF;
  -- No such subscription: the company's (or the platform's) term by the calendar.
  IF v_term_start IS NULL THEN
    SELECT p.period_code, p.academic_year, p.name, p.label, p.start_date, p.end_date
    INTO v_term_code, v_term_year, v_term_name, v_term_label, v_term_start, v_term_end
    FROM (SELECT * FROM public.company_periods(v_company, v_year - 1)
          UNION ALL
          SELECT * FROM public.company_periods(v_company, v_year)) p
    WHERE p.subscription_type = 'termly' AND p.start_date <= v_today
    ORDER BY p.start_date DESC
    LIMIT 1;
  END IF;

  v_from := COALESCE(p_from, v_term_start, v_today - 120);
  v_to := COALESCE(p_to, v_term_end, v_today);
  IF v_to < v_from OR v_to - v_from > 400 THEN
    RAISE EXCEPTION 'الفترة غير صحيحة.' USING ERRCODE = '22023';
  END IF;
  v_until := LEAST(v_to, v_today);

  -- ---- the ride days -----------------------------------------------------
  -- One row per day the student confirmed a ride, with the subscription it was
  -- made under (the one recorded with it, else the one valid that day with the
  -- same company, so a ride is never put on another company's line). The
  -- times are the ones chosen for the day, else the subscription's.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', r.ride_date,
           'weekday', extract(isodow FROM r.ride_date)::integer,
           'departure_time', left(r.dep_time::text, 5),
           'return_time', left(r.ret_time::text, 5),
           'returns_by_bus', r.is_returning,
           'line_id', r.line_id,
           'station_id', r.station_id,
           'departure_minutes', r.departure_minutes,
           'boarded_departure', r.boarded_departure,
           'boarded_return', r.boarded_return)
         ORDER BY r.ride_date), '[]'::jsonb)
  INTO v_rides
  FROM (
    SELECT drs.ride_date, drs.is_returning, s.line_id, s.station_id,
           COALESCE(drs.departure_time, s.departure_time) AS dep_time,
           CASE WHEN drs.is_returning THEN COALESCE(drs.return_time, s.return_time) END AS ret_time,
           (SELECT (extract(epoch FROM (t.arrival_time - ts.stop_time)) / 60)::integer
            FROM public.line_trips t
            JOIN public.line_trip_stops ts ON ts.trip_id = t.id AND ts.station_id = s.station_id
            WHERE t.line_id = s.line_id AND t.direction = 'departure'
              AND ts.stop_time = COALESCE(drs.departure_time, s.departure_time)
              AND t.arrival_time > ts.stop_time
              AND (t.university_id IS NULL OR t.university_id = v_student.university_id)
            ORDER BY t.is_active DESC, t.university_id NULLS LAST, t.start_time
            LIMIT 1) AS departure_minutes,
           EXISTS (SELECT 1 FROM public.supervisor_scan_events e
                   WHERE e.student_id = v_me AND e.ride_date = drs.ride_date
                     AND e.direction = 'departure' AND e.result = 'checked_in') AS boarded_departure,
           EXISTS (SELECT 1 FROM public.supervisor_scan_events e
                   WHERE e.student_id = v_me AND e.ride_date = drs.ride_date
                     AND e.direction = 'return' AND e.result = 'checked_in') AS boarded_return
    FROM public.daily_ride_status drs
    LEFT JOIN LATERAL (
      SELECT x.id, x.line_id, x.station_id, x.departure_time, x.return_time
      FROM public.subscriptions x
      WHERE x.student_id = v_me
        AND (x.id = drs.subscription_id
             OR (x.status IN ('active', 'expired') AND x.company_id = drs.company_id
                 AND COALESCE(x.start_date, drs.ride_date) <= drs.ride_date
                 AND COALESCE(x.end_date, drs.ride_date) >= drs.ride_date))
      ORDER BY (x.id = drs.subscription_id) DESC NULLS LAST, x.created_at DESC
      LIMIT 1
    ) s ON true
    WHERE drs.student_id = v_me AND drs.is_riding AND drs.ride_date BETWEEN v_from AND v_until
  ) r;

  -- ---- the most used line and stop (a tie: the one used first) ------------
  SELECT (x->>'line_id')::uuid, (x->>'station_id')::uuid
  INTO v_line, v_station
  FROM jsonb_array_elements(v_rides) x
  WHERE x->>'line_id' IS NOT NULL AND x->>'station_id' IS NOT NULL
  GROUP BY x->>'line_id', x->>'station_id'
  ORDER BY count(*) DESC, min(x->>'date')
  LIMIT 1;
  IF v_line IS NULL THEN
    v_line := v_sub.line_id;
    v_station := v_sub.station_id;
  END IF;
  v_company := COALESCE((SELECT l.company_id FROM public.lines l WHERE l.id = v_line), v_company);

  -- How long the way there takes from that stop: the average over the going
  -- trips that stop there and have an arrival time.
  SELECT round(avg(extract(epoch FROM (t.arrival_time - ts.stop_time)) / 60))::integer
  INTO v_typical
  FROM public.line_trips t
  JOIN public.line_trip_stops ts ON ts.trip_id = t.id AND ts.station_id = v_station
  WHERE t.line_id = v_line AND t.direction = 'departure' AND t.is_active
    AND t.arrival_time > ts.stop_time
    AND (t.university_id IS NULL OR t.university_id = v_student.university_id);

  SELECT d.off_weekdays, d.off_dates INTO v_off_weekdays, v_off_dates
  FROM public.vote_reminder_days(v_company) d;

  -- ---- published by the platform? ------------------------------------------
  SELECT * INTO v_release FROM public.term_recap_releases
  WHERE academic_year = v_term_year AND period_code = v_term_code;
  v_published := v_release.id IS NOT NULL AND v_release.published_at IS NOT NULL AND v_release.unpublished_at IS NULL;

  RETURN jsonb_build_object(
    'today', v_today,
    'student', jsonb_build_object(
      'full_name', v_student.full_name,
      'first_name', split_part(btrim(v_student.full_name), ' ', 1),
      'university', COALESCE((SELECT u.name FROM public.universities u WHERE u.id = v_student.university_id),
                             v_student.university),
      'college', NULLIF(NULLIF(btrim(COALESCE(v_student.college, '')), ''), 'غير محدد'),
      'specialisation', NULLIF(btrim(COALESCE(v_student.specialisation, '')), '')),
    'term', jsonb_build_object(
      'code', v_term_code, 'academic_year', v_term_year, 'name', v_term_name, 'label', v_term_label,
      'start_date', v_term_start, 'end_date', v_term_end),
    'range', jsonb_build_object('from', v_from, 'to', v_to, 'until', v_until),
    'subscription', CASE WHEN v_sub.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_sub.id, 'type', v_sub.type, 'status', v_sub.status, 'period_code', v_sub.period_code,
      'academic_year', v_sub.academic_year, 'start_date', v_sub.start_date, 'end_date', v_sub.end_date,
      'created_at', v_sub.created_at, 'paid_at', v_sub.paid_at) END,
    'rides', v_rides,
    'summary', (
      SELECT jsonb_build_object(
        'ride_days', count(*),
        'return_days', count(*) FILTER (WHERE (x->>'returns_by_bus')::boolean),
        'boarded_departures', count(*) FILTER (WHERE (x->>'boarded_departure')::boolean),
        'boarded_returns', count(*) FILTER (WHERE (x->>'boarded_return')::boolean),
        'first_ride_date', min(x->>'date'),
        'last_ride_date', max(x->>'date'))
      FROM jsonb_array_elements(v_rides) x),
    'line', (
      SELECT jsonb_build_object(
        'id', l.id, 'name', l.name, 'company_id', l.company_id, 'company_name', c.name,
        'stations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'order_index', st.order_index)
                           ORDER BY st.order_index, st.name)
          FROM public.stations st
          WHERE st.line_id = l.id AND (st.is_active OR st.id = v_station)), '[]'::jsonb))
      FROM public.lines l
      LEFT JOIN public.companies c ON c.id = l.company_id
      WHERE l.id = v_line),
    'stop', (
      SELECT jsonb_build_object(
        'id', st.id, 'name', st.name, 'order_index', st.order_index,
        'rides', (SELECT count(*) FROM jsonb_array_elements(v_rides) x WHERE x->>'station_id' = st.id::text),
        'stops_used', (SELECT count(DISTINCT x->>'station_id') FROM jsonb_array_elements(v_rides) x
                       WHERE x->>'station_id' IS NOT NULL))
      FROM public.stations st
      WHERE st.id = v_station),
    'timetable', jsonb_build_object(
      'departure_times', (
        SELECT COALESCE(jsonb_agg(left(q.at_time::text, 5) ORDER BY q.at_time), '[]'::jsonb)
        FROM (SELECT DISTINCT ts.stop_time AS at_time
              FROM public.line_trips t
              JOIN public.line_trip_stops ts ON ts.trip_id = t.id AND ts.station_id = v_station
              WHERE t.line_id = v_line AND t.direction = 'departure' AND t.is_active
                AND (t.university_id IS NULL OR t.university_id = v_student.university_id)) q),
      'return_times', (
        SELECT COALESCE(jsonb_agg(left(q.at_time::text, 5) ORDER BY q.at_time), '[]'::jsonb)
        FROM (SELECT DISTINCT t.start_time AS at_time
              FROM public.line_trips t
              WHERE t.line_id = v_line AND t.direction = 'return' AND t.is_active
                AND (t.university_id IS NULL OR t.university_id = v_student.university_id)) q)),
    'trip_length', jsonb_build_object('departure_minutes', v_typical, 'return_minutes', NULL),
    'off', jsonb_build_object(
      'weekdays', to_jsonb(COALESCE(v_off_weekdays, '{}'::integer[])),
      'dates', (SELECT COALESCE(jsonb_agg(d ORDER BY d), '[]'::jsonb)
                FROM (SELECT DISTINCT d FROM unnest(COALESCE(v_off_dates, '{}'::date[])) d
                      WHERE d BETWEEN v_from AND v_to) y)),
    'published', v_published,
    'published_message', CASE WHEN v_published THEN v_release.message END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_term_recap(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_term_recap(uuid, date, date) TO authenticated;

COMMIT;
