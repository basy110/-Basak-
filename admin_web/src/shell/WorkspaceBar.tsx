import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { StatePill } from '../ui/Status';
import { CompanySwitcher } from './CompanySwitcher';
import type { CompanyScope } from '../lib/adminScope';

/**
 * A super admin inside a company: says whose workspace is open, the way back,
 * and a switcher to another company that keeps the same page.
 */
export const WorkspaceBar: React.FC<{ company: CompanyScope }> = ({ company }) => {
  // Panels and dialogs open under this bar, so «you are inside a company» stays in sight.
  useEffect(() => {
    document.documentElement.style.setProperty('--ws-top', '48px');
    return () => { document.documentElement.style.removeProperty('--ws-top'); };
  }, []);
  return (
    <div className="sticky top-0 z-[65] flex h-12 flex-none items-center gap-2 bg-ink px-2 py-1.5 ps-4 text-white sm:gap-3 sm:px-5">
      <Link to="/platform/companies" className="inline-flex h-9 flex-none items-center gap-1.5 rounded-control bg-white/[.12] px-2.5 text-label font-medium text-white sm:gap-2 sm:px-3 sm:text-small">
        <Icon name="arrowBack" size={16} stroke={2} /><span className="sm:hidden">المنصة</span><span className="hidden sm:inline">العودة إلى المنصة</span>
      </Link>
      <span className="hidden text-small text-[#C9D8E1] sm:inline">أنت الآن داخل شركة</span>
      <CompanySwitcher company={company} />
      {company.status !== 'active' && <StatePill state={company.status === 'suspended' ? 'suspended' : 'archived'} />}
      <span className="hidden flex-1 lg:block" />
      <span className="hidden text-label text-[#C9D8E1] lg:inline">كل ما تغيّره هنا يتغيّر عند الشركة وطلابها</span>
    </div>
  );
};
