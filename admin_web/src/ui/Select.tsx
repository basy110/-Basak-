import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface SelectOption<V extends string = string> { value: V; label: string; sub?: string; disabled?: boolean }

/**
 * The dashboard's own drop-down list (the browser's native one looked out of place):
 * a button that opens a floating list under it. Arrow keys, Home/End, typing a
 * letter, Enter and Escape work; the list flips above when there is no room below.
 * `className` styles the button; by default it looks like a text field.
 */
export function Select<V extends string>({
  value, onChange, options, placeholder, disabled, ariaLabel, id, className, icon, invalid, describedBy, renderValue, minListWidth = 200,
}: {
  value: V | ''; onChange: (v: V) => void; options: SelectOption<V>[]; placeholder?: string; disabled?: boolean;
  ariaLabel?: string; id?: string; className?: string; icon?: IconName; invalid?: boolean; describedBy?: string;
  /** What the button shows (defaults to the chosen option's label, else the placeholder). */
  renderValue?: (option: SelectOption<V> | undefined) => React.ReactNode; minListWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [at, setAt] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const typed = useRef({ text: '', at: 0 });
  const chosen = options.find((o) => o.value === value);

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, minListWidth);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const wanted = Math.min(320, options.length * 44 + 8);
    const down = below >= Math.min(wanted, 200) || below >= above;
    const maxH = Math.max(120, Math.min(320, down ? below : above));
    // RTL: the list's end edge lines up with the button's end edge.
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    setAt({ top: down ? r.bottom + 4 : r.top - 4 - Math.min(wanted, maxH), left, width, maxH });
  };
  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const onMove = () => place();
    window.addEventListener('resize', onMove); window.addEventListener('scroll', onMove, true);
    return () => { window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const off = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const step = (from: number, dir: 1 | -1) => { let i = from; for (let n = 0; n < options.length; n++) { i = (i + dir + options.length) % options.length; if (enabled(i)) return i; } return from; };
  const openList = () => { if (disabled) return; setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (i: number) => { if (!enabled(i)) return; onChange(options[i].value); setOpen(false); button.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => step(a, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => step(a, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(step(-1, 1)); }
    else if (e.key === 'End') { e.preventDefault(); setActive(step(options.length, -1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key, at: now };
      const i = options.findIndex((o, n) => enabled(n) && o.label.startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button ref={button} id={id} type="button" disabled={disabled} role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-label={ariaLabel} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}
        className={className ?? `flex h-12 w-full items-center gap-2 rounded-control bg-surface px-3 text-start text-small sm:h-11 ${invalid ? 'shadow-field-error' : 'shadow-field hover:shadow-field-hover focus-visible:!shadow-field-focus'} disabled:cursor-not-allowed disabled:bg-ground disabled:text-disabled`}>
        {icon && <Icon name={icon} size={18} className="text-ink-3" />}
        <span className={`min-w-0 flex-1 truncate text-start ${chosen ? '' : 'text-ink-3'}`}>{renderValue ? renderValue(chosen) : chosen?.label ?? placeholder ?? ''}</span>
        <Icon name="down" size={16} stroke={2} className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && at && createPortal(
        <ul ref={list} id={listId} role="listbox" aria-label={ariaLabel} tabIndex={-1}
          className="enter fixed z-[80] overflow-y-auto rounded-inner bg-surface p-1 text-ink shadow-floating ring-1 ring-hair"
          style={{ top: at.top, left: at.left, width: at.width, maxHeight: at.maxH }} dir="rtl">
          {options.length === 0 && <li className="px-3 py-2.5 text-small text-ink-3">لا خيارات</li>}
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <li key={o.value} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={on} aria-disabled={o.disabled || undefined}
                onMouseEnter={() => enabled(i) && setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-small ${o.disabled ? 'cursor-default text-disabled' : ''} ${i === active ? 'bg-ground' : ''} ${on ? 'font-bold text-teal' : 'font-medium'}`}>
                <span className="min-w-0 flex-1"><span className="block truncate">{o.label}</span>{o.sub && <span className="block truncate text-cap font-normal text-ink-3">{o.sub}</span>}</span>
                {on && <Icon name="check" size={16} stroke={2.5} className="text-teal" />}
              </li>
            );
          })}
        </ul>, document.body)}
    </>
  );
}
