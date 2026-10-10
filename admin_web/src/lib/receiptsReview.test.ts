import { describe, expect, it } from 'vitest';
import {
  attemptsLeftText, createHoldQueue, filterReceipts, isAlreadyDecided, isLastAttempt, lineCounts, listName, rejectionReason, shortName,
  toPendingRow, type HoldTimers, type ReceiptAnswerRow,
} from './pendingReceipts';

/** Timers the test moves by hand. */
function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const timers: HoldTimers = {
    set: (run, ms) => { const id = next++; pending.set(id, { at: now + ms, run }); return id; },
    clear: (handle) => { pending.delete(handle as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    [...pending].filter(([, t]) => t.at <= now).forEach(([id, t]) => { pending.delete(id); t.run(); });
  };
  return { timers, advance, count: () => pending.size };
}

describe('an approval held back for its «تراجع»', () => {
  it('is sent once, when its time comes', () => {
    const sent: string[] = [];
    const t = fakeTimers();
    const queue = createHoldQueue<number>((id) => sent.push(id), 6000, t.timers);
    expect(queue.hold('a', 1)).toBe(true);
    t.advance(5999);
    expect(sent).toEqual([]);
    t.advance(1);
    expect(sent).toEqual(['a']);
    t.advance(10_000);
    expect(sent).toEqual(['a']);
    expect(queue.size).toBe(0);
  });
  it('taken back in time is never sent, and gives back what was held', () => {
    const sent: string[] = [];
    const t = fakeTimers();
    const queue = createHoldQueue<string>((id) => sent.push(id), 6000, t.timers);
    queue.hold('a', 'row a');
    t.advance(3000);
    expect(queue.undo('a')).toBe('row a');
    t.advance(10_000);
    expect(sent).toEqual([]);
    expect(t.count()).toBe(0);
  });
  it('cannot be taken back once sent', () => {
    const t = fakeTimers();
    const queue = createHoldQueue<number>(() => undefined, 6000, t.timers);
    queue.hold('a', 1);
    t.advance(6000);
    expect(queue.undo('a')).toBeNull();
  });
  it('goes at once when the page closes or the tab is hidden, each one once', () => {
    const sent: string[] = [];
    const t = fakeTimers();
    const queue = createHoldQueue<number>((id) => sent.push(id), 6000, t.timers);
    queue.hold('a', 1);
    queue.hold('b', 2);
    queue.flush();
    expect(sent).toEqual(['a', 'b']);
    t.advance(10_000);
    queue.flush();
    expect(sent).toEqual(['a', 'b']);
  });
  it('is not held twice for the same receipt', () => {
    const t = fakeTimers();
    const queue = createHoldQueue<number>(() => undefined, 6000, t.timers);
    expect(queue.hold('a', 1)).toBe(true);
    expect(queue.hold('a', 2)).toBe(false);
    expect(queue.undo('a')).toBe(1);
  });
});

const answer = (patch: Partial<ReceiptAnswerRow>): ReceiptAnswerRow => ({
  id: 'r1', image_url: 'a/b.jpg', attempt_number: 1, created_at: '2026-10-01T08:00:00Z', amount: 4500,
  subscription_id: 's1', student_id: 'st1', student_name: 'منة الله إبراهيم عبد الرازق', student_phone: '01023456780',
  university: 'جامعة دمياط', college: 'التجارة', company_id: 'c1', company_name: 'النورس', line_name: 'الزرقا',
  station_name: 'كوبري الزرقا', departure_time: '07:00:00', return_time: '15:00:00', subscription_type: 'termly',
  period_label: 'الفصل الأول 2026/2027', period_start: '2026-09-19', period_end: '2027-01-14', period_phase: 'current', price: 4500,
  ...patch,
});
const rows = [
  toPendingRow(answer({ id: '1', line_name: 'الزرقا' })),
  toPendingRow(answer({ id: '2', line_name: 'دمياط الجديدة', student_name: 'عمر خالد إسماعيل', student_phone: '01067890124' })),
  toPendingRow(answer({ id: '3', line_name: 'دمياط الجديدة', student_name: 'آية مصطفى كامل' })),
];

describe('the queue as the review page shows it', () => {
  it('counts receipts per line, the busiest first', () => {
    expect(lineCounts(rows)).toEqual([{ line: 'دمياط الجديدة', count: 2 }, { line: 'الزرقا', count: 1 }]);
  });
  it('finds a student by name whatever form of alef is typed, or by part of the phone', () => {
    expect(filterReceipts(rows, 'ايه', null).map((r) => r.id)).toEqual(['3']);
    expect(filterReceipts(rows, '6789', null).map((r) => r.id)).toEqual(['2']);
    expect(filterReceipts(rows, '010 6789', null).map((r) => r.id)).toEqual(['2']);
    expect(filterReceipts(rows, '', 'دمياط الجديدة').map((r) => r.id)).toEqual(['2', '3']);
    expect(filterReceipts(rows, 'منة', 'دمياط الجديدة')).toEqual([]);
  });
  it('marks the fifth try as the last', () => {
    expect(isLastAttempt({ attemptNumber: 4 })).toBe(false);
    expect(isLastAttempt({ attemptNumber: 5 })).toBe(true);
  });
  it('shortens a name to its first two names, keeping compound names whole', () => {
    expect(shortName('منة الله إبراهيم عبد الرازق')).toBe('منة الله إبراهيم');
    expect(shortName('عبد الرحمن محمد السيد الشربيني')).toBe('عبد الرحمن محمد');
    expect(shortName('سلمى طارق عبد الحميد سالم')).toBe('سلمى طارق');
    expect(shortName('ملك حسام الدين مصطفى')).toBe('ملك حسام الدين');
    expect(shortName('زياد')).toBe('زياد');
  });
  it('names a receipt in the queue with up to three names, as the board does', () => {
    expect(listName('منة الله إبراهيم عبد الرازق')).toBe('منة الله إبراهيم');
    expect(listName('عمر خالد إسماعيل البنا')).toBe('عمر خالد إسماعيل');
    expect(listName('نورهان محمود عبد العزيز شلبي')).toBe('نورهان محمود');
    expect(listName('زياد عمرو حسن البدراوي')).toBe('زياد عمرو حسن');
    expect(listName('مصطفى ياسر عبد الهادي زهران')).toBe('مصطفى ياسر');
  });
});

describe('a rejection as the student reads it', () => {
  it('joins the chosen reason and the admin’s words with one stop', () => {
    expect(rejectionReason('المبلغ أقل من المطلوب', 'المحوَّل 4,000 والمطلوب 4,500')).toBe('المبلغ أقل من المطلوب. المحوَّل 4,000 والمطلوب 4,500');
    expect(rejectionReason('الصورة غير واضحة', '  ')).toBe('الصورة غير واضحة');
    expect(rejectionReason(null, 'الاسم في التحويل ليس اسمك.')).toBe('الاسم في التحويل ليس اسمك');
  });
  it('says how many tries are left', () => {
    expect(attemptsLeftText(2)).toBe('يمكنك إرسال إيصال جديد. بقيت لك 3 محاولات.');
    expect(attemptsLeftText(3)).toBe('يمكنك إرسال إيصال جديد. بقيت لك محاولتان.');
    expect(attemptsLeftText(4)).toBe('يمكنك إرسال إيصال جديد. بقيت لك محاولة واحدة.');
    expect(attemptsLeftText(5)).toBe('لا يمكنك إرسال إيصال آخر لهذا الاشتراك.');
  });
  it('recognises a receipt another admin decided first', () => {
    expect(isAlreadyDecided(new Error('هذا الإيصال لم يعد قيد المراجعة.'))).toBe(true);
    expect(isAlreadyDecided(new Error('Failed to fetch'))).toBe(false);
  });
});
