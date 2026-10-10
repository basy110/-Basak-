/**
 * The platform owner's money and numbers (migration 20261119000002_platform_finance.sql):
 *   «الحسابات» (/platform/billing)    platform_billing + the writes on plans, bills and costs
 *   «تحليلات المنصة» (/platform/analytics)  platform_analytics over a period
 * Types, cache keys, hooks and the small pure helpers both pages (and their
 * exports) share. Recommendations' wording is in platformInsights.ts.
 * A database without these functions yet answers `null`; the pages say so.
 */
import { supabase } from './supabase';
import { keys, STALE, usePageData } from './query';
import { rpcOr } from './rpc';
import { addDays, cairoToday } from './time';

// ───────────────────────────────────────────────────────────── billing ────

export type Cycle = 'monthly' | 'termly' | 'yearly';
export type ChargeStatus = 'due' | 'paid' | 'waived';
export type ExpenseCategory =
  | 'hosting' | 'database' | 'sms' | 'push' | 'app_store' | 'play_store' | 'domain' | 'salaries' | 'marketing' | 'support' | 'other';
export type CompanyStatus = 'active' | 'suspended' | 'archived';

export interface PlanRow {
  id: string; company_id: string; company_name: string; fee_amount: number; cycle: Cycle;
  starts_on: string; ends_on: string | null; note: string | null; created_at: string; created_by_name?: string | null;
}
export interface BillingCompany {
  id: string; name: string; status: CompanyStatus; created_at: string;
  plan: { id: string; fee_amount: number; cycle: Cycle; starts_on: string; note: string | null; created_at: string } | null;
  monthly_fee: number | null; outstanding: number; overdue: number; oldest_due: string | null;
}
export interface Charge {
  id: string; company_id: string; company_name: string; plan_id: string | null; period_start: string; period_end: string;
  amount: number; status: ChargeStatus; paid_at: string | null; method: string | null; note: string | null; created_at: string;
}
export interface Expense { id: string; month: string; category: ExpenseCategory; amount: number; note: string | null; recurring: boolean; created_at: string }
export interface PnlRow { month: string; billed: number; collected: number; costs: number; profit: number }

export interface PlatformBilling {
  today: string; grace_days: number; mrr: number;
  companies: BillingCompany[]; plans: PlanRow[]; charges: Charge[]; expenses: Expense[]; pnl: PnlRow[];
}

export const billingKey = keys.platform('finance', 'billing');

export function usePlatformBilling() {
  return usePageData<PlatformBilling | null>(
    billingKey,
    () => rpcOr<PlatformBilling | null>('platform_billing', () => supabase.rpc('platform_billing'), async () => null),
    { staleTime: 60_000 },
  );
}

/** What the writes answer (the row as stored). */
export const savePlan = (companyId: string, fee: number, cycle: Cycle, startsOn: string, note: string) =>
  supabase.rpc('save_company_plan', { p_company_id: companyId, p_fee: fee, p_cycle: cycle, p_starts_on: startsOn, p_note: note.trim() || null });
export const generateCharges = (until: string) => supabase.rpc('platform_generate_charges', { p_until: until });
export const setChargeStatus = (id: string, status: ChargeStatus, method: string | null, note: string | null) =>
  supabase.rpc('set_platform_charge_status', { p_charge_id: id, p_status: status, p_method: method, p_note: note });
export const saveExpense = (id: string | null, e: { month: string; category: ExpenseCategory; amount: number; note: string; recurring: boolean }) =>
  supabase.rpc('save_platform_expense', { p_id: id, p_month: e.month, p_category: e.category, p_amount: e.amount, p_note: e.note.trim() || null, p_recurring: e.recurring });
export const deleteExpense = (id: string) => supabase.rpc('delete_platform_expense', { p_id: id });

// ──────────────────────────────────────────────────────────── analytics ────

export type Severity = 'act' | 'watch' | 'good';
export type PlatformInsightKey =
  | 'company_overdue' | 'company_inactive' | 'company_declining' | 'university_opportunity' | 'old_app_versions'
  | 'cost_per_student_rising' | 'slow_reviews' | 'no_plan' | 'unprofitable';
export interface PlatformInsight { key: PlatformInsightKey | string; severity: Severity; data: Record<string, any> }

export interface CompanyStat {
  id: string; name: string; status: CompanyStatus; created_at: string;
  students: number; subscribers: number; subscribers_before: number | null; lines: number; active_lines: number;
  ride_days: number; riders_avg: number; confirm_rate: number | null; company_revenue: number;
  plan_fee: number | null; plan_cycle: Cycle | null; outstanding: number; overdue: number;
  last_admin_seen: string | null; median_review_hours: number | null; reviewed: number;
  /** 0–100, active companies only. */
  health: number | null;
}

