/**
 * «الحسابات» and «تحليلات المنصة»: the functions of
 * supabase/migrations/20261119000002_platform_finance.sql, answered from an
 * in-memory book (plans, bills, costs) built over the sample companies, so the
 * writes work while the preview is open. Steady pseudo-random numbers (the same
 * every reload). `?state=empty` answers a platform with no plans, bills or costs;
 * sessionStorage `preview.fail` / `preview.hang` / `preview.missing` =
 * `platform_billing` or `platform_analytics` fail, hang, or answer as a database
 * without the function.
 */
import { registerRpc, type RpcHandler } from '../registry';
import { COMPANY_ID, COMPANY2_ID, UNIVERSITIES, tables } from '../data';
import { addDays, cairoToday } from '../../src/lib/time';

type Row = Record<string, any>;
const state = () => sessionStorage.getItem('preview.state') || new URLSearchParams(location.search).get('state') || '';
const listed = (key: string, name: string) => (sessionStorage.getItem(key) ?? '').split(',').includes(name);
const fail = (message: string, code = 'P0001'): never => { throw Object.assign(new Error(message), { code }); };
const rand = (seed: number) => {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let n = 0;
const id = (p: string) => `${p}${String(++n).padStart(4, '0')}-0000-4000-8000-000000000000`.slice(0, 36);
const GRACE = 14;
const monthsAdd = (day: string, k: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthly = (fee: number, cycle: string) => (cycle === 'termly' ? fee / 4 : cycle === 'yearly' ? fee / 12 : fee);
const at = (day: string, h = 10) => `${day}T${String(h).padStart(2, '0')}:00:00Z`;

// ── The book ──────────────────────────────────────────────────────────────────
const book = { plans: [] as Row[], charges: [] as Row[], expenses: [] as Row[], built: false };
const companies = () => tables.companies as Row[];
const nameOf = (cid: string) => companies().find((c) => c.id === cid)?.name ?? '';

/** Every period of a plan that starts on or before `until` (terms: 5 Sep – 30 Jan, 1 Feb – 30 Jun). */
function periods(p: Row, until: string): [string, string][] {
  const out: [string, string][] = [];
  const end = p.ends_on ?? '9999-12-31';
  if (p.cycle === 'termly') {
    for (let y = Number(p.starts_on.slice(0, 4)) - 1; y <= Number(until.slice(0, 4)); y++) {
      for (const [s, e] of [[`${y}-09-05`, `${y + 1}-01-30`], [`${y + 1}-02-01`, `${y + 1}-06-30`]]) {
        if (e < p.starts_on || s > end) continue;
        const ps = s < p.starts_on ? p.starts_on : s;
        if (ps <= until) out.push([ps, e < end ? e : end]);
      }
    }
    return out;
  }
  const step = p.cycle === 'yearly' ? 12 : 1;
  for (let k = 0; k < 400; k++) {
    const ps = monthsAdd(p.starts_on, k * step);
    if (ps > until || ps > end) break;
    const pe = addDays(monthsAdd(p.starts_on, (k + 1) * step), -1);
    out.push([ps, pe < end ? pe : end]);
  }
  return out;
}

function generate(until: string) {
  let made = 0;
  book.plans.filter((p) => Number(p.fee_amount) > 0 && (!p.ends_on || p.ends_on >= p.starts_on)).forEach((p) => {
    periods(p, until).forEach(([ps, pe]) => {
      if (book.charges.some((c) => c.company_id === p.company_id && c.period_start === ps)) return;
      book.charges.push({ id: id('c4a'), company_id: p.company_id, plan_id: p.id, period_start: ps, period_end: pe, amount: Number(p.fee_amount), status: 'due', paid_at: null, method: null, note: null, created_at: new Date().toISOString() });
      made++;
    });
  });
  let carried = 0;
  const latest = new Map<string, Row>();
  book.expenses.slice().sort((a, b) => a.month.localeCompare(b.month)).forEach((e) => latest.set(`${e.category}|${e.note ?? ''}`, e));
  latest.forEach((e) => {
    if (!e.recurring) return;
    for (let m = monthsAdd(e.month, 1); m <= monthStart(until); m = monthsAdd(m, 1)) {
      book.expenses.push({ ...e, id: id('e5a'), month: m, created_at: new Date().toISOString() });
      carried++;
    }
  });
  return { charges_created: made, expenses_carried: carried, until };
}

function build() {
  if (book.built) return;
  book.built = true;
  if (state() === 'empty') return;
  const today = cairoToday();
  const list = companies().filter((c) => c.status !== 'archived');
  list.forEach((c, i) => {
    // Every fifth active company has no plan yet (one of the recommendations).
    if (c.status === 'active' && i % 5 === 4) return;
    const cycle = c.id === COMPANY2_ID ? 'termly' : i % 7 === 3 ? 'yearly' : 'monthly';
    const fee = cycle === 'yearly' ? 18000 : cycle === 'termly' ? 6000 : [1500, 2000, 1200, 2500, 1800][i % 5];
    const start = c.id === COMPANY_ID ? '2025-09-01' : monthStart(addDays(today, -Math.round(60 + rand(i) * 300)));
    // The first company raised its fee this term: its history has two plans.
    if (c.id === COMPANY_ID) {
      book.plans.push({ id: id('p1a'), company_id: c.id, fee_amount: 1500, cycle: 'monthly', starts_on: start, ends_on: '2026-08-31', note: 'سعر الإطلاق', created_at: at(start), created_by: null });
      book.plans.push({ id: id('p1a'), company_id: c.id, fee_amount: 2000, cycle: 'monthly', starts_on: '2026-09-01', ends_on: null, note: null, created_at: at('2026-08-25'), created_by: null });
    } else {
      book.plans.push({ id: id('p1a'), company_id: c.id, fee_amount: fee, cycle, starts_on: start, ends_on: null, note: i % 6 === 1 ? 'خصم أول سنة' : null, created_at: at(start), created_by: null });
    }
  });
  generate(today);
  // Most bills are paid a few days into their period; some are late, one was waived.
  book.charges.forEach((c, k) => {
    const late = c.company_id === list[2]?.id || c.company_id === list[8]?.id;
    const recent = c.period_start > addDays(today, -20);
    if (!recent && !(late && c.period_start > addDays(today, -80))) {
      c.status = k % 23 === 5 ? 'waived' : 'paid';
      if (c.status === 'paid') { c.paid_at = at(addDays(c.period_start, 2 + (k % 9)), 9 + (k % 8)); c.method = ['إنستاباي', 'تحويل بنكي', 'فودافون كاش'][k % 3]; }
      else c.note = 'شهر مجاني بعد عطل';
    }
  });
  // Running costs: the last ten months.
  const first = monthsAdd(monthStart(today), -9);
  for (let m = first, k = 0; m <= monthStart(today); m = monthsAdd(m, 1), k++) {
    const last = m === monthStart(today);
    book.expenses.push({ id: id('e5a'), month: m, category: 'hosting', amount: 1450, note: 'Supabase Pro', recurring: last, created_at: at(m) });
    book.expenses.push({ id: id('e5a'), month: m, category: 'sms', amount: Math.round(700 + rand(k + 40) * 900), note: null, recurring: false, created_at: at(m) });
    book.expenses.push({ id: id('e5a'), month: m, category: 'salaries', amount: k < 5 ? 15000 : 22000, note: 'الدعم الفني', recurring: last, created_at: at(m) });
    if (k % 3 === 0) book.expenses.push({ id: id('e5a'), month: m, category: 'marketing', amount: 4000 + k * 300, note: 'إعلانات الجامعات', recurring: false, created_at: at(m) });
    if (m.slice(5, 7) === '09') book.expenses.push({ id: id('e5a'), month: m, category: 'app_store', amount: 5200, note: 'اشتراك المطوّر السنوي', recurring: false, created_at: at(m) });
  }
  book.expenses.push({ id: id('e5a'), month: monthStart(today), category: 'domain', amount: 650, note: null, recurring: false, created_at: at(today) });
}

const chargeOut = (c: Row) => ({ ...c, company_name: nameOf(c.company_id) });

// ── platform_billing ──────────────────────────────────────────────────────────
const billing: RpcHandler = () => {
  build();
  const today = cairoToday();
  const open = (cid: string) => book.plans.find((p) => p.company_id === cid && !p.ends_on);
  const dues = (cid: string) => {
    const due = book.charges.filter((c) => c.company_id === cid && c.status === 'due' && c.period_start <= today);
    return {
      outstanding: due.reduce((t, c) => t + c.amount, 0),
      overdue: due.filter((c) => addDays(c.period_start, GRACE) < today).reduce((t, c) => t + c.amount, 0),
      oldest: due.map((c) => c.period_start).sort()[0] ?? null,
    };
  };
  const months = new Map<string, Row>();
  const row = (m: string) => months.get(m) ?? (months.set(m, { month: m, billed: 0, collected: 0, costs: 0, profit: 0 }), months.get(m)!);
  book.charges.forEach((c) => { if (c.status !== 'waived') row(c.period_start.slice(0, 7)).billed += c.amount; if (c.paid_at) row(c.paid_at.slice(0, 7)).collected += c.amount; });
  book.expenses.forEach((e) => { row(e.month.slice(0, 7)).costs += e.amount; });
  return {
    today, grace_days: GRACE,
    mrr: companies().reduce((t, c) => { const p = open(c.id); return p && c.status !== 'archived' && p.starts_on <= today ? t + monthly(p.fee_amount, p.cycle) : t; }, 0),
    companies: companies().slice().sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.name.localeCompare(b.name, 'ar')).map((c) => {
      const p = open(c.id); const d = dues(c.id);
      return {
        id: c.id, name: c.name, status: c.status, created_at: c.created_at,
        plan: p ? { id: p.id, fee_amount: p.fee_amount, cycle: p.cycle, starts_on: p.starts_on, note: p.note, created_at: p.created_at } : null,
        monthly_fee: p ? monthly(p.fee_amount, p.cycle) : null, outstanding: d.outstanding, overdue: d.overdue, oldest_due: d.oldest,
      };
    }),
    plans: book.plans.slice().sort((a, b) => nameOf(a.company_id).localeCompare(nameOf(b.company_id), 'ar') || b.starts_on.localeCompare(a.starts_on))
      .map((p) => ({ ...p, company_name: nameOf(p.company_id), created_by_name: p.created_by ? 'محمد عادل' : null })),
    charges: book.charges.slice().sort((a, b) => b.period_start.localeCompare(a.period_start)).map(chargeOut),
    expenses: book.expenses.slice().sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount),
    pnl: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ ...r, profit: r.collected - r.costs })),
  };
};

