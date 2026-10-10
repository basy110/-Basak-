import React, { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { TONE, type Tone } from './Status';
import { Button } from './Button';

/* ── What the phone top bar shows ───────────────────────────────────── */
/** A page tells the shell its title (and its parent, for a back arrow) so the phone top bar can show it. */
export interface PhoneHead { title?: string; back?: { label: string; to: string } }
const PhoneHeadContext = createContext<{ head: PhoneHead; set: (h: PhoneHead) => void } | null>(null);
export const PhoneHeadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [head, set] = useState<PhoneHead>({});
  return <PhoneHeadContext.Provider value={{ head, set }}>{children}</PhoneHeadContext.Provider>;
};
export const usePhoneHead = () => useContext(PhoneHeadContext)?.head ?? {};
function useSetPhoneHead(title?: string, back?: { label: string; to: string }) {
  const ctx = useContext(PhoneHeadContext);
  const set = ctx?.set;
  const backLabel = back?.label; const backTo = back?.to;
  useEffect(() => {
    if (!set) return undefined;
    set({ title, back: backLabel && backTo ? { label: backLabel, to: backTo } : undefined });
    return () => set({});
  }, [set, title, backLabel, backTo]);
}

/* ── Page ────────────────────────────────────────────────────────────── */
/**
 * The page's h1 with one sentence under it, actions at the end side (the primary last).
 * On a phone the title moves into the sticky top bar; only `sub` and the actions stay here.
 */
