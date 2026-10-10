import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, useOnline } from '../../ui/Feedback';
import { Page, PageHeader } from '../../ui/Layout';
import { Badge, Ltr } from '../../ui/Status';
import { Chips, DataTable, Pager, SearchBox, SortSelect, Toolbar, type Column } from '../../ui/Table';
import { ExportButton } from '../../ui/Transfer';
import { countText, errorText, num, phoneText } from '../../ui/format';
import { supabase } from '../../lib/supabase';
import { keys, unwrap, usePageData, VARIANT_GC } from '../../lib/query';
import { usePlatformCompanies } from '../../lib/reference';
import { blockedLookup, useBlockedPhones } from '../../lib/blockedPhones';
import { notifyError } from '../../lib/toasts';
import {
  loadAllPlatformStudents, loadPlatformCounts, loadPlatformStudents, type Membership, type PlatformStudent, type PlatformStudentDetails,
} from '../../lib/students';
import { BlockedPhonesPanel } from '../../components/BlockedPhonesPanel';
import { BlockedBadge } from '../../components/BlockStudentButton';
import { PlatformStudentPanel } from '../../components/students/PlatformStudentPanel';
import { FilterSelect, fullDay, LinkSelect } from '../../components/students/parts';
import { exportPlatformStudents } from '../../components/students/StudentsTransfer';

const PAGE_SIZE = 25;
const accountsCount = (n: number) => (n === 1 ? 'حساب واحد' : n === 2 ? 'حسابان' : countText(n, ['حساب', 'حسابان', 'حسابات', 'حساباً']));

/** The companies a student belongs to, as small tags; a removed one is grey, none is amber. */
const CompanyTags: React.FC<{ row: PlatformStudent }> = ({ row }) => (
  <div className="flex flex-wrap gap-1">
    {row.memberships.length === 0 && <Badge tone="warning">بلا شركة</Badge>}
    {row.memberships.map((m) => (m.status === 'active'
      ? <Badge key={m.company_id} tone="teal">{m.company}</Badge>
      : <Badge key={m.company_id}>{m.company} · أُزيل</Badge>))}
  </div>
);

/**
 * «كل الطلاب» (docs/canvas/AdmPlatStudents*, AdmPlatStudent*): every student account on the
 * platform and the companies it belongs to. Read and search only; subscriptions and
 * receipts are managed inside each company. ?q= and ?student=<id> come from the top bar.
 */
