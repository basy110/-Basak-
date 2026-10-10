import React, { useMemo, useState } from 'react';
import { Select } from '../../ui/Select';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../../lib/query';
import { usePlatformCompanies } from '../../lib/reference';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import {
  adminsCount, colleaguesOf, createCompanyAdmin, deleteCompanyAdmin, filterAdmins, usePlatformAdmins, type AdminSort, type CompanyAdmin,
} from '../../lib/team';
import { Button, DataTable, EmptyState, ErrorState, Icon, Ltr, Note, Page, PageHeader, Pager, PhoneBar, Pill, SearchBox, SkeletonTable, SortSelect, Toolbar, cairo, countText, dayText, errorText, useOnline, type Column } from '../../ui';
import { ExportButton } from '../../ui/Transfer';
import { exportSheet } from '../../lib/excel';
import { DAY_FORMAT, excelDay, excelMoment, MOMENT_FORMAT } from '../../lib/excelCells';
import { AdminAddPanel, RemoveAdminDialog, type AdminDraft } from '../../components/team/AdminParts';

const PAGE = 25;
const todayCairo = () => cairo(new Date()).day;
const addedOn = (iso: string) => { const d = cairo(iso).day; return d === todayCairo() ? 'اليوم' : dayText(d); };

/**
 * «مديرو الشركات» (docs/canvas/AdmPlatAdmins*): everyone who signs in to a
 * company's dashboard, across the platform. Add one to a working company, or
 * delete one who left. An admin never moves between companies.
 */
