import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../ui/Icon';
import { StatePill } from '../ui/Status';
import { Button, IconButton } from '../ui/Button';
import { num } from '../ui/format';
import { supabase } from '../lib/supabase';
import { keys, unwrap } from '../lib/query';
import { usePlatformCompanies } from '../lib/reference';
import type { PlatformNumbers } from '../lib/overview';
import type { CompanyScope } from '../lib/adminScope';

/** «806 طالباً», «50 طالباً», «0 طالب» — the number always shown. */
const studentsText = (n: number) => `${num(n)} ${n === 2 ? 'طالبان' : n >= 3 && n <= 10 ? 'طلاب' : n > 10 ? 'طالباً' : 'طالب'}`;

/** Arabic letters that are written several ways, folded so «الهدي» finds «الهدى». */
const fold = (s: string) => s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();

/**
 * The super admin's way to another company from inside one (AdmPlatWsSwitcher):
 * a search, each company with its students and its state, the current one ticked.
 * Picking one keeps the same page. On a phone it is a sheet from the bottom.
 */
export const CompanySwitcher: React.FC<{ company: CompanyScope }> = ({ company }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const companies = usePlatformCompanies(true).data ?? [];
  // Students per company, from the platform's own numbers; asked for only once the list is opened.
  const numbers = useQuery({
    queryKey: keys.platform('overview'), enabled: open,
    queryFn: () => unwrap<PlatformNumbers>(supabase.rpc('platform_overview')),
  }).data;
  const members = useMemo(() => new Map((numbers?.per_company ?? []).map((c) => [c.company.id, c.members])), [numbers]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const page = pathname.split('/').slice(3, 4).join('/');
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 639px)').matches);

  useEffect(() => {
    if (!open) return undefined;
    setPhone(window.matchMedia('(max-width: 639px)').matches);
    const t = window.setTimeout(() => input.current?.focus(), 0);
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key);
    return () => { window.clearTimeout(t); document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => { setOpen(false); setQ(''); }, [pathname]);

  const list = (companies.length ? companies : [{ id: company.id, name: company.name, status: company.status }])
    .filter((c) => !q.trim() || fold(c.name).includes(fold(q)))
    .sort((a, b) => Number(b.id === company.id) - Number(a.id === company.id));
  const go = (id: string) => { setOpen(false); if (id !== company.id) navigate(`/c/${id}${page ? `/${page}` : ''}`); };

  const rows = (
    <ul role="listbox" aria-label="الشركات" className="flex flex-col gap-1 overflow-y-auto p-2 pt-0">
      {list.length === 0 && <li className="px-3 py-4 text-small text-ink-2">لا شركة بهذا الاسم.</li>}
      {list.map((c) => {
        const on = c.id === company.id;
        const n = members.get(c.id);
        return (
          <li key={c.id} role="option" aria-selected={on}>
            <button type="button" onClick={() => go(c.id)}
              className={`flex min-h-14 w-full items-center gap-3 rounded-control px-3 py-2 text-start ${on ? 'bg-teal-tint' : 'hover:bg-ground'}`}>
              <Icon name="building" size={18} className="text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-small ${on ? 'font-semibold' : 'font-medium'}`}>{c.name}</span>
                <span className="block text-cap text-ink-3">{n == null ? '' : studentsText(n)}</span>
              </span>
              {c.status === 'suspended' && <StatePill state="suspended" />}
              {c.status === 'archived' && <StatePill state="archived" />}
              {on && <Icon name="check" size={18} stroke={2.25} className="text-teal" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
  const search = (
    <label className="flex h-12 flex-none items-center gap-2.5 rounded-control bg-ground px-3 text-ink-3 shadow-ring focus-within:!shadow-field-focus sm:h-11 sm:bg-surface">
      <Icon name="search" size={18} />
      <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم الشركة" aria-label="ابحث باسم الشركة"
        className="h-full min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-ink-3" />
    </label>
  );

  return (
    <>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-label="الانتقال إلى شركة أخرى" onClick={() => setOpen((o) => !o)}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control bg-white/[.12] px-3 text-small font-medium text-white sm:w-[220px] sm:flex-none">
        <Icon name="building" size={18} />
        <span className="min-w-0 flex-1 truncate text-start">{company.name}</span>
        <Icon name="down" size={16} stroke={2} />
      </button>
      {open && !phone && (
        <div ref={box} className="enter fixed start-auto top-[44px] z-[70] flex max-h-[min(560px,80vh)] w-[340px] flex-col overflow-hidden rounded-inner bg-surface text-ink shadow-floating ring-1 ring-hair"
          style={{ top: (button.current?.getBoundingClientRect().bottom ?? 40) + 4, right: Math.max(8, window.innerWidth - (button.current?.getBoundingClientRect().right ?? 0) - 120) }}>
          <div className="flex flex-none flex-col gap-2 p-3 pb-2">{search}<p className="m-0 px-1 text-cap text-ink-2">تبقى في الصفحة نفسها في الشركة التي تختارها</p></div>
          {rows}
          <Link to="/platform/companies" onClick={() => setOpen(false)} className="flex h-12 flex-none items-center justify-between border-t border-hair px-4 text-label font-medium text-teal hover:bg-ground">
            <span>كل الشركات ({num(companies.length)})</span><Icon name="fwd" size={16} stroke={2} />
          </Link>
        </div>
      )}
      {open && phone && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end bg-[rgba(23,56,74,.45)]">
          <div ref={box} role="dialog" aria-modal="true" aria-labelledby="switch-title" className="enter flex max-h-[85vh] w-full flex-col gap-3 rounded-t-dialog bg-surface pb-4 pt-3 text-ink shadow-floating">
            <div className="flex items-center gap-2 pe-2 ps-4"><h2 id="switch-title" className="m-0 flex-1 text-section">الانتقال إلى شركة أخرى</h2><IconButton icon="x" label="إغلاق" tone="ink" onClick={() => setOpen(false)} /></div>
            <div className="px-3">{search}</div>
            {rows}
            <div className="px-3"><Button kind="secondary" icon="arrowBack" full to="/platform/companies">العودة إلى المنصة</Button></div>
          </div>
        </div>, document.body)}
    </>
  );
};