export const PageHeader: React.FC<{
  title: string; sub?: React.ReactNode; actions?: React.ReactNode; meta?: React.ReactNode;
  back?: { label: string; to: string }; phoneActions?: boolean;
}> = ({ title, sub, actions, meta, back, phoneActions = true }) => {
  useSetPhoneHead(title, back);
  // On a phone the title lives in the top bar: with nothing else to show, the header takes no room.
  const bare = !sub && !meta && !(actions && phoneActions) ? 'max-sm:contents' : '';
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-6 ${bare}`}>
      <div className={`flex min-w-0 flex-1 flex-col gap-0.5 ${bare}`}>
        {back && (
          <Link to={back.to} className="mb-1 hidden items-center gap-1.5 self-start text-label font-medium text-teal sm:inline-flex">
            <Icon name="arrowBack" size={14} stroke={2} /><span>{back.label}</span>
          </Link>
        )}
        <div className="hidden flex-wrap items-center gap-3 sm:flex"><h1 className="m-0 text-page">{title}</h1>{meta}</div>
        {meta && <div className="flex flex-wrap items-center gap-2 sm:hidden">{meta}</div>}
        <h1 className="sr-only sm:hidden">{title}</h1>
        {sub && <p className="m-0 max-w-[900px] text-small text-ink-2">{sub}</p>}
      </div>
      {actions && <div className={`${phoneActions ? 'flex' : 'hidden sm:flex'} flex-col gap-2 sm:flex-none sm:flex-row sm:items-center`}>{actions}</div>}
    </div>
  );
};

/** Sections of a page, 24 apart; the page uses the whole width the screen gives it. */
export const Page: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`mx-auto flex w-full max-w-[1920px] flex-col gap-5 sm:gap-6 ${className}`}>{children}</div>
);

/** A section title inside a page: 12 above its card. */
export const SectionHead: React.FC<{ title: React.ReactNode; meta?: React.ReactNode; end?: React.ReactNode; id?: string }> = ({ title, meta, end, id }) => (
  <div className="flex min-h-7 flex-wrap items-center gap-3 sm:min-h-9">
    <h2 id={id} className="m-0 text-card sm:text-section">{title}</h2>{meta}<span className="flex-1" />{end}
  </div>
);
export const Section: React.FC<{ title?: React.ReactNode; meta?: React.ReactNode; end?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, meta, end, children, className = '' }) => (
  <section className={`flex flex-col gap-3 ${className}`}>{title && <SectionHead title={title} meta={meta} end={end} />}{children}</section>
);

export const Card: React.FC<{ children: React.ReactNode; className?: string; as?: 'div' | 'section' }> = ({ children, className = '', as: As = 'div' }) => (
  <As className={`rounded-card bg-surface shadow-card ${className}`}>{children}</As>
);

/**
 * A form section: a card with its title and one helping sentence on the start side (4 of 12),
 * the fields on the end side (8 of 12); stacked on a phone. `footer` is the section's own save row.
 */
export const FormSection: React.FC<{ title: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; id?: string }> = ({ title, help, children, footer, id }) => (
  <section id={id} className="flex flex-col rounded-card bg-surface shadow-card">
    <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-8 lg:p-6">
      <div><h2 className="m-0 text-card">{title}</h2>{help && <p className="m-0 mt-0.5 text-label text-ink-2 lg:mt-1">{help}</p>}</div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
    {footer && <div className="flex flex-col-reverse gap-2 border-t border-hair px-4 py-3 sm:flex-row sm:items-center sm:justify-end lg:px-6">{footer}</div>}
  </section>
);

/** Label/value rows for a panel or a record page. */
export const InfoRows: React.FC<{ rows: [React.ReactNode, React.ReactNode][]; labelW?: number }> = ({ rows, labelW = 128 }) => (
  <dl className="m-0 flex flex-col">
    {rows.map(([k, v], i) => (
      <div key={i} className={`flex items-baseline gap-4 py-2.5 ${i ? 'border-t border-hair' : ''}`}>
        <dt className="flex-none text-label text-ink-3" style={{ width: labelW }}>{k}</dt>
        <dd className="m-0 min-w-0 flex-1 text-small">{v}</dd>
      </div>
    ))}
  </dl>
);

/* ── Numbers ─────────────────────────────────────────────────────────── */
/** One number, one sentence. `bar` (0–100) draws a meter. A card with `to` is a link. */
type Accent = 'teal' | 'violet' | 'amber' | 'green' | 'pink' | 'blue' | 'orange';
const ACCENT: Record<Accent, { tile: string; bar: string; edge: string }> = {
  teal: { tile: 'bg-teal-tint text-teal', bar: 'bg-teal', edge: 'before:bg-teal' },
  violet: { tile: 'bg-violet-bg text-violet', bar: 'bg-violet', edge: 'before:bg-violet' },
  amber: { tile: 'bg-amber-bg text-amber', bar: 'bg-amber', edge: 'before:bg-amber' },
  green: { tile: 'bg-green-bg text-green', bar: 'bg-green', edge: 'before:bg-green' },
  pink: { tile: 'bg-pink-bg text-pink', bar: 'bg-pink', edge: 'before:bg-pink' },
  blue: { tile: 'bg-blue-bg text-blue', bar: 'bg-blue', edge: 'before:bg-blue' },
  orange: { tile: 'bg-orange-bg text-orange', bar: 'bg-orange', edge: 'before:bg-orange' },
};
/** Each kind of number keeps one colour across the dashboard, read from its icon. */
const ICON_ACCENT: Partial<Record<IconName, Accent>> = {
  building: 'blue', users: 'violet', user: 'violet', check: 'green', receipt: 'amber', bus: 'teal', aup: 'blue', adown: 'violet',
  chart: 'green', card: 'green', clock: 'amber', calendar: 'pink', smartphone: 'blue', school: 'violet', route: 'blue', key: 'orange',
  megaphone: 'pink', scan: 'teal', idcard: 'violet', send: 'blue',
};

export const StatCard: React.FC<{
  label: React.ReactNode; value: React.ReactNode; unit?: React.ReactNode; hint?: React.ReactNode;
  icon?: IconName; tone?: Tone; accent?: Accent; to?: string; bar?: number; className?: string;
}> = ({ label, value, unit, hint, icon, tone, accent, to, bar, className = '' }) => {
  const a = ACCENT[accent ?? (icon && ICON_ACCENT[icon]) ?? 'teal'];
  const toned = tone && tone !== 'teal' && tone !== 'neutral';
  const tile = toned ? TONE[tone] : a.tile;
  const edge = toned ? { success: 'before:bg-ok', warning: 'before:bg-warn', danger: 'before:bg-bad' }[tone as 'success' | 'warning' | 'danger'] : a.edge;
  const body = (
    <>
      <div className="flex items-center gap-2.5 text-label font-bold text-ink-2">
        {icon && <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${tile}`}><Icon name={icon} size={18} stroke={2} /></span>}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {to && <Icon name="fwd" size={16} stroke={2} className="text-ink-3" />}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5 sm:mt-2"><span className="text-num-phone tabular sm:text-num">{value}</span>{unit && <span className="text-label font-semibold text-ink-3">{unit}</span>}</div>
      {bar != null && <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-sunken"><div className={`h-2 rounded-full ${a.bar}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /></div>}
      {hint && <div className={`text-label text-ink-3 ${bar != null ? 'mt-2' : 'mt-0.5'}`}>{hint}</div>}
    </>
  );
  // A coloured strip along the card's start edge.
  const cls = `relative flex min-w-0 flex-col overflow-hidden rounded-card bg-surface px-4 py-3.5 text-ink shadow-card before:absolute before:inset-y-0 before:start-0 before:w-1 sm:px-5 sm:py-[18px] ${edge} ${className}`;
  return to ? <Link to={to} className={`${cls} hover:shadow-[0_1px_2px_rgba(23,56,74,.05),inset_0_0_0_1px_#9DB0BB]`}>{body}</Link> : <div className={cls}>{body}</div>;
};

