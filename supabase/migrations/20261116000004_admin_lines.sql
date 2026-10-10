-- ==============================================================================
-- Migration: 20261116000004_admin_lines.sql
-- Run AFTER 20261115000001. Safe to re-run. Additive only: two new functions.
-- save_line, set_line_bus_capacity, delete_line and set_line_active are not
-- touched, so the dashboard now in production keeps working.
--
-- The redesigned dashboard's lines pages (docs/canvas/AdmLines*, AdmLine*):
--
--   * save_line_full(p_line jsonb) → uuid
--       The whole line in ONE all-or-nothing request: what save_line saves
--       (details, universities, stations, trips, stop times), plus the price and
--       on/off switch of each subscription option (line_period_prices) and the
--       bus capacity. Until now these were three requests, and a failure after
--       the first left a half-saved line. Same permission checks and Arabic
--       messages as save_line (it is called inside), plus:
--         p_line.prices        [{option, price, is_enabled}, …]  (missing = untouched)
--         p_line.bus_capacity  1–500 or null to clear               (missing key = untouched)
--       An option switched on needs a price above zero; nothing is pre-filled.
--
--   * admin_lines_overview(p_company_id uuid) → jsonb
--       What the lines list and a line's page show next to the timetable, read
--       in one request: per line the running subscribers, tomorrow's confirmed
--       riders (going and return, and per trip), the current subscribers per
--       station and per trip (what removing one of them would touch), the bus
--       capacity, and whether the line has history (delete_line's rule).
--       Also the ride date those riders are for and its confirmation window.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.save_line_full(p_line jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prices jsonb := COALESCE(p_line->'prices', 'null'::jsonb);
  v_price jsonb;
  v_option text;
  v_amount numeric;
  v_seen text[] := '{}';
  v_names constant jsonb := '{"first": "الفصل الأول", "second": "الفصل الثاني", "both": "الفصلان معاً", "summer": "الفصل الصيفي"}';
  v_capacity integer;
  v_line jsonb := p_line;
  v_line_id uuid;
  v_old_termly numeric;
  v_old_yearly numeric;
BEGIN
  IF p_line IS NULL OR jsonb_typeof(p_line) <> 'object' THEN
    RAISE EXCEPTION 'بيانات الخط غير مكتملة.' USING ERRCODE = '22023';
  END IF;

  -- ---- prices: checked before anything is written ----------------------------
  IF v_prices <> 'null'::jsonb THEN
    IF jsonb_typeof(v_prices) <> 'array' THEN
      RAISE EXCEPTION 'أسعار الخط غير صحيحة.' USING ERRCODE = '22023';
    END IF;
    FOR v_price IN SELECT * FROM jsonb_array_elements(v_prices) LOOP
      v_option := v_price->>'option';
      IF v_option IS NULL OR NOT (v_option = ANY (ARRAY['first', 'second', 'both', 'summer'])) THEN
        RAISE EXCEPTION 'نوع اشتراك غير معروف في أسعار الخط.' USING ERRCODE = '23514';
      END IF;
      IF v_option = ANY (v_seen) THEN
        RAISE EXCEPTION 'سعر «%» مكرر.', v_names->>v_option USING ERRCODE = '23514';
      END IF;
      v_seen := v_seen || v_option;
      IF NULLIF(v_price->>'price', '') IS NOT NULL AND (v_price->>'price') !~ '^\s*\d+(\.\d+)?\s*$' THEN
        RAISE EXCEPTION 'سعر «%» يجب أن يكون رقماً.', v_names->>v_option USING ERRCODE = '23514';
      END IF;
      v_amount := NULLIF(v_price->>'price', '')::numeric;
      IF COALESCE((v_price->>'is_enabled')::boolean, false) AND COALESCE(v_amount, 0) <= 0 THEN
        RAISE EXCEPTION 'اكتب سعر «%» أو أوقف بيعه على هذا الخط.', v_names->>v_option USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- ---- bus capacity ------------------------------------------------------------
  IF p_line ? 'bus_capacity' AND NULLIF(p_line->>'bus_capacity', '') IS NOT NULL THEN
    IF (p_line->>'bus_capacity') !~ '^\s*\d+\s*$' OR (p_line->>'bus_capacity')::numeric NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'عدد مقاعد الباص من 1 إلى 500، أو اتركه فارغاً.' USING ERRCODE = '23514';
    END IF;
    v_capacity := (p_line->>'bus_capacity')::integer;
  END IF;

  -- The two older price columns follow the options (older clients read them);
  -- an option not sent keeps the line's own value (a trigger copies these
  -- columns back into line_period_prices, so a 0 here would wipe its price).
  IF v_prices <> 'null'::jsonb THEN
    SELECT l.price_termly, l.price_yearly INTO v_old_termly, v_old_yearly
    FROM public.lines l WHERE l.id = NULLIF(p_line->>'id', '')::uuid;
    v_line := v_line || jsonb_build_object(
      'price_termly', COALESCE(NULLIF(p_line->>'price_termly', '')::numeric,
        (SELECT NULLIF(x->>'price', '')::numeric FROM jsonb_array_elements(v_prices) x WHERE x->>'option' = 'first'), v_old_termly, 0),
      'price_yearly', COALESCE(NULLIF(p_line->>'price_yearly', '')::numeric,
        (SELECT NULLIF(x->>'price', '')::numeric FROM jsonb_array_elements(v_prices) x WHERE x->>'option' = 'both'), v_old_yearly, 0));
  END IF;
  IF NULLIF(v_line->>'price_daily', '') IS NULL THEN
    v_line := v_line || jsonb_build_object('price_daily', 0);
  END IF;

  -- ---- the line itself: permissions, validation, stations, trips -------------
  v_line_id := public.save_line(v_line);

  IF v_prices <> 'null'::jsonb THEN
    INSERT INTO public.line_period_prices (line_id, company_id, option, price, is_enabled)
    SELECT v_line_id, l.company_id, x->>'option', COALESCE(NULLIF(x->>'price', '')::numeric, 0),
           COALESCE((x->>'is_enabled')::boolean, false)
    FROM jsonb_array_elements(v_prices) x CROSS JOIN public.lines l
    WHERE l.id = v_line_id
    ON CONFLICT (line_id, option) DO UPDATE
      SET price = EXCLUDED.price, is_enabled = EXCLUDED.is_enabled, updated_at = now()
      WHERE line_period_prices.price IS DISTINCT FROM EXCLUDED.price
         OR line_period_prices.is_enabled IS DISTINCT FROM EXCLUDED.is_enabled;
  END IF;

  IF p_line ? 'bus_capacity' THEN
    UPDATE public.lines SET bus_capacity = v_capacity
    WHERE id = v_line_id AND bus_capacity IS DISTINCT FROM v_capacity;
  END IF;

  RETURN v_line_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_line_full(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_line_full(jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_lines_overview(p_company_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.cairo_today();
  v_day date;
  v_opens timestamp;
  v_closes timestamp;
  v_lines uuid[];
  v_out jsonb;
BEGIN
  IF p_company_id IS NULL OR public.can_manage_company(p_company_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'غير مسموح بعرض خطوط هذه الشركة.' USING ERRCODE = '42501';
  END IF;

  v_day := public.next_votable_ride_date(p_company_id);
  SELECT w.opens, w.closes INTO v_opens, v_closes FROM public.vote_window(v_day, p_company_id) w;
  SELECT COALESCE(array_agg(l.id), '{}') INTO v_lines FROM public.lines l WHERE l.company_id = p_company_id;

  WITH choices AS (
    SELECT c.line_id, c.direction, c.trip_id FROM public.rider_trip_choices_in(v_day, v_lines) c
  ),
  riders AS (
    SELECT line_id,
           count(*) FILTER (WHERE direction = 'departure') AS going,
           count(*) FILTER (WHERE direction = 'return') AS back
    FROM choices GROUP BY line_id
  ),
  trip_riders AS (
    SELECT line_id, jsonb_object_agg(trip_id, n) AS m
    FROM (SELECT line_id, trip_id, count(*) AS n FROM choices WHERE trip_id IS NOT NULL GROUP BY line_id, trip_id) t
    GROUP BY line_id
  ),
  -- Valid today and paid: the same «اشتراكات سارية» as the company's overview.
  running AS (
    SELECT s.line_id, count(*) AS n FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.status = 'active' AND s.paid_at IS NOT NULL
      AND (s.start_date IS NULL OR s.start_date <= v_today) AND (s.end_date IS NULL OR s.end_date >= v_today)
    GROUP BY s.line_id
  ),
  -- Subscriptions that still count on a station or a trip (not ended, not rejected).
  current_subs AS (
    SELECT s.line_id, s.station_id, s.departure_trip_id, s.return_trip_id FROM public.subscriptions s
    WHERE s.company_id = p_company_id AND s.status IN ('pending_payment', 'pending_review', 'active')
      AND (s.end_date IS NULL OR s.end_date >= v_today)
  ),
  per_station AS (
    SELECT line_id, jsonb_object_agg(station_id, n) AS m
    FROM (SELECT line_id, station_id, count(*) AS n FROM current_subs WHERE station_id IS NOT NULL GROUP BY 1, 2) x
    GROUP BY line_id
  ),
  per_trip AS (
    SELECT line_id, jsonb_object_agg(trip_id, n) AS m
    FROM (SELECT line_id, trip_id, count(*) AS n FROM (
            SELECT line_id, departure_trip_id AS trip_id FROM current_subs WHERE departure_trip_id IS NOT NULL
            UNION ALL
            SELECT line_id, return_trip_id FROM current_subs WHERE return_trip_id IS NOT NULL) t
          GROUP BY 1, 2) x
    GROUP BY line_id
  )
  SELECT jsonb_build_object(
    'ride_date', v_day,
    'vote_opens', v_opens,
    'vote_closes', v_closes,
    'vote_open', COALESCE((now() AT TIME ZONE 'Africa/Cairo') >= v_opens AND (now() AT TIME ZONE 'Africa/Cairo') < v_closes, false),
    'lines', COALESCE(jsonb_object_agg(l.id, jsonb_build_object(
      'bus_capacity', l.bus_capacity,
      'subscribers', COALESCE(r.n, 0),
      'riders_departure', COALESCE(rd.going, 0),
      'riders_return', COALESCE(rd.back, 0),
      'trip_riders', COALESCE(tr.m, '{}'::jsonb),
      'station_subscribers', COALESCE(ps.m, '{}'::jsonb),
      'trip_subscribers', COALESCE(pt.m, '{}'::jsonb),
      'has_history', EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.line_id = l.id)
        OR EXISTS (SELECT 1 FROM public.supervisor_scan_events e WHERE e.line_id = l.id)
        OR EXISTS (SELECT 1 FROM public.deleted_student_revenue a WHERE a.line_id = l.id)
    )) FILTER (WHERE l.id IS NOT NULL), '{}'::jsonb))
  INTO v_out
  FROM public.lines l
  LEFT JOIN running r ON r.line_id = l.id
  LEFT JOIN riders rd ON rd.line_id = l.id
  LEFT JOIN trip_riders tr ON tr.line_id = l.id
  LEFT JOIN per_station ps ON ps.line_id = l.id
  LEFT JOIN per_trip pt ON pt.line_id = l.id
  WHERE l.company_id = p_company_id;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_lines_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_lines_overview(uuid) TO authenticated;

COMMIT;
