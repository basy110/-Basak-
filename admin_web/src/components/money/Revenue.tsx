import React, { useId } from 'react';
import { Icon, Money } from '../../ui';
import { share } from '../../lib/money';

/** A filter as a pill: «الاشتراك الكل ⌄». Tinted while it narrows the list. */
export function FilterSelect<V extends string>({ label, value, onChange, options, defaultValue = '' as V, className = '' }: {
  label: string; value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; defaultValue?: V; className?: string;
}) {
  const id = useId();
  const on = value !== defaultValue;
  const shown = options.find((o) => o.value === value)?.label ?? '';
  return (
    <label htmlFor={id} className={`relative inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-control px-3 text-label sm:h-9 ${on ? 'bg-teal-tint text-teal shadow-[inset_0_0_0_1.5px_#00658D]' : 'bg-surface text-ink shadow-ring hover:bg-ground'} ${className}`}>
      <span className={on ? 'text-teal' : 'text-ink-2'}>{label}</span>
      <span className="font-semibold">{shown}</span>
      <Icon name="down" size={14} stroke={2} />
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export interface BarRow { key: string; name: React.ReactNode; note?: React.ReactNode; amount: number; onClick?: () => void; muted?: boolean }

/** «حسب الاشتراك / الخط / وسيلة الدفع»: one amount per row with a bar against the largest. */
export const BreakdownCard: React.FC<{ title: string; sub: React.ReactNode; rows: BarRow[]; more?: React.ReactNode; className?: string }> = ({ title, sub, rows, more, className = '' }) => {
  const max = Math.max(0, ...rows.map((r) => r.amount));
  return (
    <section className={`flex flex-col gap-3 rounded-card bg-surface px-4 py-4 shadow-card sm:px-5 sm:py-5 ${className}`}>
      <div><h3 className="m-0 text-card">{title}</h3><div className="text-label text-ink-2">{sub}</div></div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => {
          const body = (
            <>
              <span className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-start text-small font-semibold ${r.muted ? 'text-ink-2' : ''}`}>{r.name}{r.note && <span className="ms-1.5 text-cap font-normal text-ink-3">{r.note}</span>}</span>
                <span className={`flex-none text-small ${r.amount ? 'font-semibold' : 'text-ink-3'}`}><Money value={r.amount} /></span>
              </span>
              <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded bg-sunken"><span className="block h-1.5 rounded bg-teal" style={{ width: `${share(r.amount, max)}%` }} /></span>
            </>
          );
          return (
            <li key={r.key}>
              {r.onClick
                ? <button type="button" onClick={r.onClick} className="-mx-2 block w-[calc(100%+16px)] rounded-control px-2 py-1.5 text-ink hover:bg-ground">{body}</button>
                : <div className="py-1.5">{body}</div>}
            </li>
          );
        })}
      </ul>
      {more}
    </section>
  );
};

const ZERO = ['إجمالي الإيرادات وتوزيعها على الاشتراكات والخطوط ووسائل الدفع', 'عدد الاشتراكات المدفوعة وغير المدفوعة في هذه الصفحة'];
const KEEP = ['كل الاشتراكات وحالاتها، ولا يتغيّر شيء عند أي طالب', 'الإيصالات وصورها وأرقامها', 'حسابات الطلاب والمشرفين، والخطوط، ووسائل الدفع', 'السجل القديم كله: تراه بزر «يشمل ما قبل آخر تصفير»'];

/** What a reset zeroes and what it keeps, side by side (stacked in a dialog). */
export const ResetEffects: React.FC<{ scope: 'financial' | 'all'; stacked?: boolean }> = ({ scope, stacked }) => (
  <div className={`grid gap-3 ${stacked ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
    <div className="rounded-inner bg-bad-bg px-4 py-3.5">
      <div className="mb-2 text-small font-semibold text-bad">يبدأ من الصفر</div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small text-ink">
        {[...ZERO, ...(scope === 'all' ? ['أرقام صفحة «اليوم» التي تُحسب من الاشتراكات'] : [])].map((t) => <li key={t} className="flex gap-2"><Icon name="x" size={16} stroke={2} className="mt-0.5 text-bad" />{t}</li>)}
      </ul>
    </div>
    <div className="rounded-inner bg-ok-bg px-4 py-3.5">
      <div className="mb-2 text-small font-semibold text-ok">يبقى كما هو</div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small text-ink">
        {KEEP.map((t) => <li key={t} className="flex gap-2"><Icon name="check" size={16} stroke={2} className="mt-0.5 text-ok" />{t}</li>)}
      </ul>
    </div>
  </div>
);
