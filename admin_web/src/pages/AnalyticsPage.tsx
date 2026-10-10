import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCompany } from '../lib/adminScope';
import {
  DEFAULT_PERIOD, DIRECTION_LABEL, PERIODS, WEEKDAY_LABEL, fillRate, isEmpty, linesOf, monthLabel, pct, periodLabel, stationsOf,
  useCompanyAnalytics, type CompanyAnalytics, type PeriodKey, type TripStat,
} from '../lib/analytics';
import { hoursText, insightText, percentText, type InsightTone } from '../lib/analyticsInsights';
import { REVENUE_OPTION_LABEL, type RevenueOption } from '../lib/money';
import { exportSheets, type SheetSpec } from '../lib/excel';
import { MONEY_FORMAT } from '../lib/excelCells';
import {
  Button, Card, Cell2, DataTable, EmptyState, ErrorState, Icon, Money, Page, PageHeader, Pager, Section, SkeletonBar, SkeletonStat,
  SkeletonTable, StatCard, clock, countText, dayText, moneyText, num, NOUN, type Column,
} from '../ui';
import { ExportButton } from '../ui/Transfer';
import { ColumnChart, LineChart } from '../ui/Chart';
import { FilterSelect } from '../components/money/Revenue';
import { RidersMeter } from '../components/lines/LineTimetable';

const PAGE = 25;
const SEVERITY_WORD = { danger: 'يحتاج تصرفاً', warning: 'للمتابعة', teal: 'فرصة', success: 'جيد' } as const;
const DOT: Record<InsightTone, string> = { danger: 'bg-bad', warning: 'bg-warn', success: 'bg-ok', teal: 'bg-teal' };
const pctText = (share: number | null | undefined) => (share == null ? '—' : percentText(pct(share) ?? 0));
const optionName = (o: string) => REVENUE_OPTION_LABEL[o as RevenueOption] ?? o;
const tripTime = (t: TripStat) => (t.start_time ? clock(t.start_time) : '—');
const one = (v: number) => (Number.isInteger(v) ? num(v) : v.toLocaleString('en-US', { maximumFractionDigits: 1 }));
/** Egypt's week starts on Saturday. */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

/** «التحليلات»: who the students are, where they board, how full the buses run, money and receipts, and what to do about it. */
export const AnalyticsPage: React.FC = () => {
  const company = useCompany();
  const base = `/c/${company.id}`;
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.some((p) => p.value === params.get('period')) ? params.get('period') : DEFAULT_PERIOD) as PeriodKey;
  const setPeriod = (p: PeriodKey) => setParams((prev) => { const next = new URLSearchParams(prev); if (p === DEFAULT_PERIOD) next.delete('period'); else next.set('period', p); return next; }, { replace: true });
  const { data, loading, error, reload, refreshing } = useCompanyAnalytics(company.id, period);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect label="الفترة" value={period} defaultValue={DEFAULT_PERIOD} onChange={setPeriod} options={PERIODS} />
      {data && !isEmpty(data) && <ExportButton onExport={() => exportAll(data, period, company.name)} />}
    </div>
  );
  const sub = data ? periodSub(data, period) : 'أرقام شركتك لتعرف أين تحسّن الخدمة والباصات.';
  const header = <PageHeader title="التحليلات" sub={sub} actions={actions} />;

  if (loading) return <Page>{header}<Loading /></Page>;
  if (error && !data) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل التحليلات" text="لم نستطع جلب الأرقام. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void reload()} /></Page>;
  }
  if (data === null || data === undefined) {
    return (
      <Page>{header}
        <EmptyState card icon="trend" title="التحليلات غير متاحة بعد" text="تظهر هنا بعد تحديث النظام القادم. باقي اللوحة يعمل كالمعتاد." />
      </Page>
    );
  }
  if (isEmpty(data)) {
    return (
      <Page>{header}
        <EmptyState card icon="trend" title={period === 'all' ? 'لا أرقام بعد' : `لا أرقام في «${periodLabel(period)}»`}
          text={period === 'all' ? 'حين ينضم الطلاب ويشتركون ويؤكدون ركوبهم تظهر هنا أرقامهم وتوصيات لتحسين الخدمة.' : 'لم ينضم طلاب ولم يُدفع ولم يُركب شيء في هذه الفترة.'}
          action={period !== 'all' ? <Button kind="secondary" onClick={() => setPeriod('all')}>اعرض كل الوقت</Button> : <Button kind="secondary" iconEnd="fwd" to={`${base}/students`}>افتح الطلاب</Button>} />
      </Page>
    );
  }

  return (
    <Page className={refreshing ? 'opacity-90' : ''}>
      {header}
      <Recommendations data={data} base={base} />
      <Numbers data={data} />
      <Students data={data} base={base} />
      <Stations data={data} />
      <Trips data={data} base={base} />
      <Trend data={data} />
      <MoneyAndReceipts data={data} base={base} />
    </Page>
  );
};
export default AnalyticsPage;

