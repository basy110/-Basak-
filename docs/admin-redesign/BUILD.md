# Admin dashboard redesign — how the build is done

The boards in `docs/canvas/Adm*.dc.html` are approved. This file is the contract for
everyone rebuilding `admin_web/` from them. Read it whole before writing code, then
read `docs/admin-redesign/audit.md` (what the old code does, with `file:line`) and
`docs/admin-redesign/generator/README.md` (navigation, rules every page follows).

## 1. Where things are

| Path | What |
|---|---|
| `admin_web/src/ui/` | **The design system.** Tokens are in `tailwind.config.js`. Use these parts; do not restyle by hand. `Button`/`IconButton`, `Badge`/`StatusPill`/`StatePill`/`Pill`/`CountBadge`/`Ltr`/`Money`, `TextField`/`MoneyField`/`PasswordField`/`SelectField`/`TextArea`/`Toggle`/`Switch`/`Checkbox`/`RadioCards`/`FieldRow`, `Page`/`PageHeader`/`Section`/`SectionHead`/`Card`/`FormSection`/`InfoRows`/`StatCard`/`AttentionList`/`Stepper`/`StepList`/`PhoneBar`, `Dialog`/`SidePanel`/`Sheet`/`Drawer`/`Menu`, `DataTable`/`RecordCard`/`Toolbar`/`SearchBox`/`Chip`/`Chips`/`SortSelect`/`Pager`/`Cell2`, `Note`/`EmptyState`/`ErrorState`/`Skeleton*`/`OfflineBar`/`useOnline`, and `format.ts` (`num`, `moneyText`, `clock`, `dayText`, `rangeText`, `momentText`, `agoText`, `countText` + `NOUN`, `phoneText`, `errorText`). Import from `../ui` (or `../../ui`). |
| `admin_web/src/shell/` | The frame (sidebar, rail, top bar, phone drawer, student search, workspace bar). Done; do not change it unless your page truly needs it. |
| `admin_web/src/lib/` | Data and logic: hooks, cache keys, live sync, guards, receipts queue, notifications. **Reuse it.** Keep its tests green. Add new hooks here (one file per area), with unit tests for any pure logic. |
| `admin_web/src/lib/nav.ts`, `lib/routes.ts`, `areas/*.tsx` | Navigation and routes. Every route already points at a page file; your job is the page. |
| `admin_web/src/pages/…` | The pages. Several still hold the **old** page (same file name) — read it for its logic, then replace it. `git show HEAD:admin_web/src/pages/<File>.tsx` shows the original of any page, including ones already removed. |
| `admin_web/preview/` | A stand-in for Supabase with sample data (see its README). `preview/handlers/<area>.ts` answers your server functions; `preview/data.ts` holds shared rows. |
| `supabase/migrations/` | Database changes. `supabase/functions/` edge functions. |

## 2. The loop for each page

1. List the page's boards: `ls docs/canvas | grep Adm<Page>` (desktop, `…Phone`, `…States`, dialogs, panels).
2. Look at them: `node admin_web/preview/board.mjs AdmReceipts AdmReceiptsPhone …` → `admin_web/preview/shots/board-*.png` (open with Read). Get the exact words with `python3 -I admin_web/preview/board-text.py AdmReceipts`. **Copy the Arabic, the order and the numbers' formats exactly.**
3. Build the page with `src/ui`. Same data the old page used (its hooks), plus what the board needs (see §4).
4. Preview server: `cd admin_web && npx vite --config vite.preview.config.ts --port 5190` (one is usually already running — check `curl -s localhost:5190` first; do not start a second one). Add handlers in `preview/handlers/<area>.ts` for every RPC / edge function / table your page uses.
5. Screenshot: `node preview/shot.mjs <name> /c/:c/<slug> 1440,834,390 [--full] [--as=platform] [--state=empty|error|loading] [--click=<css selector>]`, open the PNGs, compare with the board PNGs side by side, fix, repeat until they match. Check the console errors it prints.
6. `npx tsc --noEmit` and `npx vitest run` in `admin_web/` must be clean before you report.

## 3. Rules (from the boards; non-negotiable)

