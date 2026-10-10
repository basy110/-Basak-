import React, { useState } from 'react';
import { Badge, Checkbox, Icon, Ltr, phoneText } from '../../ui';
import type { LineName } from '../../lib/reference';
import { initialOf } from '../../lib/team';

/** A person's photo, or the first letter of the name on the teal tint. */
export const Avatar: React.FC<{ name: string; src?: string | null; size?: number; className?: string }> = ({ name, src, size = 36, className = '' }) => (
  src
    ? <img src={src} alt="" className={`flex-none rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
    : (
      <span aria-hidden="true" className={`flex flex-none items-center justify-center rounded-full bg-teal-tint font-semibold text-teal ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>{initialOf(name)}</span>
    )
);

/** A name with its avatar (first column of the people tables). */
export const PersonCell: React.FC<{ name: string; src?: string | null; end?: React.ReactNode; sub?: React.ReactNode }> = ({ name, src, end, sub }) => (
  <div className="flex min-w-0 items-center gap-3">
    <Avatar name={name} src={src} />
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{name}</span>{end}</div>
      {sub && <div className="truncate text-cap text-ink-3">{sub}</div>}
    </div>
  </div>
);

/** «010 2345 6789», left to right. */
export const PhoneLtr: React.FC<{ phone: string; className?: string }> = ({ phone, className = '' }) => <Ltr className={`tabular ${className}`}>{phoneText(phone)}</Ltr>;

/** A line as a small grey tag; a stopped line says so. */
export const LineTag: React.FC<{ line?: LineName; name?: string }> = ({ line, name }) => (
  <Badge>{line?.name ?? name ?? 'خط'}{line && !line.is_active && ' · متوقف'}</Badge>
);

/**
 * The company's lines as checkbox cards, two to a row (one on a phone).
 * A line nobody covers says «بلا مشرف»; a stopped line says «متوقف» and can be
 * kept but not newly given.
 */
export const LinePicker: React.FC<{
  lines: LineName[]; selected: string[]; onChange: (ids: string[]) => void;
  /** Lines with no working supervisor (other than the one being edited). */
  uncovered: Set<string>;
  /** Lines this supervisor already has: a stopped one among them stays selectable. */
  had?: string[];
  label?: string; help?: React.ReactNode; error?: string; disabled?: boolean;
}> = ({ lines, selected, onChange, uncovered, had = [], label = 'الخطوط التي يشرف عليها', help, error, disabled }) => {
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" aria-describedby={error || help ? 'line-picker-msg' : undefined}>
      <legend className="mb-1.5 p-0 text-label font-medium text-ink">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {lines.map((line) => {
          const on = selected.includes(line.id);
          const locked = disabled || (!line.is_active && !had.includes(line.id) && !on);
          return (
            <div key={line.id} className={`flex min-h-12 items-center gap-2 rounded-control pe-3 ps-2 sm:min-h-11 ${on ? 'bg-teal-tint shadow-[inset_0_0_0_2px_#00658D]' : 'bg-surface shadow-field'} ${locked ? 'opacity-70' : ''}`}>
              <Checkbox checked={on} disabled={locked} onChange={(v) => toggle(line.id, v)} className="min-w-0 flex-1 !min-h-11 ps-1"
                label={<span className={`truncate ${on ? 'font-semibold text-teal' : ''}`}>{line.name}</span>} />
              {!line.is_active
                ? <span className="flex-none text-cap text-ink-3">متوقف</span>
                : uncovered.has(line.id) && !had.includes(line.id) && <span className="flex-none text-cap font-medium text-bad">بلا مشرف</span>}
            </div>
          );
        })}
      </div>
      {error
        ? <div id="line-picker-msg" role="alert" className="flex items-start gap-1.5 text-label text-bad"><Icon name="alert" size={14} stroke={2} className="mt-[3px]" /><span>{error}</span></div>
        : help ? <div id="line-picker-msg" className="text-label text-ink-2">{help}</div> : null}
    </fieldset>
  );
};

/** A value with a copy button (phone, password): one press puts it on the clipboard. */
export const CopyRow: React.FC<{ label: string; value: string; shown?: string }> = ({ label, value, shown }) => {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); window.setTimeout(() => setDone(false), 1800); } catch { /* the value stays on screen */ }
  };
  return (
    <div className="flex min-h-[52px] items-center gap-3 rounded-control bg-ground px-4 shadow-ring">
      <span className="flex-none text-label text-ink-2">{label}</span>
      <Ltr className="min-w-0 flex-1 select-all truncate text-end text-[17px] font-semibold tracking-wide text-ink tabular">{shown ?? value}</Ltr>
      <button type="button" onClick={() => void copy()} aria-label={done ? `نُسخ ${label}` : `نسخ ${label}`} title={done ? 'نُسخ' : 'نسخ'}
        className="-me-2 flex h-10 w-10 flex-none items-center justify-center rounded-control text-ink-2 hover:bg-sunken">
        <Icon name={done ? 'check' : 'copy'} size={18} />
      </button>
    </div>
  );
};

/** Copies several lines at once; answers whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
