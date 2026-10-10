import React from 'react';
import { SkeletonStat, SkeletonTable as Table } from '../ui/Feedback';


/** A page's shape while its code or first data arrives: header, three numbers, a table. */
export const SkeletonPage: React.FC = () => (
  <div aria-busy="true" className="mx-auto flex w-full max-w-[1920px] flex-col gap-6">
    <div className="flex flex-col gap-2"><span className="skeleton block h-8 w-48 rounded-lg" /><span className="skeleton block h-3 w-72 rounded" /></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
    <Table rows={6} />
  </div>
);

/** While the session is checked: the frame of the dashboard, not a blank page. */
export const SkeletonShell: React.FC = () => (
  <div aria-busy="true" className="flex min-h-screen bg-ground">
    <div className="hidden w-[72px] flex-none border-e border-hair bg-surface sm:block lg:w-[264px]">
      <div className="flex h-16 items-center gap-3 border-b border-hair px-5"><span className="skeleton block h-9 w-9 rounded-control" /><span className="skeleton hidden h-3 w-24 rounded lg:block" /></div>
      <div className="flex flex-col gap-3 p-4">{Array.from({ length: 9 }, (_, i) => <span key={i} className="skeleton block h-6 rounded-md" />)}</div>
    </div>
    <div className="flex flex-1 flex-col">
      <div className="h-14 border-b border-hair bg-surface sm:h-16" />
      <div className="p-4 sm:p-8"><SkeletonPage /></div>
    </div>
  </div>
);

