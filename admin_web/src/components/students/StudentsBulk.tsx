import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Feedback';
import type { IconName } from '../../ui/Icon';
import { Dialog } from '../../ui/Overlay';
import { Money, type Tone } from '../../ui/Status';
import { countText, errorText, NOUN, num } from '../../ui/format';
import { supabase } from '../../lib/supabase';
import { keys, refreshIfNotUpdated } from '../../lib/query';
import { forgetApplied, rememberApplied } from '../../lib/recentChanges';
import { notifyDone, notifyError } from '../../lib/toasts';
import { useGuard } from '../../lib/guard';
import { runSubscriptionAction, shortName, subscriptionPatch, withoutStudent, withSubscription, type StudentRow } from '../../lib/students';
import { bulkSummary, bulkTargets, runEach, type BulkAction, type BulkTarget } from '../../lib/studentsBulk';

const SUBS: [string, string, string, string] = ['اشتراك', 'اشتراكان', 'اشتراكات', 'اشتراكاً'];
/** «طالب واحد», «طالبان», «5 طلاب», «12 طالباً». */
const studentsText = (n: number) => (n === 1 ? 'طالب واحد' : countText(n, NOUN.student));
const subsText = (n: number) => (n === 1 ? 'اشتراك واحد' : countText(n, SUBS));

/** The bulk bar's buttons and their dialogs. */
export const BULK: Record<BulkAction, { label: string; icon: IconName; tone: Tone; kind: 'primary' | 'danger'; confirm: string; running: string; none: string }> = {
  activate: { label: 'تفعيل بعد دفع نقدي', icon: 'check', tone: 'success', kind: 'primary', confirm: 'تفعيل الاشتراكات', running: 'جارٍ التفعيل', none: 'لا اشتراك ينتظر الدفع بين المحددين.' },
  end: { label: 'إنهاء الاشتراك', icon: 'power', tone: 'danger', kind: 'danger', confirm: 'إنهاء الاشتراكات', running: 'جارٍ الإنهاء', none: 'لا اشتراك نشط بين المحددين.' },
  cancel: { label: 'إلغاء غير المدفوع', icon: 'x', tone: 'danger', kind: 'danger', confirm: 'إلغاء الاشتراكات', running: 'جارٍ الإلغاء', none: 'لا اشتراك ينتظر الدفع بين المحددين.' },
  remove: { label: 'إزالة من الشركة', icon: 'trash', tone: 'danger', kind: 'danger', confirm: 'إزالة من الشركة', running: 'جارٍ الإزالة', none: '' },
};
export const BULK_ORDER: BulkAction[] = ['activate', 'end', 'cancel', 'remove'];

/** Every students list on screen (the page's lists and the single row from the top bar). */
const isList = (data: unknown): data is { rows: StudentRow[] } => !!data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows);

interface Failure { name: string; error: string }

/**
 * The confirmation of one move for the chosen students: who and how many it touches,
 * what it does to money, who is left as is. Then the student panel's own write for
 * each, a few at a time, with progress; refusals are listed by name at the end.
 */
