import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBox } from '../ui/Table';
import { Icon } from '../ui/Icon';
import { phoneText } from '../ui/format';
import { supabase } from '../lib/supabase';
import type { ShellRole } from './AppShell';

interface Hit { id: string; name: string; phone: string; sub: string }

/**
 * The global search: a student by name or phone. Up to six matches drop down;
 * picking one opens that student; Enter opens the students list filtered by the words.
 */
export const StudentSearch: React.FC<{ role: ShellRole; base: string; companyId?: string; className?: string; inputRef?: React.Ref<HTMLInputElement>; autoFocus?: boolean }> = ({ role, base, companyId, className = '', inputRef, autoFocus }) => {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const navigate = useNavigate();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const own = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) own.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return undefined; }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        let found: Hit[];
        if (role !== 'platform' && companyId) {
          // Loaded when the admin first types: the students code is not on every page's first paint.
          const { fetchStudentsPage } = await import('../lib/students');
          const page = await fetchStudentsPage({ companyId, search: term, limit: 6, offset: 0, withTotal: false });
          found = page.rows.map((s) => ({ id: s.id, name: s.full_name, phone: s.phone, sub: s.university }));
        } else {
          const { data } = await supabase.rpc('platform_students', { p_search: term, p_company_id: null, p_membership: null, p_limit: 6, p_offset: 0 });
          found = ((data as { rows?: { id: string; full_name: string; phone: string; university: string }[] } | null)?.rows ?? [])
            .map((s) => ({ id: s.id, name: s.full_name, phone: s.phone, sub: s.university }));
        }
        if (!cancelled) { setHits(found); setCursor(-1); }
      } catch { if (!cancelled) setHits([]); }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q, role, companyId]);

  useEffect(() => {
    if (!open) return undefined;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);

  const list = role === 'platform' ? '/platform/students' : `${base}/students`;
  const go = (hit?: Hit) => {
    setOpen(false);
    if (hit) navigate(`${list}?student=${hit.id}`);
    else if (q.trim()) navigate(`${list}?q=${encodeURIComponent(q.trim())}`);
    setQ('');
  };
  const setRefs = (el: HTMLInputElement | null) => {
    (own as React.MutableRefObject<HTMLInputElement | null>).current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  return (
    <div ref={box} className={`relative ${className}`} role="combobox" aria-expanded={open && !!hits} aria-owns={listId} aria-haspopup="listbox">
      <SearchBox value={q} onChange={(v) => { setQ(v); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="ابحث عن طالب بالاسم أو رقم الهاتف" kbd inputRef={setRefs}
        className="!bg-ground"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min((hits?.length ?? 0) - 1, c + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(-1, c - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(cursor >= 0 ? hits?.[cursor] : undefined); }
          else if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }} />
      {open && hits && (
        <ul id={listId} role="listbox" className="enter absolute inset-x-0 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-inner bg-surface py-1 shadow-floating ring-1 ring-hair">
          {hits.length === 0 && <li className="px-4 py-3 text-small text-ink-2">لا يوجد طالب بهذا الاسم أو الرقم.</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === cursor}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-start ${i === cursor ? 'bg-ground' : 'hover:bg-ground'}`}>
                <Icon name="user" size={18} className="text-ink-3" />
                <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium">{h.name}</span><span className="block truncate text-cap text-ink-3">{h.sub}</span></span>
                <span dir="ltr" className="text-cap text-ink-2 [unicode-bidi:isolate]">{phoneText(h.phone)}</span>
              </button>
            </li>
          ))}
          {q.trim() && <li><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go()} className="flex w-full items-center gap-2 border-t border-hair px-4 py-2.5 text-start text-label font-medium text-teal hover:bg-ground"><Icon name="search" size={16} />كل النتائج لـ «{q.trim()}»</button></li>}
        </ul>
      )}
    </div>
  );
};
