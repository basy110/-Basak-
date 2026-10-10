-- ==============================================================================
-- Migration: 20261119000006_daily_ticket_notices.sql
-- Audit NOTIF-01. A daily (cash) ticket ends the day it is used, so every daily
-- rider got «انتهى اشتراكك» the next morning. The daily notices now skip daily
-- tickets (notify_subscription_change, redefined in 20261119000003, skips them
-- too). The rest of notifications_daily() is unchanged.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.notifications_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := public.cairo_today();
  v_sub record;
BEGIN
  FOR v_sub IN SELECT s.id, s.company_id, s.student_id, s.end_date FROM public.subscriptions s
               WHERE s.status = 'active' AND s.type <> 'daily' AND s.end_date IN (v_today + 3, v_today - 1) LOOP
    PERFORM public.notify_student(v_sub.company_id, v_sub.student_id,
      CASE WHEN v_sub.end_date > v_today THEN 'subscription.expiring' ELSE 'subscription.expired' END,
      jsonb_build_object('subscription_id', v_sub.id),
      CASE WHEN v_sub.end_date > v_today THEN 'expiring:' ELSE 'expired:' END || v_sub.id);
  END LOOP;
  -- The app shows 90 days; the dashboard keeps half a year.
  DELETE FROM public.notifications
  WHERE status <> 'scheduled' AND COALESCE(sent_at, created_at) < now() - interval '180 days';
  DELETE FROM public.push_outbox WHERE created_at < now() - interval '30 days';
  DELETE FROM public.push_devices WHERE last_seen_at < now() - interval '180 days';
  DELETE FROM public.notification_audit WHERE at < now() - interval '2 years';
  PERFORM public.storage_cleanup_kick();
END;
$function$;

COMMIT;
