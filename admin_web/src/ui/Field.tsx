import React, { useId } from 'react';
import { Icon, type IconName } from './Icon';
import { Select } from './Select';

const RING = 'shadow-field hover:shadow-field-hover focus-within:!shadow-field-focus';
const box = (error?: string, disabled?: boolean) =>
  `flex h-12 sm:h-11 items-center gap-2 rounded-control px-3 text-small ${disabled ? 'bg-ground shadow-ring text-disabled' : `bg-surface ${error ? 'shadow-field-error' : RING}`}`;

interface Frame { label?: React.ReactNode; help?: React.ReactNode; error?: string; optional?: boolean; className?: string }

/** Label above, the control, then the error (red, with an icon) or the help line. */
export const FieldFrame: React.FC<Frame & { id: string; children: React.ReactNode; labelAs?: 'label' | 'div' }> = ({ id, label, help, error, optional, className = '', children, labelAs = 'label' }) => {
  const L = labelAs as 'label';
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {label && (
        <L {...(labelAs === 'label' ? { htmlFor: id } : { id: `${id}-label` })} className="flex items-baseline gap-2 text-label font-medium text-ink">
          <span>{label}</span>{optional && <span className="font-normal text-ink-3">اختياري</span>}
        </L>
      )}
      {children}
      {error
        ? <div id={`${id}-msg`} role="alert" className="flex items-start gap-1.5 text-label text-bad"><Icon name="alert" size={14} stroke={2} className="mt-[3px]" /><span>{error}</span></div>
        : help ? <div id={`${id}-msg`} className="text-label text-ink-2">{help}</div> : null}
    </div>
  );
};

type InputProps = Frame & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** Text after the value inside the control («ج.م», «دقيقة»). */
  suffix?: React.ReactNode;
  leadIcon?: IconName;
  /** Phones, codes, money, e-mails: typed left to right. */
  ltr?: boolean;
  end?: React.ReactNode;
};

export const TextField = React.forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, help, error, optional, className, suffix, leadIcon, ltr, end, id: given, disabled, ...input }, ref,
) {
  const auto = useId();
  const id = given ?? auto;
  return (
    <FieldFrame id={id} label={label} help={help} error={error} optional={optional} className={className}>
      <div className={box(error, disabled)}>
        {leadIcon && <Icon name={leadIcon} size={18} className="text-ink-3" />}
        <input ref={ref} id={id} disabled={disabled} dir={ltr ? 'ltr' : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error || help ? `${id}-msg` : undefined}
          className={`h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3 disabled:cursor-not-allowed ${ltr ? 'text-right [unicode-bidi:plaintext]' : ''}`} {...input} />
        {suffix && <span className="flex-none text-label text-ink-3">{suffix}</span>}
        {end}
      </div>
    </FieldFrame>
  );
});

/** Money: Western digits, the «ج.م» unit inside the end of the control. No pre-filled prices. */
export const MoneyField: React.FC<Omit<InputProps, 'type' | 'value' | 'onChange'> & { value: number | '' | null; onValue: (v: number | '') => void }> = ({ value, onValue, ...rest }) => (
  <TextField {...rest} inputMode="numeric" ltr suffix="ج.م" value={value ?? ''}
    onChange={(e) => { const d = e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''); onValue(d === '' ? '' : Number(d)); }} />
);

export const PasswordField: React.FC<InputProps> = (props) => {
  const [shown, setShown] = React.useState(false);
  return <TextField {...props} type={shown ? 'text' : 'password'} ltr
    end={<button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} className="-me-2 flex h-9 w-9 items-center justify-center rounded-control text-ink-3 hover:bg-sunken"><Icon name={shown ? 'eyeOff' : 'eye'} size={18} /></button>} />;
};

export const SelectField: React.FC<Frame & {
  options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string; id?: string; disabled?: boolean;
  value: string; onChange: (e: { target: { value: string } }) => void; name?: string; required?: boolean; 'aria-label'?: string;
}> = ({ label, help, error, optional, className, options, placeholder, id: given, disabled, value, onChange, 'aria-label': ariaLabel }) => {
  const auto = useId();
  const id = given ?? auto;
  // A placeholder is also a choice that clears the field, as an empty <option> was.
  const all = placeholder !== undefined ? [{ value: '', label: placeholder }, ...options] : options;
  return (
    <FieldFrame id={id} label={label} help={help} error={error} optional={optional} className={className}>
      <Select id={id} value={value} options={all} placeholder={placeholder} disabled={disabled} invalid={!!error}
        ariaLabel={ariaLabel} describedBy={error || help ? `${id}-msg` : undefined}
        onChange={(v) => onChange({ target: { value: v } })} />
    </FieldFrame>
  );
};