/* ── Attention ───────────────────────────────────────────────────────── */
export interface AttentionItem { key: string; count?: number; icon?: IconName; tone: Tone; title: React.ReactNode; sub: React.ReactNode; action: string; to: string; primary?: boolean; onClick?: () => void }
/** «يحتاج منك الآن»: many rows, one row, or the green «nothing waits» row. Never disappears. */
export const AttentionList: React.FC<{ items: AttentionItem[]; zeroTitle?: string; zeroSub?: string }> = ({ items, zeroTitle = 'لا شيء ينتظرك', zeroSub = 'راجعت كل الإيصالات، وكل الخطوط جاهزة.' }) => (
  <div className="overflow-hidden rounded-card bg-surface shadow-card">
    {items.length === 0 ? (
      <div className="flex min-h-[72px] items-center gap-3 px-4 py-3 sm:min-h-[68px] sm:px-5">
        <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-ok-bg text-ok"><Icon name="check" size={20} stroke={2.25} /></span>
        <span className="flex min-w-0 flex-1 flex-col"><span className="text-body font-semibold">{zeroTitle}</span><span className="text-label text-ink-2">{zeroSub}</span></span>
      </div>
    ) : items.map((a, i) => {
      const lead = (
        <>
          <span aria-hidden="true" className={`flex h-10 w-10 flex-none items-center justify-center rounded-control text-[17px] font-semibold tabular ${TONE[a.tone]}`}>{a.count ?? (a.icon && <Icon name={a.icon} size={20} />)}</span>
          <span className="flex min-w-0 flex-1 flex-col"><span className="text-body font-semibold">{a.title}</span><span className="text-label text-ink-2">{a.sub}</span></span>
        </>
      );
      return (
        <div key={a.key} className={i ? 'border-t border-hair' : ''}>
          <Link to={a.to} onClick={a.onClick} className="flex min-h-[72px] items-center gap-3 px-4 py-3 text-ink hover:bg-ground sm:hidden">{lead}<Icon name="fwd" size={18} className="text-ink-3" /></Link>
          <div className="hidden min-h-[68px] items-center gap-3 px-5 py-3 sm:flex">{lead}<Button sm kind={a.primary ? 'primary' : 'tonal'} to={a.to} onClick={a.onClick}>{a.action}</Button></div>
        </div>
      );
    })}
  </div>
);

/* ── Steps ───────────────────────────────────────────────────────────── */
export interface Step { label: string; sub?: string; state: 'done' | 'current' | 'todo' }
const StepDot: React.FC<{ s: Step; i: number }> = ({ s, i }) => (
  <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-label font-semibold ${s.state === 'done' ? 'bg-ok text-white' : s.state === 'current' ? 'bg-teal text-white' : 'bg-surface text-ink-3 shadow-[inset_0_0_0_1.5px_#9DB0BB]'}`}>
    {s.state === 'done' ? <Icon name="check" size={16} stroke={2.5} /> : i + 1}
  </span>
);
/** Numbered steps in a row; on a phone «الخطوة 2 من 4» and a segmented bar. */
export const Stepper: React.FC<{ steps: Step[] }> = ({ steps }) => {
  const cur = Math.max(0, steps.findIndex((s) => s.state === 'current'));
  return (
    <>
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-baseline gap-2"><span className="text-small font-semibold">{steps[cur]?.label}</span><span className="flex-1" /><span className="text-label text-ink-2">الخطوة {cur + 1} من {steps.length}</span></div>
        <div aria-hidden="true" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => <span key={i} className={`h-1 rounded-sm ${s.state === 'todo' ? 'bg-sunken' : s.state === 'done' ? 'bg-ok' : 'bg-teal'}`} />)}
        </div>
      </div>
      <ol className="m-0 hidden list-none items-center gap-3 p-0 sm:flex">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            <li aria-current={s.state === 'current' ? 'step' : undefined} className="flex flex-none items-center gap-2.5">
              <StepDot s={s} i={i} />
              <span className={`whitespace-nowrap text-small ${s.state === 'current' ? 'font-semibold' : ''} ${s.state === 'todo' ? 'text-ink-2' : 'text-ink'}`}>{s.label}</span>
            </li>
            {i < steps.length - 1 && <li aria-hidden="true" className={`h-0.5 min-w-6 flex-1 rounded-sm ${s.state === 'done' ? 'bg-ok' : 'bg-hair'}`} />}
          </React.Fragment>
        ))}
      </ol>
    </>
  );
};
/** Vertical steps (setup lists). */
export const StepList: React.FC<{ steps: (Step & { body?: React.ReactNode })[] }> = ({ steps }) => (
  <ol className="m-0 flex list-none flex-col p-0">
    {steps.map((s, i) => (
      <li key={i} aria-current={s.state === 'current' ? 'step' : undefined} className="flex gap-3">
        <div className="flex flex-col items-center"><StepDot s={s} i={i} />{i < steps.length - 1 && <span className={`my-1 min-h-4 w-0.5 flex-1 ${s.state === 'done' ? 'bg-ok' : 'bg-hair'}`} />}</div>
        <div className={`min-w-0 flex-1 ${i < steps.length - 1 ? 'pb-4' : ''}`}>
          <div className={`text-small leading-7 ${s.state === 'current' ? 'font-semibold' : 'font-medium'} ${s.state === 'todo' ? 'text-ink-2' : 'text-ink'}`}>{s.label}</div>
          {s.sub && <div className="text-label text-ink-2">{s.sub}</div>}
          {s.body}
        </div>
      </li>
    ))}
  </ol>
);

/** Phone only: the page's primary action, a plain full-width bar stuck to the bottom of the viewport. */
export const PhoneBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="sticky bottom-0 z-20 -mx-4 -mb-6 mt-auto flex flex-col gap-2 border-t border-hair bg-surface px-4 py-3 sm:hidden">{children}</div>
);
