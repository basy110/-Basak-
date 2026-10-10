/**
 * «اليوم»: company_today and platform_today (supabase/migrations/20261116000001_admin_today.sql),
 * answered from the sample rows with the numbers the boards show (AdmToday, AdmPlatToday).
 * `?state=new` answers a company still being set up (AdmTodayNew); `?state=empty` a company /
 * platform with nothing yet; `?state=calm` a platform with nothing waiting; `?state=today-loading`
 * and `?state=today-error` hang or fail only these two answers (the frame around the page still loads).
 */
import { registerRpc } from '../registry';
import { COMPANY_ID, COMPANY2_ID, LINES, LINE_SUBSCRIBERS, RECEIPTS, SUPERVISORS, SUPERVISOR_LINES, TODAY, TOMORROW, UNIVERSITIES, tables } from '../data';

type Row = Record<string, any>;
const state = () => sessionStorage.getItem('preview.state') || '';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// Tomorrow per line, in the order of LINES: going, returning, busiest departure trip (time, riders).
const RIDES: [number, number, string | null, number][] = [
  [124, 118, '07:30', 44], [107, 105, '07:00', 38], [81, 75, '06:45', 31], [71, 68, '07:15', 47],
  [52, 49, '06:30', 27], [44, 40, '07:00', 24], [33, 31, '06:50', 18], [0, 0, null, 0],
];

const line = (l: Row, i: number) => {
  const [going, returning, time, riders] = RIDES[i];
  const top = time ? { id: l.line_trips[0].id, time, riders, label: l.line_trips[0].label } : null;
  const cap = l.bus_capacity as number;
  // The last line is the board's «لا يظهر للطلاب»: its university has no departure trip.
  const hidden = i === 7 ? 'unserved_university' : null;
  return {
    id: l.id, name: l.name, is_active: true, bus_capacity: cap, subscribers: LINE_SUBSCRIBERS[l.id], going, returning,
    top_trip: top, over: top && riders > cap ? [{ ...top, direction: 'departure' }] : [],
    supervisors: SUPERVISOR_LINES.filter((s) => s.line_id === l.id).map((s) => ({ id: s.supervisor_id, name: SUPERVISORS.find((x) => x.id === s.supervisor_id)!.full_name })),
    visible: hidden === null, hidden, unserved_university: hidden ? UNIVERSITIES[0].name : null,
  };
};

const vote = { vote_opens_at: '16:00', vote_closes_at: '06:00', vote_open: true };
const company = (id: string) => {
  const c = tables.companies.find((x) => x.id === id)!;
  return { id: c.id, name: c.name, status: c.status, created_at: c.created_at };
};
const blankSetup = { lines: 0, first_line: null, payment_methods: 0, supervisors: 0, on_sale: ['الفصل الدراسي الأول', 'الفصل الدراسي الثاني'], vote_custom: false, wallet_custom: false, receipt_info: false };
const blank = (id: string) => ({
  company: company(id), today: TODAY, ride_date: TOMORROW, ...vote, members: 0, subscribers: 0, confirmed: 0, going: 0, returning: 0,
  receipts: { waiting: 0, oldest_at: null, last_attempt: 0 }, password_requests: 0, lines: [], setup: blankSetup,
});

function companyToday(id: string) {
  if (state() === 'empty' || id !== COMPANY_ID) return blank(id);
  if (state() === 'new') {
    // AdmTodayNew: one line (الزرقا), nothing else yet.
    const l = LINES[1];
    return {
      ...blank(id),
      lines: [{ ...line(l, 1), subscribers: 0, going: 0, returning: 0, top_trip: null, over: [], supervisors: [], visible: true, hidden: null, unserved_university: null }],
      setup: { ...blankSetup, lines: 1, first_line: { id: l.id, name: l.name, stations: 8, departures: 5, returns: 5 } },
    };
  }
  const lines = LINES.map(line);
  return {
    company: company(id), today: TODAY, ride_date: TOMORROW, ...vote,
    members: 806, subscribers: lines.reduce((s, l) => s + l.subscribers, 0), confirmed: 512,
    going: lines.reduce((s, l) => s + l.going, 0), returning: lines.reduce((s, l) => s + l.returning, 0),
    receipts: { waiting: RECEIPTS.length, oldest_at: hoursAgo(3), last_attempt: RECEIPTS.filter((r) => r.attempt_number >= 5).length },
    password_requests: 2,
    lines,
    setup: {
      lines: LINES.length, first_line: { id: LINES[0].id, name: LINES[0].name, stations: 4, departures: 2, returns: 1 },
      payment_methods: 2, supervisors: 4, on_sale: ['الفصل الدراسي الأول', 'الفصل الدراسي الثاني'], vote_custom: true, wallet_custom: true, receipt_info: true,
    },
  };
}

