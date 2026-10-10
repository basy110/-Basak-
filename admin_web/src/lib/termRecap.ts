/**
 * «ملخص الفصل» of the platform admin: the whole platform's term in numbers, and
 * the switch that shows the end-of-term recap to every student
 * (supabase/migrations/20261119000004_term_recap_release.sql). One request reads
 * the page, `platform_term_recap_overview`; publishing answers the release, which
 * is put into the cache as it is.
 */
import { supabase } from './supabase';
import { keys, usePageData } from './query';
import { rpcOr } from './rpc';
import { countText, dayText, num, NOUN } from '../ui/format';

export type RecapPeriod = 'first' | 'second' | 'summer';
/** A term: the year the academic year starts (2026 = 2026/2027) and its code. */
export interface RecapTerm { academic_year: number; period_code: RecapPeriod }

export interface RecapRelease extends RecapTerm {
  published: boolean;
  published_at: string | null;
  published_by_name: string | null;
  unpublished_at: string | null;
  message: string | null;
  /** The notification goes out once per term: the first time it is published. */
  notified_at: string | null;
  notified_companies: number | null;
  notified_students: number | null;
  /** This very call sent it. */
  notified_now?: boolean;
}

export interface RecapOption extends RecapTerm { label: string | null; start_date: string; end_date: string; published: boolean }

export interface RecapRanked { id?: string; name: string; students: number; ride_days: number; line_name?: string | null; company_name?: string | null }

export interface TermRecapOverview {
  today: string;
  term: RecapTerm & {
    name: string | null; label: string | null; start_date: string | null; end_date: string | null; until: string | null;
    /** When Home shows the banner: 14 days before the term ends to 28 after. */
    window_opens: string | null; window_closes: string | null;
  };
  options: RecapOption[];
  release: RecapRelease | null;
  /** Who the notification would reach now. */
  reach: { companies: number; students: number };
  totals: {
    students: number; ride_days: number; return_days: number; boardings: number; companies: number;
    lines: number; stations: number; universities: number; median_ride_days: number | null;
  };
  top_stations: RecapRanked[];
  top_lines: RecapRanked[];
  top_universities: RecapRanked[];
  companies: (RecapRanked & { id: string; boardings: number })[];
}

/** The longest message (the notification's body allows 600). */
export const MESSAGE_MAX = 600;
export const NOTICE_TITLE = 'ملخص فصلك جاهز';
/** What the app's banner on Home says above its line. */
export const BANNER_TITLE = 'ملخّص ترمك جاهز';

export const termKeyOf = (t: RecapTerm) => `${t.academic_year}:${t.period_code}`;
export function parseTermKey(key: string): RecapTerm | null {
  const m = /^(\d{4}):(first|second|summer)$/.exec(key);
  return m ? { academic_year: Number(m[1]), period_code: m[2] as RecapPeriod } : null;
}

const PERIOD_NAME: Record<RecapPeriod, string> = { first: 'الفصل الدراسي الأول', second: 'الفصل الدراسي الثاني', summer: 'الفصل الصيفي' };
/** «الفصل الدراسي الأول 2026/2027», from the server's label when it has one. */
export function termLabel(t: RecapTerm & { label?: string | null }): string {
  return t.label?.trim() || `${PERIOD_NAME[t.period_code]} ${t.academic_year}/${t.academic_year + 1}`;
}

/** The notification's text when no message is written (the server says the same). */
export const defaultMessage = (t: RecapTerm & { label?: string | null }) =>
  `افتح التطبيق لترى ملخص ${termLabel(t)}: أيام ركوبك ومحطتك ولقبك هذا الفصل.`;

/** Why the message cannot be sent; null when it can (empty is fine: the default is used). */
export function messageProblem(text: string): string | null {
  return text.trim().length > MESSAGE_MAX ? `الرسالة طويلة: ${num(MESSAGE_MAX)} حرف على الأكثر.` : null;
}

export type ReleaseState = 'published' | 'stopped' | 'never';
export function releaseState(r: RecapRelease | null | undefined): ReleaseState {
  if (!r || !r.published_at) return 'never';
  return r.published ? 'published' : 'stopped';
}

