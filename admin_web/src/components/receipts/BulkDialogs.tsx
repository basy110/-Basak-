import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Money, Note, RadioCards, TextArea, TextField, countText, errorText, NOUN, num } from '../../ui';
import { isAlreadyDecided, isLastAttempt, listName, rejectionReason, type PendingReceiptRow } from '../../lib/pendingReceipts';
import { runOneByOne, type BulkResult } from '../../lib/receiptsHistory';
import { REJECT_REASONS } from './RejectDialog';

export type BulkMode = 'approve' | 'reject';
const OTHER = 'other';

/** «5 إيصالات», «إيصالان», «إيصال واحد». */
const receiptsText = (n: number) => (n === 1 ? 'إيصال واحد' : countText(n, NOUN.receipt));

/** Up to four names, then «و 3 آخرين». */
const namesText = (rows: readonly PendingReceiptRow[]) => {
  const names = rows.slice(0, 4).map((r) => listName(r.studentName));
  const rest = rows.length - names.length;
  return rest > 0 ? `${names.join('، ')} و${countText(rest, ['آخر', 'آخران', 'آخرين', 'آخرين'])}` : names.join('، ');
};

/**
 * «قبول 5 إيصالات؟» / «رفض 5 إيصالات؟»: how many and how much, then each is decided
 * one after the other through the queue's own path (the same as one receipt),
 * with a progress bar. What did not save is listed at the end with why.
 */
