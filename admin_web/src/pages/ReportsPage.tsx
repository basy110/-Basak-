import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useCompany } from '../lib/adminScope';
import { keys, unwrap, VARIANT_GC } from '../lib/query';
import { rpcOr } from '../lib/rpc';
import { useGuard } from '../lib/guard';
import { notifyDone, notifyError } from '../lib/toasts';
import { useLineNames, useUniversities } from '../lib/reference';
import { useCompanyOverview } from '../lib/overview';
import { cairoToday } from '../lib/time';
import {
  DAYS_W, RECEIPTS_W, RESET_PHRASE, SUBS, TIMES_W, counted, currentReset, rowStatus,
  type ReportRow, type ReportTotals, type ResetRow,
} from '../lib/reports';
import { REVENUE_OPTION_LABEL, breakdownFromRows, type Breakdown, type RevenueOption } from '../lib/money';
import {
  Button, Card, Cell2, Chips, DataTable, Dialog, EmptyState, ErrorState, Icon, Ltr, Money, Note, Page, PageHeader, Pager, Pill,
  RadioCards, SearchBox, SidePanel, SkeletonBar, SkeletonStat, SkeletonTable, SortSelect, StatCard, StatusPill, TextField, Toolbar,
  cairo, clock, dayText, errorText, num, phoneText, useOnline, type Column,
} from '../ui';
import { BreakdownCard, FilterSelect, ResetEffects } from '../components/money/Revenue';

const PAGE = 25;
interface Report { baseline: string | null; totals: ReportTotals; rows: ReportRow[]; rows_total?: number | null }
interface Filters { period: string; line_id: string; university_id: string; academic_year: string; phase: string; include_before_reset: boolean; search: string }

const academicYearNow = () => { const t = cairoToday(); const y = Number(t.slice(0, 4)); return Number(t.slice(5, 7)) >= 8 ? y : y - 1; };
const PERIOD_OPTIONS = [{ value: '', label: 'الكل' }, ...(['first', 'second', 'both', 'summer', 'daily'] as RevenueOption[]).map((o) => ({ value: o, label: REVENUE_OPTION_LABEL[o] }))];
const PHASE_OPTIONS = [{ value: '', label: 'الكل' }, { value: 'current', label: 'ساري الآن' }, { value: 'upcoming', label: 'يبدأ قريباً' }, { value: 'expired', label: 'منتهٍ' }];

const optName = (r: ReportRow) => REVENUE_OPTION_LABEL[(r.type === 'daily' ? 'daily' : r.period === 'annual' ? 'both' : r.period) as RevenueOption] ?? r.label ?? '';
/** «10 أكتوبر 2026، 9:41 ص». */
const momentWords = (iso: string) => { const c = cairo(iso); return `${dayText(c.day)}، ${clock(c.time)}`; };

/** «الإيرادات»: what students actually paid, by subscription, line and payment method; and «تصفير الأرقام». */
export const ReportsPage: React.FC = () => {
  const [params] = useSearchParams();
  return params.get('view') === 'reset' ? <ResetView /> : <RevenueView />;
};

// ── Data ────────────────────────────────────────────────────────────
function useResets(companyId: string) {
  return useQuery({
    queryKey: keys.company(companyId, 'reports', 'resets'),
    queryFn: () => rpcOr<ResetRow[]>('company_report_resets',
      () => supabase.rpc('company_report_resets', { p_company_id: companyId }),
      // An older database: the log without names.
      () => unwrap<ResetRow[]>(supabase.from('report_resets').select('id, scope, reset_at, note, undone_at, company_id')
        .or(`company_id.eq.${companyId},company_id.is.null`).order('reset_at', { ascending: false }).limit(10))),
  });
}

