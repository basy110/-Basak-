/**
 * «التحليلات» (/c/:companyId/analytics): the company's numbers over a period in
 * one request (company_analytics, migration 20261118000001), and the small pure
 * helpers the page and its export share. Recommendations' wording is in
 * analyticsInsights.ts.
 */
import { supabase } from './supabase';
import { keys, STALE, usePageData } from './query';
import { rpcOr } from './rpc';
import { addDays, cairoToday } from './time';

// ─────────────────────────────────────────────────────────── the answer ────

export type Direction = 'departure' | 'return';
export type Severity = 'act' | 'watch' | 'good';
export type InsightKey =
  | 'over_capacity' | 'low_utilisation' | 'empty_trip' | 'unserved_university' | 'station_concentration'
  | 'never_subscribed' | 'ending_soon' | 'low_confirmation_line' | 'method_rejections' | 'slow_review'
  | 'no_capacity' | 'high_confirmation' | 'fast_review';

/** One recommendation: which rule fired and the numbers (and ids) it fired on. */
export interface Insight { key: InsightKey | string; severity: Severity; data: Record<string, any> }

export interface Named { name: string | null; count: number }
export interface UniversityCount { id: string | null; name: string | null; count: number; subscribers?: number }
export interface StationCount { line_id: string; line_name: string; station_id: string; station_name: string; order_index: number; count: number }
export interface LineUniversity { line_id: string; line_name: string; university_id: string | null; university_name: string | null; count: number }

export interface TripStat {
  trip_id: string; line_id: string; line_name: string; direction: Direction; start_time: string | null; label: string | null;
  is_active?: boolean; subscribers: number; capacity: number | null; avg_riders: number; peak_riders: number; days_over: number;
  avg_boarded: number;
  /** Share of confirmed riders not checked in, on the days the trip was scanned; null when it never was. */
  no_show?: number | null;
  ride_days: number; active_days?: number;
}
export interface LineRate { line_id: string; line_name: string; confirm_rate: number | null; ride_days: number; avg_subscribers: number }

export interface CompanyAnalytics {
  period: { from: string | null; to: string; ride_days: number };
  students: {
    members: number; subscribers: number; new_members: number; never_subscribed: number; ending_soon: number;
    by_university: UniversityCount[]; by_college: Named[]; by_specialisation: Named[];
    by_station: StationCount[]; line_university: LineUniversity[];
    unserved_universities: { id: string; name: string; members: number }[];
  };
  rides?: { confirm_rate: number | null; avg_confirmed: number; avg_boarded: number; avg_subscribers: number };
  trips: TripStat[];
  lines?: LineRate[];
  time_slots: { slot: string; riders: number }[];
  weekdays: { dow: number; days?: number; confirm_rate: number | null }[];
  daily: { date: string; confirmed: number; boarded: number; subscribers: number }[];
  money: {
    revenue: number; paying: number; avg_per_student: number; unpaid_count: number; unpaid_amount: number;
    by_month: { month: string; amount: number; count: number }[];
    by_option: { option: string; amount: number; count: number }[];
  };
  receipts: {
    approved: number; rejected: number; pending?: number; median_review_hours: number | null;
    reasons: { reason: string; count: number }[];
    by_method: { method_id: string | null; name: string | null; approved: number; rejected: number }[];
  };
  insights: Insight[];
}

// ───────────────────────────────────────────────────────────── periods ────

export type PeriodKey = '30d' | 'month' | 'term' | 'all';
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: '30d', label: 'آخر 30 يوماً' },
  { value: 'month', label: 'هذا الشهر' },
  // The term's own dates live on the subscription-periods page; four months cover a term.
  { value: 'term', label: 'آخر 4 أشهر' },
  { value: 'all', label: 'كل الوقت' },
];
export const DEFAULT_PERIOD: PeriodKey = '30d';
export const periodLabel = (key: PeriodKey) => PERIODS.find((p) => p.value === key)?.label ?? '';

/** Cairo calendar days a preset asks for (`to` null = up to today; `from` null = from the beginning). */
export function periodRange(key: PeriodKey, today: string = cairoToday()): { from: string | null; to: string | null } {
  if (key === '30d') return { from: addDays(today, -29), to: null };
  if (key === 'month') return { from: `${today.slice(0, 8)}01`, to: null };
  if (key === 'term') return { from: addDays(today, -119), to: null };
  return { from: null, to: null };
}

/**
 * The page's numbers. Read once and kept for a few minutes (they move slowly);
 * a database without the function yet answers `null` and the page says so.
 */
export function useCompanyAnalytics(companyId: string, period: PeriodKey) {
  const { from, to } = periodRange(period);
  return usePageData<CompanyAnalytics | null>(
    keys.company(companyId, 'analytics', from ?? 'all', to ?? 'all'),
    () => rpcOr<CompanyAnalytics | null>('company_analytics',
      () => supabase.rpc('company_analytics', { p_company_id: companyId, p_from: from, p_to: to }),
      async () => null),
    { staleTime: STALE.reference, keepPrevious: true },
  );
}

// ───────────────────────────────────────────────────────────── helpers ────

export const DIRECTION_LABEL: Record<Direction, string> = { departure: 'الذهاب', return: 'العودة' };
export const WEEKDAY_LABEL = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTH_SHORT = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** `2026-09` → «سبتمبر» (with the year when asked). */
export const monthLabel = (month: string, withYear = false) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_SHORT[(m || 1) - 1]}${withYear ? ` ${y}` : ''}`;
};

/** 0.734 → 73 (a whole percent), null stays null. */
export const pct = (share: number | null | undefined): number | null => (share == null || Number.isNaN(share) ? null : Math.round(share * 100));

/**
 * How full the buses ran: riders on trips with a known capacity, against the
 * seats those trips offered (only trips that ran at least once count).
 */
export function fillRate(trips: TripStat[]): number | null {
  let riders = 0; let seats = 0;
  trips.forEach((t) => {
    if (!t.capacity || !(t.active_days ?? (t.avg_riders > 0 ? 1 : 0))) return;
    riders += t.avg_riders; seats += t.capacity;
  });
  return seats > 0 ? riders / seats : null;
}

/** Stations ranked, for one line or for all. */
export function stationsOf(rows: StationCount[], lineId: string | ''): StationCount[] {
  return rows.filter((r) => !lineId || r.line_id === lineId).slice().sort((a, b) => b.count - a.count || a.order_index - b.order_index);
}

/** Lines that appear in the station counts, in name order (for the line filter). */
export function linesOf(rows: { line_id: string; line_name: string }[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  rows.forEach((r) => { if (!seen.has(r.line_id)) seen.set(r.line_id, r.line_name); });
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

/** Whether the period has anything to show at all. */
export const isEmpty = (a: CompanyAnalytics) =>
  a.students.members === 0 && a.period.ride_days === 0 && a.money.revenue === 0 && a.receipts.approved + a.receipts.rejected === 0;
