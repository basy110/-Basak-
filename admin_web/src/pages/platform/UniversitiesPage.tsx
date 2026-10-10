import React, { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button, Cell2, Chips, Dialog, Icon, DataTable, EmptyState, ErrorState, Note, Page, PageHeader, Pager, PhoneBar, SearchBox, SkeletonTable, SortSelect, Toolbar, errorText, num, useOnline, type Column } from '../../ui';
import { ExportButton, ImportPanel, type ImportCheck } from '../../ui/Transfer';
import { exportSheet } from '../../lib/excel';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/query';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError, notifyUndoable } from '../../lib/toasts';
import { UNIVERSITY_COLUMNS, universitiesKey, useUniversities } from '../../lib/reference';
import {
  collegesKey, collegeStudents, matches, sameName, useColleges, useUniversityCounts, useIsPhone,
  type CollegeRow, type UniversityFilter, type UniversityRow,
} from '../../lib/platform';
import { HideCollegeDialog, HideUniversityDialog, UniState, UniversityAddPanel, UniversityPanel } from '../../components/platform/UniversityPanels';

const PAGE = 25;
type Sort = 'name' | 'students';
const DUPLICATE = 'توجد جامعة بهذا الاسم. افتحها بدل إضافتها مرة أخرى.';
const isDuplicate = (e: unknown) => /duplicate|unique|23505|مسجلة من قبل/i.test(e instanceof Error ? e.message : String(e ?? ''));

/**
 * «الجامعات والكليات» (docs/canvas/AdmPlatUniversities*): the list students choose
 * their university and college from, and companies choose their lines' destinations
 * from. A university's name and city can be changed; it and each college are shown or
 * hidden by one named button, and hiding one with students asks first.
 */
