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

Edge functions `admin-reset-supervisor-password` and `admin-update-supervisor` are deployed (version 1 each).

## Round 2 (after the first merge, #21)
- Fonts back to Cairo + Inter; the app logo in the frame; larger, bolder type; pages up to 1920px wide.
- Colour stays as the boards have it: teal for action, green/amber/red only for status (a round of extra accent colours was removed at the owner's request).
- `ui/Select` replaces every native `<select>`.
- Tables: select-all («حدّد كل الـ N») and a teal bulk bar; `components/BulkDialog.tsx` runs bulk writes row by row through the single-row path.
- Excel: `lib/excel.ts` (lazy `write-excel-file` / `read-excel-file`) and `ui/Transfer.tsx` (`ExportButton`, `ImportPanel`; import them from `ui/Transfer`, not the `ui` index, to keep the first page's bundle).
  Export on every list; import for students (through `admin-create-student`) and universities/colleges. No supervisor import (needs a password per row).
- Receipts: «السجل» tab (accepted / rejected, reviewer, reason, export) and bulk accept/reject.
  Migration `20261117000001_admin_receipts_history.sql` (`admin_reviewed_receipts`) is **applied** (10 October 2026); test in `supabase/tests/local/e2e_admin_receipts_history.sql`.
- Universities: the `colleges` table was empty, so students saw the app's built-in list. The page now says so, copies that list into a university in one step, and lists the colleges students typed.
  The app (`mobile_app`) now offers a university's own colleges when any are listed, else the built-in list. That needs an app release to reach students.

## What is left
The temporary QA account was deleted on 10 October 2026.

1. Merge the round-2 pull request and let Vercel deploy the dashboard.
2. Ship an app build for the college change (optional; the dashboard does not depend on it).

## Run locally
```
cd admin_web && npm ci
npx vite --config vite.preview.config.ts --port 5190   # sample data, no account needed (?as=platform, ?as=none)
npx vite                                                # the real project
```
