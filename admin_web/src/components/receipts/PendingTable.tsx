import React, { useEffect, useMemo, useState } from 'react';
import { Button, Cell2, Chips, DataTable, Icon, Ltr, Money, Pager, SearchBox, Toolbar, countText, momentText, NOUN, phoneText, type Column } from '../../ui';
import { ExportButton } from '../../ui/Transfer';
import { filterReceipts, listName, MAX_ATTEMPTS, type PendingReceiptRow } from '../../lib/pendingReceipts';
import { exportSheet, type ExportColumn } from '../../lib/excel';
import { ReceiptTags, receiptCard, waitedText } from './ReceiptParts';
import type { BulkMode } from './BulkDialogs';

const PAGE = 25;

/** The pending receipts in the file, as the table shows them. */
export const PENDING_EXPORT: ExportColumn<PendingReceiptRow>[] = [
  { label: 'الطالب', value: (r) => r.studentName, width: 30 },
  { label: 'الهاتف', value: (r) => r.studentPhone, width: 16 },
  { label: 'الجامعة', value: (r) => [r.university, r.college].filter((x) => x && x !== '—').join(' · '), width: 28 },
  { label: 'الخط', value: (r) => r.lineName, width: 18 },
  { label: 'المحطة', value: (r) => r.stationName, width: 20 },
  { label: 'الاشتراك', value: (r) => r.periodLabel, width: 28 },
  { label: 'المبلغ المطلوب (ج.م)', value: (r) => r.price, format: '#,##0', width: 16 },
  { label: 'المحاولة', value: (r) => `${r.attemptNumber} من ${MAX_ATTEMPTS}`, width: 10 },
  { label: 'أُرسل', value: (r) => momentText(r.createdAt), width: 24 },
];

/**
 * The pending queue as a table, to decide many at once: tick receipts (or every
 * one shown), then «قبول المحدد» or «رفض المحدد» in the teal bar. A row opens the
 * receipt in the one-by-one review.
 */
