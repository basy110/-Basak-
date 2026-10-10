/**
 * «التحليلات»: company_analytics (supabase/migrations/20261118000001_company_analytics.sql),
 * built from the sample lines, stations, trips and universities with steady
 * pseudo-random numbers (the same every reload) that scale with the period asked for.
 * `?state=empty` answers a company with nothing yet; sessionStorage `preview.fail` /
 * `preview.hang` = `company_analytics` fail or hang only this answer, and
 * `preview.missing` = `company_analytics` answers as a database without the function.
 */
import { registerRpc, type RpcHandler } from '../registry';
import { COMPANY_ID, LINES, LINE_SUBSCRIBERS, UNIVERSITIES, tables } from '../data';
import { addDays, cairoToday } from '../../src/lib/time';

type Row = Record<string, any>;
const state = () => sessionStorage.getItem('preview.state') || '';
const listed = (key: string, name: string) => (sessionStorage.getItem(key) ?? '').split(',').includes(name);

/** A steady number in [0, 1) for a seed (mulberry32). */
const rand = (seed: number) => {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

const COLLEGES: [string | null, number][] = [
  ['الهندسة', 168], ['التجارة', 131], ['الحاسبات والمعلومات', 117], ['الطب', 84], ['الصيدلة', 66], ['العلوم', 52], ['التربية', 47],
  ['الآداب', 38], ['طب الأسنان', 29], ['الحقوق', 22], ['التمريض', 17], [null, 49],
];
const SPECS: [string | null, number][] = [
  ['علوم الحاسب', 74], ['مدني', 61], ['محاسبة', 58], ['كهرباء', 44], ['ميكانيكا', 39], ['إدارة أعمال', 33], ['نظم معلومات', 27], ['كيمياء', 19], [null, 365],
];
const REASONS: [string, number][] = [
  ['الصورة غير واضحة', 23], ['المبلغ أقل من سعر الاشتراك', 17], ['التحويل لحساب آخر', 9], ['الإيصال مكرر', 6], ['لا يظهر رقم العملية', 5], ['التاريخ قديم', 4],
];

function empty(from: string | null, to: string) {
  return {
    period: { from, to, ride_days: 0 },
    students: { members: 0, subscribers: 0, new_members: 0, never_subscribed: 0, ending_soon: 0, by_university: [], by_college: [], by_specialisation: [], by_station: [], line_university: [], unserved_universities: [] },
    rides: { confirm_rate: null, avg_confirmed: 0, avg_boarded: 0, avg_subscribers: 0 },
    trips: [], lines: [], time_slots: [], weekdays: [], daily: [],
    money: { revenue: 0, paying: 0, avg_per_student: 0, unpaid_count: 0, unpaid_amount: 0, by_month: [], by_option: [] },
    receipts: { approved: 0, rejected: 0, pending: 0, median_review_hours: null, reasons: [], by_method: [] },
    insights: [],
  };
}

const companyAnalytics: RpcHandler = (args) => {
  const today = cairoToday();
  const from: string | null = args.p_from ?? null;
  const to: string = args.p_to && args.p_to < today ? args.p_to : today;
  if (state() === 'empty') return empty(from, to);

  // Ride days: Sunday to Thursday since the term began (20 September), within the period.
  const start = from && from > '2026-09-20' ? from : '2026-09-20';
  const days: string[] = [];
  for (let d = start; d <= to; d = addDays(d, 1)) if (dow(d) <= 4) days.push(d);
  const nd = days.length;
  const span = Math.max(1, nd / 15);
  const lines = LINES.filter((l) => l.company_id === COMPANY_ID && l.is_active);

  // Who the students are.
  const members = 820;
  const subscribers = lines.reduce((t, l) => t + LINE_SUBSCRIBERS[l.id], 0);
  const uniShare = [0.46, 0.27, 0.15, 0.07, 0.05];
  const by_university = UNIVERSITIES.slice(0, 5).map((u, i) => ({ id: u.id, name: u.name, count: Math.round(members * uniShare[i]), subscribers: Math.round(subscribers * uniShare[i] * (i === 3 ? 0.1 : 1)) }));

  // Where they board: each line's subscribers over its stations (not the gate at the university).
  const by_station = lines.flatMap((l, li) => {
    const st = l.stations.filter((s: Row) => s.name !== 'بوابة الجامعة');
    const weights = st.map((_: Row, si: number) => (li === 2 && si === 0 ? 3.2 : 1 + rand(li * 10 + si)));
    const sum = weights.reduce((a: number, b: number) => a + b, 0);
    return st.map((s: Row, si: number) => ({ line_id: l.id, line_name: l.name, station_id: s.id, station_name: s.name, order_index: s.order_index, count: Math.round((LINE_SUBSCRIBERS[l.id] * weights[si]) / sum) }));
  });
  const line_university = lines.flatMap((l, li) => [
    { line_id: l.id, line_name: l.name, university_id: UNIVERSITIES[0].id, university_name: UNIVERSITIES[0].name, count: Math.round(LINE_SUBSCRIBERS[l.id] * 0.55) },
    { line_id: l.id, line_name: l.name, university_id: UNIVERSITIES[1].id, university_name: UNIVERSITIES[1].name, count: Math.round(LINE_SUBSCRIBERS[l.id] * (li % 2 ? 0.3 : 0.25)) },
    { line_id: l.id, line_name: l.name, university_id: UNIVERSITIES[2].id, university_name: UNIVERSITIES[2].name, count: Math.round(LINE_SUBSCRIBERS[l.id] * (li % 2 ? 0.15 : 0.2)) },
  ]);

  // Trips: the busiest line's first departure fills over its seats; the smallest line's second one runs nearly empty.
  const confirm = (li: number) => (li === 3 ? 0.49 : 0.72 + rand(li) * 0.08);
  // How full each line's first departure runs (the first line's overflows on busy days).
  const UTIL = [0.97, 0.83, 0.71, 0.86, 0.64, 0.76, 0.58];
  const trips = lines.flatMap((l, li) => l.line_trips.map((t: Row, ti: number) => {
    const cap = l.bus_capacity as number;
    const util = (UTIL[li] ?? 0.7) * (t.direction === 'return' ? 0.9 : ti === 0 ? 1 : li === 6 ? 0.22 : 0.62);
    const avg = round1(cap * util);
    const peak = li === 0 && ti === 0 ? Math.round(cap * 1.14) : Math.min(cap, Math.round(avg * (1.08 + rand(li * 7 + ti) * 0.08)));
    const over = li === 0 && ti === 0 ? Math.round(nd * 0.4) : 0;
    return {
      trip_id: t.id, line_id: l.id, line_name: l.name, direction: t.direction, start_time: t.start_time.slice(0, 5), label: t.label || null, is_active: true,
      subscribers: Math.round(LINE_SUBSCRIBERS[l.id] * (t.direction === 'return' ? 0.92 : ti === 0 ? 0.62 : 0.38)), capacity: cap,
      avg_riders: nd ? avg : 0, peak_riders: nd ? peak : 0, days_over: nd ? over : 0,
      avg_boarded: nd ? round1(avg * 0.9) : 0, no_show: nd && t.direction === 'departure' && li !== 2 ? round1(6 + rand(li * 3 + ti) * 9) / 100 : null,
      ride_days: nd, active_days: nd,
    };
  }));
  const lineRates = lines.map((l, li) => ({ line_id: l.id, line_name: l.name, confirm_rate: nd ? Math.round(confirm(li) * 1000) / 1000 : null, ride_days: nd, avg_subscribers: LINE_SUBSCRIBERS[l.id] }));
  const rate = 0.72;

  const slotWeights: [string, number][] = [['06:30', 0.09], ['06:45', 0.17], ['07:00', 0.24], ['07:15', 0.21], ['07:30', 0.15], ['07:45', 0.08], ['08:00', 0.04], ['08:15', 0.02]];
  const daily = days.slice(-60).map((d, i) => {
    const s = Math.round(subscribers - 30 + Math.min(30, i));
    const c = Math.round(s * ([0.78, 0.74, 0.72, 0.69, 0.6][dow(d)] ?? 0.7) * (0.94 + rand(i + 99) * 0.1));
    return { date: d, confirmed: c, boarded: Math.round(c * (0.88 + rand(i + 7) * 0.06)), subscribers: s };
  });

  // Money: termly payments mostly in the term's first weeks.
  const months: string[] = [];
  for (let m = (from ?? '2026-08-01').slice(0, 7); m <= to.slice(0, 7);) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const monthWeight: Record<string, number> = { '2026-08': 0.12, '2026-09': 0.58, '2026-10': 0.22, '2026-11': 0.05, '2026-12': 0.03 };
  const paidTotal = Math.round(subscribers * (from ? Math.min(1, span / 6) : 1));
  const by_month = months.map((m) => {
    const count = Math.round(paidTotal * (monthWeight[m] ?? 0.02) * (from && from.slice(0, 7) === m ? 0.6 : 1));
    return { month: m, amount: count * 3620, count };
  }).filter((x) => x.count > 0);
  const paid = by_month.reduce((t, x) => t + x.count, 0);
  const revenue = by_month.reduce((t, x) => t + x.amount, 0);
  const by_option = paid ? [
    { option: 'first', amount: Math.round(paid * 0.71) * 3500, count: Math.round(paid * 0.71) },
    { option: 'both', amount: Math.round(paid * 0.24) * 6500, count: Math.round(paid * 0.24) },
    { option: 'daily', amount: Math.round(paid * 0.05) * 50 * 6, count: Math.round(paid * 0.05) * 6 },
  ] : [];

  const methods = (tables.company_payment_methods ?? []).filter((m) => m.company_id === COMPANY_ID);
  const approved = Math.round(paid * 0.95);
  const by_method = methods.slice(0, 2).map((m, i) => ({ method_id: m.id, name: m.display_name, approved: Math.round(approved * (i ? 0.38 : 0.62)), rejected: Math.round(approved * (i ? 0.16 : 0.05)) }));
  const rejected = by_method.reduce((t, m) => t + m.rejected, 0);
  const scale = rejected / REASONS.reduce((t, r) => t + r[1], 0);
  const reasons = rejected ? REASONS.map(([reason, n]) => ({ reason, count: Math.max(1, Math.round(n * scale)) })) : [];

  const insights: Row[] = [];
  trips.filter((t) => t.days_over >= 2).sort((a, b) => b.days_over - a.days_over).slice(0, 3).forEach((t) => insights.push({ key: 'over_capacity', severity: 'act', data: { ...t } }));
  insights.push({ key: 'unserved_university', severity: 'act', data: { university_id: UNIVERSITIES[3].id, university_name: UNIVERSITIES[3].name, members: by_university[3].count } });
  insights.push({ key: 'ending_soon', severity: 'act', data: { count: 17, days: 14 } });
  lineRates.filter((l) => l.confirm_rate != null && nd >= 3 && l.confirm_rate <= rate - 0.15).forEach((l) => insights.push({ key: 'low_confirmation_line', severity: 'watch', data: { ...l, rate: l.confirm_rate, company_rate: rate } }));
  trips.filter((t) => nd >= 3 && t.avg_riders > 0 && t.avg_riders < 0.4 * t.capacity).slice(0, 2).forEach((t) => insights.push({ key: 'low_utilisation', severity: 'watch', data: { ...t, pct: Math.round((100 * t.avg_riders) / t.capacity) } }));
  by_method.forEach((m) => {
    const total = m.approved + m.rejected;
    if (total >= 8 && m.rejected / total >= 0.25) insights.push({ key: 'method_rejections', severity: 'watch', data: { ...m, total, pct: Math.round((100 * m.rejected) / total) } });
  });
  const crowded = by_station.find((s) => s.line_id === lines[2].id && s.order_index === 0);
  if (crowded) insights.push({ key: 'station_concentration', severity: 'watch', data: { ...crowded, line_total: LINE_SUBSCRIBERS[lines[2].id], pct: Math.round((100 * crowded.count) / LINE_SUBSCRIBERS[lines[2].id]) } });
  insights.push({ key: 'never_subscribed', severity: 'watch', data: { count: members - subscribers - 61, members } });

  return {
    period: { from, to, ride_days: nd },
    students: {
      members, subscribers, new_members: from ? Math.round(14 * span) : members, never_subscribed: members - subscribers - 61, ending_soon: 17,
      by_university, by_college: COLLEGES.map(([name, count]) => ({ name, count })), by_specialisation: SPECS.map(([name, count]) => ({ name, count })),
      by_station: by_station.sort((a, b) => b.count - a.count), line_university, unserved_universities: [{ id: UNIVERSITIES[3].id, name: UNIVERSITIES[3].name, members: by_university[3].count }],
    },
    rides: nd ? { confirm_rate: rate, avg_confirmed: round1(subscribers * rate), avg_boarded: round1(subscribers * rate * 0.9), avg_subscribers: subscribers } : { confirm_rate: null, avg_confirmed: 0, avg_boarded: 0, avg_subscribers: 0 },
    trips: trips.sort((a, b) => a.line_name.localeCompare(b.line_name, 'ar') || a.direction.localeCompare(b.direction) || a.start_time.localeCompare(b.start_time)),
    lines: lineRates,
    time_slots: nd ? slotWeights.map(([slot, w]) => ({ slot, riders: round1(subscribers * rate * w) })) : [],
    weekdays: nd ? [0, 1, 2, 3, 4].map((d) => ({ dow: d, days: days.filter((x) => dow(x) === d).length, confirm_rate: [0.78, 0.74, 0.72, 0.69, 0.6][d] })) : [],
    daily,
    money: { revenue, paying: paid, avg_per_student: paid ? Math.round(revenue / paid) : 0, unpaid_count: 23, unpaid_amount: 23 * 3500, by_month, by_option },
    receipts: { approved, rejected, pending: tables.receipts?.length ?? 0, median_review_hours: approved ? 7.5 : null, reasons, by_method },
    insights,
  };
};

registerRpc({
  company_analytics: async (args, ctx) => {
    if (listed('preview.hang', 'company_analytics')) await new Promise(() => undefined);
    if (listed('preview.fail', 'company_analytics')) throw new Error('Failed to fetch');
    if (listed('preview.missing', 'company_analytics')) throw Object.assign(new Error('preview: no function'), { code: 'PGRST202' });
    return companyAnalytics(args, ctx);
  },
});
