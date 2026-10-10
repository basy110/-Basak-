import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DEFAULT_PERIOD, CATEGORY_LABEL, CYCLE_LABEL, PERIODS, healthTone, monthText, periodLabel, usePlatformAnalytics,
  type CompanyStat, type PeriodKey, type PlatformAnalytics,
} from '../../lib/platformFinance';
import { SEVERITY_WORD, platformInsightText, platformInsights, type InsightTone } from '../../lib/platformInsights';
import { percentText } from '../../lib/analyticsInsights';
import { platformLabel } from '../../lib/appVersions';
import { exportSheets, type SheetSpec } from '../../lib/excel';
import { MONEY_FORMAT } from '../../lib/excelCells';
import {
  Button, Card, Cell2, DataTable, EmptyState, ErrorState, Icon, Money, Page, PageHeader, Pager, Pill, Section, SkeletonBar, SkeletonStat,
  SkeletonTable, SortSelect, StatCard, Toolbar, agoText, countText, dayText, moneyText, num, NOUN, type Column,
} from '../../ui';
import { ExportButton } from '../../ui/Transfer';
import { ColumnChart, LineChart } from '../../ui/Chart';
import { FilterSelect } from '../../components/money/Revenue';
import { BarList, Panel } from '../../components/analytics/Bars';
import { CompanyState } from '../../components/platform/CompanyPanel';

const PAGE = 25;
const DOT: Record<InsightTone, string> = { danger: 'bg-bad', warning: 'bg-warn', success: 'bg-ok', teal: 'bg-teal' };
const pctText = (share: number | null | undefined) => (share == null ? '—' : percentText(Math.round(share * 100)));

/**
 * «تحليلات المنصة»: the platform owner's numbers over a period — what the
 * companies pay and what running the platform costs, how each company is doing,
 * where the students are, how the apps are used — and what to do about it.
 */
export const PlatformAnalyticsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : DEFAULT_PERIOD) as PeriodKey;
  const setPeriod = (p: PeriodKey) => setParams((prev) => { const next = new URLSearchParams(prev); if (p === DEFAULT_PERIOD) next.delete('period'); else next.set('period', p); return next; }, { replace: true });
  const { data, loading, error, reload, refreshing } = usePlatformAnalytics(period);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect label="الفترة" value={period} defaultValue={DEFAULT_PERIOD} onChange={setPeriod} options={PERIODS} />
      {data && !isEmpty(data) && <ExportButton onExport={() => exportAll(data, period)} />}
    </div>
  );
  const sub = data ? periodSub(data, period) : 'ما تدفعه الشركات وما يكلفه تشغيل المنصة، وحال كل شركة والطلاب والتطبيق.';
  const header = <PageHeader title="تحليلات المنصة" sub={sub} actions={actions} />;

  if (loading) return <Page>{header}<Loading /></Page>;
  if (error && !data) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل التحليلات" text="لم نستطع جلب الأرقام. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void reload()} /></Page>;
  }
  if (!data) {
    return (
      <Page>{header}
        <EmptyState card icon="trend" title="تحليلات المنصة غير متاحة بعد" text="تظهر هنا بعد تحديث النظام القادم. باقي اللوحة يعمل كالمعتاد." />
      </Page>
    );
  }

  if (isEmpty(data)) {
    return (
      <Page>{header}
        <EmptyState card icon="trend" title={period === 'all' ? 'لا أرقام بعد' : `لا أرقام في «${periodLabel(period)}»`}
          text={period === 'all' ? 'حين تحدّد اشتراك كل شركة وتسجّل تكاليف التشغيل، وينضم الطلاب، تظهر هنا أرقام المنصة وتوصياتها.' : 'لم يُفوتر ولم يُحصَّل ولم يُصرف شيء، ولم يركب أحد في هذه الفترة.'}
          action={period !== 'all' ? <Button kind="secondary" onClick={() => setPeriod('all')}>اعرض كل الوقت</Button> : <Button kind="secondary" iconEnd="fwd" to="/platform/billing">افتح الحسابات</Button>} />
      </Page>
    );
  }

  return (
    <Page className={refreshing ? 'opacity-90' : ''}>
      {header}
      <Recommendations data={data} />
      <Numbers data={data} />
      <MoneyByMonth data={data} />
      <Companies data={data} />
      <Students data={data} />
      <Usage data={data} />
    </Page>
  );
};
export default PlatformAnalyticsPage;

