-- ==============================================================================
-- Migration: 20261202000001_company_finance.sql
-- A company's own finances (its dashboard, not the platform's): the monthly
-- salary of each supervisor, the company's expenses (recurring per day/month/
-- term, or a one-off such as a bus repair), and a profit-and-loss over a date
-- range (income from issued receipts minus the expenses, normalised to the range).
-- ==============================================================================
BEGIN;

-- 1. Supervisor salary (amount + how often it is paid).
ALTER TABLE public.supervisors
  ADD COLUMN IF NOT EXISTS salary numeric(12, 2) CHECK (salary IS NULL OR salary >= 0),
  ADD COLUMN IF NOT EXISTS salary_period text CHECK (salary_period IN ('daily', 'monthly', 'termly'));

-- 2. Company expenses: a bus/driver cost paid per period, or a one-off.
CREATE TABLE IF NOT EXISTS public.company_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  period text NOT NULL CHECK (period IN ('once', 'daily', 'monthly', 'termly')),
  spent_on date,  -- the day a one-off was paid; the effective day of a recurring one
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS company_expenses_company_idx ON public.company_expenses(company_id);

ALTER TABLE public.company_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_expenses_read ON public.company_expenses;
CREATE POLICY company_expenses_read ON public.company_expenses FOR SELECT TO authenticated
  USING (public.current_admin_role() = 'super_admin' OR company_id = (SELECT a.company_id FROM public.admins a WHERE a.id = auth.uid()));

-- The admin's own company (company admins only); null otherwise.
CREATE OR REPLACE FUNCTION public.my_admin_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.company_id FROM public.admins a WHERE a.id = auth.uid() AND a.role = 'company_admin'
$$;
REVOKE ALL ON FUNCTION public.my_admin_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_admin_company_id() TO authenticated, service_role;

-- 3. Add / delete an expense (the company's own admins).
CREATE OR REPLACE FUNCTION public.add_company_expense(
  p_label text, p_amount numeric, p_period text, p_spent_on date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.my_admin_company_id(); v_id uuid;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'متاح لمدير الشركة فقط.' USING ERRCODE = '42501'; END IF;
  IF p_period NOT IN ('once', 'daily', 'monthly', 'termly') THEN RAISE EXCEPTION 'نوع المصروف غير صحيح.'; END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN RAISE EXCEPTION 'أدخل مبلغاً صحيحاً.'; END IF;
  IF char_length(trim(COALESCE(p_label, ''))) = 0 THEN RAISE EXCEPTION 'اكتب اسم المصروف.'; END IF;
  INSERT INTO public.company_expenses(company_id, label, amount, period, spent_on, created_by)
  VALUES (v_company, trim(p_label), p_amount, p_period,
          CASE WHEN p_period = 'once' THEN COALESCE(p_spent_on, public.cairo_today()) ELSE p_spent_on END, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.add_company_expense(text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_company_expense(text, numeric, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_company_expense(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid := public.my_admin_company_id();
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'متاح لمدير الشركة فقط.' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.company_expenses WHERE id = p_id AND company_id = v_company;
  RETURN jsonb_build_object('deleted', FOUND);
END; $$;
REVOKE ALL ON FUNCTION public.delete_company_expense(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_company_expense(uuid) TO authenticated;

-- 4. Profit and loss over [p_from, p_to]: income from receipts issued in the
-- range, minus the salaries and expenses normalised to it (a month ≈ 30.44 days,
-- a term ≈ 120 days; a one-off counts only if it was paid inside the range).
CREATE OR REPLACE FUNCTION public.get_company_finance(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company uuid := public.my_admin_company_id();
  v_days numeric;
  v_income numeric;
  v_salaries jsonb;
  v_expenses jsonb;
  v_salary_total numeric;
  v_expense_total numeric;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'متاح لمدير الشركة فقط.' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'اختر مدى تاريخ صحيحاً.'; END IF;
  v_days := (p_to - p_from) + 1;

  SELECT COALESCE(sum(r.amount), 0) INTO v_income
  FROM public.subscription_receipts r
  WHERE r.company_id = v_company AND (r.issued_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to;

  -- Each recurring amount scaled to the range; a one-off only on its day.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'label'), '[]'::jsonb), COALESCE(sum((x->>'cost')::numeric), 0)
  INTO v_expenses, v_expense_total
  FROM (
    SELECT jsonb_build_object('id', e.id, 'label', e.label, 'period', e.period, 'amount', e.amount,
      'spent_on', e.spent_on,
      'cost', round(CASE e.period
        WHEN 'once' THEN CASE WHEN e.spent_on BETWEEN p_from AND p_to THEN e.amount ELSE 0 END
        WHEN 'daily' THEN e.amount * v_days
        WHEN 'monthly' THEN e.amount * (v_days / 30.44)
        WHEN 'termly' THEN e.amount * (v_days / 120.0)
      END, 2)) AS x
    FROM public.company_expenses e WHERE e.company_id = v_company
  ) q;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb), COALESCE(sum((x->>'cost')::numeric), 0)
  INTO v_salaries, v_salary_total
  FROM (
    SELECT jsonb_build_object('id', s.id, 'name', s.full_name, 'period', s.salary_period, 'amount', s.salary,
      'cost', round(CASE s.salary_period
        WHEN 'daily' THEN s.salary * v_days
        WHEN 'monthly' THEN s.salary * (v_days / 30.44)
        WHEN 'termly' THEN s.salary * (v_days / 120.0)
      END, 2)) AS x
    FROM public.supervisors s
    WHERE s.company_id = v_company AND s.is_active AND s.salary IS NOT NULL AND s.salary > 0 AND s.salary_period IS NOT NULL
  ) q;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'income', round(v_income, 2),
    'salaries', v_salaries, 'salary_total', round(v_salary_total, 2),
    'expenses', v_expenses, 'expense_total', round(v_expense_total, 2),
    'cost_total', round(v_salary_total + v_expense_total, 2),
    'net', round(v_income - v_salary_total - v_expense_total, 2));
END; $$;
REVOKE ALL ON FUNCTION public.get_company_finance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_company_finance(date, date) TO authenticated;

COMMIT;
