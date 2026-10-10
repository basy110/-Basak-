import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { CountBadge } from '../ui/Status';
import { Button, IconButton } from '../ui/Button';
import { Drawer } from '../ui/Overlay';
import { OfflineBar, Toaster } from '../ui/Feedback';
import { PhoneHeadProvider, usePhoneHead } from '../ui/Layout';
import { activeItem, type BadgeKey, type NavGroup, type NavItem } from '../lib/nav';
import { StudentSearch } from './StudentSearch';
import { EnterCompany } from './EnterCompany';

export interface Who { name: string; roleLabel: string; initial: string }
export type ShellRole = 'company' | 'platform' | 'workspace';

interface ShellProps {
  role: ShellRole;
  groups: NavGroup[];
  /** `/c/<id>` or `/platform`. */
  base: string;
  /** Under the product name: «لوحة الشركة» / «إدارة المنصة»; in the phone drawer: the company. */
  scope: string;
  /** The company whose workspace is open (breadcrumb, drawer). */
  companyName?: string;
  companyId?: string;
  /** The company's mark, in place of the bus when the company has one. */
  mark?: React.ReactNode;
  who: Who;
  badges: Partial<Record<BadgeKey, number>>;
  onLogout: () => void;
  /** The ink return bar of a super admin inside a company. */
  workspaceBar?: React.ReactNode;
  children: React.ReactNode;
}

const COLLAPSE_KEY = 'basak.admin.navCollapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

const to = (base: string, item: NavItem) => (item.slug ? `${base}/${item.slug}` : base);

