import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { STATUS, Ltr, Money } from '../../ui/Status';
import { Chips, Cell2, DataTable, Pager, SearchBox, SortSelect, Toolbar, type Column } from '../../ui/Table';
import { Menu } from '../../ui/Menu';
import { ExportButton } from '../../ui/Transfer';
import { clock, countText, errorText, NOUN, num, phoneText } from '../../ui/format';
import { keys, usePageData, VARIANT_GC } from '../../lib/query';
import { useSignedUrls } from '../../lib/signedUrls';
import { notifyDone, notifyError } from '../../lib/toasts';
import { bulkTargets, type BulkAction } from '../../lib/studentsBulk';
import {
  fetchAllStudents, fetchStudentsList, mainSubscription, openSubscriptions, periodName, SHOWN_ORDER, studentShown, studyLine,
  type Shown, type StatusCounts, type StudentRow, type StudentSort, type StudentsListAnswer,
} from '../../lib/students';
import { Avatar, FilterSelect, LinkSelect, ShownPill, shortDay } from './parts';
import { BULK, BULK_ORDER, BulkDialog } from './StudentsBulk';
import { exportStudents } from './StudentsTransfer';

export const PAGE_SIZE = 25;
const SHOWN_LABEL: Record<Shown, string> = { ...Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[0]])), none: 'بلا اشتراك' } as Record<Shown, string>;
const SORTS: { value: StudentSort; label: string }[] = [
  { value: 'newest', label: 'الأحدث تسجيلاً' }, { value: 'oldest', label: 'الأقدم تسجيلاً' }, { value: 'name', label: 'الاسم (أ–ي)' },
];

/** «442 طالباً», «طالب واحد», «0 طلاب». */
export const studentsCount = (n: number) => (n === 1 ? 'طالب واحد' : n === 0 ? '0 طلاب' : countText(n, NOUN.student));

/** What the list is filtered by; kept by the page so the panel and the tabs can read it. */
export interface ListFilter { status: Shown | ''; lineId: string; universityId: string; sort: StudentSort; page: number }
export const NO_FILTER: ListFilter = { status: '', lineId: '', universityId: '', sort: 'newest', page: 1 };

/** The rows' skeleton under a real toolbar (AdmStudentsStates · Loading). */
const RowsSkeleton: React.FC = () => (
  <div aria-busy="true" aria-label="جارٍ تحميل الطلاب">
    <div className="h-11 bg-ground" />
    {Array.from({ length: 8 }, (_, i) => (
      <div key={i} className="flex h-14 items-center gap-6 border-t border-hair px-4">
        <span className="skeleton h-9 w-9 flex-none rounded-full" />
        {[34, 18, 14, 16, 10].map((w, c) => <span key={c} className="skeleton block h-3 rounded-md" style={{ width: `${w - ((i + c) % 3) * 2}%` }} />)}
      </div>
    ))}
  </div>
);

