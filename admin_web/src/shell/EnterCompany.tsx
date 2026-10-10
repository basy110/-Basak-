import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Select } from '../ui/Select';
import { usePlatformCompanies } from '../lib/reference';

/** The platform admin's way into any company's workspace, from every platform page. */
export const EnterCompany: React.FC = () => {
  const companies = usePlatformCompanies(true).data ?? [];
  const navigate = useNavigate();
  return (
    <Select<string> value="" onChange={(id) => navigate(`/c/${id}`)} ariaLabel="ادخل إلى شركة"
      placeholder="ادخل إلى شركة" icon="building" minListWidth={240}
      options={companies.map((c) => ({ value: c.id, label: c.name }))}
      className="relative flex h-11 w-[200px] items-center gap-2 rounded-control bg-surface px-3 text-small font-semibold text-ink shadow-ring hover:bg-ground" />
  );
};