function useBreakdown(companyId: string, filters: Partial<Filters>, lineNames: string[]) {
  return useQuery({
    queryKey: keys.company(companyId, 'reports', 'breakdown', filters),
    placeholderData: keepPreviousData,
    gcTime: VARIANT_GC,
    queryFn: () => rpcOr<Breakdown>('company_revenue_breakdown',
      () => supabase.rpc('company_revenue_breakdown', { p_company_id: companyId, p_filters: filters }),
      async () => {
        // Counted here from the report's rows (every paid one, up to 2,000), the totals from the report itself.
        const [paid, all] = await Promise.all([
          unwrap<Report>(supabase.rpc('admin_subscription_report', { p_filters: { ...filters, company_id: companyId, payment: 'paid', limit: 2000 } })),
          unwrap<Report>(supabase.rpc('admin_subscription_report', { p_filters: { ...filters, company_id: companyId, limit: 1 } })),
        ]);
        const b = breakdownFromRows(paid.rows, all.totals, lineNames);
        return { ...b, baseline: filters.include_before_reset ? null : all.baseline };
      }),
  });
}

// ── The revenue page ────────────────────────────────────────────────
const RevenueView: React.FC = () => {
  const company = useCompany();
  const companyId = company.id;
  const navigate = useNavigate();
  const base = `/c/${companyId}`;
  const year = academicYearNow();
  const blank: Filters = { period: '', line_id: '', university_id: '', academic_year: String(year), phase: '', include_before_reset: false, search: '' };
  const [filters, setFilters] = useState<Filters>(blank);
  const [search, setSearch] = useState('');
  const [payment, setPayment] = useState<'' | 'paid' | 'unpaid'>('');
  const [page, setPage] = useState(1);
  const [allLines, setAllLines] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.search === search.trim() ? f : { ...f, search: search.trim() })), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [filters, payment]);

  const lines = useLineNames(companyId).data ?? [];
  const universities = useUniversities().data ?? [];
  const overview = useCompanyOverview(companyId).data;
  const resets = useResets(companyId);
  const applied = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== false)) as Partial<Filters>, [filters]);
  const breakdown = useBreakdown(companyId, applied, lines.map((l) => l.name));
  const rowsQ = useQuery({
    queryKey: keys.company(companyId, 'reports', 'rows', { ...applied, payment, page }),
    placeholderData: keepPreviousData,
    gcTime: VARIANT_GC,
    queryFn: () => unwrap<Report>(supabase.rpc('admin_subscription_report', {
      p_filters: { ...applied, company_id: companyId, payment: payment || undefined, limit: PAGE, offset: (page - 1) * PAGE },
    })),
  });

  const b = breakdown.data;
  const t = b?.totals;
  const baseline = b?.baseline ?? null;
  const filtered = Object.keys(applied).some((k) => !(k === 'academic_year' && applied.academic_year === String(year))) || !!payment;
  const { current } = currentReset(resets.data ?? []);
  const justReset = !!baseline && !filters.include_before_reset && t && t.paid === 0 && t.count === 0 && Date.now() - new Date(baseline).getTime() < 3 * 86_400_000;
  const nothingYet = !!t && !filtered && t.count === 0 && !justReset;

  const sub = (
    <>ما دفعه الطلاب فعلاً: الإيصالات التي قبلتها والاشتراك اليومي النقدي.{baseline && !filters.include_before_reset && (
      <> يبدأ الحساب من {cairo(baseline).day === cairoToday() ? `اليوم ${momentWords(baseline)}` : dayText(cairo(baseline).day)}.</>
    )}</>
  );
  const header = <PageHeader title="الإيرادات" sub={sub} />;
  if (breakdown.error && !b) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل الإيرادات" text="لم نستطع جلب الأرقام. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => { void breakdown.refetch(); void rowsQ.refetch(); }} /></Page>;
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const clear = () => { setFilters(blank); setSearch(''); setPayment(''); };
  const optionRow = (o: Breakdown['by_option'][number]) => {
    const note = o.option === 'daily' ? counted(o.paid, DAYS_W)
      : o.paid && o.upcoming_paid === o.paid ? `${num(o.paid)} مقدماً`
        : o.option === 'summer' && o.paid === 0 ? 'لم يُفتح' : counted(o.paid, SUBS);
    return { key: o.option, name: REVENUE_OPTION_LABEL[o.option], note, amount: Number(o.amount), muted: o.paid === 0, onClick: () => { setPayment('paid'); set({ period: o.option }); } };
  };
  const methodRow = (m: Breakdown['by_method'][number], i: number) => ({
    key: `${m.kind}${m.method_id ?? m.name ?? i}`,
    name: m.kind === 'cash' ? 'نقداً' : m.kind === 'none' ? 'بلا إيصال' : m.kind === 'deleted' ? 'وسيلة محذوفة' : m.name,
    note: m.kind === 'cash' ? counted(m.paid, TIMES_W) : m.kind === 'none' ? counted(m.paid, SUBS) : counted(m.paid, RECEIPTS_W),
    amount: Number(m.amount),
  });
  const upcomingOption = b?.by_option.find((o) => o.upcoming > 0);
  const linesShown = b ? (allLines ? b.by_line : b.by_line.slice(0, 8)) : [];
  const linesPhone = b ? (allLines ? b.by_line : b.by_line.slice(0, 5)) : [];

  const report = rowsQ.data;
  const rows = report?.rows ?? [];
  const total = report?.rows_total ?? rows.length;

  const filterBar = (
    <>
      <FilterSelect label="الاشتراك" value={filters.period} onChange={(v) => set({ period: v })} options={PERIOD_OPTIONS} />
      <FilterSelect label="الخط" value={filters.line_id} onChange={(v) => set({ line_id: v })} options={[{ value: '', label: 'كل الخطوط' }, ...lines.map((l) => ({ value: l.id, label: l.name }))]} />
      <FilterSelect label="الجامعة" value={filters.university_id} onChange={(v) => set({ university_id: v })} options={[{ value: '', label: 'كل الجامعات' }, ...universities.map((u) => ({ value: u.id, label: u.name }))]} />
      <FilterSelect label="العام الدراسي" value={filters.academic_year} defaultValue={String(year)} onChange={(v) => set({ academic_year: v })}
        options={[{ value: '', label: 'كل الأعوام' }, ...[year + 1, year, year - 1].map((y) => ({ value: String(y), label: `${y}/${y + 1}` }))]} />
      <FilterSelect label="السريان" value={filters.phase} onChange={(v) => set({ phase: v })} options={PHASE_OPTIONS} />
      <button type="button" aria-pressed={filters.include_before_reset} onClick={() => set({ include_before_reset: !filters.include_before_reset })}
        className={`inline-flex h-10 flex-none items-center gap-1.5 rounded-control px-3 text-label sm:h-9 ${filters.include_before_reset ? 'bg-teal-tint font-semibold text-teal shadow-[inset_0_0_0_1.5px_#00658D]' : 'bg-surface text-ink shadow-ring hover:bg-ground'}`}>
        <Icon name={filters.include_before_reset ? 'check' : 'undo'} size={14} stroke={2} />يشمل ما قبل آخر تصفير
      </button>
    </>
  );

  const columns: Column<ReportRow>[] = [
    { key: 'student', label: 'الطالب', w: 250, render: (r) => <Cell2 main={r.student_name} sub={<><Ltr>{phoneText(r.phone)}</Ltr>{r.university ? ` · ${r.university}` : ''}</>} /> },
    { key: 'line', label: 'الخط', w: 120, render: (r) => <span className="truncate">{r.line}</span> },
    { key: 'sub', label: 'الاشتراك', w: 120, render: (r) => <Cell2 strong={false} main={optName(r)} sub={r.academic_year ? `${r.academic_year}/${r.academic_year + 1}` : undefined} /> },
    { key: 'amount', label: 'المبلغ', w: 110, render: (r) => (r.paid
      ? <span className="font-semibold"><Money value={r.amount ?? r.price} /></span>
      : <div className="leading-tight text-ink-3"><Money value={r.price} /><div className="text-cap">لم يُدفع</div></div>) },
    { key: 'method', label: 'وسيلة الدفع', w: 150, hideTablet: true, render: (r) => (!r.paid ? <span className="text-ink-3">—</span>
      : r.payment_method ? <Cell2 strong={false} main={r.payment_method} sub={r.receipt_no ? <>إيصال رقم <Ltr>{r.receipt_no}</Ltr></> : undefined} /> : r.type === 'daily' ? 'نقداً' : 'بلا إيصال') },
    { key: 'paid_at', label: <span className="inline-flex items-center gap-1">تاريخ الدفع<Icon name="adown" size={13} stroke={2} /></span>, w: 100,
      render: (r) => (r.paid_at ? dayText(cairo(r.paid_at).day, { year: cairo(r.paid_at).day.slice(0, 4) !== cairoToday().slice(0, 4) }) : <span className="text-ink-3">—</span>) },
    { key: 'until', label: 'يسري حتى', w: 110, hideTablet: true, render: (r) => (r.end_date ? dayText(r.end_date, { year: r.end_date.slice(0, 4) !== cairoToday().slice(0, 4) || r.type !== 'daily' }) : '—') },
    { key: 'status', label: 'الحالة', w: 120, render: (r) => <StatusPill status={rowStatus(r)} /> },
  ];
  const card = (r: ReportRow) => ({
    title: r.student_name, sub: <><Ltr>{phoneText(r.phone)}</Ltr>{r.university ? ` · ${r.university}` : ''}</>, end: <StatusPill status={rowStatus(r)} />,
    fields: [
      ['الخط', r.line], ['الاشتراك', `${optName(r)}${r.academic_year ? ` · ${r.academic_year}/${r.academic_year + 1}` : ''}`],
      ['المبلغ', r.paid ? <Money value={r.amount ?? r.price} /> : <span className="text-ink-3"><Money value={r.price} /> · لم يُدفع</span>],
      ['وسيلة الدفع', !r.paid ? '—' : r.payment_method ? <>{r.payment_method}{r.receipt_no ? <> · إيصال <Ltr>{r.receipt_no}</Ltr></> : null}</> : r.type === 'daily' ? 'نقداً' : 'بلا إيصال'],
      ['تاريخ الدفع', r.paid_at ? dayText(cairo(r.paid_at).day, { year: false }) : '—'], ['يسري حتى', r.end_date ? dayText(r.end_date) : '—'],
    ] as [React.ReactNode, React.ReactNode][],
  });
  const openStudent = (r: ReportRow) => navigate(r.student_id ? `${base}/students?student=${r.student_id}` : `${base}/students?q=${encodeURIComponent(r.phone)}`);

  const chips = (
    <Chips<'' | 'paid' | 'unpaid'> value={payment} onChange={setPayment} options={[
      { value: '', label: 'الكل', count: t ? num(t.count) : '' }, { value: 'paid', label: 'مدفوع', count: t ? num(t.paid) : '' }, { value: 'unpaid', label: 'لم يُدفع', count: t ? num(t.unpaid) : '' },
    ]} />
  );
  const tableEmpty = rowsQ.isPending ? undefined : rows.length === 0 ? (
    <EmptyState icon="search" title={filtered ? 'لا اشتراك يطابق بحثك' : 'لا اشتراكات بعد'}
      text={filtered ? `${filters.search ? `لا طالب باسم «${filters.search}» في هذه التصفية.` : 'لا اشتراك بهذه التصفية.'} غيّر التصفية أو امسحها.` : 'يظهر هنا كل اشتراك ومدفوعاته.'}
      action={filtered && <Button kind="secondary" icon="x" onClick={clear}>مسح التصفية</Button>} />
  ) : undefined;

  return (
    <Page>
      {header}
      {justReset && (
        <Note tone="success" title="بدأ الحساب من الصفر" action={current && <Button sm kind="outline" onClick={() => setUndoing(true)}>إلغاء التصفير</Button>}>
          كل ما سبق محفوظ. لتراه اضغط «يشمل ما قبل آخر تصفير»، وللتراجع افتح صفحة تصفير الأرقام.
        </Note>
      )}

      {/* Four numbers */}
      {!b ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">{[0, 1, 2, 3].map((i) => <SkeletonStat key={i} />)}</div> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">
          <StatCard icon="chart" label="إجمالي الإيرادات" value={num(t!.revenue)} unit="ج.م" hint={t!.paid ? `من ${counted(t!.paid, ['اشتراك واحد مدفوع', 'اشتراكين مدفوعين', 'اشتراكات مدفوعة', 'اشتراكاً مدفوعاً', 'اشتراك مدفوع'])}` : baseline ? 'منذ لحظة التصفير' : '—'} />
          <StatCard icon="check" label="اشتراكات مدفوعة" value={num(t!.paid)} hint={t!.daily_paid ? `منها ${counted(t!.daily_paid, DAYS_W)} نقداً` : '—'} />
          <StatCard icon="clock" label="لم تُدفع بعد" value={num(t!.unpaid)}
            hint={overview?.pending_receipts ? `${counted(overview.pending_receipts, RECEIPTS_W)} ${overview.pending_receipts > 10 || overview.pending_receipts < 3 ? 'ينتظر' : 'تنتظر'} مراجعتك` : '—'}
            to={overview?.pending_receipts ? `${base}/receipts` : undefined} />
          <StatCard icon="calendar" label="مدفوعة مقدماً" value={num(t!.upcoming_paid)} unit={t!.upcoming ? `من ${num(t!.upcoming)}` : undefined}
            hint={upcomingOption ? `ل${REVENUE_OPTION_LABEL[upcomingOption.option]}، ولم يبدأ بعد` : 'للفصل الثاني، ولم يبدأ بعد'} />
        </div>
      )}

      {nothingYet ? (
        <EmptyState card icon="chart" title="لا إيرادات بعد"
          text={<><span className="hidden sm:inline">عندما تقبل أول إيصال في «الإيصالات»، أو يُسجَّل اشتراك يومي نقدي، يظهر المبلغ هنا موزّعاً على الخطوط ووسائل الدفع.</span><span className="sm:hidden">عندما تقبل أول إيصال في «الإيصالات»، أو يُسجَّل اشتراك يومي نقدي، يظهر المبلغ هنا.</span></>}
          action={<Button kind="secondary" iconEnd="fwd" to={`${base}/receipts`}>افتح الإيصالات</Button>} />
      ) : !justReset && (
        <>
          {/* Where the money came from */}
          <section className="flex flex-col gap-3">
            <h2 className="m-0 text-card sm:text-section">من أين جاءت الإيرادات</h2>
            {!b ? <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-6">{[0, 1, 2].map((i) => <Card key={i} className="flex flex-col gap-4 p-5"><SkeletonBar w={120} h={14} />{[0, 1, 2, 3].map((j) => <SkeletonBar key={j} w="100%" h={10} />)}</Card>)}</div> : (
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
                <BreakdownCard title="حسب الاشتراك" sub="اضغط سطراً لترى من دفعوه" rows={b.by_option.map(optionRow)} />
                <BreakdownCard title="حسب الخط" sub={counted(b.by_line.length, ['خط واحد', 'خطان', 'خطوط', 'خطاً'])} className="hidden lg:flex"
                  rows={linesShown.map((l) => ({ key: l.line_id ?? l.name, name: l.name, amount: Number(l.amount), muted: !l.amount, onClick: l.line_id ? () => set({ line_id: l.line_id! }) : undefined }))}
                  more={b.by_line.length > 8 && !allLines && <Button kind="link" sm onClick={() => setAllLines(true)}>كل الخطوط ({num(b.by_line.length)})</Button>} />
                <BreakdownCard title="حسب الخط" sub={counted(b.by_line.length, ['خط واحد', 'خطان', 'خطوط', 'خطاً'])} className="lg:hidden"
                  rows={linesPhone.map((l) => ({ key: l.line_id ?? l.name, name: l.name, amount: Number(l.amount), muted: !l.amount, onClick: l.line_id ? () => set({ line_id: l.line_id! }) : undefined }))}
                  more={b.by_line.length > 5 && !allLines && <Button kind="link" sm className="self-center" onClick={() => setAllLines(true)}>كل الخطوط</Button>} />
                <BreakdownCard title="حسب وسيلة الدفع" sub="أين وصل المال" rows={b.by_method.length ? b.by_method.map(methodRow) : [{ key: 'none', name: 'لا مدفوعات بعد', amount: 0, muted: true }]} />
              </div>
            )}
          </section>
        </>
      )}

      {/* The subscriptions and their payments */}
      {!nothingYet && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="m-0 text-card sm:text-section">الاشتراكات ومدفوعاتها</h2>
            <span className="hidden text-label text-ink-2 sm:inline">اضغط صفاً لتفتح صفحة الطالب</span>
          </div>
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {filterBar}
            {filtered && <><span className="flex-1" /><Button kind="link" sm icon="x" onClick={clear}>مسح التصفية</Button></>}
          </div>
          {!justReset && (rowsQ.isPending ? <SkeletonTable rows={8} cols={7} /> : rowsQ.error && !report ? (
            <ErrorState card title="تعذّر تحميل الاشتراكات" error={rowsQ.error} onRetry={() => void rowsQ.refetch()} />
          ) : (
            <DataTable<ReportRow> rows={rows} rowKey={(r) => r.id} caption="الاشتراكات ومدفوعاتها" onOpen={openStudent} columns={columns} card={card}
              toolbar={(
                <Toolbar
                  search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الطالب أو رقم الهاتف" />}
                  filters={<div className="flex items-center gap-2">{chips}<button type="button" onClick={() => setMoreFilters(true)} className="inline-flex h-10 flex-none items-center gap-1.5 rounded-full bg-surface px-3 text-label shadow-ring sm:hidden"><Icon name="filter" size={14} />تصفية أخرى</button></div>}
                  count={total === 0 ? 'لا نتائج' : counted(total, SUBS)}
                  sort={<SortSelect value="paid" onChange={() => undefined} options={[{ value: 'paid', label: 'الأحدث دفعاً أولاً' }]} />} />
              )}
              empty={tableEmpty}
              pager={<Pager page={page} total={total} onPage={setPage} />} />
          ))}
        </section>
      )}

      {/* Starting the count again is a page of its own */}
      {!nothingYet && !justReset && (
        <Card className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
          <Icon name="undo" size={20} className="hidden text-ink-2 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="text-small font-semibold">بداية فصل جديد؟ ابدأ الحساب من الصفر</div>
            <div className="text-label text-ink-2">«تصفير الأرقام» صفحة مستقلة. لا يُحذف فيها اشتراك ولا إيصال، ويمكن التراجع عنها.{current && ` آخر تصفير: ${dayText(cairo(current.reset_at).day)}.`}</div>
          </div>
          <Button kind="outline" iconEnd="fwd" to="?view=reset">صفحة تصفير الأرقام</Button>
        </Card>
      )}

      <SidePanel open={moreFilters} onClose={() => setMoreFilters(false)} title="تصفية" backLabel="الإيرادات"
        footer={<><Button kind="secondary" onClick={clear}>مسح التصفية</Button><Button onClick={() => setMoreFilters(false)}>عرض {counted(total, SUBS)}</Button></>}>
        <div className="flex flex-col items-stretch gap-3 [&>*]:!h-12 [&>*]:justify-between">{filterBar}</div>
      </SidePanel>
      {undoing && current && <UndoDialog reset={current} resets={resets.data ?? []} companyId={companyId} onClose={() => setUndoing(false)} />}
    </Page>
  );
};