export const AllStudentsPage: React.FC = () => {
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const studentId = params.get('student');
  const set = (patch: Record<string, string | null>, replace = false) => setParams((p) => {
    const n = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    return n;
  }, { replace });

  const [typed, setTyped] = useState(q);
  useEffect(() => { setTyped(q); }, [q]);
  useEffect(() => {
    const t = window.setTimeout(() => { if (typed.trim() !== q) { set({ q: typed.trim() || null }, true); setPage(1); } }, 300);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);
  const [membership, setMembership] = useState<Membership>('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);

  const companies = usePlatformCompanies().data ?? [];
  const companyName = companies.find((c) => c.id === companyId)?.name;
  const variant = { search: q, companyId, membership, pageIndex: page - 1 };
  const filtered = !!(q || companyId || membership);
  const list = usePageData(keys.platform('students', variant), () => loadPlatformStudents({ search: q, companyId, membership, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    { keepPrevious: true, gcTime: filtered || page > 1 ? VARIANT_GC : undefined });
  const counts = usePageData(keys.platform('students', 'counts', { search: q, companyId }), () => loadPlatformCounts(q, companyId),
    { keepPrevious: true, gcTime: q || companyId ? VARIANT_GC : undefined });
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const blocked = useBlockedPhones(null);
  const blockOf = blockedLookup(blocked.data);

  // The open account: from the page, or read alone (a link from the top bar's search).
  const onPage = studentId ? rows.find((r) => r.id === studentId) : undefined;
  const alone = usePageData(keys.platform('students', 'one', { id: studentId ?? '' }),
    () => unwrap<PlatformStudentDetails>(supabase.rpc('platform_student_details', { p_student_id: studentId })), { enabled: !!studentId && !onPage && !list.loading });
  useEffect(() => { if (alone.error && studentId && !onPage) { notifyError('تعذّر فتح هذا الحساب', 'ربما حُذف. ابحث عنه بالاسم أو الرقم.'); set({ student: null }, true); } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [alone.error]);
  const open: PlatformStudent | undefined = onPage ?? (alone.data ? {
    id: alone.data.id, full_name: alone.data.full_name, phone: alone.data.phone, university: alone.data.university, created_at: alone.data.created_at,
    memberships: alone.data.memberships, active_subscriptions: alone.data.active_subscriptions,
  } : undefined);

  // The selection (ids kept across pages; the rows as last seen) and the exports.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const known = useRef(new Map<string, PlatformStudent>());
  useEffect(() => { rows.forEach((r) => known.current.set(r.id, r)); }, [rows]);
  useEffect(() => { setSelected(new Set()); }, [q, companyId, membership]);
  const allMatching = () => loadAllPlatformStudents({ search: q, companyId, membership });
  const exportName = companyName ? `طلاب ${companyName}` : 'كل الطلاب';
  const selectAll = async () => {
    try {
      const all = await allMatching();
      all.forEach((r) => known.current.set(r.id, r));
      setSelected(new Set(all.map((r) => r.id)));
    } catch (e) { notifyError('لم نحدد كل الحسابات', errorText(e)); }
  };
  const exportAll = async () => { await exportPlatformStudents(await allMatching(), exportName); };
  const chosen = [...selected].map((id) => known.current.get(id)).filter((r): r is PlatformStudent => !!r);
  const bulkBar = selected.size > 0 ? (
    <Toolbar bulk={{
      count: selected.size, total, onClear: () => setSelected(new Set()), onAll: () => void selectAll(),
      actions: <ExportButton label="تصدير المحدد" count={chosen.length} onExport={() => exportPlatformStudents(chosen, `${exportName} (محدد)`)} />,
    }} />
  ) : null;

  const chips = useMemo(() => [
    { value: '' as Membership, label: 'كل الحسابات', count: counts.data ? num(counts.data.all) : undefined },
    { value: 'none' as Membership, label: 'بلا شركة', count: counts.data ? num(counts.data.none) : undefined },
    { value: 'multiple' as Membership, label: 'في أكثر من شركة', count: counts.data ? num(counts.data.multiple) : undefined },
  ], [counts.data]);
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));
  const clearSearch = () => { setTyped(''); set({ q: null }, true); setPage(1); };

  const columns: Column<PlatformStudent>[] = [
    { key: 'name', label: 'الطالب', render: (r) => <span className="flex items-center gap-2 font-semibold"><span className="truncate">{r.full_name}</span>{blockOf(r) && <BlockedBadge entry={blockOf(r)!} />}</span> },
    { key: 'phone', label: 'رقم الهاتف', w: 140, render: (r) => <Ltr>{phoneText(r.phone)}</Ltr> },
    { key: 'uni', label: 'الجامعة', w: 170, hideTablet: true, render: (r) => <span className="line-clamp-2 whitespace-normal">{r.university || '—'}</span> },
    { key: 'companies', label: 'شركاته', w: 250, render: (r) => <CompanyTags row={r} /> },
    { key: 'subs', label: 'اشتراكات نشطة', w: 120, render: (r) => <span className={`tabular ${r.active_subscriptions ? '' : 'text-ink-3'}`}>{num(r.active_subscriptions)}</span> },
    { key: 'date', label: 'سُجّل في', w: 130, hideTablet: true, render: (r) => <span className="whitespace-nowrap">{fullDay(r.created_at)}</span> },
  ];

  const nothing = !filtered && !list.loading && !!list.data && total === 0;
  const toolbar = (
    <div className={`${nothing ? 'max-sm:hidden ' : ''}flex flex-col gap-3 sm:min-h-[60px] sm:flex-row sm:flex-wrap sm:items-center sm:border-b sm:border-hair sm:px-4 sm:py-2`}>
      <SearchBox value={typed} onChange={setTyped} placeholder="ابحث بالاسم أو الهاتف أو الجامعة" className="sm:w-[280px]" />
      <Chips<Membership> value={membership} onChange={(m) => { setMembership(m); setPage(1); }} options={chips} />
      <span className="hidden flex-1 sm:block" />
      <div className="flex min-h-6 items-center gap-2 sm:contents">
        <span aria-live="polite" className="flex-1 whitespace-nowrap text-label text-ink-2 sm:hidden">{list.data ? accountsCount(total) : ''}</span>
        <span className="hidden sm:inline-flex"><SortSelect value="newest" onChange={() => undefined} options={[{ value: 'newest', label: 'الأحدث تسجيلاً' }]} /></span>
        <span className="sm:hidden"><LinkSelect<string> label="الشركة" value={companyId} onChange={(v) => { setCompanyId(v); setPage(1); }} options={[{ value: '', label: 'كل الشركات' }, ...companyOptions]} /></span>
        <FilterSelect label="الشركة" hideLabel icon="building" value={companyId} allLabel="كل الشركات" options={companyOptions} className="max-sm:hidden"
          onChange={(v) => { setCompanyId(v); setPage(1); }} />
        <ExportButton count={total} disabled={list.loading} onExport={exportAll} label="تصدير" className="sm:hidden" />
      </div>
    </div>
  );

  let empty: React.ReactNode = null;
  if (list.loading) empty = <div aria-busy="true" className="flex flex-col">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex h-14 items-center gap-6 border-t border-hair px-4 first:border-t-0">{[30, 14, 16, 22, 8, 12].map((w, c) => <span key={c} className="skeleton block h-3 rounded-md" style={{ width: `${w}%` }} />)}</div>)}</div>;
  else if (list.error && !list.data) empty = <ErrorState title="تعذّر تحميل الطلاب" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void list.reload()} card />;
  else if (rows.length === 0 && !filtered) empty = <EmptyState icon="users" card title="لا طلاب بعد" text="يظهر الطالب هنا عندما ينشئ حسابه في التطبيق أو تضيفه شركة من صفحة طلابها." />;
  else if (rows.length === 0) {
    empty = q
      ? <EmptyState icon="search" card title={`لا حساب يطابق «${q}»${companyName ? ` في ${companyName}` : ''}`}
        text={companyName ? 'جرّب الاسم، أو ابحث في كل الشركات.' : 'جرّب الاسم، أو جزءاً من رقم الهاتف.'}
        action={companyName ? <Button kind="outline" full onClick={() => { setCompanyId(''); setPage(1); }}>ابحث في كل الشركات</Button> : <Button kind="outline" full onClick={clearSearch}>مسح البحث</Button>} />
      : <EmptyState icon="search" card title="لا حساب بهذه المواصفات" text="غيّر التصفية لترى حسابات أخرى."
        action={<Button kind="outline" full onClick={() => { setMembership(''); setCompanyId(''); setPage(1); }}>إزالة التصفية</Button>} />;
  }

  return (
    <Page>
      <PageHeader title="كل الطلاب" sub="كل حساب طالب على المنصة والشركات التي ينتمي إليها. للقراءة والبحث؛ الاشتراكات والإيصالات تُدار من داخل كل شركة."
        actions={<ExportButton sm={false} count={total} disabled={list.loading} onExport={exportAll} className="max-sm:!hidden" />} />
      <div className={list.refreshing ? 'transition-opacity [&_tbody]:opacity-60 [&_[role=button]]:opacity-60' : ''}>
        <DataTable<PlatformStudent> caption="كل الطلاب" columns={columns} rows={rows} rowKey={(r) => r.id} onOpen={(r) => set({ student: r.id })} openKey={studentId}
          selectable={!nothing} selected={selected} onSelect={setSelected}
          toolbar={bulkBar ?? toolbar} empty={empty ? <div className="sm:[&>div]:!rounded-none sm:[&>div]:!shadow-none">{empty}</div> : undefined}
          pager={<Pager page={page} total={total} onPage={(p) => { setPage(p); window.scrollTo({ top: 0 }); }} />}
          card={(r) => ({
            title: <span className="flex items-center gap-2">{r.full_name}{blockOf(r) && <BlockedBadge entry={blockOf(r)!} />}</span>, sub: <Ltr>{phoneText(r.phone)}</Ltr>,
            fields: [['الجامعة', r.university || '—'], ['شركاته', <span key="c" className="flex justify-end"><CompanyTags row={r} /></span>],
              ['اشتراكات نشطة', num(r.active_subscriptions)], ['سُجّل في', fullDay(r.created_at)]],
          })} />
      </div>
      <BlockedPhonesPanel list={blocked.data ?? []} />
      {open && <PlatformStudentPanel key={open.id} row={open} block={blockOf(open)} online={online} onClose={() => set({ student: null })} />}
    </Page>
  );
};