export interface PlatformAnalytics {
  period: { from: string | null; to: string; previous_from: string | null; previous_to: string | null };
  finance: {
    mrr: number; billed: number; collected: number; outstanding: number;
    overdue: { company_id: string; name: string; amount: number; oldest_due: string }[];
    costs_total: number; costs_by_category: { category: ExpenseCategory; amount: number }[];
    by_month: PnlRow[]; profit: number; margin: number | null;
    cost_per_company: number | null; cost_per_student: number | null; cost_per_student_before?: number | null;
    subscribers: number; active_companies: number;
  };
  companies: { counts: { total: number; active: number; suspended: number; archived: number }; list: CompanyStat[] };
  students: {
    total: number; with_company: number; without_company: number; subscribers: number; new_in_period: number;
    new_by_month: { month: string; count: number }[];
    by_university: { id: string | null; name: string | null; students: number; companies: number; lines: number }[];
    by_college: { name: string; count: number }[];
    by_specialisation: { name: string; count: number }[];
  };
  usage: {
    daily: { date: string; confirmed: number; boarded: number }[];
    devices: { ios: number; android: number };
    app_versions: { platform: 'ios' | 'android' | string; version: string; devices: number }[];
    latest: Record<string, string> | null;
    push_7d: { accepted: number; failed: number; failure_rate: number | null };
  };
  insights: PlatformInsight[];
}

export type PeriodKey = '30d' | 'month' | 'quarter' | 'year' | 'all';
export const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: '30d', label: 'آخر 30 يوماً' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'quarter', label: 'آخر 3 أشهر' },
  { value: 'year', label: 'آخر 12 شهراً' },
  { value: 'all', label: 'كل الوقت' },
];
export const DEFAULT_PERIOD: PeriodKey = '30d';
export const periodLabel = (key: PeriodKey) => PERIODS.find((p) => p.value === key)?.label ?? '';

/** Cairo days a preset asks for (`to` null = up to today; `from` null = from the beginning). */
export function periodRange(key: PeriodKey, today: string = cairoToday()): { from: string | null; to: string | null } {
  if (key === '30d') return { from: addDays(today, -29), to: null };
  if (key === 'month') return { from: `${today.slice(0, 8)}01`, to: null };
  if (key === 'quarter') return { from: addDays(today, -89), to: null };
  if (key === 'year') return { from: addDays(today, -364), to: null };
  return { from: null, to: null };
}

export function usePlatformAnalytics(period: PeriodKey) {
  const { from, to } = periodRange(period);
  return usePageData<PlatformAnalytics | null>(
    keys.platform('finance', 'analytics', from ?? 'all', to ?? 'all'),
    () => rpcOr<PlatformAnalytics | null>('platform_analytics',
      () => supabase.rpc('platform_analytics', { p_from: from, p_to: to }), async () => null),
    { staleTime: STALE.reference, keepPrevious: true },
  );
}

// ───────────────────────────────────────────────────────────── words ────

