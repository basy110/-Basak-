import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { usePlatformCompanies } from '../lib/reference';

/** The platform admin's way into any company's workspace, from every platform page. */
export const EnterCompany: React.FC = () => {
  const companies = usePlatformCompanies(true).data ?? [];
  const navigate = useNavigate();
  return (
    <label className="relative flex h-11 w-[190px] items-center gap-2 rounded-control bg-surface px-3 text-small font-medium text-ink shadow-ring hover:bg-ground">
      <Icon name="building" size={18} />
      <select aria-label="ادخل إلى شركة" value="" onChange={(e) => { if (e.target.value) navigate(`/c/${e.target.value}`); }}
        className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pe-6 outline-none">
        <option value="" disabled>ادخل إلى شركة</option>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Icon name="down" size={16} stroke={2} className="pointer-events-none absolute end-3" />
    </label>
  );
};
