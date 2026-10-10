import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Button';

export interface RowMenuItem { label: string; icon?: IconName; danger?: boolean; onClick: () => void; hidden?: boolean; divider?: boolean }

/**
 * A row's «⋮» menu whose list floats above the page (a table cell clips what
 * overflows it, so the list is placed on the document, under its button).
 * Arrow keys move, Escape closes and gives focus back to the button.
 */
export const Menu: React.FC<{ label?: string; items: RowMenuItem[] }> = ({ label = 'إجراءات أخرى', items }) => {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const h = list.current?.offsetHeight ?? 0;
      const w = list.current?.offsetWidth ?? 232;
      const below = r.bottom + 4 + h <= window.innerHeight - 8;
      setAt({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - h), left: Math.min(Math.max(8, r.left), window.innerWidth - w - 8) });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const off = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const i = all.indexOf(document.activeElement as HTMLButtonElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (!shown.length) return null;
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <IconButton ref={button} icon="dots" label={label} sm aria-haspopup="menu" aria-expanded={open} onClick={() => { setAt(null); setOpen((o) => !o); }} />
      {open && createPortal(
        <div ref={list} role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}
          className="enter fixed z-[65] min-w-[232px] overflow-hidden rounded-inner bg-surface py-1.5 shadow-floating ring-1 ring-hair"
          style={at ? { top: at.top, left: at.left } : { top: -9999, left: -9999 }}>
          {shown.map((i) => (
            <React.Fragment key={i.label}>
              {i.divider && <div role="separator" className="my-1.5 border-t border-hair" />}
              <button type="button" role="menuitem" onClick={() => { setOpen(false); i.onClick(); }}
                className={`flex h-11 w-full items-center gap-3 px-4 text-start text-small font-medium outline-none hover:bg-ground focus-visible:bg-ground ${i.danger ? 'text-bad' : 'text-ink'}`}>
                {i.icon && <Icon name={i.icon} size={18} className={i.danger ? '' : 'text-ink-2'} />}<span>{i.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>, document.body)}
    </div>
  );
};

/** The name the team pages use. */
export const RowMenu = Menu;
