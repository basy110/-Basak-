-- ==============================================================================
-- e2e: a rejected receipt tells its student (20261119000003_receipt_rejection_notice.sql)
-- Runs the migration and the checks in one transaction and rolls everything back.
-- Run with the Supabase MCP execute_sql (as postgres) or psql against a copy.
-- Every check raises on failure; the last SELECT prints what was observed.
-- ==============================================================================
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '45s';

-- ------------------------------------------------------------------------------
-- 1. notify_student(): placeholders from p_data
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_student(
  p_company uuid, p_student uuid, p_template text, p_data jsonb, p_idempotency_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t public.notification_templates%ROWTYPE;
  v_id uuid;
  v_duplicate boolean;
  v_kv record;
BEGIN
  SELECT * INTO v_t FROM public.notification_templates WHERE key = p_template;
  IF NOT FOUND OR p_company IS NULL OR p_student IS NULL THEN RETURN; END IF;
  -- {key} in a template takes the value of p_data->>key (strings and numbers).
  IF p_data IS NOT NULL AND jsonb_typeof(p_data) = 'object' THEN
    FOR v_kv IN SELECT key, value FROM jsonb_each_text(p_data) WHERE value IS NOT NULL LOOP
      v_t.title_ar := replace(v_t.title_ar, '{' || v_kv.key || '}', v_kv.value);
      v_t.body_ar  := replace(v_t.body_ar,  '{' || v_kv.key || '}', v_kv.value);
      v_t.title_en := replace(v_t.title_en, '{' || v_kv.key || '}', v_kv.value);
      v_t.body_en  := replace(v_t.body_en,  '{' || v_kv.key || '}', v_kv.value);
    END LOOP;
  END IF;
  SELECT o_id, o_duplicate INTO v_id, v_duplicate FROM public.notification_create(
    p_company, NULL, 'system', (SELECT c.name FROM public.companies c WHERE c.id = p_company),
    v_t.key, v_t.category, v_t.priority, v_t.title_ar, v_t.body_ar, v_t.title_en, v_t.body_en,
    jsonb_build_object('kind', 'user', 'user_id', p_student, 'label', 'إشعار شخصي'),
    jsonb_build_object('route', v_t.route) || COALESCE(p_data, '{}'::jsonb), NULL, p_idempotency_key);
  IF v_duplicate THEN RETURN; END IF;
  IF public.notification_deliver(v_id) = 0 THEN
    DELETE FROM public.notifications WHERE id = v_id;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_student(%) failed: %', p_template, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_student(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. The template's words
-- ------------------------------------------------------------------------------
UPDATE public.notification_templates
SET title_ar = 'رُفض إيصال الدفع',
    body_ar  = 'السبب: {reason}. ارفع إيصالاً جديداً من صفحة اشتراكك.',
    title_en = 'Payment receipt rejected',
    body_en  = 'Reason: {reason}. Upload a new receipt from your subscription page.'
WHERE key = 'subscription.rejected';

-- The reason as it reads inside the sentence: trimmed, no closing full stop, short.
CREATE OR REPLACE FUNCTION public.receipt_rejection_reason_text(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(left(regexp_replace(btrim(COALESCE(p_reason, '')), '[[:space:].،,؛;]+$', ''), 400), ''),
    'لم يُذكر');
$$;
REVOKE ALL ON FUNCTION public.receipt_rejection_reason_text(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. A receipt turning 'rejected' tells its student
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_receipt_rejected() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sub record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'rejected' THEN RETURN NULL; END IF;
  SELECT s.id, s.company_id, s.student_id INTO v_sub FROM public.subscriptions s WHERE s.id = NEW.subscription_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.notify_student(COALESCE(v_sub.company_id, NEW.company_id), v_sub.student_id, 'subscription.rejected',
    jsonb_build_object('subscription_id', v_sub.id, 'receipt_id', NEW.id,
                       'reason', public.receipt_rejection_reason_text(NEW.rejection_reason),
                       'attempt', NEW.attempt_number),
    'receipt-rejected:' || NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_receipt_rejected failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_receipt_rejected() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_notify_receipt_rejected AFTER UPDATE OF status ON public.receipts
  FOR EACH ROW EXECUTE FUNCTION public.notify_receipt_rejected();

-- ------------------------------------------------------------------------------
-- 4. A subscription changing state tells its student (as 20261031000001; the
--    'rejected' notice now carries the reason and is told once per receipt).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_subscription_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_template text;
  v_data jsonb;
  v_key text;
  v_receipt record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  v_template := CASE NEW.status
    WHEN 'pending_review' THEN 'subscription.payment_received'
    WHEN 'active' THEN 'subscription.approved'
    WHEN 'rejected' THEN 'subscription.rejected'
    WHEN 'expired' THEN 'subscription.expired'
  END;
  IF v_template IS NULL THEN RETURN NULL; END IF;
  -- A daily cash ticket ends the day after its ride: nothing to tell (NOTIF-01).
  IF v_template = 'subscription.expired' AND NEW.type = 'daily' THEN RETURN NULL; END IF;
  v_data := jsonb_build_object('subscription_id', NEW.id);
  -- The ending is told once, whether the status changes or the day passes first.
  v_key := CASE WHEN v_template = 'subscription.expired' THEN 'expired:' || NEW.id END;
  IF v_template = 'subscription.rejected' THEN
    SELECT r.id, r.rejection_reason, r.attempt_number INTO v_receipt
    FROM public.receipts r
    WHERE r.subscription_id = NEW.id AND r.status = 'rejected'
    ORDER BY r.attempt_number DESC NULLS LAST, r.created_at DESC
    LIMIT 1;
    IF FOUND THEN
      v_data := v_data || jsonb_build_object('receipt_id', v_receipt.id,
        'reason', public.receipt_rejection_reason_text(v_receipt.rejection_reason),
        'attempt', v_receipt.attempt_number);
      v_key := 'receipt-rejected:' || v_receipt.id;
    ELSE
      v_data := v_data || jsonb_build_object('reason', public.receipt_rejection_reason_text(NULL));
      v_key := 'subscription-rejected:' || NEW.id;
    END IF;
  END IF;
  PERFORM public.notify_student(NEW.company_id, NEW.student_id, v_template, v_data, v_key);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_subscription_change failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_subscription_change() FROM PUBLIC, anon, authenticated;
-- trg_notify_subscription_change (20261031000001) already calls it.

-- ------------------------------------------------------------------------------
-- Fixture: a real non-daily subscription still in its period (one whose student
-- has a device first), put back to 'pending_payment' with a fresh pending receipt.
-- ------------------------------------------------------------------------------
CREATE TEMP TABLE e2e(k text PRIMARY KEY, v text);
GRANT ALL ON e2e TO authenticated;

DO $$
DECLARE
  v_sub record;
  v_admin uuid;
  v_receipt uuid;
BEGIN
  -- A subscription that is not active now (reopening an active one trips other
  -- triggers), in its period, with room for two more attempts.
  SELECT s.id, s.student_id, s.company_id, s.start_date, s.end_date INTO v_sub
  FROM public.subscriptions s
  WHERE s.type <> 'daily' AND s.end_date >= public.cairo_today()
    AND s.status IN ('expired', 'pending_payment', 'rejected')
    AND (SELECT COALESCE(max(r.attempt_number), 0) FROM public.receipts r WHERE r.subscription_id = s.id) <= 2
    AND EXISTS (SELECT 1 FROM public.admins a WHERE a.company_id = s.company_id AND a.role = 'company_admin'
                AND public.company_is_active(a.company_id))
  ORDER BY (SELECT count(*) FROM public.push_devices d WHERE d.user_id = s.student_id AND d.disabled_at IS NULL) DESC,
           s.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no fixture subscription'; END IF;
  SELECT a.id INTO v_admin FROM public.admins a
  WHERE a.company_id = v_sub.company_id AND a.role = 'company_admin' AND public.company_is_active(a.company_id) LIMIT 1;

  -- Its overlapping open subscriptions step aside (one open per period).
  UPDATE public.subscriptions SET status = 'expired'
  WHERE student_id = v_sub.student_id AND id <> v_sub.id AND status IN ('pending_payment', 'pending_review', 'active')
    AND start_date <= v_sub.end_date AND end_date >= v_sub.start_date;
  UPDATE public.subscriptions SET status = 'pending_payment' WHERE id = v_sub.id AND status <> 'pending_payment';
  UPDATE public.receipts SET status = 'rejected', rejection_reason = COALESCE(rejection_reason, 'e2e')
  WHERE subscription_id = v_sub.id AND status = 'pending';
  INSERT INTO public.receipts(subscription_id, image_url)
  VALUES (v_sub.id, v_sub.student_id || '/' || v_sub.id || '_e2e_reject.jpg')
  RETURNING id INTO v_receipt;

  INSERT INTO e2e VALUES
    ('sub', v_sub.id), ('student', v_sub.student_id), ('company', v_sub.company_id), ('receipt', v_receipt),
    ('claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text),
    ('started', clock_timestamp()::text);
END $$;

-- ------------------------------------------------------------------------------
-- 1. The company admin rejects it through review_receipt (as the dashboard does)
-- ------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT v FROM e2e WHERE k = 'claims'), true);
SELECT public.review_receipt((SELECT v FROM e2e WHERE k = 'receipt')::uuid, 'rejected', '  الصورة غير واضحة.  ') IS NOT NULL AS reviewed;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE
  v_sub uuid := (SELECT v FROM e2e WHERE k = 'sub');
  v_student uuid := (SELECT v FROM e2e WHERE k = 'student');
  v_receipt uuid := (SELECT v FROM e2e WHERE k = 'receipt');
  v_n public.notifications%ROWTYPE;
  v_count int;
  v_devices int;
  v_outbox int;
  v_recipients int;
BEGIN
  IF (SELECT status FROM public.subscriptions WHERE id = v_sub) <> 'pending_payment' THEN
    RAISE EXCEPTION 'subscription should be back to pending_payment';
  END IF;
  SELECT count(*) INTO v_count FROM public.notifications
  WHERE type = 'subscription.rejected' AND data->>'receipt_id' = v_receipt::text;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected 1 rejection notice, got %', v_count; END IF;
  SELECT * INTO v_n FROM public.notifications WHERE type = 'subscription.rejected' AND data->>'receipt_id' = v_receipt::text;
  IF v_n.title <> 'رُفض إيصال الدفع' THEN RAISE EXCEPTION 'title: %', v_n.title; END IF;
  IF v_n.body <> 'السبب: الصورة غير واضحة. ارفع إيصالاً جديداً من صفحة اشتراكك.' THEN RAISE EXCEPTION 'body: %', v_n.body; END IF;
  IF v_n.body_en <> 'Reason: الصورة غير واضحة. Upload a new receipt from your subscription page.' THEN RAISE EXCEPTION 'body_en: %', v_n.body_en; END IF;
  IF v_n.status <> 'sent' OR v_n.sender_role <> 'system' THEN RAISE EXCEPTION 'status %, role %', v_n.status, v_n.sender_role; END IF;
  IF v_n.data->>'route' <> 'subscription' OR v_n.data->>'subscription_id' <> v_sub::text
     OR v_n.data->>'reason' <> 'الصورة غير واضحة' OR (v_n.data->>'attempt')::int < 1 THEN
    RAISE EXCEPTION 'data: %', v_n.data;
  END IF;
  SELECT count(*) INTO v_recipients FROM public.notification_recipients r WHERE r.notification_id = v_n.id;
  IF v_recipients <> 1 OR NOT EXISTS (SELECT 1 FROM public.notification_recipients r
                                      WHERE r.notification_id = v_n.id AND r.user_id = v_student) THEN
    RAISE EXCEPTION 'recipients: %', v_recipients;
  END IF;
  SELECT count(*) INTO v_devices FROM public.push_devices d WHERE d.user_id = v_student AND d.disabled_at IS NULL;
  SELECT count(*) INTO v_outbox FROM public.push_outbox o WHERE o.notification_id = v_n.id AND o.user_id = v_student;
  IF v_outbox <> v_devices THEN RAISE EXCEPTION 'push_outbox % for % devices', v_outbox, v_devices; END IF;
  INSERT INTO e2e VALUES ('reject_notice', v_n.id), ('devices', v_devices), ('outbox', v_outbox), ('body', v_n.body),
                         ('attempt', v_n.data->>'attempt');
END $$;

-- ------------------------------------------------------------------------------
-- 2. No second notice: the subscription itself turning 'rejected' (legacy path)
--    and a repeated status write on the receipt both share the receipt's key.
-- ------------------------------------------------------------------------------
UPDATE public.subscriptions SET status = 'rejected' WHERE id = (SELECT v FROM e2e WHERE k = 'sub')::uuid;
UPDATE public.receipts SET status = 'rejected' WHERE id = (SELECT v FROM e2e WHERE k = 'receipt')::uuid;
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.notifications
  WHERE type = 'subscription.rejected' AND data->>'subscription_id' = (SELECT v FROM e2e WHERE k = 'sub')
    AND created_at >= (SELECT v FROM e2e WHERE k = 'started')::timestamptz;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected still 1 rejection notice, got %', v_count; END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. A new receipt, approved: 'subscription.approved' exactly once, no rejection notice
-- ------------------------------------------------------------------------------
DO $$
DECLARE v_receipt uuid;
BEGIN
  INSERT INTO public.receipts(subscription_id, image_url)
  SELECT s.id, s.student_id || '/' || s.id || '_e2e_approve.jpg'
  FROM public.subscriptions s WHERE s.id = (SELECT v FROM e2e WHERE k = 'sub')::uuid
  RETURNING id INTO v_receipt;
  INSERT INTO e2e VALUES ('receipt2', v_receipt);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', (SELECT v FROM e2e WHERE k = 'claims'), true);
SELECT public.review_receipt((SELECT v FROM e2e WHERE k = 'receipt2')::uuid, 'approved') IS NOT NULL AS approved;
RESET ROLE;
DO $$
DECLARE v_approved int; v_rejected int;
BEGIN
  SELECT count(*) FILTER (WHERE type = 'subscription.approved'),
         count(*) FILTER (WHERE type = 'subscription.rejected')
  INTO v_approved, v_rejected
  FROM public.notifications
  WHERE data->>'subscription_id' = (SELECT v FROM e2e WHERE k = 'sub')
    AND created_at >= (SELECT v FROM e2e WHERE k = 'started')::timestamptz;
  IF v_approved <> 1 THEN RAISE EXCEPTION 'expected 1 approval notice, got %', v_approved; END IF;
  IF v_rejected <> 1 THEN RAISE EXCEPTION 'approval must not add a rejection notice (%)', v_rejected; END IF;
  IF (SELECT status FROM public.subscriptions WHERE id = (SELECT v FROM e2e WHERE k = 'sub')::uuid) <> 'active' THEN
    RAISE EXCEPTION 'subscription should be active';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Templates without placeholders read exactly as before
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT body_ar FROM public.notification_templates WHERE key = 'subscription.approved')
     <> 'اشتراكك أصبح فعّالاً، وبطاقتك جاهزة للاستخدام.' THEN
    RAISE EXCEPTION 'approved template changed';
  END IF;
  IF public.receipt_rejection_reason_text(NULL) <> 'لم يُذكر'
     OR public.receipt_rejection_reason_text(' المبلغ ناقص ، ') <> 'المبلغ ناقص' THEN
    RAISE EXCEPTION 'reason text helper';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. A daily cash ticket that ends tells nothing (NOTIF-01); a termly one still does
-- ------------------------------------------------------------------------------
DO $$
DECLARE v_daily uuid; v_count int;
BEGIN
  -- The fixture (termly, active now) ending still tells its student, once.
  UPDATE public.subscriptions SET status = 'expired' WHERE id = (SELECT v FROM e2e WHERE k = 'sub')::uuid;
  SELECT count(*) INTO v_count FROM public.notifications
  WHERE type = 'subscription.expired' AND idempotency_key = 'expired:' || (SELECT v FROM e2e WHERE k = 'sub');
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected 1 expiry notice for the termly one, got %', v_count; END IF;

  -- A daily ticket never told of its end before: an open one, else another
  -- subscription made one (where the company sells daily rides).
  SELECT s.id INTO v_daily FROM public.subscriptions s
  WHERE s.type = 'daily' AND s.status <> 'expired'
    AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.idempotency_key = 'expired:' || s.id)
  LIMIT 1;
  IF v_daily IS NULL THEN
    SELECT s.id INTO v_daily FROM public.subscriptions s
    WHERE s.type <> 'daily' AND s.status = 'expired' AND s.id <> (SELECT v FROM e2e WHERE k = 'sub')::uuid
      AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.idempotency_key = 'expired:' || s.id)
    ORDER BY s.created_at DESC LIMIT 1;
    -- 'rejected' is outside the one-open-subscription rule; daily rides are
    -- switched on for its company inside this transaction only.
    IF v_daily IS NOT NULL THEN
      UPDATE public.app_settings SET daily_subscription_enabled = true WHERE id;
      UPDATE public.companies SET daily_subscription_enabled = true
      WHERE id = (SELECT company_id FROM public.subscriptions WHERE id = v_daily);
      UPDATE public.subscriptions
      SET type = 'daily', period_code = NULL, academic_year = NULL, end_date = start_date, status = 'rejected'
      WHERE id = v_daily;
    END IF;
  END IF;
  IF v_daily IS NULL THEN
    RAISE NOTICE 'no daily subscription can be made here: NOTIF-01 not exercised';
    RETURN;
  END IF;
  UPDATE public.subscriptions SET status = 'expired' WHERE id = v_daily;
  SELECT count(*) INTO v_count FROM public.notifications
  WHERE type = 'subscription.expired' AND data->>'subscription_id' = v_daily::text;
  IF v_count <> 0 THEN RAISE EXCEPTION 'a daily ticket ending sent % expiry notices', v_count; END IF;
  INSERT INTO e2e VALUES ('daily_checked', v_daily);
END $$;

SELECT k, v FROM e2e WHERE k IN ('reject_notice', 'devices', 'outbox', 'body', 'attempt', 'daily_checked') ORDER BY k;

ROLLBACK;
