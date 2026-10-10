import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Button, Chips, DataTable, EmptyState, ErrorState, Icon, Page, PageHeader, Pager, PhoneBar, Pill, SearchBox,
  SkeletonTable, SortSelect, StatePill, Toolbar, dayText, type Column,
} from '../ui';
import { useCompany } from '../lib/adminScope';
import { useLines, useSupervisorLines, useSupervisors, useUniversities, type LineRow } from '../lib/reference';
import { statsFor, useLinesStats, useSaleContext, type LineStats } from '../lib/linesData';
import { countOf, lineVisibility, W, type Visibility } from '../lib/lines';
import { LineMenu, useLineActions } from '../components/lines/LineActions';

type Filter = 'all' | 'on' | 'hidden' | 'off' | 'nosup';
type Sort = 'subs' | 'riders' | 'name';
const PAGE = 25;

interface Row {
  line: LineRow; stats: LineStats; vis: Visibility; unis: string[]; stations: number; going: number; back: number;
  sups: { name: string; active: boolean }[]; overflow: number;
}

const n = (v: number) => v.toLocaleString('en-US');

/** The «للطلاب» cell: the pill, and under it what is missing or why it stopped. */
export const VisibilityCell: React.FC<{ vis: Visibility }> = ({ vis }) => (
  <div className="flex min-w-0 flex-col items-start gap-0.5">
    {vis.state === 'on' ? <Pill tone="success">يظهر للطلاب</Pill> : vis.state === 'off' ? <StatePill state="off" /> : <Pill tone="warning">لا يظهر للطلاب</Pill>}
    {vis.state === 'hidden' && <span className="text-cap text-ink-2">{vis.reason}</span>}
    {vis.state === 'off' && <span className="text-cap text-ink-2">أوقفته أنت. مشتركوه الحاليون مستمرون</span>}
  </div>
);

const Riders: React.FC<{ s: LineStats }> = ({ s }) => {
  if (s.riders_departure == null) return <span className="text-ink-3">—</span>;
  if (!s.riders_departure && !s.riders_return) return <span className="text-ink-3">لا أحد</span>;
  return <span className="whitespace-nowrap text-ink-2"><b className="font-semibold text-ink tabular">{n(s.riders_departure)}</b> ذهاب · <b className="font-semibold text-ink tabular">{n(s.riders_return ?? 0)}</b> عودة</span>;
};

const Seats: React.FC<{ r: Row }> = ({ r }) => (r.stats.bus_capacity
  ? <span className="inline-flex items-center gap-2"><span className="tabular">{r.stats.bus_capacity}</span>{r.overflow > 0 && <Badge tone="warning">يزيد {r.overflow}</Badge>}</span>
  : <span className="text-ink-3">لم يُحدد</span>);

/** «ومشرف آخر», «ومشرفان آخران», «و3 مشرفين آخرين». */
const others = (k: number) => (k === 1 ? 'ومشرف آخر' : k === 2 ? 'ومشرفان آخران' : k <= 10 ? `و${k} مشرفين آخرين` : `و${k} مشرفاً آخر`);
const Supervisors: React.FC<{ r: Row }> = ({ r }) => (r.sups.length === 0
  ? <Badge tone="danger">بلا مشرف</Badge>
  : <div className="min-w-0"><div className="truncate font-medium">{r.sups[0].name}</div>{r.sups.length > 1 && <div className="truncate text-cap text-ink-3">{others(r.sups.length - 1)}</div>}</div>);

const StationsTrips: React.FC<{ r: Row }> = ({ r }) => (
  <div className="min-w-0">
    <div>{countOf(r.stations, W.station)}</div>
    <div className="text-cap text-ink-3">{r.going ? `${r.going} ذهاب` : <span className="text-bad">بلا ذهاب</span>} · {r.back} عودة</div>
  </div>
);

