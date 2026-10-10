-- ==============================================================================
-- Migration: 20261119000001_notifications_history_broadcasts.sql
-- The dashboard's notification history («الإشعارات», «إشعارات المنصة») lists what
-- people sent: a company's admins and supervisors, and the platform. The personal
-- notices the system sends one student about their own subscription («تم تفعيل
-- اشتراكك», «استلمنا إثبات الدفع», «ينتهي اشتراكك…») stay in that student's app
-- and no longer appear here. They are recognised the way notify_student() writes
-- them: sender_role 'system' and an audience of kind 'user'.
-- Only the two history functions change; the notifications themselves are kept.
-- ==============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_notifications_page(p_company_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_items jsonb;
  v_count integer;
BEGIN
  IF NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'لا يمكنك عرض إشعارات هذه الشركة.';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb), count(*) INTO v_items, v_count
  FROM (
    SELECT n.id, n.type, n.category, n.priority, n.title, n.body, n.created_at, n.scheduled_at, n.sent_at,
           n.status, n.status_note, n.sender_role, n.sender_name, n.audience, n.audience_spec, n.line_id,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student) AS students,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student AND r.read_at IS NOT NULL) AS read,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student AND r.opened_at IS NOT NULL) AS opened,
           (SELECT jsonb_build_object(
              'devices', count(*),
              'queued', count(*) FILTER (WHERE o.status IN ('queued', 'sending')),
              'accepted', count(*) FILTER (WHERE o.status = 'accepted'),
              'failed', count(*) FILTER (WHERE o.status IN ('failed', 'expired')),
              'skipped', count(*) FILTER (WHERE o.status = 'skipped'))
            FROM public.push_outbox o WHERE o.notification_id = n.id) AS push
    FROM public.notifications n
    WHERE n.company_id = p_company_id
      AND (p_before IS NULL OR n.created_at < p_before)
      AND (p_status IS NULL OR n.status = p_status)
      -- Never sent and not scheduled: a send that found nobody and was rolled forward.
      AND NOT (n.status = 'failed' AND n.scheduled_at IS NULL)
      -- What people sent; a student's own automatic notices stay in their app.
      AND n.sender_role IS DISTINCT FROM 'system'
      AND COALESCE(n.audience_spec->>'kind', '') <> 'user'
    ORDER BY n.created_at DESC
    LIMIT v_limit + 1
  ) x;
  IF v_count > v_limit THEN
    -- The extra row only says there is more.
    v_items := v_items - v_limit;
  END IF;
  RETURN jsonb_build_object('items', v_items,
    'next_before', CASE WHEN v_count > v_limit THEN (v_items->(v_limit - 1))->>'created_at' END,
    'push_configured', (SELECT r.configured FROM public.push_runtime r WHERE r.id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_platform_notifications_page(p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 30, p_status text DEFAULT NULL::text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_items jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'هذه الصفحة لإدارة المنصة فقط.'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb), count(*) INTO v_items, v_count
  FROM (
    SELECT n.id, n.company_id, c.name AS company_name, n.type, n.category, n.priority, n.title, n.body, n.created_at,
           n.scheduled_at, n.sent_at, n.status, n.status_note, n.sender_role, n.sender_name, n.audience,
           n.audience_spec, n.line_id,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student) AS students,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student AND r.read_at IS NOT NULL) AS read,
           (SELECT count(*) FROM public.notification_recipients r
            WHERE r.notification_id = n.id AND r.is_student AND r.opened_at IS NOT NULL) AS opened,
           (SELECT jsonb_build_object(
              'devices', count(*),
              'queued', count(*) FILTER (WHERE o.status IN ('queued', 'sending')),
              'accepted', count(*) FILTER (WHERE o.status = 'accepted'),
              'failed', count(*) FILTER (WHERE o.status IN ('failed', 'expired')),
              'skipped', count(*) FILTER (WHERE o.status = 'skipped'))
            FROM public.push_outbox o WHERE o.notification_id = n.id) AS push
    FROM public.notifications n
    JOIN public.companies c ON c.id = n.company_id
    WHERE (p_company_id IS NULL OR n.company_id = p_company_id)
      AND (p_before IS NULL OR n.created_at < p_before)
      AND (p_status IS NULL OR n.status = p_status)
      AND NOT (n.status = 'failed' AND n.scheduled_at IS NULL)
      -- What people sent; a student's own automatic notices stay in their app.
      AND n.sender_role IS DISTINCT FROM 'system'
      AND COALESCE(n.audience_spec->>'kind', '') <> 'user'
    ORDER BY n.created_at DESC
    LIMIT v_limit + 1
  ) x;
  IF v_count > v_limit THEN v_items := v_items - v_limit; END IF;
  RETURN jsonb_build_object('items', v_items,
    'next_before', CASE WHEN v_count > v_limit THEN (v_items->(v_limit - 1))->>'created_at' END,
    'push', (SELECT jsonb_build_object(
        'configured', (SELECT r.configured FROM public.push_runtime r WHERE r.id),
        'devices', (SELECT count(*) FROM public.push_devices d WHERE d.disabled_at IS NULL),
        'ios', (SELECT count(*) FROM public.push_devices d WHERE d.disabled_at IS NULL AND d.platform = 'ios'),
        'android', (SELECT count(*) FROM public.push_devices d WHERE d.disabled_at IS NULL AND d.platform = 'android'),
        'queued', (SELECT count(*) FROM public.push_outbox o WHERE o.status IN ('queued', 'sending')),
        'accepted_24h', (SELECT count(*) FROM public.push_outbox o
                         WHERE o.status = 'accepted' AND o.updated_at > now() - interval '24 hours'),
        'failed_24h', (SELECT count(*) FROM public.push_outbox o
                       WHERE o.status IN ('failed', 'expired') AND o.updated_at > now() - interval '24 hours'))));
END;
$function$;

COMMIT;