/** The company's students (docs/canvas/AdmStudents, AdmStudentsPhone, AdmStudentsStates). */
export const StudentsList: React.FC<{
  companyId: string; companyName: string; today: string; q: string; onSearch: (q: string) => void;
  filter: ListFilter; onFilter: (f: ListFilter) => void;
  lines: { id: string; name: string }[]; universities: { id: string; name: string }[];
  openId: string | null; onOpen: (row: StudentRow) => void; onAdd: () => void; online: boolean;
  /** «استيراد من Excel» (offered in the phone's ⋮; the page header has it on wider screens). */
  onImport: () => void;
  onAnswer?: (answer: StudentsListAnswer | undefined, filtered: boolean) => void;
}> = ({ companyId, companyName, today, q, onSearch, filter, onFilter, lines, universities, openId, onOpen, onAdd, online, onImport, onAnswer }) => {
  const [typed, setTyped] = useState(q);
  useEffect(() => { setTyped(q); }, [q]);
  useEffect(() => {
    const t = window.setTimeout(() => { if (typed.trim() !== q) onSearch(typed.trim()); }, 300);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  const set = (patch: Partial<ListFilter>) => onFilter({ ...filter, page: 1, ...patch });

  const variant = { search: q, status: filter.status, line: filter.lineId, uni: filter.universityId, sort: filter.sort === 'newest' ? '' : filter.sort, page: filter.page === 1 ? 0 : filter.page };
  const filtered = !!(q || filter.status || filter.lineId || filter.universityId);
  const list = usePageData(keys.company(companyId, 'students', 'list', variant), () => fetchStudentsList({
    companyId, search: q, status: filter.status, lineId: filter.lineId, universityId: filter.universityId, sort: filter.sort,
    limit: PAGE_SIZE, offset: (filter.page - 1) * PAGE_SIZE,
  }, today), { keepPrevious: true, gcTime: filtered || filter.page > 1 ? VARIANT_GC : undefined });
  const rows = list.data?.rows ?? [];
  const counts: StatusCounts | null = list.data?.counts ?? null;
  const total = list.data?.total ?? 0;
  useEffect(() => { onAnswer?.(list.data, filtered); }, [list.data, filtered, onAnswer]);
  const avatars = useSignedUrls('student-avatars', rows.map((r) => r.profile_image_url));
  const lineOptions = useMemo(() => lines.map((l) => ({ value: l.id, label: l.name })), [lines]);
  const uniOptions = useMemo(() => universities.map((u) => ({ value: u.id, label: u.name })), [universities]);

  // The selection: ids, kept across pages; the rows behind them as last seen (or read by «حدّد كل…»).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const known = useRef(new Map<string, StudentRow>());
  useEffect(() => { rows.forEach((r) => known.current.set(r.id, r)); }, [rows]);
  useEffect(() => { setSelected(new Set()); }, [companyId, q, filter.status, filter.lineId, filter.universityId]);
  const chosen = useMemo(() => [...selected].map((id) => known.current.get(id)).filter((r): r is StudentRow => !!r), [selected, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = { companyId, search: q, status: filter.status, lineId: filter.lineId, universityId: filter.universityId, sort: filter.sort };
  const allMatching = () => fetchAllStudents(query, today);
  const selectAll = async () => {
    try {
      const all = await allMatching();
      all.forEach((r) => known.current.set(r.id, r));
      setSelected(new Set(all.map((r) => r.id)));
    } catch (e) { notifyError('لم نحدد كل الطلاب', errorText(e)); }
  };
  const exportAll = async () => { await exportStudents(await allMatching(), today, companyName); };
  const exportFromMenu = async () => {
    try { const all = await allMatching(); await exportStudents(all, today, companyName); notifyDone(`صُدّر ${num(all.length)} صفاً إلى ملف Excel.`); }
    catch (e) { notifyError('لم يُصدَّر الملف', errorText(e)); }
  };
  const bulkBar = selected.size > 0 ? (
    <Toolbar bulk={{
      count: selected.size, total, onClear: () => setSelected(new Set()), onAll: () => void selectAll(),
      actions: <>
        <ExportButton sm label="تصدير المحدد" count={chosen.length} onExport={() => exportStudents(chosen, today, companyName, 'طلاب محددون من')} />
        {BULK_ORDER.map((a) => {
          const n = a === 'remove' ? chosen.length : bulkTargets(chosen, a, today).length;
          return <Button key={a} sm kind="secondary" icon={BULK[a].icon} disabled={!online || n === 0} onClick={() => setBulk(a)}
            title={n === 0 ? BULK[a].none : undefined}>{BULK[a].label}{a !== 'remove' && n > 0 ? ` (${num(n)})` : ''}</Button>;
        })}
      </>,
    }} />
  ) : null;

  const clear = () => { setTyped(''); onSearch(''); onFilter({ ...NO_FILTER, sort: filter.sort }); };
  const none = !list.loading && !list.error && !filtered && (counts ? counts.all === 0 : rows.length === 0) && filter.page === 1;
  const countLabel = list.loading || (list.error && !list.data) ? '' : filtered && total === 0 ? 'لا نتائج' : studentsCount(total);

  const chips = (
    <Chips<Shown | ''> value={filter.status} onChange={(status) => set({ status })}
      options={[{ value: '', label: 'الكل', count: counts ? num(counts.all) : undefined },
        ...SHOWN_ORDER.map((s) => ({ value: s, label: SHOWN_LABEL[s], count: counts ? num(counts[s]) : undefined }))]} />
  );
  const sort = (<>
    <span className="sm:hidden"><LinkSelect<StudentSort> label="الترتيب" value={filter.sort} onChange={(s) => set({ sort: s })} options={SORTS} /></span>
    <span className="hidden sm:inline-flex"><SortSelect<StudentSort> value={filter.sort} onChange={(s) => set({ sort: s })} options={SORTS} /></span>
  </>);
  const toolbar = (
    <div className={`flex flex-col gap-3 sm:gap-3 sm:border-b sm:border-hair sm:px-4 sm:py-3 ${none ? 'max-sm:hidden' : ''}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchBox value={typed} onChange={setTyped} placeholder="ابحث بالاسم أو الهاتف أو الجامعة" className="sm:w-[300px]" />
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="الخط" value={filter.lineId} allLabel="كل الخطوط" options={lineOptions} onChange={(lineId) => set({ lineId })} />
          <FilterSelect label="الجامعة" value={filter.universityId} allLabel="كل الجامعات" options={uniOptions} onChange={(universityId) => set({ universityId })} />
          <FilterSelect<Shown> label="الحالة" value={filter.status} allLabel="الكل" options={SHOWN_ORDER.map((s) => ({ value: s, label: SHOWN_LABEL[s] }))} onChange={(status) => set({ status })} className="sm:hidden" />
        </div>
        <span className="hidden flex-1 sm:block" />
        <div className="flex min-h-6 items-center gap-2 sm:contents">
          <span aria-live="polite" className="flex-1 whitespace-nowrap text-label text-ink-2 sm:flex-none">{countLabel}{list.refreshing && <span className="sr-only"> · جارٍ التحديث</span>}</span>
          {sort}
          <ExportButton count={total} onExport={exportAll} disabled={list.loading || total === 0} className="max-sm:!hidden" />
          <span className="sm:hidden"><Menu label="تصدير واستيراد" items={[
            { label: 'تصدير Excel', icon: 'download', onClick: () => void exportFromMenu(), hidden: total === 0 },
            { label: 'استيراد من Excel', icon: 'upload', onClick: onImport, hidden: !online },
          ]} /></span>
        </div>
      </div>
      <div className="hidden sm:block">{chips}</div>
    </div>
  );

  const columns: Column<StudentRow>[] = [
    { key: 'name', label: 'الطالب', render: (r) => (
      <div className="flex items-center gap-3"><Avatar name={r.full_name} id={r.id} url={r.profile_image_url ? avatars[r.profile_image_url] : undefined} />
        <Cell2 main={r.full_name} sub={<Ltr>{phoneText(r.phone)}</Ltr>} /></div>) },
    { key: 'uni', label: 'الجامعة والكلية', w: 200, hideTablet: true, render: (r) => <Cell2 strong={false} main={r.university || '—'} sub={studyLine(r.college, r.specialisation, '', ' · ')} /> },
    { key: 'line', label: 'الخط', w: 140, render: (r) => { const m = mainSubscription(r, today); return m ? <Cell2 strong={false} main={m.line_name ?? '—'} sub={m.departure_time ? `ذهاب ${clock(m.departure_time)}` : ''} /> : <span className="text-ink-3">—</span>; } },
    { key: 'sub', label: 'الاشتراك', w: 180, render: (r) => {
      const m = mainSubscription(r, today);
      const more = openSubscriptions(r, today).length > 1;
      return m ? <Cell2 strong={false} main={m.period_label ?? 'اشتراك'} sub={<><Money value={Number(m.price)} />{more && ' · واشتراك آخر'}</>} /> : <span className="text-ink-3">—</span>;
    } },
    { key: 'status', label: 'الحالة', w: 140, render: (r) => <ShownPill shown={studentShown(r, today)} /> },
    { key: 'date', w: 104, hideTablet: true, label: (
      <button type="button" onClick={(e) => { e.stopPropagation(); set({ sort: filter.sort === 'newest' ? 'oldest' : 'newest' }); }}
        aria-label={filter.sort === 'oldest' ? 'سُجّل: الأقدم أولاً. اضغط للأحدث أولاً' : 'سُجّل: الأحدث أولاً. اضغط للأقدم أولاً'}
        className={`inline-flex items-center gap-1 ${filter.sort !== 'name' ? 'font-semibold text-ink' : ''}`}>
        سُجّل{filter.sort !== 'name' && <Icon name={filter.sort === 'oldest' ? 'aup' : 'adown'} size={14} stroke={2} />}
      </button>), render: (r) => <span className="whitespace-nowrap text-label text-ink-2">{shortDay(r.joined_at ?? r.created_at)}</span> },
    { key: 'go', label: <span className="sr-only">فتح</span>, w: 44, align: 'end', render: () => <Icon name="fwd" size={18} className="text-ink-3" /> },
  ];

  let empty: React.ReactNode = null;
  if (list.loading) empty = <><div className="hidden sm:block"><RowsSkeleton /></div><div className="flex flex-col gap-3 sm:hidden">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[136px] rounded-inner" />)}</div></>;
  else if (list.error && !list.data) empty = <ErrorState title="تعذّر تحميل الطلاب" text="لم نستطع جلب قائمة الطلاب. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void list.reload()} card />;
  else if (none) empty = <EmptyState icon="users" title="لا طلاب في شركتك بعد" text="يظهر الطالب هنا عندما يشترك في أحد خطوطك من التطبيق، أو عندما تضيفه أنت بنفسك." card
    action={<div className="flex w-full flex-col gap-2"><Button icon="plus" disabled={!online} onClick={onAdd} full>إضافة طالب</Button>
      <Button kind="outline" icon="upload" disabled={!online} onClick={onImport} full>استيراد من Excel</Button></div>} />;
  else if (rows.length === 0) empty = <EmptyState icon="search" title="لا طالب بهذه المواصفات" text="جرّب اسماً أقصر أو رقم الهاتف، أو أزل التصفية بالخط والحالة." card
    action={<Button kind="outline" onClick={clear} full>إزالة البحث والتصفية</Button>} />;

  return (
    <div id="panel-students" role="tabpanel" aria-labelledby="tab-students">
      <DataTable<StudentRow> caption="طلاب الشركة" columns={columns} rows={rows} rowKey={(r) => r.id} onOpen={onOpen} openKey={openId}
        selectable={!none} selected={selected} onSelect={setSelected}
        toolbar={bulkBar ?? toolbar} empty={empty ? <div className="sm:[&>div]:!rounded-none sm:[&>div]:!shadow-none">{empty}</div> : undefined}
        pager={<Pager page={filter.page} total={total} onPage={(page) => { onFilter({ ...filter, page }); window.scrollTo({ top: 0 }); }} />}
        card={(r) => {
          const m = mainSubscription(r, today);
          const study = studyLine(r.college, r.specialisation, '', ' · ').split(' · ')[0];
          return {
            title: r.full_name, sub: <Ltr>{phoneText(r.phone)}</Ltr>, end: <ShownPill shown={studentShown(r, today)} />,
            fields: [
              ['الجامعة', [r.university, study].filter(Boolean).join(' · ') || '—'],
              ['الخط', m ? [m.line_name, m.departure_time && `ذهاب ${clock(m.departure_time)}`].filter(Boolean).join(' · ') : '—'],
              ['الاشتراك', m ? <span key="s">{periodName(m.period_label) || 'اشتراك'} · <Money value={Number(m.price)} /></span> : '—'],
            ],
          };
        }} />
      <BulkDialog action={bulk} students={chosen} company={{ id: companyId, name: companyName }} today={today} onClose={() => setBulk(null)}
        onDone={(ids) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; })} />
    </div>
  );
};
