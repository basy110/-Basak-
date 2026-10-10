import React, { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Note, errorText, num, type IconName, type Tone } from '../ui';
import { useGuard } from '../lib/guard';
import { notifyDone, notifyError } from '../lib/toasts';

export interface BulkFailure { label: string; error: string }

/**
 * One action applied to several chosen rows (select all → «ألغِ الطلبات»…).
 * First the question with the exact count and what happens; then the same write
 * the single action makes, row by row, with a progress bar; then what was done and
 * which rows the server refused, with its reason. Nothing is retried silently.
 *
 * `check` may refuse to start (e.g. a reason left empty): a sentence is shown above the
 * buttons; `true` refuses quietly (the field under which the page shows its own error).
 */
export function BulkDialog<T>({
  open, onClose, items, labelOf, run, onFinished, title, icon, tone = 'teal', confirmLabel, danger, check, doneText, children, disabled,
}: {
  open: boolean; onClose: () => void;
  items: T[]; labelOf: (item: T) => string;
  /** The single action's write for one row; throws on a refusal. */
  run: (item: T) => Promise<void>;
  /** After the last row: how many were done (the selection is usually cleared here). */
  onFinished?: (done: T[], failed: BulkFailure[]) => void;
  title: React.ReactNode; icon?: IconName; tone?: Tone; confirmLabel: string; danger?: boolean;
  check?: () => string | boolean | null;
  /** «أُلغي 12 طلباً.» */
  doneText: (done: number) => string;
  children: React.ReactNode; disabled?: boolean;
}) {
  const guard = useGuard();
  const [stage, setStage] = useState<'ask' | 'running' | 'done'>('ask');
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<BulkFailure[]>([]);
  const [problem, setProblem] = useState('');
  const stop = useRef(false);
  useEffect(() => { if (open) { setStage('ask'); setProgress(0); setDone(0); setFailed([]); setProblem(''); } }, [open]);

  const start = () => {
    const why = check?.() ?? null;
    if (why) { if (typeof why === 'string') setProblem(why); return; }
    void guard('bulk', async () => {
      stop.current = false; setStage('running');
      const ok: T[] = []; const bad: BulkFailure[] = [];
      for (const item of items) {
        if (stop.current) break;
        try { await run(item); ok.push(item); } catch (e) { bad.push({ label: labelOf(item), error: errorText(e) }); }
        setProgress(ok.length + bad.length); setDone(ok.length); setFailed([...bad]);
      }
      setStage('done');
      onFinished?.(ok, bad);
    });
  };
  const close = () => { if (stage === 'running') { stop.current = true; return; } onClose(); };

  const total = items.length;
  const pct = total ? Math.round((progress / total) * 100) : 0;
  const back = <Button key="b" kind="secondary" onClick={close}>رجوع</Button>;
  const actions = stage === 'ask'
    ? [back, <Button key="c" kind={danger ? 'danger' : 'primary'} disabled={disabled || total === 0} onClick={start}>{confirmLabel}</Button>]
    : stage === 'running'
      ? [<Button key="s" kind="secondary" onClick={() => { stop.current = true; }}>أوقف بعد الصف الحالي</Button>]
      : [<Button key="d" onClick={onClose}>تم</Button>];

  return (
    <Dialog open={open} onClose={close} title={title} icon={icon} tone={tone} actions={actions} w={520}>
      {stage === 'ask' ? (
        <>
          {children}
          {problem && <Note tone="danger">{problem}</Note>}
        </>
      ) : (
        <>
          <div className="rounded-inner bg-ground p-3.5">
            <div className="mb-2 flex items-center justify-between text-small font-semibold text-ink">
              <span>{stage === 'running' ? `جارٍ التنفيذ… ${num(progress)} من ${num(total)}` : doneText(done)}</span>
              <span className="tabular text-teal">{num(stage === 'done' ? 100 : pct)}٪</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${stage === 'done' ? 100 : pct}%` }} />
            </div>
          </div>
          {stage === 'done' && done + failed.length < total && (
            <Note tone="warning">أوقفته قبل آخره: {num(total - done - failed.length)} لم يُنفَّذ عليها شيء.</Note>
          )}
          {failed.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-small font-semibold text-ink">رفضها الخادم ({num(failed.length)})</div>
              <ul className="m-0 flex max-h-56 list-none flex-col divide-y divide-hair overflow-y-auto rounded-inner p-0 ring-1 ring-hair">
                {failed.map((f, i) => (
                  <li key={`${i}-${f.label}`} className="px-3 py-2"><span className="block truncate text-small font-semibold text-ink">{f.label}</span><span className="block text-label text-ink-2">{f.error}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** «تصدير المحدد» inside the teal bulk bar: builds the file of the chosen rows. */
export const BulkExportButton: React.FC<{ count: number; onExport: () => Promise<void>; label?: string }> = ({ count, onExport, label = 'تصدير المحدد' }) => {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await onExport(); notifyDone(`صُدّر ${num(count)} صفاً إلى ملف Excel.`); } catch (e) { notifyError('لم يُصدَّر الملف', errorText(e)); }
    setBusy(false);
  };
  return <Button sm kind="secondary" icon="download" loading={busy} disabled={count === 0} onClick={() => void go()}>{label}</Button>;
};
