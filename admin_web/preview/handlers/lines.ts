/** The lines pages and «تأكيد الركوب»: admin_lines_overview, save_line_full (and the older three), vote settings. */
import { registerRpc, rpcs, type RpcHandler } from '../registry';
import { COMPANY_ID, LINE_SUBSCRIBERS, TOMORROW, tables } from '../data';

type Row = Record<string, any>;
const uuid = () => crypto.randomUUID();
const fail = (message: string, code = 'P0001') => Object.assign(new Error(message), { code });
const lines = () => tables.lines;
const subsOf = (id: string) => (LINE_SUBSCRIBERS as Record<string, number>)[id] ?? 0;

/** Split n over weights, whole numbers that add up to n. */
function split(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.floor((n * w) / total));
  let left = n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length, left -= 1) out[i] += 1;
  return out;
}
const TRIP_WEIGHTS = [0.22, 0.29, 0.35, 0.11, 0.04, 0.03];

function lineStats(line: Row) {
  const subs = subsOf(line.id);
  const live = line.is_active ? 1 : 0.75;
  const going = Math.round(subs * 0.74 * live);
  const back = Math.round(subs * 0.7 * live);
  const dep = line.line_trips.filter((t: Row) => t.direction === 'departure' && t.is_active).sort((a: Row, b: Row) => a.start_time.localeCompare(b.start_time));
  const ret = line.line_trips.filter((t: Row) => t.direction === 'return' && t.is_active).sort((a: Row, b: Row) => a.start_time.localeCompare(b.start_time));
  const trip_riders: Record<string, number> = {};
  split(going, dep.map((_: Row, i: number) => TRIP_WEIGHTS[i] ?? 0.05)).forEach((n, i) => { if (dep[i]) trip_riders[dep[i].id] = n; });
  split(back, ret.map((_: Row, i: number) => [0.2, 0.32, 0.3, 0.13, 0.05][i] ?? 0.05)).forEach((n, i) => { if (ret[i]) trip_riders[ret[i].id] = n; });
  const stations = line.stations.filter((s: Row) => s.is_active);
  const station_subscribers: Record<string, number> = {};
  split(subs, stations.map((_: Row, i: number) => [31, 22, 9, 14, 12, 18, 0, 18][i % 8])).forEach((n, i) => { if (n) station_subscribers[stations[i].id] = n; });
  const trip_subscribers: Record<string, number> = {};
  split(subs, dep.map((_: Row, i: number) => TRIP_WEIGHTS[i] ?? 0.05)).forEach((n, i) => { if (n && dep[i]) trip_subscribers[dep[i].id] = n; });
  split(subs, ret.map(() => 1)).forEach((n, i) => { if (n && ret[i]) trip_subscribers[ret[i].id] = n; });
  return {
    bus_capacity: line.bus_capacity ?? null, subscribers: subs, riders_departure: going, riders_return: back,
    trip_riders, station_subscribers, trip_subscribers, has_history: subs > 0,
  };
}

/** What save_line(_full) would write, as the row the lines lookup reads. */
function saveLine(p: Row, full: boolean): string {
  if (!(p.university_ids ?? []).length) throw fail('اختر جامعة واحدة على الأقل يخدمها الخط.', '23514');
  if (!(p.stations ?? []).length) throw fail('أضف محطة واحدة على الأقل بين البداية والوجهة.', '23514');
  if (full) {
    for (const x of p.prices ?? []) {
      if (x.is_enabled && !(Number(x.price) > 0)) throw fail('اكتب سعر الاشتراك أو أوقف بيعه على هذا الخط.', '23514');
    }
  }
  if ((window as any).__previewSaveFails) throw fail('تعذّر الوصول إلى باصك. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.');
  const existing = p.id ? lines().find((l) => l.id === p.id) : null;
  const id = existing?.id ?? uuid();
  const oldStations: Row[] = existing?.stations ?? [];
  const stations = (p.stations as Row[]).map((s, i) => ({ id: s.id && oldStations.some((o) => o.id === s.id) ? s.id : uuid(), name: s.name, order_index: i + 1, is_active: true }));
  const retired = oldStations.filter((o) => !stations.some((s) => s.id === o.id)).map((o) => ({ ...o, is_active: false, order_index: 10000 + o.order_index }));
  const oldTrips: Row[] = existing?.line_trips ?? [];
  const trips = (p.trips as Row[]).map((t) => ({
    id: t.id && oldTrips.some((o) => o.id === t.id) ? t.id : uuid(), direction: t.direction, label: t.label ?? '',
    start_time: `${t.start_time}:00`.slice(0, 8), arrival_time: t.arrival_time ? `${t.arrival_time}:00`.slice(0, 8) : null,
    university_id: t.university_id ?? null, is_active: t.is_active !== false,
    line_trip_stops: (t.stops ?? []).map((s: Row) => ({ station_id: stations[s.station_index].id, stop_time: `${s.time}:00`.slice(0, 8) })),
  }));
  const gone = oldTrips.filter((o) => !trips.some((t) => t.id === o.id)).map((o) => ({ ...o, is_active: false }));
  const prevPrices: Row[] = existing?.line_period_prices ?? [];
  const row: Row = {
    ...(existing ?? { created_at: new Date().toISOString(), company_id: COMPANY_ID, bus_capacity: null }),
    id, name: (p.name || p.stations[0].name).trim(), origin_name: p.stations[0].name, destination_university_id: p.university_ids[0],
    price_termly: p.price_termly, price_yearly: p.price_yearly, price_daily: p.price_daily, is_active: p.is_active !== false,
    stations: [...stations, ...retired], line_trips: [...trips, ...gone],
    line_universities: (p.university_ids as string[]).map((u) => ({ university_id: u })),
    line_period_prices: full && p.prices
      ? (p.prices as Row[]).map((x) => ({ option: x.option, price: x.price ?? 0, is_enabled: x.is_enabled }))
      : prevPrices,
  };
  if (full && 'bus_capacity' in p) row.bus_capacity = p.bus_capacity;
  if (existing) Object.assign(existing, row); else lines().push(row);
  return id;
}

