import React, { useEffect, useMemo, useState } from 'react';
import { Button, Cell2, Chips, DataTable, EmptyState, ErrorState, Ltr, Money, Pager, SearchBox, SkeletonCards, SkeletonStat, SkeletonTable, StatCard, Toolbar, countText, clock, cairo, dayText, momentText, NOUN, num, phoneText, type CardSpec, type Column } from '../../ui';
import { ExportButton } from '../../ui/Transfer';
import { cairoToday } from '../../lib/time';
import { exportSheet, type ExportColumn } from '../../lib/excel';
import {
  EXPORT_MAX, HISTORY_PAGE, fetchReviewedReceipts, useReceiptsHistory, type HistoryFilters, type HistoryRow, type Outcome, type RangePreset,
} from '../../lib/receiptsHistory';
import { FilterSelect } from '../students/parts';
import { HistoryPanel, OutcomePill, reviewerText } from './HistoryPanel';

const RANGES: { value: Exclude<RangePreset, 'all'>; label: string }[] = [
  { value: 'today', label: 'اليوم' }, { value: 'week', label: 'آخر 7 أيام' }, { value: 'month', label: 'هذا الشهر' },
];
const RANGE_HINT: Record<RangePreset, string> = { all: 'منذ البداية', today: 'اليوم', week: 'في آخر 7 أيام', month: 'هذا الشهر' };

/** «اليوم 7:30 ص», «أمس 9:40 م», «8 أكتوبر 10:05 ص». */
function shortMoment(iso: string | null, now: Date): string {
  if (!iso) return '—';
  const at = cairo(iso);
  const today = cairoToday(now);
  const yesterday = cairoToday(new Date(now.getTime() - 86_400_000));
  const day = at.day === today ? 'اليوم' : at.day === yesterday ? 'أمس' : dayText(at.day, { year: at.day.slice(0, 4) !== today.slice(0, 4) });
  return `${day} ${clock(at.time)}`;
}

/** The history in the file: one row per decided receipt. */
const HISTORY_EXPORT: ExportColumn<HistoryRow>[] = [
  { label: 'الطالب', value: (r) => r.studentName, width: 30 },
  { label: 'الهاتف', value: (r) => r.studentPhone, width: 16 },
  { label: 'الخط', value: (r) => r.lineName, width: 18 },
  { label: 'المحطة', value: (r) => r.stationName, width: 20 },
  { label: 'الاشتراك', value: (r) => r.periodLabel, width: 28 },
  { label: 'المبلغ (ج.م)', value: (r) => r.amount, format: '#,##0', width: 14 },
  { label: 'النتيجة', value: (r) => (r.status === 'approved' ? 'تم تأكيد الدفع' : 'مرفوض'), width: 16 },
  { label: 'سبب الرفض', value: (r) => (r.status === 'rejected' ? r.rejectionReason : ''), width: 36 },
  { label: 'راجعه', value: (r) => reviewerText(r), width: 22 },
  { label: 'وقت المراجعة', value: (r) => momentText(r.reviewedAt), width: 24 },
  { label: 'أُرسل', value: (r) => momentText(r.createdAt), width: 24 },
  { label: 'وسيلة الدفع', value: (r) => r.paymentMethod, width: 18 },
  { label: 'المحاولة', value: (r) => r.attemptNumber, width: 10 },
];

/**
 * «السجل»: every receipt this company accepted or rejected, newest decision first,
 * with the totals of what is filtered on top and the file of all of it.
 */