function periodSub(a: CompanyAnalytics, period: PeriodKey): string {
  const days = a.period.ride_days ? ` · ${countText(a.period.ride_days, NOUN.day)} تشغيل` : '';
  if (period === 'all') return `منذ البداية حتى ${dayText(a.period.to)}${days}`;
  return `${a.period.from ? `${dayText(a.period.from, { year: a.period.from.slice(0, 4) !== a.period.to.slice(0, 4) })} – ` : ''}${dayText(a.period.to)}${days}`;
}

// ───────────────────────────────────────────────────── recommendations ────

const Recommendations: React.FC<{ data: CompanyAnalytics; base: string }> = ({ data, base }) => {
  const [all, setAll] = useState(false);
  const list = data.insights.map((i) => ({ i, t: insightText(i, base) }));
  const shown = all ? list : list.slice(0, 6);
  return (
    <Section title="توصيات لتحسين الخدمة" meta={list.length ? <span className="text-label text-ink-3">{countText(list.length, ['توصية', 'توصيتان', 'توصيات', 'توصية'])}</span> : undefined}
      end={list.length > 6 ? <Button kind="link" sm onClick={() => setAll(!all)}>{all ? 'أقل' : `اعرض الكل (${num(list.length)})`}</Button> : undefined}>
      {list.length === 0 ? (
        <Card className="flex items-center gap-3 px-4 py-4 sm:px-5">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-ok" />
          <span className="text-small text-ink-2">لا توصيات الآن — كل شيء يسير جيداً.</span>
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

const Numbers: React.FC<{ data: CompanyAnalytics }> = ({ data }) => {
  const s = data.students; const m = data.money; const r = data.rides;
  const fill = fillRate(data.trips);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-6 min-[1600px]:grid-cols-6">
      <StatCard label="مشتركون" value={num(s.subscribers)} hint={`من ${countText(s.members, NOUN.student)}`} />
      <StatCard label="نسبة التأكيد" value={pctText(r?.confirm_rate)}
        hint={r && data.period.ride_days ? `${one(r.avg_confirmed)} يؤكدون في اليوم` : 'لا أيام تشغيل'} />
      <StatCard label="امتلاء الباصات" value={pctText(fill)} bar={fill == null ? undefined : Math.min(100, (pct(fill) ?? 0))}
        hint={fill == null ? 'اكتب عدد مقاعد كل خط' : 'متوسط الركاب من المقاعد'} />
      <StatCard label="الإيرادات في الفترة" value={num(m.revenue)} unit="ج.م" hint={m.paying ? `من ${countText(m.paying, NOUN.student)}` : '—'} />
      <StatCard label="متوسط ما يدفعه الطالب" value={num(m.avg_per_student)} unit="ج.م" hint="في هذه الفترة" />
      <StatCard label="لم يدفعوا" value={num(m.unpaid_count)} hint={m.unpaid_count ? `${moneyText(m.unpaid_amount)} مستحقة` : 'لا مستحقات'} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────── bar lists ────

interface Bar { key: string; name: React.ReactNode; note?: React.ReactNode; value: number; display?: React.ReactNode; strong?: boolean }

/** One number per row with a bar against the largest, in the style of «الإيرادات». */
const BarList: React.FC<{ rows: Bar[]; limit?: number; empty?: string; max?: number; columns?: boolean }> = ({ rows, limit = 8, empty = 'لا بيانات', max, columns }) => {
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

const Panel: React.FC<{ title: string; sub?: React.ReactNode; end?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, sub, end, children, className = '' }) => (
  <Card as="section" className={`flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5 ${className}`}>
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1"><h3 className="m-0 text-card">{title}</h3>{sub && <div className="text-label text-ink-2">{sub}</div>}</div>
      {end}
    </div>
    {children}
  </Card>
);

// ────────────────────────────────────────────────────────────── students ────

const share = (n: number, of: number) => (of > 0 ? percentText(Math.round((n / of) * 100)) : '');

const Students: React.FC<{ data: CompanyAnalytics; base: string }> = ({ data, base }) => {
  const s = data.students;
  const meta = (
    <span className="text-label text-ink-3">
      {countText(s.new_members, NOUN.student)} انضموا في الفترة{s.never_subscribed ? ` · ${countText(s.never_subscribed, NOUN.student)} لم يشتركوا أبداً` : ''}
    </span>
  );
  return (
    <Section title="الطلاب" meta={meta} end={<Button kind="link" sm iconEnd="fwd" to={`${base}/students`}>افتح الطلاب</Button>}>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="الجامعات" sub="الطلاب في شركتك، ومنهم المشتركون الآن">
          <BarList rows={s.by_university.map((u, i) => ({
            key: u.id ?? `u${i}`, name: u.name ?? 'غير محددة', value: u.count,
            note: u.subscribers != null ? `${num(u.subscribers)} مشترك` : undefined,
          }))} />
        </Panel>
        <Panel title="الكليات" sub={`أكثر ${countText(Math.min(15, s.by_college.filter((c) => c.name).length) || 0, ['كلية', 'كليتين', 'كليات', 'كلية'])} عدداً`}>
          <BarList rows={s.by_college.map((c, i) => ({ key: c.name ?? `none${i}`, name: c.name ?? <span className="text-ink-3">لم يحددها الطالب</span>, value: c.count, note: share(c.count, s.members) }))} />
        </Panel>
        <Panel title="التخصصات" sub="كما كتبها الطلاب">
          <BarList rows={s.by_specialisation.map((c, i) => ({ key: c.name ?? `none${i}`, name: c.name ?? <span className="text-ink-3">لم يحدده الطالب</span>, value: c.count, note: share(c.count, s.members) }))} />
        </Panel>
      </div>
      {s.line_university.length > 0 && <LineUniversityTable data={data} />}
    </Section>
  );
};

/** Lines down, universities across: who rides each line. */
const LineUniversityTable: React.FC<{ data: CompanyAnalytics }> = ({ data }) => {
  const rows = data.students.line_university;
  const unis = useMemo(() => {
    const total = new Map<string, { name: string; n: number }>();
    rows.forEach((r) => { const k = r.university_id ?? ''; const e = total.get(k) ?? { name: r.university_name ?? 'غير محددة', n: 0 }; e.n += r.count; total.set(k, e); });
    return [...total].sort((a, b) => b[1].n - a[1].n);
  }, [rows]);
  const cols = unis.slice(0, 5);
  const others = unis.length > 5;
  const lines = linesOf(rows);
  const cell = (line: string, uni: string) => rows.filter((r) => r.line_id === line && (r.university_id ?? '') === uni).reduce((t, r) => t + r.count, 0);
  return (
    <Panel title="الخطوط والجامعات" sub="المشتركون في الفترة: من أي جامعة يركب كل خط">
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[480px] border-collapse text-small">
          <thead>
            <tr className="border-b border-hair text-label text-ink-2">
              <th scope="col" className="py-2 pe-3 text-start font-medium">الخط</th>
              {cols.map(([id, u]) => <th key={id} scope="col" className="px-3 py-2 text-end font-medium">{u.name}</th>)}
              {others && <th scope="col" className="px-3 py-2 text-end font-medium">جامعات أخرى</th>}
              <th scope="col" className="ps-3 py-2 text-end font-medium">المجموع</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const total = rows.filter((r) => r.line_id === l.id).reduce((t, r) => t + r.count, 0);
              const shown = cols.reduce((t, [id]) => t + cell(l.id, id), 0);
              return (
                <tr key={l.id} className="h-11 border-b border-hair last:border-0">
                  <th scope="row" className="pe-3 text-start font-semibold">{l.name}</th>
                  {cols.map(([id]) => { const v = cell(l.id, id); return <td key={id} className={`px-3 text-end tabular ${v ? '' : 'text-ink-3'}`}>{v ? num(v) : '—'}</td>; })}
                  {others && <td className={`px-3 text-end tabular ${total - shown ? '' : 'text-ink-3'}`}>{total - shown ? num(total - shown) : '—'}</td>}
                  <td className="ps-3 text-end font-semibold tabular">{num(total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

// ────────────────────────────────────────────────────────────── stations ────

const Stations: React.FC<{ data: CompanyAnalytics }> = ({ data }) => {
  const [line, setLine] = useState('');
  const lines = linesOf(data.students.by_station);
  const rows = stationsOf(data.students.by_station, line);
  const total = rows.reduce((t, r) => t + r.count, 0);
  return (
    <Section title="أين يركب الطلاب">
      <Panel title={line ? `محطات خط ${lines.find((l) => l.id === line)?.name ?? ''}` : 'المحطات الأكثر ركوباً'}
        sub={total ? `${countText(total, NOUN.student)} مشتركون في الفترة` : 'لا مشتركين في الفترة'}
        end={lines.length > 1 ? (
          <FilterSelect label="الخط" value={line} onChange={setLine} options={[{ value: '', label: 'كل الخطوط' }, ...lines.map((l) => ({ value: l.id, label: l.name }))]} />
        ) : undefined}>
        <BarList columns limit={line ? 20 : 12} empty="لا محطات بعد." rows={rows.map((r) => ({
          key: r.station_id, name: r.station_name, note: line ? share(r.count, total) : `خط ${r.line_name}`, value: r.count,
        }))} />
      </Panel>
    </Section>
  );
};

// ──────────────────────────────────────────────────────────────── trips ────

const Trips: React.FC<{ data: CompanyAnalytics; base: string }> = ({ data, base }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const trips = data.trips;
  const rows = trips.slice((page - 1) * PAGE, page * PAGE);
  const noShow = (t: TripStat) => (t.no_show == null ? <span className="text-ink-3">—</span> : percentText(pct(t.no_show) ?? 0));
  const columns: Column<TripStat>[] = [
    { key: 'line', label: 'الخط', w: 170, render: (t) => <Cell2 main={t.line_name} sub={t.label ?? undefined} /> },
    { key: 'dir', label: 'الاتجاه', w: 90, render: (t) => DIRECTION_LABEL[t.direction] },
    { key: 'time', label: 'الموعد', w: 90, render: (t) => <span className="tabular">{tripTime(t)}</span> },
    { key: 'subs', label: 'المشتركون', w: 100, align: 'end', render: (t) => <span className="tabular">{num(t.subscribers)}</span> },
    { key: 'avg', label: 'متوسط الركاب', w: 110, align: 'end', render: (t) => <span className="tabular">{one(t.avg_riders)}</span> },
    { key: 'peak', label: 'الذروة', w: 80, align: 'end', hideTablet: true, render: (t) => <span className="tabular">{num(t.peak_riders)}</span> },
    { key: 'fill', label: 'الامتلاء', w: 150, render: (t) => (t.capacity ? <RidersMeter riders={Math.round(t.avg_riders)} seats={t.capacity} w="w-[130px]" /> : <span className="text-label text-ink-3">بلا عدد مقاعد</span>) },
    { key: 'over', label: 'أيام الزحام', w: 100, align: 'end', render: (t) => (t.days_over ? <span className="font-semibold text-warn tabular">{num(t.days_over)}</span> : <span className="text-ink-3">—</span>) },
    { key: 'noshow', label: 'لم يصعدوا', w: 100, align: 'end', hideTablet: true, render: noShow },
  ];
  const card = (t: TripStat) => ({
    title: t.line_name, sub: `${DIRECTION_LABEL[t.direction]} · ${tripTime(t)}${t.label ? ` · ${t.label}` : ''}`,
    end: t.days_over ? <span className="text-label font-semibold text-warn">{countText(t.days_over, NOUN.day)} زحام</span> : undefined,
    stats: [['المشتركون', num(t.subscribers)], ['متوسط الركاب', one(t.avg_riders)], ['الذروة', num(t.peak_riders)]] as [React.ReactNode, React.ReactNode][],
    fields: [
      ['الامتلاء', t.capacity ? <RidersMeter riders={Math.round(t.avg_riders)} seats={t.capacity} w="ms-auto w-[140px]" align="end" /> : 'بلا عدد مقاعد'],
      ['لم يصعدوا', noShow(t)],
    ] as [React.ReactNode, React.ReactNode][],
  });

  const slots = data.time_slots.map((s) => ({ label: clock(s.slot), value: s.riders, sub: 'راكب في اليوم' }));
  const weekdays = WEEK_ORDER.map((d) => data.weekdays.find((w) => w.dow === d)).filter((w): w is NonNullable<typeof w> => !!w && w.confirm_rate != null)
    .map((w) => ({ label: WEEKDAY_LABEL[w.dow], value: pct(w.confirm_rate) ?? 0, sub: w.days ? `${countText(w.days, NOUN.day)} تشغيل` : undefined }));

  return (
    <Section title="الرحلات والباصات" meta={<span className="text-label text-ink-3">المتوسط على أيام التشغيل في الفترة</span>}>
      <DataTable<TripStat> id="analytics-trips" columns={columns} rows={rows} rowKey={(t) => t.trip_id} card={card}
        onOpen={(t) => navigate(`${base}/lines/${t.line_id}`)}
        caption="الرحلات: المشتركون ومتوسط الركاب والامتلاء"
        empty={trips.length ? undefined : <EmptyState icon="route" title="لا رحلات بعد" text="أضف رحلات الخطوط لترى امتلاءها هنا." action={<Button kind="secondary" iconEnd="fwd" to={`${base}/lines`}>افتح الخطوط</Button>} />}
        pager={trips.length > PAGE ? <Pager page={page} total={trips.length} onPage={setPage} /> : undefined} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-6">
        <Panel title="مواعيد الذهاب التي يختارها الطلاب" sub="متوسط الركاب في كل ربع ساعة">
          {slots.length ? <ColumnChart items={slots} label="مواعيد الذهاب" format={one} /> : <p className="m-0 text-label text-ink-3">لم يؤكد أحد في هذه الفترة.</p>}
        </Panel>
        <Panel title="التأكيد حسب أيام الأسبوع" sub="من يؤكد ركوبه من المشتركين">
          {weekdays.length ? <ColumnChart items={weekdays} label="نسبة التأكيد حسب اليوم" format={(n) => percentText(n)} /> : <p className="m-0 text-label text-ink-3">لا أيام تشغيل في هذه الفترة.</p>}
        </Panel>
      </div>
    </Section>
  );
};

// ──────────────────────────────────────────────────────────────── trend ────

const Trend: React.FC<{ data: CompanyAnalytics }> = ({ data }) => {
  const d = data.daily;
  const scanned = d.some((x) => x.boarded > 0);
  const series = [
    { name: 'أكدوا الركوب', tone: 'teal' as const, points: d.map((x) => ({ x: x.date, y: x.confirmed })) },
    ...(scanned ? [{ name: 'صعدوا فعلاً', tone: 'ink' as const, points: d.map((x) => ({ x: x.date, y: x.boarded })) }] : []),
    { name: 'المشتركون', tone: 'muted' as const, points: d.map((x) => ({ x: x.date, y: x.subscribers })) },
  ];
  return (
    <Section title="الاتجاه" meta={<span className="text-label text-ink-3">{d.length >= 60 ? 'آخر 60 يوم تشغيل' : 'كل يوم تشغيل في الفترة'}</span>}>
      <Panel title="الركاب يوماً بيوم" sub={scanned ? 'من أكد الركوب، ومن صعد فعلاً بمسح المشرف، والمشتركون في ذلك اليوم' : 'من أكد الركوب والمشتركون في ذلك اليوم (لم يمسح المشرفون أحداً في الفترة)'}>
        {d.length >= 2 ? <LineChart series={series} label="الركاب يوماً بيوم" /> : <p className="m-0 text-label text-ink-3">يظهر الخط بعد يومي تشغيل على الأقل.</p>}
      </Panel>
    </Section>
  );
};

// ─────────────────────────────────────────────────────── money, receipts ────

const MoneyAndReceipts: React.FC<{ data: CompanyAnalytics; base: string }> = ({ data, base }) => {
  const m = data.money; const r = data.receipts;
  const crossYear = new Set(m.by_month.map((x) => x.month.slice(0, 4))).size > 1;
  const months = m.by_month.map((x) => ({ label: monthLabel(x.month, crossYear), value: Number(x.amount), sub: countText(x.count, ['اشتراك', 'اشتراكان', 'اشتراكات', 'اشتراكاً']) }));
  const reviewed = r.approved + r.rejected;
  return (
    <Section title="المال والإيصالات" end={<Button kind="link" sm iconEnd="fwd" to={`${base}/reports`}>افتح الإيرادات</Button>}>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="الإيرادات حسب الشهر" sub="ما دُفع فعلاً بالجنيه، بتاريخ الدفع" className="lg:col-span-2">
          {months.length ? <ColumnChart items={months} label="الإيرادات حسب الشهر بالجنيه" /> : <p className="m-0 text-label text-ink-3">لا مدفوعات في هذه الفترة.</p>}
        </Panel>
        <Panel title="حسب الاشتراك" sub="ما دُفع لكل نوع">
          <BarList empty="لا مدفوعات في هذه الفترة." rows={m.by_option.map((o) => ({
            key: o.option, name: optionName(o.option), note: countText(o.count, ['اشتراك', 'اشتراكان', 'اشتراكات', 'اشتراكاً']),
            value: Number(o.amount), display: <Money value={Number(o.amount)} />,
          }))} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3 lg:gap-6">
        <Panel title="مراجعة الإيصالات" sub="ما راجعته في الفترة">
          <dl className="m-0 grid grid-cols-3 gap-3">
            {[
              ['قُبل', num(r.approved)], ['رُفض', num(r.rejected)],
              ['المدة المعتادة', r.median_review_hours == null ? '—' : hoursText(r.median_review_hours)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5"><dt className="text-cap text-ink-3">{k}</dt><dd className="m-0 text-card tabular">{v}</dd></div>
            ))}
          </dl>
          {r.pending ? <p className="m-0 text-label text-ink-2">{countText(r.pending, NOUN.receipt)} ينتظر مراجعتك الآن. <Link to={`${base}/receipts`} className="font-semibold text-teal hover:underline">افتح الإيصالات</Link></p> : null}
        </Panel>
        <Panel title="لماذا تُرفض الإيصالات" sub={r.rejected ? `أكثر الأسباب من ${countText(r.rejected, NOUN.receipt)} مرفوضة` : 'لم يُرفض إيصال في الفترة'}>
          <BarList empty="لا رفض في هذه الفترة." rows={r.reasons.map((x) => ({ key: x.reason, name: x.reason, value: x.count, note: reviewed ? share(x.count, r.rejected) : undefined }))} />
        </Panel>
        <Panel title="الرفض حسب وسيلة الدفع" sub="نسبة المرفوض من إيصالات كل وسيلة">
          <BarList empty="لا إيصالات في هذه الفترة." max={100} rows={r.by_method.map((x, i) => {
            const total = x.approved + x.rejected;
            const p = total ? Math.round((x.rejected / total) * 100) : 0;
            return { key: x.method_id ?? `m${i}`, name: x.name ?? 'وسيلة محذوفة', note: `${num(x.rejected)} من ${num(total)}`, value: p, display: percentText(p), strong: total >= 8 && p >= 25 };
          })} />
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
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:gap-6">{[0, 1, 2].map((i) => <Card key={i} className="flex flex-col gap-4 p-5"><SkeletonBar w={120} h={14} />{[0, 1, 2, 3].map((j) => <SkeletonBar key={j} w={260 - j * 30} h={10} />)}</Card>)}</div>
    <SkeletonTable rows={6} cols={8} />
  </>
);

// ─────────────────────────────────────────────────────────────── export ────

/** Gives each sheet its own row type, then lists them together. */
const sheet = <T,>(spec: SheetSpec<T>) => spec as SheetSpec;

async function exportAll(a: CompanyAnalytics, period: PeriodKey, companyName: string) {
  const base = '';
  const s = a.students; const m = a.money; const r = a.receipts;
  const fill = fillRate(a.trips);
  const sheets: SheetSpec[] = [
    sheet({ sheet: 'التوصيات', rows: a.insights.map((i) => insightText(i, base)), columns: [
      { label: 'الأولوية', value: (t) => SEVERITY_WORD[t.tone as InsightTone], width: 14 },
      { label: 'التوصية', value: (t) => t.title, width: 60 },
      { label: 'التفاصيل', value: (t) => t.sub, width: 80 },
    ] }),
    sheet({ sheet: 'الأرقام', rows: [
      ['الفترة', periodLabel(period)], ['من', a.period.from ?? 'البداية'], ['إلى', a.period.to], ['أيام التشغيل', a.period.ride_days],
      ['الطلاب', s.members], ['المشتركون الآن', s.subscribers], ['انضموا في الفترة', s.new_members], ['لم يشتركوا أبداً', s.never_subscribed],
      ['ينتهي اشتراكهم خلال 14 يوماً', s.ending_soon], ['نسبة التأكيد %', pct(a.rides?.confirm_rate ?? null)], ['امتلاء الباصات %', pct(fill)],
      ['الإيرادات (ج.م)', m.revenue], ['دفعوا', m.paying], ['متوسط ما يدفعه الطالب (ج.م)', m.avg_per_student],
      ['لم يدفعوا', m.unpaid_count], ['المستحق (ج.م)', m.unpaid_amount],
      ['إيصالات قُبلت', r.approved], ['إيصالات رُفضت', r.rejected], ['المدة المعتادة للمراجعة (ساعة)', r.median_review_hours],
    ] as [string, string | number | null][], columns: [
      { label: 'البند', value: (x) => x[0], width: 34 }, { label: 'القيمة', value: (x) => x[1], width: 18 },
    ] }),
    sheet({ sheet: 'الجامعات', rows: s.by_university, columns: [
      { label: 'الجامعة', value: (u) => u.name ?? 'غير محددة', width: 34 }, { label: 'الطلاب', value: (u) => u.count }, { label: 'المشتركون الآن', value: (u) => u.subscribers ?? null },
    ] }),
    sheet({ sheet: 'الكليات', rows: s.by_college, columns: [{ label: 'الكلية', value: (c) => c.name ?? 'لم يحددها الطالب', width: 34 }, { label: 'الطلاب', value: (c) => c.count }] }),
    sheet({ sheet: 'التخصصات', rows: s.by_specialisation, columns: [{ label: 'التخصص', value: (c) => c.name ?? 'لم يحدده الطالب', width: 34 }, { label: 'الطلاب', value: (c) => c.count }] }),
    sheet({ sheet: 'المحطات', rows: stationsOf(s.by_station, ''), columns: [
      { label: 'الخط', value: (x) => x.line_name, width: 22 }, { label: 'المحطة', value: (x) => x.station_name, width: 26 }, { label: 'المشتركون', value: (x) => x.count },
    ] }),
    sheet({ sheet: 'الخطوط والجامعات', rows: s.line_university, columns: [
      { label: 'الخط', value: (x) => x.line_name, width: 22 }, { label: 'الجامعة', value: (x) => x.university_name ?? 'غير محددة', width: 34 }, { label: 'المشتركون', value: (x) => x.count },
    ] }),
    sheet({ sheet: 'الرحلات', rows: a.trips, columns: [
      { label: 'الخط', value: (t) => t.line_name, width: 22 }, { label: 'الرحلة', value: (t) => t.label, width: 16 },
      { label: 'الاتجاه', value: (t) => DIRECTION_LABEL[t.direction] }, { label: 'الموعد', value: (t) => (t.start_time ? clock(t.start_time) : null) },
      { label: 'المشتركون', value: (t) => t.subscribers }, { label: 'المقاعد', value: (t) => t.capacity },
      { label: 'متوسط الركاب', value: (t) => t.avg_riders, format: '0.0' }, { label: 'الذروة', value: (t) => t.peak_riders },
      { label: 'أيام الزحام', value: (t) => t.days_over }, { label: 'متوسط من صعدوا', value: (t) => t.avg_boarded, format: '0.0' },
      { label: 'لم يصعدوا %', value: (t) => pct(t.no_show ?? null) }, { label: 'أيام التشغيل', value: (t) => t.ride_days },
    ] }),
    sheet({ sheet: 'مواعيد الذهاب', rows: a.time_slots, columns: [{ label: 'الموعد', value: (x) => clock(x.slot) }, { label: 'متوسط الركاب في اليوم', value: (x) => x.riders, format: '0.0', width: 22 }] }),
    sheet({ sheet: 'أيام الأسبوع', rows: WEEK_ORDER.map((d) => a.weekdays.find((w) => w.dow === d)).filter(Boolean) as CompanyAnalytics['weekdays'], columns: [
      { label: 'اليوم', value: (w) => WEEKDAY_LABEL[w.dow] }, { label: 'أيام التشغيل', value: (w) => w.days ?? null }, { label: 'نسبة التأكيد %', value: (w) => pct(w.confirm_rate) },
    ] }),
    sheet({ sheet: 'يوماً بيوم', rows: a.daily, columns: [
      { label: 'اليوم', value: (x) => x.date, width: 14 }, { label: 'أكدوا', value: (x) => x.confirmed }, { label: 'صعدوا', value: (x) => x.boarded }, { label: 'المشتركون', value: (x) => x.subscribers },
    ] }),
    sheet({ sheet: 'الإيرادات حسب الشهر', rows: m.by_month, columns: [
      { label: 'الشهر', value: (x) => monthLabel(x.month, true), width: 16 }, { label: 'المبلغ (ج.م)', value: (x) => Number(x.amount), format: MONEY_FORMAT, width: 14 }, { label: 'الاشتراكات', value: (x) => x.count },
    ] }),
    sheet({ sheet: 'حسب الاشتراك', rows: m.by_option, columns: [
      { label: 'الاشتراك', value: (x) => optionName(x.option), width: 18 }, { label: 'المبلغ (ج.م)', value: (x) => Number(x.amount), format: MONEY_FORMAT, width: 14 }, { label: 'الاشتراكات', value: (x) => x.count },
    ] }),
    sheet({ sheet: 'أسباب الرفض', rows: r.reasons, columns: [{ label: 'السبب', value: (x) => x.reason, width: 40 }, { label: 'العدد', value: (x) => x.count }] }),
    sheet({ sheet: 'وسائل الدفع', rows: r.by_method, columns: [
      { label: 'الوسيلة', value: (x) => x.name ?? 'وسيلة محذوفة', width: 24 }, { label: 'قُبل', value: (x) => x.approved }, { label: 'رُفض', value: (x) => x.rejected },
    ] }),
  ];
  await exportSheets(`التحليلات - ${companyName} - ${periodLabel(period)}`, sheets);
}
