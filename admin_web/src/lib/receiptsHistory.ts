/**
 * «الإيصالات» › «السجل»: the receipts a company already decided, newest decision
 * first, with who decided and why (admin_reviewed_receipts). A database without
 * the function gets the same answer from table reads (capped, filtered here).
 *
 * Also the bulk decisions of the pending queue: one receipt after the other
 * through the queue's own review path, with progress and the failures kept.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { keys } from './query';
import { rpcOr } from './rpc';
import { addDays, cairoToday } from './time';
import { normalizeReceiptStoragePath } from './pendingReceipts';

export type Outcome = 'approved' | 'rejected';
export type RangePreset = 'all' | 'today' | 'week' | 'month';

export interface HistoryFilters {
  outcome: Outcome | null;
  range: RangePreset;
  search: string;
  lineId: string | null;
}

/** One decided receipt as the history shows it. */
export interface HistoryRow {
  id: string;
  status: Outcome;
  amount: number;
  reviewedAt: string | null;
  createdAt: string;
  reviewerName: string;
  rejectionReason: string;
  attemptNumber: number;
  imagePath: string | null;
  legacyImageUrl: string | null;
  paymentMethod: string;
  subscriptionId: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  lineId: string | null;
  lineName: string;
  stationName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
}

/** The server's row (admin_reviewed_receipts). */
export interface HistoryAnswerRow {
  id: string; status: string; amount: number | string | null; reviewed_at: string | null; created_at: string;
  reviewed_by?: string | null; reviewer_name: string | null; rejection_reason: string | null; attempt_number: number | null;
  image_url: string | null; payment_method: string | null; subscription_id: string; student_id: string | null;
  student_name: string | null; student_phone: string | null; line_id: string | null; line_name: string | null; station_name: string | null;
  subscription_type?: string | null; period_label: string | null; period_start: string | null; period_end: string | null;
}
export interface HistoryAnswer {
  rows: HistoryAnswerRow[]; total: number;
  counts: { approved: number; rejected: number };
  approved_amount: number | string;
  lines: { line_id: string; line_name: string; count: number }[];
}
export interface HistoryPage {
  rows: HistoryRow[]; total: number;
  counts: { approved: number; rejected: number };
  approvedAmount: number;
  lines: { id: string; name: string; count: number }[];
}

export const HISTORY_PAGE = 25;
/** The most rows one export writes. */
export const EXPORT_MAX = 5000;
/** The most rows the older way reads (before the server function exists). */
const LEGACY_MAX = 1000;

export function toHistoryRow(row: HistoryAnswerRow): HistoryRow {
  const imagePath = normalizeReceiptStoragePath(row.image_url);
  return {
    id: row.id,
    status: row.status === 'rejected' ? 'rejected' : 'approved',
    amount: Number(row.amount ?? 0),
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    reviewerName: (row.reviewer_name ?? '').trim(),
    rejectionReason: (row.rejection_reason ?? '').trim(),
    attemptNumber: row.attempt_number || 1,
    imagePath,
    legacyImageUrl: !imagePath && /^https?:\/\//i.test(row.image_url || '') ? String(row.image_url) : null,
    paymentMethod: (row.payment_method ?? '').trim(),
    subscriptionId: row.subscription_id,
    studentId: row.student_id || '',
    studentName: row.student_name || 'بيانات الطالب غير متاحة',
    studentPhone: row.student_phone || '',
    lineId: row.line_id,
    lineName: row.line_name || '—',
    stationName: row.station_name || '—',
    periodLabel: row.period_label || '',
    periodStart: row.period_start || '',
    periodEnd: row.period_end || '',
  };
}

export const toHistoryPage = (answer: HistoryAnswer | null | undefined): HistoryPage => ({
  rows: (answer?.rows ?? []).map(toHistoryRow),
  total: Number(answer?.total ?? 0),
  counts: { approved: Number(answer?.counts?.approved ?? 0), rejected: Number(answer?.counts?.rejected ?? 0) },
  approvedAmount: Number(answer?.approved_amount ?? 0),
  lines: (answer?.lines ?? []).map((l) => ({ id: l.line_id, name: l.line_name, count: Number(l.count) })),
});

