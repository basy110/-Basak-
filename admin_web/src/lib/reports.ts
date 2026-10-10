/** The financial report, a part at a time (pure helpers; the page does the asking). */

/** How many rows are asked for at a time. */
export const REPORT_PAGE = 100;

/**
 * One answer of admin_subscription_report. `rows_total` is how many rows match
 * the filters in all; a database that does not page yet leaves it out and
 * answers with every row at once.
 */
export interface ReportPart<Row, Totals> { baseline: string | null; totals: Totals; rows: Row[]; rows_total?: number | null }

/** Where the next part starts, or `undefined` when everything is loaded. */
export function nextReportOffset<Row, Totals>(parts: readonly ReportPart<Row, Totals>[]): number | undefined {
  const last = parts[parts.length - 1];
  // No count in the answer: the older function, which has already sent all it has.
  if (!last || typeof last.rows_total !== 'number' || last.rows.length === 0) return undefined;
  const loaded = parts.reduce((sum, part) => sum + part.rows.length, 0);
  return loaded < last.rows_total ? loaded : undefined;
}

/**
 * The parts as one report: the rows in order (a row that moved between two
 * parts while they were read appears once), and the totals, which always cover
 * every matching row, from the freshest part.
 */
export function mergeReport<Row extends { id: string }, Totals>(parts: readonly ReportPart<Row, Totals>[]) {
  const last = parts[parts.length - 1];
  if (!last) return null;
  const seen = new Set<string>();
  const rows = parts.flatMap((part) => part.rows).filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  return {
    baseline: last.baseline, totals: last.totals, rows,
    rowsTotal: typeof last.rows_total === 'number' ? Math.max(last.rows_total, rows.length) : rows.length,
  };
}

// ───────────────────────────── the revenue page (docs/canvas/AdmRevenue*) ────

/** One row of admin_subscription_report. `student_id` comes with 20261116000006. */
export interface ReportRow {
  id: string; student_id?: string | null; student_name: string; phone: string; university: string | null; company: string; line: string;
  type: string; period: string; academic_year: number | null; label: string | null; status: string;
  phase: 'current' | 'upcoming' | 'expired'; paid: boolean; amount: number | null; price: number;
  paid_at: string | null; start_date: string | null; end_date: string | null; payment_method: string | null; receipt_no?: number | null; receipt_code?: string | null;
}
export interface ReportTotals {
  count: number; paid: number; unpaid: number; upcoming: number; upcoming_paid: number; expired: number; revenue: number;
  revenue_first: number; revenue_second: number; revenue_summer: number; revenue_annual: number; revenue_both?: number; revenue_daily: number;
}
export interface ResetRow {
  id: string; scope: 'financial' | 'all'; reset_at: string; note: string | null; undone_at: string | null;
  company_id?: string | null; reset_by_name?: string | null; undone_by_name?: string | null;
}

/** The six statuses students see, from a report row. */
export function rowStatus(r: Pick<ReportRow, 'status' | 'phase' | 'paid'>): 'active' | 'review' | 'unpaid' | 'rejected' | 'soon' | 'ended' {
  if (r.status === 'expired' || r.phase === 'expired') return 'ended';
  if (r.status === 'pending_review') return 'review';
  if (r.status === 'rejected') return 'rejected';
  if (r.status === 'pending_payment' || !r.paid) return 'unpaid';
  return r.phase === 'upcoming' ? 'soon' : 'active';
}

/**
 * Arabic counting with the noun after the number, as the boards write it:
 * [one, two, few (3–10), many (11+), hundreds] — 1 «اشتراك واحد», 2 «اشتراكان»,
 * 5 «5 اشتراكات», 180 «180 اشتراكاً», 300 «300 اشتراك».
 */
export function counted(n: number, forms: [string, string, string, string, string?]): string {
  const num = n.toLocaleString('en-US');
  if (n === 0) return `0 ${forms[3]}`;
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  if (n <= 10) return `${num} ${forms[2]}`;
  if (n % 100 === 0) return `${num} ${forms[4] ?? forms[3]}`;
  return `${num} ${forms[3]}`;
}
export const SUBS: [string, string, string, string, string] = ['اشتراك واحد', 'اشتراكان', 'اشتراكات', 'اشتراكاً', 'اشتراك'];
export const RECEIPTS_W: [string, string, string, string, string] = ['إيصال واحد', 'إيصالان', 'إيصالات', 'إيصالاً', 'إيصال'];
export const DAYS_W: [string, string, string, string, string] = ['يوم واحد', 'يومان', 'أيام', 'يوماً', 'يوم'];
export const TIMES_W: [string, string, string, string, string] = ['مرة واحدة', 'مرتان', 'مرات', 'مرة', 'مرة'];

/** The phrase the database asks for; the dashboard sends it itself (no typed phrase for the admin). */
export const RESET_PHRASE = { financial: 'RESET FINANCIAL DATA', all: 'RESET ALL DATA' } as const;

/** The reset in force (the newest not undone), and the one before it. */
export function currentReset(resets: ResetRow[]): { current: ResetRow | null; before: ResetRow | null } {
  const live = [...resets].filter((r) => !r.undone_at).sort((a, b) => b.reset_at.localeCompare(a.reset_at));
  return { current: live[0] ?? null, before: live[1] ?? null };
}
