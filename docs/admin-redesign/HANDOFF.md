# Admin redesign — hand-off (continue on another machine)

Branch: `admin-web-redesign-5n73en`. Read `BUILD.md` first (the contract), then this file.

## Done and reviewed (own commits)
| Area | Pages | Migration (NOT applied yet) |
|---|---|---|
| Foundation | `src/ui`, `src/shell`, routes, nav, `preview/` | — |
| اليوم | TodayPage, platform/PlatformTodayPage | `20261116000001_admin_today.sql` |
| الإيصالات + بيانات الإيصال + طلبات كلمة المرور | ReceiptsPage, ReceiptDetailsPage, PasswordRequestsPage | `20261116000002_admin_receipts.sql` |
| الطلاب + كل الطلاب + طلبات التصحيح | StudentsPage, platform/AllStudentsPage, platform/CorrectionsPage | `20261116000003_admin_students.sql` |
| المشرفون + مديرو الشركة + مديرو الشركات | SupervisorsPage, TeamPage, platform/CompanyAdminsPage | `20261116000005_admin_team.sql` + edge functions `admin-update-supervisor`, `admin-reset-supervisor-password` |

## In progress when the cloud session ended (saved in "WIP checkpoint" commits, not reviewed)
| Area | Files | Boards |
|---|---|---|
| الخطوط + تأكيد الركوب | LinesPage, LinePage, LineNewPage, RideConfirmationPage, `components/lines/*`, `lib/lines*.ts`, `20261116000004_admin_lines.sql` | AdmLines*, AdmLine*, AdmRide* |
| مواعيد الاشتراك + وسائل الدفع + الإيرادات + بطاقة الطالب + الإشعارات | SubscriptionPeriodsPage, PaymentMethodsPage, ReportsPage, WalletCardPage, NotificationsPage, `components/money/*`, `components/notifications/*`, `lib/money*.ts`, `20261116000006_admin_money.sql` | AdmDates*, AdmPay*, AdmRevenue*, AdmCard*, AdmNotify* |
| المنصة + الدخول | platform/CompaniesPage, CompanyNewPage, UniversitiesPage, PlatformDefaultsPage, AppVersionsPage, PlatformNotificationsPage, LoginPage, ResetPasswordPage, `components/platform/*`, `lib/platform.ts`, `20261116000007_admin_platform.sql` | AdmPlat* (except Today/Students/Corrections/Password/Admins), AdmSignIn* |

For each: run `npx tsc --noEmit`, open the page in the preview, compare with its boards (BUILD.md §2) and finish what is missing.

## Left for the end
1. Bundle budget: `npm run check:bundle` — the first company page is a few kB over; trim the shared `kit`/`Field` chunks or re-base the budget in `scripts/check-bundle.mjs` with a note.
2. Remove what nothing imports any more: `pages/SubscriptionSettingsPage.tsx`, `components/StatsRow.tsx` (move `egp` first), `components/Topbar.tsx`, the compat names in `components/Skeleton.tsx`, unused exports in `lib/overview.ts`.
3. Apply migrations `20261116000001`…`07` in order to project `hnwpkkryxovhmsrokdsd`, then run each `supabase/tests/local/e2e_admin_*.sql`; deploy `admin-update-supervisor` and `admin-reset-supervisor-password` (`supabase functions deploy <name>`). Everything is additive; the old dashboard keeps working.
4. Delete the temporary QA account (it is banned and its password scrambled):
   `delete from public.admins where email = 'qa-redesign@basak.invalid'; delete from auth.users where email = 'qa-redesign@basak.invalid';`
5. Final pass: every page at 1440 / 834 / 390 against its boards, then a pull request.

## Run locally
```
cd admin_web && npm ci
npx vite --config vite.preview.config.ts --port 5190   # sample data, no account needed
npx vite                                                # the real project
node preview/shot.mjs <name> /c/:c/<slug> 1440,834,390 --full   # screenshots
node preview/board.mjs AdmLines AdmLinesPhone                    # the boards as PNG
```
On Windows, `preview/shot.mjs` and `board.mjs` need Playwright: set `PLAYWRIGHT_MODULE` to your playwright `index.mjs`.
