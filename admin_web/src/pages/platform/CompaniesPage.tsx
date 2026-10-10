import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Cell2, Chips, DataTable, EmptyState, ErrorState, Icon, Page, PageHeader, Pager, PhoneBar, SearchBox, SkeletonTable,
  SortSelect, Toolbar, cairo, dayText, errorText, num, useOnline, type Column,
} from '../../ui';
import { supabase } from '../../lib/supabase';
import { keys, queryClient } from '../../lib/query';
import { useGuard } from '../../lib/guard';
import { rememberApplied } from '../../lib/recentChanges';
import { notifyDone, notifyError } from '../../lib/toasts';
import type { CompanyOption } from '../../lib/reference';
import type { CompanyScope } from '../../lib/adminScope';
import {
  companiesKey, companyCounts, companyDetailKey, listCompanies, usePlatformCompanyList,
  type CompanyFilter, type CompanySort, type CompanyStatus, type PlatformCompany, type CompanyDetail,
} from '../../lib/platform';
import { CompanyPanel, CompanyState, StatusDialog } from '../../components/platform/CompanyPanel';

const PAGE = 25;
const since = (iso: string) => `منذ ${dayText(cairo(iso).day)}`;

/** Ask the overview for a company before its panel opens (hover, focus). */
const prefetch = (id: string) => void queryClient.prefetchQuery({
  queryKey: keys.company(id, 'overview'),
  queryFn: async () => { const { data, error } = await supabase.rpc('company_overview', { p_company_id: id }); if (error) throw new Error(error.message); return data; },
  staleTime: 30_000,
});

/**
 * «الشركات» (docs/canvas/AdmPlatCompanies*): every transport company on the
 * platform, how ready each is to sell, the way into its dashboard, and its status
 * changed only through a question that says what happens to its people.
 */
