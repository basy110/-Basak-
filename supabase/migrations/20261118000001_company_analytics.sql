-- ==============================================================================
-- Migration: 20261118000001_company_analytics.sql
-- «التحليلات» (/c/:companyId/analytics): one read-only function that answers the
-- company owner's questions about the service in one request — who the students
-- are, where they board, how full each trip is, how students confirm and board,
-- money and receipts — plus rule-based recommendations computed from the same
-- numbers. Safe to re-run. Additive only: one new function; nothing changes.
--
-- company_analytics(p_company_id, p_from, p_to) → jsonb
--   p_from / p_to  Cairo calendar days, inclusive (NULL = from the beginning /
--                  up to today). Days after today are never counted.
--
-- Definitions
--   ride day       a day of the period on which at least one of the company's
--                  students confirmed riding (daily_ride_status.is_riding).
--   confirmed      a student riding that day, counted on the trip they chose
--                  (the same matching as rider_trip_choices_in: the trip that
--                  stops at their station at the time they chose, else the
--                  trip of their subscription).
--   boarded        distinct students checked in by a supervisor
--                  (supervisor_scan_events.result = 'checked_in').
--   subscriber     a paid subscription (paid_at set) that runs on the day:
--                  status 'active', or 'expired' that ended naturally
--                  (end_date before today; one ended early has no known end).
--   revenue        as company_revenue_breakdown: a paid subscription counts
--                  its approved receipt's amount, else its price, on the Cairo
--                  day it was paid.
--
-- Answer
--   period   {from, to, ride_days}
--   students {members, subscribers, new_members, never_subscribed, ending_soon,
--             by_university [{id, name, count, subscribers}],
--             by_college [{name, count}], by_specialisation [{name, count}],
--             by_station [{line_id, line_name, station_id, station_name, order_index, count}],
--             line_university [{line_id, line_name, university_id, university_name, count}],
--             unserved_universities [{id, name, members}]}
--   rides    {confirm_rate, avg_confirmed, avg_boarded, avg_subscribers}
--   trips    [{trip_id, line_id, line_name, direction, start_time, label, is_active,
--              subscribers, capacity, avg_riders, peak_riders, days_over,
--              avg_boarded, no_show, ride_days, active_days}]
--   lines    [{line_id, line_name, confirm_rate, ride_days, avg_subscribers}]
--   time_slots [{slot, riders}]      departure riders per 15 minutes, per ride day
--   weekdays [{dow, days, confirm_rate}]   dow 0 = Sunday
--   daily    [{date, confirmed, boarded, subscribers}]   the last 60 ride days
--   money    {revenue, paying, avg_per_student, unpaid_count, unpaid_amount,
--             by_month [{month, amount, count}], by_option [{option, amount, count}]}
--   receipts {approved, rejected, pending, median_review_hours,
--             reasons [{reason, count}], by_method [{method_id, name, approved, rejected}]}
--   insights [{key, severity 'act'|'watch'|'good', data}]
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.company_analytics(p_company_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_from date := p_from;
  v_to date;
  v_lo date;
  v_days date[];
  v_nd int;
  v_students jsonb;
  v_rides jsonb;
  v_money jsonb;
  v_receipts jsonb;
  v_insights jsonb;
  -- College / specialisation answers that say nothing.
  v_blank constant text[] := ARRAY['', '-', '--', '—', '.', '..', '?', '؟', 'n/a', 'na', 'none', 'null', 'لا يوجد', 'لا أعرف',
                                   'لا اعرف', 'غير محدد', 'غير محددة', 'غير معروف', 'غير معروفة', 'لم يحدد', 'لم تحدد'];
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'التحليلات متاحة لإدارة الشركة فقط.' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RAISE EXCEPTION 'بداية الفترة بعد نهايتها.' USING ERRCODE = '22023';
  END IF;
  v_to := LEAST(COALESCE(p_to, v_today), v_today);
  v_lo := COALESCE(v_from, '-infinity'::date);

  -- The ride days, by skipping through the (company_id, ride_date) index one day at a time.
  WITH RECURSIVE day_walk AS (
    (SELECT d.ride_date FROM public.daily_ride_status d
     WHERE d.company_id = p_company_id AND d.ride_date BETWEEN v_lo AND v_to ORDER BY d.ride_date LIMIT 1)
    UNION ALL
    SELECT (SELECT d.ride_date FROM public.daily_ride_status d
            WHERE d.company_id = p_company_id AND d.ride_date > w.ride_date AND d.ride_date <= v_to
            ORDER BY d.ride_date LIMIT 1)
    FROM day_walk w WHERE w.ride_date IS NOT NULL
  )
  SELECT COALESCE(array_agg(w.ride_date ORDER BY w.ride_date), '{}') INTO v_days
  FROM day_walk w
  WHERE w.ride_date IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.daily_ride_status d WHERE d.company_id = p_company_id AND d.ride_date = w.ride_date AND d.is_riding);
  v_nd := cardinality(v_days);

  -- ---------------------------------------------------------------- students
  WITH mem AS (
    SELECT cs.student_id, cs.joined_at, st.university_id, st.university AS utext,
      NULLIF(regexp_replace(btrim(COALESCE(st.college, '')), '\s+', ' ', 'g'), '') AS college,
      NULLIF(regexp_replace(btrim(COALESCE(st.specialisation, '')), '\s+', ' ', 'g'), '') AS spec
    FROM public.company_students cs JOIN public.students st ON st.id = cs.student_id
    WHERE cs.company_id = p_company_id AND cs.status = 'active'
  ),
  m AS (
    SELECT mem.*, CASE WHEN lower(COALESCE(college, '')) = ANY (v_blank) THEN NULL ELSE college END AS college_n,
                  CASE WHEN lower(COALESCE(spec, '')) = ANY (v_blank) THEN NULL ELSE spec END AS spec_n
    FROM mem
  ),
  running AS (
    SELECT DISTINCT s.student_id FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.status = 'active' AND s.paid_at IS NOT NULL
      AND COALESCE(s.start_date, v_today) <= v_today AND COALESCE(s.end_date, v_today) >= v_today
  ),
  paid_ever AS (
    SELECT DISTINCT s.student_id FROM public.subscriptions s WHERE s.company_id = p_company_id AND s.paid_at IS NOT NULL
  ),
  -- Paid subscriptions that ran at some point of the period.
  psubs AS (
    SELECT s.student_id, s.line_id, s.station_id FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.paid_at IS NOT NULL
      AND (s.status = 'active' OR (s.status = 'expired' AND s.end_date < v_today))
      AND COALESCE(s.start_date, v_to) <= v_to AND COALESCE(s.end_date, v_lo) >= v_lo
  ),
  uni AS (
    SELECT m.university_id AS id, COALESCE(u.name, NULLIF(btrim(m.utext), '')) AS name,
           count(*) AS n, count(r.student_id) AS subs
    FROM m LEFT JOIN public.universities u ON u.id = m.university_id
    LEFT JOIN running r ON r.student_id = m.student_id
    GROUP BY 1, 2
  ),
  col AS (SELECT college_n AS name, count(*) AS n FROM m GROUP BY 1),
  spc AS (SELECT spec_n AS name, count(*) AS n FROM m GROUP BY 1),
  stn AS (
    SELECT l.id AS line_id, l.name AS line_name, st.id AS station_id, st.name AS station_name, st.order_index,
           count(DISTINCT ps.student_id) AS n
    FROM public.lines l JOIN public.stations st ON st.line_id = l.id
    LEFT JOIN psubs ps ON ps.station_id = st.id
    WHERE l.company_id = p_company_id
    GROUP BY 1, 2, 3, 4, 5
    HAVING count(ps.student_id) > 0 OR (bool_or(st.is_active) AND bool_or(l.is_active))
  ),
  lu AS (
    SELECT ps.line_id, l.name AS line_name, st.university_id, u.name AS university_name, count(DISTINCT ps.student_id) AS n
    FROM psubs ps JOIN public.lines l ON l.id = ps.line_id JOIN public.students st ON st.id = ps.student_id
    LEFT JOIN public.universities u ON u.id = st.university_id
    GROUP BY 1, 2, 3, 4
  ),
  unserved AS (
    SELECT u.id, u.name, count(*) AS n FROM m JOIN public.universities u ON u.id = m.university_id
    WHERE NOT EXISTS (SELECT 1 FROM public.line_universities x JOIN public.lines l ON l.id = x.line_id
                      WHERE x.university_id = u.id AND l.company_id = p_company_id AND l.is_active)
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM m),
    'subscribers', (SELECT count(*) FROM running),
    'new_members', (SELECT count(*) FROM m WHERE (m.joined_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_lo AND v_to),
    'never_subscribed', (SELECT count(*) FROM m WHERE NOT EXISTS (SELECT 1 FROM paid_ever p WHERE p.student_id = m.student_id)),
    'ending_soon', (SELECT count(DISTINCT s.student_id) FROM public.subscriptions s
                    WHERE s.company_id = p_company_id AND s.status = 'active' AND s.paid_at IS NOT NULL
                      AND s.end_date BETWEEN v_today AND v_today + 14
                      AND NOT EXISTS (SELECT 1 FROM public.subscriptions n
                                      WHERE n.student_id = s.student_id AND n.company_id = p_company_id AND n.id <> s.id
                                        AND n.status IN ('pending_payment', 'pending_review', 'active') AND n.start_date > s.end_date)),
    'by_university', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'count', n, 'subscribers', subs)
                                                ORDER BY n DESC, name NULLS LAST) FROM uni), '[]'::jsonb),
    'by_college', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'count', n) ORDER BY name IS NULL, n DESC, name)
                            FROM ((SELECT name, n FROM col WHERE name IS NOT NULL ORDER BY n DESC, name LIMIT 15)
                                  UNION ALL (SELECT name, n FROM col WHERE name IS NULL)) c1), '[]'::jsonb),
    'by_specialisation', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'count', n) ORDER BY name IS NULL, n DESC, name)
                                   FROM ((SELECT name, n FROM spc WHERE name IS NOT NULL ORDER BY n DESC, name LIMIT 10)
                                         UNION ALL (SELECT name, n FROM spc WHERE name IS NULL)) s1), '[]'::jsonb),
    'by_station', COALESCE((SELECT jsonb_agg(jsonb_build_object('line_id', line_id, 'line_name', line_name, 'station_id', station_id,
                                                                'station_name', station_name, 'order_index', order_index, 'count', n)
                                             ORDER BY n DESC, line_name, order_index) FROM stn), '[]'::jsonb),
    'line_university', COALESCE((SELECT jsonb_agg(jsonb_build_object('line_id', line_id, 'line_name', line_name, 'university_id', university_id,
                                                                     'university_name', university_name, 'count', n)
                                                  ORDER BY line_name, n DESC) FROM lu), '[]'::jsonb),
    'unserved_universities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'members', n) ORDER BY n DESC, name)
                                       FROM unserved), '[]'::jsonb)
  ) INTO v_students;

  -- ------------------------------------------------------------------- rides
  WITH riding AS (
    -- One row per student riding per day, with the subscription the day was confirmed on
    -- (older rows without one: the company's paid subscription running that day).
    SELECT d.ride_date, d.student_id, d.is_returning, d.departure_time, d.return_time,
           COALESCE(d.subscription_id, (
             SELECT x.id FROM public.subscriptions x
             WHERE x.student_id = d.student_id AND x.company_id = p_company_id AND x.paid_at IS NOT NULL
               AND d.ride_date BETWEEN COALESCE(x.start_date, d.ride_date) AND COALESCE(x.end_date, d.ride_date)
             ORDER BY x.created_at DESC LIMIT 1)) AS subscription_id
    FROM public.daily_ride_status d
    WHERE d.company_id = p_company_id AND d.is_riding AND d.ride_date BETWEEN v_lo AND v_to
  ),
  -- The riders, counted at once per day and choice (a few thousand rows, not one per student).
  agg AS (
    SELECT r.ride_date AS d, s.line_id, s.station_id, st.university_id,
           COALESCE(r.departure_time, s.departure_time) AS dep_t,
           CASE WHEN r.is_returning THEN COALESCE(r.return_time, s.return_time) END AS ret_t,
           s.departure_trip_id, s.return_trip_id, count(*) AS n
    FROM riding r
    JOIN public.subscriptions s ON s.id = r.subscription_id AND s.company_id = p_company_id
    JOIN public.students st ON st.id = r.student_id
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  ),
  grp AS (
    SELECT d, line_id, station_id, university_id, direction, t, fallback, sum(n) AS n
    FROM (SELECT d, line_id, station_id, university_id, 'departure'::text AS direction, dep_t AS t, departure_trip_id AS fallback, n
          FROM agg WHERE dep_t IS NOT NULL
          UNION ALL
          SELECT d, line_id, station_id, university_id, 'return', ret_t, return_trip_id, n
          FROM agg WHERE ret_t IS NOT NULL) x
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  ),
  -- Each distinct choice is matched to its trip once (rider_trip_choices_in's rule).
  kmap AS (
    SELECT k.*, COALESCE((
        SELECT tr.id FROM public.line_trips tr
        JOIN public.line_trip_stops ts ON ts.trip_id = tr.id AND ts.station_id = k.station_id
        WHERE tr.line_id = k.line_id AND tr.direction = k.direction AND ts.stop_time = k.t
          AND (tr.university_id IS NULL OR tr.university_id = k.university_id)
        ORDER BY tr.is_active DESC, tr.university_id NULLS LAST, tr.start_time LIMIT 1), k.fallback) AS trip_id
    FROM (SELECT DISTINCT line_id, station_id, university_id, direction, t, fallback FROM grp) k
  ),
  trip_day AS (
    SELECT g.d, m.trip_id, sum(g.n)::int AS riders
    FROM grp g JOIN kmap m ON m.line_id = g.line_id AND m.direction = g.direction AND m.t = g.t
      AND m.station_id IS NOT DISTINCT FROM g.station_id AND m.university_id IS NOT DISTINCT FROM g.university_id
      AND m.fallback IS NOT DISTINCT FROM g.fallback
    WHERE m.trip_id IS NOT NULL
    GROUP BY 1, 2
  ),
  -- A check-in is unique per student, day and direction, and a trip has one direction:
  -- rows per trip and day are students already.
  scans AS (
    SELECT e.ride_date AS d, e.trip_id, e.student_id FROM public.supervisor_scan_events e
    WHERE e.company_id = p_company_id AND e.result = 'checked_in' AND e.ride_date = ANY (v_days)
  ),
  board AS (SELECT d, trip_id, count(*)::int AS n FROM scans WHERE trip_id IS NOT NULL GROUP BY 1, 2),
  day_board AS (SELECT d, count(*)::int AS n FROM (SELECT d, student_id FROM scans GROUP BY 1, 2) x GROUP BY 1),
  psubs AS (
    SELECT s.student_id, s.line_id, s.departure_trip_id, s.return_trip_id, s.start_date, s.end_date
    FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.paid_at IS NOT NULL
      AND (s.status = 'active' OR (s.status = 'expired' AND s.end_date < v_today))
      AND COALESCE(s.start_date, v_to) <= v_to AND COALESCE(s.end_date, v_lo) >= v_lo
  ),
  -- Subscribers per day: subscriptions grouped by their dates first (a handful of groups), then spread over the days.
  sub_groups AS (
    SELECT ps.line_id, ps.start_date, ps.end_date, count(DISTINCT ps.student_id) AS n
    FROM psubs ps GROUP BY 1, 2, 3
  ),
  day_subs AS (
    SELECT dd.d, g.line_id, GROUPING(g.line_id) AS total, sum(g.n)::int AS n
    FROM unnest(v_days) AS dd(d)
    JOIN sub_groups g ON dd.d BETWEEN COALESCE(g.start_date, dd.d) AND COALESCE(g.end_date, dd.d)
    GROUP BY GROUPING SETS ((dd.d, g.line_id), (dd.d))
  ),
  -- daily_ride_status has one row per student and day: the counts are students.
  day_conf AS (
    SELECT a.d, a.line_id, GROUPING(a.line_id) AS total, sum(a.n)::int AS n
    FROM agg a GROUP BY GROUPING SETS ((a.d, a.line_id), (a.d))
  ),
  days AS (
    SELECT dd.d, COALESCE(c.n, 0) AS conf, COALESCE(s.n, 0) AS subs, COALESCE(b.n, 0) AS boarded
    FROM unnest(v_days) AS dd(d)
    LEFT JOIN day_conf c ON c.d = dd.d AND c.total = 1
    LEFT JOIN day_subs s ON s.d = dd.d AND s.total = 1
    LEFT JOIN day_board b ON b.d = dd.d
  ),
  trip_agg AS (
    SELECT td.trip_id, sum(td.riders) AS total, max(td.riders) AS peak, count(*) AS active_days,
           count(*) FILTER (WHERE l.bus_capacity IS NOT NULL AND td.riders > l.bus_capacity) AS over
    FROM trip_day td JOIN public.line_trips tr ON tr.id = td.trip_id JOIN public.lines l ON l.id = tr.line_id
    GROUP BY td.trip_id
  ),
  board_agg AS (
    SELECT b.trip_id, sum(b.n) AS boarded, sum(COALESCE(td.riders, 0)) AS riders_on
    FROM board b LEFT JOIN trip_day td ON td.trip_id = b.trip_id AND td.d = b.d
    GROUP BY b.trip_id
  ),
  trip_subs AS (
    SELECT x.trip_id, count(DISTINCT x.student_id) AS n
    FROM (SELECT ps.student_id, ps.departure_trip_id AS trip_id FROM psubs ps
          WHERE v_to BETWEEN COALESCE(ps.start_date, v_to) AND COALESCE(ps.end_date, v_to)
          UNION ALL
          SELECT ps.student_id, ps.return_trip_id FROM psubs ps
          WHERE v_to BETWEEN COALESCE(ps.start_date, v_to) AND COALESCE(ps.end_date, v_to)) x
    WHERE x.trip_id IS NOT NULL GROUP BY 1
  ),
  trips AS (
    SELECT tr.id, tr.line_id, l.name AS line_name, tr.direction, tr.label, tr.is_active AND l.is_active AS is_active,
           l.bus_capacity AS cap,
           COALESCE(tr.start_time, (SELECT min(ts.stop_time) FROM public.line_trip_stops ts WHERE ts.trip_id = tr.id)) AS at,
           COALESCE(ts.n, 0) AS subscribers, COALESCE(a.total, 0) AS total, COALESCE(a.peak, 0) AS peak,
           COALESCE(a.over, 0) AS days_over, COALESCE(a.active_days, 0) AS active_days,
           COALESCE(b.boarded, 0) AS boarded, b.riders_on
    FROM public.line_trips tr JOIN public.lines l ON l.id = tr.line_id AND l.company_id = p_company_id
    LEFT JOIN trip_agg a ON a.trip_id = tr.id
    LEFT JOIN board_agg b ON b.trip_id = tr.id
    LEFT JOIN trip_subs ts ON ts.trip_id = tr.id
    WHERE (tr.is_active AND l.is_active) OR a.trip_id IS NOT NULL
  ),
  line_rate AS (
    SELECT s.line_id, l.name AS line_name, sum(COALESCE(c.n, 0)) AS conf, sum(s.n) AS subs, count(*) AS days
    FROM day_subs s JOIN public.lines l ON l.id = s.line_id
    LEFT JOIN day_conf c ON c.d = s.d AND c.line_id = s.line_id AND c.total = 0
    WHERE s.total = 0
    GROUP BY 1, 2
  ),
  slots AS (
    SELECT ((extract(hour FROM t)::int * 60 + extract(minute FROM t)::int) / 15) * 15 AS m, sum(n) AS n
    FROM grp WHERE direction = 'departure' GROUP BY 1
  ),
  dows AS (
    SELECT extract(dow FROM d)::int AS dow, count(*) AS n, sum(conf) AS conf, sum(subs) AS subs FROM days GROUP BY 1
  )
  SELECT jsonb_build_object(
    'rides', (SELECT jsonb_build_object(
        'confirm_rate', CASE WHEN sum(subs) > 0 THEN round(LEAST(sum(conf)::numeric / sum(subs), 1), 3) END,
        'avg_confirmed', CASE WHEN v_nd > 0 THEN round(sum(conf)::numeric / v_nd, 1) ELSE 0 END,
        'avg_boarded', CASE WHEN v_nd > 0 THEN round(sum(boarded)::numeric / v_nd, 1) ELSE 0 END,
        'avg_subscribers', CASE WHEN v_nd > 0 THEN round(sum(subs)::numeric / v_nd, 1) ELSE 0 END) FROM days),
    'trips', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'trip_id', t.id, 'line_id', t.line_id, 'line_name', t.line_name, 'direction', t.direction,
        'start_time', left(t.at::text, 5), 'label', NULLIF(t.label, ''), 'is_active', t.is_active,
        'subscribers', t.subscribers, 'capacity', t.cap,
        'avg_riders', CASE WHEN v_nd > 0 THEN round(t.total::numeric / v_nd, 1) ELSE 0 END,
        'peak_riders', t.peak, 'days_over', t.days_over,
        'avg_boarded', CASE WHEN v_nd > 0 THEN round(t.boarded::numeric / v_nd, 1) ELSE 0 END,
        'no_show', CASE WHEN t.riders_on > 0 THEN round(GREATEST(0, 1 - t.boarded::numeric / t.riders_on), 3) END,
        'ride_days', v_nd, 'active_days', t.active_days)
        ORDER BY t.line_name, t.direction, t.at NULLS LAST) FROM trips t), '[]'::jsonb),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'line_id', x.line_id, 'line_name', x.line_name,
        'confirm_rate', CASE WHEN x.subs > 0 THEN round(LEAST(x.conf::numeric / x.subs, 1), 3) END,
        'ride_days', x.days, 'avg_subscribers', round(x.subs::numeric / GREATEST(x.days, 1), 1))
        ORDER BY x.line_name) FROM line_rate x), '[]'::jsonb),
    'time_slots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'slot', lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0'),
        'riders', round(n::numeric / GREATEST(v_nd, 1), 1)) ORDER BY m) FROM slots), '[]'::jsonb),
    'weekdays', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'dow', dow, 'days', n,
        'confirm_rate', CASE WHEN subs > 0 THEN round(LEAST(conf::numeric / subs, 1), 3) END) ORDER BY dow) FROM dows), '[]'::jsonb),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'confirmed', conf, 'boarded', boarded, 'subscribers', subs) ORDER BY d)
                       FROM (SELECT * FROM days ORDER BY d DESC LIMIT 60) last60), '[]'::jsonb)
  ) INTO v_rides;

  -- ------------------------------------------------------------------- money
  WITH paid AS (
    SELECT s.id, s.student_id, (s.paid_at AT TIME ZONE 'Africa/Cairo')::date AS day,
           COALESCE(s.period_code, CASE s.type WHEN 'daily' THEN 'daily' WHEN 'yearly' THEN 'both' END) AS opt,
           COALESCE(a.amount, s.price) AS amount
    FROM public.subscriptions s
    LEFT JOIN (SELECT DISTINCT ON (r.subscription_id) r.subscription_id, r.amount
               FROM public.receipts r WHERE r.company_id = p_company_id AND r.status = 'approved'
               ORDER BY r.subscription_id, r.reviewed_at DESC NULLS LAST) a ON a.subscription_id = s.id
    WHERE s.company_id = p_company_id AND s.paid_at IS NOT NULL
      AND (s.paid_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_lo AND v_to
  ),
  unpaid AS (
    SELECT count(*) AS n, COALESCE(sum(s.price), 0) AS amount FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.paid_at IS NULL AND s.status IN ('pending_payment', 'pending_review')
      AND (s.end_date IS NULL OR s.end_date >= v_today)
  )
  SELECT jsonb_build_object(
    'revenue', (SELECT COALESCE(sum(amount), 0) FROM paid),
    'paying', (SELECT count(DISTINCT student_id) FROM paid),
    'avg_per_student', (SELECT CASE WHEN count(DISTINCT student_id) > 0 THEN round(sum(amount) / count(DISTINCT student_id)) ELSE 0 END FROM paid),
    'unpaid_count', (SELECT n FROM unpaid),
    'unpaid_amount', (SELECT amount FROM unpaid),
    'by_month', COALESCE((SELECT jsonb_agg(jsonb_build_object('month', mo, 'amount', amount, 'count', n) ORDER BY mo)
                          FROM (SELECT to_char(day, 'YYYY-MM') AS mo, sum(amount) AS amount, count(*) AS n FROM paid GROUP BY 1) x), '[]'::jsonb),
    'by_option', COALESCE((SELECT jsonb_agg(jsonb_build_object('option', opt, 'amount', amount, 'count', n) ORDER BY amount DESC, opt)
                           FROM (SELECT opt, sum(amount) AS amount, count(*) AS n FROM paid GROUP BY 1) x), '[]'::jsonb)
  ) INTO v_money;

  -- ---------------------------------------------------------------- receipts
  WITH rv AS (
    SELECT r.status, r.rejection_reason, r.payment_method_id, extract(epoch FROM r.reviewed_at - r.created_at) / 3600.0 AS hours
    FROM public.receipts r
    WHERE r.company_id = p_company_id AND r.status IN ('approved', 'rejected') AND r.reviewed_at IS NOT NULL
      AND (r.reviewed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN v_lo AND v_to
  )
  SELECT jsonb_build_object(
    'approved', (SELECT count(*) FROM rv WHERE status = 'approved'),
    'rejected', (SELECT count(*) FROM rv WHERE status = 'rejected'),
    'pending', (SELECT count(*) FROM public.receipts r WHERE r.company_id = p_company_id AND r.status = 'pending'),
    'median_review_hours', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(hours, 0)))::numeric, 1) FROM rv),
    'reasons', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', n) ORDER BY n DESC, reason)
                         FROM (SELECT regexp_replace(btrim(rejection_reason), '\s+', ' ', 'g') AS reason, count(*) AS n
                               FROM rv WHERE status = 'rejected' AND NULLIF(btrim(rejection_reason), '') IS NOT NULL
                               GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 6) x), '[]'::jsonb),
    'by_method', COALESCE((SELECT jsonb_agg(jsonb_build_object('method_id', x.payment_method_id, 'name', pm.display_name,
                                                               'approved', x.ok, 'rejected', x.bad) ORDER BY x.ok + x.bad DESC, pm.sort_order NULLS LAST)
                           FROM (SELECT payment_method_id, count(*) FILTER (WHERE status = 'approved') AS ok,
                                        count(*) FILTER (WHERE status = 'rejected') AS bad
                                 FROM rv GROUP BY 1) x
                           LEFT JOIN public.company_payment_methods pm ON pm.id = x.payment_method_id AND pm.company_id = p_company_id), '[]'::jsonb)
  ) INTO v_receipts;

  -- ---------------------------------------------------------------- insights
  -- Rule-based, from the numbers above. Each rule gives at most three cards;
  -- 'act' first, then 'watch', then 'good', the larger first within each.
  WITH tr AS (SELECT x FROM jsonb_array_elements(v_rides->'trips') x),
  trip_data AS (
    SELECT x, jsonb_build_object('trip_id', x->'trip_id', 'line_id', x->'line_id', 'line_name', x->'line_name',
                                 'direction', x->'direction', 'start_time', x->'start_time', 'label', x->'label',
                                 'capacity', x->'capacity', 'avg_riders', x->'avg_riders', 'peak_riders', x->'peak_riders',
                                 'days_over', x->'days_over', 'ride_days', v_nd) AS d
    FROM tr
  ),
  company_rate AS (SELECT (v_rides->'rides'->>'confirm_rate')::numeric AS r),
  review AS (
    SELECT (v_receipts->>'median_review_hours')::numeric AS h,
           (v_receipts->>'approved')::int + (v_receipts->>'rejected')::int AS n
  ),
  station_top AS (
    SELECT DISTINCT ON (s->>'line_id') s, (s->>'count')::int AS n,
           sum((s->>'count')::int) OVER (PARTITION BY s->>'line_id') AS line_total,
           count(*) OVER (PARTITION BY s->>'line_id') AS stations
    FROM jsonb_array_elements(v_students->'by_station') s
    ORDER BY s->>'line_id', (s->>'count')::int DESC
  ),
  cand(key, severity, weight, data) AS (
    SELECT 'over_capacity', 'act', (x->>'days_over')::numeric, d
    FROM trip_data WHERE (x->>'days_over')::int >= 2
    UNION ALL
    SELECT 'low_utilisation', 'watch', (x->>'capacity')::numeric - (x->>'avg_riders')::numeric,
           d || jsonb_build_object('pct', round(100 * (x->>'avg_riders')::numeric / (x->>'capacity')::numeric))
    FROM trip_data
    WHERE v_nd >= 3 AND (x->>'is_active')::boolean AND (x->>'capacity') IS NOT NULL AND (x->>'capacity')::int > 0
      AND (x->>'active_days')::int > 0 AND (x->>'avg_riders')::numeric < 0.4 * (x->>'capacity')::numeric
    UNION ALL
    SELECT 'empty_trip', 'watch', v_nd::numeric, d
    FROM trip_data WHERE v_nd >= 5 AND (x->>'is_active')::boolean AND (x->>'active_days')::int = 0
    UNION ALL
    SELECT 'unserved_university', 'act', (u->>'members')::numeric,
           jsonb_build_object('university_id', u->'id', 'university_name', u->'name', 'members', u->'members')
    FROM jsonb_array_elements(v_students->'unserved_universities') u WHERE (u->>'members')::int >= 5
    UNION ALL
    SELECT 'station_concentration', 'watch', n::numeric,
           jsonb_build_object('line_id', s->'line_id', 'line_name', s->'line_name', 'station_id', s->'station_id',
                              'station_name', s->'station_name', 'count', n, 'line_total', line_total,
                              'pct', round(100.0 * n / line_total))
    -- A quarter of the line's subscribers and half again a station's even share (four equal stations raise nothing).
    FROM station_top WHERE line_total >= 8 AND n >= 0.25 * line_total AND n * stations >= 1.5 * line_total
    UNION ALL
    SELECT 'never_subscribed', 'watch', (v_students->>'never_subscribed')::numeric,
           jsonb_build_object('count', v_students->'never_subscribed', 'members', v_students->'members')
    WHERE (v_students->>'never_subscribed')::int >= 10
    UNION ALL
    SELECT 'ending_soon', 'act', (v_students->>'ending_soon')::numeric,
           jsonb_build_object('count', v_students->'ending_soon', 'days', 14)
    WHERE (v_students->>'ending_soon')::int >= 5
    UNION ALL
    SELECT 'low_confirmation_line', 'watch', 100 * (c.r - (l->>'confirm_rate')::numeric),
           jsonb_build_object('line_id', l->'line_id', 'line_name', l->'line_name', 'rate', l->'confirm_rate',
                              'company_rate', c.r, 'ride_days', l->'ride_days', 'avg_subscribers', l->'avg_subscribers')
    FROM jsonb_array_elements(v_rides->'lines') l CROSS JOIN company_rate c
    WHERE c.r IS NOT NULL AND (l->>'confirm_rate') IS NOT NULL AND (l->>'ride_days')::int >= 3
      AND (l->>'avg_subscribers')::numeric >= 3 AND (l->>'confirm_rate')::numeric <= c.r - 0.15
    UNION ALL
    SELECT 'method_rejections', 'watch', (mth->>'rejected')::numeric,
           jsonb_build_object('method_id', mth->'method_id', 'name', mth->'name', 'rejected', mth->'rejected',
                              'total', (mth->>'approved')::int + (mth->>'rejected')::int,
                              'pct', round(100.0 * (mth->>'rejected')::int / ((mth->>'approved')::int + (mth->>'rejected')::int)))
    FROM jsonb_array_elements(v_receipts->'by_method') mth
    WHERE (mth->>'approved')::int + (mth->>'rejected')::int >= 8
      AND (mth->>'rejected')::int >= 0.25 * ((mth->>'approved')::int + (mth->>'rejected')::int)
    UNION ALL
    SELECT 'slow_review', 'act', h, jsonb_build_object('median_hours', h, 'reviewed', n)
    FROM review WHERE h > 24 AND n >= 10
    UNION ALL
    SELECT 'no_capacity', 'watch', count(*)::numeric,
           jsonb_build_object('count', count(*), 'lines', jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) ORDER BY l.name))
    FROM public.lines l WHERE l.company_id = p_company_id AND l.is_active AND l.bus_capacity IS NULL
    HAVING count(*) > 0
    UNION ALL
    SELECT 'high_confirmation', 'good', c.r, jsonb_build_object('rate', c.r, 'ride_days', v_nd)
    FROM company_rate c WHERE c.r >= 0.8 AND v_nd >= 5
    UNION ALL
    SELECT 'fast_review', 'good', h, jsonb_build_object('median_hours', h, 'reviewed', n)
    FROM review WHERE h <= 6 AND n >= 10
  ),
  ranked AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.key ORDER BY c.weight DESC NULLS LAST) AS k,
           CASE c.severity WHEN 'act' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END AS sev
    FROM cand c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', key, 'severity', severity, 'data', data) ORDER BY sev, weight DESC NULLS LAST, key),
                  '[]'::jsonb)
  INTO v_insights FROM ranked WHERE k <= 3;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', v_to, 'ride_days', v_nd),
    'students', v_students,
    'rides', v_rides->'rides',
    'trips', v_rides->'trips',
    'lines', v_rides->'lines',
    'time_slots', v_rides->'time_slots',
    'weekdays', v_rides->'weekdays',
    'daily', v_rides->'daily',
    'money', v_money,
    'receipts', v_receipts,
    'insights', v_insights
  );
END;
$$;

REVOKE ALL ON FUNCTION public.company_analytics(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_analytics(uuid, date, date) TO authenticated;

COMMIT;