export const BulkDialog: React.FC<{
  action: BulkAction | null; students: StudentRow[]; company: { id: string; name: string }; today: string;
  onClose: () => void;
  /** After a run: the students whose every change went through (to unselect them). */
  onDone: (doneIds: string[]) => void;
}> = ({ action, students, company, today, onClose, onDone }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const [stage, setStage] = useState<'ask' | 'running' | 'done'>('ask');
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [finished, setFinished] = useState(0);
  const stop = useRef(false);
  // What a run works on, fixed when it starts (the rows on screen change as it goes).
  const [frozen, setFrozen] = useState<BulkTarget[] | null>(null);
  useEffect(() => { if (action) { setStage('ask'); setProgress(0); setFailures([]); setFinished(0); setFrozen(null); stop.current = false; } }, [action]);

  const live = useMemo(() => (action ? bulkTargets(students, action, today) : []), [action, students, today]);
  const targets = frozen ?? live;
  if (!action) return null;
  const b = BULK[action];
  const sum = bulkSummary(targets, students.length);
  const studentsKey = keys.company(company.id, 'students');
  const edit = (change: <P extends { rows: StudentRow[] }>(page: P | undefined) => P | undefined) =>
    client.setQueriesData({ queryKey: studentsKey, predicate: (q) => isList(q.state.data) }, (data: unknown) => (isList(data) ? change(data) : data));

  // The same write, cache edit and «applied» mark as StudentPanel's act() and remove().
  const one = async ({ student, sub }: BulkTarget) => {
    if (action === 'remove') {
      const { error } = await supabase.rpc('company_remove_student', { p_company_id: company.id, p_student_id: student.id });
      if (error) throw new Error(error.message);
      edit((page) => withoutStudent(page, student.id));
      return;
    }
    rememberApplied([sub!.id], ['students']);
    try {
      const answer = await runSubscriptionAction(sub!.id, action);
      edit((page) => withSubscription(page, sub!.id, subscriptionPatch(answer, today)));
    } catch (e) { forgetApplied([sub!.id]); throw e; }
  };

  const run = () => guard('bulk', async () => {
    stop.current = false; setFrozen(targets); setStage('running'); setProgress(0);
    const res = await runEach(targets, one, { concurrency: 3, stop: () => stop.current, onProgress: setProgress });
    refreshIfNotUpdated(studentsKey);
    const failedIds = new Set(res.failed.map((f) => f.item.student.id));
    const doneIds = [...new Set(res.done.map((t) => t.student.id))].filter((id) => !failedIds.has(id));
    setFinished(res.done.length);
    setFailures(res.failed.map((f) => ({ name: f.item.student.full_name, error: errorText(f.error) })));
    setStage('done');
    onDone(doneIds);
    if (res.done.length) notifyDone(doneText(res.done.length), res.failed.length ? `ولم يتم ${num(res.failed.length)}. التفاصيل في النافذة.` : undefined);
    else if (res.failed.length) notifyError('لم يتغيّر شيء', 'رُفضت كل الطلبات. التفاصيل في النافذة.');
  });

  function doneText(count: number) {
    return `${{ activate: 'فُعّل', end: 'أُنهي', cancel: 'أُلغي', remove: 'أُزيل' }[action!]} ${action === 'remove' ? studentsText(count) : subsText(count)}`;
  }
  const close = () => { if (stage === 'running') { stop.current = true; return; } onClose(); };
  const n = sum.students;
  const title = {
    activate: `تفعيل اشتراكات ${studentsText(n)} بعد دفع نقدي؟`,
    end: `إنهاء اشتراكات ${studentsText(n)}؟`,
    cancel: `إلغاء الاشتراكات غير المدفوعة لـ ${studentsText(n)}؟`,
    remove: `إزالة ${studentsText(n)} من ${company.name}؟`,
  }[action];
  const money = <b className="font-semibold text-ink"><Money value={sum.amount} /></b>;
  const body = {
    activate: <><p className="m-0">يُفعَّل {subsText(sum.subscriptions)} الآن، ويركب الطلاب بها من الغد.</p>
      <p className="m-0">يُحسب {money} ضمن إيرادات الشركة كأنه دُفع، ولا يُطلب منهم إيصال. تأكد أنك استلمت المبالغ كلها.</p></>,
    end: <><p className="m-0">يُنهى {subsText(sum.subscriptions)} اليوم، ولا يركب بها أصحابها بعد الآن.</p>
      <p className="m-0">لا يُردّ شيء من هنا، ويبقى ما دفعوه ({money}) في الإيرادات. يستطيعون الاشتراك من جديد.</p></>,
    cancel: <p className="m-0">يُلغى {subsText(sum.subscriptions)} لم يُدفع بعد ({money})، فيصير «منتهٍ» ولا يستطيع أصحابه دفعه. يبقى الطلاب في شركتك ويستطيعون الاشتراك من جديد.</p>,
    remove: <><p className="m-0">تنتهي اشتراكاتهم المفتوحة مع الشركة ولا يظهرون في قوائمها.</p>
      <p className="m-0">تبقى حساباتهم في التطبيق كما هي، وتبقى الإيرادات المسجلة في تقارير الشركة. من أردت إعادته فأضفه من جديد وسيصله طلب انضمام.</p></>,
  }[action];
  const names = [...new Set(targets.map((t) => t.student.id))].slice(0, 3).map((id) => shortName(targets.find((t) => t.student.id === id)!.student.full_name));

  const pct = targets.length ? Math.round((progress / targets.length) * 100) : 0;
  const actions = stage === 'ask'
    ? [<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>,
      <Button key="o" kind={b.kind} icon={b.icon} disabled={!targets.length} onClick={() => void run()}>{b.confirm}{targets.length ? ` (${num(action === 'remove' ? n : sum.subscriptions)})` : ''}</Button>]
    : stage === 'running'
      ? [<Button key="s" kind="secondary" onClick={() => { stop.current = true; }}>أوقف بعد الحالي</Button>]
      : [<Button key="d" onClick={onClose}>تم</Button>];

  return (
    <Dialog open onClose={close} title={stage === 'ask' ? title : stage === 'running' ? `${b.running}…` : failures.length ? (finished ? `${doneText(finished)}، وبعضها لم يتم` : 'لم يتغيّر شيء') : finished ? doneText(finished) : 'لم يتغيّر شيء'}
      icon={stage === 'done' ? (failures.length ? 'alert' : 'check') : b.icon} tone={stage === 'done' ? (failures.length ? 'warning' : 'success') : b.tone} w={520} actions={actions}>
      {stage === 'ask' && (targets.length ? (
        <>
          {body}
          <p className="m-0 text-label">منهم: {names.join('، ')}{n > names.length ? ` و${n - names.length === 1 ? 'واحد آخر' : `${num(n - names.length)} آخرون`}` : ''}.</p>
          {sum.skipped > 0 && <Note tone="neutral">{studentsText(sum.skipped)} من المحددين لا ينطبق عليهم هذا، فلن يتغيّر لهم شيء.</Note>}
        </>
      ) : <p className="m-0">{b.none} لن يتغيّر شيء.</p>)}
      {stage !== 'ask' && (
        <div className="rounded-inner bg-ground p-4 text-ink">
          <div className="mb-2 flex items-center justify-between text-small font-semibold">
            <span>{stage === 'running' ? `${num(progress)} من ${num(targets.length)}` : `تم ${num(finished)} من ${num(targets.length)}`}</span>
            <span className="tabular text-teal">{num(stage === 'done' ? Math.round(((finished + failures.length) / Math.max(1, targets.length)) * 100) : pct)}٪</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${stage === 'done' ? Math.round(((finished + failures.length) / Math.max(1, targets.length)) * 100) : pct}%` }} /></div>
        </div>
      )}
      {stage === 'done' && finished + failures.length < targets.length && <Note tone="warning">أوقفت قبل النهاية: {num(targets.length - finished - failures.length)} لم تُرسل.</Note>}
      {stage === 'done' && failures.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-card text-ink">لم يتم ({num(failures.length)})</h3>
          <ul className="m-0 flex max-h-56 list-none flex-col divide-y divide-hair overflow-y-auto rounded-inner bg-surface p-0 ring-1 ring-hair">
            {failures.map((f, i) => (
              <li key={i} className="px-3 py-2"><span className="block text-small font-semibold text-ink">{f.name}</span><span className="block text-label">{f.error}</span></li>
            ))}
          </ul>
          <p className="m-0 text-label">بقي هؤلاء محددين لتحاول مرة أخرى أو تفتح كلاً منهم.</p>
        </div>
      )}
    </Dialog>
  );
};