const Brand: React.FC<{ mark?: React.ReactNode; scope: string; iconOnly?: boolean }> = ({ mark, scope, iconOnly }) => (
  <div className="flex min-w-0 flex-1 items-center gap-3">
    {mark ?? <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-control bg-ink text-white"><Icon name="bus" size={18} /></span>}
    {!iconOnly && <div className="min-w-0"><div className="text-[16px] font-semibold leading-[22px]">باصك</div><div className="truncate text-cap text-ink-3">{scope}</div></div>}
  </div>
);

/** One navigation entry: 40 high in the sidebar, 48 in the phone drawer. */
const NavRow: React.FC<{ base: string; item: NavItem; count?: number; tall?: boolean; onClick?: () => void }> = ({ base, item, count = 0, tall, onClick }) => (
  <NavLink to={to(base, item)} end={!item.slug} onClick={onClick} onMouseEnter={item.preload} onFocus={item.preload} onTouchStart={item.preload}
    className={({ isActive }) => `relative flex items-center gap-3 rounded-control px-3 ${tall ? 'h-12 text-body' : 'h-10 text-small'} ${isActive ? 'bg-teal-tint font-semibold text-teal' : 'text-ink hover:bg-ground'}`}>
    {({ isActive }) => (
      <>
        {isActive && <span aria-hidden="true" className="absolute -start-3 bottom-2 top-2 w-[3px] rounded-sm bg-teal" />}
        <span className={`flex ${isActive ? 'text-teal' : 'text-ink-2'}`}><Icon name={item.icon} size={18} /></span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <CountBadge n={count} />
      </>
    )}
  </NavLink>
);

const NavGroups: React.FC<{ base: string; groups: NavGroup[]; badges: ShellProps['badges']; tall?: boolean; onNavigate?: () => void }> = ({ base, groups, badges, tall, onNavigate }) => (
  <>
    {groups.map((g, gi) => (
      <div key={gi} className="flex flex-col gap-0.5">
        {g.group && <div className={`px-3 pb-1 text-cap font-medium text-ink-3 ${tall ? 'pt-3.5' : 'pt-3'}`}>{g.group}</div>}
        {g.items.map((it) => <NavRow key={it.id} base={base} item={it} count={it.badge ? badges[it.badge] : 0} tall={tall} onClick={onNavigate} />)}
      </div>
    ))}
  </>
);

/** Desktop: 264 with every destination; collapsible to the 72 rail. Tablet: the rail, expanding over the page. */
const SideNav: React.FC<ShellProps & { collapsed: boolean; setCollapsed: (c: boolean) => void }> = (p) => {
  const [expanded, setExpanded] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setExpanded(false); }, [pathname]);
  const full = (
    <nav aria-label="التنقل الرئيسي" className="flex h-full w-[264px] flex-col border-e border-hair bg-surface">
      <div className="flex h-16 flex-none items-center gap-2 border-b border-hair px-5"><Brand mark={p.mark} scope={p.scope} />
        {expanded && <IconButton icon="x" label="إغلاق القائمة" onClick={() => setExpanded(false)} />}</div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4 pt-3"><NavGroups base={p.base} groups={p.groups} badges={p.badges} /></div>
      <div className="hidden flex-none border-t border-hair p-3 lg:block">
        <button type="button" onClick={() => p.setCollapsed(true)} className="flex h-10 w-full items-center gap-3 rounded-control px-3 text-label text-ink-2 hover:bg-ground">
          <Icon name="panel" size={18} /><span>تصغير القائمة</span>
        </button>
      </div>
    </nav>
  );
  const rail = (
    <nav aria-label="التنقل الرئيسي" className="flex h-full w-[72px] flex-col items-center border-e border-hair bg-surface">
      <div className="flex h-16 flex-none items-center justify-center self-stretch border-b border-hair"><Brand mark={p.mark} scope={p.scope} iconOnly /></div>
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        <button type="button" aria-label="توسيع القائمة لإظهار الأسماء" onClick={() => (p.collapsed ? p.setCollapsed(false) : setExpanded(true))}
          className="flex h-11 w-11 items-center justify-center rounded-control text-ink-2 hover:bg-ground"><Icon name="menu" size={20} /></button>
        {p.groups.map((g, gi) => (
          <React.Fragment key={gi}>
            {gi > 0 && <span aria-hidden="true" className="my-1.5 h-px w-7 bg-hair" />}
            {g.items.map((it) => {
              const n = it.badge ? p.badges[it.badge] ?? 0 : 0;
              return (
                <NavLink key={it.id} to={to(p.base, it)} end={!it.slug} aria-label={it.label} onMouseEnter={it.preload} onFocus={it.preload}
                  className={({ isActive }) => `group relative flex h-11 w-11 items-center justify-center rounded-control ${isActive ? 'bg-teal-tint text-teal' : 'text-ink-2 hover:bg-ground'}`}>
                  <Icon name={it.icon} size={20} />
                  {n > 0 && <CountBadge n={n} className="absolute -end-1 -top-0.5 !h-[18px] !min-w-[18px] !px-1 !text-[11px] !leading-[18px] shadow-[0_0_0_2px_#fff]" />}
                  <span role="tooltip" className="pointer-events-none absolute start-[54px] top-1.5 z-40 hidden h-8 whitespace-nowrap rounded-control bg-ink px-3 text-label font-medium leading-8 text-white shadow-floating group-hover:block group-focus-visible:block">{it.label}</span>
                </NavLink>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
  return (
    <>
      <div className={`sticky top-[var(--ws-top,0px)] hidden h-[calc(100vh-var(--ws-top,0px))] flex-none sm:block ${p.collapsed ? '' : 'lg:hidden'}`}>{rail}</div>
      <div className={`sticky top-[var(--ws-top,0px)] hidden h-[calc(100vh-var(--ws-top,0px))] flex-none ${p.collapsed ? '' : 'lg:block'}`}>{full}</div>
      {expanded && (
        <div className="fixed inset-0 z-50 hidden bg-[rgba(23,56,74,.45)] sm:block" onMouseDown={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}>
          <div className="h-full w-[264px] shadow-floating">{full}</div>
        </div>
      )}
    </>
  );
};

const Person: React.FC<{ who: Who; compact?: boolean }> = ({ who, compact }) => (
  <div className="flex min-w-0 items-center gap-2.5">
    <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-teal-tint text-[15px] font-semibold text-teal">{who.initial}</span>
    {!compact && <div className="min-w-0"><div className="truncate text-small font-medium">{who.name}</div><div className="text-cap text-ink-3">{who.roleLabel}</div></div>}
  </div>
);

/** The frame shared by the platform area and every company workspace. */
export const AppShell: React.FC<ShellProps> = (p) => {
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = useCallback((c: boolean) => { setCollapsedState(c); try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch { /* private window */ } }, []);
  return (
    <PhoneHeadProvider>
      <div className="flex min-h-screen flex-col bg-ground text-ink">
        {p.workspaceBar}
        <div className="flex min-h-0 flex-1">
          <SideNav {...p} collapsed={collapsed} setCollapsed={setCollapsed} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar {...p} />
            <OfflineBar />
            <main id="main" className="flex flex-1 flex-col px-4 pb-6 pt-4 sm:px-6 sm:pb-10 sm:pt-6 lg:px-8 lg:pt-7">{p.children}</main>
          </div>
        </div>
        <Toaster />
      </div>
    </PhoneHeadProvider>
  );
};

const TopBar: React.FC<ShellProps> = (p) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const head = usePhoneHead();
  const [menu, setMenu] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState(false);
  useEffect(() => { setMenu(false); setPhoneSearch(false); }, [pathname]);
  const item = activeItem(p.groups, pathname.slice(p.base.length));
  const crumbs = [p.role === 'platform' ? 'المنصة' : p.companyName ?? '', head.back?.label ?? item?.label ?? '', head.back ? head.title : undefined].filter(Boolean) as string[];
  const anyBadge = Object.values(p.badges).some((n) => (n ?? 0) > 0);
  const searchRef = useRef<HTMLInputElement>(null);
  // «/» focuses the student search from anywhere but a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      e.preventDefault(); searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      {/* Desktop and tablet: 64 */}
      <header className="sticky top-[var(--ws-top,0px)] z-30 hidden h-16 flex-none items-center gap-3 border-b border-hair bg-surface px-5 sm:flex lg:gap-4 lg:px-8">
        <nav aria-label="مسار الصفحة" className="flex min-w-0 flex-1 items-center gap-1.5 text-small">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icon name="fwd" size={14} stroke={2} className="text-disabled" />}
              {i === 1 && head.back ? <Link to={head.back.to} className="flex-none text-ink-3 hover:text-teal">{c}</Link>
                : <span className={`truncate ${i === crumbs.length - 1 ? 'min-w-0 font-semibold text-ink' : 'flex-none text-ink-3'}`}>{c}</span>}
            </React.Fragment>
          ))}
        </nav>
        <StudentSearch role={p.role} base={p.base} companyId={p.companyId} inputRef={searchRef} className="w-[280px] lg:w-[380px]" />
        <span className="hidden flex-1 lg:block" />
        {p.role === 'platform' && <div className="hidden lg:block"><EnterCompany /></div>}
        <span aria-hidden="true" className="h-7 w-px flex-none bg-hair" />
        <div className="lg:hidden"><Person who={p.who} compact /></div>
        <div className="hidden lg:block"><Person who={p.who} /></div>
        <div className="lg:hidden"><IconButton icon="logout" label="تسجيل الخروج" onClick={p.onLogout} /></div>
        <div className="hidden lg:block"><Button kind="outline" sm icon="logout" onClick={p.onLogout}>خروج</Button></div>
      </header>
      {/* Phone: 56, sticky */}
      <header className="sticky top-[var(--ws-top,0px)] z-30 flex h-14 flex-none items-center gap-1 border-b border-hair bg-surface px-1 sm:hidden">
        {phoneSearch ? (
          <>
            <IconButton icon="arrowBack" label="إغلاق البحث" tone="ink" onClick={() => setPhoneSearch(false)} />
            <StudentSearch role={p.role} base={p.base} companyId={p.companyId} autoFocus className="me-2 flex-1" />
          </>
        ) : (
          <>
            {head.back
              ? <IconButton icon="arrowBack" label={`رجوع إلى ${head.back.label}`} tone="ink" onClick={() => navigate(head.back!.to)} />
              : <IconButton icon="menu" label="فتح القائمة" tone="ink" dot={anyBadge} onClick={() => setMenu(true)} />}
            <h1 className="m-0 min-w-0 flex-1 truncate text-[17px] font-semibold leading-[26px]" aria-hidden="true">{head.title ?? item?.label ?? ''}</h1>
            <IconButton icon="search" label="ابحث عن طالب" tone="ink" onClick={() => setPhoneSearch(true)} />
          </>
        )}
      </header>
      <Drawer open={menu} onClose={() => setMenu(false)} label="التنقل الرئيسي">
        <div className="flex h-14 flex-none items-center gap-2 border-b border-hair pe-1 ps-4">
          <Brand mark={p.mark} scope={p.role === 'platform' ? p.scope : p.companyName ?? p.scope} />
          <IconButton icon="x" label="إغلاق القائمة" tone="ink" onClick={() => setMenu(false)} />
        </div>
        {p.role === 'workspace' && <div className="flex-none px-3 pt-3"><Button kind="secondary" icon="arrowBack" full to="/platform/companies">العودة إلى المنصة</Button></div>}
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4 pt-2"><NavGroups base={p.base} groups={p.groups} badges={p.badges} tall onNavigate={() => setMenu(false)} /></div>
        <div className="flex flex-none flex-col gap-3 border-t border-hair px-4 pb-4 pt-3">
          <Person who={p.who} />
          <Button kind="secondary" icon="logout" full onClick={p.onLogout}>تسجيل الخروج</Button>
        </div>
      </Drawer>
    </>
  );
};
