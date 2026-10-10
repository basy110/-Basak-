import React from 'react';
import { Icon } from './Icon';
import { Checkbox } from './Field';
import { Button } from './Button';
import { Select } from './Select';

/* ── Toolbar parts ───────────────────────────────────────────────────── */
export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; className?: string; inputRef?: React.Ref<HTMLInputElement>; onFocus?: () => void; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>; kbd?: boolean; label?: string }> = ({ value, onChange, placeholder, className = '', inputRef, onFocus, onKeyDown, kbd, label }) => (
  <label className={`flex h-12 items-center gap-2.5 rounded-control bg-surface px-3 text-ink-3 shadow-ring focus-within:!shadow-field-focus sm:h-11 ${className}`}>
    <Icon name="search" size={18} />
    <input ref={inputRef} type="search" value={value} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} onKeyDown={onKeyDown}
      placeholder={placeholder} aria-label={label ?? placeholder} className="h-full min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden" />
    {value ? <button type="button" aria-label="مسح البحث" onClick={() => onChange('')} className="flex h-8 w-8 items-center justify-center rounded-control hover:bg-sunken"><Icon name="x" size={16} /></button>
      : kbd ? <span aria-hidden="true" dir="ltr" className="hidden h-[22px] min-w-[22px] rounded-md bg-surface px-1.5 text-center text-cap leading-[22px] text-ink-3 shadow-ring lg:block">/</span> : null}
  </label>
);

export const Chip: React.FC<{ on?: boolean; onClick: () => void; count?: number | string; children: React.ReactNode }> = ({ on, onClick, count, children }) => (
  <button type="button" aria-pressed={!!on} onClick={onClick}
    className={`inline-flex h-10 flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-label sm:h-9 ${on ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink shadow-ring hover:bg-ground'}`}>
    <span>{children}</span>{count != null && <span className={`text-cap tabular ${on ? 'text-[#C9D8E1]' : 'text-ink-3'}`}>{count}</span>}
  </button>
);
export function Chips<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; count?: number | string }[] }) {
  return (
    <div role="group" aria-label="تصفية" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {options.map((o) => <Chip key={o.value} on={o.value === value} count={o.count} onClick={() => onChange(o.value)}>{o.label}</Chip>)}
    </div>
  );
}
export function SortSelect<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[] }) {
  return (
    <Select value={value} onChange={onChange} options={options} ariaLabel="الترتيب" icon="sort" minListWidth={220}
      className="inline-flex h-10 flex-none items-center gap-1.5 rounded-control px-2.5 text-label font-semibold text-teal hover:bg-ground sm:h-9 sm:text-ink sm:shadow-ring" />
  );
}

