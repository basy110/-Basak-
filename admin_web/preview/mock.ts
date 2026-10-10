/**
 * The preview's stand-in for the Supabase client (preview/README.md). It answers the
 * calls the dashboard makes from sample rows in memory; writes change those rows for
 * the life of the tab. Only what the pages use is implemented.
 */
import { tables, ADMINS } from './data';

type Row = Record<string, any>;
type Answer = { data: any; error: { message: string; code?: string } | null; count?: number | null; status?: number };
import { rpcs, fns } from './registry';

const params = new URLSearchParams(location.search);
if (params.get('as')) sessionStorage.setItem('preview.as', params.get('as')!);
if (params.has('state')) sessionStorage.setItem('preview.state', params.get('state') || '');
export const as = (sessionStorage.getItem('preview.as') as 'company' | 'platform' | 'none') || 'company';
const state = sessionStorage.getItem('preview.state') || '';
// `?as=none`: signed out, to see the sign-in pages (the e-mail decides who signs in: «wrong» in the
// password fails, a «student» address is not an admin, «offline» cannot reach the server).
const admin = ADMINS[as === 'none' ? 'company' : as];

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const failure = (): Answer => ({ data: null, error: { message: 'Failed to fetch' }, count: null });
const uuid = () => crypto.randomUUID();

/** A stand-in picture for any signed storage link. */
const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="#D5E0E7"/><rect x="48" y="60" width="504" height="780" rx="28" fill="#fff"/><circle cx="300" cy="190" r="44" fill="#E3F4EC"/><path d="M280 190l14 14 26-28" stroke="#0A6B4A" stroke-width="8" fill="none" stroke-linecap="round"/><text x="300" y="290" font-size="26" text-anchor="middle" fill="#476273" font-family="sans-serif">تم التحويل بنجاح</text><text x="300" y="360" font-size="54" text-anchor="middle" fill="#17384A" font-family="sans-serif" font-weight="600">4,500.00 EGP</text></svg>')}`;

function get(row: Row, col: string) { return col.split('.').reduce((v, k) => (v == null ? v : v[k]), row as any); }
function like(v: unknown, pattern: string) {
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
  return re.test(String(v ?? ''));
}

class Query implements PromiseLike<Answer> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: [string, boolean][] = [];
  private from_ = 0; private to_ = Infinity;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row | Row[] | null = null;
  private single_: 'one' | 'maybe' | null = null;
  private head = false; private count_ = false; private returning = false;
  constructor(private source: string | (() => Promise<Row[] | Row | null>)) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.mode !== 'select') this.returning = true; if (opts?.count) this.count_ = true; if (opts?.head) this.head = true; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => get(r, c) === v || String(get(r, c)) === String(v)); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => get(r, c) !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(get(r, c))); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? get(r, c) == null : get(r, c) === v)); return this; }
  not(c: string, op: string, v: unknown) { this.filters.push((r) => (op === 'is' ? (v === null ? get(r, c) != null : get(r, c) !== v) : get(r, c) !== v)); return this; }
  gt(c: string, v: any) { this.filters.push((r) => get(r, c) > v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => get(r, c) >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => get(r, c) < v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => get(r, c) <= v); return this; }
  ilike(c: string, p: string) { this.filters.push((r) => like(get(r, c), p)); return this; }
  like(c: string, p: string) { return this.ilike(c, p); }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'));
    this.filters.push((r) => parts.some(([c, op, ...rest]) => { const v = rest.join('.'); return op === 'ilike' ? like(get(r, c), v.replace(/\*/g, '%')) : op === 'eq' ? String(get(r, c)) === v : op === 'is' ? get(r, c) == null : true; }));
    return this;
  }
  contains() { return this; }
  match(obj: Row) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  limit(n: number) { this.to_ = this.from_ + n - 1; return this; }
  single() { this.single_ = 'one'; return this; }
  maybeSingle() { this.single_ = 'maybe'; return this; }
  abortSignal() { return this; }
  returns() { return this; }
  insert(p: Row | Row[]) { this.mode = 'insert'; this.payload = p; return this; }
  upsert(p: Row | Row[]) { this.mode = 'upsert'; this.payload = p; return this; }
  update(p: Row) { this.mode = 'update'; this.payload = p; return this; }
  delete() { this.mode = 'delete'; return this; }

  private async run(): Promise<Answer> {
    if (state === 'loading') await new Promise(() => undefined);
    await delay();
    if (state === 'error') return failure();
    let rows: Row[];
    if (typeof this.source === 'function') {
      try {
        const out = await this.source();
        if (!Array.isArray(out)) {
          if (state === 'empty' && out && typeof out === 'object' && Array.isArray((out as Row).rows)) return { data: { ...out, rows: [], total: 0 }, error: null };
          return { data: out, error: null };
        }
        rows = out;
      } catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code } }; }
    } else {
      const table = (tables[this.source] ??= []);
      if (this.mode === 'insert' || this.mode === 'upsert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((r) => ({ id: uuid(), created_at: new Date().toISOString(), ...r }));
        list.forEach((r) => { const i = table.findIndex((t) => t.id === r.id); if (i >= 0) table[i] = { ...table[i], ...r }; else table.push(r); });
        rows = list;
      } else {
        const matched = table.filter((r) => this.filters.every((f) => f(r)));
        if (this.mode === 'update') matched.forEach((r) => Object.assign(r, this.payload));
        if (this.mode === 'delete') matched.forEach((r) => table.splice(table.indexOf(r), 1));
        rows = matched;
        if (this.mode !== 'select' && !this.returning) return { data: null, error: null, count: null };
      }
      if (state === 'empty' && this.mode === 'select' && !['admins', 'companies'].includes(this.source)) rows = [];
    }
    if (typeof this.source === 'function') rows = rows.filter((r) => this.filters.every((f) => f(r)));
    for (const [c, asc] of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (get(a, c) > get(b, c) ? 1 : get(a, c) < get(b, c) ? -1 : 0) * (asc ? 1 : -1));
    const total = rows.length;
    rows = rows.slice(this.from_, this.to_ === Infinity ? undefined : this.to_ + 1);
    if (this.head) return { data: null, error: null, count: total };
    if (this.single_) {
      if (!rows.length && this.single_ === 'one') return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      return { data: rows[0] ?? null, error: null, count: this.count_ ? total : null };
    }
    return { data: rows, error: null, count: this.count_ ? total : null };
  }
  then<A = Answer, B = never>(ok?: ((v: Answer) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.run().then(ok, bad); }
}

