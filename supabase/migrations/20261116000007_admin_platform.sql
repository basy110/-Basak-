-- ==============================================================================
-- Migration: 20261116000007_admin_platform.sql
--
-- The platform admin's pages (docs/canvas/AdmPlatCompanies*, AdmPlatUniversities*).
-- Additive only: one new column with its own trigger and three new read-only
-- functions. Nothing that exists changes; the dashboard now in production keeps
-- working, and the new dashboard works (with less detail) before this is applied.
--
--   companies.status_changed_at   when the company was last suspended, archived or
--       re-activated («موقوفة منذ 2 أكتوبر 2026»). NULL for changes made before
--       this migration. Stamped by its own BEFORE UPDATE trigger.
--   platform_companies()           one light row per company for the list: lines,
--       students, admins, payment methods, whether anything is on sale.
--   platform_company_detail(id)    «هل يستطيع طالب أن يشترك؟» for one company: its
--       lines with why a line is hidden, payment methods, what is / is not on sale,
--       lines without a supervisor, its admins and contact.
--   platform_university_counts()   per university: registered students, lines and
--       the companies whose lines go there; per college: registered students.
--   save_platform_terms(terms)     the default term dates in one statement, checked
--       once and all or nothing (the old page saved them one by one).
--
-- Editing a university's name and city needs nothing new: `universities_super_manage`
-- already lets the platform admin update the row, and `trg_sync_university_name`
-- copies a new name onto the students registered there.
-- ==============================================================================

-- 1. When the status last changed ------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_company_status_change()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Created once (no DROP: re-running the file leaves the trigger as it is).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_stamp_company_status_change'
                 AND tgrelid = 'public.companies'::regclass) THEN
    CREATE TRIGGER trg_stamp_company_status_change
      BEFORE UPDATE OF status ON public.companies
      FOR EACH ROW EXECUTE FUNCTION public.stamp_company_status_change();
  END IF;
END;
$$;

-- 2. The companies list ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_companies()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'status', c.status, 'created_at', c.created_at,
        'status_changed_at', c.status_changed_at,
        'contact_phone', c.contact_phone, 'contact_label', c.contact_label,
        'logo_path', c.logo_path, 'emblem_path', c.emblem_path,
        'lines', (SELECT count(*) FROM public.lines l WHERE l.company_id = c.id),
        'active_lines', (SELECT count(*) FROM public.lines l WHERE l.company_id = c.id AND l.is_active),
        'students', (SELECT count(*) FROM public.company_students m WHERE m.company_id = c.id AND m.status = 'active'),
        'admins', (SELECT count(*) FROM public.admins a WHERE a.company_id = c.id),
        'supervisors', (SELECT count(*) FROM public.supervisors s WHERE s.company_id = c.id AND s.is_active),
        'payment_methods', (SELECT count(*) FROM public.company_payment_methods pm WHERE pm.company_id = c.id AND pm.is_active),
        -- As platform_today: a student can buy something on at least one line right now.
        'selling', c.status = 'active' AND EXISTS (
            SELECT 1 FROM public.lines l CROSS JOIN LATERAL public.line_sale_options_for(l.id, NULL, NULL) o
            WHERE l.company_id = c.id AND l.is_active AND o.available))
      ORDER BY c.name)
    FROM public.companies c), '[]'::jsonb);
END;
$$;