export const UniversitiesPage: React.FC = () => {
  const unis = useUniversities();
  const collegesQ = useColleges();
  const countsQ = useUniversityCounts();
  const rows = useMemo(() => unis.data ?? [], [unis.data]);
  const colleges = useMemo(() => collegesQ.data ?? [], [collegesQ.data]);
  const counts = countsQ.data ?? null;
  const online = useOnline();
  const phone = useIsPhone();
  const client = useQueryClient();
  const guard = useGuard();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UniversityFilter>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [hideUni, setHideUni] = useState(false);
  const [hideCollege, setHideCollege] = useState<CollegeRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<'show' | 'hide' | null>(null);
  const [importing, setImporting] = useState(false);

  const openId = params.get('university');
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('university', id); else n.delete('university'); return n; }, { replace: !id });
  const open = rows.find((u) => u.id === openId) ?? null;

  const statsOf = (id: string) => counts?.universities.find((x) => x.id === id);
  const collegesOf = (id: string) => colleges.filter((c) => c.university_id === id);
  const shownColleges = (id: string) => collegesOf(id).filter((c) => c.is_active).length;
  const shown = useMemo(() => {
    const list = rows.filter((u) => (filter === 'all' || (filter === 'shown') === u.is_active) && matches(search, u.name, u.city));
    return list.sort((a, b) => (sort === 'students' ? (statsOf(b.id)?.students ?? 0) - (statsOf(a.id)?.students ?? 0) : 0) || Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, 'ar'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, search, sort, counts]);
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);

  // ── Writes: the row as saved replaces the cached one ──────────────────────────
  const putUni = (row: UniversityRow) => client.setQueryData<UniversityRow[]>(universitiesKey, (all) => {
    const list = all ?? [];
    return list.some((u) => u.id === row.id) ? list.map((u) => (u.id === row.id ? row : u)) : [...list, row];
  });
  const putCollege = (row: CollegeRow) => client.setQueryData<CollegeRow[]>(collegesKey, (all) => {
    const list = all ?? [];
    return list.some((c) => c.id === row.id) ? list.map((c) => (c.id === row.id ? row : c)) : [...list, row];
  });

  const add = (name: string, city: string) => void guard('add', async () => {
    setBusy('add'); setAddError('');
    try {
      const row = await unwrap<UniversityRow>(supabase.from('universities').insert({ name, city, is_active: true }).select(UNIVERSITY_COLUMNS).single());
      putUni(row);
      setAdding(null);
      setOpen(row.id);
      notifyDone(`أُضيفت ${name}. أضف كلياتها الآن.`);
    } catch (e) { setAddError(isDuplicate(e) ? DUPLICATE : errorText(e)); }
    setBusy(null);
  });

  const save = (u: UniversityRow, name: string, city: string) => void guard(`save:${u.id}`, async () => {
    setBusy('save'); setSaveError('');
    try {
      const row = await unwrap<UniversityRow>(supabase.from('universities').update({ name, city }).eq('id', u.id).select(UNIVERSITY_COLUMNS).single());
      putUni(row);
      notifyDone(name !== u.name ? `صار اسمها «${name}». يراه الطلاب كذلك من الآن.` : 'حُفظت بيانات الجامعة.');
    } catch (e) { setSaveError(isDuplicate(e) ? DUPLICATE : errorText(e)); }
    setBusy(null);
  });

  const setUniShown = (u: UniversityRow, show: boolean) => void guard(`uni:${u.id}`, async () => {
    setBusy('uni');
    try {
      putUni(await unwrap<UniversityRow>(supabase.from('universities').update({ is_active: show }).eq('id', u.id).select(UNIVERSITY_COLUMNS).single()));
      setHideUni(false);
      notifyDone(show ? `صارت ${u.name} تظهر للطلاب والشركات.` : `أُخفيت ${u.name}. الطلاب المسجّلون بها لا يتأثرون.`);
    } catch (e) { notifyError('لم يتغيّر شيء', errorText(e)); }
    setBusy(null);
  });

  const addCollege = async (u: UniversityRow, name: string) => {
    let ok = false;
    await guard(`college-add:${u.id}`, async () => {
      setBusy('college');
      try {
        putCollege(await unwrap<CollegeRow>(supabase.from('colleges').insert({ university_id: u.id, name, is_active: true }).select('id, university_id, name, is_active').single()));
        ok = true;
      } catch (e) { notifyError('لم تُضف الكلية', isDuplicate(e) ? 'هذه الكلية موجودة في هذه الجامعة.' : errorText(e)); }
      setBusy(null);
    });
    return ok;
  };
  /** Several colleges at once (the general list, or names its students typed); ones already there are skipped. */
  const addColleges = (u: UniversityRow, names: string[]) => void guard(`colleges:${u.id}`, async () => {
    setBusy('colleges');
    try {
      const fresh = names.filter((n) => !colleges.some((c) => c.university_id === u.id && sameName(c.name, n)));
      const rows = fresh.length ? await unwrap<CollegeRow[]>(supabase.from('colleges')
        .upsert(fresh.map((name) => ({ university_id: u.id, name, is_active: true })), { onConflict: 'university_id,name', ignoreDuplicates: true })
        .select('id, university_id, name, is_active')) : [];
      rows.forEach(putCollege);
      notifyDone(rows.length === 1 ? `أُضيفت كلية ${rows[0].name.replace(/^كلية\s+/, '')}.` : `أُضيفت ${num(rows.length)} كلية إلى ${u.name}.`,
        rows.length > 1 ? 'صار طلابها يختارون من كلياتها هي. أخفِ ما لا يوجد فيها.' : undefined);
    } catch (e) { notifyError('لم تُضف الكليات', errorText(e)); }
    setBusy(null);
  });

  /** «أظهر/أخفِ المحدد»: one write for every chosen university. */
  const setManyShown = (show: boolean) => void guard('bulk', async () => {
    const ids = [...selected].filter((id) => rows.find((u) => u.id === id)?.is_active !== show);
    setBusy('bulk');
    try {
      const saved = ids.length ? await unwrap<UniversityRow[]>(supabase.from('universities').update({ is_active: show }).in('id', ids).select(UNIVERSITY_COLUMNS)) : [];
      saved.forEach(putUni);
      setBulk(null); setSelected(new Set());
      notifyDone(show ? `صارت ${num(saved.length)} جامعة تظهر للطلاب والشركات.` : `أُخفيت ${num(saved.length)} جامعة. الطلاب المسجّلون بها لا يتأثرون.`);
    } catch (e) { notifyError('لم يتغيّر شيء', errorText(e)); }
    setBusy(null);
  });

  // ── Excel ──────────────────────────────────────────────────────────────────────
  const exportRows = (list: UniversityRow[]) => exportSheet({
    name: 'الجامعات والكليات',
    rows: list.flatMap((u) => {
      const mine = collegesOf(u.id);
      return (mine.length ? mine : [null]).map((c) => ({ u, c }));
    }),
    columns: [
      { label: 'الجامعة', value: (r) => r.u.name, width: 34 },
      { label: 'المدينة', value: (r) => r.u.city, width: 18 },
      { label: 'حالة الجامعة', value: (r) => (r.u.is_active ? 'تظهر' : 'مخفية') },
      { label: 'الكلية', value: (r) => r.c?.name ?? 'القائمة العامة', width: 28 },
      { label: 'حالة الكلية', value: (r) => (r.c ? (r.c.is_active ? 'تظهر' : 'مخفية') : '') },
      { label: 'طلاب الكلية', value: (r) => (r.c ? collegeStudents(counts ?? undefined, r.u.id, r.c.name) : null) },
      { label: 'طلاب الجامعة', value: (r) => statsOf(r.u.id)?.students ?? null },
      { label: 'شركات تخدمها', value: (r) => statsOf(r.u.id)?.companies.length ?? null },
    ],
  });
  type ImportRow = { university: string; city: string; college: string };
  const created = useRef(new Map<string, UniversityRow>());
  const checkImport = (r: Record<'university' | 'city' | 'college', string>, _i: number, all: Record<'university' | 'city' | 'college', string>[]): ImportCheck<ImportRow> => {
    const label = [r.university, r.college].filter(Boolean).join(' · ');
    if (r.university.length < 3) return { ok: false, label, error: 'اسم الجامعة فارغ أو قصير.' };
    const known = rows.find((u) => sameName(u.name, r.university));
    if (!known && r.city.length < 2) return { ok: false, label, error: 'جامعة جديدة: اكتب مدينتها لتُضاف.' };
    if (r.college && known && colleges.some((c) => c.university_id === known.id && sameName(c.name, r.college))) return { ok: false, label, error: 'الكلية موجودة في هذه الجامعة من قبل.' };
    if (!r.college && known) return { ok: false, label, error: 'الجامعة موجودة، ولا كلية في الصف.' };
    const twice = all.filter((x) => sameName(x.university, r.university) && sameName(x.college, r.college)).length > 1;
    if (twice && r.college) return { ok: false, label, error: 'مكرر في الملف.' };
    return { ok: true, label, value: { university: r.university, city: r.city, college: r.college } };
  };
  const importOne = async (r: ImportRow) => {
    let u = rows.find((x) => sameName(x.name, r.university)) ?? [...created.current.values()].find((x) => sameName(x.name, r.university));
    if (!u) {
      u = await unwrap<UniversityRow>(supabase.from('universities').insert({ name: r.university, city: r.city, is_active: true }).select(UNIVERSITY_COLUMNS).single());
      created.current.set(u.id, u); putUni(u);
    }
    if (r.college) {
      const rowsBack = await unwrap<CollegeRow[]>(supabase.from('colleges')
        .upsert([{ university_id: u.id, name: r.college, is_active: true }], { onConflict: 'university_id,name', ignoreDuplicates: true })
        .select('id, university_id, name, is_active'));
      rowsBack.forEach(putCollege);
    }
  };

  const writeCollege = async (c: CollegeRow, show: boolean) => {
    putCollege(await unwrap<CollegeRow>(supabase.from('colleges').update({ is_active: show }).eq('id', c.id).select('id, university_id, name, is_active').single()));
  };
  const setCollegeShown = (c: CollegeRow, show: boolean, asked = false) => {
    const students = collegeStudents(counts ?? undefined, c.university_id, c.name);
    // A college with students asks first (or when its count is not known); an unused one hides at once, with «تراجع».
    if (!show && !asked && students !== 0) { setHideCollege(c); return; }
    void guard(`college:${c.id}`, async () => {
      setBusy(`college:${c.id}`);
      try {
        await writeCollege(c, show);
        setHideCollege(null);
        if (!show) notifyUndoable(`أُخفيت كلية ${c.name.replace(/^كلية\s+/, '')}.`, () => void writeCollege(c, true).catch((e) => notifyError('لم تُعد الكلية', errorText(e))));
        else notifyDone(`صارت كلية ${c.name.replace(/^كلية\s+/, '')} تظهر للطلاب.`);
      } catch (e) { notifyError('لم يتغيّر شيء', errorText(e)); }
      setBusy(null);
    });
  };

  // ── What is drawn ──────────────────────────────────────────────────────────────
  const dash = <span className="text-ink-3">—</span>;
  const muted = (u: UniversityRow, n: number) => <span className={`tabular ${!u.is_active || n === 0 ? 'text-ink-3' : ''}`}>{num(n)}</span>;
  const columns: Column<UniversityRow>[] = [
    { key: 'name', label: <span className="inline-flex items-center gap-1">الجامعة{sort === 'name' && <Icon name="aup" size={14} stroke={2} />}</span>, render: (u) => <Cell2 main={u.name} sub={shownColleges(u.id) === 0 && u.is_active ? 'بلا كليات خاصة: يختار طلابها من القائمة العامة' : undefined} /> },
    { key: 'city', label: 'المدينة', w: 170, render: (u) => <span className="truncate">{u.city}</span> },
    { key: 'colleges', label: 'الكليات', w: 110, render: (u) => (shownColleges(u.id) === 0 ? <span className="text-ink-3">العامة</span> : muted(u, shownColleges(u.id))) },
    { key: 'students', label: 'الطلاب', w: 96, render: (u) => (statsOf(u.id) ? muted(u, statsOf(u.id)!.students) : dash) },
    { key: 'companies', label: 'شركات تخدمها', w: 120, hideTablet: true, render: (u) => (statsOf(u.id) ? muted(u, statsOf(u.id)!.companies.length) : dash) },
    { key: 'state', label: 'الحالة', w: 112, render: (u) => <UniState on={u.is_active} /> },
    { key: 'open', label: <span className="sr-only">فتح</span>, w: 88, align: 'end', render: (u) => <span onClick={(e) => e.stopPropagation()} className="inline-flex"><Button sm kind="tonal" onClick={() => setOpen(u.id)}>افتح</Button></span> },
  ];

  const startAdd = (name = '') => { setAddError(''); setAdding(name); };
  const addButton = <Button icon="plus" onClick={() => startAdd()}>إضافة جامعة</Button>;
  const headerActions = <><Button kind="secondary" icon="upload" onClick={() => setImporting(true)} disabled={!online}>استيراد من Excel</Button>{addButton}</>;
  const header = <PageHeader title="الجامعات والكليات" sub="القائمة التي يختار منها الطالب جامعته وكليته عند التسجيل، وتختار منها الشركات وجهات خطوطها." actions={rows.length || unis.loading ? headerActions : undefined} phoneActions={false} />;
  const panels = (
    <>
      <UniversityAddPanel open={adding !== null} initialName={adding ?? ''} all={rows} busy={busy === 'add'} online={online} serverError={addError || undefined}
        onClose={() => setAdding(null)} onAdd={add} />
      <UniversityPanel u={open} all={rows} colleges={colleges} counts={counts} online={online} busy={busy} saveError={saveError || undefined}
        onClose={() => { setOpen(null); setSaveError(''); }} onSave={(n, c) => open && save(open, n, c)} onAddCollege={(n) => (open ? addCollege(open, n) : Promise.resolve(false))} onAddColleges={(names) => open && addColleges(open, names)}
        onCollege={(c, show) => setCollegeShown(c, show)} onUniversity={(show) => (show ? open && setUniShown(open, true) : setHideUni(true))} />
      <HideUniversityDialog u={hideUni ? open : null} counts={counts} busy={busy === 'uni'} onClose={() => setHideUni(false)} onConfirm={() => open && setUniShown(open, false)} />
      <ImportPanel open={importing} onClose={() => { setImporting(false); created.current.clear(); }} title="استيراد جامعات وكليات" what="صف" templateName="قالب الجامعات والكليات"
        fields={[
          { key: 'university', label: 'الجامعة', aliases: ['اسم الجامعة', 'university'], required: true, example: 'جامعة المنصورة' },
          { key: 'city', label: 'المدينة', aliases: ['city'], example: 'المنصورة' },
          { key: 'college', label: 'الكلية', aliases: ['اسم الكلية', 'college', 'faculty'], example: 'الهندسة' },
        ]}
        note="صف لكل كلية. الجامعة غير الموجودة تُضاف بمدينتها، والكلية الموجودة من قبل تُتخطّى."
        check={checkImport} importOne={importOne} onFinished={() => void client.invalidateQueries({ queryKey: collegesKey })} />
      <Dialog open={bulk !== null} onClose={() => setBulk(null)} icon="eye" tone={bulk === 'hide' ? 'danger' : 'teal'}
        title={bulk === 'hide' ? `إخفاء ${num(selected.size)} جامعة؟` : `إظهار ${num(selected.size)} جامعة؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setBulk(null)}>رجوع</Button>,
          <Button key="g" kind={bulk === 'hide' ? 'danger' : 'primary'} loading={busy === 'bulk'} onClick={() => setManyShown(bulk === 'show')}>{bulk === 'hide' ? 'أخفِ الجامعات' : 'أظهر الجامعات'}</Button>]}>
        <p className="m-0">{bulk === 'hide'
          ? 'لن تظهر لطالب جديد عند التسجيل ولا لشركة عند إنشاء خط. الطلاب المسجّلون بها وخطوط الشركات لا يتغيّر فيها شيء، وتستطيع إظهارها في أي وقت.'
          : 'تظهر للطلاب عند التسجيل وللشركات عند إنشاء خطوطها.'}</p>
      </Dialog>
      <HideCollegeDialog c={hideCollege} uni={open?.name ?? ''} students={hideCollege ? collegeStudents(counts ?? undefined, hideCollege.university_id, hideCollege.name) ?? 0 : 0}
        busy={!!hideCollege && busy === `college:${hideCollege.id}`} onClose={() => setHideCollege(null)} onConfirm={() => hideCollege && setCollegeShown(hideCollege, false, true)} />
    </>
  );

  if (unis.loading) return <Page>{header}<SkeletonTable rows={8} cols={6} /></Page>;
  if (unis.error && !unis.data) return <Page>{header}<ErrorState card title="تعذّر تحميل الجامعات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void unis.reload()} /></Page>;
  if (rows.length === 0) {
    return (
      <Page>{header}
        <EmptyState card icon="school" title="لا جامعات بعد" text="أضف الجامعات التي تذهب إليها الباصات، ثم كليات كل جامعة. بدونها لا يستطيع طالب أن يسجّل ولا شركة أن تنشئ خطاً."
          action={<Button icon="plus" onClick={() => startAdd()}>إضافة جامعة</Button>} />
        {panels}
      </Page>
    );
  }

  const counted = { all: rows.length, shown: rows.filter((u) => u.is_active).length, hidden: rows.filter((u) => !u.is_active).length };
  const toolbar = (
    <Toolbar
      search={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="ابحث باسم الجامعة أو المدينة" />}
      filters={phone ? undefined : <Chips value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[
        { value: 'all', label: 'الكل', count: counted.all }, { value: 'shown', label: 'تظهر', count: counted.shown }, { value: 'hidden', label: 'مخفية', count: counted.hidden },
      ]} />}
      count={phone ? `${num(shown.length)} جامعة` : `${num(colleges.filter((c) => c.is_active).length)} كلية`}
      sort={<SortSelect value={sort} onChange={setSort} options={[{ value: 'name', label: 'بالاسم' }, { value: 'students', label: 'الأكثر طلاباً' }]} />}
      actions={phone ? undefined : <ExportButton count={shown.length} onExport={() => exportRows(shown)} />}
      bulk={{
        count: selected.size, onClear: () => setSelected(new Set()), total: shown.length, onAll: () => setSelected(new Set(shown.map((u) => u.id))),
        actions: <>
          <ExportButton label="تصدير المحدد" count={selected.size} onExport={() => exportRows(rows.filter((u) => selected.has(u.id)))}  />
          <Button sm kind="secondary" icon="eye" disabled={!online} onClick={() => setBulk('show')}>أظهر</Button>
          <Button sm kind="secondary" icon="eyeOff" disabled={!online} onClick={() => setBulk('hide')}>أخفِ</Button>
        </>,
      }}
    />
  );
  const noMatch = shown.length === 0 ? (
    search.trim() ? (
      <EmptyState icon="search" title={`لا جامعة باسم «${search.trim()}»`} text="تأكد من الاسم، أو أضفها إن كانت جديدة."
        action={<Button kind="secondary" icon="plus" onClick={() => startAdd(search.trim())}>أضف «{search.trim()}»</Button>} />
    ) : <EmptyState icon="school" title={filter === 'hidden' ? 'لا جامعات مخفية' : 'لا جامعات تظهر'} action={<Button kind="secondary" onClick={() => setFilter('all')}>اعرض الكل</Button>} />
  ) : undefined;

  return (
    <Page>
      {header}
      <Note icon="school" title="الشركات لا تضيف جامعة بنفسها">مدير الشركة يختار من هذه القائمة فقط عند إنشاء خط. إن نقصته جامعة يتواصل معك خارج اللوحة، وتضيفها أنت هنا.</Note>
      <DataTable caption="الجامعات" columns={columns} rows={pageRows} selectable selected={selected} onSelect={setSelected} rowKey={(u) => u.id} onOpen={(u) => setOpen(u.id)} openKey={openId} toolbar={toolbar} empty={noMatch}
        pager={<Pager page={page} total={shown.length} onPage={setPage} />} muted={(u) => !u.is_active}
        card={(u) => ({
          title: u.name, sub: u.city, end: <UniState on={u.is_active} />,
          stats: [['الكليات', num(shownColleges(u.id))], ['الطلاب', statsOf(u.id) ? num(statsOf(u.id)!.students) : '—'], ['شركات', statsOf(u.id) ? num(statsOf(u.id)!.companies.length) : '—']],
        })} />
      <PhoneBar>{React.cloneElement(addButton, { full: true })}</PhoneBar>
      {panels}
    </Page>
  );
};
