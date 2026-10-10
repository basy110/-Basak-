/**
 * The money pages' server functions (subscription periods, payment methods,
 * revenue, the student card) and the company's notifications. Numbers follow the
 * boards AdmDates*, AdmPay*, AdmRevenue*, AdmCard*, AdmNotify*.
 */
import { registerFunctions, registerRpc, rpcs, type Ctx, type RpcHandler } from '../registry';
import { ADMINS, COMPANY_ID, LINES, STUDENTS, UNIVERSITIES, tables } from '../data';
import { addDays, cairoLocalToIso, cairoToday } from '../../src/lib/time';

type Row = Record<string, any>;
const uuid = () => crypto.randomUUID();
const state = () => sessionStorage.getItem('preview.state') || '';
const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (d: number, h = 0, m = 0) => iso(new Date(Date.now() - d * 86_400_000 - h * 3_600_000 - m * 60_000));
const today = () => cairoToday();
const pad = (n: number) => String(n).padStart(2, '0');
const day = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const company = () => tables.companies.find((c) => c.id === COMPANY_ID)!;
const fail = (message: string) => { throw new Error(message); };
/**
 * For the per-page error and loading boards (the global ?state= stops the whole
 * workspace from loading): sessionStorage `preview.fail` / `preview.hang` hold
 * names of functions that fail or never answer, comma-separated.
 */
const reg = (map: Record<string, RpcHandler>) => registerRpc(Object.fromEntries(Object.entries(map).map(([name, h]) => [name, async (a: Row, c: Ctx) => {
  if ((sessionStorage.getItem('preview.hang') ?? '').split(',').includes(name)) await new Promise(() => undefined);
  if ((sessionStorage.getItem('preview.fail') ?? '').split(',').includes(name)) throw new Error('Failed to fetch');
  return h(a, c);
}])));

// ───────────────────────────────────────────────── subscription periods ────

const TERMS: Row[] = [
  { code: 'first', name: 'الفصل الأول', sort_order: 1, start_month: 9, start_day: 26, start_year_offset: 0, end_month: 1, end_day: 21, end_year_offset: 1, included_in_annual: true, is_on_sale: true, is_active: true },
  { code: 'second', name: 'الفصل الثاني', sort_order: 2, start_month: 2, start_day: 6, start_year_offset: 1, end_month: 6, end_day: 3, end_year_offset: 1, included_in_annual: true, is_on_sale: true, is_active: true },
  { code: 'summer', name: 'الفصل الصيفي', sort_order: 3, start_month: 7, start_day: 3, start_year_offset: 1, end_month: 9, end_day: 2, end_year_offset: 1, included_in_annual: false, is_on_sale: false, is_active: true },
];
/** Prices per line, in line order (AdmDates «ما يراه الطلاب في كل خط»): first, second, both (null = no price, 'off' = stopped on the line). */
const PRICES: [number, number, number | null | 'off'][] = [
  [4500, 4500, 8000], [4500, 4500, 8000], [4200, 4200, 7600], [4000, 4000, 'off'], [3800, 3800, 7000], [3600, 3600, null], [3600, 3600, null], [3500, 3500, 6500],
];
const OPEN = { first: 412, second: 24, both: 180, summer: 0, daily: 0 };

const periodsOf = (y: number) => {
  const t = Object.fromEntries(TERMS.map((x) => [x.code, x]));
  const p = (x: Row) => ({ period_code: x.code, academic_year: y, name: x.name, label: `${x.name} ${y}/${y + 1}`, subscription_type: 'termly',
    start_date: day(y + x.start_year_offset, x.start_month, x.start_day), end_date: day(y + x.end_year_offset, x.end_month, x.end_day), sort_order: x.sort_order });
  const list = TERMS.map(p);
  return [...list, { period_code: 'both', academic_year: y, name: 'الفصلان معاً', label: `الفصلان معاً ${y}/${y + 1}`, subscription_type: 'yearly',
    start_date: list[0].start_date, end_date: list[1].end_date, sort_order: 100, _first_end: day(y + t.first.end_year_offset, t.first.end_month, t.first.end_day) }];
};

