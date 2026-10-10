import React from 'react';
import { SkeletonCards as Cards, SkeletonForm as Form, SkeletonList, SkeletonStat, SkeletonTable as Table, SkeletonText } from '../ui/Feedback';

/** Kept for the pages that still import the older names; new code imports from ui/. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => <span aria-hidden="true" className={`skeleton block rounded-md ${className}`} />;
export const SkeletonTable: React.FC<{ rows?: number; cols?: number; columns?: number }> = ({ rows, cols, columns }) => <Table rows={rows} cols={cols ?? columns} />;
export const SkeletonRows: React.FC<{ rows?: number }> = (p) => <SkeletonList {...p} />;
export const SkeletonCards: React.FC<{ count?: number; rows?: number; columns?: number }> = ({ count, rows }) => <Cards rows={rows ?? count} />;
export const SkeletonForm: React.FC<{ rows?: number; fields?: number }> = ({ rows, fields }) => <Form rows={rows ?? fields} />;

/** A page's shape while its code or first data arrives: header, three numbers, a table. */
export const SkeletonPage: React.FC = () => (
  <div aria-busy="true" className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
    <div className="flex flex-col gap-2"><span className="skeleton block h-8 w-48 rounded-lg" /><span className="skeleton block h-3 w-72 rounded" /></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
    <Table rows={6} />
    <SkeletonText rows={0} />
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

/** A quiet «refreshing» note beside a list that is being re-read behind what it shows. */
export const Refreshing: React.FC<{ active: boolean }> = ({ active }) => (
  active ? <span className="text-cap text-ink-3" role="status">جارٍ التحديث…</span> : null
);
