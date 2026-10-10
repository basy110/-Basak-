# Admin redesign — status

Branch: `admin-web-redesign-5n73en`. Every page on the boards is built (company workspace,
platform, sign-in), reviewed against its boards at 1440 / 834 / 390, and committed per area.
`tsc`, `vitest` (282 tests) and `check:bundle` are clean. `BUILD.md` is the contract.

## What is left — the database (not applied: the session was not allowed to write to production)
Apply in this order to project `hnwpkkryxovhmsrokdsd` (all additive; the dashboard now in
production keeps working before and after):

1. `supabase/migrations/20261116000001_admin_today.sql`
2. `supabase/migrations/20261116000002_admin_receipts.sql`
3. `supabase/migrations/20261116000003_admin_students.sql`
4. `supabase/migrations/20261116000004_admin_lines.sql`
5. `supabase/migrations/20261116000005_admin_team.sql` (replaces the scan-events foreign key: boarding records survive a deleted supervisor)
6. `supabase/migrations/20261116000006_admin_money.sql`
7. `supabase/migrations/20261116000007_admin_platform.sql`

Then run each `supabase/tests/local/e2e_admin_*.sql` (each runs inside a transaction), and deploy:
```
supabase functions deploy admin-update-supervisor
supabase functions deploy admin-reset-supervisor-password
```
Until then every page works the older way (`rpcOr` fallbacks); a few numbers show «—».

Delete the temporary QA account (banned, password scrambled):
```sql
delete from public.admins where email = 'qa-redesign@basak.invalid';
delete from auth.users where email = 'qa-redesign@basak.invalid';
```

## Run locally
```
cd admin_web && npm ci
npx vite --config vite.preview.config.ts --port 5190   # sample data, no account needed (?as=platform, ?as=none)
npx vite                                                # the real project
```