/** «يظهر في الصفحة الرئيسية من 16 يناير حتى 27 فبراير 2027». */
export function windowText(term: TermRecapOverview['term']): string {
  if (!term.window_opens || !term.window_closes) return '';
  return `من ${dayText(term.window_opens, { year: term.window_opens.slice(0, 4) !== term.window_closes.slice(0, 4) })} حتى ${dayText(term.window_closes)}`;
}

/** Bars of a ranked list: each row's share of the first (0–100). */
export function barWidths(rows: { ride_days: number }[]): number[] {
  const top = Math.max(0, ...rows.map((r) => r.ride_days));
  return rows.map((r) => (top > 0 ? Math.max(2, Math.round((r.ride_days / top) * 100)) : 0));
}

/**
 * What one typical student sees (the phone preview): the median number of ride
 * days, the busiest stop and line. Static: a sample, not anybody's recap.
 */
export function sampleStudent(o: TermRecapOverview): { days: number; station: string | null; line: string | null } {
  const days = o.totals.median_ride_days ?? (o.totals.students > 0 ? Math.round(o.totals.ride_days / o.totals.students) : 0);
  return { days, station: o.top_stations[0]?.name ?? null, line: o.top_lines[0]?.name ?? null };
}

/** «62 يوم في الباص… والباقي جوّه.» as the app's banner says it. */
export const bannerLine = (days: number) => `${num(days)} يوم في الباص… والباقي جوّه.`;

/** The dialog's sentence about who is told: «يصل الإشعار إلى 4,812 طالباً في 19 شركة». */
export function reachText(reach: TermRecapOverview['reach']): string {
  if (reach.students === 0) return 'لا يوجد طلاب يصلهم الإشعار الآن.';
  return `يصل الإشعار إلى ${countText(reach.students, NOUN.student)} في ${countText(reach.companies, NOUN.company)}.`;
}

/** The options of the term picker, with the shown term among them even when the server left it out. */
export function termOptions(o: TermRecapOverview): { value: string; label: string }[] {
  const all = o.options.some((x) => termKeyOf(x) === termKeyOf(o.term)) ? o.options : [{ ...o.term, label: o.term.label, published: o.release?.published ?? false } as RecapOption, ...o.options];
  return all.map((x) => ({ value: termKeyOf(x), label: `${termLabel(x)}${x.published ? ' · منشور' : ''}` }));
}

/** The overview with a new release in it (after publishing or stopping). */
export function withRelease(o: TermRecapOverview, r: RecapRelease): TermRecapOverview {
  const same = (x: RecapTerm) => x.academic_year === r.academic_year && x.period_code === r.period_code;
  return {
    ...o,
    release: same(o.term) ? r : o.release,
    options: o.options.map((x) => (same(x) ? { ...x, published: r.published } : x)),
  };
}

// ── Reading and writing ─────────────────────────────────────────────

/** Null term = the server's choice (the term whose window is open, else the last that started). */
export const termRecapKey = (term: RecapTerm | null) => keys.platform('termRecap', term ? termKeyOf(term) : 'current');

/** Null when the database does not have the function yet. */
export const loadTermRecap = (term: RecapTerm | null) => rpcOr<TermRecapOverview | null>('platform_term_recap_overview',
  () => supabase.rpc('platform_term_recap_overview', term ? { p_year: term.academic_year, p_period: term.period_code } : {}),
  async () => null);

export const useTermRecap = (term: RecapTerm | null) => usePageData(termRecapKey(term), () => loadTermRecap(term), { keepPrevious: true });

export async function publishTermRecap(term: RecapTerm, message: string): Promise<RecapRelease> {
  const { data, error } = await supabase.rpc('platform_publish_term_recap', {
    p_year: term.academic_year, p_period: term.period_code, p_message: message.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as RecapRelease;
}

export async function unpublishTermRecap(term: RecapTerm): Promise<RecapRelease> {
  const { data, error } = await supabase.rpc('platform_unpublish_term_recap', { p_year: term.academic_year, p_period: term.period_code });
  if (error) throw new Error(error.message);
  return data as RecapRelease;
}
