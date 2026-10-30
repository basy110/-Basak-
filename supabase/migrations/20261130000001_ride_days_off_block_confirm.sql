-- ==============================================================================
-- Migration: 20261130000001_ride_days_off_block_confirm.sql
-- Run AFTER 20261021000001. Safe to re-run.
--
-- The company's days off (weekly, e.g. Friday, and holiday dates) now close the
-- ride CONFIRMATION too, not only the reminders: a student cannot confirm a ride
-- for a day the company does not operate. So on Thursday nobody confirms riding
-- on a Friday that is off.
-- ==============================================================================
BEGIN;

-- Whether [p_ride_date] is one of the company's days off (its own, or the
-- platform's when it sets none). Weekdays are ISO (1 = Monday ... 7 = Sunday).
CREATE OR REPLACE FUNCTION public.is_ride_day_off(p_ride_date date, p_company_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    EXTRACT(ISODOW FROM p_ride_date)::int = ANY(d.off_weekdays) OR p_ride_date = ANY(d.off_dates),
    false)
  FROM public.vote_reminder_days(p_company_id) d
$$;
REVOKE ALL ON FUNCTION public.is_ride_day_off(date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_ride_day_off(date, uuid) TO authenticated, service_role;

-- toggle_student_daily_ride, with the day-off check added before the window.
CREATE OR REPLACE FUNCTION public.toggle_student_daily_ride(
  p_ride_date date, p_is_riding boolean, p_departure_time time, p_return_time time, p_is_returning boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_student_id uuid := auth.uid();
  v_sub record;
  v_departure_times time[];
  v_return_times time[];
  v_local_now timestamp := now() AT TIME ZONE 'Africa/Cairo';
BEGIN
  IF v_student_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT sub.* INTO v_sub
  FROM public.subscriptions sub
  JOIN public.stations st ON st.id = sub.station_id
  JOIN public.lines l ON l.id = sub.line_id
  WHERE sub.student_id = v_student_id AND sub.status = 'active'
    AND (sub.start_date IS NULL OR sub.start_date <= p_ride_date)
    AND (sub.end_date IS NULL OR sub.end_date >= p_ride_date)
    AND st.is_active = true AND l.is_active = true
  ORDER BY sub.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد اشتراك نشط لهذا التاريخ.'; END IF;

  -- A day off: no bus runs, so no one confirms a ride for it.
  IF p_is_riding AND public.is_ride_day_off(p_ride_date, v_sub.company_id) THEN
    RAISE EXCEPTION 'يوم إجازة: لا يوجد تشغيل في هذا اليوم.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.vote_window(p_ride_date, v_sub.company_id) w
                 WHERE v_local_now >= w.opens AND v_local_now < w.closes) THEN
    -- Open, but for another day: the app is showing a stale date.
    IF EXISTS (SELECT 1 FROM (VALUES (v_local_now::date), (v_local_now::date + 1)) AS d(day),
                 LATERAL public.vote_window(d.day, v_sub.company_id) w
               WHERE v_local_now >= w.opens AND v_local_now < w.closes) THEN
      RAISE EXCEPTION 'اختر تاريخ الرحلة المتاح للتصويت.';
    END IF;
    RAISE EXCEPTION 'التصويت مغلق الآن. %', public.vote_window_text(v_sub.company_id);
  END IF;

  SELECT array_agg(DISTINCT s.stop_time) FILTER (WHERE t.direction = 'departure'),
         array_agg(DISTINCT s.stop_time) FILTER (WHERE t.direction = 'return')
  INTO v_departure_times, v_return_times
  FROM public.line_trips t JOIN public.line_trip_stops s ON s.trip_id = t.id AND s.station_id = v_sub.station_id
  WHERE t.line_id = v_sub.line_id AND public.trip_serves_student(t, v_student_id);
  v_departure_times := COALESCE(v_departure_times, '{}') || v_sub.departure_time;
  v_return_times := COALESCE(v_return_times, '{}') || v_sub.return_time;

  IF p_is_riding THEN
    IF p_departure_time IS NULL OR NOT (p_departure_time = ANY(v_departure_times)) THEN
      RAISE EXCEPTION 'اختر موعد ذهاب متاحاً.';
    END IF;
    IF p_is_returning AND (p_return_time IS NULL OR NOT (p_return_time = ANY(v_return_times))) THEN
      RAISE EXCEPTION 'اختر موعد عودة متاحاً أو ألغِ رحلة العودة.';
    END IF;
  END IF;

  INSERT INTO public.daily_ride_status(student_id, ride_date, is_riding, departure_time, return_time, is_returning, toggled_at)
  VALUES (v_student_id, p_ride_date, p_is_riding, p_departure_time,
          CASE WHEN p_is_returning THEN p_return_time ELSE NULL END, p_is_returning, now())
  ON CONFLICT (student_id, ride_date) DO UPDATE SET is_riding = EXCLUDED.is_riding,
    departure_time = EXCLUDED.departure_time, return_time = EXCLUDED.return_time,
    is_returning = EXCLUDED.is_returning, toggled_at = now();

  RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'ride_date', p_ride_date,
    'is_riding', p_is_riding, 'departure_time', p_departure_time,
    'return_time', CASE WHEN p_is_returning THEN p_return_time ELSE NULL END,
    'is_returning', p_is_returning, 'toggled_at', now());
END;
$$;

COMMIT;