// ── platform_analytics ────────────────────────────────────────────────────────
const COLLEGES: [string, number][] = [['الهندسة', 1840], ['التجارة', 1420], ['الحاسبات والمعلومات', 1180], ['الطب', 860], ['الصيدلة', 710], ['العلوم', 540], ['التربية', 490], ['الآداب', 410], ['طب الأسنان', 300], ['الحقوق', 260], ['التمريض', 190], ['الزراعة', 150]];
const SPECS: [string, number][] = [['علوم الحاسب', 720], ['مدني', 610], ['محاسبة', 580], ['كهرباء', 440], ['ميكانيكا', 390], ['إدارة أعمال', 330], ['نظم معلومات', 270], ['كيمياء', 190]];

const analytics: RpcHandler = (args) => {
  build();
  const today = cairoToday();
  const from: string | null = args.p_from ?? null;
  const to: string = args.p_to && args.p_to < today ? args.p_to : today;
  const lo = from ?? '2000-01-01';
  const prevTo = from ? addDays(from, -1) : null;
  const all = companies();
  const active = all.filter((c) => c.status === 'active');
  const empty = state() === 'empty';

  const inPeriod = (day: string) => day >= lo && day <= to;
  const paidIn = book.charges.filter((c) => c.paid_at && inPeriod(c.paid_at.slice(0, 10)));
  const billedIn = book.charges.filter((c) => c.status !== 'waived' && inPeriod(c.period_start));
  const costsIn = book.expenses.filter((e) => e.month >= monthStart(lo) && e.month <= to);
  const collected = paidIn.reduce((t, c) => t + c.amount, 0);
  const costs = costsIn.reduce((t, e) => t + e.amount, 0);
  const overdueMap = new Map<string, Row>();
  book.charges.filter((c) => c.status === 'due' && addDays(c.period_start, GRACE) < today).forEach((c) => {
    const o = overdueMap.get(c.company_id) ?? { company_id: c.company_id, name: nameOf(c.company_id), amount: 0, oldest_due: c.period_start };
    o.amount += c.amount; if (c.period_start < o.oldest_due) o.oldest_due = c.period_start; overdueMap.set(c.company_id, o);
  });
  const byCat = new Map<string, number>();
  costsIn.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
  const months: string[] = [];
  const firstMonth = from ? from.slice(0, 7) : [...book.charges.map((c) => c.period_start), ...book.expenses.map((e) => e.month)].sort()[0]?.slice(0, 7);
  if (firstMonth) for (let m = `${firstMonth}-01`; m <= to; m = monthsAdd(m, 1)) months.push(m.slice(0, 7));
  const byMonth = months.map((m) => {
    const billed = billedIn.filter((c) => c.period_start.startsWith(m)).reduce((t, c) => t + c.amount, 0);
    const col = paidIn.filter((c) => c.paid_at.startsWith(m)).reduce((t, c) => t + c.amount, 0);
    const cost = costsIn.filter((e) => e.month.startsWith(m)).reduce((t, e) => t + e.amount, 0);
    return { month: m, billed, collected: col, costs: cost, profit: col - cost };
  });

  // Companies: steady numbers per company.
  const list = empty ? all.map((c) => ({ id: c.id, name: c.name, status: c.status, created_at: c.created_at, students: 0, subscribers: 0, subscribers_before: prevTo ? 0 : null, lines: 0, active_lines: 0, ride_days: 0, riders_avg: 0, confirm_rate: null, company_revenue: 0, plan_fee: null, plan_cycle: null, outstanding: 0, overdue: 0, last_admin_seen: null, median_review_hours: null, reviewed: 0, health: c.status === 'active' ? 45 : null }))
    : all.map((c, i) => {
      const r = rand(i + 7);
      const students = c.id === COMPANY_ID ? 806 : c.id === COMPANY2_ID ? 212 : c.status === 'archived' ? 0 : Math.round(40 + r * 560);
      const subscribers = c.status === 'active' ? Math.round(students * (0.55 + rand(i + 3) * 0.35)) : 0;
      const declining = i === 6;
      const before = prevTo ? (declining ? Math.round(subscribers * 1.45) : Math.round(subscribers * (0.92 + rand(i + 11) * 0.1))) : null;
      const plan = book.plans.find((p) => p.company_id === c.id && !p.ends_on);
      const due = book.charges.filter((x) => x.company_id === c.id && x.status === 'due' && x.period_start <= today);
      const outstanding = due.reduce((t, x) => t + x.amount, 0);
      const overdue = due.filter((x) => addDays(x.period_start, GRACE) < today).reduce((t, x) => t + x.amount, 0);
      const confirm = c.status === 'active' && subscribers ? Math.round((0.52 + rand(i + 5) * 0.4) * 1000) / 1000 : null;
      const seenDays = i === 4 ? 26 : i === 9 ? null : Math.floor(rand(i + 13) * 9);
      const review = c.status === 'active' && subscribers ? Math.round((i === 5 ? 31 : 2 + rand(i + 17) * 18) * 10) / 10 : null;
      const span = from ? Math.max(1, (Date.parse(to) - Date.parse(from)) / 86_400_000 / 30) : 6;
      const seen = seenDays == null ? null : new Date(Date.now() - seenDays * 86_400_000 - 3_600_000 * (i % 10)).toISOString();
      const health = c.status !== 'active' ? null : Math.min(100, (seenDays == null ? 0 : seenDays < 7 ? 25 : seenDays < 14 ? 15 : 5)
        + Math.round(30 * (confirm ?? 0)) + (overdue ? 0 : outstanding ? 15 : 25) + (review == null || review <= 24 ? 20 : review <= 48 ? 10 : 0));
      const lines = c.status === 'archived' ? 1 : 1 + (i % 4);
      return {
        id: c.id, name: c.name, status: c.status, created_at: c.created_at, students, subscribers, subscribers_before: before,
        lines, active_lines: c.status === 'active' ? Math.max(1, lines - (i % 2)) : 0, ride_days: c.status === 'active' ? Math.round(20 * Math.min(span, 6)) : 0,
        riders_avg: confirm ? Math.round(subscribers * confirm * 10) / 10 : 0, confirm_rate: confirm,
        company_revenue: c.status === 'active' ? Math.round(subscribers * 3500 * Math.min(1, span / 4) / 100) * 100 : 0,
        plan_fee: plan?.fee_amount ?? null, plan_cycle: plan?.cycle ?? null, outstanding, overdue, last_admin_seen: seen,
        median_review_hours: review, reviewed: review == null ? 0 : Math.round(subscribers * 0.3), health,
      };
    }).sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.subscribers - a.subscribers);
  const subs = list.reduce((t, c) => t + c.subscribers, 0);
  const subsPrev = list.reduce((t, c) => t + (c.subscribers_before ?? 0), 0);
  const costsPrev = prevTo ? book.expenses.filter((e) => e.month >= monthStart(addDays(from!, -(Date.parse(to) - Date.parse(from!)) / 86_400_000 - 1)) && e.month <= prevTo).reduce((t, e) => t + e.amount, 0) : 0;
  const mrr = all.reduce((t, c) => { const p = book.plans.find((x) => x.company_id === c.id && !x.ends_on); return p && c.status !== 'archived' && p.starts_on <= today ? t + monthly(p.fee_amount, p.cycle) : t; }, 0);
  const finance = {
    mrr: Math.round(mrr * 100) / 100, billed: billedIn.reduce((t, c) => t + c.amount, 0), collected,
    outstanding: book.charges.filter((c) => c.status === 'due' && c.period_start <= today).reduce((t, c) => t + c.amount, 0),
    overdue: [...overdueMap.values()].sort((a, b) => a.oldest_due.localeCompare(b.oldest_due)),
    costs_total: costs, costs_by_category: [...byCat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    by_month: byMonth, profit: collected - costs, margin: collected > 0 ? Math.round(((collected - costs) / collected) * 1000) / 1000 : null,
    cost_per_company: active.length ? Math.round((costs / active.length) * 100) / 100 : null,
    cost_per_student: subs ? Math.round((costs / subs) * 100) / 100 : null,
    cost_per_student_before: prevTo && subsPrev ? Math.round((costsPrev / subsPrev) * 100) / 100 : null,
    subscribers: subs, active_companies: active.length,
  };

  // Students and universities.
  const total = empty ? 0 : 9840;
  const shares = [0.34, 0.22, 0.16, 0.09, 0.07, 0.05, 0.03];
  const by_university = empty ? [] : [
    ...UNIVERSITIES.map((u, i) => ({ id: u.id, name: u.name, students: Math.round(total * (shares[i] ?? 0.01)), companies: [9, 6, 4, 0, 2, 1, 0][i] ?? 0, lines: [21, 12, 7, 0, 3, 1, 0][i] ?? 0 })),
    { id: null, name: null, students: Math.round(total * 0.04), companies: 0, lines: 0 },
  ].sort((a, b) => b.students - a.students);
  const days: Row[] = [];
  if (!empty) {
    for (let d = addDays(to, -119) < lo ? lo : addDays(to, -119); d <= to; d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow > 4 || d < '2026-02-01' || (d > '2026-06-30' && d < '2026-09-20')) continue;
      const k = days.length;
      const confirmed = Math.round(subs * (0.62 + rand(k + 200) * 0.12) * [1, 0.97, 0.95, 0.93, 0.84][dow]);
      days.push({ date: d, confirmed, boarded: Math.round(confirmed * (0.86 + rand(k + 300) * 0.07)) });
    }
  }
  const daily = days.slice(-60);
  const newByMonth = empty ? [] : months.map((m, k) => ({ month: m, count: Math.round((m.endsWith('-09') ? 1900 : m.endsWith('-10') ? 1100 : m.endsWith('-02') ? 800 : 160) * (0.8 + rand(k + 60) * 0.4)) }));

  const versions = empty ? [] : [
    { platform: 'android', version: '1.0.13', devices: 3120 }, { platform: 'android', version: '1.0.12', devices: 1460 }, { platform: 'android', version: '1.0.9', devices: 1840 },
    { platform: 'android', version: '1.0.8', devices: 410 }, { platform: 'ios', version: '1.0.13', devices: 1980 }, { platform: 'ios', version: '1.0.12', devices: 520 },
  ];
  const devices = { ios: versions.filter((v) => v.platform === 'ios').reduce((t, v) => t + v.devices, 0), android: versions.filter((v) => v.platform === 'android').reduce((t, v) => t + v.devices, 0) };

  // Recommendations, by the server's rules.
  const insights: Row[] = [];
  if (!empty) {
    finance.overdue.slice().sort((a, b) => b.amount - a.amount).slice(0, 3).forEach((o) => insights.push({ key: 'company_overdue', severity: 'act', data: { ...o, days: Math.round((Date.parse(today) - Date.parse(o.oldest_due)) / 86_400_000) } }));
    const noPlan = list.filter((c) => c.status === 'active' && c.plan_fee == null);
    if (noPlan.length) insights.push({ key: 'no_plan', severity: 'act', data: { count: noPlan.length, companies: noPlan.map((c) => ({ id: c.id, name: c.name })) } });
    if (costs > 0 && costs > collected) insights.push({ key: 'unprofitable', severity: 'act', data: { costs, collected, loss: costs - collected } });
    list.filter((c) => c.status === 'active' && c.subscribers_before != null && c.subscribers_before >= 10 && c.subscribers <= 0.8 * c.subscribers_before).slice(0, 3)
      .forEach((c) => insights.push({ key: 'company_declining', severity: 'watch', data: { company_id: c.id, name: c.name, now: c.subscribers, before: c.subscribers_before, pct: Math.round(100 * (1 - c.subscribers / c.subscribers_before!)) } }));
    list.filter((c) => c.status === 'active' && (!c.last_admin_seen || Date.parse(c.last_admin_seen) < Date.now() - 14 * 86_400_000) && Date.parse(c.created_at) < Date.now() - 14 * 86_400_000).slice(0, 3)
      .forEach((c) => insights.push({ key: 'company_inactive', severity: 'watch', data: { company_id: c.id, name: c.name, last_seen: c.last_admin_seen, days: c.last_admin_seen ? Math.round((Date.now() - Date.parse(c.last_admin_seen)) / 86_400_000) : null } }));
    const latestAndroid = (tables.app_versions ?? []).find((v: Row) => v.platform === 'android')?.latest_version ?? '1.0.13';
    const oldAndroid = versions.filter((v) => v.platform === 'android' && v.version !== latestAndroid).reduce((t, v) => t + v.devices, 0);
    if (oldAndroid >= 0.25 * devices.android) insights.push({ key: 'old_app_versions', severity: 'watch', data: { platform: 'android', latest: latestAndroid, old: oldAndroid, total: devices.android, pct: Math.round((100 * oldAndroid) / devices.android) } });
    list.filter((c) => c.status === 'active' && c.reviewed >= 5 && (c.median_review_hours ?? 0) > 24).slice(0, 3)
      .forEach((c) => insights.push({ key: 'slow_reviews', severity: 'watch', data: { company_id: c.id, name: c.name, median_hours: c.median_review_hours, reviewed: c.reviewed } }));
    if (finance.cost_per_student != null && finance.cost_per_student_before && finance.cost_per_student >= 1.1 * finance.cost_per_student_before) {
      insights.push({ key: 'cost_per_student_rising', severity: 'watch', data: { now: finance.cost_per_student, before: finance.cost_per_student_before, pct: Math.round(100 * (finance.cost_per_student / finance.cost_per_student_before - 1)) } });
    }
    by_university.filter((u) => u.id && u.students >= 20 && u.lines <= 1).slice(0, 3)
      .forEach((u) => insights.push({ key: 'university_opportunity', severity: 'good', data: { university_id: u.id, name: u.name, students: u.students, lines: u.lines, companies: u.companies } }));
  }

  return {
    period: { from, to, previous_from: from ? addDays(from, -((Date.parse(to) - Date.parse(from)) / 86_400_000) - 1) : null, previous_to: prevTo },
    finance,
    companies: { counts: { total: all.length, active: active.length, suspended: all.filter((c) => c.status === 'suspended').length, archived: all.filter((c) => c.status === 'archived').length }, list },
    students: {
      total, with_company: Math.round(total * 0.83), without_company: total - Math.round(total * 0.83), subscribers: subs,
      new_in_period: newByMonth.reduce((t, m) => t + m.count, 0), new_by_month: newByMonth, by_university,
      by_college: empty ? [] : COLLEGES.map(([name, count]) => ({ name, count })), by_specialisation: empty ? [] : SPECS.map(([name, count]) => ({ name, count })),
    },
    usage: {
      daily, devices, app_versions: versions,
      latest: Object.fromEntries((tables.app_versions ?? []).map((v: Row) => [v.platform, v.latest_version])),
      push_7d: empty ? { accepted: 0, failed: 0, failure_rate: null } : { accepted: 18420, failed: 512, failure_rate: 0.027 },
    },
    insights,
  };
};