// ── «تصفير الأرقام» ─────────────────────────────────────────────────
const SCOPE_LABEL = { financial: 'الإيرادات فقط', all: 'الإيرادات وأرقام صفحة «اليوم»' } as const;

function useAfterReset(companyId: string) {
  const client = useQueryClient();
  // A reset moves where the figures start: this page, its log and the «اليوم» numbers follow.
  return () => Promise.all([
    client.invalidateQueries({ queryKey: keys.company(companyId, 'reports') }),
    client.invalidateQueries({ queryKey: keys.company(companyId, 'overview') }),
    client.invalidateQueries({ queryKey: keys.company(companyId, 'today') }),
  ]);
}

const UndoDialog: React.FC<{ reset: ResetRow; resets: ResetRow[]; companyId: string; onClose: () => void }> = ({ reset, resets, companyId, onClose }) => {
  const guard = useGuard();
  const after = useAfterReset(companyId);
  const [busy, setBusy] = useState(false);
  const earlier = resets.filter((r) => !r.undone_at && r.id !== reset.id && r.reset_at < reset.reset_at).sort((a, b) => b.reset_at.localeCompare(a.reset_at))[0];
  const live = !reset.undone_at && !resets.some((r) => !r.undone_at && r.reset_at > reset.reset_at);
  const undo = () => guard(reset.id, async () => {
    setBusy(true);
    const { error } = await supabase.rpc('admin_undo_report_reset', { p_reset_id: reset.id });
    setBusy(false);
    if (error) { notifyError('لم يُلغَ التصفير', errorText(error)); return; }
    onClose();
    notifyDone('أُلغي التصفير', 'تحسب «الإيرادات» الآن ما قبله أيضاً.');
    await after();
  });
  const day = dayText(cairo(reset.reset_at).day);
  return (
    <Dialog open onClose={onClose} title={`إلغاء تصفير ${day}؟`} icon="undo" tone="warning"
      actions={[<Button key="b" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>, <Button key="u" onClick={() => void undo()} loading={busy}>إلغاء التصفير</Button>]}>
      <p className="m-0">{live
        ? <>تعود «الإيرادات» لتحسب كل ما دُفع {earlier ? `منذ التصفير الذي قبله (${dayText(cairo(earlier.reset_at).day)})` : 'منذ البداية'}، فترتفع الأرقام. لا يتغيّر شيء عند الطلاب.</>
        : <>هذا التصفير ليس الساري الآن، فلا تتغيّر الأرقام الآن؛ يُحذف من حساب البداية إن أُلغي ما بعده. لا يتغيّر شيء عند الطلاب.</>}</p>
    </Dialog>
  );
};