const ctx = () => ({ as, tables });

export const supabase = {
  from: (table: string) => new Query(table),
  rpc: (name: string, args: Row = {}, opts?: { head?: boolean; count?: string }) => {
    const q = new Query(async () => {
      const h = rpcs[name];
      if (!h) { console.warn(`[preview] no handler for rpc ${name}`, args); throw Object.assign(new Error(`preview: rpc ${name} has no handler`), { code: 'PGRST202' }); }
      const out = await h(args, ctx());
      if (state === 'empty' && Array.isArray(out)) return [];
      return out;
    });
    if (opts?.head || opts?.count) q.select('*', { head: opts.head, count: opts.count });
    return q;
  },
  auth: {
    getSession: async () => ({ data: { session: as === 'none' ? null : { access_token: 'preview', user: { id: admin.id, email: admin.email } } }, error: null }),
    getUser: async () => ({ data: { user: { id: admin.id, email: admin.email } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async ({ email = '', password = '' }: { email?: string; password?: string } = {}) => {
      await delay(500);
      if (as !== 'none') return { data: { user: { id: admin.id }, session: {} }, error: null };
      if (email.includes('offline')) return { data: { user: null, session: null }, error: { message: 'Failed to fetch' } };
      if (email.includes('unconfirmed')) return { data: { user: null, session: null }, error: { message: 'Email not confirmed' } };
      if (password === 'wrong') return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
      const who = email.includes('student') ? { id: crypto.randomUUID() } : email.startsWith('admin@') ? ADMINS.platform : ADMINS.company;
      return { data: { user: { id: who.id }, session: {} }, error: null };
    },
    signOut: async () => { sessionStorage.removeItem('preview.as'); location.href = '/'; return { error: null }; },
    updateUser: async () => ({ data: {}, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    refreshSession: async () => ({ data: {}, error: null }),
  },
  realtime: { setAuth: async () => undefined },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch, send: async () => 'ok' }; return ch; },
  removeChannel: async () => 'ok',
  functions: {
    invoke: async (name: string, { body }: { body: Row }) => {
      await delay(400);
      if (state === 'error') return { data: null, error: new Error('Failed to fetch') };
      const h = fns[name];
      if (!h) return { data: null, error: new Error(`preview: function ${name} has no handler`) };
      try { return { data: await h(body, ctx()), error: null }; } catch (e) { return { data: null, error: e }; }
    },
  },
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: PICTURE }, error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: PICTURE, error: null })), error: null }),
      upload: async (path: string) => ({ data: { path }, error: null }),
      remove: async () => ({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: PICTURE } }),
      list: async () => ({ data: [], error: null }),
    }),
  },
};

// Every handler file registers itself.
import.meta.glob('./handlers/*.ts', { eager: true });