/** The Cairo days a preset covers (both ends included); null ends are open. */
export function rangeDays(range: RangePreset, today: string = cairoToday()): { from: string | null; to: string | null } {
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'week': return { from: addDays(today, -6), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    default: return { from: null, to: null };
  }
}

/** Arabic letters compared without the forms that vary in typing (as the pending queue's search). */
const fold = (text: string) => text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The older way's filtering and counting, in the server function's shape:
 * `rows` are every decided receipt inside the days (newest first).
 */
export function answerFrom(rows: HistoryAnswerRow[], filters: Pick<HistoryFilters, 'outcome' | 'search' | 'lineId'>, limit: number, offset: number): HistoryAnswer {
  const term = fold(filters.search);
  const digits = filters.search.replace(/\D/g, '');
  const base = rows.filter((r) => !term || fold(r.student_name ?? '').includes(term)
    || (digits.length >= 3 && (r.student_phone ?? '').replace(/\D/g, '').includes(digits)));
  const scoped = base.filter((r) => !filters.lineId || r.line_id === filters.lineId);
  const matching = scoped.filter((r) => !filters.outcome || r.status === filters.outcome);
  const lines = new Map<string, { line_id: string; line_name: string; count: number }>();
  base.filter((r) => !filters.outcome || r.status === filters.outcome).forEach((r) => {
    if (!r.line_id) return;
    const entry = lines.get(r.line_id) ?? { line_id: r.line_id, line_name: r.line_name ?? '—', count: 0 };
    entry.count += 1;
    lines.set(r.line_id, entry);
  });
  const approved = scoped.filter((r) => r.status === 'approved');
  return {
    rows: matching.slice(offset, offset + limit),
    total: matching.length,
    counts: { approved: approved.length, rejected: scoped.filter((r) => r.status === 'rejected').length },
    approved_amount: approved.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
    lines: [...lines.values()].sort((a, b) => b.count - a.count || a.line_name.localeCompare(b.line_name, 'ar')),
  };
}

type Row = Record<string, any>;
const byId = (rows: Row[] | null | undefined) => new Map((rows || []).map((row) => [row.id as string, row]));
const uniq = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => !!value))];
/** A Cairo day's first instant (Cairo is UTC+2 or +3; the server function is exact, this is close enough for the older way). */
const dayStart = (day: string) => new Date(`${day}T00:00:00+02:00`).toISOString();

/** The older way: the decided receipts inside the days, then who, which line and who decided. */
async function legacyHistory(companyId: string, filters: HistoryFilters, limit: number, offset: number): Promise<HistoryAnswer> {
  const { from, to } = rangeDays(filters.range);
  let query = supabase.from('receipts')
    .select('id, status, amount, reviewed_at, created_at, reviewed_by, rejection_reason, attempt_number, image_url, payment_method_id, subscription_id')
    .eq('company_id', companyId).in('status', ['approved', 'rejected']);
  if (from) query = query.gte('reviewed_at', dayStart(from));
  if (to) query = query.lt('reviewed_at', dayStart(addDays(to, 1)));
  const { data, error } = await query.order('reviewed_at', { ascending: false }).limit(LEGACY_MAX);
  if (error) throw new Error(error.message);
  const receipts = (data || []) as Row[];
  if (!receipts.length) return answerFrom([], filters, limit, offset);

  const { data: subRows, error: subError } = await supabase.from('subscriptions')
    .select('id, price, student_id, line_id, station_id, start_date, end_date, period_label')
    .in('id', uniq(receipts.map((r) => r.subscription_id)));
  if (subError) throw new Error(subError.message);
  const subs = byId(subRows as Row[]);
  const list = [...subs.values()];
  const [students, lines, stations, admins, methods] = await Promise.all([
    supabase.from('students').select('id, full_name, phone').in('id', uniq(list.map((s) => s.student_id))),
    supabase.from('lines').select('id, name').in('id', uniq(list.map((s) => s.line_id))),
    supabase.from('stations').select('id, name').in('id', uniq(list.map((s) => s.station_id))),
    supabase.from('admins').select('id, full_name').in('id', uniq(receipts.map((r) => r.reviewed_by))),
    supabase.from('company_payment_methods').select('id, display_name').in('id', uniq(receipts.map((r) => r.payment_method_id))),
  ]);
  const failed = students.error ?? lines.error ?? stations.error;
  if (failed) throw new Error(failed.message);
  // Names of who decided and of the method are a courtesy: a refused read leaves them blank.
  const st = byId(students.data as Row[]); const ln = byId(lines.data as Row[]); const sn = byId(stations.data as Row[]);
  const ad = byId(admins.error ? [] : admins.data as Row[]); const pm = byId(methods.error ? [] : methods.data as Row[]);
  const rows: HistoryAnswerRow[] = receipts.map((r) => {
    const s = subs.get(r.subscription_id);
    const student = s ? st.get(s.student_id) : undefined;
    return {
      id: r.id, status: r.status, amount: r.amount ?? s?.price ?? null, reviewed_at: r.reviewed_at, created_at: r.created_at,
      reviewer_name: ad.get(r.reviewed_by)?.full_name ?? null, rejection_reason: r.rejection_reason, attempt_number: r.attempt_number,
      image_url: r.image_url, payment_method: pm.get(r.payment_method_id)?.display_name ?? null,
      subscription_id: r.subscription_id, student_id: s?.student_id ?? null,
      student_name: student?.full_name ?? null, student_phone: student?.phone ?? null,
      line_id: s?.line_id ?? null, line_name: s ? ln.get(s.line_id)?.name ?? null : null,
      station_name: s ? sn.get(s.station_id)?.name ?? null : null,
      period_label: s?.period_label ?? null, period_start: s?.start_date ?? null, period_end: s?.end_date ?? null,
    };
  });
  return answerFrom(rows, filters, limit, offset);
}