export const CompaniesPage: React.FC = () => {
  const list = usePlatformCompanyList();
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CompanyFilter>('current');
  const [sort, setSort] = useState<CompanySort>('name');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, filter, sort]);

  const openId = params.get('company');
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('company', id); else n.delete('company'); return n; }, { replace: !id });
  const [asking, setAsking] = useState<CompanyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = companyCounts(rows);
  const shown = useMemo(() => listCompanies(rows, { filter, search, sort }), [rows, filter, search, sort]);
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const open = rows.find((c) => c.id === openId) ?? null;
  // A link to a company that is not there (removed, mistyped) closes with a word instead of an empty panel.
  const missing = !!openId && !!list.data && !open;
  useEffect(() => {
    if (!missing) return;
    notifyError('هذه الشركة غير موجودة', 'ربما حُذفت أو تغيّر رابطها.');
    navigate('/platform/companies', { replace: true });
  }, [missing, navigate]);

  const setStatus = (c: PlatformCompany, to: CompanyStatus) => void guard(`status:${c.id}`, async () => {
    setBusy(true);
    const { data, error } = await supabase.from('companies').update({ status: to }).eq('id', c.id).select('id, status').single();
    setBusy(false);
    if (error || !data) { notifyError('لم تتغيّر حالة الشركة', errorText(error)); return; }
    const at = new Date().toISOString();
    // What this tab shows is brought up to date here; the change's own announcement reads nothing again.
    rememberApplied([c.id], ['overview', 'companyNames']);
    client.setQueryData<PlatformCompany[]>(companiesKey, (all) => all?.map((x) => (x.id === c.id ? { ...x, status: to, status_changed_at: at, selling: to === 'active' ? x.selling : false } : x)));
    client.setQueryData<CompanyDetail>(companyDetailKey(c.id), (d) => (d ? { ...d, company: { ...d.company, status: to, status_changed_at: at } } : d));
    client.setQueryData<CompanyOption[]>(keys.platform('companyNames'), (all) => all?.map((x) => (x.id === c.id ? { ...x, status: to } : x)));
    client.setQueryData<CompanyScope>(keys.company(c.id, 'company'), (x) => (x ? { ...x, status: to } : x));
    setAsking(null);
    notifyDone(to === 'suspended' ? `أُوقفت «${c.name}».` : to === 'archived' ? `أُرشفت «${c.name}». تجدها تحت «مؤرشفة».` : `عادت «${c.name}» إلى العمل.`,
      to === 'suspended' ? 'مديروها ومشرفوها لا يدخلون، ولا يراها الطلاب حتى تعيد تشغيلها.' : undefined);
    if (to === 'archived') setOpen(null);
  });

  const columns: Column<PlatformCompany>[] = [
    { key: 'name', label: <span className="inline-flex items-center gap-1">الشركة{sort === 'name' && <Icon name="aup" size={14} stroke={2} />}</span>, render: (c) => <Cell2 main={c.name} sub={since(c.created_at)} /> },
    { key: 'status', label: 'الحالة', w: 120, render: (c) => <CompanyState status={c.status} /> },
    { key: 'lines', label: 'خطوط تعمل', w: 112, render: (c) => (c.lines === 0 ? <Badge tone="danger">بلا خطوط</Badge>
      : <span className="tabular"><span className="font-medium">{num(c.active_lines)}</span> <span className="text-cap text-ink-3">من {num(c.lines)}</span></span>) },
    { key: 'students', label: 'الطلاب', w: 88, render: (c) => <span className="tabular">{num(c.students)}</span> },
    { key: 'admins', label: 'المديرون', w: 88, hideTablet: true, render: (c) => <span className="tabular">{num(c.admins)}</span> },
    { key: 'pay', label: 'وسائل الدفع', w: 104, hideTablet: true, render: (c) => (c.payment_methods == null ? '—' : c.payment_methods === 0 ? <Badge tone="danger">لا توجد</Badge> : <span className="tabular">{num(c.payment_methods)}</span>) },
    { key: 'sale', label: 'معروض للبيع', w: 128, render: (c) => <Selling c={c} /> },
    { key: 'go', label: <span className="sr-only">الدخول</span>, w: 104, align: 'end', render: (c) => (
      <span onClick={(e) => e.stopPropagation()} className="inline-flex"><Button sm kind="tonal" iconEnd="fwd" to={`/c/${c.id}`} onMouseEnter={() => prefetch(c.id)}>ادخل</Button></span>
    ) },
  ];

  const addButton = <Button icon="plus" to="/platform/companies/new">شركة جديدة</Button>;
  const header = <PageHeader title="الشركات" sub="كل شركات النقل على المنصة. اضغط شركة لترى حالها، أو ادخل لوحتها لتعمل فيها كأنك مديرها." actions={rows.length || list.loading ? addButton : undefined} phoneActions={false} />;

  if (list.loading) return <Page>{header}<SkeletonTable rows={8} cols={7} /></Page>;
  if (list.error && !list.data) return <Page>{header}<ErrorState card title="تعذّر تحميل الشركات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void list.reload()} /></Page>;
  if (rows.length === 0) {
    return (
      <Page>{header}
        <EmptyState card icon="building" title="لا شركات بعد" text="الشركة هي صاحب الباصات: لها خطوطها وطلابها ومديروها. أنشئ الأولى باسمها ومديرها، وهو يكمل الباقي."
          action={<Button icon="plus" to="/platform/companies/new">شركة جديدة</Button>} />
      </Page>
    );
  }

  const one = rows.length === 1;
  const toolbar = (
    <Toolbar
      search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الشركة" />}
      filters={one ? undefined : <Chips value={filter} onChange={setFilter} options={[
        { value: 'current', label: 'الحالية', count: counts.current }, { value: 'active', label: 'تعمل', count: counts.active },
        { value: 'suspended', label: 'موقوفة', count: counts.suspended }, { value: 'archived', label: 'مؤرشفة', count: counts.archived },
      ]} />}
      count={one ? 'شركة واحدة' : <span className="sm:hidden">{num(shown.length)} شركة</span>}
      sort={one ? undefined : <SortSelect value={sort} onChange={setSort} options={[{ value: 'name', label: 'بالاسم' }, { value: 'newest', label: 'الأحدث' }, { value: 'students', label: 'الأكثر طلاباً' }]} />}
    />
  );
  const noMatch = shown.length === 0 ? (
    <EmptyState icon="search" title={search ? 'لا شركة بهذا الاسم' : 'لا شركات هنا'}
      text={search ? `لا توجد شركة ${filter === 'archived' ? 'مؤرشفة' : filter === 'suspended' ? 'موقوفة' : 'حالية'} اسمها يشبه «${search.trim()}». جرّب جزءاً من الاسم${filter !== 'archived' ? '، أو ابحث في المؤرشفة' : ''}.` : 'لا توجد شركة بهذه الحالة الآن.'}
      action={search ? (
        <>
          <Button kind="secondary" icon="x" onClick={() => setSearch('')}>امسح البحث</Button>
          {filter !== 'archived' && counts.archived > 0 && <Button kind="outline" onClick={() => setFilter('archived')}>ابحث في المؤرشفة</Button>}
        </>
      ) : <Button kind="secondary" onClick={() => setFilter('current')}>اعرض الحالية</Button>} />
  ) : undefined;

  return (
    <Page>
      {header}
      <DataTable caption="الشركات" columns={columns} rows={pageRows} rowKey={(c) => c.id} onOpen={(c) => setOpen(c.id)} openKey={openId}
        toolbar={toolbar} empty={noMatch} pager={<Pager page={page} total={shown.length} onPage={setPage} />}
        card={(c) => ({
          title: c.name, sub: since(c.created_at), end: <CompanyState status={c.status} />,
          stats: [['الطلاب', num(c.students)], ['خطوط تعمل', c.lines === 0 ? <span className="text-small text-bad">بلا خطوط</span> : <span dir="ltr">{num(c.active_lines)}/{num(c.lines)}</span>]],
          fields: [
            ['المديرون', <span className="tabular">{num(c.admins)}</span>],
            ['وسائل الدفع', c.payment_methods == null ? '—' : c.payment_methods === 0 ? <Badge tone="danger">لا توجد</Badge> : <span className="tabular">{num(c.payment_methods)}</span>],
            ['معروض للبيع', <Selling c={c} />],
          ],
        })} />
      <PhoneBar>{React.cloneElement(addButton, { full: true })}</PhoneBar>
      <CompanyPanel company={open} onClose={() => setOpen(null)} onStatus={setAsking} busy={busy} online={online} />
      <StatusDialog company={open} to={asking} busy={busy} onClose={() => setAsking(null)} onConfirm={() => open && asking && setStatus(open, asking)} />
    </Page>
  );
};

const Selling: React.FC<{ c: PlatformCompany }> = ({ c }) => (c.status !== 'active' || c.selling == null ? <span className="text-ink-3">—</span>
  : c.selling ? <Badge tone="success">معروض</Badge> : <Badge tone="warning">لا شيء معروض</Badge>);
