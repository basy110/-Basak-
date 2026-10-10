-- ==============================================================================
-- Migration: 20261119000003_receipt_rejection_notice.sql
-- Run AFTER 20261119000001_notifications_history_broadcasts.sql. Safe to re-run.
-- Additive only: no table, column or policy is removed.
--
-- A rejected payment receipt now tells its student.
--   Before: review_receipt() sets the receipt to 'rejected' and the review trigger
--   moves the subscription back to 'pending_payment'. notify_subscription_change()
--   has no notice for 'pending_payment', so the student heard nothing, and the
--   'subscription.rejected' template was unreachable.
--   Now:
--   1. notify_student() fills {key} placeholders in a template's title and body
--      from the values in p_data (templates without placeholders read as before).
--   2. 'subscription.rejected' reads «رُفض إيصال الدفع» /
--      «السبب: {reason}. ارفع إيصالاً جديداً من صفحة اشتراكك.»
--   3. AFTER UPDATE OF status ON receipts: a receipt that becomes 'rejected' sends
--      'subscription.rejected' to the subscription's student with
--      {subscription_id, receipt_id, reason, attempt}, once per receipt
--      (idempotency key 'receipt-rejected:<receipt id>').
--   4. notify_subscription_change(): a daily cash ticket that ends says nothing
--      (audit NOTIF-01; 'expired:<id>' stays the key of the other endings). A
--      subscription itself set to 'rejected'
--      (legacy status) fills {reason} from its latest rejected receipt and shares
--      the same key, so the student never gets the notice twice. Approvals are
--      untouched: 'subscription.approved' is still sent once, by the subscription
--      turning 'active'.
--
-- Storage: the student already reads their own receipt image
-- ("Scoped receipt image access": bucket 'receipts', first folder = auth.uid()),
-- so no policy is added here.
-- ==============================================================================
BEGIN;

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

COMMIT;
