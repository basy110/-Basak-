import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { StatePill } from '../ui/Status';
import { usePlatformCompanies } from '../lib/reference';
import type { CompanyScope } from '../lib/adminScope';

/**
 * A super admin inside a company: says whose workspace is open, the way back,
 * and a switcher to another company that keeps the same page.
 */
export const WorkspaceBar: React.FC<{ company: CompanyScope }> = ({ company }) => {
  const companies = usePlatformCompanies(true).data ?? [];
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const page = pathname.split('/').slice(3, 4).join('/');
  // Panels and dialogs open under this bar, so «you are inside a company» stays in sight.
  useEffect(() => {
    document.documentElement.style.setProperty('--ws-top', '48px');
    return () => { document.documentElement.style.removeProperty('--ws-top'); };
  }, []);
  const switcher = (cls: string) => (
    <label className={`relative flex h-9 items-center gap-2 rounded-control bg-white/[.12] px-3 text-small font-medium text-white ${cls}`}>
      <Icon name="building" size={18} />
      <select aria-label="الانتقال إلى شركة أخرى" value={company.id} onChange={(e) => navigate(`/c/${e.target.value}${page ? `/${page}` : ''}`)}
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pe-6 outline-none [&>option]:text-ink">
        {(companies.length ? companies : [{ id: company.id, name: company.name }]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Icon name="down" size={16} stroke={2} className="pointer-events-none absolute end-2.5" />
    </label>
  );
  return (
    <div className="sticky top-0 z-[65] flex h-12 flex-none items-center gap-2 bg-ink px-2 py-1.5 ps-4 text-white sm:gap-3 sm:px-5">
      <Link to="/platform/companies" className="inline-flex h-9 flex-none items-center gap-1.5 rounded-control bg-white/[.12] px-2.5 text-label font-medium text-white sm:gap-2 sm:px-3 sm:text-small">
        <Icon name="arrowBack" size={16} stroke={2} /><span className="sm:hidden">المنصة</span><span className="hidden sm:inline">العودة إلى المنصة</span>
      </Link>
      <span className="hidden text-small text-[#C9D8E1] sm:inline">أنت الآن داخل شركة</span>
      {switcher('min-w-0 flex-1 sm:w-[220px] sm:flex-none')}
      {company.status !== 'active' && <StatePill state={company.status === 'suspended' ? 'suspended' : 'archived'} />}
      <span className="hidden flex-1 lg:block" />
      <span className="hidden text-label text-[#C9D8E1] lg:inline">كل ما تغيّره هنا يتغيّر عند الشركة وطلابها</span>
    </div>
  );
};