// ── Writes ────────────────────────────────────────────────────────────────────
const savePlan: RpcHandler = (a) => {
  build();
  if (!companies().some((c) => c.id === a.p_company_id)) fail('الشركة غير موجودة.', 'P0002');
  if (a.p_fee == null || a.p_fee < 0) fail('اكتب مبلغ الاشتراك (صفر أو أكثر).', '22023');
  if (!['monthly', 'termly', 'yearly'].includes(a.p_cycle)) fail('اختر كل كم يُدفع الاشتراك.', '22023');
  const open = book.plans.find((p) => p.company_id === a.p_company_id && !p.ends_on);
  if (open && a.p_starts_on < open.starts_on) fail(`الاشتراك الجديد لا يبدأ قبل بداية الاشتراك الحالي (${open.starts_on}).`, '22023');
  if (open) open.ends_on = addDays(a.p_starts_on, -1);
  book.charges = book.charges.filter((c) => !(c.company_id === a.p_company_id && c.status === 'due' && c.period_start >= a.p_starts_on));
  book.charges.forEach((c) => { if (c.company_id === a.p_company_id && c.status === 'due' && c.period_end >= a.p_starts_on) c.period_end = addDays(a.p_starts_on, -1); });
  const plan = { id: id('p1a'), company_id: a.p_company_id, fee_amount: Number(a.p_fee), cycle: a.p_cycle, starts_on: a.p_starts_on, ends_on: null, note: a.p_note?.trim() || null, created_at: new Date().toISOString(), created_by: 'me' };
  book.plans.push(plan);
  return { ...plan, ended_plan_id: open?.id ?? null };
};

