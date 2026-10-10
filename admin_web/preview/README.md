# Dashboard preview (sample data, no network)

Runs the dashboard against an in-memory stand-in for Supabase, so every page can be
opened and compared with its board in `docs/canvas/Adm*.dc.html` without an account
or a connection. Nothing here is part of the production build.

```
npx vite --config vite.preview.config.ts --port 5190
```

- `?as=company` (default) signs in as a company admin of «النورس للنقل»;
  `?as=platform` as the platform admin. The choice is remembered for the tab.
- `?state=empty | error | loading` makes every request answer empty, fail, or hang
  (for the empty, error and loading boards).
- `mock.ts` is the client: tables are filtered in memory, `rpc()` and
  `functions.invoke()` call the handlers registered by `handlers/*.ts`.
- `data.ts` holds the shared sample rows (company, lines, students, receipts…).
  A page's own server functions get a handler file of their own in `handlers/`.
