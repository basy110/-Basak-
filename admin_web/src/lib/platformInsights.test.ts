import { describe, expect, it } from 'vitest';
import { platformInsightText, platformInsights } from './platformInsights';
import { companyDues, expenseErrors, healthTone, isOverdue, monthOf, monthlyFee, mrrOf, periodRange, planErrors, pnlRows, type BillingCompany, type Charge, type Expense } from './platformFinance';
import type { PlatformInsight } from './platformFinance';

/** Texts carry direction marks around numbers; compare without them. */
const plain = (s: string) => s.replace(/[\u200E\u2066\u2069]/g, '').replace(/\u00A0/g, ' ');
const text = (key: string, severity: PlatformInsight['severity'], data: Record<string, unknown>) => {
  const t = platformInsightText({ key, severity, data });
  return { ...t, title: plain(t.title), sub: plain(t.sub) };
};

describe('platformInsightText', () => {
  it('company_overdue: the company, the amount, since when; opens the bills', () => {
    const t = text('company_overdue', 'act', { company_id: 'c1', name: 'النورس', amount: 4500, oldest_due: '2026-07-02', days: 100 });
    expect(t.tone).toBe('danger');
    expect(t.title).toBe('«النورس» متأخرة في سداد 4,500 ج.م');
    expect(t.sub).toContain('2 يوليو');
    expect(t.sub).toContain('100 يوماً');
    expect(t.action).toEqual({ label: 'افتح الفواتير', to: '/platform/billing?tab=charges' });
  });

  it('no_plan: one company by name, many by count', () => {
    expect(text('no_plan', 'act', { count: 1, companies: [{ id: 'c1', name: 'الدلتا' }] }).title).toBe('«الدلتا» بلا اشتراك للمنصة');
    const many = text('no_plan', 'act', { count: 4, companies: [{ id: 'a', name: 'أ' }, { id: 'b', name: 'ب' }, { id: 'c', name: 'ج' }, { id: 'd', name: 'د' }] });
    expect(many.title).toBe('4 شركات بلا اشتراك للمنصة');
    expect(many.sub).toContain('أ، ب، ج وغيرها');
    expect(many.action?.to).toBe('/platform/billing?tab=plans');
  });

  it('unprofitable: costs, collected and the loss', () => {
    const t = text('unprofitable', 'act', { costs: 96600, collected: 1500, loss: 95100 });
    expect(t.sub).toBe('التكاليف 96,600 ج.م والمحصّل 1,500 ج.م، أي خسارة 95,100 ج.م.');
    expect(t.action?.to).toBe('/platform/billing?tab=pnl');
  });

  it('company_inactive: since when, or never; opens the company', () => {
    expect(text('company_inactive', 'watch', { company_id: 'c1', name: 'الريتاج', last_seen: '2026-09-01T10:00:00Z', days: 39 }).title)
      .toBe('مديرو «الريتاج» لم يدخلوا اللوحة منذ 39 يوماً');
    const never = text('company_inactive', 'watch', { company_id: 'c1', name: 'الريتاج', last_seen: null, days: null });
    expect(never.title).toBe('لم يدخل أحد من مديري «الريتاج» اللوحة بعد');
    expect(never.action).toEqual({ label: 'افتح الشركة', to: '/platform/companies?company=c1' });
  });

  it('company_declining, slow_reviews', () => {
    expect(text('company_declining', 'watch', { company_id: 'c', name: 'ج', now: 0, before: 1000, pct: 100 }).title).toBe('مشتركو «ج» نقصوا 100%');
    const slow = text('slow_reviews', 'watch', { company_id: 'b', name: 'ب', median_hours: 40, reviewed: 125 });
    expect(slow.title).toBe('«ب» تراجع الإيصالات في 40 ساعة');
    expect(slow.sub).toContain('125 إيصالاً');
  });

  it('old_app_versions: the store, the share and the latest version', () => {
    const t = text('old_app_versions', 'watch', { platform: 'android', latest: '1.0.13', old: 6, total: 12, pct: 50 });
    expect(t.title).toBe('50% من أجهزة أندرويد على إصدار أقدم من 1.0.13');
    expect(t.sub).toContain('6 من 12 جهازاً');
    expect(t.action?.to).toBe('/platform/app-versions');
  });

  it('cost_per_student_rising and university_opportunity', () => {
    expect(text('cost_per_student_rising', 'watch', { now: 48.3, before: 30, pct: 61 }).sub).toContain('48 ج.م للمشترك مقابل 30 ج.م');
    const u = text('university_opportunity', 'good', { university_id: 'u', name: 'جامعة دمياط', students: 3000, lines: 0 });
    expect(u.tone).toBe('teal');
    expect(u.title).toBe('3,000 طالباً في جامعة دمياط ولا خط يخدمها');
    expect(text('university_opportunity', 'good', { name: 'جامعة دمياط', students: 25, lines: 1 }).title).toContain('وخط واحد فقط');
  });

  it('an unknown rule still reads as something', () => {
    expect(text('future_rule', 'watch', {}).title).toBe('ملاحظة على المنصة');
  });
});

describe('platformInsights', () => {
  it('keeps known rules, act first, the server order within a severity', () => {
    const list: PlatformInsight[] = [
      { key: 'university_opportunity', severity: 'good', data: {} },
      { key: 'slow_reviews', severity: 'watch', data: { name: 'a' } },
      { key: 'mystery', severity: 'act', data: {} },
      { key: 'company_overdue', severity: 'act', data: {} },
      { key: 'company_inactive', severity: 'watch', data: { name: 'b' } },
    ];
    expect(platformInsights(list).map((i) => i.key)).toEqual(['company_overdue', 'slow_reviews', 'company_inactive', 'university_opportunity']);
    expect(platformInsights(null)).toEqual([]);
  });
});