export const CompanyAdminsPage: React.FC = () => {
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const adminsQ = usePlatformAdmins();
  const companiesQ = usePlatformCompanies();
  const admins = useMemo(() => adminsQ.data ?? [], [adminsQ.data]);
  const companies = useMemo(() => companiesQ.data ?? [], [companiesQ.data]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const working = companies.filter((c) => (c.status ?? 'active') === 'active');
  const nameOf = (id: string | null) => (id ? companyById.get(id)?.name ?? '' : '');

  const [search, setSearch] = useState('');
  const [company, setCompany] = useState('');
  const [sort, setSort] = useState<AdminSort>('newest');
  const [page, setPage] = useState(1);
  const shown = useMemo(() => filterAdmins(admins, { search, company, sort }, nameOf), [admins, search, company, sort, companyById]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = shown.slice((page - 1) * PAGE, page * PAGE);
  const companiesWithAdmins = new Set(admins.map((a) => a.company_id)).size;

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [removing, setRemoving] = useState<CompanyAdmin | null>(null);
  const listKey = keys.platform('companyAdmins');

  const add = (d: AdminDraft) => void guard('add', async () => {
    setBusy(true); setFormError('');
    try {
      const r = await createCompanyAdmin({ companyId: d.companyId, fullName: d.fullName, email: d.email, password: d.how === 'password' ? d.password : undefined });
      setAdding(false);
      const first = d.fullName.trim().split(/\s+/)[0];
      notifyDone(r?.invited ? `أُرسلت الدعوة إلى بريد ${first}. يختار كلمة المرور من الرابط.` : `أُنشئ حساب ${first}. يدخل الآن بالبريد وكلمة المرور.`);
      void adminsQ.reload();
      void client.invalidateQueries({ queryKey: keys.company(d.companyId, 'team') });
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  const remove = (a: CompanyAdmin) => void guard(`remove:${a.id}`, async () => {
    setBusy(true);
    try {
      await deleteCompanyAdmin(a.id);
      client.setQueryData<CompanyAdmin[]>(listKey, (list) => list?.filter((x) => x.id !== a.id));
      if (a.company_id) void client.invalidateQueries({ queryKey: keys.company(a.company_id, 'team') });
      setRemoving(null);
      notifyDone(`حُذف المدير ${a.full_name}.`);
    } catch (e) { notifyError('تعذّر حذف المدير', errorText(e)); }
    setBusy(false);
  });

  const companyCell = (a: CompanyAdmin) => {
    const c = a.company_id ? companyById.get(a.company_id) : undefined;
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{c?.name ?? '—'}</span>
        {c?.status === 'suspended' && <Pill tone="warning">موقوفة</Pill>}
        {c?.status === 'archived' && <Pill tone="neutral">مؤرشفة</Pill>}
      </span>
    );
  };
  const invited = (a: CompanyAdmin) => (a.last_sign_in_at === null ? 'أُرسلت له دعوة ولم يدخل بعد' : undefined);
  const deleteButton = (a: CompanyAdmin, phone?: boolean) => (
    <Button kind="outline" sm icon="trash" disabled={!online} className={phone ? '!h-11' : ''} aria-label={`احذف المدير ${a.full_name}`}
      onClick={() => setRemoving(a)}>{phone ? 'احذف المدير' : 'احذف'}</Button>
  );
  const sortHeader = (
    <button type="button" onClick={() => setSort(sort === 'oldest' ? 'newest' : 'oldest')} className="inline-flex items-center gap-1 font-medium hover:text-ink"
      aria-label={sort === 'oldest' ? 'رتّب الأحدث أولاً' : 'رتّب الأقدم أولاً'}>
      أُضيف في{sort !== 'name' && <Icon name={sort === 'oldest' ? 'aup' : 'adown'} size={14} stroke={2} />}
    </button>
  );
  const columns: Column<CompanyAdmin>[] = [
    { key: 'name', label: 'المدير', render: (a) => (
      <div className="min-w-0"><div className="truncate font-medium">{a.full_name}</div>{invited(a) && <div className="truncate text-cap text-ink-3">{invited(a)}</div>}</div>
    ) },
    { key: 'email', label: 'البريد الإلكتروني', w: 300, render: (a) => <div className="truncate"><Ltr>{a.email}</Ltr></div> },
    { key: 'company', label: 'الشركة', w: 240, hideTablet: true, render: companyCell },
    { key: 'added', label: sortHeader, w: 150, render: (a) => addedOn(a.created_at) },
    { key: 'delete', label: <span className="sr-only">حذف</span>, w: 112, align: 'end', render: (a) => deleteButton(a) },
  ];

  const exportRows = () => exportSheet<CompanyAdmin>({
    name: 'مديرو الشركات', rows: shown,
    columns: [
      { label: 'المدير', value: (a) => a.full_name, width: 28 },
      { label: 'البريد الإلكتروني', value: (a) => a.email, width: 32 },
      { label: 'الشركة', value: (a) => nameOf(a.company_id) || null, width: 26 },
      { label: 'حالة الشركة', value: (a) => { const st = a.company_id ? companyById.get(a.company_id)?.status : undefined; return st === 'suspended' ? 'موقوفة' : st === 'archived' ? 'مؤرشفة' : st ? 'تعمل' : null; }, width: 12 },
      { label: 'أُضيف في', value: (a) => excelDay(cairo(a.created_at).day), format: DAY_FORMAT, width: 13 },
      { label: 'آخر دخول', value: (a) => (a.last_sign_in_at === null ? 'لم يدخل بعد' : excelMoment(a.last_sign_in_at)), format: MOMENT_FORMAT, width: 18 },
    ],
  });

  const loading = adminsQ.loading || companiesQ.loading;
  const loadError = adminsQ.error || companiesQ.error;
  const noCompany = !loading && !loadError && working.length === 0;
  const openAdd = () => { setFormError(''); setAdding(true); };
  const addButton = (full?: boolean) => <Button icon="plus" full={full} disabled={!online || noCompany} onClick={openAdd}>إضافة مدير</Button>;
  const removingLeft = removing ? colleaguesOf(removing, admins) : [];

  return (
    <Page>
      <PageHeader title="مديرو الشركات" sub="كل من يدخل لوحة شركة. كل مدير يتبع شركة واحدة ويرى كل صفحاتها." phoneActions={false}
        actions={admins.length > 0 || noCompany || loading ? addButton() : undefined} />

      {loading ? <SkeletonTable rows={6} cols={4} />
        : loadError ? <ErrorState card title="تعذّر تحميل المديرين" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => { void adminsQ.reload(); void companiesQ.reload(); }} />
          : noCompany ? (
            <Note tone="warning" title="لا توجد شركة تعمل" action={<Button kind="outline" sm to="/platform/companies" className="flex-none">افتح الشركات</Button>}>
              أضف شركة أو أعد تشغيل شركة موقوفة، ثم أضف مديرها.
            </Note>
          ) : admins.length === 0 ? (
            <EmptyState card icon="shield" title="لا مديرين بعد" text="يُضاف أول مدير مع شركته في «شركة جديدة». من هنا تضيف مديراً ثانياً لشركة قائمة، أو تحذف من ترك العمل."
              action={<>
                <Button kind="secondary" icon="plus" to="/platform/companies/new" className="hidden sm:inline-flex">شركة جديدة</Button>
                {addButton()}
              </>} />
          ) : (
            <DataTable<CompanyAdmin> caption="مديرو الشركات" columns={columns} rows={rows} rowKey={(a) => a.id}
              toolbar={<Toolbar
                search={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="ابحث بالاسم أو البريد" />}
                count={`${adminsCount(admins.length)} في ${companiesWithAdmins === 1 ? 'شركة واحدة' : countText(companiesWithAdmins, ['شركة', 'شركتين', 'شركات', 'شركة'])}`}
                sort={<SortSelect<AdminSort> value={sort} onChange={setSort} options={[
                  { value: 'newest', label: 'الأحدث أولاً' }, { value: 'oldest', label: 'الأقدم أولاً' }, { value: 'name', label: 'بالاسم' }]} />}
                actions={<>
                  <span className="hidden sm:inline-flex"><Select value={company} onChange={(v) => { setCompany(v); setPage(1); }} ariaLabel="الشركة" icon="building" minListWidth={240}
                    options={[{ value: '', label: 'كل الشركات' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
                    className="inline-flex h-9 w-[180px] flex-none items-center gap-1.5 rounded-control px-2.5 text-label font-semibold shadow-ring hover:bg-ground" /></span>
                  <ExportButton count={shown.length} className="hidden sm:inline-flex" onExport={exportRows} />
                </>} />}
              empty={shown.length === 0 ? <EmptyState icon="search" title="لا مدير يطابق" text="جرّب اسماً آخر أو جزءاً من البريد، أو اعرض كل الشركات."
                action={<Button kind="secondary" onClick={() => { setSearch(''); setCompany(''); }}>اعرض الكل</Button>} /> : undefined}
              pager={<Pager page={page} total={shown.length} onPage={setPage} />}
              card={(a) => ({
                title: a.full_name, sub: invited(a),
                fields: [['البريد', <Ltr key="e" className="break-all">{a.email}</Ltr>], ['الشركة', <span key="c" className="inline-flex justify-end">{companyCell(a)}</span>], ['أُضيف في', addedOn(a.created_at)]],
                actions: deleteButton(a, true),
              })} />
          )}

      {!loading && !loadError && !noCompany && admins.length > 0 && <PhoneBar>{addButton(true)}</PhoneBar>}

      <AdminAddPanel open={adding} onClose={() => setAdding(false)} variant="platform" companies={working} busy={busy}
        serverError={formError} onSubmit={add} disabled={!online} />
      <RemoveAdminDialog open={!!removing} admin={removing} companyName={nameOf(removing?.company_id ?? null)} variant="platform" busy={busy}
        left={removingLeft} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} />
    </Page>
  );
};
