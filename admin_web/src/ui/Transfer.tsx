import React, { useRef, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Note } from './Feedback';
import { SidePanel } from './Overlay';
import { errorText, num } from './format';
import { notifyDone, notifyError } from '../lib/toasts';
import { exportTemplate, MAX_IMPORT_ROWS, matchColumns, readSheet, type CellValue } from '../lib/excel';

/**
 * «تصدير Excel»: runs `onExport` (which builds and downloads the file), shows it is
 * busy meanwhile and says so if it fails. `count` is what will be exported.
 */
export const ExportButton: React.FC<{ onExport: () => Promise<void>; count?: number; label?: string; sm?: boolean; disabled?: boolean; className?: string }> = ({
  onExport, count, label = 'تصدير Excel', sm = true, disabled, className,
}) => {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onExport();
      notifyDone(count != null ? `صُدّر ${num(count)} صفاً إلى ملف Excel.` : 'صُدّر الملف.');
    } catch (e) { notifyError('لم يُصدَّر الملف', errorText(e)); }
    setBusy(false);
  };
  return (
    <Button sm={sm} kind="tonal" icon="download" loading={busy} disabled={disabled || count === 0} onClick={() => void run()} className={className}>
      {label}
    </Button>
  );
};

export interface ImportField<K extends string = string> {
  key: K;
  /** The column's title in the template. */
  label: string;
  /** Other titles the column may carry in an admin's own file. */
  aliases?: string[];
  required?: boolean;
  /** An example value for the template's sample row. */
  example?: CellValue;
}

export type ImportCheck<T> = { ok: true; value: T; label: string } | { ok: false; error: string; label: string };

interface Problem { row: number; label: string; error: string }

/**
 * «استيراد من Excel» in one side panel: download the template, pick a file, see
 * which rows are ready and which have a problem (with the row's number in the
 * file), then add the ready ones one by one with a progress bar. Rows the server
 * refuses are listed at the end with its reason; nothing is retried silently.
 */