const charge = (p: Partial<Charge>): Charge => ({
  id: 'x', company_id: 'c1', company_name: 'أ', plan_id: null, period_start: '2026-09-01', period_end: '2026-09-30', amount: 1000,
  status: 'due', paid_at: null, method: null, note: null, created_at: '2026-09-01T00:00:00Z', ...p,
});
const expense = (p: Partial<Expense>): Expense => ({ id: 'e', month: '2026-09-01', category: 'hosting', amount: 800, note: null, recurring: false, created_at: '', ...p });

describe('money helpers', () => {
  it('monthlyFee normalises the cycles', () => {
    expect(monthlyFee(1200, 'monthly')).toBe(1200);
    expect(monthlyFee(4000, 'termly')).toBe(1000);
    expect(monthlyFee(12000, 'yearly')).toBe(1000);
  });

  it('monthOf reads days as they are and timestamps in Cairo', () => {
    expect(monthOf('2026-09-30')).toBe('2026-09');
    expect(monthOf('2026-09')).toBe('2026-09');
    // 22:30 UTC on 30 September is already 1 October in Cairo.
    expect(monthOf('2026-09-30T22:30:00Z')).toBe('2026-10');
  });

  it('pnlRows: billed by period, collected by payment, waived not billed, empty months filled', () => {
    const rows = pnlRows([
      charge({ id: 'a', period_start: '2026-07-01', status: 'paid', paid_at: '2026-09-05T10:00:00Z' }),
      charge({ id: 'b', period_start: '2026-08-01', status: 'waived' }),
      charge({ id: 'c', period_start: '2026-09-01' }),
    ], [expense({ month: '2026-09-01', amount: 800 }), expense({ month: '2026-10-01', amount: 95000 })], '2026-10-10');
    expect(rows.map((r) => r.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(rows[0]).toEqual({ month: '2026-07', billed: 1000, collected: 0, costs: 0, profit: 0 });
    expect(rows[1].billed).toBe(0);
    expect(rows[2]).toEqual({ month: '2026-09', billed: 1000, collected: 1000, costs: 800, profit: 200 });
    expect(rows[3].profit).toBe(-95000);
    expect(pnlRows([], [], '2026-10-10')).toEqual([]);
  });

  it('companyDues and isOverdue: started due bills; overdue after the grace days', () => {
    const list = [
      charge({ id: 'a', period_start: '2026-09-01' }),
      charge({ id: 'b', period_start: '2026-10-01' }),
      charge({ id: 'c', period_start: '2026-11-01' }),
      charge({ id: 'd', period_start: '2026-08-01', status: 'paid' }),
      charge({ id: 'e', company_id: 'c2', period_start: '2026-08-01' }),
    ];
    expect(companyDues(list, 'c1', '2026-10-10')).toEqual({ outstanding: 2000, overdue: 1000, oldest: '2026-09-01' });
    expect(isOverdue(list[1], '2026-10-10')).toBe(false);
    expect(isOverdue(list[1], '2026-10-16')).toBe(true);
    expect(isOverdue(list[3], '2027-01-01')).toBe(false);
  });

  it('mrrOf counts started plans of companies not archived', () => {
    const co = (status: BillingCompany['status'], plan: BillingCompany['plan']): BillingCompany => ({ id: status, name: '', status, created_at: '', plan, monthly_fee: null, outstanding: 0, overdue: 0, oldest_due: null });
    const plan = (fee: number, cycle: 'monthly' | 'termly' | 'yearly', starts_on = '2026-01-01') => ({ id: 'p', fee_amount: fee, cycle, starts_on, note: null, created_at: '' });
    expect(mrrOf([co('active', plan(1500, 'monthly')), co('suspended', plan(4000, 'termly')), co('archived', plan(9999, 'monthly')),
      co('active', plan(12000, 'yearly', '2027-01-01')), co('active', null)], '2026-10-10')).toBe(2500);
  });

  it('healthTone', () => {
    expect(healthTone(85).tone).toBe('success');
    expect(healthTone(55).tone).toBe('warning');
    expect(healthTone(10).tone).toBe('danger');
    expect(healthTone(null).tone).toBe('neutral');
  });

  it('periodRange', () => {
    expect(periodRange('30d', '2026-10-10')).toEqual({ from: '2026-09-11', to: null });
    expect(periodRange('month', '2026-10-10')).toEqual({ from: '2026-10-01', to: null });
    expect(periodRange('all', '2026-10-10')).toEqual({ from: null, to: null });
  });

  it('form checks', () => {
    expect(planErrors({ fee: '', cycle: '', startsOn: '' })).toEqual({ fee: expect.any(String), cycle: expect.any(String), startsOn: expect.any(String) });
    expect(planErrors({ fee: 0, cycle: 'monthly', startsOn: '2026-10-01' })).toEqual({});
    expect(planErrors({ fee: 1500, cycle: 'monthly', startsOn: '2026-09-01' }, { starts_on: '2026-09-15' }).startsOn).toBeTruthy();
    expect(expenseErrors({ month: '2026-10', category: 'hosting', amount: 800 })).toEqual({});
    expect(Object.keys(expenseErrors({ month: '', category: '', amount: 0 }))).toEqual(['month', 'category', 'amount']);
  });
});
