import { describe, expect, it } from 'vitest';
import { bulkSummary, bulkTargets, runEach } from './studentsBulk';
import type { StudentRow, StudentSubscription } from './students';

const TODAY = '2026-10-10';
const sub = (id: string, patch: Partial<StudentSubscription>): StudentSubscription => ({
  id, status: 'active', type: 'termly', price: 4200, created_at: '2026-09-01T08:00:00Z', start_date: '2026-09-19', end_date: '2027-01-14',
  period_label: 'الفصل الأول 2026/2027', period_phase: 'current', departure_time: '07:15:00', return_time: null,
  line_name: 'فارسكور', trip_label: null, trip_university: null, ...patch,
});
const student = (id: string, subs: StudentSubscription[]): StudentRow => ({
  id, phone: '01000000000', full_name: 'طالب', university: '', college: '', profile_image_url: null, created_at: '2026-09-01T08:00:00Z', subscriptions: subs,
});

const A = student('a', [sub('a1', { status: 'pending_payment' }), sub('a2', { status: 'pending_payment', start_date: '2027-02-06', end_date: '2027-06-10', price: 3900 })]);
const B = student('b', [sub('b1', { status: 'active' })]);
const C = student('c', [sub('c1', { status: 'pending_review' })]);
const D = student('d', [sub('d1', { status: 'expired', end_date: '2026-06-10' })]);
const E = student('e', []);
const ALL = [A, B, C, D, E];

describe('what a move touches among the chosen', () => {
  it('activate and cancel: every unpaid open subscription', () => {
    expect(bulkTargets(ALL, 'activate', TODAY).map((t) => t.sub!.id)).toEqual(['a1', 'a2']);
    expect(bulkTargets(ALL, 'cancel', TODAY).map((t) => t.sub!.id)).toEqual(['a1', 'a2']);
  });
  it('end: the active ones; a receipt under review and past terms are left alone', () => {
    expect(bulkTargets(ALL, 'end', TODAY).map((t) => t.sub!.id)).toEqual(['b1']);
  });
  it('remove: each student once', () => {
    expect(bulkTargets(ALL, 'remove', TODAY).map((t) => t.student.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('the confirmation numbers', () => {
    expect(bulkSummary(bulkTargets(ALL, 'activate', TODAY), ALL.length)).toEqual({ students: 1, subscriptions: 2, amount: 8100, skipped: 4 });
    expect(bulkSummary(bulkTargets(ALL, 'remove', TODAY), ALL.length)).toEqual({ students: 5, subscriptions: 0, amount: 0, skipped: 0 });
  });
});

describe('running a move for many', () => {
  it('keeps going past a failure and reports each', async () => {
    const seen: number[] = [];
    const res = await runEach([1, 2, 3, 4, 5], async (n) => { if (n === 3) throw new Error('no'); }, { concurrency: 2, onProgress: (f) => seen.push(f) });
    expect(res.done.sort()).toEqual([1, 2, 4, 5]);
    expect(res.failed.map((f) => f.item)).toEqual([3]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(res.stopped).toBe(false);
  });
  it('stops starting new ones when asked', async () => {
    let stop = false;
    const res = await runEach([1, 2, 3, 4], async (n) => { if (n === 2) stop = true; }, { concurrency: 1, stop: () => stop });
    expect(res.done).toEqual([1, 2]);
    expect(res.stopped).toBe(true);
  });
});
