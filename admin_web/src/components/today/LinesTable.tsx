import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Cell2, DataTable, EmptyState, Icon, Pager, SectionHead, SortSelect, Toolbar, countText, num, NOUN, type Column } from '../../ui';
import { SUBSCRIBER, nOf, overBy, ridersTitle, tripText, type CompanyToday, type TodayLine } from '../../lib/today';

/**
 * «ركاب الغد في كل خط» on the company's first page (docs/canvas/AdmToday, AdmTodayPhone).
 * Below the fold, so it is fetched alongside the page's data rather than before
 * the page can show what waits (scripts/check-bundle.mjs).
 */
/* ── ركاب الغد في كل خط ─────────────────────────────────────────────── */
type Sort = 'going' | 'subscribers' | 'name';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'going', label: 'الأكثر ركاباً أولاً' }, { value: 'subscribers', label: 'الأكثر اشتراكاً أولاً' }, { value: 'name', label: 'بالاسم' },
];
const PAGE = 25;

const Muted: React.FC<{ n: number }> = ({ n }) => <span className={n === 0 ? 'text-ink-3' : ''}>{num(n)}</span>;
const lineSub = (l: TodayLine) => (l.hidden === 'line_inactive' ? 'موقوف' : l.visible === false ? 'لا يظهر للطلاب بعد' : '');
const Seats: React.FC<{ line: TodayLine }> = ({ line }) => {
  const by = overBy(line);
  return (
    <span className="inline-flex items-center gap-2 tabular">
      {line.bus_capacity ? num(line.bus_capacity) : <span className="text-ink-3">—</span>}
      {by > 0 && <Badge tone="warning">يزيد {num(by)}</Badge>}
    </span>
  );
};
const Supervisor: React.FC<{ line: TodayLine }> = ({ line }) => (line.supervisors.length === 0
  ? <Badge tone="danger">بلا مشرف</Badge>
  : (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className="truncate">{line.supervisors[0].name}</span>
      {line.supervisors.length > 1 && <Badge>+{line.supervisors.length - 1}</Badge>}
    </span>
  ));
const TopTrip: React.FC<{ line: TodayLine }> = ({ line }) => (line.top_trip
  ? <span className="whitespace-nowrap tabular">{tripText(line.top_trip)}</span>
  : <span className="text-ink-3">لم يؤكد أحد بعد</span>);

export const LinesTable: React.FC<{ data: CompanyToday; base: string }> = ({ data, base }) => {
  const navigate = useNavigate();
  const [sort, setSort] = useState<Sort>('going');
  const [page, setPage] = useState(1);
  const rows = useMemo(() => [...data.lines].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'ar')
    : sort === 'subscribers' ? b.subscribers - a.subscribers || b.going - a.going : b.going - a.going || b.subscribers - a.subscribers)), [data.lines, sort]);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const sorted = (label: string, on: boolean) => (on ? <span className="inline-flex items-center gap-1">{label}<Icon name="adown" size={13} stroke={2} /></span> : label);
  const columns: Column<TodayLine>[] = [
    { key: 'name', label: 'الخط', render: (l) => <Cell2 main={l.name} sub={lineSub(l) || undefined} /> },
    { key: 'subs', label: sorted('المشتركون', sort === 'subscribers'), w: 112, hideTablet: true, render: (l) => <span className="tabular">{num(l.subscribers)}</span> },
    { key: 'going', label: sorted('ذهاب', sort === 'going'), w: 88, render: (l) => <span className="text-body font-semibold tabular"><Muted n={l.going} /></span> },
    { key: 'ret', label: 'عودة', w: 88, render: (l) => <span className="text-body font-semibold tabular"><Muted n={l.returning} /></span> },
    { key: 'top', label: 'أكبر رحلة ذهاب', w: 200, hideTablet: true, render: (l) => <TopTrip line={l} /> },
    { key: 'seats', label: 'مقاعد الباص', w: 150, render: (l) => <Seats line={l} /> },
    { key: 'sup', label: 'المشرف', w: 230, render: (l) => <Supervisor line={l} /> },
  ];
  const count = `${countText(data.lines.length, NOUN.line)} · اضغط خطاً لترى كل رحلة وركابها`;
  return (
    <section className="flex flex-col gap-3">
      <SectionHead
        title={<><span className="hidden sm:inline">{ridersTitle(data.today, data.ride_date)} في كل خط</span><span className="sm:hidden">في كل خط</span></>}
        meta={<span className="text-label text-ink-2 sm:hidden">{countText(data.lines.length, NOUN.line)}</span>}
        end={<span className="hidden sm:inline-flex"><Button kind="link" sm iconEnd="fwd" to={`${base}/lines`}>كل الخطوط</Button></span>} />
      {data.lines.length === 0 ? (
        <EmptyState card icon="route" title="لا خطوط بعد" text="أضف خطاً بمحطاته ومواعيده ليشترك فيه الطلاب ويظهر هنا عدد ركابه كل يوم."
          action={<Button icon="plus" to={`${base}/lines/new`}>أضف خطاً</Button>} />
      ) : (
        <>
          <DataTable<TodayLine>
            caption="ركاب الغد في كل خط" columns={columns} rows={shown} rowKey={(l) => l.id}
            onOpen={(l) => navigate(`${base}/lines/${l.id}`)}
            toolbar={<div className="hidden sm:block"><Toolbar count={count} sort={<SortSelect value={sort} onChange={(v) => { setSort(v); setPage(1); }} options={SORTS} />} /></div>}
            pager={<Pager page={page} total={rows.length} onPage={setPage} />}
            foot={{ name: 'الإجمالي', subs: num(data.subscribers), going: num(data.going), ret: num(data.returning) }}
            card={(l) => ({
              title: l.name,
              sub: [nOf(l.subscribers, SUBSCRIBER), lineSub(l)].filter(Boolean).join(' · '),
              end: <Icon name="fwd" size={18} className="mt-1 text-ink-3" />,
              stats: [['ذهاب', <Muted key="g" n={l.going} />], ['عودة', <Muted key="r" n={l.returning} />]],
              fields: [['أكبر رحلة ذهاب', <TopTrip key="t" line={l} />], ['مقاعد الباص', <Seats key="s" line={l} />], ['المشرف', <Supervisor key="v" line={l} />]],
            })} />
          <div className="flex items-center gap-4 rounded-inner bg-surface px-4 py-3.5 shadow-card sm:hidden">
            <span className="flex-1 text-body font-semibold">الإجمالي</span>
            <span className="text-label text-ink-2">ذهاب <span className="text-small font-semibold text-ink tabular">{num(data.going)}</span></span>
            <span className="text-label text-ink-2">عودة <span className="text-small font-semibold text-ink tabular">{num(data.returning)}</span></span>
          </div>
        </>
      )}
    </section>
  );
};
