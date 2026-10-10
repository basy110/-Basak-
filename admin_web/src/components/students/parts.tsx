import React from 'react';
import { Icon, type IconName } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { Badge, StatusPill } from '../../ui/Status';
import { cairo, dayText } from '../../ui/format';
import { initialOf, type Shown } from '../../lib/students';

const TONES = ['bg-ok-bg text-ok', 'bg-teal-tint text-teal', 'bg-warn-bg text-warn', 'bg-sunken text-ink-2'];
const toneOf = (key: string) => TONES[[...key].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 9973, 7) % TONES.length];

/** The student's photo, or the first letter of the name in a tinted circle. */
export const Avatar: React.FC<{ name: string; id: string; url?: string; size?: number }> = ({ name, id, url, size = 36 }) => (
  url
    ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className={`flex flex-none items-center justify-center rounded-full font-semibold ${toneOf(id)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{initialOf(name)}</span>
);

/** A row's status: one of the six, or «بلا اشتراك». */
export const ShownPill: React.FC<{ shown: Shown }> = ({ shown }) => (shown === 'none' ? <Badge className="!rounded-full !px-3 !text-label !leading-[26px]">بلا اشتراك</Badge> : <StatusPill status={shown} />);

/** «10 أكتوبر» this year, «29 سبتمبر 2025» an earlier one. */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : cairo(iso).day;
  return dayText(day, { year: day.slice(0, 4) !== cairo(new Date()).day.slice(0, 4) });
}
/** «10 أكتوبر 2026». */
export const fullDay = (iso: string | null | undefined) => (iso ? dayText(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : cairo(iso).day) : '');

/** A compact select inside a toolbar: «الخط  كل الخطوط ▾». */
export function FilterSelect<V extends string>({ label, value, onChange, options, allLabel, className = '', icon, hideLabel }: {
  label: string; value: V | ''; onChange: (v: V | '') => void; options: { value: V; label: string }[]; allLabel: string; className?: string;
  icon?: IconName; hideLabel?: boolean;
}) {
  const all = [{ value: '' as V | '', label: allLabel }, ...options];
  return (
    <Select<V | ''> value={value} onChange={onChange} options={all as { value: V | ''; label: string }[]} ariaLabel={label} icon={icon} minListWidth={220}
      renderValue={(o) => <>{!hideLabel && <span className="font-normal text-ink-2">{label} </span>}<span className="font-bold text-ink">{o && o.value ? o.label : <><span className="sm:hidden">الكل</span><span className="hidden sm:inline">{allLabel}</span></>}</span></>}
      className={`inline-flex h-11 min-w-0 flex-none items-center gap-1.5 rounded-control bg-surface px-3 text-label shadow-ring hover:bg-ground focus-visible:!shadow-field-focus sm:h-9 ${value ? '!shadow-[inset_0_0_0_1.5px_#00658D]' : ''} ${className}`} />
  );
}

/** Tabs of a page: an underlined row, each with its count. */
export function Tabs<V extends string>({ value, onChange, tabs, label }: { value: V; onChange: (v: V) => void; tabs: { value: V; label: string; short?: string; count?: number | null }[]; label: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0; // RTL: left is next
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n].value);
  };
  return (
    <div role="tablist" aria-label={label} className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-hair px-4 sm:mx-0 sm:gap-2 sm:px-0">
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button key={t.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`tab-${t.value}`} aria-selected={on} aria-controls={`panel-${t.value}`}
            tabIndex={on ? 0 : -1} onClick={() => onChange(t.value)} onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px inline-flex h-12 flex-none items-center gap-2 whitespace-nowrap border-b-2 px-3 text-small ${on ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-2 hover:text-ink'}`}>
            <span className={t.short ? 'hidden sm:inline' : ''}>{t.label}</span>{t.short && <span className="sm:hidden">{t.short}</span>}
            {t.count != null && <span className={`min-w-6 rounded-full px-1.5 text-center text-cap font-semibold leading-5 tabular ${on ? 'bg-teal-tint text-teal' : 'bg-sunken text-ink-2'}`}>{t.count.toLocaleString('en-US')}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A small section title inside a panel. */
export const PanelHead: React.FC<{ children: React.ReactNode; end?: React.ReactNode }> = ({ children, end }) => (
  <div className="flex items-center gap-2"><h3 className="m-0 flex-1 text-label font-semibold text-ink">{children}</h3>{end}</div>
);

/** A phone toolbar's quiet choice: teal words and an icon, the native list on tap («⇅ كل الشركات»). */
export function LinkSelect<V extends string>({ label, value, onChange, options, icon = 'sort' }: { label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; icon?: IconName }) {
  return (
    <Select value={value} onChange={onChange} options={options} ariaLabel={label} icon={icon} minListWidth={220}
      className="inline-flex h-10 max-w-[60vw] flex-none items-center gap-1.5 px-1 text-label font-semibold text-teal" />
  );
}