/** One page of the history (or, for an export, up to EXPORT_MAX rows from the first). */
export async function fetchReviewedReceipts(companyId: string, filters: HistoryFilters, limit: number, offset: number): Promise<HistoryPage> {
  const { from, to } = rangeDays(filters.range);
  const answer = await rpcOr<HistoryAnswer>('admin_reviewed_receipts',
    () => supabase.rpc('admin_reviewed_receipts', {
      p_company_id: companyId, p_outcome: filters.outcome, p_from: from, p_to: to,
      p_search: filters.search.trim() || null, p_limit: limit, p_offset: offset, p_line_id: filters.lineId,
    }),
    () => legacyHistory(companyId, filters, limit, offset));
  return toHistoryPage(answer);
}

/**
 * The history page by page. The key's third segment is 'receipts', so a decision
 * anywhere (the live topic) marks it out of date; it is also read again whenever
 * the tab is opened, so this tab's own decisions show at once.
 */
export function useReceiptsHistory(companyId: string, filters: HistoryFilters, page: number) {
  const search = filters.search.trim();
  const query = useQuery({
    queryKey: keys.company(companyId, 'receipts', 'history', { ...filters, search, page }),
    queryFn: () => fetchReviewedReceipts(companyId, { ...filters, search }, HISTORY_PAGE, (page - 1) * HISTORY_PAGE),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  return {
    data: query.data,
    loading: query.isPending,
    refreshing: query.isFetching && !query.isPending,
    error: query.error instanceof Error ? query.error.message : '',
    reload: () => void query.refetch(),
  };
}

// ── Bulk decisions ──

export interface BulkFailure<T> { item: T; error: unknown }
export interface BulkResult<T> { done: T[]; failed: BulkFailure<T>[] }

/**
 * Runs `act` on each item, one after the other (never two at once: each answer
 * carries the company's numbers, applied in order). `onStep` hears after each.
 * A failure is kept and the run goes on. `stop()` returning true ends it early.
 */
export async function runOneByOne<T>(
  items: readonly T[], act: (item: T) => Promise<unknown>,
  onStep?: (finished: number, result: BulkResult<T>) => void, stop?: () => boolean,
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { done: [], failed: [] };
  for (const item of items) {
    if (stop?.()) break;
    try {
      await act(item);
      result.done.push(item);
    } catch (error) {
      result.failed.push({ item, error });
    }
    onStep?.(result.done.length + result.failed.length, result);
  }
  return result;
}