const ResetView: React.FC = () => {
  const companyId = useCompany().id;
  const online = useOnline();
  const navigate = useNavigate();
  const guard = useGuard();
  const after = useAfterReset(companyId);
  const resets = useResets(companyId);
  const totals = useBreakdown(companyId, {}, []);
  const [scope, setScope] = useState<'financial' | 'all'>('financial');
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<{ at: string } | null>(null);
  const [undo, setUndo] = useState<ResetRow | null>(null);
  const [busy, setBusy] = useState(false);
  const { current } = currentReset(resets.data ?? []);

  const doReset = () => guard('reset', async () => {
    setBusy(true);
    // The database still asks for its confirmation phrase; the admin confirmed in the dialog, the dashboard sends it.
    const { error } = await supabase.rpc('admin_reset_reports', { p_scope: scope, p_confirm: RESET_PHRASE[scope], p_note: note.trim() || null, p_company_id: companyId });
    setBusy(false);
    if (error) { notifyError('لم تُصفَّر الأرقام', errorText(error)); return; }
    setAsking(null);
    setNote('');
    notifyDone('بدأ الحساب من الصفر', 'كل ما سبق محفوظ، ويمكنك إلغاء التصفير من السجل.');
    await after();
    navigate(`/c/${companyId}/reports`);
  });

  const nowWords = (iso: string) => { const c = cairo(iso); return `${dayText(c.day, { weekday: true })}، ${clock(c.time)}`; };
  return (
    <Page>
      <PageHeader title="تصفير الأرقام" back={{ label: 'الإيرادات', to: `/c/${companyId}/reports` }}
        sub="عند بداية فصل أو عام جديد: اجعل أرقام الإيرادات تبدأ من الصفر، دون أن تفقد شيئاً." />
      <Note tone="warning" title="صفحة للاستخدام النادر">الأرقام التي تراها في «الإيرادات» ستبدأ من الصفر لكل مديري الشركة. يمكن إلغاء التصفير من السجل في أي وقت.</Note>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-6">
        <Card className="flex flex-col gap-5 p-4 sm:p-6">
          <div><h2 className="m-0 text-section">ابدأ الحساب من جديد</h2><p className="m-0 text-small text-ink-2">تضع علامة «من هنا نبدأ العدّ». لا يُحذف شيء من النظام، وهذه العلامة لشركتك وحدها.</p></div>
          <RadioCards<'financial' | 'all'> label="ماذا تريد أن يبدأ من الصفر؟" value={scope} onChange={setScope} cols={2} options={[
            { value: 'financial', label: 'الإيرادات فقط', sub: 'أرقام هذه الصفحة' },
            { value: 'all', label: 'الإيرادات وأرقام «اليوم»', sub: 'هذه الصفحة وصفحة اليوم' },
          ]} />
          <ResetEffects scope={scope} />
          <TextField label="سبب التصفير" optional value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="مثال: بداية الفصل الثاني" help="يُكتب في السجل لتتذكره لاحقاً." />
          <div className="border-t border-hair pt-4">
            <Button kind="dangerQuiet" icon="undo" disabled={!online} onClick={() => setAsking({ at: new Date().toISOString() })}>تصفير الأرقام</Button>
          </div>
        </Card>
        <Card className="flex flex-col p-4 sm:p-6">
          <h2 className="m-0 text-section">سجل التصفير</h2>
          <p className="m-0 text-small text-ink-2">آخر 10 مرات. إلغاء التصفير يعيد العدّ ليشمل ما قبله.</p>
          {resets.isPending ? <div className="mt-4 flex flex-col gap-3"><SkeletonBar w="70%" /><SkeletonBar w="50%" /><SkeletonBar w="60%" /></div>
            : resets.error ? <div className="mt-4"><ErrorState title="تعذّر تحميل السجل" error={resets.error} onRetry={() => void resets.refetch()} /></div>
              : (resets.data ?? []).length === 0 ? <p className="m-0 mt-4 text-small text-ink-2">لم تُصفَّر الأرقام من قبل.</p> : (
                <ul className="m-0 mt-2 flex list-none flex-col p-0">
                  {(resets.data ?? []).map((r, i) => {
                    const c = cairo(r.reset_at);
                    return (
                      <li key={r.id} className={`flex items-start gap-3 py-3.5 ${i ? 'border-t border-hair' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-small font-semibold">{dayText(c.day)} · {clock(c.time)}</span>
                            {r.undone_at ? <Pill tone="neutral">أُلغي</Pill> : current?.id === r.id ? <span className="rounded-control bg-teal-tint px-2 text-cap font-medium leading-5 text-teal">الساري الآن</span> : null}
                          </div>
                          <div className="text-label text-ink-2">{SCOPE_LABEL[r.scope] ?? r.scope}{r.note ? ` · ${r.note}` : ''}</div>
                          {r.reset_by_name && <div className="text-cap text-ink-3">{r.reset_by_name}{!r.company_id ? ' · لكل الشركات' : ''}</div>}
                        </div>
                        {!r.undone_at && <Button sm kind="outline" disabled={!online} onClick={() => setUndo(r)}>إلغاء التصفير</Button>}
                      </li>
                    );
                  })}
                </ul>
              )}
        </Card>
      </div>

      {asking && (
        <Dialog open onClose={() => setAsking(null)} title="تصفير أرقام الإيرادات؟" icon="alert" tone="danger" w={560}
          actions={[<Button key="b" kind="secondary" onClick={() => setAsking(null)} disabled={busy}>رجوع</Button>, <Button key="r" kind="danger" onClick={() => void doReset()} loading={busy}>صفّر الأرقام</Button>]}>
          <p className="m-0">من هذه اللحظة ({nowWords(asking.at)}) تُحسب الإيرادات مما يُدفع بعدها فقط.{totals.data && <> الإجمالي الحالي <b className="text-ink"><Money value={totals.data.totals.revenue} /></b> يخرج من العدّ.</>}</p>
          <ResetEffects scope={scope} stacked />
          <p className="m-0">يمكنك إلغاء التصفير لاحقاً من «سجل التصفير».</p>
        </Dialog>
      )}
      {undo && <UndoDialog reset={undo} resets={resets.data ?? []} companyId={companyId} onClose={() => setUndo(null)} />}
    </Page>
  );
};