const company = () => tables.companies.find((c) => c.id === COMPANY_ID)!;
const platformVote = () => {
  const s = tables.app_settings[0];
  return { opens_at: s.vote_opens_at.slice(0, 5), closes_at: s.vote_closes_at.slice(0, 5), reminder_minutes: s.vote_reminder_minutes, off_weekdays: s.vote_reminder_off_weekdays ?? [], off_dates: s.vote_reminder_off_dates ?? [] };
};
function voteSettings(companyId: string | null) {
  const platform = platformVote();
  const c = companyId ? tables.companies.find((x) => x.id === companyId) : null;
  const custom = !!c?.vote_opens_at;
  const own = custom ? { opens_at: c!.vote_opens_at.slice(0, 5), closes_at: c!.vote_closes_at.slice(0, 5), reminder_minutes: c!.vote_reminder_minutes, off_weekdays: c!.vote_reminder_off_weekdays ?? [], off_dates: c!.vote_reminder_off_dates ?? [] } : platform;
  return { company_id: companyId, ...own, window_text: '', custom, platform, can_edit_platform: true };
}

const handlers: Record<string, RpcHandler> = {
  admin_lines_overview: ({ p_company_id }) => ({
    ride_date: TOMORROW, vote_opens: null, vote_closes: null, vote_open: true,
    lines: Object.fromEntries(lines().filter((l) => l.company_id === p_company_id).map((l) => [l.id, lineStats(l)])),
  }),
  save_line_full: ({ p_line }) => saveLine(p_line, true),
  save_line: ({ p_line }) => saveLine(p_line, false),
  set_line_bus_capacity: ({ p_line_id, p_capacity }) => { const l = lines().find((x) => x.id === p_line_id); if (l) l.bus_capacity = p_capacity; return p_capacity; },
  set_line_active: ({ p_line_id, p_active }) => { const l = lines().find((x) => x.id === p_line_id); if (!l) throw fail('الخط غير موجود.'); l.is_active = p_active; return null; },
  delete_line: ({ p_line_id }) => {
    if (subsOf(p_line_id) > 0) throw fail('لا يمكن حذف خط له اشتراكات أو سجلات سابقة. عطّل الخط بدلاً من حذفه للحفاظ على السجلات.', '23503');
    const i = lines().findIndex((x) => x.id === p_line_id);
    if (i >= 0) lines().splice(i, 1);
    tables.supervisor_lines = tables.supervisor_lines.filter((r) => r.line_id !== p_line_id);
    return null;
  },
  get_vote_settings: ({ p_company_id }) => voteSettings(p_company_id ?? null),
  set_vote_settings: ({ p_company_id, p_opens_at, p_closes_at, p_reminder_minutes, p_off_weekdays, p_off_dates }) => {
    if ((window as any).__previewSaveFails) throw fail('Failed to fetch');
    const target: Row = p_company_id ? tables.companies.find((c) => c.id === p_company_id)! : tables.app_settings[0];
    if (p_company_id && p_opens_at == null && p_closes_at == null && p_reminder_minutes == null) {
      Object.assign(target, { vote_opens_at: null, vote_closes_at: null, vote_reminder_minutes: null, vote_reminder_off_weekdays: null, vote_reminder_off_dates: null });
    } else {
      if (p_opens_at === p_closes_at) throw fail('يجب أن يختلف موعد قفل التصويت عن موعد فتحه.');
      Object.assign(target, { vote_opens_at: `${p_opens_at}:00`, vote_closes_at: `${p_closes_at}:00`, vote_reminder_minutes: p_reminder_minutes, vote_reminder_off_weekdays: p_off_weekdays ?? [], vote_reminder_off_dates: p_off_dates ?? [] });
    }
    return voteSettings(p_company_id ?? null);
  },
};
// Answered by the subscription pages' own handlers when they register them.
const shared: Record<string, RpcHandler> = {
  get_subscription_switches: () => ({ annual_effective: !!company().annual_subscription_enabled, daily_effective: !!company().daily_subscription_enabled }),
  get_subscription_settings: () => ({
    sale_periods: ['first', 'second', 'both', 'summer'].map((option) => ({
      option, label: '', phase: 'current', available: option !== 'summer', reason: option === 'summer' ? 'company_not_selling' : null, start_date: '', end_date: '',
    })),
  }),
};

registerRpc(handlers);
queueMicrotask(() => { Object.entries(shared).forEach(([name, h]) => { if (!rpcs[name]) registerRpc({ [name]: h }); }); });
