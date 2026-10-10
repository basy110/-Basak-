import React, { useState } from 'react';
import { Card, num } from '../../ui';

/**
 * The bar lists and panels of the analytics pages (the same style as the
 * company's «التحليلات» and «الإيرادات»): one number per row with a teal bar
 * against the largest, inside a card with a title and one sentence.
 */
export interface Bar { key: string; name: React.ReactNode; note?: React.ReactNode; value: number; display?: React.ReactNode; strong?: boolean }

export const BarList: React.FC<{ rows: Bar[]; limit?: number; empty?: string; max?: number; columns?: boolean }> = ({ rows, limit = 8, empty = 'لا بيانات', max, columns }) => {
  const [all, setAll] = useState(false);
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  const shown = all ? rows : rows.slice(0, limit);
  if (!rows.length) return <p className="m-0 py-2 text-label text-ink-3">{empty}</p>;
  return (
    <>
      <ul className={`m-0 list-none p-0 ${columns ? 'gap-x-10 lg:columns-2' : 'flex flex-col gap-1'}`}>
        {shown.map((r) => (
          <li key={r.key} className={`py-1.5 ${columns ? 'mb-1 break-inside-avoid' : ''}`}>
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-small font-semibold">{r.name}{r.note && <span className="ms-1.5 text-cap font-normal text-ink-3">{r.note}</span>}</span>
              <span className={`flex-none text-small tabular ${r.value ? 'font-semibold' : 'text-ink-3'} ${r.strong ? 'text-warn' : ''}`}>{r.display ?? num(r.value)}</span>
            </span>
            <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded bg-sunken">
              <span className="block h-1.5 rounded bg-teal" style={{ width: `${top > 0 ? Math.max(r.value > 0 ? 2 : 0, Math.round((r.value / top) * 100)) : 0}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="self-start text-label font-medium text-teal hover:underline">
          {all ? 'أقل' : `اعرض الكل (${num(rows.length)})`}
        </button>
      )}
    </>
  );
};

export const Panel: React.FC<{ title: string; sub?: React.ReactNode; end?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, sub, end, children, className = '' }) => (
  <Card as="section" className={`flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5 ${className}`}>
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1"><h3 className="m-0 text-card">{title}</h3>{sub && <div className="text-label text-ink-2">{sub}</div>}</div>
      {end}
    </div>
    {children}
  </Card>
);
