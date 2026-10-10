import { describe, expect, it } from 'vitest';
import { answerFrom, rangeDays, runOneByOne, toHistoryPage, toHistoryRow, type HistoryAnswerRow } from './receiptsHistory';

const row = (id: string, over: Partial<HistoryAnswerRow> = {}): HistoryAnswerRow => ({
  id, status: 'approved', amount: 4500, reviewed_at: '2026-10-09T10:00:00Z', created_at: '2026-10-09T08:00:00Z',
  reviewer_name: 'مدير الشركة', rejection_reason: null, attempt_number: 1, image_url: 'c/s/r.jpg', payment_method: 'InstaPay',
  subscription_id: `s-${id}`, student_id: `st-${id}`, student_name: 'منة الله إبراهيم', student_phone: '01023456780',
  line_id: 'l1', line_name: 'الزرقا', station_name: 'كوبري الزرقا', period_label: 'الفصل الأول', period_start: '2026-09-19', period_end: '2027-01-14',
  ...over,
});

describe('the history date presets', () => {
  it('cover the right Cairo days, both ends included', () => {
    expect(rangeDays('today', '2026-10-10')).toEqual({ from: '2026-10-10', to: '2026-10-10' });
    expect(rangeDays('week', '2026-10-10')).toEqual({ from: '2026-10-04', to: '2026-10-10' });
    expect(rangeDays('month', '2026-10-10')).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(rangeDays('all', '2026-10-10')).toEqual({ from: null, to: null });
  });
});

describe('a history row', () => {
  it('keeps the outcome, the reason and who decided; fills what is missing', () => {
    const r = toHistoryRow(row('a', { status: 'rejected', rejection_reason: ' الصورة غير واضحة ', student_name: null, amount: '4200.00', image_url: 'receipts/c/s/r.jpg' }));
    expect(r.status).toBe('rejected');
    expect(r.rejectionReason).toBe('الصورة غير واضحة');
    expect(r.studentName).toBe('بيانات الطالب غير متاحة');
    expect(r.amount).toBe(4200);
    expect(r.imagePath).toBe('c/s/r.jpg');
    expect(r.reviewerName).toBe('مدير الشركة');
  });
  it('an empty answer is an empty page', () => {
    expect(toHistoryPage(null)).toEqual({ rows: [], total: 0, counts: { approved: 0, rejected: 0 }, approvedAmount: 0, lines: [] });
  });
});

describe('the older way answers like the server function', () => {
  const rows = [
    row('a'),
    row('b', { status: 'rejected', amount: 9000, student_name: 'عمر خالد', student_phone: '01067890124', line_id: 'l2', line_name: 'شربين' }),
    row('c', { amount: 4200, student_name: 'نورهان محمود', line_id: 'l2', line_name: 'شربين' }),
  ];
  it('counts both outcomes whatever outcome is chosen, and sums the accepted', () => {
    const a = answerFrom(rows, { outcome: 'rejected', search: '', lineId: null }, 25, 0);
    expect(a.total).toBe(1);
    expect(a.rows.map((r) => r.id)).toEqual(['b']);
    expect(a.counts).toEqual({ approved: 2, rejected: 1 });
    expect(a.approved_amount).toBe(8700);
    expect(a.lines).toEqual([{ line_id: 'l2', line_name: 'شربين', count: 1 }]);
  });
  it('searches names without the letter forms, and phones by 3+ digits', () => {
    expect(answerFrom(rows, { outcome: null, search: 'منه الله', lineId: null }, 25, 0).rows.map((r) => r.id)).toEqual(['a']);
    expect(answerFrom(rows, { outcome: null, search: '7890', lineId: null }, 25, 0).rows.map((r) => r.id)).toEqual(['b']);
  });
  it('filters by line and pages', () => {
    const a = answerFrom(rows, { outcome: null, search: '', lineId: 'l2' }, 1, 1);
    expect(a.total).toBe(2);
    expect(a.rows.map((r) => r.id)).toEqual(['c']);
    expect(a.lines.map((l) => [l.line_id, l.count])).toEqual([['l2', 2], ['l1', 1]]);
  });
});

describe('bulk decisions', () => {
  it('run one at a time, keep failures and go on', async () => {
    let running = 0; let most = 0;
    const steps: number[] = [];
    const result = await runOneByOne(['a', 'b', 'c'], async (id) => {
      running += 1; most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      if (id === 'b') throw new Error('هذا الإيصال لم يعد قيد المراجعة.');
    }, (n) => steps.push(n));
    expect(most).toBe(1);
    expect(result.done).toEqual(['a', 'c']);
    expect(result.failed.map((f) => f.item)).toEqual(['b']);
    expect(steps).toEqual([1, 2, 3]);
  });
  it('stop ends the run before the next one', async () => {
    const seen: string[] = [];
    const result = await runOneByOne(['a', 'b', 'c'], async (id) => { seen.push(id); }, undefined, () => seen.length >= 2);
    expect(seen).toEqual(['a', 'b']);
    expect(result.done).toEqual(['a', 'b']);
  });
});