export const PendingTable: React.FC<{
  receipts: PendingReceiptRow[]; total: number; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void;
  lines: { line: string; count: number }[]; now: Date; online: boolean;
  onOpen: (row: PendingReceiptRow) => void;
  onBulk: (mode: BulkMode, rows: PendingReceiptRow[]) => void;
  /** Every pending receipt (not only the loaded ones), for the file. */
  loadAll: () => Promise<PendingReceiptRow[]>;
  /** Cleared by the page after a bulk run. */
  selected: Set<string>; onSelect: (keys: Set<string>) => void;
}> = ({ receipts, total, hasMore, loadingMore, onLoadMore, lines, now, online, onOpen, onBulk, loadAll, selected, onSelect }) => {
  const [search, setSearch] = useState('');
  const [line, setLine] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const visible = useMemo(() => filterReceipts(receipts, search, line), [receipts, search, line]);
  useEffect(() => { setPage(1); }, [search, line]);
  useEffect(() => { if (line && !lines.some((l) => l.line === line)) setLine(null); }, [line, lines]);
  // A receipt that left the queue (decided here or by another admin) leaves the selection too.
  useEffect(() => {
    const ids = new Set(receipts.map((r) => r.id));
    if ([...selected].some((id) => !ids.has(id))) onSelect(new Set([...selected].filter((id) => ids.has(id))));
  }, [receipts, selected, onSelect]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const shown = visible.slice((page - 1) * PAGE, page * PAGE);
  const chosen = receipts.filter((r) => selected.has(r.id));
  const chosenAmount = chosen.reduce((sum, r) => sum + r.price, 0);

  const exportFile = async () => {
    const all = hasMore ? filterReceipts(await loadAll(), search, line) : visible;
    await exportSheet({ name: 'الإيصالات المنتظرة', columns: PENDING_EXPORT, rows: all });
  };

  const columns: Column<PendingReceiptRow>[] = [
    { key: 'student', label: 'الطالب', render: (r) => <Cell2 main={<span className="font-semibold">{listName(r.studentName)}</span>} sub={<Ltr>{phoneText(r.studentPhone)}</Ltr>} /> },
    { key: 'line', label: 'الخط والمحطة', w: 180, render: (r) => <Cell2 strong={false} main={r.lineName} sub={r.stationName} /> },
    { key: 'period', label: 'الاشتراك', w: 210, hideTablet: true, render: (r) => <div className="flex min-w-0 items-center gap-2"><span className="truncate">{r.periodLabel || '—'}</span><ReceiptTags row={r} only="ahead" /></div> },
    { key: 'amount', label: 'المبلغ', w: 120, render: (r) => <span className="font-semibold"><Money value={r.price} /></span> },
    { key: 'attempt', label: 'المحاولة', w: 180, hideTablet: true, render: (r) => <span className="inline-flex items-center gap-2"><span className="tabular">{r.attemptNumber} من {MAX_ATTEMPTS}</span><ReceiptTags row={r} only="last" /></span> },
    { key: 'sent', label: 'أُرسل', w: 150, render: (r) => <span className="text-ink-2">{waitedText(r.createdAt, now)}</span> },
  ];

  const chips = (
    <Chips value={line ?? ''} onChange={(v) => setLine(v || null)}
      options={[{ value: '', label: 'كل الخطوط', count: total }, ...lines.map((l) => ({ value: l.line, label: l.line, count: l.count }))]} />
  );
  const noMatch = visible.length === 0 && (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="text-small text-ink-2">لا إيصال منتظر بهذا الاسم أو الرقم.</span>
      <Button kind="link" sm onClick={() => { setSearch(''); setLine(null); }}>امسح البحث</Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <DataTable<PendingReceiptRow>
        caption="الإيصالات المنتظرة" columns={columns} rows={shown} rowKey={(r) => r.id}
        onOpen={onOpen} selectable selected={selected} onSelect={onSelect}
        card={(r) => ({ ...receiptCard(r, now), end: undefined })}
        empty={noMatch || undefined}
        toolbar={(
          <Toolbar
            search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الطالب أو هاتفه" />}
            filters={chips}
            count={<span>{countText(visible.length, NOUN.receipt)}</span>}
            actions={<ExportButton count={hasMore && !search && !line ? total : visible.length} onExport={exportFile} />}
            bulk={{
              count: selected.size, onClear: () => onSelect(new Set()),
              total: visible.length, onAll: () => onSelect(new Set(visible.map((r) => r.id))),
              actions: (
                <>
                  <span className="hidden whitespace-nowrap text-label font-semibold text-white/90 sm:inline">مجموعها <span className="tabular">{Math.round(chosenAmount).toLocaleString('en-US')}</span> ج.م</span>
                  <Button sm kind="secondary" icon="check" disabled={!online || !chosen.length} onClick={() => onBulk('approve', chosen)}>قبول المحدد</Button>
                  <Button sm kind="secondary" icon="x" disabled={!online || !chosen.length} onClick={() => onBulk('reject', chosen)}>رفض المحدد</Button>
                </>
              ),
            }} />
        )}
        pager={<Pager page={page} total={visible.length} onPage={setPage} />} />
      {hasMore && (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-label text-ink-2">معروض <span className="tabular">{receipts.length}</span> من <span className="tabular">{total}</span>. التحديد يشمل المعروض فقط.</span>
          <Button kind="outline" sm loading={loadingMore} onClick={onLoadMore}>عرض المزيد من الإيصالات</Button>
        </div>
      )}
      <p className="m-0 flex items-center gap-1.5 text-label text-ink-3"><Icon name="info" size={14} />افتح الإيصال لترى صورته قبل أن تقرر. القرار الجماعي يمر بنفس طريق القرار الواحد.</p>
    </div>
  );
};