const setStatus: RpcHandler = (a) => {
  build();
  const c = book.charges.find((x) => x.id === a.p_charge_id) ?? fail('الفاتورة غير موجودة.', 'P0002');
  if (!['due', 'paid', 'waived'].includes(a.p_status)) fail('حالة الفاتورة غير معروفة.', '22023');
  c.paid_at = a.p_status === 'paid' ? (c.status === 'paid' ? c.paid_at : new Date().toISOString()) : null;
  c.method = a.p_status === 'paid' ? a.p_method?.trim() || null : null;
  if (a.p_note != null) c.note = a.p_note.trim() || null;
  c.status = a.p_status;
  return chargeOut(c);
};

const saveExpense: RpcHandler = (a) => {
  build();
  if (!a.p_amount || a.p_amount <= 0) fail('اكتب مبلغاً أكبر من صفر.', '22023');
  const row = { month: monthStart(a.p_month), category: a.p_category, amount: Number(a.p_amount), note: a.p_note?.trim() || null, recurring: !!a.p_recurring };
  if (a.p_id) {
    const e = book.expenses.find((x) => x.id === a.p_id) ?? fail('التكلفة غير موجودة.', 'P0002');
    Object.assign(e, row);
    return { ...e };
  }
  const e = { id: id('e5a'), ...row, created_at: new Date().toISOString(), created_by: 'me' };
  book.expenses.push(e);
  return { ...e };
};

