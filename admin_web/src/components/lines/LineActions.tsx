import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, Icon, IconButton, errorText, useOnline, type ButtonKind, type IconName } from '../../ui';
import { useGuard } from '../../lib/guard';
import { notify, notifyError } from '../../lib/toasts';
import { deleteLine, setLineActive, type LineStats } from '../../lib/linesData';
import { joinAnd, unitWord, W } from '../../lib/lines';
import type { LineRow } from '../../lib/reference';

type Kind = 'stop' | 'start' | 'delete' | 'refused';

const ORDINAL_F = ['', 'الوحيدة', '', 'الثلاث', 'الأربع', 'الخمس', 'الست', 'السبع', 'الثماني', 'التسع', 'العشر'];
/** «محطاته الخمس», «محطتيه», «محطته الوحيدة», «محطاته الـ12». */
function its(n: number, one: string, two: string, many: string): string {
  if (n === 1) return `${one} ${ORDINAL_F[1]}`;
  if (n === 2) return two;
  if (n <= 10) return `${many} ${ORDINAL_F[n]}`;
  return `${many} الـ${n}`;
}

const B: React.FC<{ children: React.ReactNode }> = ({ children }) => <b className="font-semibold text-ink">{children}</b>;

/**
 * Stopping, starting and deleting a line: every one is asked first, with what
 * happens to its students in real numbers (docs/canvas/AdmLineDialogs).
 * `ask(kind, line)` opens the question; `dialogs` is rendered once by the page.
 */