export const LinesPage: React.FC = () => {
  const company = useCompany();
  const navigate = useNavigate();
  const lines = useLines(company.id);
  const stats = useLinesStats(company.id);
  const universities = useUniversities().data;
  const supervisors = useSupervisors(company.id).data;
  const assignments = useSupervisorLines(company.id).data;
  const sale = useSaleContext(company.id);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('subs');
  const [page, setPage] = useState(1);

  const uniName = useMemo(() => {
    const m = new Map((universities ?? []).map((u) => [u.id, u.name]));
    return (id: string) => m.get(id) ?? 'جامعة';
  }, [universities]);
  const base = `/c/${company.id}/lines`;
  const actions = useLineActions(company.id, (id) => statsFor(stats.data, id), uniName);

  const rows: Row[] = useMemo(() => (lines.data ?? []).map((line) => {
    const s = statsFor(stats.data, line.id);
    const going = line.line_trips.filter((t) => t.direction === 'departure' && t.is_active);
    const supIds = (assignments ?? []).filter((a) => a.line_id === line.id).map((a) => a.supervisor_id);
    const sups = supIds.map((id) => (supervisors ?? []).find((x) => x.id === id)).filter(Boolean)
      .map((x) => ({ name: x!.full_name, active: x!.is_active })).sort((a, b) => Number(b.active) - Number(a.active));
    const overflow = s.bus_capacity ? Math.max(0, ...going.map((t) => (s.trip_riders[t.id] ?? 0) - s.bus_capacity!)) : 0;
    return {
      line, stats: s, vis: lineVisibility(line, { daily: sale.daily, uniName }),
      unis: line.line_universities.map((u) => uniName(u.university_id)),
      stations: line.stations.filter((x) => x.is_active).length, going: going.length,
      back: line.line_trips.filter((t) => t.direction === 'return' && t.is_active).length, sups, overflow,
    };
  }), [lines.data, stats.data, assignments, supervisors, sale.daily, uniName]);

  const counts = useMemo(() => ({
    all: rows.length, on: rows.filter((r) => r.vis.state === 'on').length, hidden: rows.filter((r) => r.vis.state === 'hidden').length,
    off: rows.filter((r) => r.vis.state === 'off').length, nosup: rows.filter((r) => r.sups.length === 0).length,
  }), [rows]);

  const term = search.trim();
  const shown = useMemo(() => rows
    .filter((r) => filter === 'all' || (filter === 'nosup' ? r.sups.length === 0 : r.vis.state === filter))
    .filter((r) => !term || r.line.name.includes(term) || r.line.stations.some((s) => s.is_active && s.name.includes(term)))
    .sort((a, b) => (sort === 'name' ? a.line.name.localeCompare(b.line.name, 'ar')
      : sort === 'riders' ? (b.stats.riders_departure ?? -1) - (a.stats.riders_departure ?? -1)
        : (b.stats.subscribers ?? -1) - (a.stats.subscribers ?? -1) || a.line.name.localeCompare(b.line.name, 'ar'))),
  [rows, filter, term, sort]);
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);

  const menu = (r: Row) => (
    <LineMenu items={[
      { label: 'افتح الخط', icon: 'eye', onClick: () => navigate(`${base}/${r.line.id}`) },
      { label: 'تعديل الخط', icon: 'pencil', onClick: () => navigate(`${base}/${r.line.id}?edit=1`), disabled: !actions.online },
      { label: 'عيّن مشرفاً', sub: 'من صفحة المشرفون', icon: 'scan', onClick: () => navigate(`/c/${company.id}/supervisors`) },
      r.line.is_active
        ? { label: 'إيقاف الخط', icon: 'power', sep: true, onClick: () => actions.ask('stop', r.line), disabled: !actions.online }
        : { label: 'تشغيل الخط', icon: 'power', sep: true, onClick: () => actions.ask('start', r.line), disabled: !actions.online },
      { label: 'حذف الخط', icon: 'trash', danger: true, onClick: () => actions.ask('delete', r.line), disabled: !actions.online },
    ]} />
  );

  const columns: Column<Row>[] = [
    { key: 'name', label: 'الخط', w: 216, render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.line.name}</div><div className="truncate text-cap text-ink-3">{r.unis.join(' · ') || 'بلا جامعة'}</div></div> },
    { key: 'st', label: 'المحطات والرحلات', w: 136, render: (r) => <StationsTrips r={r} /> },
    { key: 'subs', label: <span className="inline-flex items-center gap-1">المشتركون{sort === 'subs' && <Icon name="adown" size={14} stroke={2} />}</span>, w: 104, render: (r) => <span className="tabular">{r.stats.subscribers == null ? '—' : n(r.stats.subscribers)}</span> },
    { key: 'riders', label: 'ركاب الغد', w: 164, render: (r) => <Riders s={r.stats} /> },
    { key: 'seats', label: 'مقاعد الباص', w: 104, hideTablet: true, render: (r) => <Seats r={r} /> },
    { key: 'sup', label: 'المشرف', w: 176, hideTablet: true, render: (r) => <Supervisors r={r} /> },
    { key: 'vis', label: 'للطلاب', render: (r) => <VisibilityCell vis={r.vis} /> },
    { key: 'menu', label: <span className="sr-only">إجراءات</span>, w: 56, align: 'end', render: menu },
  ];

  const header = (
    <PageHeader title="الخطوط" sub={<span className="hidden sm:inline">كل خط له محطات صعود بالترتيب، ورحلات ذهاب إلى الجامعة، ومواعيد عودة منها.</span>}
      actions={<Button icon="plus" to={`${base}/new`} disabled={!actions.online} className="hidden sm:inline-flex">خط جديد</Button>} />
  );
  const phoneBar = <PhoneBar><Button full icon="plus" to={`${base}/new`} disabled={!actions.online}>خط جديد</Button></PhoneBar>;

  if (lines.loading) return <Page>{header}<SkeletonTable rows={6} cols={7} /></Page>;
  if (lines.error && !lines.data) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل الخطوط" text="لم نستطع جلب خطوطك. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void lines.reload()} /></Page>;
  }
  if (rows.length === 0) {
    return (
      <Page>
        {header}
        <EmptyState card icon="route" title="لا خطوط بعد"
          text="الخط هو مسار الباص: محطات يركب منها الطلاب، ورحلات ذهاب بمواعيدها، ومواعيد العودة من الجامعة، وسعر الاشتراك. بدون خط لا يجد الطلاب ما يشتركون فيه."
          action={<Button icon="plus" to={`${base}/new`} disabled={!actions.online}>أضف أول خط</Button>} />
        {actions.dialogs}
      </Page>
    );
  }

  const one = rows.length === 1;
  const toolbar = (
    <Toolbar
      search={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="ابحث باسم الخط أو المحطة" />}
      filters={<Chips value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={one ? [{ value: 'all', label: 'الكل', count: 1 }] : [
        { value: 'all', label: 'الكل', count: counts.all }, { value: 'on', label: 'يظهر للطلاب', count: counts.on },
        { value: 'hidden', label: 'لا يظهر للطلاب', count: counts.hidden }, { value: 'off', label: 'متوقف', count: counts.off },
        { value: 'nosup', label: 'بلا مشرف', count: counts.nosup },
      ]} />}
      count={<span className="sm:hidden">{countOf(shown.length, W.line, 'خط واحد')}</span>}
      sort={one ? undefined : <SortSelect value={sort} onChange={setSort} options={[
        { value: 'subs', label: 'الأكثر مشتركين أولاً' }, { value: 'riders', label: 'الأكثر ركاباً غداً' }, { value: 'name', label: 'بالاسم' },
      ]} />}
    />
  );

  return (
    <Page>
      {header}
      <DataTable<Row>
        caption="خطوط الشركة" columns={one ? columns.filter((c) => c.key !== 'seats') : columns} rows={pageRows} rowKey={(r) => r.line.id}
        onOpen={(r) => navigate(`${base}/${r.line.id}`)} toolbar={toolbar}
        empty={shown.length === 0 ? (
          <EmptyState icon="search" title={term ? `لا خط ولا محطة باسم «${term}»` : 'لا خطوط في هذا التصنيف'}
            text={term ? 'جرّب اسماً أقصر، أو امسح البحث لترى كل الخطوط.' : 'اختر «الكل» لترى كل الخطوط.'}
            action={term ? <Button kind="secondary" onClick={() => setSearch('')}>امسح البحث</Button> : <Button kind="secondary" onClick={() => setFilter('all')}>اعرض الكل</Button>} />
        ) : undefined}
        pager={<Pager page={page} total={shown.length} onPage={setPage} />}
        card={(r) => ({
          title: r.line.name, sub: r.unis.join(' · '), end: <Icon name="fwd" size={18} className="mt-1 text-ink-3" />,
          stats: [['المشتركون', r.stats.subscribers == null ? '—' : n(r.stats.subscribers)],
            ['ذهاب الغد', <span key="g" className={r.stats.riders_departure ? '' : 'text-disabled'}>{r.stats.riders_departure == null ? '—' : n(r.stats.riders_departure)}</span>],
            ['عودة الغد', <span key="b" className={r.stats.riders_return ? '' : 'text-disabled'}>{r.stats.riders_return == null ? '—' : n(r.stats.riders_return)}</span>]],
          fields: [
            ['المحطات والرحلات', <span key="s" className="font-medium">{countOf(r.stations, W.station)} · {r.going ? `${r.going} ذهاب` : <span className="text-bad">بلا ذهاب</span>} · {r.back} عودة</span>],
            ['مقاعد الباص', <Seats key="c" r={r} />],
            ['المشرف', r.sups.length ? <span key="p" className="font-medium">{r.sups[0].name}{r.sups.length > 1 ? ` +${r.sups.length - 1}` : ''}</span> : <Badge key="p" tone="danger">بلا مشرف</Badge>],
            ['للطلاب', <div key="v" className="flex justify-end"><VisibilityCell vis={r.vis} /></div>],
          ],
        })}
      />
      {stats.data?.ride_date && shown.length > 0 && (
        <p className="m-0 text-label text-ink-2">«ركاب الغد» هم من أكّدوا الركوب ليوم {dayText(stats.data.ride_date, { weekday: true, year: false })}. الخط الذي «لا يظهر للطلاب» مكتوب تحته ما ينقصه.</p>
      )}
      {phoneBar}
      {actions.dialogs}
    </Page>
  );
};