/** Search → filter chips → count → sort → actions. On a phone: search on its own row, chips scroll sideways. */
export interface BulkBar {
  count: number; onClear: () => void; actions: React.ReactNode;
  /** «حدّد كل الـ 442»: offered when every row on the page is chosen and more rows match. */
  total?: number; onAll?: () => void;
}
export const Toolbar: React.FC<{ search?: React.ReactNode; filters?: React.ReactNode; count?: React.ReactNode; sort?: React.ReactNode; actions?: React.ReactNode; bulk?: BulkBar | null }> = ({ search, filters, count, sort, actions, bulk }) => bulk && bulk.count > 0 ? (
  <div className="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 rounded-inner bg-teal px-4 py-2 text-white sm:rounded-none">
    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-2 text-label font-extrabold tabular text-teal">{bulk.count.toLocaleString('en-US')}</span>
    <span className="text-small font-bold">{bulk.total != null && bulk.count >= bulk.total ? 'كل الصفوف محددة' : 'محدد'}</span>
    {bulk.onAll && bulk.total != null && bulk.count < bulk.total && (
      <button type="button" onClick={bulk.onAll} className="rounded-control px-2 py-1 text-label font-bold underline underline-offset-4 hover:bg-white/15">حدّد كل الـ {bulk.total.toLocaleString('en-US')}</button>
    )}
    <button type="button" onClick={bulk.onClear} className="rounded-control px-2 py-1 text-label font-semibold text-white/85 hover:bg-white/15">إلغاء التحديد</button>
    <span className="flex-1" />
    <div className="flex flex-wrap items-center gap-2 [&_button]:shadow-none">{bulk.actions}</div>
  </div>
) : (
  <div className="flex flex-col gap-3 sm:min-h-[60px] sm:flex-row sm:flex-wrap sm:items-center sm:border-b sm:border-hair sm:px-4 sm:py-2">
    {search && <div className="sm:w-[300px]">{search}</div>}
    {filters}
    <span className="hidden flex-1 sm:block" />
    {(count || sort) && <div className="flex min-h-6 items-center gap-2 sm:contents"><span className="flex-1 whitespace-nowrap text-label font-semibold text-ink-2 sm:flex-none">{count}</span>{sort}</div>}
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

/** «1–25 من 442» and page buttons; on a phone «السابق / التالي». 25 rows a page; nothing under 26 rows. */
export const Pager: React.FC<{ page: number; pageSize?: number; total: number; onPage: (p: number) => void }> = ({ page, pageSize = 25, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1; const to = Math.min(total, page * pageSize);
  const count = <span className="text-label text-ink-2"><span dir="ltr">{from}–{to}</span> من <span className="tabular">{total.toLocaleString('en-US')}</span></span>;
  const nums: (number | '…')[] = pages <= 6 ? Array.from({ length: pages }, (_, i) => i + 1)
    : page <= 3 ? [1, 2, 3, 4, '…', pages] : page >= pages - 2 ? [1, '…', pages - 3, pages - 2, pages - 1, pages] : [1, '…', page - 1, page, page + 1, '…', pages];
  const b = 'inline-flex h-9 min-w-9 items-center justify-center rounded-control px-2 text-label disabled:text-disabled';
  return (
    <>
      <div className="flex items-center gap-2 sm:hidden">
        <span className="flex-1">{count}</span>
        <Button kind="outline" sm className="!h-11" disabled={page === 1} onClick={() => onPage(page - 1)}>السابق</Button>
        <Button kind="outline" sm className="!h-11" disabled={page === pages} onClick={() => onPage(page + 1)}>التالي</Button>
      </div>
      <nav aria-label="صفحات الجدول" className="hidden h-14 items-center gap-4 border-t border-hair px-4 sm:flex">
        {count}<span className="flex-1" />
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="الصفحة السابقة" className={`${b} hover:bg-ground`} disabled={page === 1} onClick={() => onPage(page - 1)}><Icon name="back" size={16} stroke={2} /></button>
          {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="min-w-6 text-center text-ink-3">…</span>
            : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)} className={`${b} tabular ${n === page ? 'bg-ink font-semibold text-white' : 'hover:bg-ground'}`}>{n}</button>)}
          <button type="button" aria-label="الصفحة التالية" className={`${b} hover:bg-ground`} disabled={page === pages} onClick={() => onPage(page + 1)}><Icon name="fwd" size={16} stroke={2} /></button>
        </div>
      </nav>
    </>
  );
};

/* ── The table and its phone form ────────────────────────────────────── */
export interface Column<T> {
  key: string; label: React.ReactNode; w?: number; align?: 'start' | 'end' | 'center';
  /** Dropped on tablet widths (640–1023). */
  hideTablet?: boolean;
  render: (row: T) => React.ReactNode;
}
/** The phone card of a row: the same fields in the same order as the columns; column 1 is the title. */
export interface CardSpec { title: React.ReactNode; sub?: React.ReactNode; end?: React.ReactNode; stats?: [React.ReactNode, React.ReactNode][]; fields?: [React.ReactNode, React.ReactNode][]; actions?: React.ReactNode }