export function ImportPanel<K extends string, T>({
  open, onClose, title, what, fields, templateName, note, check, importOne, onFinished,
}: {
  open: boolean; onClose: () => void; title: string;
  /** The noun for one row, e.g. «طالب». */
  what: string;
  fields: ImportField<K>[]; templateName: string; note?: React.ReactNode;
  /** Validates one row of the file (index is the row's number in the file). */
  check: (row: Record<K, string>, index: number, all: Record<K, string>[]) => ImportCheck<T>;
  importOne: (item: T) => Promise<void>;
  onFinished?: (added: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);
  const [ready, setReady] = useState<{ row: number; label: string; value: T }[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [readError, setReadError] = useState('');
  const [stage, setStage] = useState<'pick' | 'review' | 'running' | 'done'>('pick');
  const [progress, setProgress] = useState({ done: 0, failed: [] as Problem[] });
  const stop = useRef(false);

  const reset = () => { setFile(null); setReady([]); setProblems([]); setReadError(''); setStage('pick'); setProgress({ done: 0, failed: [] }); if (input.current) input.current.value = ''; };
  const close = () => { if (stage === 'running') { stop.current = true; return; } reset(); onClose(); };

  const load = async (f: File) => {
    setReadError(''); setFile(f.name);
    try {
      const rows = await readSheet(f);
      if (rows.length < 2) { setReadError('الملف فارغ: لا صفوف تحت صف العناوين.'); return; }
      if (rows.length - 1 > MAX_IMPORT_ROWS) { setReadError(`الملف فيه ${num(rows.length - 1)} صفاً، والحد ${num(MAX_IMPORT_ROWS)} في المرة الواحدة. قسّمه إلى أكثر من ملف.`); return; }
      const cols = matchColumns(rows[0], Object.fromEntries(fields.map((f2) => [f2.key, [f2.label, ...(f2.aliases ?? [])]])) as Record<K, string[]>);
      const missing = fields.filter((f2) => f2.required && cols[f2.key] < 0).map((f2) => `«${f2.label}»`);
      if (missing.length) { setReadError(`لم نجد عمود ${missing.join(' و')} في الصف الأول. نزّل القالب وانسخ بياناتك إليه.`); return; }
      const records = rows.slice(1).map((r) => Object.fromEntries(fields.map((f2) => [f2.key, cols[f2.key] >= 0 ? r[cols[f2.key]] ?? '' : ''])) as Record<K, string>);
      const ok: typeof ready = []; const bad: Problem[] = [];
      records.forEach((rec, i) => {
        const res = check(rec, i + 2, records);
        if (res.ok) ok.push({ row: i + 2, label: res.label, value: res.value }); else bad.push({ row: i + 2, label: res.label, error: res.error });
      });
      setReady(ok); setProblems(bad); setStage('review');
    } catch (e) { setReadError(`تعذّرت قراءة الملف: ${errorText(e)}`); }
  };

  const run = async () => {
    stop.current = false; setStage('running');
    let done = 0; const failed: Problem[] = [];
    for (const item of ready) {
      if (stop.current) break;
      try { await importOne(item.value); done++; } catch (e) { failed.push({ row: item.row, label: item.label, error: errorText(e) }); }
      setProgress({ done: done + failed.length, failed: [...failed] });
    }
    setProgress({ done, failed });
    setStage('done');
    if (done) onFinished?.(done);
  };

  const list = (items: Problem[], tone: 'danger' | 'warning') => (
    <ul className="flex flex-col divide-y divide-hair overflow-hidden rounded-inner bg-surface ring-1 ring-hair">
      {items.slice(0, 200).map((p) => (
        <li key={`${p.row}-${p.error}`} className="flex items-start gap-3 px-3 py-2.5">
          <span className={`mt-0.5 flex h-6 min-w-[2.25rem] flex-none items-center justify-center rounded-md px-1.5 text-cap font-bold tabular ${tone === 'danger' ? 'bg-bad-bg text-bad' : 'bg-amber-bg text-amber'}`}>{num(p.row)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-small font-semibold">{p.label || '—'}</span><span className="block text-label text-ink-2">{p.error}</span></span>
        </li>
      ))}
      {items.length > 200 && <li className="px-3 py-2 text-label text-ink-3">و{num(items.length - 200)} صفاً آخر.</li>}
    </ul>
  );

  const total = ready.length;
  const pct = total ? Math.round((progress.done / total) * 100) : 0;
  const footer = stage === 'review' ? (
    <>
      <Button full kind="secondary" onClick={reset}>ملف آخر</Button>
      <Button full icon="upload" disabled={!total} onClick={() => void run()}>{total ? `أضف ${num(total)} ${what}` : 'لا صفوف جاهزة'}</Button>
    </>
  ) : stage === 'running' ? <Button full kind="secondary" onClick={() => { stop.current = true; }}>أوقف بعد الصف الحالي</Button>
    : stage === 'done' ? (<><Button full kind="secondary" onClick={reset}>استيراد ملف آخر</Button><Button full onClick={close}>تم</Button></>) : undefined;

  return (
    <SidePanel open={open} onClose={close} title={title} sub={file ?? `من ملف Excel (.xlsx) أو CSV · حتى ${num(MAX_IMPORT_ROWS)} صف`} w={560} footer={footer}>
      {stage === 'pick' && (
        <>
          {note && <Note icon="info">{note}</Note>}
          <section className="flex flex-col gap-3 rounded-card bg-surface p-4 ring-1 ring-hair">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-bg text-green"><Icon name="download" size={20} /></span>
              <div className="min-w-0 flex-1"><div className="text-small font-bold">١. نزّل القالب</div><div className="text-label text-ink-2">أعمدته: {fields.map((f) => f.label + (f.required ? '' : ' (اختياري)')).join('، ')}</div></div>
            </div>
            <Button kind="tonal" icon="download" onClick={() => void exportTemplate(templateName, fields.map((f) => f.label), [fields.map((f) => f.example ?? null)]).catch((e) => notifyError('لم يُنزَّل القالب', errorText(e)))}>
              تنزيل القالب
            </Button>
          </section>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-teal/40 bg-teal-tint/40 px-4 py-8 text-center hover:bg-teal-tint"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal text-white"><Icon name="upload" size={22} /></span>
            <span className="text-small font-bold text-ink">٢. اختر الملف أو اسحبه هنا</span>
            <span className="text-label text-ink-2">Excel (.xlsx) أو CSV · الصف الأول للعناوين</span>
            <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); }} />
          </label>
          {readError && <Note tone="danger" title="لم نقرأ الملف">{readError}</Note>}
        </>
      )}
      {stage === 'review' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-card bg-green-bg p-4"><div className="text-num-phone tabular text-green">{num(total)}</div><div className="text-label font-semibold text-ink">جاهز للإضافة</div></div>
            <div className={`rounded-card p-4 ${problems.length ? 'bg-amber-bg' : 'bg-sunken'}`}><div className={`text-num-phone tabular ${problems.length ? 'text-amber' : 'text-ink-3'}`}>{num(problems.length)}</div><div className="text-label font-semibold text-ink">فيه مشكلة ولن يُضاف</div></div>
          </div>
          {problems.length > 0 && <div className="flex flex-col gap-2"><h3 className="text-card">صفوف تحتاج تصحيحاً في الملف</h3>{list(problems, 'warning')}</div>}
          {total > 0 && (
            <div className="flex flex-col gap-2"><h3 className="text-card">أول ما سيُضاف</h3>
              <ul className="flex flex-col divide-y divide-hair overflow-hidden rounded-inner bg-surface ring-1 ring-hair">
                {ready.slice(0, 8).map((r) => <li key={r.row} className="flex items-center gap-3 px-3 py-2.5"><span className="flex h-6 min-w-[2.25rem] items-center justify-center rounded-md bg-green-bg px-1.5 text-cap font-bold text-green tabular">{num(r.row)}</span><span className="truncate text-small font-semibold">{r.label}</span></li>)}
                {total > 8 && <li className="px-3 py-2 text-label text-ink-3">و{num(total - 8)} آخرون.</li>}
              </ul>
            </div>
          )}
        </>
      )}
      {(stage === 'running' || stage === 'done') && (
        <>
          <div className="rounded-card bg-surface p-4 ring-1 ring-hair">
            <div className="mb-2 flex items-center justify-between text-small font-semibold">
              <span>{stage === 'running' ? `جارٍ الإضافة… ${num(progress.done)} من ${num(total)}` : `أُضيف ${num(progress.done)} ${what}`}</span>
              <span className="tabular text-teal">{num(stage === 'done' ? 100 : pct)}٪</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${stage === 'done' ? 100 : pct}%` }} /></div>
          </div>
          {stage === 'done' && progress.failed.length === 0 && <Note tone="success" title="اكتمل الاستيراد">أُضيف كل الصفوف الجاهزة.</Note>}
          {progress.failed.length > 0 && <div className="flex flex-col gap-2"><h3 className="text-card">رفضها الخادم ({num(progress.failed.length)})</h3>{list(progress.failed, 'danger')}</div>}
        </>
      )}
    </SidePanel>
  );
}
