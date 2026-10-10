-- ==============================================================================
-- Migration: 20261116000001_admin_today.sql
--
-- The dashboards' first pages («اليوم», docs/canvas/AdmToday*, AdmPlatToday*) in
-- one request each. Additive only: two new read-only functions; nothing that
-- exists changes (company_overview and platform_overview stay as they are — the
-- dashboard's frame and the older dashboard read them).
--
--   company_today(p_company_id)  per line: tomorrow's riders going and returning,
--       the busiest departure trip, bus seats and the trips over them, the line's
--       supervisors, subscribers, whether students can see it and why not; what
--       waits (receipts with the oldest and the last-attempt count, password
--       requests, payment methods) and the first-run checklist.
--   platform_today()  totals, one row per company, and what waits for the platform
--       admin (corrections, password requests, companies that cannot sell, push
--       failures, app versions).
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.company_today(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_now timestamp := now() AT TIME ZONE 'Africa/Cairo';
  v_ride date;
  v_line_ids uuid[];
  v_window record;
BEGIN
  IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'غير مسموح بعرض بيانات هذه الشركة.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'الشركة غير موجودة.' USING ERRCODE = 'P0002';
  END IF;

  -- The day students are confirming for right now (as company_overview's next_ride_date).
  v_ride := COALESCE(public.next_votable_ride_date(p_company_id), v_today + 1);
  SELECT w.opens, w.closes INTO v_window FROM public.vote_window(v_ride, p_company_id) w;
  v_line_ids := ARRAY(SELECT l.id FROM public.lines l WHERE l.company_id = p_company_id);

  RETURN (
    WITH choices AS (
      SELECT c.line_id, c.direction, c.trip_id, c.student_id
      FROM public.rider_trip_choices_in(v_ride, v_line_ids) c
    ),
    trip_n AS (
      SELECT ch.line_id, ch.direction, ch.trip_id, count(DISTINCT ch.student_id) AS n
      FROM choices ch WHERE ch.trip_id IS NOT NULL GROUP BY 1, 2, 3
    ),
    line_n AS (
      SELECT ch.line_id,
             count(DISTINCT ch.student_id) FILTER (WHERE ch.direction = 'departure') AS going,
             count(DISTINCT ch.student_id) FILTER (WHERE ch.direction = 'return') AS returning
      FROM choices ch GROUP BY 1
    ),
    -- Subscriptions valid today, per line (as company_overview counts them).
    running AS (
      SELECT s.line_id, count(*) AS n FROM public.subscriptions s
      WHERE s.company_id = p_company_id AND s.status = 'active' AND s.paid_at IS NOT NULL
        AND (s.start_date IS NULL OR s.start_date <= v_today) AND (s.end_date IS NULL OR s.end_date >= v_today)
      GROUP BY s.line_id
    ),
    trips AS (
      SELECT t.id, t.line_id, t.direction, t.label, t.is_active, t.university_id,
             COALESCE(t.start_time, (SELECT min(ts.stop_time) FROM public.line_trip_stops ts WHERE ts.trip_id = t.id)) AS at
      FROM public.line_trips t WHERE t.line_id = ANY (v_line_ids)
    ),
    lines_out AS (
      SELECT l.id, l.name, l.is_active, l.bus_capacity, l.created_at,
             COALESCE(r.n, 0) AS subscribers, COALESCE(n.going, 0) AS going, COALESCE(n.returning, 0) AS returning,
             (SELECT jsonb_build_object('id', t.id, 'time', left(t.at::text, 5), 'riders', tn.n, 'label', NULLIF(t.label, ''))
              FROM trip_n tn JOIN trips t ON t.id = tn.trip_id
              WHERE tn.line_id = l.id AND tn.direction = 'departure'
              ORDER BY tn.n DESC, t.at LIMIT 1) AS top_trip,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'direction', t.direction, 'time', left(t.at::text, 5),
                                                           'riders', tn.n, 'label', NULLIF(t.label, '')) ORDER BY tn.n - l.bus_capacity DESC, t.at)
                       FROM trip_n tn JOIN trips t ON t.id = tn.trip_id
                       WHERE tn.line_id = l.id AND l.bus_capacity IS NOT NULL AND tn.n > l.bus_capacity), '[]'::jsonb) AS over,
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.full_name) ORDER BY sl.assigned_at, sv.full_name)
                       FROM public.supervisor_lines sl JOIN public.supervisors sv ON sv.id = sl.supervisor_id AND sv.is_active
                       WHERE sl.line_id = l.id), '[]'::jsonb) AS supervisors,
             (SELECT count(*) FROM public.stations st WHERE st.line_id = l.id AND st.is_active) AS stations,
             (SELECT count(*) FROM trips t WHERE t.line_id = l.id AND t.direction = 'departure' AND t.is_active) AS departures,
             (SELECT count(*) FROM trips t WHERE t.line_id = l.id AND t.direction = 'return' AND t.is_active) AS returns,
             -- A university of the line that no active departure trip serves: its students never see the line.
             (SELECT u.name FROM public.line_universities lu JOIN public.universities u ON u.id = lu.university_id
              WHERE lu.line_id = l.id AND NOT EXISTS (
                SELECT 1 FROM trips t WHERE t.line_id = l.id AND t.direction = 'departure' AND t.is_active
                  AND (t.university_id IS NULL OR t.university_id = lu.university_id))
              ORDER BY u.name LIMIT 1) AS unserved_university,
             (SELECT bool_or(o.available) FROM public.line_sale_options_for(l.id, NULL, NULL) o) AS sells,
             -- Why nothing is on sale: a reason the company can fix on the line first, else the company-wide one.
             (SELECT o.reason FROM public.line_sale_options_for(l.id, NULL, NULL) o WHERE NOT o.available
              ORDER BY (o.reason IN ('line_not_offering', 'no_price')) DESC, o.start_date LIMIT 1) AS sale_reason
      FROM public.lines l
      LEFT JOIN running r ON r.line_id = l.id
      LEFT JOIN line_n n ON n.line_id = l.id
      WHERE l.company_id = p_company_id
    ),
    judged AS (
      SELECT x.*, CASE
          WHEN NOT x.is_active THEN 'line_inactive'
          WHEN x.stations = 0 THEN 'no_stations'
          WHEN x.departures = 0 THEN 'no_departure'
          WHEN x.unserved_university IS NOT NULL THEN 'unserved_university'
          WHEN NOT COALESCE(x.sells, false) THEN COALESCE(x.sale_reason, 'nothing_on_sale')
        END AS hidden
      FROM lines_out x
    ),
    pending AS (
      SELECT count(*) AS n, min(r.created_at) AS oldest, count(*) FILTER (WHERE r.attempt_number >= 5) AS last_attempt
      FROM public.receipts r WHERE r.company_id = p_company_id AND r.status = 'pending'
    ),
    vote AS (SELECT v.opens_at, v.closes_at FROM public.vote_settings(p_company_id) v)
    SELECT jsonb_build_object(
      'company', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'created_at', c.created_at)
                  FROM public.companies c WHERE c.id = p_company_id),
      'today', v_today,
      'ride_date', v_ride,
      'vote_opens_at', (SELECT left(opens_at::text, 5) FROM vote),
      'vote_closes_at', (SELECT left(closes_at::text, 5) FROM vote),
      'vote_open', COALESCE(v_window.opens <= v_now AND v_now < v_window.closes, false),
      'members', (SELECT count(*) FROM public.company_students m WHERE m.company_id = p_company_id AND m.status = 'active'),
      'subscribers', (SELECT COALESCE(sum(n), 0) FROM running),
      'confirmed', public.company_riders_on(p_company_id, v_ride),
      'going', (SELECT count(DISTINCT student_id) FROM choices WHERE direction = 'departure'),
      'returning', (SELECT count(DISTINCT student_id) FROM choices WHERE direction = 'return'),
      'receipts', (SELECT jsonb_build_object('waiting', n, 'oldest_at', oldest, 'last_attempt', last_attempt) FROM pending),
      'password_requests', (SELECT count(*) FROM public.password_reset_requests pr
                            WHERE pr.requested_at > now() - INTERVAL '30 days'
                              AND (pr.status = 'pending' OR (pr.status = 'code_issued' AND pr.code_expires_at >= now()))
                              AND public.is_company_member(p_company_id, pr.student_id)),
      'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', j.id, 'name', j.name, 'is_active', j.is_active, 'bus_capacity', j.bus_capacity,
                  'subscribers', j.subscribers, 'going', j.going, 'returning', j.returning,
                  'top_trip', j.top_trip, 'over', j.over, 'supervisors', j.supervisors,
                  'visible', j.hidden IS NULL, 'hidden', j.hidden, 'unserved_university', j.unserved_university)
                ORDER BY j.going DESC, j.subscribers DESC, j.name) FROM judged j), '[]'::jsonb),
      'setup', jsonb_build_object(
        'lines', (SELECT count(*) FROM lines_out),
        'first_line', (SELECT jsonb_build_object('id', x.id, 'name', x.name, 'stations', x.stations,
                                                 'departures', x.departures, 'returns', x.returns)
                       FROM lines_out x ORDER BY x.created_at, x.name LIMIT 1),
        'payment_methods', (SELECT count(*) FROM public.company_payment_methods pm WHERE pm.company_id = p_company_id AND pm.is_active),
        'supervisors', (SELECT count(*) FROM public.supervisors s WHERE s.company_id = p_company_id AND s.is_active),
        'on_sale', COALESCE((SELECT jsonb_agg(p.name ORDER BY p.start_date) FROM public.company_sale_periods(p_company_id, NULL) p
                             WHERE p.available AND p.subscription_type = 'termly'), '[]'::jsonb),
        'vote_custom', (SELECT c.vote_closes_at IS NOT NULL FROM public.companies c WHERE c.id = p_company_id),
        'wallet_custom', EXISTS (SELECT 1 FROM public.wallet_card_settings w WHERE w.company_id = p_company_id AND w.updated_by IS NOT NULL),
        'receipt_info', (SELECT num_nonnulls(NULLIF(btrim(c.contact_phone), ''), NULLIF(btrim(c.address), ''),
                                             NULLIF(btrim(c.commercial_register), ''), NULLIF(btrim(c.tax_number), '')) > 0
                         FROM public.companies c WHERE c.id = p_company_id)
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.platform_today()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;

  -- One row per company: its overview numbers plus what decides whether it can sell.
  SELECT COALESCE(jsonb_agg(
           (public.company_overview_data(c.id) - 'top_lines' - 'riders_week' - 'baseline')
           || jsonb_build_object(
                'oldest_receipt_at', (SELECT min(r.created_at) FROM public.receipts r WHERE r.company_id = c.id AND r.status = 'pending'),
                'payment_methods', (SELECT count(*) FROM public.company_payment_methods pm WHERE pm.company_id = c.id AND pm.is_active),
                'selling', EXISTS (SELECT 1 FROM public.lines l CROSS JOIN LATERAL public.line_sale_options_for(l.id, NULL, NULL) o
                                   WHERE l.company_id = c.id AND l.is_active AND o.available))
           ORDER BY c.name), '[]'::jsonb)
  INTO v_rows FROM public.companies c;

  RETURN jsonb_build_object(
    'today', public.cairo_today(),
    'companies', (SELECT jsonb_build_object(
        'total', count(*),
        'active', count(*) FILTER (WHERE status = 'active'),
        'suspended', count(*) FILTER (WHERE status = 'suspended'),
        'archived', count(*) FILTER (WHERE status = 'archived')) FROM public.companies),
    'universities', (SELECT count(*) FROM public.universities u WHERE u.is_active),
    'students', (SELECT count(*) FROM public.students),
    'active_subscriptions', (SELECT COALESCE(sum((r->>'active_subscriptions')::int), 0) FROM jsonb_array_elements(v_rows) r),
    'pending_receipts', (SELECT COALESCE(sum((r->>'pending_receipts')::int), 0) FROM jsonb_array_elements(v_rows) r),
    'receipt_companies', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE (r->>'pending_receipts')::int > 0),
    'next_ride_date', public.next_votable_ride_date(),
    'riders_next', (SELECT COALESCE(sum((r->>'riders_next')::int), 0) FROM jsonb_array_elements(v_rows) r),
    'vote_closes_at', (SELECT left(v.closes_at::text, 5) FROM public.vote_settings(NULL) v),
    'revenue', (SELECT COALESCE(sum((r->>'revenue')::numeric), 0) FROM jsonb_array_elements(v_rows) r),
    'corrections', (SELECT jsonb_build_object(
        'waiting', count(*), 'oldest_at', min(q.created_at),
        'companies', COALESCE((SELECT jsonb_agg(DISTINCT c.name) FROM public.student_correction_requests x
                               JOIN public.companies c ON c.id = x.company_id WHERE x.status = 'pending'), '[]'::jsonb))
      FROM public.student_correction_requests q WHERE q.status = 'pending'),
    'password_requests', (SELECT jsonb_build_object(
        'waiting', count(*),
        -- Students with no company: nobody but the platform admin can answer them.
        'without_company', count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM public.company_students m JOIN public.companies c ON c.id = m.company_id AND c.status = 'active'
            WHERE m.student_id = pr.student_id AND m.status = 'active')))
      FROM public.password_reset_requests pr
      WHERE pr.requested_at > now() - INTERVAL '30 days'
        AND (pr.status = 'pending' OR (pr.status = 'code_issued' AND pr.code_expires_at >= now()))),
    'push_failed_24h', (SELECT count(*) FROM public.push_outbox o WHERE o.status = 'failed' AND o.updated_at > now() - INTERVAL '24 hours'),
    'app_versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('platform', v.platform, 'latest_version', v.latest_version,
                                                                  'min_version', v.min_version) ORDER BY v.platform)
                              FROM public.app_versions v), '[]'::jsonb),
    'per_company', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.company_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_today(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_today() TO authenticated;