export function useLineActions(companyId: string, statsOf: (lineId: string) => LineStats, uniName: (id: string) => string, onDeleted?: () => void) {
  const [q, setQ] = useState<{ kind: Kind; line: LineRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useGuard();
  const online = useOnline();
  const close = () => { if (!busy) setQ(null); };

  const ask = (kind: Kind, line: LineRow) => {
    const s = statsOf(line.id);
    if (kind === 'delete' && (s.has_history || (s.subscribers ?? 0) > 0)) { setQ({ kind: 'refused', line }); return; }
    setQ({ kind, line });
  };

  const run = (kind: 'stop' | 'start' | 'delete', line: LineRow) => guard(line.id, async () => {
    setBusy(true);
    try {
      if (kind === 'delete') {
        const out = await deleteLine(companyId, line);
        if (out === 'refused') { setQ({ kind: 'refused', line }); return; }
        notify({ title: `حُذف خط ${line.name}`, tone: 'success' });
        setQ(null);
        onDeleted?.();
        return;
      }
      await setLineActive(companyId, line, kind === 'start');
      notify(kind === 'start'
        ? { title: `يعمل خط ${line.name} الآن`, body: 'عاد للظهور للطلاب في التطبيق.', tone: 'success' }
        : { title: `أُوقف خط ${line.name}`, body: 'لم يعد يظهر للطلاب. مشتركوه الحاليون مستمرون.', tone: 'success' });
      setQ(null);
    } catch (error) {
      notifyError(kind === 'delete' ? 'لم يُحذف الخط' : kind === 'start' ? 'لم يُشغَّل الخط' : 'لم يُوقف الخط', errorText(error));
    } finally {
      setBusy(false);
    }
  });

  let dialog: React.ReactNode = null;
  if (q) {
    const { line } = q;
    const s = statsOf(line.id);
    const subs = s.subscribers;
    const stations = line.stations.filter((x) => x.is_active).length;
    const trips = line.line_trips.filter((x) => x.is_active).length;
    const unis = joinAnd(line.line_universities.map((u) => uniName(u.university_id)));
    const cancel = <Button key="c" kind="secondary" data-autofocus onClick={close} disabled={busy}>رجوع</Button>;
    if (q.kind === 'stop') {
      dialog = (
        <Dialog open onClose={close} icon="power" tone="danger" title={`إيقاف خط ${line.name}؟`}
          actions={[cancel, <Button key="ok" kind="danger" loading={busy} disabled={!online} onClick={() => void run('stop', line)}>إيقاف الخط</Button>]}>
          <p className="m-0">لن يظهر الخط للطلاب في التطبيق، ولن يشترك فيه أحد جديد، ولا يمكن إسناده لمشرف جديد.</p>
          {subs ? (
            <p className="m-0">المشتركون الحاليون (<B>{subs.toLocaleString('en-US')} {unitWord(subs, W.student)}</B>) يبقى اشتراكهم كما هو، وتبقى محطاته ورحلاته وسجلاته. يمكنك تشغيله مرة أخرى في أي وقت.</p>
          ) : (
            <p className="m-0">{subs === 0 ? 'لا مشتركين فيه الآن. ' : 'من اشترك فيه يبقى اشتراكه كما هو. '}تبقى محطاته ورحلاته وسجلاته، ويمكنك تشغيله مرة أخرى في أي وقت.</p>
          )}
        </Dialog>
      );
    } else if (q.kind === 'start') {
      dialog = (
        <Dialog open onClose={close} icon="power" tone="teal" title={`تشغيل خط ${line.name}؟`}
          actions={[cancel, <Button key="ok" loading={busy} disabled={!online} onClick={() => void run('start', line)}>تشغيل الخط</Button>]}>
          <p className="m-0">يعود الخط للظهور في التطبيق{unis ? ` لطلاب ${unis}` : ''}، بالاشتراكات المعروضة للبيع الآن. محطاته ورحلاته وأسعاره كما تركتها.</p>
        </Dialog>
      );
    } else if (q.kind === 'delete') {
      dialog = (
        <Dialog open onClose={close} icon="trash" tone="danger" title={`حذف خط ${line.name} نهائياً؟`}
          actions={[cancel, <Button key="ok" kind="danger" loading={busy} disabled={!online} onClick={() => void run('delete', line)}>حذف الخط</Button>]}>
          <p className="m-0">يُحذف الخط مع {its(stations, 'محطته', 'محطتيه', 'محطاته')}{trips ? ` و${its(trips, 'رحلته', 'رحلتيه', 'رحلاته')}` : ''}. لا يمكن التراجع.</p>
          <p className="m-0">لم يشترك فيه أحد، فلن يتأثر أي طالب.</p>
        </Dialog>
      );
    } else {
      dialog = (
        <Dialog open onClose={close} icon="alert" tone="warning" title={`لا يمكن حذف خط ${line.name}`}
          actions={[cancel, ...(line.is_active ? [<Button key="ok" kind="outline" disabled={!online} onClick={() => setQ({ kind: 'stop', line })}>إيقاف الخط بدلاً من حذفه</Button>] : [])]}>
          <p className="m-0">{subs
            ? <>للخط اشتراكات وسجلات ركوب سابقة ({subs.toLocaleString('en-US')} {subs >= 11 ? 'اشتراكاً سارياً' : subs >= 3 ? 'اشتراكات سارية' : subs === 2 ? 'اشتراكان ساريان' : 'اشتراك سارٍ'})، وحذفه يضيّعها.</>
            : 'للخط اشتراكات أو سجلات ركوب سابقة، وحذفه يضيّعها.'}</p>
          <p className="m-0">{line.is_active ? 'إن أردت ألا يراه الطلاب فأوقفه: يختفي من التطبيق وتبقى سجلاته.' : 'الخط متوقف بالفعل: لا يراه الطلاب، وتبقى سجلاته.'}</p>
        </Dialog>
      );
    }
  }
  return { ask, dialogs: dialog, online };
}

/** A row's «⋮» menu with optional second lines and a separator (docs/canvas/AdmLines). */
export interface MenuItem { label: string; sub?: string; icon: IconName; danger?: boolean; onClick: () => void; disabled?: boolean; sep?: boolean }
/** A named button that opens the menu instead of the «⋮» (e.g. «تعديل الخط ⌄»). */
export interface MenuTrigger { text: string; icon?: IconName; kind?: ButtonKind; full?: boolean; disabled?: boolean }
export const LineMenu: React.FC<{ items: MenuItem[]; label?: string; sm?: boolean; trigger?: MenuTrigger }> = ({ items, label = 'إجراءات الخط', sm = true, trigger }) => {
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; width?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = !!pos;
  const toggle = () => {
    if (pos) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    // Below the button, aligned to its end side; above it when there is no room below.
    const up = window.innerHeight - r.bottom < 300 && r.top > 300;
    // A full-width trigger (the phone's bottom bar) gets a list as wide as itself.
    const width = trigger?.full ? r.width : undefined;
    const left = width ? r.left : Math.max(8, Math.min(r.left, window.innerWidth - 240));
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, up, width });
  };
  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const off = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null); };
    const shut = () => setPos(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPos(null); btn.current?.focus(); }
      if (e.key === 'Tab') setPos(null);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
        const i = all.indexOf(document.activeElement as HTMLButtonElement);
        all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
      }
    };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key);
    window.addEventListener('scroll', shut, true); window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', shut, true); window.removeEventListener('resize', shut);
    };
  }, [open]);
  return (
    <div className={trigger?.full ? 'relative w-full' : 'relative'} onClick={(e) => e.stopPropagation()}>
      {trigger
        ? <Button ref={btn} kind={trigger.kind} icon={trigger.icon} iconEnd={open ? 'up' : 'down'} sm={sm} full={trigger.full} disabled={trigger.disabled}
          aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{trigger.text}</Button>
        : <IconButton ref={btn} icon="dots" label={label} sm={sm} aria-haspopup="menu" aria-expanded={open} onClick={toggle} />}
      {pos && createPortal(
        <div ref={list} role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}
          className="enter fixed z-[65] min-w-[232px] overflow-hidden rounded-inner bg-surface p-1.5 shadow-floating ring-1 ring-hair"
          style={{ left: pos.left, ...(pos.width ? { width: pos.width } : {}), ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          {items.map((i) => (
            <React.Fragment key={i.label}>
              {i.sep && <div role="separator" className="my-1.5 h-px bg-hair" />}
              <button type="button" role="menuitem" disabled={i.disabled} onClick={() => { setPos(null); i.onClick(); }}
                className={`flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-start text-small hover:bg-ground focus-visible:bg-ground disabled:text-disabled ${i.danger ? 'text-bad' : 'text-ink'}`}>
                <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{i.label}</span>{i.sub && <span className="text-cap font-normal text-ink-2">{i.sub}</span>}</span>
                <Icon name={i.icon} size={18} className={i.danger ? 'text-bad' : 'text-ink-2'} />
              </button>
            </React.Fragment>
          ))}
        </div>, document.body)}
    </div>
  );
};