- Breakpoints: phone < 640 (`sm:`), tablet 640–1023, desktop ≥ 1024 (`lg:`). Logical CSS only (`ms- me- ps- pe- start- end- text-start text-end`), never left/right.
- One `PageHeader` per page; its `title` equals the navigation label exactly. Wrap the page in `<Page>`.
- Tables: `DataTable` (it renders record cards on a phone from `card(row)` — same fields, same order). 25 rows a page with `Pager`; none under 26 rows. Row click opens the record (`SidePanel` on desktop/tablet; it is a full page on a phone automatically).
- A yes/no about one action → `Dialog`: title is the question; the body says exactly what will and will not happen, with the real numbers; confirm repeats the verb; cancel is «رجوع». Destructive or money-affecting actions always get one. Never `window.confirm/prompt/alert`, never a typed phrase.
- Forms: `FormSection`s, each saved by its own named button. No switch or select that saves on touch when money, status or students are affected. No pre-filled prices. Errors under the field in Arabic; never the server's raw text (use `errorText(err)`).
- Phone: the primary action of a form/page goes in `PhoneBar` (sticky full-width bar), 48-high controls.
- States for every page: many, one, none (`EmptyState` + the button that fills it), loading (skeleton of the right shape), error (`ErrorState` with retry), offline where it writes (the shell shows `OfflineBar`; disable writes with `useOnline()`).
- Words: the glossary on `AdmSystem` (`python3 -I admin_web/preview/board-text.py AdmSystem`). Arabic only on screen, Western digits, 12-hour `7:30 ص`, `10 أكتوبر 2026`, `4,500 ج.م`, phones/codes/e-mails in `Ltr`. Status labels only through `StatusPill`/`StatePill`.
- Writes: through `useGuard()` (no double sends), put the server's answer into the cache and call `rememberApplied` (lib/recentChanges.ts) the way the old pages did, so a page's own write does not cost a re-read. Live refresh follows `lib/sync.ts` (cache keys' third segment names the list).
- Accessibility: every control labelled; icon buttons have `label`; dialogs/panels come from `ui/Overlay` (focus trap, Escape, focus return).
- Bundle: the first company page (`TodayPage`) must stay inside `scripts/check-bundle.mjs`'s budget. Do not add npm dependencies.

## 4. Backend

The Supabase project is `hnwpkkryxovhmsrokdsd` (Supabase MCP tools). Production has real
users: **every change must be additive and backward compatible** — the dashboard now
in production must keep working against the new database.

- A migration is a file `supabase/migrations/<your timestamp>_<name>.sql` (timestamps are assigned per area in the task you were given). Functions: `CREATE OR REPLACE`, `SECURITY DEFINER` with `SET search_path = public` and an explicit permission check (`is_super_admin()` / company admin of `p_company_id` — copy the pattern from the nearest existing function, e.g. in `20261103000001_data_access.sql`), `REVOKE ALL … FROM PUBLIC, anon` and `GRANT EXECUTE … TO authenticated`. Messages raised for the admin are Arabic sentences.
- **Test before applying:** run the whole migration plus checks inside `BEGIN; … ROLLBACK;` with `execute_sql` (check behaviour as the right role with `set local role authenticated; set local request.jwt.claims = '{"sub":"<admin id>","role":"authenticated"}';`). Then `apply_migration` with the same SQL. Write the SQL test you used to `supabase/tests/local/e2e_admin_<area>.sql` so it can be re-run.
- Statements that delete rows or drop objects may wait for an approval nobody answers and time out after 60 s. Avoid them; if one is truly needed, write it in the migration file, try once, and if it times out say so in your report (do not loop).
- Edge functions: `supabase/functions/<name>/index.ts` following the existing ones (`_shared/` helpers, CORS, the caller's JWT checked, service role only server-side). Deploy with `deploy_edge_function` including the `_shared` files it imports; `verify_jwt` as the sibling functions have it (check `supabase/config.toml`).
- The frontend must tolerate a database that does not have your new function yet (use `rpcOr` from `lib/rpc.ts` with a fallback when one is reasonable).

## 5. What you hand back

A short report: pages done (with the boards they match), backend changes (migration files, functions, whether applied and tested), tests added, anything you could not do and why. Do not commit; do not push; do not edit files that belong to another area except as §1 allows.