-- 3. One company: can a student subscribe? ---------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_company_detail(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'الشركة غير موجودة.' USING ERRCODE = 'P0002';
  END IF;

  RETURN (
    WITH trips AS (
      SELECT t.line_id, t.direction, t.university_id
      FROM public.line_trips t JOIN public.lines l ON l.id = t.line_id
      WHERE l.company_id = p_company_id AND t.is_active
    ),
    lines_out AS (
      SELECT l.id, l.name, l.is_active,
             (SELECT count(*) FROM public.stations st WHERE st.line_id = l.id AND st.is_active) AS stations,
             (SELECT count(*) FROM trips t WHERE t.line_id = l.id AND t.direction = 'departure') AS departures,
             (SELECT u.name FROM public.line_universities lu JOIN public.universities u ON u.id = lu.university_id
              WHERE lu.line_id = l.id AND NOT EXISTS (
                SELECT 1 FROM trips t WHERE t.line_id = l.id AND t.direction = 'departure'
                  AND (t.university_id IS NULL OR t.university_id = lu.university_id))
              ORDER BY u.name LIMIT 1) AS unserved_university,
             (SELECT bool_or(o.available) FROM public.line_sale_options_for(l.id, NULL, NULL) o) AS sells,
             EXISTS (SELECT 1 FROM public.supervisor_lines sl JOIN public.supervisors sv ON sv.id = sl.supervisor_id AND sv.is_active
                     WHERE sl.line_id = l.id) AS supervised
      FROM public.lines l WHERE l.company_id = p_company_id
    )
    SELECT jsonb_build_object(
      'company', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'created_at', c.created_at,
                    'status_changed_at', c.status_changed_at, 'contact_phone', c.contact_phone, 'contact_label', c.contact_label)
                  FROM public.companies c WHERE c.id = p_company_id),
      'admins', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name, 'email', a.email) ORDER BY a.created_at)
                          FROM public.admins a WHERE a.company_id = p_company_id), '[]'::jsonb),
      'payment_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('method_type', pm.method_type, 'display_name', pm.display_name)
                                                    ORDER BY pm.sort_order, pm.created_at)
                                   FROM public.company_payment_methods pm WHERE pm.company_id = p_company_id AND pm.is_active), '[]'::jsonb),
      'supervisors', (SELECT count(*) FROM public.supervisors s WHERE s.company_id = p_company_id AND s.is_active),
      'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', x.id, 'name', x.name, 'is_active', x.is_active, 'supervised', x.supervised,
                  'unserved_university', x.unserved_university,
                  -- Why students do not see an active line (NULL: they do).
                  'hidden', CASE
                      WHEN NOT x.is_active THEN 'line_inactive'
                      WHEN x.stations = 0 THEN 'no_stations'
                      WHEN x.departures = 0 THEN 'no_departure'
                      WHEN x.unserved_university IS NOT NULL THEN 'unserved_university'
                      WHEN NOT COALESCE(x.sells, false) THEN 'nothing_on_sale'
                    END) ORDER BY x.name) FROM lines_out x), '[]'::jsonb),
      -- What the company itself sells, whatever the season (a period that has not
      -- started yet is "on sale" here; the lines above say what can be bought today).
      'sale', COALESCE((SELECT jsonb_agg(jsonb_build_object('option', p.option, 'name', p.name,
                          'on_sale', p.reason IS DISTINCT FROM 'company_not_selling' AND p.reason IS DISTINCT FROM 'company_inactive')
                        ORDER BY p.start_date)
                        FROM (SELECT DISTINCT ON (s.option) s.* FROM public.company_sale_periods(p_company_id, NULL) s
                              ORDER BY s.option, s.start_date) p), '[]'::jsonb)
    )
  );
END;
$$;

-- 4. The catalogue's numbers -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_university_counts()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'universities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', u.id,
          'students', (SELECT count(*) FROM public.students s WHERE s.university_id = u.id),
          'lines', (SELECT count(DISTINCT lu.line_id) FROM public.line_universities lu
                    JOIN public.lines l ON l.id = lu.line_id AND l.is_active WHERE lu.university_id = u.id),
          'companies', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
            FROM public.companies c
            WHERE c.status <> 'archived' AND EXISTS (
              SELECT 1 FROM public.line_universities lu JOIN public.lines l ON l.id = lu.line_id AND l.is_active
              WHERE lu.university_id = u.id AND l.company_id = c.id)), '[]'::jsonb)))
      FROM public.universities u), '[]'::jsonb),
    'colleges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('university_id', s.university_id, 'college', s.college, 'students', s.n))
      FROM (SELECT st.university_id, btrim(st.college) AS college, count(*) AS n
            FROM public.students st
            WHERE st.university_id IS NOT NULL AND NULLIF(btrim(st.college), '') IS NOT NULL
            GROUP BY 1, 2) s), '[]'::jsonb)
  );
END;
$$;

-- 5. The default term dates, all in one statement ------------------------------------
-- The table's statement trigger checks the terms after each UPDATE; saving them one
-- by one could be refused half-way (moving the first term past the second's start)
-- and left some saved. One UPDATE is checked once, on the final dates, and is all
-- or nothing.
CREATE OR REPLACE FUNCTION public.save_platform_terms(p_terms jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'متاح لمدير المنصة فقط.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_terms) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'بيانات الفصول غير صحيحة.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.academic_terms t
  SET name = COALESCE(NULLIF(btrim(x.name), ''), t.name),
      start_month = COALESCE(x.start_month, t.start_month), start_day = COALESCE(x.start_day, t.start_day),
      end_month = COALESCE(x.end_month, t.end_month), end_day = COALESCE(x.end_day, t.end_day)
  FROM jsonb_to_recordset(p_terms) AS x(code text, name text, start_month int, start_day int, end_month int, end_day int)
  WHERE t.code = x.code;
  RETURN (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.sort_order) FROM public.academic_terms t);
END;
$$;

REVOKE ALL ON FUNCTION public.save_platform_terms(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_platform_terms(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.platform_companies() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_company_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_university_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.stamp_company_status_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_companies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_company_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_university_counts() TO authenticated;
