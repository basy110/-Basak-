-- ==============================================================================
-- Migration: 20261201000001_company_max_students.sql
-- A company's student cap: when its active subscriptions reach max_students the
-- company is hidden from students in the subscription catalog, until the cap is
-- raised. NULL = no cap. A student already on the company still sees it (to renew).
-- ==============================================================================
BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS max_students integer
  CHECK (max_students IS NULL OR max_students >= 0);

CREATE OR REPLACE FUNCTION public.get_subscription_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT s.id, s.university_id, COALESCE(u.name, s.university) AS university
    FROM public.students s LEFT JOIN public.universities u ON u.id = s.university_id
    WHERE s.id = auth.uid()
  ),
  trips AS MATERIALIZED (
    SELECT t.id, t.line_id, t.direction, t.start_time, t.label
    FROM public.line_trips t, me WHERE public.trip_serves_student(t, me.id)
  ),
  per_line AS (
    SELECT t.line_id,
           min(t.start_time) FILTER (WHERE t.direction = 'departure') AS first_departure,
           max(t.start_time) FILTER (WHERE t.direction = 'return') AS last_return,
           -- The way back: when the bus leaves the student's university. No stations.
           jsonb_agg(jsonb_build_object('trip_id', t.id, 'time', t.start_time, 'label', t.label) ORDER BY t.start_time)
             FILTER (WHERE t.direction = 'return') AS returns
    FROM trips t GROUP BY t.line_id
  ),
  departures AS (
    SELECT t.line_id, x.station_id,
           jsonb_agg(jsonb_build_object('trip_id', t.id, 'time', x.stop_time, 'label', t.label) ORDER BY x.stop_time) AS list
    FROM trips t JOIN public.line_trip_stops x ON x.trip_id = t.id
    WHERE t.direction = 'departure'
    GROUP BY t.line_id, x.station_id
  ),
  line_stations AS (
    -- A station no departure trip stops at cannot be boarded from.
    SELECT st.line_id,
           jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'order_index', st.order_index, 'departures', d.list)
                     ORDER BY st.order_index, st.name) AS stations
    FROM public.stations st JOIN departures d ON d.line_id = st.line_id AND d.station_id = st.id
    WHERE st.is_active
    GROUP BY st.line_id
  ),
  my_lines AS (
    SELECT l.*, pl.first_departure, pl.last_return, pl.returns
    FROM public.lines l
    JOIN public.companies c ON c.id = l.company_id AND c.is_active AND c.status = 'active'
      -- A full company (at its student cap) is hidden, unless this student is already on it.
      AND (c.max_students IS NULL
           OR c.max_students > (SELECT count(*) FROM public.subscriptions s2 WHERE s2.company_id = c.id AND s2.status = 'active')
           OR EXISTS (SELECT 1 FROM public.subscriptions s3 WHERE s3.company_id = c.id AND s3.student_id = auth.uid()
                      AND s3.status IN ('active', 'pending_payment', 'pending_review')))
    JOIN per_line pl ON pl.line_id = l.id AND pl.first_departure IS NOT NULL
    WHERE l.is_active
  ),
  -- What each company sells now, asked once per company (it was once per line),
  -- with whether the student already holds something over those days.
  periods AS MATERIALIZED (
    SELECT c.company_id, p.*,
           EXISTS (SELECT 1 FROM public.subscriptions s
                   WHERE s.student_id = auth.uid() AND s.status IN ('pending_payment', 'pending_review', 'active')
                     AND (s.end_date IS NULL OR s.end_date >= public.cairo_today())
                     AND daterange(s.start_date, s.end_date, '[]') && daterange(p.start_date, p.end_date, '[]')) AS overlaps
    FROM (SELECT DISTINCT company_id FROM my_lines) c
    CROSS JOIN LATERAL public.company_sale_periods(c.company_id, NULL) p
  ),
  line_sale AS (
    -- The same rule as line_sale_options_for, for lines that are active.
    SELECT l.id AS line_id,
           jsonb_agg(jsonb_build_object('option', p.option, 'academic_year', p.academic_year, 'name', p.name,
             'label', p.label, 'type', p.subscription_type, 'start_date', p.start_date, 'end_date', p.end_date,
             'phase', p.phase, 'price', pr.price) ORDER BY p.start_date, p.subscription_type) AS options,
           min(pr.price) AS from_price
    FROM my_lines l
    JOIN periods p ON p.company_id = l.company_id
    LEFT JOIN public.line_period_prices pr ON pr.line_id = l.id AND pr.option = p.option
    WHERE p.reason IS NULL AND COALESCE(pr.is_enabled, false) AND COALESCE(pr.price, 0) > 0 AND NOT p.overlaps
    GROUP BY l.id
  ),
  line_json AS (
    SELECT l.company_id, l.name, jsonb_build_object(
      'id', l.id, 'name', l.name, 'origin_name', COALESCE(l.origin_name, l.name),
      'university', (SELECT university FROM me),
      'first_departure', l.first_departure,
      'last_return', l.last_return,
      'stations', COALESCE(ls.stations, '[]'::jsonb),
      'returns', COALESCE(l.returns, '[]'::jsonb),
      'options', COALESCE(sale.options, '[]'::jsonb),
      'from_price', sale.from_price,
      -- Daily is sold on a line while its company sells it and the line has a daily price.
      'daily', jsonb_build_object('enabled', public.daily_subscription_enabled(l.company_id) AND l.price_daily > 0, 'price', l.price_daily)
    ) AS j
    FROM my_lines l
    LEFT JOIN line_stations ls ON ls.line_id = l.id
    LEFT JOIN line_sale sale ON sale.line_id = l.id
  ),
  by_company AS (
    SELECT lj.company_id, jsonb_agg(lj.j ORDER BY lj.name) AS lines FROM line_json lj GROUP BY lj.company_id
  )
  SELECT jsonb_build_object(
    'university', (SELECT jsonb_build_object('id', university_id, 'name', university) FROM me),
    -- The governorates the companies below serve, for the student to pick from.
    'governorates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) ORDER BY g.sort_order)
      FROM public.governorates g
      WHERE EXISTS (SELECT 1 FROM public.company_governorates cg JOIN by_company b ON b.company_id = cg.company_id
                    WHERE cg.governorate_code = g.code)), '[]'::jsonb),
    'companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'logo_path', c.logo_path,
                                         'emblem_path', c.emblem_path, 'lines', b.lines,
                                         'governorates', COALESCE((
                                           SELECT jsonb_agg(cg.governorate_code ORDER BY g.sort_order)
                                           FROM public.company_governorates cg JOIN public.governorates g ON g.code = cg.governorate_code
                                           WHERE cg.company_id = c.id), '[]'::jsonb))
             ORDER BY c.name)
      FROM public.companies c JOIN by_company b ON b.company_id = c.id), '[]'::jsonb))
$function$;

COMMIT;