const deleteExpense: RpcHandler = (a) => {
  build();
  if (!book.expenses.some((e) => e.id === a.p_id)) fail('التكلفة غير موجودة.', 'P0002');
  book.expenses = book.expenses.filter((e) => e.id !== a.p_id);
  return { id: a.p_id };
};

const guarded = (name: string, h: RpcHandler): RpcHandler => async (args, ctx) => {
  if (listed('preview.hang', name)) await new Promise(() => undefined);
  if (listed('preview.fail', name)) throw new Error('Failed to fetch');
  if (listed('preview.missing', name)) throw Object.assign(new Error('preview: no function'), { code: 'PGRST202' });
  if (ctx.as !== 'platform') throw Object.assign(new Error('متاح لمدير المنصة فقط.'), { code: '42501' });
  return h(args, ctx);
};

registerRpc({
  platform_billing: guarded('platform_billing', billing),
  platform_analytics: guarded('platform_analytics', analytics),
  save_company_plan: guarded('save_company_plan', savePlan),
  platform_generate_charges: guarded('platform_generate_charges', (a) => { build(); return generate(a.p_until ?? cairoToday()); }),
  set_platform_charge_status: guarded('set_platform_charge_status', setStatus),
  save_platform_expense: guarded('save_platform_expense', saveExpense),
  delete_platform_expense: guarded('delete_platform_expense', deleteExpense),
});