export const BulkDialog: React.FC<{
  mode: BulkMode | null; rows: PendingReceiptRow[]; onClose: () => void;
  /** Decides one receipt; throws when it did not save. */
  act: (row: PendingReceiptRow, reason?: string) => Promise<void>;
  /** Hears the result once the run ends (to clear the selection). */
  onFinished?: (result: BulkResult<PendingReceiptRow>) => void;
  disabled?: boolean;
}> = ({ mode, rows, onClose, act, onFinished, disabled }) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ choice?: string; note?: string }>({});
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<BulkResult<PendingReceiptRow> | null>(null);
  const stopped = useRef(false);
  // The rows as they were when the dialog opened: the queue changes under it while it runs.
  const [batch, setBatch] = useState<PendingReceiptRow[]>([]);
  useEffect(() => {
    if (!mode) return;
    setBatch(rows); setChoice(null); setNote(''); setError({}); setRunning(false); setStep(0); setResult(null); stopped.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  if (!mode) return null;

  const approve = mode === 'approve';
  const n = batch.length;
  const amount = batch.reduce((sum, r) => sum + r.price, 0);
  const last = batch.filter(isLastAttempt).length;
  const ahead = batch.filter((r) => r.periodPhase === 'upcoming').length;
  const other = choice === OTHER;
  const reason = rejectionReason(other ? null : choice, note);

  const start = async () => {
    if (!approve) {
      if (!choice) { setError({ choice: 'اختر سبب الرفض؛ يقرؤه كل طالب في التطبيق.' }); return; }
      if (other && !note.trim()) { setError({ note: 'اكتب السبب كما سيقرؤه الطلاب.' }); return; }
    }
    setRunning(true);
    stopped.current = false;
    const done = await runOneByOne(batch, (row) => act(row, approve ? undefined : reason), (finished) => setStep(finished), () => stopped.current);
    setRunning(false);
    setResult(done);
    onFinished?.(done);
  };
  const close = () => { if (!running) onClose(); };

  // ── The end: what saved and what did not ──
  if (result) {
    const ok = result.done.length;
    const skipped = n - ok - result.failed.length;
    return (
      <Dialog open onClose={onClose} icon={result.failed.length ? 'alert' : 'check'} tone={result.failed.length ? 'warning' : 'success'} w={560}
        title={ok ? `${approve ? 'قُبل' : 'رُفض'} ${receiptsText(ok)}` : `لم ${approve ? 'يُقبل' : 'يُرفض'} أي إيصال`}
        actions={[<Button key="done" onClick={onClose}>تم</Button>]}>
        {ok > 0 && (
          <p className="m-0">{approve
            ? <>مجموعها <Money value={result.done.reduce((s, r) => s + r.price, 0)} />. صار اشتراك كل طالب نشطاً، أو يبدأ في موعده إن كان دفعاً مقدماً.</>
            : 'يرى كل طالب السبب في التطبيق ويستطيع إرسال إيصال جديد.'}</p>
        )}
        {skipped > 0 && <Note tone="neutral" title={`أوقفت قبل ${receiptsText(skipped)}`}>ما زالت في الانتظار كما هي.</Note>}
        {result.failed.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-small font-semibold text-ink">لم {approve ? 'يُقبل' : 'يُرفض'} {receiptsText(result.failed.length)}:</span>
            <ul className="m-0 flex max-h-[220px] list-none flex-col overflow-y-auto rounded-inner bg-ground p-0 [&>li+li]:border-t [&>li+li]:border-hair">
              {result.failed.map(({ item, error: why }) => (
                <li key={item.id} className="flex flex-col px-4 py-2">
                  <span className="text-small font-medium text-ink">{listName(item.studentName)}</span>
                  <span className="text-label text-ink-2">{isAlreadyDecided(why) ? 'قرّر فيه مدير آخر قبلك؛ لم يتغيّر شيء.' : `${errorText(why)} ما زال في الانتظار.`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
    );
  }

  const progress = running && (
    <div className="flex flex-col gap-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-label text-ink-2">
        <span>{approve ? 'جارٍ القبول' : 'جارٍ الرفض'}… لا تغلق الصفحة.</span>
        <span className="tabular" dir="ltr">{num(step)} / {num(n)}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded bg-sunken">
        <div className={`h-2 rounded transition-[width] ${approve ? 'bg-ok' : 'bg-bad'}`} style={{ width: `${n ? Math.round((step / n) * 100) : 0}%` }} />
      </div>
    </div>
  );
  const cancel = running
    ? <Button key="stop" kind="secondary" onClick={() => { stopped.current = true; }}>إيقاف</Button>
    : <Button key="back" kind="secondary" onClick={close}>رجوع</Button>;

  if (approve) {
    return (
      <Dialog open onClose={close} icon="check" tone="success" w={560}
        title={`قبول ${receiptsText(n)}؟`}
        actions={[cancel, <Button key="go" icon="check" loading={running} disabled={disabled || running || n === 0} onClick={() => void start()}>قبول {receiptsText(n)}</Button>]}>
        <div className="flex items-center justify-between gap-4 rounded-inner bg-ok-bg px-4 py-3">
          <span className="text-small font-medium text-ink">{receiptsText(n)} · مجموعها</span>
          <span className="text-[22px] font-semibold leading-8 text-ink"><Money value={amount} unitClass="text-small" /></span>
        </div>
        <p className="m-0">من: {namesText(batch)}.</p>
        <p className="m-0">يصير اشتراك كل طالب نشطاً{ahead ? `، ويبدأ ${countText(ahead, NOUN.student)} في موعده لأنه دفع مقدماً` : ''}. لا تراجع بعد الحفظ، ولا يتغيّر أي إيصال آخر.</p>
        <Note tone="warning" title="تأكد أنك راجعت صورها">القبول الجماعي لا يعرض الصور. إن لم تراجع صورة إيصال فافتحه أولاً.</Note>
        {progress}
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={close} icon="x" tone="danger" w={600}
      title={`رفض ${receiptsText(n)}؟`}
      actions={[cancel, <Button key="go" kind="danger" loading={running} disabled={disabled || running || n === 0} onClick={() => void start()}>رفض {receiptsText(n)}</Button>]}>
      <p className="m-0">من: {namesText(batch)}. سبب واحد للجميع؛ يبقى اشتراك كل منهم «إيصال مرفوض» حتى يرسل إيصالاً جديداً.</p>
      {last > 0 && <Note tone="danger" title={`${last === 1 ? 'طالب واحد' : countText(last, NOUN.student)} في آخر محاولة`}>إن رفضت {last === 1 ? 'إيصاله' : 'إيصالاتهم'} فلن {last === 1 ? 'يستطيع' : 'يستطيعوا'} إرسال إيصال آخر لهذا الاشتراك.</Note>}
      <fieldset disabled={running} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <RadioCards label="سبب الرفض" name="bulk-reject-reason" cols={2} value={choice} error={error.choice}
          onChange={(v) => { setChoice(v); setError({}); }}
          options={[...REJECT_REASONS.map((r) => ({ value: r as string, label: r })), { value: OTHER, label: 'سبب آخر' }]} />
        {other ? (
          <TextArea label="اكتب السبب للطلاب" rows={2} maxLength={300} value={note} error={error.note}
            onChange={(e) => { setNote(e.target.value); setError({}); }} />
        ) : (
          <TextField label="توضيح للطلاب" optional maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </fieldset>
      <div className="flex flex-col gap-1 rounded-inner bg-ground px-4 py-3" aria-live="polite">
        <span className="text-label font-medium text-ink-2">ما سيقرؤه كل طالب في التطبيق</span>
        <span className="text-small text-ink">{reason ? `«رُفض إيصالك: ${reason}.»` : '«رُفض إيصالك: …»'}</span>
      </div>
      {progress}
    </Dialog>
  );
};