// AdmPlatToday: the companies of the board (name, students, active, riders, receipts, oldest receipt in hours, lines on, lines, revenue).
const BOARD: [string, number, number, number, number, number, number, number, number][] = [
  ['المستقبل باص', 491, 324, 275, 14, 40, 1, 2, 1_298_695], ['الوفاء لنقل الطلاب', 379, 303, 227, 14, 30, 1, 2, 1_238_951],
  ['الرحاب ترانس', 258, 170, 163, 14, 50, 1, 2, 732_204], ['الأصدقاء للرحلات', 365, 307, 259, 13, 28, 1, 2, 1_458_540],
  ['المنارة ترانس', 70, 55, 49, 13, 26, 1, 2, 281_330], ['دمياط الجديدة للنقل الجماعي', 630, 479, 302, 10, 36, 1, 2, 1_954_260],
  ['البدر للرحلات', 318, 280, 216, 8, 6, 1, 2, 888_492], ['الريان باص', 335, 221, 224, 7, 5, 1, 2, 1_127_610],
  ['السلام ترافل', 140, 104, 74, 7, 4, 2, 2, 413_420], ['خطوط الدلتا', 619, 470, 365, 6, 3, 2, 2, 1_624_256],
  ['القمة للنقل', 553, 365, 376, 5, 2, 1, 2, 1_521_856], ['الصفوة للرحلات', 120, 80, 60, 0, 0, 1, 1, 210_000],
  ['النخبة للنقل الجماعي', 95, 70, 52, 0, 0, 1, 1, 180_000], ['المدينة للرحلات الجامعية', 60, 40, 0, 0, 0, 2, 2, 90_000],
  ['الياسمين باص', 0, 0, 0, 0, 0, 0, 0, 0],
];
const fakeId = (i: number) => `c0${String(i).padStart(6, '0')}-0000-4000-8000-000000000000`;
const row = (id: string, name: string, created: string, status: string, n: Partial<Row>) => ({
  company: { id, name, status, created_at: created, logo_path: null, emblem_path: null }, members: 0, active_subscriptions: 0, pending_receipts: 0,
  revenue: 0, riders_today: 0, next_ride_date: TOMORROW, riders_next: 0, vote_closes_at: '06:00', lines: 0, active_lines: 0, supervisors: 1, admins: 1,
  oldest_receipt_at: null, payment_methods: 1, selling: true, ...n,
});

function platformToday() {
  const empty = state() === 'empty';
  const calm = state() === 'calm';
  const ours = [
    row(COMPANY_ID, 'النورس للنقل', tables.companies[0].created_at, 'active', { members: 806, active_subscriptions: 718, riders_next: 512, pending_receipts: RECEIPTS.length, oldest_receipt_at: hoursAgo(3), lines: 8, active_lines: 7, revenue: 2_944_318, supervisors: 5 }),
    row(COMPANY2_ID, 'الدلتا للنقل الجامعي', tables.companies[1].created_at, 'active', { members: 212, active_subscriptions: 190, riders_next: 151, pending_receipts: 2, oldest_receipt_at: hoursAgo(2), lines: 3, active_lines: 3, revenue: 610_000 }),
  ];
  const board = BOARD.map(([name, members, subs, riders, receipts, oldest, on, all, revenue], i) => row(fakeId(i), name, hoursAgo(name === 'الياسمين باص' ? 6 * 24 : 300 * 24), 'active', {
    members, active_subscriptions: subs, riders_next: riders, pending_receipts: receipts, oldest_receipt_at: receipts ? hoursAgo(oldest) : null,
    lines: all, active_lines: on, revenue,
    payment_methods: calm ? 1 : ['الصفوة للرحلات', 'النخبة للنقل الجماعي', 'الياسمين باص'].includes(name) ? 0 : 1,
    selling: calm ? true : name !== 'المدينة للرحلات الجامعية',
  }));
  const stopped = [row(fakeId(90), 'الشروق ترافل', hoursAgo(400 * 24), 'suspended', { members: 40, lines: 1 }), row(fakeId(91), 'الأمل للنقل', hoursAgo(500 * 24), 'suspended', {})];
  const per = empty ? [] : [...ours, ...board.filter((r) => !calm || r.lines > 0), ...stopped];
  const sum = (k: string) => per.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return {
    today: TODAY,
    companies: { total: per.length, active: per.filter((r) => r.company.status === 'active').length, suspended: per.filter((r) => r.company.status === 'suspended').length, archived: 0 },
    universities: empty ? 0 : UNIVERSITIES.length,
    students: empty ? 0 : 11_121, active_subscriptions: sum('active_subscriptions'), pending_receipts: sum('pending_receipts'),
    receipt_companies: per.filter((r) => r.pending_receipts > 0).length,
    next_ride_date: TOMORROW, riders_next: sum('riders_next'), vote_closes_at: '06:00', revenue: sum('revenue'),
    corrections: { waiting: 3, oldest_at: hoursAgo(50), companies: ['النورس للنقل', 'الفيروز لنقل الطلاب'] },
    password_requests: { waiting: 2, without_company: 1 },
    push_failed_24h: empty || calm ? 0 : 14,
    app_versions: empty ? [] : tables.app_versions.map((v) => ({ platform: v.platform, latest_version: v.latest_version, min_version: v.min_version })),
    per_company: per,
  };
}

/** The page's own loading and error states, with the frame loaded. */
const own = <T,>(answer: () => T) => () => {
  if (state() === 'today-loading') return new Promise<T>(() => undefined);
  if (state() === 'today-error') throw new Error('Failed to fetch');
  return answer();
};

registerRpc({
  company_today: (args) => own(() => companyToday(args.p_company_id))(),
  platform_today: () => own(platformToday)(),
});