export const TextArea: React.FC<Frame & React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ label, help, error, optional, className, id: given, rows = 3, ...area }) => {
  const auto = useId();
  const id = given ?? auto;
  return (
    <FieldFrame id={id} label={label} help={help} error={error} optional={optional} className={className}>
      <textarea id={id} rows={rows} aria-invalid={error ? true : undefined} aria-describedby={error || help ? `${id}-msg` : undefined}
        className={`w-full resize-y rounded-control bg-surface px-3 py-2.5 text-small outline-none placeholder:text-ink-3 ${error ? 'shadow-field-error' : 'shadow-field hover:shadow-field-hover focus:!shadow-field-focus'}`} {...area} />
    </FieldFrame>
  );
};

/** A switch row. Say in `help` when it takes effect. Never saves by itself when money, status or students are affected. */
export const Toggle: React.FC<{ label: React.ReactNode; help?: React.ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }> = ({ label, help, checked, onChange, disabled }) => {
  const id = useId();
  return (
    <div className={`flex min-h-12 items-center gap-4 sm:min-h-11 ${disabled ? 'text-disabled' : ''}`}>
      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
        <span className="text-small font-medium">{label}</span>
        {help && <span className={`text-label ${disabled ? 'text-disabled' : 'text-ink-2'}`}>{help}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
};

export const Switch: React.FC<{ id?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string }> = ({ id, checked, onChange, disabled, label }) => (
  <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
    className={`flex h-6 w-11 flex-none items-center rounded-full p-0.5 transition-colors ${disabled ? 'bg-sunken' : checked ? 'bg-teal' : 'bg-disabled'} ${checked ? 'justify-end' : 'justify-start'}`}>
    <span className="h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(23,56,74,.25)]" />
  </button>
);

export const Checkbox: React.FC<{ checked: boolean | 'mixed'; onChange: (on: boolean) => void; label: React.ReactNode; hideLabel?: boolean; disabled?: boolean; className?: string }> = ({ checked, onChange, label, hideLabel, disabled, className = '' }) => (
  <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-small ${disabled ? 'cursor-default text-disabled' : ''} ${className}`}
    onClick={(e) => e.stopPropagation()}>
    <input type="checkbox" className="peer sr-only" checked={checked === true} disabled={disabled}
      ref={(el) => { if (el) el.indeterminate = checked === 'mixed'; }} onChange={(e) => onChange(e.target.checked)} />
    <span aria-hidden="true" className={`flex h-5 w-5 flex-none items-center justify-center rounded-md peer-focus-visible:shadow-focus ${checked ? 'bg-teal text-white' : 'bg-surface shadow-[inset_0_0_0_1.5px_#58707F]'}`}>
      {checked === 'mixed' ? <span className="h-0.5 w-2.5 rounded bg-white" /> : checked ? <Icon name="check" size={14} stroke={3} /> : null}
    </span>
    <span className={hideLabel ? 'sr-only' : ''}>{label}</span>
  </label>
);

/** Radio cards: one choice among a few, each with an optional second line. */
export function RadioCards<V extends string>({ label, options, value, onChange, cols, error, name }: {
  label?: React.ReactNode; options: { value: V; label: React.ReactNode; sub?: React.ReactNode; end?: React.ReactNode; disabled?: boolean }[];
  value: V | null; onChange: (v: V) => void; cols?: number; error?: string; name?: string;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} labelAs="div">
      <div role="radiogroup" aria-labelledby={label ? `${id}-label` : undefined}
        className="grid grid-cols-1 gap-2 sm:[grid-template-columns:var(--cols)]" style={{ '--cols': `repeat(${cols ?? options.length}, minmax(0, 1fr))` } as React.CSSProperties}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-control px-3.5 py-2.5 ${o.sub ? 'min-h-16' : 'min-h-12 sm:min-h-11'} ${o.disabled ? 'cursor-default opacity-60' : ''} ${on ? 'bg-teal-tint shadow-[inset_0_0_0_2px_#00658D]' : 'bg-surface shadow-field hover:shadow-field-hover'}`}>
              <input type="radio" className="peer sr-only" name={name ?? id} checked={on} disabled={o.disabled} onChange={() => onChange(o.value)} />
              <span aria-hidden="true" className={`h-5 w-5 flex-none rounded-full bg-surface peer-focus-visible:shadow-focus ${on ? 'shadow-[inset_0_0_0_6px_#00658D]' : 'shadow-[inset_0_0_0_1.5px_#58707F]'}`} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`text-small ${on ? 'font-semibold' : 'font-medium'}`}>{o.label}</span>
                {o.sub && <span className="text-label text-ink-2">{o.sub}</span>}
              </span>
              {o.end}
            </label>
          );
        })}
      </div>
    </FieldFrame>
  );
}

/** Lay fields side by side from 640 up; stacked on a phone. */
export const FieldRow: React.FC<{ children: React.ReactNode; cols?: string }> = ({ children, cols }) => (
  <div className="grid grid-cols-1 items-start gap-4 sm:[grid-template-columns:var(--cols)]"
    style={{ '--cols': cols ?? `repeat(${React.Children.toArray(children).filter(Boolean).length}, minmax(0, 1fr))` } as React.CSSProperties}>{children}</div>
);