export const HistoryView: React.FC<{ companyId: string; openId: string | null; onOpen: (id: string | null) => void; onShowQueue: () => void }> = ({ companyId, openId, onOpen, onShowQueue }) => {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [range, setRange] = useState<RangePreset>('all');
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [lineId, setLineId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // The search is sent once the admin stops typing.
  useEffect(() => { const t = window.setTimeout(() => setSearch(typed), 300); return () => window.clearTimeout(t); }, [typed]);
  const filters: HistoryFilters = useMemo(() => ({ outcome, range, search, lineId }), [outcome, range, search, lineId]);
  useEffect(() => { setPage(1); }, [filters]);
  const history = useReceiptsHistory(companyId, filters, page);
  const now = useMemo(() => new Date(), [history.data]);

  const data = history.data;
  const filtered = !!(outcome || range !== 'all' || search.trim() || lineId);
  const all = (data?.counts.approved ?? 0) + (data?.counts.rejected ?? 0);
  const open = data?.rows.find((r) => r.id === openId) ?? null;
  // A line that no longer has rows leaves the choice.
  useEffect(() => { if (data && lineId && !data.lines.some((l) => l.id === lineId)) setLineId(null); }, [data, lineId]);
  const clear = () => { setOutcome(null); setRange('all'); setTyped(''); setSearch(''); setLineId(null); };

  const exportFile = async () => {
    const answer = await fetchReviewedReceipts(companyId, filters, EXPORT_MAX, 0);
    await exportSheet({ name: outcome === 'approved' ? 'الإيصالات المقبولة' : outcome === 'rejected' ? 'الإيصالات المرفوضة' : 'سجل الإيصالات', columns: HISTORY_EXPORT, rows: answer.rows });
  };

  if (history.loading) {
    return (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"><SkeletonStat /><SkeletonStat /><span className="hidden sm:block"><SkeletonStat /></span></div>
        <div className="hidden sm:block"><SkeletonTable rows={8} cols={6} /></div>
        <div className="sm:hidden"><SkeletonCards rows={4} /></div>
      </>
    );
  }
  if (history.error && !data) {
    return <ErrorState card title="تعذّر تحميل سجل الإيصالات" text="لم نستطع جلب الإيصالات التي رُوجعت. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={history.reload} />;
  }
  if (data && !filtered && all === 0) {
    return (
      <EmptyState card icon="receipt" title="لا إيصالات في السجل بعد"
        text="كل إيصال تقبله أو ترفضه يظهر هنا مع من راجعه ومتى، وسبب الرفض إن رُفض."
        action={<Button kind="secondary" iconEnd="fwd" onClick={onShowQueue}>الإيصالات المنتظرة</Button>} />
    );
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const columns: Column<HistoryRow>[] = [
    { key: 'student', label: 'الطالب', render: (r) => <Cell2 main={<span className="font-semibold">{r.studentName}</span>} sub={r.studentPhone ? <Ltr>{phoneText(r.studentPhone)}</Ltr> : undefined} /> },
    { key: 'line', label: 'الخط', w: 130, render: (r) => <Cell2 strong={false} main={r.lineName} sub={r.stationName} /> },
    { key: 'period', label: 'الاشتراك', w: 176, hideTablet: true, render: (r) => <span className="block truncate">{r.periodLabel || '—'}</span> },
    { key: 'amount', label: 'المبلغ', w: 110, render: (r) => <span className="font-semibold"><Money value={r.amount} /></span> },
    { key: 'outcome', label: 'النتيجة', w: 210, render: (r) => (
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <OutcomePill status={r.status} />
        {r.status === 'rejected' && r.rejectionReason && <span className="max-w-full truncate text-cap text-bad" title={r.rejectionReason}>{r.rejectionReason}</span>}
      </div>
    ) },
    { key: 'reviewed', label: 'المراجعة', w: 170, render: (r) => <Cell2 strong={false} main={reviewerText(r)} sub={shortMoment(r.reviewedAt, now)} /> },
    { key: 'sent', label: 'أُرسل', w: 156, hideTablet: true, render: (r) => <span className="text-ink-2">{shortMoment(r.createdAt, now)}</span> },
  ];
  const card = (r: HistoryRow): CardSpec => ({
    title: r.studentName,
    sub: r.studentPhone ? <Ltr>{phoneText(r.studentPhone)}</Ltr> : undefined,
    end: <OutcomePill status={r.status} />,
    fields: [
      ['المبلغ', <span className="font-semibold"><Money value={r.amount} /></span>],
      ['الخط', `${r.lineName} · ${r.stationName}`],
      ['الاشتراك', r.periodLabel || '—'],
      ...(r.status === 'rejected' ? [['سبب الرفض', <span className="text-bad">{r.rejectionReason || '—'}</span>] as [React.ReactNode, React.ReactNode]] : []),
      [r.status === 'approved' ? 'قبله' : 'رفضه', <span>{reviewerText(r)} · {shortMoment(r.reviewedAt, now)}</span>],
      ['أُرسل', shortMoment(r.createdAt, now)],
    ],
  });

  const filters_ = (
    <>
      <Chips<'' | Outcome> value={outcome ?? ''} onChange={(v) => setOutcome(v || null)}
        options={[
          { value: '', label: 'الكل', count: num(all) },
          { value: 'approved', label: 'مقبولة', count: num(data?.counts.approved ?? 0) },
          { value: 'rejected', label: 'مرفوضة', count: num(data?.counts.rejected ?? 0) },
        ]} />
      <div className="flex flex-wrap gap-2">
        <FilterSelect<Exclude<RangePreset, 'all'>> label="الفترة" allLabel="كل الوقت" icon="calendar" value={range === 'all' ? '' : range}
          onChange={(v) => setRange((v || 'all') as RangePreset)} options={RANGES} />
        {(data?.lines.length ?? 0) > 1 || lineId ? (
          <FilterSelect<string> label="الخط" allLabel="كل الخطوط" icon="route" value={lineId ?? ''}
            onChange={(v) => setLineId(v || null)} options={(data?.lines ?? []).map((l) => ({ value: l.id, label: `${l.name} (${num(l.count)})` }))} />
        ) : null}
      </div>
    </>
  );
  const noMatch = rows.length === 0 && (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="text-small text-ink-2">لا إيصال في السجل بهذه الشروط.</span>
      <Button kind="link" sm onClick={clear}>امسح التصفية</Button>
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard className="col-span-2 sm:order-2 sm:col-span-1" icon="card" tone="teal" label="مجموع المقبول"
          value={<Money value={data?.approvedAmount ?? 0} unitClass="text-label" />} hint={RANGE_HINT[range]} />
        <StatCard className="sm:order-1" icon="check" tone="success" label="تم تأكيد الدفع" value={num(data?.counts.approved ?? 0)} unit="إيصال" hint={RANGE_HINT[range]} />
        <StatCard className="sm:order-3" icon="x" tone="danger" label="مرفوضة" value={num(data?.counts.rejected ?? 0)} unit="إيصال" hint={RANGE_HINT[range]} />
      </div>
      <DataTable<HistoryRow>
        caption="سجل الإيصالات" columns={columns} rows={rows} rowKey={(r) => r.id}
        onOpen={(r) => onOpen(r.id)} openKey={openId} card={card} rowH={64}
        empty={noMatch || undefined}
        toolbar={(
          <Toolbar
            search={<SearchBox value={typed} onChange={setTyped} placeholder="ابحث باسم الطالب أو هاتفه" />}
            filters={filters_}
            count={<span className={history.refreshing ? 'opacity-60' : ''}>{countText(total, NOUN.receipt)}</span>}
            actions={<ExportButton count={Math.min(total, EXPORT_MAX)} onExport={exportFile} />} />
        )}
        pager={<Pager page={page} pageSize={HISTORY_PAGE} total={total} onPage={setPage} />} />
      {total > EXPORT_MAX && <p className="m-0 text-label text-ink-3">الملف يحمل أحدث {num(EXPORT_MAX)} إيصال. ضيّق الفترة لتصدير ما قبلها.</p>}
      <HistoryPanel row={open} onClose={() => onOpen(null)} studentsPath={`/c/${companyId}/students`} />
    </>
  );
};