export const CYCLE_LABEL: Record<Cycle, string> = { monthly: 'شهرياً', termly: 'كل فصل دراسي', yearly: 'سنوياً' };
/** «1,500 ج.م شهرياً» is how a plan reads; the noun of one period: */
export const CYCLE_PERIOD: Record<Cycle, string> = { monthly: 'الشهر', termly: 'الفصل', yearly: 'السنة' };
export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = { due: 'مستحقة', paid: 'سُدّدت', waived: 'أُعفيت' };
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  hosting: 'الاستضافة والخوادم', database: 'قاعدة البيانات', sms: 'الرسائل النصية', push: 'الإشعارات',
  app_store: 'متجر آبل', play_store: 'متجر جوجل بلاي', domain: 'النطاق', salaries: 'الرواتب',
  marketing: 'التسويق', support: 'الدعم', other: 'أخرى',
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as ExpenseCategory[];

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** `2026-09` (or `2026-09-01`) → «سبتمبر 2026» (without the year when asked). */
export const monthText = (month: string, withYear = true) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[(m || 1) - 1]}${withYear ? ` ${y}` : ''}`;
};

// ──────────────────────────────────────────────────────────── helpers ────

/** A plan's fee per month: monthly as is, termly / 4, yearly / 12 (as MRR counts it). */
export function monthlyFee(fee: number, cycle: Cycle): number {
  if (cycle === 'termly') return fee / 4;
  if (cycle === 'yearly') return fee / 12;
  return fee;
}

/** `2026-10` from a day or a timestamp, in Cairo for timestamps. */
export function monthOf(value: string): string {
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return value.slice(0, 7);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/**
 * The monthly P&L from the bills and costs on hand (the same definitions as
 * platform_billing's `pnl`, so a write patched into the cache shows at once):
 * billed = bills not waived by their period's month; collected = paid bills by
 * the month they were paid; costs by month; profit = collected − costs.
 * Every month from the first with anything up to `today`'s month, oldest first.
 */
export function pnlRows(charges: Charge[], expenses: Expense[], today: string): PnlRow[] {
  const rows = new Map<string, PnlRow>();
  const at = (m: string) => {
    let r = rows.get(m);
    if (!r) { r = { month: m, billed: 0, collected: 0, costs: 0, profit: 0 }; rows.set(m, r); }
    return r;
  };
  charges.forEach((c) => {
    if (c.status !== 'waived') at(monthOf(c.period_start)).billed += Number(c.amount);
    if (c.status === 'paid' && c.paid_at) at(monthOf(c.paid_at)).collected += Number(c.amount);
  });
  expenses.forEach((e) => { at(monthOf(e.month)).costs += Number(e.amount); });
  if (!rows.size) return [];
  const last = monthOf(today);
  const first = [...rows.keys()].sort()[0];
  const out: PnlRow[] = [];
  for (let m = first; m <= last && out.length < 120; m = nextMonth(m)) {
    const r = rows.get(m) ?? { month: m, billed: 0, collected: 0, costs: 0, profit: 0 };
    out.push({ ...r, profit: r.collected - r.costs });
  }
  return out;
}

/** What a company owes now: its due bills whose period has started, and the part overdue (after `grace` days). */
export function companyDues(charges: Charge[], companyId: string, today: string, grace = 14) {
  let outstanding = 0; let overdue = 0; let oldest: string | null = null;
  charges.forEach((c) => {
    if (c.company_id !== companyId || c.status !== 'due' || c.period_start > today) return;
    outstanding += Number(c.amount);
    if (addDays(c.period_start, grace) < today) overdue += Number(c.amount);
    if (!oldest || c.period_start < oldest) oldest = c.period_start;
  });
  return { outstanding, overdue, oldest };
}

/** Whether a due bill is past its grace days. */
export const isOverdue = (c: Pick<Charge, 'status' | 'period_start'>, today: string, grace = 14) =>
  c.status === 'due' && addDays(c.period_start, grace) < today;

/** MRR from the companies' open plans (as the server counts it: started, company not archived). */
export function mrrOf(companies: BillingCompany[], today: string): number {
  return companies.reduce((t, c) => (c.plan && c.status !== 'archived' && c.plan.starts_on <= today ? t + monthlyFee(Number(c.plan.fee_amount), c.plan.cycle) : t), 0);
}

/** A health score's word and status tone (green ≥ 70, amber ≥ 40, red below). */
export function healthTone(score: number | null): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string } {
  if (score == null) return { tone: 'neutral', label: '—' };
  if (score >= 70) return { tone: 'success', label: 'جيدة' };
  if (score >= 40) return { tone: 'warning', label: 'متوسطة' };
  return { tone: 'danger', label: 'ضعيفة' };
}

/** The first day of a `YYYY-MM` month. */
export const firstOf = (month: string) => `${month.slice(0, 7)}-01`;

/** The validation of the plan form (Arabic, under each field). */
export function planErrors(d: { fee: number | ''; cycle: Cycle | ''; startsOn: string }, current?: { starts_on: string } | null): Partial<Record<'fee' | 'cycle' | 'startsOn', string>> {
  const e: Partial<Record<'fee' | 'cycle' | 'startsOn', string>> = {};
  if (d.fee === '') e.fee = 'اكتب المبلغ (صفر إن كانت الشركة لا تدفع).';
  if (!d.cycle) e.cycle = 'اختر كل كم تدفع الشركة.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.startsOn)) e.startsOn = 'اختر تاريخ البداية.';
  else if (current && d.startsOn < current.starts_on) e.startsOn = 'لا يبدأ قبل بداية الاشتراك الحالي.';
  return e;
}

/** The validation of the cost form. */
export function expenseErrors(d: { month: string; category: ExpenseCategory | ''; amount: number | '' }): Partial<Record<'month' | 'category' | 'amount', string>> {
  const e: Partial<Record<'month' | 'category' | 'amount', string>> = {};
  if (!/^\d{4}-\d{2}$/.test(d.month)) e.month = 'اختر الشهر.';
  if (!d.category) e.category = 'اختر نوع التكلفة.';
  if (d.amount === '' || d.amount <= 0) e.amount = 'اكتب مبلغاً أكبر من صفر.';
  return e;
}