/** Nothing at all in the period: no money in or out, no plans, no students, no rides. */
const isEmpty = (a: PlatformAnalytics) => {
  const f = a.finance;
  return !Number(f.mrr) && !Number(f.billed) && !Number(f.collected) && !Number(f.costs_total) && !Number(f.outstanding)
    && a.students.total === 0 && a.usage.daily.length === 0;
};

function periodSub(a: PlatformAnalytics, period: PeriodKey): string {
  if (period === 'all') return `منذ البداية حتى ${dayText(a.period.to)}`;
  const from = a.period.from;
  return `${from ? `${dayText(from, { year: from.slice(0, 4) !== a.period.to.slice(0, 4) })} – ` : ''}${dayText(a.period.to)}`;
}

// ───────────────────────────────────────────────────── recommendations ────

const Recommendations: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const [all, setAll] = useState(false);
  const list = platformInsights(data.insights).map((i) => ({ i, t: platformInsightText(i) }));
  const shown = all ? list : list.slice(0, 6);
  return (
    <Section title="توصيات" meta={list.length ? <span className="text-label text-ink-3">{countText(list.length, ['توصية', 'توصيتان', 'توصيات', 'توصية'])}</span> : undefined}
      end={list.length > 6 ? <Button kind="link" sm onClick={() => setAll(!all)}>{all ? 'أقل' : `اعرض الكل (${num(list.length)})`}</Button> : undefined}>
      {list.length === 0 ? (
        <Card className="flex items-center gap-3 px-4 py-4 sm:px-5">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-ok" />
          <span className="text-small text-ink-2">لا توصيات الآن — الشركات تدفع، والأرقام في حدودها.</span>
        </Card>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(({ i, t }, n) => (
            <li key={`${i.key}${n}`} className="flex">
              <Card className="flex w-full flex-col gap-1.5 px-4 py-4 sm:px-5">
                <div className="flex items-start gap-2.5">
                  <span aria-hidden="true" className={`mt-[9px] h-2 w-2 flex-none rounded-full ${DOT[t.tone]}`} />
                  <h3 className="m-0 text-small font-semibold"><span className="sr-only">{SEVERITY_WORD[t.tone]}: </span>{t.title}</h3>
                </div>
                <p className="m-0 ps-[18px] text-label text-ink-2">{t.sub}</p>
                {t.action && (
                  <Link to={t.action.to} className="mt-auto inline-flex items-center gap-1 self-start ps-[18px] pt-1 text-label font-semibold text-teal hover:underline">
                    {t.action.label}<Icon name="fwd" size={14} stroke={2} />
                  </Link>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

// ─────────────────────────────────────────────────────────────── numbers ────

const Numbers: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const f = data.finance;
  const overdue = f.overdue.reduce((t, o) => t + Number(o.amount), 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-6 min-[1600px]:grid-cols-6">
      <StatCard label="الدخل الشهري" value={num(f.mrr)} unit="ج.م" hint={`متكرر، من اشتراكات الشركات (${countText(f.active_companies, NOUN.company)} تعمل)`} to="/platform/billing?tab=plans" />
      <StatCard label="المحصّل" value={num(f.collected)} unit="ج.م" hint={`من ${moneyText(f.billed)} فوترتها في الفترة`} />
      <StatCard label="المستحق" value={num(f.outstanding)} unit="ج.م" hint={overdue ? `منها ${moneyText(overdue)} متأخرة` : 'لا متأخرات'} to="/platform/billing?tab=charges" />
      <StatCard label="تكاليف التشغيل" value={num(f.costs_total)} unit="ج.م" hint={f.cost_per_company != null ? `${moneyText(f.cost_per_company)} لكل شركة تعمل` : 'في هذه الفترة'} to="/platform/billing?tab=expenses" />
      <StatCard label="صافي الربح" value={<span dir="ltr" className="[unicode-bidi:isolate]">{num(f.profit)}</span>} unit="ج.م" hint={f.margin != null ? `هامش ${percentText(Math.round(f.margin * 100))} من المحصّل` : 'المحصّل ناقص التكاليف'} />
      <StatCard label="تكلفة الطالب" value={f.cost_per_student == null ? '—' : num(f.cost_per_student)} unit={f.cost_per_student == null ? undefined : 'ج.م'}
        hint={f.subscribers ? `على ${countText(f.subscribers, ['مشترك', 'مشتركان', 'مشتركين', 'مشتركاً'])}` : 'لا مشتركين'} />
    </div>
  );
};

// ────────────────────────────────────────────────────────── money by month ────

const MoneyByMonth: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const f = data.finance;
  const months = f.by_month;
  const crossYear = new Set(months.map((m) => m.month.slice(0, 4))).size > 1;
  const series = [
    { name: 'المحصّل', tone: 'teal' as const, points: months.map((m) => ({ x: m.month, y: Number(m.collected) })) },
    { name: 'التكاليف', tone: 'ink' as const, points: months.map((m) => ({ x: m.month, y: Number(m.costs) })) },
    { name: 'المفوتر', tone: 'muted' as const, points: months.map((m) => ({ x: m.month, y: Number(m.billed) })) },
  ];
  const profits = months.filter((m) => Number(m.profit) > 0).map((m) => ({ label: monthText(m.month, crossYear), value: Number(m.profit), sub: 'ربح' }));
  return (
    <Section title="المال شهرياً" end={<Button kind="link" sm iconEnd="fwd" to="/platform/billing?tab=pnl">افتح الأرباح</Button>}>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="المحصّل والتكاليف" sub="بالجنيه: ما دُفع للمنصة في كل شهر، وما كلّفه تشغيلها، وما فُوتر" className="lg:col-span-2">
          {months.some((m) => Number(m.billed) || Number(m.collected) || Number(m.costs)) ? <LineChart series={series} label="المحصّل والتكاليف شهرياً" xFormat={(m) => monthText(m, crossYear && m.endsWith('-01'))} format={(v) => num(v)} />
            : <p className="m-0 text-label text-ink-3">لا فواتير ولا تكاليف في هذه الفترة.</p>}
        </Panel>
        <Panel title="التكاليف حسب النوع" sub="ما صُرف في الفترة">
          <BarList empty="لم تُسجَّل تكاليف في هذه الفترة." rows={f.costs_by_category.map((c) => ({
            key: c.category, name: CATEGORY_LABEL[c.category] ?? c.category, value: Number(c.amount), display: <Money value={Number(c.amount)} />,
          }))} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="الربح حسب الشهر" sub="الأشهر التي زاد فيها المحصّل على التكاليف" className="lg:col-span-2">
          {profits.length ? <ColumnChart items={profits} label="الربح حسب الشهر بالجنيه" /> : <p className="m-0 text-label text-ink-3">لم يزد المحصّل على التكاليف في أي شهر من هذه الفترة.</p>}
        </Panel>
        <Panel title="شركات متأخرة في السداد" sub="فواتير مضى على بدايتها أكثر من 14 يوماً">
          <BarList empty="لا شركة متأخرة." rows={f.overdue.map((o) => ({
            key: o.company_id, name: <Link to={`/platform/companies?company=${o.company_id}`} className="hover:underline">{o.name}</Link>,
            note: `منذ ${dayText(o.oldest_due)}`, value: Number(o.amount), display: <Money value={Number(o.amount)} />, strong: true,
          }))} />
        </Panel>
      </div>
    </Section>
  );
};

// ───────────────────────────────────────────────────────────── companies ────

type CompanySort = 'health' | 'subscribers' | 'revenue' | 'outstanding';
const SORTS: { value: CompanySort; label: string }[] = [
  { value: 'health', label: 'الأضعف صحة أولاً' }, { value: 'subscribers', label: 'الأكثر مشتركين' },
  { value: 'revenue', label: 'الأعلى إيراداً' }, { value: 'outstanding', label: 'الأكثر مستحقاً' },
];
const sortCompanies = (rows: CompanyStat[], sort: CompanySort) => rows.slice().sort((a, b) => {
  if (sort === 'health') return (a.health ?? 999) - (b.health ?? 999) || b.subscribers - a.subscribers;
  if (sort === 'revenue') return Number(b.company_revenue) - Number(a.company_revenue);
  if (sort === 'outstanding') return Number(b.outstanding) - Number(a.outstanding);
  return b.subscribers - a.subscribers;
});

const Health: React.FC<{ score: number | null }> = ({ score }) => {
  if (score == null) return <span className="text-ink-3">—</span>;
  const h = healthTone(score);
  return <Pill tone={h.tone}><span className="tabular">{num(score)}</span> · {h.label}</Pill>;
};
const planText = (c: CompanyStat) => (c.plan_fee == null || !c.plan_cycle ? null : `${moneyText(Number(c.plan_fee))} ${CYCLE_LABEL[c.plan_cycle]}`);
const seenText = (iso: string | null) => (iso ? agoText(iso) : 'لم يدخل بعد');

const Companies: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const navigate = useNavigate();
  const [sort, setSort] = useState<CompanySort>('health');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => sortCompanies(data.companies.list, sort), [data.companies.list, sort]);
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const k = data.companies.counts;
  const open = (c: CompanyStat) => navigate(`/platform/companies?company=${c.id}`);

  const columns: Column<CompanyStat>[] = [
    { key: 'name', label: 'الشركة', w: 200, render: (c) => <Cell2 main={c.name} sub={c.status === 'active' ? `خطوط تعمل: ${num(c.active_lines)} من ${num(c.lines)}` : undefined} /> },
    { key: 'health', label: 'الصحة', w: 130, render: (c) => (c.status === 'active' ? <Health score={c.health} /> : <CompanyState status={c.status} />) },
    { key: 'students', label: 'الطلاب', w: 84, align: 'end', render: (c) => <span className="tabular">{num(c.students)}</span> },
    { key: 'subs', label: 'المشتركون', w: 96, align: 'end', render: (c) => <span className="tabular">{num(c.subscribers)}</span> },
    { key: 'confirm', label: 'يؤكدون', w: 84, align: 'end', hideTablet: true, render: (c) => <span className="tabular">{pctText(c.confirm_rate)}</span> },
    { key: 'revenue', label: 'إيراداتها', w: 120, align: 'end', render: (c) => <Money value={Number(c.company_revenue)} /> },
    { key: 'plan', label: 'اشتراكها للمنصة', w: 150, render: (c) => planText(c) ?? <span className="text-label text-warn">بلا اشتراك</span> },
    { key: 'due', label: 'المستحق', w: 110, align: 'end', render: (c) => (Number(c.outstanding) ? <span className={Number(c.overdue) ? 'font-semibold text-bad' : ''}><Money value={Number(c.outstanding)} /></span> : <span className="text-ink-3">—</span>) },
    { key: 'seen', label: 'آخر دخول لمديرها', w: 130, hideTablet: true, render: (c) => <span className={c.last_admin_seen ? '' : 'text-ink-3'}>{seenText(c.last_admin_seen)}</span> },
  ];
  const card = (c: CompanyStat) => ({
    title: c.name, sub: planText(c) ?? 'بلا اشتراك للمنصة',
    end: c.status === 'active' ? <Health score={c.health} /> : <CompanyState status={c.status} />,
    stats: [['الطلاب', num(c.students)], ['المشتركون', num(c.subscribers)], ['يؤكدون', pctText(c.confirm_rate)]] as [React.ReactNode, React.ReactNode][],
    fields: [
      ['إيراداتها', <Money key="r" value={Number(c.company_revenue)} />],
      ['المستحق', Number(c.outstanding) ? <Money key="o" value={Number(c.outstanding)} /> : '—'],
      ['آخر دخول لمديرها', seenText(c.last_admin_seen)],
    ] as [React.ReactNode, React.ReactNode][],
  });
  const meta = <span className="text-label text-ink-3">{`${num(k.active)} تعمل`}{k.suspended ? ` · ${num(k.suspended)} موقوفة` : ''}{k.archived ? ` · ${num(k.archived)} مؤرشفة` : ''}</span>;

  return (
    <Section title="الشركات" meta={meta} end={<Button kind="link" sm iconEnd="fwd" to="/platform/companies">افتح الشركات</Button>}>
      <DataTable<CompanyStat> id="platform-analytics-companies" columns={columns} rows={pageRows} rowKey={(c) => c.id} card={card} onOpen={open}
        caption="الشركات: الصحة والطلاب والمشتركون والإيرادات والاشتراك والمستحق"
        muted={(c) => c.status !== 'active'}
        toolbar={rows.length > 1 ? <Toolbar count={<span className="sm:hidden">{num(rows.length)} شركة</span>} sort={<SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={SORTS} />} /> : undefined}
        empty={rows.length ? undefined : <EmptyState icon="building" title="لا شركات بعد" text="حين تضيف شركة تظهر هنا أرقامها." action={<Button kind="secondary" iconEnd="fwd" to="/platform/companies/new">شركة جديدة</Button>} />}
        pager={rows.length > PAGE ? <Pager page={page} total={rows.length} onPage={setPage} /> : undefined} />
      <p className="m-0 text-cap text-ink-3">الصحة من 100: دخول المدير إلى اللوحة (25)، تأكيد الطلاب للركوب (30)، سداد اشتراك المنصة (25)، سرعة مراجعة الإيصالات (20).</p>
    </Section>
  );
};

// ───────────────────────────────────────────────────────────── students ────

const share = (n: number, of: number) => (of > 0 ? percentText(Math.round((n / of) * 100)) : '');

const Students: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const s = data.students;
  const crossYear = new Set(s.new_by_month.map((m) => m.month.slice(0, 4))).size > 1;
  const months = s.new_by_month.map((m) => ({ label: monthText(m.month, crossYear), value: m.count, sub: 'طالباً جديداً' }));
  return (
    <Section title="الطلاب والجامعات والكليات" end={<Button kind="link" sm iconEnd="fwd" to="/platform/universities">افتح الجامعات</Button>}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-6">
        <StatCard label="كل الطلاب" value={num(s.total)} hint={`${num(s.new_in_period)} سجّلوا في الفترة`} />
        <StatCard label="في شركة" value={num(s.with_company)} hint={share(s.with_company, s.total) ? `${share(s.with_company, s.total)} من الطلاب` : '—'} />
        <StatCard label="بلا شركة" value={num(s.without_company)} hint="سجّلوا ولم ينضموا لشركة" />
        <StatCard label="مشتركون الآن" value={num(s.subscribers)} hint={share(s.subscribers, s.total) ? `${share(s.subscribers, s.total)} من الطلاب` : '—'} />
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="الجامعات" sub="الطلاب، وكم شركة وخطاً يخدمها">
          <BarList rows={s.by_university.map((u, i) => ({
            key: u.id ?? `u${i}`, name: u.name ?? <span className="text-ink-3">لم يحددها الطالب</span>, value: u.students,
            note: u.id ? `${countText(u.companies, NOUN.company)} · ${u.lines ? countText(u.lines, NOUN.line) : 'بلا خطوط'}` : undefined,
            strong: !!u.id && u.students >= 20 && u.lines <= 1,
          }))} />
        </Panel>
        <Panel title="الكليات" sub="أكثر 20 كلية">
          <BarList rows={s.by_college.map((c) => ({ key: c.name, name: c.name, value: c.count, note: share(c.count, s.total) }))} />
        </Panel>
        <Panel title="التخصصات" sub="أكثر 10 تخصصات كما كتبها الطلاب">
          <BarList rows={s.by_specialisation.map((c) => ({ key: c.name, name: c.name, value: c.count, note: share(c.count, s.total) }))} />
        </Panel>
      </div>
      <Panel title="الطلاب الجدد حسب الشهر" sub="من سجّل في التطبيق">
        {months.length ? <ColumnChart items={months} label="الطلاب الجدد حسب الشهر" /> : <p className="m-0 text-label text-ink-3">لم يسجّل طلاب في هذه الفترة.</p>}
      </Panel>
    </Section>
  );
};

// ───────────────────────────────────────────────────────────────── usage ────

const Usage: React.FC<{ data: PlatformAnalytics }> = ({ data }) => {
  const u = data.usage;
  const scanned = u.daily.some((d) => d.boarded > 0);
  const series = [
    { name: 'أكدوا الركوب', tone: 'teal' as const, points: u.daily.map((d) => ({ x: d.date, y: d.confirmed })) },
    ...(scanned ? [{ name: 'صعدوا فعلاً', tone: 'ink' as const, points: u.daily.map((d) => ({ x: d.date, y: d.boarded })) }] : []),
  ];
  const devices = u.devices.ios + u.devices.android;
  const latest = u.latest ?? {};
  const fail = u.push_7d;
  return (
    <Section title="الاستخدام" meta={<span className="text-label text-ink-3">{u.daily.length >= 60 ? 'آخر 60 يوم تشغيل' : 'أيام التشغيل في الفترة'}</span>}>
      <Panel title="الركاب يوماً بيوم في كل الشركات" sub={scanned ? 'من أكد الركوب، ومن صعد فعلاً بمسح المشرف' : 'من أكد الركوب (لم يمسح المشرفون أحداً في الفترة)'}>
        {u.daily.length >= 2 ? <LineChart series={series} label="الركاب يوماً بيوم في كل الشركات" /> : <p className="m-0 text-label text-ink-3">يظهر الخط بعد يومي تشغيل على الأقل.</p>}
      </Panel>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="الأجهزة" sub={`${countText(devices, ['جهاز', 'جهازان', 'أجهزة', 'جهازاً'])} تستقبل الإشعارات`}>
          <BarList rows={[
            { key: 'android', name: platformLabel.android, value: u.devices.android, note: share(u.devices.android, devices) },
            { key: 'ios', name: platformLabel.ios, value: u.devices.ios, note: share(u.devices.ios, devices) },
          ]} />
          <p className="m-0 border-t border-hair pt-3 text-label text-ink-2">
            {fail.failure_rate == null ? 'لم تُرسل إشعارات في آخر 7 أيام.'
              : <>فشل {percentText(Math.round(fail.failure_rate * 100))} من الإشعارات في آخر 7 أيام <span className="text-ink-3">({num(fail.failed)} من {num(fail.failed + fail.accepted)})</span></>}
          </p>
        </Panel>
        <Panel title="إصدارات التطبيق" sub="كم جهازاً على كل إصدار" className="lg:col-span-2"
          end={<Button kind="link" sm iconEnd="fwd" to="/platform/app-versions">افتح الإصدارات</Button>}>
          <BarList limit={10} empty="لا أجهزة بعد." rows={u.app_versions.map((v) => ({
            key: `${v.platform}${v.version}`, name: <span><span dir="ltr" className="[unicode-bidi:isolate]">{v.version}</span> <span className="text-label font-normal text-ink-2">{platformLabel[v.platform as 'ios' | 'android'] ?? v.platform}</span></span>,
            note: latest[v.platform] === v.version ? 'آخر إصدار' : undefined, value: v.devices,
          }))} />
        </Panel>
      </div>
    </Section>
  );
};

// ────────────────────────────────────────────────────────────── loading ────

const Loading: React.FC = () => (
  <>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Card key={i} className="flex flex-col gap-3 p-5"><SkeletonBar w={220} h={14} /><SkeletonBar w={280} h={10} /><SkeletonBar w={90} h={10} /></Card>)}</div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-6 min-[1600px]:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonStat key={i} />)}</div>
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-6"><Card className="flex h-[280px] flex-col gap-4 p-5 lg:col-span-2"><SkeletonBar w={160} h={14} /></Card><Card className="flex flex-col gap-4 p-5"><SkeletonBar w={120} h={14} />{[0, 1, 2, 3].map((j) => <SkeletonBar key={j} w={260 - j * 30} h={10} />)}</Card></div>
    <SkeletonTable rows={6} cols={8} />
  </>
);

