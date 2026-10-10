import React, { useId, useMemo } from 'react';
import { FieldFrame, Icon, Select, SelectField } from '../../ui';
import { clockLabel } from '../../lib/time';
import { MONTHS, daysIn } from '../../lib/platform';

/** A time of day in Arabic («2:00 م»), every 15 minutes: the browser's own time box writes «02:00 PM». */
export const TimeSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; help?: string; error?: string }> = ({ label, value, onChange, help, error }) => {
  const options = useMemo(() => {
    const list = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
    if (!list.includes(value)) list.push(value);
    return list.sort().map((t) => ({ value: t, label: clockLabel(t) }));
  }, [value]);
  return <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} help={help} error={error} />;
};

/**
 * A calendar day from today on, as a day number and a month of the coming year
 * (the browser's date box writes «mm/dd/yyyy»). Answers `YYYY-MM-DD`, or '' while incomplete.
 */
export const DayPicker: React.FC<{ label: React.ReactNode; today: string; value: { day: string; month: string }; onChange: (v: { day: string; month: string }) => void; error?: string; className?: string }> = ({ label, today, value, onChange, error, className }) => {
  const id = useId();
  const months = useMemo(() => {
    const [y, m] = today.split('-').map(Number);
    return Array.from({ length: 13 }, (_, i) => { const mm = ((m - 1 + i) % 12) + 1; const yy = y + Math.floor((m - 1 + i) / 12); return { value: `${yy}-${String(mm).padStart(2, '0')}`, label: `${MONTHS[mm - 1]} ${yy}` }; });
  }, [today]);
  const ring = error ? 'shadow-field-error' : 'shadow-field hover:shadow-field-hover focus-within:!shadow-field-focus';
  return (
    <FieldFrame id={id} label={label} error={error} className={className} labelAs="div">
      <div role="group" aria-labelledby={`${id}-label`} className="flex gap-2">
        <input id={id} aria-label="اليوم" inputMode="numeric" dir="ltr" placeholder="اليوم" value={value.day}
          onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
          className={`h-12 w-20 flex-none rounded-control bg-surface px-3 text-center text-small outline-none placeholder:text-ink-3 sm:h-11 ${ring}`} />
        <div className="min-w-0 flex-1">
          <Select value={value.month} onChange={(m) => onChange({ ...value, month: m })} options={months.map((m) => ({ value: String(m.value), label: m.label }))}
            placeholder="اختر الشهر" ariaLabel="الشهر" icon="calendar"
            className={`flex h-12 w-full items-center gap-2 rounded-control bg-surface px-3 text-start text-small sm:h-11 ${ring}`} />
        </div>
      </div>
    </FieldFrame>
  );
};

/** `{ day: '22', month: '2026-10' }` → `2026-10-22`; '' when the day is missing; 'bad' when the month has no such day. */
export function pickedDay(v: { day: string; month: string }): string {
  if (!v.day || !v.month) return '';
  const d = Number(v.day); const [, m] = v.month.split('-').map(Number);
  const y = Number(v.month.slice(0, 4));
  const max = m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : daysIn(m);
  if (d < 1 || d > max) return 'bad';
  return `${v.month}-${String(d).padStart(2, '0')}`;
}
