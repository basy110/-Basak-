/**
 * Moves on many students at once (the students list's selection). Each is the very
 * write the student's panel makes for one (runSubscriptionAction, company_remove_student),
 * repeated per student; nothing here is a new server capability.
 */
import { actionsFor, openSubscriptions, type StudentRow, type StudentSubscription } from './students';

export type BulkAction = 'activate' | 'end' | 'cancel' | 'remove';
export interface BulkTarget { student: StudentRow; sub?: StudentSubscription }

/**
 * What a move touches among the chosen students: for a subscription move, each open
 * subscription that offers it (a student with two unpaid terms counts twice); for
 * «إزالة من الشركة», each student once.
 */
export function bulkTargets(students: StudentRow[], action: BulkAction, today: string): BulkTarget[] {
  if (action === 'remove') return students.map((student) => ({ student }));
  return students.flatMap((student) => openSubscriptions(student, today)
    .filter((sub) => actionsFor(sub, today).includes(action))
    .map((sub) => ({ student, sub })));
}

export interface BulkSummary { students: number; subscriptions: number; amount: number; skipped: number }
/** The numbers a confirmation states: how many students and subscriptions, the money, and who is left as is. */
export function bulkSummary(targets: BulkTarget[], chosen: number): BulkSummary {
  const students = new Set(targets.map((t) => t.student.id)).size;
  return {
    students, subscriptions: targets.filter((t) => t.sub).length,
    amount: targets.reduce((n, t) => n + (t.sub ? Number(t.sub.price) || 0 : 0), 0),
    skipped: Math.max(0, chosen - students),
  };
}

export interface EachResult<T> { done: T[]; failed: { item: T; error: unknown }[]; stopped: boolean }

/**
 * Runs `work` for every item, a few at a time, reporting after each one. A failure is
 * recorded and the rest go on; `stop()` answering true lets the running ones finish
 * and starts no more.
 */
export async function runEach<T>(items: T[], work: (item: T) => Promise<void>, o: { concurrency?: number; stop?: () => boolean; onProgress?: (finished: number) => void } = {}): Promise<EachResult<T>> {
  const done: T[] = []; const failed: { item: T; error: unknown }[] = [];
  let next = 0; let stopped = false;
  const lane = async () => {
    while (next < items.length) {
      if (o.stop?.()) { stopped = true; return; }
      const item = items[next++];
      try { await work(item); done.push(item); } catch (error) { failed.push({ item, error }); }
      o.onProgress?.(done.length + failed.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 3, items.length)) }, lane));
  return { done, failed, stopped: stopped && done.length + failed.length < items.length };
}