// ─────────────────────────────────────────────────────────────── export ────

const sheet = <T,>(spec: SheetSpec<T>) => spec as SheetSpec;

async function exportAll(a: PlatformAnalytics, period: PeriodKey) {
  const f = a.finance; const s = a.students; const u = a.usage;
  const sheets: SheetSpec[] = [
    sheet({ sheet: 'التوصيات', rows: platformInsights(a.insights).map(platformInsightText), columns: [
      { label: 'الأولوية', value: (t) => SEVERITY_WORD[t.tone], width: 14 }, { label: 'التوصية', value: (t) => t.title, width: 60 }, { label: 'التفاصيل', value: (t) => t.sub, width: 80 },
    ] }),
    sheet({ sheet: 'الأرقام', rows: [
      ['الفترة', periodLabel(period)], ['من', a.period.from ?? 'البداية'], ['إلى', a.period.to],
      ['الدخل الشهري المتكرر (ج.م)', f.mrr], ['المفوتر (ج.م)', f.billed], ['المحصّل (ج.م)', f.collected], ['المستحق (ج.م)', f.outstanding],
      ['تكاليف التشغيل (ج.م)', f.costs_total], ['صافي الربح (ج.م)', f.profit], ['الهامش %', f.margin == null ? null : Math.round(f.margin * 100)],
      ['تكلفة الشركة (ج.م)', f.cost_per_company], ['تكلفة الطالب (ج.م)', f.cost_per_student], ['المشتركون', f.subscribers], ['الشركات العاملة', f.active_companies],
      ['كل الطلاب', s.total], ['في شركة', s.with_company], ['بلا شركة', s.without_company], ['سجّلوا في الفترة', s.new_in_period],
      ['أجهزة آيفون', u.devices.ios], ['أجهزة أندرويد', u.devices.android], ['فشل الإشعارات في 7 أيام %', u.push_7d.failure_rate == null ? null : Math.round(u.push_7d.failure_rate * 100)],
    ] as [string, string | number | null][], columns: [{ label: 'البند', value: (x) => x[0], width: 34 }, { label: 'القيمة', value: (x) => x[1], width: 18 }] }),
    sheet({ sheet: 'المال شهرياً', rows: f.by_month, columns: [
      { label: 'الشهر', value: (m) => monthText(m.month), width: 16 }, { label: 'المفوتر (ج.م)', value: (m) => Number(m.billed), format: MONEY_FORMAT, width: 14 },
      { label: 'المحصّل (ج.م)', value: (m) => Number(m.collected), format: MONEY_FORMAT, width: 14 }, { label: 'التكاليف (ج.م)', value: (m) => Number(m.costs), format: MONEY_FORMAT, width: 14 },
      { label: 'الربح (ج.م)', value: (m) => Number(m.profit), format: MONEY_FORMAT, width: 14 },
    ] }),
    sheet({ sheet: 'التكاليف حسب النوع', rows: f.costs_by_category, columns: [
      { label: 'النوع', value: (c) => CATEGORY_LABEL[c.category] ?? c.category, width: 22 }, { label: 'المبلغ (ج.م)', value: (c) => Number(c.amount), format: MONEY_FORMAT, width: 14 },
    ] }),
    sheet({ sheet: 'المتأخرات', rows: f.overdue, columns: [
      { label: 'الشركة', value: (o) => o.name, width: 28 }, { label: 'المبلغ (ج.م)', value: (o) => Number(o.amount), format: MONEY_FORMAT, width: 14 }, { label: 'أقدم فاتورة', value: (o) => o.oldest_due, width: 14 },
    ] }),
    sheet({ sheet: 'الشركات', rows: a.companies.list, columns: [
      { label: 'الشركة', value: (c) => c.name, width: 28 }, { label: 'الحالة', value: (c) => ({ active: 'تعمل', suspended: 'موقوفة', archived: 'مؤرشفة' }[c.status]), width: 10 },
      { label: 'الصحة', value: (c) => c.health }, { label: 'الطلاب', value: (c) => c.students }, { label: 'المشتركون', value: (c) => c.subscribers },
      { label: 'المشتركون في الفترة السابقة', value: (c) => c.subscribers_before, width: 16 }, { label: 'الخطوط العاملة', value: (c) => c.active_lines },
      { label: 'متوسط الركاب', value: (c) => c.riders_avg, format: '0.0' }, { label: 'نسبة التأكيد %', value: (c) => (c.confirm_rate == null ? null : Math.round(c.confirm_rate * 100)) },
      { label: 'إيراداتها (ج.م)', value: (c) => Number(c.company_revenue), format: MONEY_FORMAT, width: 14 },
      { label: 'اشتراك المنصة (ج.م)', value: (c) => (c.plan_fee == null ? null : Number(c.plan_fee)), format: MONEY_FORMAT, width: 14 },
      { label: 'دورة الاشتراك', value: (c) => (c.plan_cycle ? CYCLE_LABEL[c.plan_cycle] : null), width: 14 },
      { label: 'المستحق (ج.م)', value: (c) => Number(c.outstanding), format: MONEY_FORMAT, width: 14 },
      { label: 'المدة المعتادة للمراجعة (ساعة)', value: (c) => c.median_review_hours, width: 16 },
      { label: 'آخر دخول لمديرها', value: (c) => (c.last_admin_seen ? c.last_admin_seen.slice(0, 10) : null), width: 16 },
    ] }),
    sheet({ sheet: 'الجامعات', rows: s.by_university, columns: [
      { label: 'الجامعة', value: (x) => x.name ?? 'لم يحددها الطالب', width: 34 }, { label: 'الطلاب', value: (x) => x.students }, { label: 'الشركات', value: (x) => x.companies }, { label: 'الخطوط', value: (x) => x.lines },
    ] }),
    sheet({ sheet: 'الكليات', rows: s.by_college, columns: [{ label: 'الكلية', value: (x) => x.name, width: 34 }, { label: 'الطلاب', value: (x) => x.count }] }),
    sheet({ sheet: 'التخصصات', rows: s.by_specialisation, columns: [{ label: 'التخصص', value: (x) => x.name, width: 34 }, { label: 'الطلاب', value: (x) => x.count }] }),
    sheet({ sheet: 'الطلاب الجدد', rows: s.new_by_month, columns: [{ label: 'الشهر', value: (x) => monthText(x.month), width: 16 }, { label: 'الطلاب', value: (x) => x.count }] }),
    sheet({ sheet: 'يوماً بيوم', rows: u.daily, columns: [{ label: 'اليوم', value: (x) => x.date, width: 14 }, { label: 'أكدوا', value: (x) => x.confirmed }, { label: 'صعدوا', value: (x) => x.boarded }] }),
    sheet({ sheet: 'الإصدارات', rows: u.app_versions, columns: [
      { label: 'المتجر', value: (x) => platformLabel[x.platform as 'ios' | 'android'] ?? x.platform }, { label: 'الإصدار', value: (x) => x.version }, { label: 'الأجهزة', value: (x) => x.devices },
    ] }),
  ];
  await exportSheets(`تحليلات المنصة - ${periodLabel(period)}`, sheets);
}
