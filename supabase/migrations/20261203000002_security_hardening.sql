-- ==============================================================================
-- Migration: 20261203000002_security_hardening.sql
-- Run AFTER 20261203000001_trip_pause.sql. Safe to re-run. No behaviour change.
--
-- Hardening from a security review (Supabase advisors):
--   * Pin search_path on offer_picture_path. It is a pure path validator
--     (SECURITY INVOKER, touches no table), flagged only as
--     function_search_path_mutable; pinning removes the warning.
--   * Revoke EXECUTE on every trigger function in public from PUBLIC / anon /
--     authenticated. A trigger function is run by the trigger mechanism, never
--     through /rest/v1/rpc — Postgres refuses a direct call — so this only takes
--     them off the "anon/authenticated can execute a SECURITY DEFINER function"
--     surface. It changes no behaviour.
--
-- Deliberately NOT touched: functions meant to be callable before sign-in
-- (request_student_password_reset, phone_can_register, the reference reads), so
-- the subscription catalog, sign-up and password-reset flows keep working.
-- ==============================================================================
BEGIN;

ALTER FUNCTION public.offer_picture_path(text, text, uuid) SET search_path = pg_catalog, public;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

COMMIT;
