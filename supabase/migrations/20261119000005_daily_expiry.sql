-- ==============================================================================
-- Migration: 20261119000005_daily_expiry.sql
-- Audit SUB-02 (docs/audit/2026-10-AUDIT.md). A subscription whose end date has
-- passed stayed 'active' until the same student bought another one:
-- expire_finished_subscriptions() ran only from enforce_subscription_insert, so
-- access checks that test status = 'active' (a supervisor reading a rider's
-- profile and photo, a student reading their supervisors' phones) kept working
-- after the term. A daily job now expires finished subscriptions at 00:05 Cairo
-- (22:05 UTC; 01:05 in summer time, which is still the right day).
-- Its «انتهى اشتراكك» notice keeps the key the daily notices use, so nothing is
-- sent twice. Additive: one scheduled job.
-- ==============================================================================
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'basak-expire-subscriptions';
SELECT cron.schedule('basak-expire-subscriptions', '5 22 * * *', 'SELECT public.expire_finished_subscriptions()');