export function DataTable<T>({ columns, rows, rowKey, onOpen, openKey, selectable, selected, onSelect, toolbar, pager, foot, empty, card, caption, muted, rowH = 56 }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string;
  /** Row click (and Enter on a focused row) opens the record. */
  onOpen?: (row: T) => void; openKey?: string | null;
  selectable?: boolean; selected?: Set<string>; onSelect?: (keys: Set<string>) => void;
  toolbar?: React.ReactNode; pager?: React.ReactNode; foot?: Record<string, React.ReactNode>; empty?: React.ReactNode;
  card: (row: T) => CardSpec; caption?: string; muted?: (row: T) => boolean; rowH?: number;
}) {
  const sel = selectable && selected && onSelect;
  const allOn = sel && rows.length > 0 && rows.every((r) => selected!.has(rowKey(r)));
  const someOn = sel && rows.some((r) => selected!.has(rowKey(r)));
  const toggle = (k: string, on: boolean) => { const next = new Set(selected); if (on) next.add(k); else next.delete(k); onSelect!(next); };
  const al = (c: Column<T>) => (c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start');
  const tab = (c: Column<T>) => (c.hideTablet ? 'hidden lg:table-cell' : '');
  return (
    <>
      {/* Desktop and tablet */}
      <div className="hidden flex-col overflow-hidden rounded-card bg-surface shadow-card sm:flex">
        {toolbar}
        {empty ?? (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr className="h-12 bg-teal-tint/70">
                  {sel && <th className="w-12 text-center"><Checkbox hideLabel label="تحديد كل الصفوف" checked={allOn ? true : someOn ? 'mixed' : false} onChange={(on) => { const next = new Set(selected); rows.forEach((r) => (on ? next.add(rowKey(r)) : next.delete(rowKey(r)))); onSelect!(next); }} /></th>}
                  {columns.map((c, i) => (
                    <th key={c.key} scope="col" style={c.w ? { width: c.w } : undefined}
                      className={`whitespace-nowrap px-3 text-label font-bold text-ink ${al(c)} ${tab(c)} ${i === 0 && !sel ? 'ps-4' : ''} ${i === columns.length - 1 ? 'pe-4' : ''}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = rowKey(r); const isSel = sel && selected!.has(k); const isOpen = openKey === k;
                  return (
                    <tr key={k} tabIndex={onOpen ? 0 : undefined} style={{ height: rowH }}
                      onClick={onOpen ? () => onOpen(r) : undefined}
                      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(r); } : undefined}
                      className={`border-t border-hair focus-visible:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${onOpen ? 'cursor-pointer' : ''} ${isSel || isOpen ? 'bg-teal-tint' : onOpen ? 'hover:bg-ground' : ''} ${isOpen ? 'shadow-[inset_-3px_0_0_#00658D]' : ''} ${muted?.(r) ? 'text-ink-3' : ''}`}>
                      {sel && <td className="text-center"><Checkbox hideLabel label="تحديد الصف" checked={!!isSel} onChange={(on) => toggle(k, on)} /></td>}
                      {columns.map((c, i) => (
                        <td key={c.key} className={`overflow-hidden px-3 py-2 text-small ${al(c)} ${tab(c)} ${i === 0 && !sel ? 'ps-4' : ''} ${i === columns.length - 1 ? 'pe-4' : ''}`}>{c.render(r)}</td>
                      ))}
                    </tr>
                  );
                })}
                {foot && (
                  <tr className="border-t-2 border-hair" style={{ height: rowH }}>
                    {sel && <td />}
                    {columns.map((c, i) => <td key={c.key} className={`px-3 text-small font-semibold tabular ${al(c)} ${tab(c)} ${i === 0 && !sel ? 'ps-4' : ''}`}>{foot[c.key] ?? ''}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!empty && pager}
      </div>
      {/* Phone */}
      <div className="flex flex-col gap-3 sm:hidden">
        {toolbar}
        {sel && !empty && rows.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <Checkbox label={allOn ? 'إلغاء تحديد الكل' : 'تحديد كل ما في الصفحة'} checked={allOn ? true : someOn ? 'mixed' : false} onChange={(on) => onSelect!(on ? new Set([...selected!, ...rows.map(rowKey)]) : new Set())} />
          </div>
        )}
        {empty ?? rows.map((r) => {
          const k = rowKey(r);
          return <RecordCard key={k} spec={card(r)} onOpen={onOpen ? () => onOpen(r) : undefined}
            select={sel ? { on: selected!.has(k), set: (on) => toggle(k, on) } : undefined} />;
        })}
        {!empty && pager}
      </div>
    </>
  );
}

export const RecordCard: React.FC<{ spec: CardSpec; onOpen?: () => void; select?: { on: boolean; set: (on: boolean) => void } }> = ({ spec, onOpen, select }) => (
  <div role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}
    onKeyDown={onOpen ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } } : undefined}
    className={`flex flex-col gap-2.5 rounded-inner px-4 py-3.5 text-ink shadow-card ${select?.on ? 'bg-teal-tint' : 'bg-surface'} ${onOpen ? 'cursor-pointer' : ''}`}>
    <div className="flex items-start gap-2.5">
      {select && <Checkbox hideLabel label="تحديد" checked={select.on} onChange={select.set} className="!min-h-0 pt-0.5" />}
      <div className="min-w-0 flex-1"><div className="text-body font-semibold">{spec.title}</div>{spec.sub && <div className="text-label text-ink-2">{spec.sub}</div>}</div>
      {spec.end}
    </div>
    {spec.stats && spec.stats.length > 0 && (
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${spec.stats.length}, minmax(0, 1fr))` }}>
        {spec.stats.map(([k, v], i) => <div key={i} className="rounded-control bg-ground px-3 py-1.5"><div className="text-cap text-ink-3">{k}</div><div className="text-[18px] font-semibold leading-[26px] tabular">{v}</div></div>)}
      </div>
    )}
    {spec.fields && spec.fields.length > 0 && (
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-small">
        {spec.fields.map(([k, v], i) => <React.Fragment key={i}><dt className="text-label text-ink-3">{k}</dt><dd className="m-0 min-w-0 text-end">{v}</dd></React.Fragment>)}
      </dl>
    )}
    {spec.actions && <div className="flex gap-2 pt-0.5" onClick={(e) => e.stopPropagation()}>{spec.actions}</div>}
  </div>
);

/** A name with a quieter line under it. */
export const Cell2: React.FC<{ main: React.ReactNode; sub?: React.ReactNode; strong?: boolean }> = ({ main, sub, strong = true }) => (
  <div className="min-w-0"><div className={`truncate ${strong ? 'font-medium' : ''}`}>{main}</div>{sub && <div className="truncate text-cap text-ink-3">{sub}</div>}</div>
);
