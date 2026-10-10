-- ==============================================================================
-- Admin dashboard · supervisors and company admins (docs/admin-redesign, area «team»)
--
-- 1. A supervisor's boarding records outlive the supervisor.
--    Deleting a supervisor used to delete every boarding record he scanned
--    (supervisor_scan_events.supervisor_id ON DELETE CASCADE). The records are
--    the company's history (who rode, when, and that a student did board), so
--    now the column is set to NULL instead, and the record keeps the scanner's
--    name in supervisor_name (filled on every new record, backfilled once).
--    Every reader of supervisor_id compares it with the caller's own id
--    (auth.uid()), a station, a student or a line: a NULL matches none of them,
--    so nothing that reads the table changes behaviour.
--    tenant_company_from_parent('supervisor') would have cleared company_id
--    (NOT NULL) when the column became NULL; it now keeps it in that case.
-- 2. admin_supervisor_records: how many records a supervisor has and that they
--    are kept, for the delete confirmation («سجلات الركوب التي سجّلها تبقى»).
-- 3. admin_list_company_admins: the company admins with whether each has
--    signed in yet (an invited admin who never opened the link), for the
--    platform's «مديرو الشركات» page.
--
-- Additive and backward compatible: the dashboard in production reads none of
-- this, and the supervisor app writes the same columns as before.
-- ==============================================================================
BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Boarding records keep who scanned them
-- ------------------------------------------------------------------------------
ALTER TABLE public.supervisor_scan_events ADD COLUMN IF NOT EXISTS supervisor_name text;

UPDATE public.supervisor_scan_events e SET supervisor_name = s.full_name
FROM public.supervisors s
WHERE s.id = e.supervisor_id AND e.supervisor_name IS NULL;

-- The name at the time of the scan, whatever the client sends.
CREATE OR REPLACE FUNCTION public.scan_event_supervisor_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.supervisor_id IS NOT NULL THEN
    SELECT s.full_name INTO NEW.supervisor_name FROM public.supervisors s WHERE s.id = NEW.supervisor_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.scan_event_supervisor_name() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_scan_supervisor_name BEFORE INSERT ON public.supervisor_scan_events
  FOR EACH ROW EXECUTE FUNCTION public.scan_event_supervisor_name();

-- A row's company follows its parent; a record whose supervisor was deleted
-- (supervisor_id set to NULL by the foreign key) keeps the company it had.
-- The other parents are unchanged.
CREATE OR REPLACE FUNCTION public.tenant_company_from_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  CASE TG_ARGV[0]
    WHEN 'line' THEN
      SELECT l.company_id INTO NEW.company_id FROM public.lines l WHERE l.id = NEW.line_id;
    WHEN 'trip' THEN
      SELECT l.company_id INTO NEW.company_id
      FROM public.line_trips t JOIN public.lines l ON l.id = t.line_id WHERE t.id = NEW.trip_id;
    WHEN 'subscription' THEN
      SELECT l.company_id INTO NEW.company_id
      FROM public.subscriptions s JOIN public.lines l ON l.id = s.line_id WHERE s.id = NEW.subscription_id;
    WHEN 'supervisor' THEN
      IF TG_OP = 'INSERT' OR NEW.supervisor_id IS NOT NULL THEN
        SELECT s.company_id INTO NEW.company_id FROM public.supervisors s WHERE s.id = NEW.supervisor_id;
      END IF;
  END CASE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_company_from_parent() FROM PUBLIC, anon, authenticated;

-- New records still always name their supervisor (supervisor_check_in_student
-- writes auth.uid()); only the deletion of a supervisor leaves it empty.
ALTER TABLE public.supervisor_scan_events ALTER COLUMN supervisor_id DROP NOT NULL;

-- One statement, so there is never a moment without the constraint.
-- (Replacing the foreign key needs its old definition dropped.)
ALTER TABLE public.supervisor_scan_events
  DROP CONSTRAINT IF EXISTS supervisor_scan_events_supervisor_id_fkey,
  ADD CONSTRAINT supervisor_scan_events_supervisor_id_fkey
    FOREIGN KEY (supervisor_id) REFERENCES public.supervisors(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 2. What deleting a supervisor leaves behind
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_supervisor_records(p_supervisor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT s.company_id INTO v_company FROM public.supervisors s WHERE s.id = p_supervisor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المشرف غير موجود.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_company(v_company) THEN
    RAISE EXCEPTION 'هذا المشرف لا يتبع شركتك.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'scans', (SELECT count(*) FROM public.supervisor_scan_events e WHERE e.supervisor_id = p_supervisor_id),
    'checked_in', (SELECT count(*) FROM public.supervisor_scan_events e
                   WHERE e.supervisor_id = p_supervisor_id AND e.result = 'checked_in'),
    'last_scan_at', (SELECT max(e.scanned_at) FROM public.supervisor_scan_events e WHERE e.supervisor_id = p_supervisor_id),
    -- The records stay when he is deleted (section 1 of this migration).
    'kept', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_supervisor_records(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_supervisor_records(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. Company admins, with whether each has signed in yet
-- ------------------------------------------------------------------------------
-- The platform admin: every company admin (or one company's). A company admin:
-- the admins of their own company only.
CREATE OR REPLACE FUNCTION public.admin_list_company_admins(p_company_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, email text, full_name text, company_id uuid, created_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    IF p_company_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
      RAISE EXCEPTION 'ليست لديك صلاحية لعرض مديري هذه الشركة.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN QUERY
    SELECT a.id, a.email::text, a.full_name::text, a.company_id, a.created_at, u.last_sign_in_at
    FROM public.admins a
    LEFT JOIN auth.users u ON u.id = a.id
    WHERE a.role = 'company_admin' AND (p_company_id IS NULL OR a.company_id = p_company_id)
    ORDER BY a.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_company_admins(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_company_admins(uuid) TO authenticated;

COMMIT;
