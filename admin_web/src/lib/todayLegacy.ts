/**
 * «اليوم» from the older functions, for a database that does not have
 * company_today / platform_today yet (lib/today.ts). A chunk of its own: only a
 * dashboard that meets such a database downloads it.
 */
import { supabase } from './supabase';
import { keys, one, queryClient, unwrap } from './query';
import type { CompanyNumbers, PlatformNumbers } from './overview';
import type { CompanyToday, TodayLine, TripCount } from './today';
import type { PlatformToday } from './platformToday';

interface LegacyLine {
  id: string; name: string; is_active: boolean; bus_capacity?: number | null; created_at: string;
  stations?: { id: string; is_active: boolean }[] | null;
  line_trips?: { id: string; direction: string; is_active: boolean; start_time: string | null }[] | null;
}
/** One station of one departure trip, as get_lines_rider_counts answers. */
export interface StationCount { schedule_id: string | null; departure_time: string | null; riding_count: number; returning_count: number }

/** A line's riders from its per-station counts: totals, the busiest departure trip, trips over the bus. */
export function lineCounts(rows: StationCount[], capacity: number | null | undefined) {
  const trips = new Map<string, TripCount>();
  let going = 0; let returning = 0;
  for (const r of rows) {
    going += Number(r.riding_count) || 0;
    returning += Number(r.returning_count) || 0;
    if (!r.schedule_id) continue;
    const t = trips.get(r.schedule_id) ?? { id: r.schedule_id, time: null, riders: 0, direction: 'departure' as const };
    t.riders += Number(r.riding_count) || 0;
    const at = r.departure_time ? r.departure_time.slice(0, 5) : null;
    if (at && (!t.time || at < t.time)) t.time = at;
    trips.set(r.schedule_id, t);
  }
  const list = [...trips.values()].filter((t) => t.riders > 0);
  const top = list.sort((a, b) => b.riders - a.riders || String(a.time).localeCompare(String(b.time)))[0] ?? null;
  const over = capacity ? list.filter((t) => t.riders > capacity) : [];
  return { going, returning, top_trip: top, over };
}

type Sup = { id: string; full_name: string; is_active: boolean };
export async function legacyCompanyToday(companyId: string): Promise<CompanyToday> {
  const overview = await queryClient.fetchQuery({
    queryKey: keys.company(companyId, 'overview'),
    queryFn: () => unwrap<CompanyNumbers>(supabase.rpc('company_overview', { p_company_id: companyId })),
    staleTime: 30_000,
  });
  const [lines, assigned, methods] = await Promise.all([
    unwrap<LegacyLine[]>(supabase.from('lines').select('id, name, is_active, bus_capacity, created_at, stations(id, is_active), line_trips(id, direction, is_active, start_time)')
      .eq('company_id', companyId).order('created_at')),
    unwrap<{ line_id: string; supervisors: Sup | Sup[] | null }[]>(
      supabase.from('supervisor_lines').select('line_id, supervisors(id, full_name, is_active)').eq('company_id', companyId)),
    supabase.from('company_payment_methods').select('id', { head: true, count: 'exact' }).eq('company_id', companyId).eq('is_active', true),
  ]);
  const ids = lines.filter((l) => l.is_active).map((l) => l.id);
  const counts = ids.length
    ? await unwrap<Record<string, StationCount[]>>(supabase.rpc('get_lines_rider_counts', { p_line_ids: ids, p_ride_date: overview.next_ride_date }))
    : {};
  const subscribers = Object.fromEntries(overview.top_lines.map((l) => [l.id, l.subscribers]));
  const out: TodayLine[] = lines.map((l) => {
    const c = lineCounts(counts[l.id] ?? [], l.bus_capacity);
    return {
      id: l.id, name: l.name, is_active: l.is_active, bus_capacity: l.bus_capacity ?? null, subscribers: subscribers[l.id] ?? 0, ...c,
      supervisors: assigned.flatMap((a) => { const s = one(a.supervisors); return a.line_id === l.id && s?.is_active ? [{ id: s.id, name: s.full_name }] : []; }),
      visible: l.is_active ? null : false, hidden: l.is_active ? null : 'line_inactive' as const, unserved_university: null,
    };
  }).sort((a, b) => b.going - a.going || b.subscribers - a.subscribers || a.name.localeCompare(b.name, 'ar'));
  const first = lines[0];
  const today = overview.riders_week[overview.riders_week.length - 1]?.date ?? overview.next_ride_date;
  return {
    company: overview.company, today, ride_date: overview.next_ride_date,
    vote_opens_at: null, vote_closes_at: overview.vote_closes_at ?? null, vote_open: null,
    members: overview.members, subscribers: overview.active_subscriptions, confirmed: overview.riders_next,
    going: out.reduce((s, l) => s + l.going, 0), returning: out.reduce((s, l) => s + l.returning, 0),
    receipts: { waiting: overview.pending_receipts, oldest_at: null, last_attempt: null },
    password_requests: 0,
    lines: out,
    setup: {
      lines: lines.length,
      first_line: first ? {
        id: first.id, name: first.name, stations: (first.stations ?? []).filter((s) => s.is_active).length,
        departures: (first.line_trips ?? []).filter((t) => t.is_active && t.direction === 'departure').length,
        returns: (first.line_trips ?? []).filter((t) => t.is_active && t.direction === 'return').length,
      } : null,
      payment_methods: methods.count ?? 0, supervisors: overview.supervisors, on_sale: null,
      vote_custom: null, wallet_custom: null, receipt_info: null,
    },
  };
}

export async function legacyPlatformToday(): Promise<PlatformToday> {
  const [overview, corrections, versions, methods] = await Promise.all([
    queryClient.fetchQuery({ queryKey: keys.platform('overview'), queryFn: () => unwrap<PlatformNumbers>(supabase.rpc('platform_overview')), staleTime: 30_000 }),
    unwrap<{ created_at: string; companies: { name: string } | { name: string }[] | null }[]>(supabase.from('student_correction_requests').select('created_at, companies(name)').eq('status', 'pending')),
    unwrap<PlatformToday['app_versions']>(supabase.from('app_versions').select('platform, latest_version, min_version').order('platform')),
    unwrap<{ company_id: string }[]>(supabase.from('company_payment_methods').select('company_id').eq('is_active', true)),
  ]);
  const paying = new Set(methods.map((m) => m.company_id));
  const rows = overview.per_company.map((r) => ({ ...r, oldest_receipt_at: null, payment_methods: paying.has(r.company.id) ? 1 : 0, selling: null }));
  return {
    today: overview.riders_week[overview.riders_week.length - 1]?.date ?? overview.next_ride_date,
    companies: overview.companies, universities: null, students: overview.students,
    active_subscriptions: overview.active_subscriptions, pending_receipts: overview.pending_receipts,
    receipt_companies: rows.filter((r) => r.pending_receipts > 0).length,
    next_ride_date: overview.next_ride_date, riders_next: overview.riders_next, vote_closes_at: overview.vote_closes_at ?? null, revenue: overview.revenue,
    corrections: {
      waiting: corrections.length,
      oldest_at: corrections.map((c) => c.created_at).sort()[0] ?? null,
      companies: [...new Set(corrections.map((c) => one(c.companies)?.name).filter((n): n is string => !!n))],
    },
    password_requests: { waiting: 0, without_company: 0 },
    push_failed_24h: 0,
    app_versions: versions,
    per_company: rows,
  };
}