/** company_sale_periods + line_sale_options_for, for the sample company. */
function salePeriods() {
  const d = today();
  const y = Number(d.slice(0, 4));
  const c = company();
  const all = [...periodsOf(y - 1), ...periodsOf(y), ...periodsOf(y + 1)];
  const sells = (code: string) => TERMS.find((t) => t.code === code)?.is_on_sale ?? false;
  const terms = all.filter((p) => p.subscription_type === 'termly');
  const inTerm = terms.some((t) => sells(t.period_code) && t.start_date <= d && t.end_date >= d);
  const nextStart = terms.filter((t) => sells(t.period_code) && t.start_date > d).map((t) => t.start_date).sort()[0];
  const cand: Row[] = [];
  ['first', 'second', 'summer'].forEach((code) => {
    const p = terms.filter((t) => t.period_code === code && t.end_date >= d).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    if (p) cand.push({ ...p, sells: sells(code) });
  });
  const both = all.filter((p) => p.period_code === 'both' && p._first_end >= d).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (both) cand.push({ ...both, sells: !!c.annual_subscription_enabled && sells('first') && sells('second') });
  return cand.map((p) => {
    const why = !p.sells ? 'company_not_selling' : p.start_date <= d ? null
      : p.start_date === nextStart && (c.advance_subscription_enabled || !inTerm) ? null : p.start_date === nextStart ? 'advance_off' : 'not_in_season';
    return { option: p.period_code, academic_year: p.academic_year, name: p.name, label: p.label, subscription_type: p.subscription_type,
      start_date: p.start_date, end_date: p.end_date, phase: p.start_date <= d ? 'current' : 'upcoming', available: why === null, reason: why };
  }).sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function salePreview() {
  const periods = salePeriods();
  return [...LINES].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((l) => {
    const i = LINES.indexOf(l);
    const [first, second, both] = PRICES[i] ?? [3500, 3500, 6500];
    const price: Row = { first, second, both, summer: null };
    return {
      line_id: l.id, line: l.name, is_active: l.is_active,
      options: periods.map((p) => {
        const pr = price[p.option];
        const why = !l.is_active ? 'line_inactive' : p.reason === 'company_not_selling' ? p.reason : pr === 'off' ? 'line_not_offering'
          : p.option === 'summer' ? 'no_price' : pr == null ? 'no_price' : p.reason;
        return { ...p, price: typeof pr === 'number' ? pr : null, available: !why, reason: why ?? null };
      }),
    };
  }).sort((a, b) => LINES.findIndex((l) => l.id === a.line_id) - LINES.findIndex((l) => l.id === b.line_id));
}

const settings = (companyId: string | null) => {
  const c = company();
  const y = Number(today().slice(0, 4));
  if (state() === 'empty') {
    return { company_id: companyId, annual_global: true, annual_company: true, annual_effective: true, advance_enabled: true, can_edit_global: false,
      terms: TERMS.map((t) => ({ ...t })), periods: [...periodsOf(y - 1), ...periodsOf(y)].filter((p) => p.end_date >= today()),
      purchasable: [], sale_periods: salePeriods(), sale_preview: [], companies: [] };
  }
  return {
    company_id: companyId, annual_global: true, annual_company: !!c.annual_subscription_enabled,
    annual_effective: !!c.annual_subscription_enabled, advance_enabled: !!c.advance_subscription_enabled, can_edit_global: false,
    terms: TERMS.map((t) => ({ ...t })),
    periods: [...periodsOf(y - 1), ...periodsOf(y)].filter((p) => p.end_date >= today()).map(({ _first_end: _f, ...p }) => p),
    purchasable: salePeriods().filter((p) => p.available), sale_periods: salePeriods(), sale_preview: salePreview(), companies: [],
  };
};
const switches = () => {
  const c = company();
  return { annual_global: true, annual_company: !!c.annual_subscription_enabled, annual_effective: !!c.annual_subscription_enabled,
    daily_global: true, daily_company: !!c.daily_subscription_enabled, daily_effective: !!c.daily_subscription_enabled };
};

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function applyTerms(list: Row[]) {
  for (const x of list ?? []) {
    const t = TERMS.find((term) => term.code === x.code);
    if (!t) continue;
    for (const [m, d] of [['start_month', 'start_day'], ['end_month', 'end_day']]) {
      const month = x[m] ?? t[m]; const dd = x[d] ?? t[d];
      if (dd < 1 || dd > MONTH_DAYS[month - 1]) fail('تاريخ غير صالح في إعدادات الفصول الدراسية.');
    }
  }
  for (const x of list ?? []) {
    const t = TERMS.find((term) => term.code === x.code);
    if (t) Object.assign(t, Object.fromEntries(Object.entries(x).filter(([k, v]) => k !== 'code' && v != null)));
  }
}

reg({
  company_terms_impact: ({ p_terms }) => {
    const moved: Row = {};
    for (const x of p_terms ?? []) {
      const t = TERMS.find((term) => term.code === x.code);
      if (!t) continue;
      if (['start_month', 'start_day', 'end_month', 'end_day'].some((k) => x[k] != null && x[k] !== t[k])) {
        moved[x.code] = (OPEN as Row)[x.code] ?? 0;
        if (x.code === 'first' || x.code === 'second') moved.both = OPEN.both;
      }
    }
    const total = Object.values(moved).reduce((a: number, b) => a + Number(b), 0);
    return { moved, moved_total: total, open: OPEN };
  },
  save_company_subscription_settings: async ({ p_terms, p_on_sale, p_advance, p_annual, p_daily }) => {
    const c = company();
    const impact = await rpcs.company_terms_impact({ p_terms }, { as: 'company', tables }) as Row;
    if (p_terms?.length) applyTerms(p_terms.map((t: Row) => ({ ...t, name: t.name?.trim() || undefined })));
    if (p_on_sale) TERMS.forEach((t) => { if (typeof p_on_sale[t.code] === 'boolean') t.is_on_sale = p_on_sale[t.code]; });
    if (p_advance != null) c.advance_subscription_enabled = p_advance;
    if (p_annual != null) c.annual_subscription_enabled = p_annual;
    if (p_daily != null) c.daily_subscription_enabled = p_daily;
    return { moved_subscriptions: impact.moved_total, advance_enabled: c.advance_subscription_enabled,
      on_sale: Object.fromEntries(TERMS.map((t) => [t.code, t.is_on_sale])), ...switches() };
  },
  save_company_terms: ({ p_terms }) => { applyTerms(p_terms); return { moved_subscriptions: 412 }; },
  set_company_sale_settings: ({ p_advance, p_on_sale }) => {
    const c = company();
    if (p_advance != null) c.advance_subscription_enabled = p_advance;
    if (p_on_sale) TERMS.forEach((t) => { if (typeof p_on_sale[t.code] === 'boolean') t.is_on_sale = p_on_sale[t.code]; });
    return { advance_enabled: c.advance_subscription_enabled, on_sale: Object.fromEntries(TERMS.map((t) => [t.code, t.is_on_sale])) };
  },
  set_annual_subscription: ({ p_enabled }) => { company().annual_subscription_enabled = p_enabled; return { global: true, company_id: COMPANY_ID, effective: p_enabled }; },
  set_daily_subscription: ({ p_enabled }) => { company().daily_subscription_enabled = p_enabled; return { global: true, company_id: COMPANY_ID, effective: p_enabled }; },
});

// ───────────────────────────────────────────────────── payment methods ────

// The sample rows use short column names; the dashboard reads the database's own.
const methods = (tables.company_payment_methods ??= []);
methods.forEach((m) => {
  m.method_type ??= m.type === 'wallet' ? 'vodafone_cash' : m.type;
  m.wallet_phone ??= m.wallet_number ?? null;
  m.bank_account_number ??= m.account_number ?? null;
});
const fix = (i: number, patch: Row) => { if (methods[i]) Object.assign(methods[i], patch); };
// As on AdmPay: five methods, three shown to students.
fix(0, { display_name: 'إنستاباي النورس', account_holder: 'أحمد سعيد النورس' });
fix(1, { wallet_phone: '01023456789' });
fix(2, { display_name: 'البنك الأهلي المصري', bank_name: 'البنك الأهلي المصري · فرع دمياط', bank_account_number: '1234567890123456', is_active: true, instructions: 'التحويل البنكي يصل خلال يوم عمل. ارفع صورة إيصال البنك.' });
if (methods.length === 3) {
  methods.push(
    { id: uuid(), company_id: COMPANY_ID, method_type: 'vodafone_cash', display_name: 'فودافون كاش (المكتب)', account_holder: 'محمود السيد عبد الغني', instapay_address: null, wallet_phone: '01098765432', bank_name: null, bank_account_number: null, iban: null, instructions: null, is_active: false, sort_order: 3, created_at: daysAgo(150) },
    { id: uuid(), company_id: COMPANY_ID, method_type: 'instapay', display_name: 'إنستاباي (قديم)', account_holder: 'أحمد سعيد النورس', instapay_address: 'nawras.bus@instapay', wallet_phone: null, bank_name: null, bank_account_number: null, iban: null, instructions: null, is_active: false, sort_order: 4, created_at: daysAgo(400) },
  );
}

if (sessionStorage.getItem('preview.payNone')) methods.forEach((m) => { m.is_active = false; });
if (sessionStorage.getItem('preview.payOne')) methods.splice(1);
reg({
  reorder_payment_methods: ({ p_ids }) => {
    const own = methods.filter((m) => m.company_id === COMPANY_ID);
    if (own.length !== p_ids.length || own.some((m) => !p_ids.includes(m.id))) fail('تغيّرت وسائل الدفع منذ فتحت الصفحة. حدّث الصفحة ثم رتّبها من جديد.');
    p_ids.forEach((id: string, i: number) => { own.find((m) => m.id === id)!.sort_order = i; });
    return own.sort((a, b) => a.sort_order - b.sort_order).map((m) => ({ id: m.id, sort_order: m.sort_order }));
  },
});

// ─────────────────────────────────────────────────────────────── revenue ────

const NAMES = [
  'منة الله إبراهيم عبد الرازق', 'عبد الرحمن محمد السيد عبد الغني', 'يوسف أحمد البنا', 'ملك حسام الدين الشربيني', 'عمر خالد إسماعيل الشناوي',
  'سلمى طارق عبد الحميد', 'مريم عبد العزيز عبد الفتاح', 'أحمد محمود فتحي أبو العينين', 'نور الهدى سامي الدسوقي', 'كريم وائل مصطفى',
  'هاجر مصطفى كامل عبد الرازق', 'زياد عماد الدين عبد الغني', 'روان أشرف البنا', 'منة الله إبراهيم الشربيني', 'عبد الرحمن محمد السيد الشناوي',
  'يوسف أحمد عبد الحميد', 'ملك حسام الدين عبد الفتاح', 'عمر خالد إسماعيل أبو العينين', 'سلمى طارق الدسوقي', 'مريم عبد العزيز مصطفى',
  'أحمد محمود فتحي عبد الرازق', 'نور الهدى سامي عبد الغني', 'كريم وائل البنا', 'هاجر مصطفى كامل الشربيني', 'زياد عماد الدين الشناوي',
];
const UNIS = ['جامعة دمياط', 'جامعة حورس', 'المعهد العالي بدمياط الجديدة'];
const LINE_ORDER = ['دمياط الجديدة', 'السرو', 'شربين', 'كفر البطيخ', 'كفر سعد', 'الزرقا', 'ميت أبو غالب', 'فارسكور'];
const METHOD_NAMES = ['إنستاباي النورس', 'فودافون كاش', 'إنستاباي النورس', 'البنك الأهلي المصري'];
// 718 subscriptions: 180 both, 300 first, 31 second ahead (24 paid), 127 daily cash, and 80 unpaid in the first term.
const KIND = (i: number): Row => {
  // the board's first 25 rows, then the rest
  const pattern = ['both', 'second', 'first', 'daily', 'first', 'both', 'second', 'first_unpaid', 'daily', 'first_rejected', 'both', 'second', 'first', 'daily', 'first', 'both_review', 'second', 'first', 'daily', 'first_unpaid', 'both', 'second', 'first', 'daily', 'first'];
  return { k: pattern[i % 25] };
};
let REPORT: Row[] | null = null;
function reportRows(): Row[] {
  if (REPORT) return REPORT;
  const counts: Row = { both: 0, first: 0, second: 0, second_unpaid: 0, daily: 0, unpaid: 0 };
  const rows: Row[] = [];
  let receipt = 1642;
  for (let i = 0; rows.length < 718; i += 1) {
    let { k } = KIND(i);
    // keep the board's totals: 180 · 300 · 24 (+7 unpaid) · 127 · 87 unpaid in all
    if (k === 'both' && counts.both >= 180) k = 'first';
    if (k === 'first' && counts.first >= 300) k = 'daily';
    if (k === 'second' && counts.second >= 24) k = counts.second_unpaid < 7 ? 'second_unpaid' : 'daily';
    if (k === 'daily' && counts.daily >= 127) k = 'first_unpaid';
    if (k.includes('_') && !k.startsWith('second') && counts.unpaid >= 80) k = counts.first < 300 ? 'first' : counts.both < 180 ? 'both' : 'daily';
    const unpaid = k.includes('_');
    const opt = k.split('_')[0];
    if (k === 'second_unpaid') counts.second_unpaid += 1; else if (unpaid) counts.unpaid += 1; else counts[opt] += 1;
    const n = rows.length;
    const dayN = Math.floor(n / 3);
    const paidAt = unpaid ? null : daysAgo(dayN, (n % 3) * 3, 20);
    const price = opt === 'both' ? 8000 : opt === 'daily' ? 60 : 4500;
    const method = opt === 'daily' ? null : METHOD_NAMES[n % 4];
    const status = k.endsWith('rejected') ? 'rejected' : k.endsWith('review') ? 'pending_review' : unpaid ? 'pending_payment'
      : opt === 'daily' ? 'expired' : opt === 'second' ? 'active' : 'active';
    const phase = opt === 'second' ? 'upcoming' : opt === 'daily' ? 'expired' : 'current';
    const student = STUDENTS[n % STUDENTS.length];
    rows.push({
      id: `r${n}`, student_id: student.id, student_name: NAMES[n % 25] ?? student.full_name,
      phone: `01${[0, 1, 2][n % 3]}${String(34567890 - n * 3700).slice(0, 8)}`, university: UNIS[n % 3], company: 'النورس للنقل', line: LINE_ORDER[n % 8],
      type: opt === 'daily' ? 'daily' : opt === 'both' ? 'yearly' : 'termly', period: opt, academic_year: 2026,
      label: opt === 'daily' ? 'اشتراك يومي' : `${{ both: 'الفصلان معاً', first: 'الفصل الأول', second: 'الفصل الثاني' }[opt as 'both']} 2026/2027`,
      status, phase, paid: !unpaid, amount: unpaid ? null : price, price, paid_at: paidAt,
      start_date: opt === 'second' ? '2027-02-06' : opt === 'daily' ? (paidAt ?? '').slice(0, 10) : '2026-09-26',
      end_date: opt === 'both' || opt === 'second' ? '2027-06-03' : opt === 'daily' ? (paidAt ?? '').slice(0, 10) : '2027-01-21',
      payment_method: unpaid ? null : method, receipt_no: unpaid || !method ? null : (receipt -= 3) + 3, receipt_code: null,
    });
  }
  REPORT = rows;
  return rows;
}
let RESETS: Row[] = [
  { id: uuid(), scope: 'financial', reset_at: '2026-09-01T05:12:00Z', note: 'بداية العام الدراسي 2026/2027', undone_at: null, company_id: COMPANY_ID, reset_by_name: ADMINS.company.full_name, undone_by_name: null },
  { id: uuid(), scope: 'all', reset_at: '2026-06-14T15:40:00Z', note: 'تجربة قبل الفصل الصيفي', undone_at: '2026-06-14T16:02:00Z', company_id: COMPANY_ID, reset_by_name: ADMINS.company.full_name, undone_by_name: ADMINS.company.full_name },
  { id: uuid(), scope: 'financial', reset_at: '2026-02-07T07:05:00Z', note: 'بداية الفصل الثاني', undone_at: null, company_id: COMPANY_ID, reset_by_name: ADMINS.company.full_name, undone_by_name: null },
];
const baseline = () => RESETS.filter((r) => !r.undone_at).map((r) => r.reset_at).sort().pop() ?? null;

function filtered(f: Row) {
  const since = f.include_before_reset ? null : baseline();
  const term = String(f.search ?? '').trim();
  const digits = term.replace(/\D/g, '');
  const lineName = f.line_id ? LINES.find((l) => l.id === f.line_id)?.name : null;
  const uni = f.university_id ? UNIVERSITIES.find((u) => u.id === f.university_id)?.name : null;
  return reportRows().filter((r) => (!since || (r.paid_at ?? daysAgo(1)) > since)
    && (!term || r.student_name.includes(term) || (digits && r.phone.includes(digits)))
    && (!f.period || r.period === f.period) && (!f.payment || (f.payment === 'paid') === r.paid)
    && (!f.phase || r.phase === f.phase) && (!lineName || r.line === lineName) && (!uni || r.university === uni)
    && (!f.academic_year || Number(f.academic_year) === r.academic_year));
}
const totalsOf = (rows: Row[]) => {
  const paid = rows.filter((r) => r.paid);
  const sum = (list: Row[]) => list.reduce((n, r) => n + Number(r.amount ?? 0), 0);
  const of = (p: string) => sum(paid.filter((r) => r.period === p));
  return {
    count: rows.length, paid: paid.length, unpaid: rows.filter((r) => !r.paid).length, upcoming: rows.filter((r) => r.phase === 'upcoming').length,
    upcoming_paid: paid.filter((r) => r.phase === 'upcoming').length, expired: rows.filter((r) => r.phase === 'expired').length,
    revenue: sum(paid), revenue_first: of('first'), revenue_second: of('second'), revenue_summer: 0, revenue_both: of('both'), revenue_annual: of('both'), revenue_daily: of('daily'),
  };
};
// The board's own split by line and by method, for the page as it first opens.
const BOARD_LINES: [string, number][] = [['دمياط الجديدة', 702_400], ['الزرقا', 518_900], ['شربين', 455_300], ['فارسكور', 398_720], ['كفر سعد', 301_500], ['السرو', 247_800], ['ميت أبو غالب', 181_000], ['كفر البطيخ', 100_000]];
const BOARD_METHODS = [
  { kind: 'method', name: 'إنستاباي النورس', method_type: 'instapay', paid: 361, amount: 1_612_000 },
  { kind: 'method', name: 'فودافون كاش', method_type: 'vodafone_cash', paid: 171, amount: 786_000 },
  { kind: 'method', name: 'البنك الأهلي المصري', method_type: 'bank', paid: 99, amount: 500_000 },
  { kind: 'cash', name: null, method_type: null, paid: 127, amount: 7_620 },
];

reg({
  admin_subscription_report: ({ p_filters = {} }) => {
    const rows = filtered(p_filters);
    const offset = Number(p_filters.offset ?? 0); const limit = Number(p_filters.limit ?? 2000);
    return { baseline: p_filters.include_before_reset ? null : baseline(), rows_total: rows.length, totals: totalsOf(rows), rows: rows.slice(offset, offset + limit) };
  },
  company_revenue_breakdown: ({ p_filters = {} }) => {
    const rows = filtered(p_filters);
    const t = totalsOf(rows);
    const paid = rows.filter((r) => r.paid);
    const sum = (list: Row[]) => list.reduce((n, r) => n + Number(r.amount ?? 0), 0);
    const plain = !Object.entries(p_filters).some(([k, v]) => v && k !== 'company_id') && t.revenue === 2_905_620;
    const lineIds = Object.fromEntries(LINES.map((l) => [l.name, l.id]));
    return {
      baseline: p_filters.include_before_reset ? null : baseline(),
      totals: { count: t.count, paid: t.paid, unpaid: t.unpaid, in_review: rows.filter((r) => r.status === 'pending_review').length, upcoming: t.upcoming, upcoming_paid: t.upcoming_paid,
        daily_paid: paid.filter((r) => r.period === 'daily').length, revenue: t.revenue },
      by_option: ['both', 'first', 'second', 'daily', 'summer'].map((option) => {
        const of = rows.filter((r) => r.period === option);
        return { option, paid: of.filter((r) => r.paid).length, amount: sum(of.filter((r) => r.paid)), upcoming: of.filter((r) => r.phase === 'upcoming').length, upcoming_paid: of.filter((r) => r.phase === 'upcoming' && r.paid).length };
      }),
      by_line: plain ? BOARD_LINES.map(([name, amount]) => ({ line_id: lineIds[name] ?? null, name, is_active: true, paid: Math.round(amount / 4600), amount }))
        : LINE_ORDER.map((name) => { const p = paid.filter((r) => r.line === name); return { line_id: lineIds[name] ?? null, name, is_active: true, paid: p.length, amount: sum(p) }; }).sort((a, b) => b.amount - a.amount),
      by_method: plain ? BOARD_METHODS.map((m) => ({ ...m, method_id: null }))
        : [...new Set(paid.map((r) => r.payment_method ?? ''))].map((name) => {
          const p = paid.filter((r) => (r.payment_method ?? '') === name);
          return { kind: name ? 'method' : 'cash', method_id: null, name: name || null, method_type: null, paid: p.length, amount: sum(p) };
        }).sort((a, b) => b.amount - a.amount),
    };
  },
  company_report_resets: () => RESETS,
  admin_reset_reports: ({ p_scope, p_confirm, p_note }) => {
    if (p_confirm !== (p_scope === 'all' ? 'RESET ALL DATA' : 'RESET FINANCIAL DATA')) fail('عبارة التأكيد غير صحيحة.');
    const row = { id: uuid(), scope: p_scope, reset_at: iso(now()), note: p_note || null, undone_at: null, company_id: COMPANY_ID, reset_by_name: ADMINS.company.full_name, undone_by_name: null };
    RESETS = [row, ...RESETS];
    return { id: row.id, company_id: COMPANY_ID, scope: p_scope, reset_at: row.reset_at };
  },
  admin_undo_report_reset: ({ p_reset_id }) => {
    const r = RESETS.find((x) => x.id === p_reset_id && !x.undone_at);
    if (!r) fail('عملية التصفير غير موجودة أو أُلغيت بالفعل.');
    r!.undone_at = iso(now()); r!.undone_by_name = ADMINS.company.full_name;
    return null;
  },
});
// report_resets read directly (the older dashboard's way).
tables.report_resets ??= RESETS.map(({ reset_by_name: _a, undone_by_name: _b, ...r }) => r);

// ─────────────────────────────────────────────────────────── the card ────

const CARD: Row = {
  company_id: COMPANY_ID, company_name: 'النورس للنقل', logo_path: null, contact_phone: '0572401188', contact_label: 'مكتب النقل',
  background_color: '#0B6B4C', foreground_color: '#FFFFFF', label_color: '#A6CDBF', card_title: null, banner_path: null, revision: 7,
  updated_at: '2026-09-01T06:10:00Z', updated_by_name: ADMINS.company.full_name, apple_cards: 214, google_cards: 172, pending_cards: 0,
};
let pendingSync = 0;
reg({
  get_wallet_card_settings: () => (state() === 'empty'
    ? { ...CARD, logo_path: null, contact_phone: null, contact_label: null, background_color: '#00658D', foreground_color: '#FFFFFF', label_color: '#A6CDDB', updated_at: null, updated_by_name: null, apple_cards: 0, google_cards: 0, pending_cards: 0 }
    : { ...CARD, pending_cards: sessionStorage.getItem('preview.cardPending') ? 23 : CARD.pending_cards }),
  set_wallet_card_settings: (a) => {
    Object.assign(CARD, {
      background_color: a.p_background_color, foreground_color: a.p_foreground_color, label_color: a.p_label_color, card_title: a.p_card_title || null,
      banner_path: a.p_banner_path, logo_path: a.p_logo_path, contact_phone: a.p_contact_phone || null, contact_label: a.p_contact_label || null,
      revision: CARD.revision + 1, updated_at: iso(now()), updated_by_name: ADMINS.company.full_name,
    });
    pendingSync = CARD.apple_cards + CARD.google_cards;
    CARD.pending_cards = pendingSync;
    return null;
  },
});
registerFunctions({
  'wallet-sync': async () => {
    await new Promise((r) => setTimeout(r, 700));
    const n = Math.min(120, CARD.pending_cards);
    CARD.pending_cards -= n;
    return { updated: n, failed: 0, remaining: CARD.pending_cards, done: CARD.pending_cards === 0, errors: [] };
  },
});

// ─────────────────────────────────────────────────────── notifications ────

const ME = ADMINS.company.full_name;
type N = Row;
const n = (o: Partial<N>): N => ({
  id: uuid(), type: 'announcement.admin', category: 'announcement', priority: 'normal', created_at: o.sent_at ?? o.scheduled_at ?? iso(now()), scheduled_at: null,
  sent_at: null, status: 'sent', status_note: null, sender_role: 'admin', sender_name: ME, audience: 'كل طلاب الشركة', audience_spec: { kind: 'company' },
  line_id: null, students: 0, read: 0, opened: 0, push: { devices: 0, queued: 0, accepted: 0, failed: 0, skipped: 0 }, ...o,
});
const at = (d: number, h: number, m: number) => cairoLocalToIso(`${addDays(cairoToday(), -d)}T${pad(h)}:${pad(m)}`)!;
const line = (name: string) => LINES.find((l) => l.name === name);
const sup = (name: string, d: number, h: number, m: number, title: string, body: string, ln: string, students: number, read: number, type: string): N =>
  n({ type, category: 'transport', sender_role: 'supervisor', sender_name: name, audience: `ركاب رحلة · خط ${ln}`, audience_spec: null, line_id: line(ln)?.id ?? null,
    sent_at: at(d, h, m), students, read, opened: Math.round(read / 2) });
const sys = (d: number, h: number, m: number, type: string, title: string, body: string, students: number, read: number): N =>
  n({ type, category: 'subscription', sender_role: 'system', sender_name: null, audience: students === 1 ? 'طالب واحد' : `${students} طالباً`, audience_spec: null, sent_at: at(d, h, m), title, body, students, read });
const repeat = (d: number): N[] => [
  { ...sup('محمود السيد', d, 7, 2, '', '', 'السرو', 44, 40, 'transport.arrived'), title: 'وصول الباص', body: 'الباص وصل إلى محطة كوبري السرو.' },
  sys(d, 16, 15, 'subscription.rejected', 'رفض الإيصال', 'لم نستطع قبول إيصالك: المبلغ أقل من ثمن الاشتراك.', 1, 1),
  { ...sup('محمود السيد', d, 7, 0, '', '', 'الزرقا', 38, 30, 'transport.departed'), title: 'انطلاق الرحلة', body: 'انطلقت رحلة 7:00 ص من الزرقا.' },
  sys(d, 22, 0, 'subscription.expiring', 'اقتراب انتهاء الاشتراك', 'ينتهي اشتراكك بعد 7 أيام. جدّده من التطبيق.', 12, 6),
  n({ title: 'امتحانات منتصف الفصل', body: 'في أسبوع الامتحانات تعمل كل الرحلات في مواعيدها المعتادة.', audience: 'طلاب جامعة حورس', audience_spec: { kind: 'university', university_id: UNIVERSITIES[6].id }, sent_at: at(d + 1, 13, 30), students: 147, read: 106, opened: 51 }),
  { ...sup('سامح فتحي', d + 1, 13, 50, '', '', 'كفر سعد', 27, 23, 'transport.return_departing'), title: 'العودة من الجامعة', body: 'باص العودة 2:00 م يتحرك بعد 10 دقائق.' },
];
const HISTORY: N[] = [
  n({ status: 'scheduled', title: 'إجازة المولد النبوي', body: 'الخميس 15 أكتوبر إجازة رسمية ولا توجد رحلات. تعود الرحلات السبت في مواعيدها.', scheduled_at: at(-4, 18, 0), created_at: daysAgo(0, 2) }),
  { ...sup('محمود السيد', 0, 14, 41, '', '', 'شربين', 31, 27, 'transport.delay'), priority: 'high', title: 'تأخير رحلة العودة', body: 'رحلة العودة 3:00 م من جامعة دمياط تتأخر 20 دقيقة بسبب زحام الكوبري.' },
  n({ title: 'تعديل مواعيد الرحلات', body: 'تم تعديل مواعيد بعض الرحلات، راجع مواعيدك في التطبيق قبل تأكيد الركوب.', audience: 'طلاب خط فارسكور', audience_spec: { kind: 'line', line_id: line('فارسكور')?.id }, line_id: line('فارسكور')?.id, sent_at: at(0, 9, 12), created_at: at(0, 9, 10), students: 96, read: 71, opened: 38, push: { devices: 83, queued: 0, accepted: 81, failed: 2, skipped: 13 } }),
  n({ status: 'failed', title: 'تذكير بسداد الاشتراك', body: 'اقترب موعد سداد الاشتراك. ادفع من صفحة الاشتراك في التطبيق لتستمر رحلاتك.', status_note: 'لم يصل إلى أحد: انقطع الاتصال أثناء الإرسال.', created_at: at(1, 20, 0) }),
  sys(1, 18, 25, 'subscription.approved', 'قبول الاشتراك', 'تم قبول إيصالك، واشتراكك في الفصل الأول نشط الآن.', 1, 1),
  n({ status: 'cancelled', title: 'رحلة إضافية يوم السبت', body: 'رحلة إضافية يوم السبت 7:30 ص لطلاب دمياط الجديدة.', status_note: 'ألغيته قبل موعده.', audience: 'طلاب خط دمياط الجديدة', scheduled_at: at(2, 17, 30), created_at: at(3, 10, 0) }),
  ...repeat(3), ...repeat(4), ...repeat(5), ...repeat(6), ...repeat(7),
];
HISTORY.forEach((h) => { if (!h.sent_at && h.status === 'sent') h.sent_at = h.created_at; if (h.status === 'sent' && !h.created_at) h.created_at = h.sent_at; });

const AUDIENCE = (spec: Row) => {
  if (!spec) fail('اختر من يصله الإشعار.');
  switch (spec.kind) {
    case 'company': return { label: 'كل طلاب الشركة', students: 718, supervisors: 5, devices: 604 };
    case 'line': { const l = LINES.find((x) => x.id === spec.line_id); const i = LINES.indexOf(l!); return { label: `طلاب خط ${l?.name ?? ''}`, students: [168, 124, 112, 96, 74, 61, 45, 38][i] ?? 40, supervisors: 1, devices: [140, 101, 90, 83, 60, 50, 33, 30][i] ?? 30 }; }
    case 'trip': { const l = LINES.find((x) => x.id === spec.line_id); const zero = l?.name === 'شربين' && spec.trip_id === l?.line_trips?.find((t: Row) => t.direction === 'return')?.id; return { label: `ركاب رحلة · خط ${l?.name ?? ''}`, students: zero ? 0 : 38, supervisors: 1, devices: zero ? 0 : 31 }; }
    case 'university': { const u = UNIVERSITIES.find((x) => x.id === spec.university_id); return { label: `طلاب ${u?.name ?? 'الجامعة'}`, students: 147, supervisors: 3, devices: 120 }; }
    default: return fail('اختر من يصله الإشعار.');
  }
};

reg({
  get_company_notifications_page: ({ p_before, p_limit = 30, p_status }) => {
    const list = HISTORY.filter((h) => !p_status || h.status === p_status)
      .sort((a, b) => (b.sent_at ?? b.scheduled_at ?? b.created_at).localeCompare(a.sent_at ?? a.scheduled_at ?? a.created_at));
    const from = p_before ? list.findIndex((h) => (h.sent_at ?? h.scheduled_at ?? h.created_at) < p_before) : 0;
    const items = from < 0 ? [] : list.slice(from, from + p_limit);
    const last = items[items.length - 1];
    return { items: state() === 'empty' ? [] : items, next_before: state() !== 'empty' && from + p_limit < list.length && last ? (last.sent_at ?? last.scheduled_at ?? last.created_at) : null,
      push_configured: sessionStorage.getItem('preview.pushOff') ? false : true };
  },
  preview_notification_audience: ({ p_audience }) => AUDIENCE(p_audience),
  compose_notification: ({ p_title, p_body, p_audience, p_scheduled_at, p_priority }) => {
    const a = AUDIENCE(p_audience);
    const row = n({ title: p_title, body: p_body, priority: p_priority, audience: a.label, audience_spec: p_audience, students: p_scheduled_at ? 0 : a.students,
      status: p_scheduled_at ? 'scheduled' : 'sent', scheduled_at: p_scheduled_at, sent_at: p_scheduled_at ? null : iso(now()), created_at: iso(now()) });
    HISTORY.unshift(row);
    return { id: row.id, status: row.status, students: a.students, duplicate: false };
  },
  update_scheduled_notification: ({ p_id, p_title, p_body, p_audience, p_scheduled_at }) => {
    const r = HISTORY.find((h) => h.id === p_id);
    if (!r || r.status !== 'scheduled') fail('هذا الإشعار لم يعد مجدولاً.');
    Object.assign(r!, { title: p_title, body: p_body, audience_spec: p_audience, audience: AUDIENCE(p_audience).label, scheduled_at: p_scheduled_at });
    return null;
  },
  cancel_scheduled_notification: ({ p_id }) => { const r = HISTORY.find((h) => h.id === p_id); if (r) Object.assign(r, { status: 'cancelled', status_note: 'ألغيته قبل موعده.' }); return null; },
  delete_notification: ({ p_id }) => { const i = HISTORY.findIndex((h) => h.id === p_id); if (i >= 0) HISTORY.splice(i, 1); return null; },
});

// Registered after every handler file: the subscription page reads these, and an
// earlier file may answer them in a shorter shape for its own page.
setTimeout(() => {
  const theirs = rpcs.get_subscription_switches;
  reg({
    get_subscription_settings: ({ p_company_id }) => settings(p_company_id ?? null),
    get_subscription_switches: async (args, ctx) => ({ ...switches(), ...(theirs ? await theirs(args, ctx) : {}), ...pick(switches(), ['daily_company', 'daily_global', 'annual_company', 'annual_global']) }),
  });
}, 0);
const pick = (o: Row, k: string[]) => Object.fromEntries(k.map((x) => [x, o[x]]));
