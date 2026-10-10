# Admin redesign — status

Branch: `admin-web-redesign-5n73en`. Every page on the boards is built (company workspace,
platform, sign-in), reviewed against its boards at 1440 / 834 / 390, and committed per area.
`tsc`, `vitest` (282 tests) and `check:bundle` are clean. `BUILD.md` is the contract.

## Database — applied (10 October 2026)
All seven migrations `20261116000001` … `20261116000007` are applied to project
`hnwpkkryxovhmsrokdsd`, in order, and checked on the live data inside rolled-back
transactions: every new function answers as a company admin and as the platform
admin; `e2e_admin_lines.sql` 15/15; `e2e_admin_team.sql` steps 1–5 (the scan-events
foreign key is now `ON DELETE SET NULL`, every record carries its supervisor's name).
Step 6 of the team test deletes a supervisor and could not run through the connector
(deletes wait for an approval); run it locally with psql if wanted.

Edge function `admin-reset-supervisor-password` is deployed (version 1).

## What is left
1. Deploy `admin-update-supervisor` (blocked from this session):
   `supabase functions deploy admin-update-supervisor` — until then a supervisor's
   name can still be edited; a new phone number shows a clear «not activated yet» message.
2. Delete the temporary QA account (banned, password scrambled):
   ```sql
   delete from public.admins where email = 'qa-redesign@basak.invalid';
   delete from auth.users where email = 'qa-redesign@basak.invalid';
   ```
3. Merge the branch (pull request) and let Vercel deploy the dashboard.

## Run locally
```
cd admin_web && npm ci
npx vite --config vite.preview.config.ts --port 5190   # sample data, no account needed (?as=platform, ?as=none)
npx vite                                                # the real project
```
