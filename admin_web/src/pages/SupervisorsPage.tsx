import React, { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useCompany } from '../lib/adminScope';
import { keys, refreshIfNotUpdated } from '../lib/query';
import {
  SUPERVISOR_COLUMNS, useLineNames, useLines, useSupervisorLines, useSupervisors, type SupervisorLine, type SupervisorRow,
} from '../lib/reference';
import { useCompanyOverview } from '../lib/overview';
import { rememberApplied } from '../lib/recentChanges';
import { useGuard } from '../lib/guard';
import { notifyDone, notifyError } from '../lib/toasts';
import { useSignedUrls } from '../lib/signedUrls';
import { squareJpeg } from '../lib/images';
import {
  assignmentMaps, filterSupervisors, impactOn, linesPhrase, linesWithoutSupervisor, listText, supervisorCounts, supervisorsCount,
  createSupervisor, deleteSupervisor, normalizePhone, resetSupervisorPassword, setSupervisorActive, setSupervisorLines, updateSupervisor,
  useSupervisorRecords, type SupervisorFilter, type SupervisorSort,
} from '../lib/team';
import {
  Badge, Button, Chips, DataTable, EmptyState, ErrorState, Note, Page, PageHeader, Pager, PhoneBar, SearchBox, SkeletonTable,
  Icon, SortSelect, StatePill, Toolbar, countText, errorText, useOnline, type Column,
} from '../ui';
import { LineTag, PersonCell, PhoneLtr } from '../components/team/parts';
import { RowMenu } from '../components/team/RowMenu';
import { SupervisorAddPanel, SupervisorEditPanel, SupervisorLinesPanel, SupervisorPanel, type AddDraft, type LineFacts } from '../components/team/SupervisorPanels';
import {
  AssignLineDialog, CredentialsDialog, DeleteDialog, RemovePhotoDialog, ResetPasswordDialog, StartDialog, StopDialog,
} from '../components/team/SupervisorDialogs';

const PHOTO_BUCKET = 'supervisor-avatars';
const PAGE = 25;
type Sup = SupervisorRow & { created_at?: string };
type Overlay =
  | { kind: 'add' } | { kind: 'open'; id: string } | { kind: 'lines'; id: string } | { kind: 'edit'; id: string }
  | { kind: 'stop'; id: string } | { kind: 'start'; id: string } | { kind: 'delete'; id: string } | { kind: 'photo'; id: string }
  | { kind: 'password'; id: string } | { kind: 'assign'; lineId: string } | null;

/**
 * «المشرفون» (docs/canvas/AdmSupervisors*, AdmSupervisor*): who rides the bus and
 * records boarding. A list; one supervisor in a side panel; every change through
 * a named action, and the ones that stop, delete or move access through a question.
 */
export const SupervisorsPage: React.FC = () => {
  const company = useCompany();
  const companyId = company.id;
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();

  const supervisorsQ = useSupervisors(companyId);
  const linesQ = useLineNames(companyId);
  const assignQ = useSupervisorLines(companyId);
  const overview = useCompanyOverview(companyId);
  const supervisors = (supervisorsQ.data ?? []) as Sup[];
  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);
  const assignments = useMemo(() => assignQ.data ?? [], [assignQ.data]);
  const { linesOf, supervisorsOf } = useMemo(() => assignmentMaps(assignments), [assignments]);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const subscribers = useMemo(() => new Map((overview.data?.top_lines ?? []).map((l) => [l.id, l.subscribers])), [overview.data]);
  const photos = useSignedUrls(PHOTO_BUCKET, supervisors.map((s) => s.profile_image_url));
  const photoOf = (s?: SupervisorRow | null) => (s?.profile_image_url ? photos[s.profile_image_url] : null);

  const supervisorsKey = keys.company(companyId, 'supervisors');
  const assignmentsKey = keys.company(companyId, 'supervisorLines');

  // List state
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SupervisorFilter>('all');
  const [sort, setSort] = useState<SupervisorSort>('name');
  const [page, setPage] = useState(1);
  const counts = supervisorCounts(supervisors, linesOf);
  const shown = useMemo(() => filterSupervisors(supervisors, linesOf, { search, filter, sort }), [supervisors, linesOf, search, filter, sort]);
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const uncovered = useMemo(() => linesWithoutSupervisor(lines, supervisors, supervisorsOf), [lines, supervisors, supervisorsOf]);
  const uncoveredSet = useMemo(() => new Set(uncovered.map((l) => l.id)), [uncovered]);

  // What is open
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [panelId, setPanelId] = useState<string | null>(null); // the record under a dialog stays open
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState<{ name: string; phone: string; password: string; lines: string[]; reset?: boolean } | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoTarget = useRef<Sup | null>(null);

  const byId = (id?: string | null) => supervisors.find((s) => s.id === id) ?? null;
  const targetId = overlay && 'id' in overlay ? overlay.id : null;
  const target = byId(targetId);
  const panelSup = byId(panelId);
  const open = (o: Overlay) => { setFormError(''); setOverlay(o); };
  const closeOverlay = () => { setOverlay(panelId ? { kind: 'open', id: panelId } : null); setFormError(''); };
  const openRecord = (id: string) => { setPanelId(id); open({ kind: 'open', id }); };
  const closeRecord = () => { setPanelId(null); setOverlay(null); };

  // Lines of a full line row (trip counts), only while a record is open.
  const fullLines = useLines(companyId, !!panelId);
  const factsOf = (id: string): LineFacts[] => (linesOf.get(id) ?? []).flatMap((lineId) => {
    const line = lineById.get(lineId);
    if (!line) return [];
    const full = fullLines.data?.find((l) => l.id === lineId);
    const trips = full?.line_trips.filter((t) => t.is_active);
    return [{ line, subscribers: subscribers.get(lineId), departures: trips?.filter((t) => t.direction === 'departure').length, returns: trips?.filter((t) => t.direction === 'return').length }];
  });

  const records = useSupervisorRecords(companyId, overlay?.kind === 'delete' ? overlay.id : null);

  // ── Writes ──────────────────────────────────────────────────────────
  const applyRow = (row: SupervisorRow) => {
    rememberApplied([row.id], ['supervisors']);
    client.setQueryData<Sup[]>(supervisorsKey, (list) => list?.map((item) => (item.id === row.id ? { ...item, ...row } : item)));
  };
  const applyLines = (supervisorId: string, ids: string[]) => {
    client.setQueryData<SupervisorLine[]>(assignmentsKey, (rows) => (rows ? [
      ...rows.filter((r) => r.supervisor_id !== supervisorId), ...ids.map((line_id) => ({ supervisor_id: supervisorId, line_id })),
    ] : rows));
    refreshIfNotUpdated(assignmentsKey);
  };
  const names = (ids: string[]) => ids.map((id) => lineById.get(id)?.name ?? 'خط');

  const add = (d: AddDraft) => void guard('add', async () => {
    setBusy(true); setFormError('');
    try {
      await createSupervisor({ ...d, companyId });
      setOverlay(null);
      setCreated({ name: d.fullName, phone: d.phone, password: d.password, lines: names(d.lineIds) });
      refreshIfNotUpdated(supervisorsKey);
      refreshIfNotUpdated(assignmentsKey);
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  const saveLines = (s: Sup, ids: string[]) => void guard(`lines:${s.id}`, async () => {
    setBusy(true); setFormError('');
    try {
      await setSupervisorLines(s.id, ids);
      applyLines(s.id, ids);
      closeOverlay();
      notifyDone(ids.length ? `حُفظت خطوط ${s.full_name}: ${listText(names(ids))}.` : `رُفعت كل الخطوط عن ${s.full_name}.`);
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  const assignLine = (lineId: string, supervisorId: string) => {
    const s = byId(supervisorId);
    if (!s) return;
    const ids = [...new Set([...(linesOf.get(s.id) ?? []), lineId])];
    void guard(`lines:${s.id}`, async () => {
      setBusy(true); setFormError('');
      try {
        await setSupervisorLines(s.id, ids);
        applyLines(s.id, ids);
        setOverlay(null);
        notifyDone(`أصبح ${s.full_name} مشرف خط ${lineById.get(lineId)?.name ?? ''}.`);
      } catch (e) { setFormError(errorText(e)); }
      setBusy(false);
    });
  };

  const toggle = (s: Sup) => void guard(`row:${s.id}`, async () => {
    setBusy(true);
    try {
      const row = await setSupervisorActive(s.id, !s.is_active);
      applyRow(row);
      closeOverlay();
      notifyDone(row.is_active ? `عاد ${s.full_name} يعمل.` : `أُوقف ${s.full_name}. لا يرى خطوطه حتى تشغّله.`);
    } catch (e) { notifyError(s.is_active ? 'تعذّر إيقاف المشرف' : 'تعذّر تشغيل المشرف', errorText(e)); }
    setBusy(false);
  });

  const remove = (s: Sup) => void guard(`row:${s.id}`, async () => {
    setBusy(true);
    try {
      await deleteSupervisor(s.id);
      rememberApplied([s.id], ['supervisors']);
      client.setQueryData<Sup[]>(supervisorsKey, (list) => list?.filter((item) => item.id !== s.id));
      client.setQueryData<SupervisorLine[]>(assignmentsKey, (rows) => rows?.filter((r) => r.supervisor_id !== s.id));
      setPanelId(null); setOverlay(null);
      notifyDone(`حُذف المشرف ${s.full_name}.`, records.data?.kept && records.data.scans > 0 ? 'سجلات الركوب التي سجّلها باقية باسمه.' : undefined);
    } catch (e) { notifyError('تعذّر حذف المشرف', errorText(e)); }
    setBusy(false);
  });

  const edit = (s: Sup, fullName: string, phone: string) => void guard(`edit:${s.id}`, async () => {
    setBusy(true); setFormError('');
    try {
      const moved = normalizePhone(phone) !== s.phone;
      const row = await updateSupervisor(s, fullName, phone);
      applyRow(row);
      closeOverlay();
      notifyDone(moved ? `حُفظت بيانات ${row.full_name}. يدخل الآن بالرقم الجديد.` : `حُفظ اسم ${row.full_name}.`);
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  const resetPassword = (s: Sup, password: string) => void guard(`password:${s.id}`, async () => {
    setBusy(true); setFormError('');
    try {
      const answer = await resetSupervisorPassword(s.id, password);
      setOverlay(panelId ? { kind: 'open', id: panelId } : null);
      setCreated({ name: s.full_name, phone: s.phone, password: answer?.password || password, lines: names(linesOf.get(s.id) ?? []), reset: true });
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  // The photo the supervisor sees in the app, and the students of his lines.
  const pickPhoto = (s: Sup) => { photoTarget.current = s; fileInput.current?.click(); };
  const uploadPhoto = (file: File | undefined) => {
    const s = photoTarget.current;
    if (!file || !s) return;
    void guard(`photo:${s.id}`, async () => {
      setUploadingId(s.id);
      try {
        const image = await squareJpeg(file);
        const path = `${s.id}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, image, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw upErr;
        const { data, error } = await supabase.from('supervisors').update({ profile_image_url: path }).eq('id', s.id).select(SUPERVISOR_COLUMNS).single();
        if (error || !data) { await supabase.storage.from(PHOTO_BUCKET).remove([path]); throw error ?? new Error('لم تُحفظ الصورة.'); }
        applyRow(data as SupervisorRow);
        if (s.profile_image_url) void supabase.storage.from(PHOTO_BUCKET).remove([s.profile_image_url]);
        notifyDone(`حُفظت صورة ${s.full_name}.`);
      } catch (e) { notifyError('تعذّر حفظ الصورة', errorText(e)); }
      setUploadingId(null);
    });
  };
  const removePhoto = (s: Sup) => void guard(`photo:${s.id}`, async () => {
    if (!s.profile_image_url) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('supervisors').update({ profile_image_url: null }).eq('id', s.id).select(SUPERVISOR_COLUMNS).single();
      if (error || !data) throw error ?? new Error('');
      applyRow(data as SupervisorRow);
      void supabase.storage.from(PHOTO_BUCKET).remove([s.profile_image_url]);
      closeOverlay();
      notifyDone(`أُزيلت صورة ${s.full_name}.`);
    } catch (e) { notifyError('تعذّر إزالة الصورة', errorText(e)); }
    setBusy(false);
  });

  // ── Page ────────────────────────────────────────────────────────────
  const loading = supervisorsQ.loading || linesQ.loading || assignQ.loading;
  const loadError = supervisorsQ.error || linesQ.error || assignQ.error;
  const retry = () => { void supervisorsQ.reload(); void linesQ.reload(); void assignQ.reload(); };
  const noLines = !loading && !loadError && lines.length === 0;
  const canAdd = !noLines && !loading && !loadError;
  const addButton = (full?: boolean) => <Button icon="plus" full={full} disabled={!online} onClick={() => open({ kind: 'add' })}>أضف مشرفاً</Button>;

  const lineCell = (s: Sup) => {
    const ids = linesOf.get(s.id) ?? [];
    if (!ids.length) return <Badge tone="warning">بلا خطوط</Badge>;
    return <span className="flex min-w-0 flex-wrap gap-1.5">{ids.map((id) => <LineTag key={id} line={lineById.get(id)} />)}</span>;
  };
  const menu = (s: Sup) => (
    <RowMenu label={`إجراءات ${s.full_name}`} items={[
      { label: 'افتح بيانات المشرف', icon: 'eye', onClick: () => openRecord(s.id) },
      { label: 'تغيير الخطوط', icon: 'route', onClick: () => { setPanelId(null); open({ kind: 'lines', id: s.id }); }, hidden: !online },
      { label: s.profile_image_url ? 'تغيير الصورة' : 'إضافة صورة', icon: 'image', onClick: () => pickPhoto(s), hidden: !online },
      { label: s.is_active ? 'إيقاف المشرف' : 'تشغيل المشرف', icon: 'power', divider: true, onClick: () => { setPanelId(null); open({ kind: s.is_active ? 'stop' : 'start', id: s.id }); }, hidden: !online },
      { label: 'حذف المشرف', icon: 'trash', danger: true, onClick: () => { setPanelId(null); open({ kind: 'delete', id: s.id }); }, hidden: !online },
    ]} />
  );
  const columns: Column<Sup>[] = [
    { key: 'name', label: 'المشرف', render: (s) => <PersonCell name={s.full_name} src={photoOf(s)} /> },
    { key: 'phone', label: 'رقم الهاتف', w: 168, hideTablet: true, render: (s) => <PhoneLtr phone={s.phone} className={s.is_active ? '' : 'text-ink-3'} /> },
    { key: 'lines', label: 'الخطوط', w: 280, render: lineCell },
    { key: 'state', label: 'الحالة', w: 120, render: (s) => <StatePill state={s.is_active ? 'on' : 'off'} /> },
    { key: 'menu', label: <span className="sr-only">إجراءات</span>, w: 64, align: 'end', render: menu },
  ];

  const uncoveredTitle = uncovered.length === 1 ? 'خط بلا مشرف' : uncovered.length === 2 ? 'خطان بلا مشرف' : `${countText(uncovered.length, ['خط', 'خطان', 'خطوط', 'خطاً'])} بلا مشرف`;
  const firstUncovered = uncovered[0];

  const stopImpact = target ? impactOn(target.id, linesOf.get(target.id) ?? [], lines, supervisors, supervisorsOf) : [];
  const sole = stopImpact.filter((i) => i.line.is_active && i.others.length === 0).map((i) => ({ line: i.line, subscribers: subscribers.get(i.line.id) }));
  const assignable = supervisors.filter((s) => s.is_active).map((s) => ({ ...s, lines: (linesOf.get(s.id) ?? []).length }));

  return (
    <Page>
      <PageHeader title="المشرفون" phoneActions={false}
        sub={<span className="hidden sm:inline">المشرف يركب مع الباص ويسجّل صعود الطلاب بهاتفه. يدخل التطبيق برقم هاتفه وكلمة مرور، ويرى خطوطه فقط.</span>}
        actions={loading || (canAdd && supervisors.length > 0) ? addButton() : undefined} />

      {loading ? <SkeletonTable rows={6} cols={4} />
        : loadError ? <ErrorState card title="تعذّر تحميل المشرفين" text="لم نستطع جلب المشرفين وخطوطهم. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={retry} />
          : noLines ? (
            <EmptyState card icon="route" title="أضف خطاً أولاً" text="كل مشرف يلزمه خط واحد على الأقل يشرف عليه، وليس عندك خطوط بعد."
              action={<Button icon="plus" to={`/c/${companyId}/lines/new`}>أضف أول خط</Button>} />
          ) : supervisors.length === 0 ? (
            <EmptyState card icon="scan" title="لا مشرفين بعد" text="المشرف يركب مع الباص ويسجّل صعود الطلاب بهاتفه، فتعرف من ركب فعلاً. أضف أول مشرف وأسند إليه خطاً."
              action={addButton()} />
          ) : (
            <>
              {uncovered.length > 0 && (
                <Note tone="danger" title={`${uncoveredTitle}: ${listText(uncovered.map((l) => l.name))}`}
                  action={online ? <Button kind="outline" sm className="hidden flex-none sm:inline-flex" onClick={() => open({ kind: 'assign', lineId: firstUncovered.id })}>اختر مشرفاً لخط {firstUncovered.name}</Button> : undefined}>
                  {uncovered.length === 1 ? 'لا أحد يسجّل ركاب هذا الخط عند الصعود. أسنده لمشرف موجود أو أضف مشرفاً.'
                    : uncovered.length === 2 ? 'لا أحد يسجّل ركاب هذين الخطين عند الصعود. أسندهما لمشرف موجود أو أضف مشرفاً.'
                      : 'لا أحد يسجّل ركاب هذه الخطوط عند الصعود. أسندها لمشرف موجود أو أضف مشرفاً.'}
                </Note>
              )}
              <DataTable<Sup>
                caption="مشرفو الشركة" columns={columns} rows={pageRows} rowKey={(s) => s.id} onOpen={(s) => openRecord(s.id)} openKey={panelId}
                muted={(s) => !s.is_active}
                toolbar={<Toolbar
                  search={<SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="ابحث بالاسم أو رقم الهاتف" />}
                  filters={<Chips<SupervisorFilter> value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[
                    { value: 'all', label: 'الكل', count: counts.all }, { value: 'on', label: 'يعمل', count: counts.on },
                    { value: 'off', label: 'متوقف', count: counts.off }, { value: 'nolines', label: 'بلا خطوط', count: counts.nolines },
                  ]} />}
                  count={<span className="sm:hidden">{supervisorsCount(shown.length)}</span>}
                  sort={<span className="hidden sm:contents"><SortSelect<SupervisorSort> value={sort} onChange={setSort} options={[{ value: 'name', label: 'الاسم' }, { value: 'newest', label: 'الأحدث' }]} /></span>} />}
                empty={shown.length === 0 ? <EmptyState icon="search" title="لا مشرف يطابق" text="جرّب اسماً آخر أو جزءاً من الرقم، أو اعرض الكل."
                  action={<Button kind="secondary" onClick={() => { setSearch(''); setFilter('all'); }}>اعرض الكل</Button>} /> : undefined}
                pager={<Pager page={page} total={shown.length} onPage={setPage} />}
                card={(s) => ({
                  title: <span className="flex items-center gap-3"><PersonCell name={s.full_name} src={photoOf(s)} /></span>,
                  end: <Icon name="fwd" size={18} className="mt-2.5 text-ink-3" />,
                  fields: [['رقم الهاتف', <PhoneLtr key="p" phone={s.phone} />], ['الخطوط', <span key="l" className="inline-flex justify-end">{lineCell(s)}</span>], ['الحالة', <StatePill key="s" state={s.is_active ? 'on' : 'off'} />]],
                })} />
            </>
          )}

      {canAdd && supervisors.length > 0 && <PhoneBar>{addButton(true)}</PhoneBar>}

      <input ref={fileInput} type="file" accept="image/*" className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />

      <SupervisorAddPanel open={overlay?.kind === 'add'} onClose={() => setOverlay(null)} lines={lines} uncovered={uncoveredSet}
        busy={busy} serverError={overlay?.kind === 'add' ? formError : ''} onSubmit={add} disabled={!online} />

      <SupervisorPanel open={!!panelSup} onClose={closeRecord} supervisor={panelSup} photo={photoOf(panelSup)}
        uploading={uploadingId === panelSup?.id} lines={panelSup ? factsOf(panelSup.id) : []} writable={online}
        onPhoto={() => panelSup && pickPhoto(panelSup)} onRemovePhoto={() => panelSup && open({ kind: 'photo', id: panelSup.id })}
        onEdit={() => panelSup && open({ kind: 'edit', id: panelSup.id })} onLines={() => panelSup && open({ kind: 'lines', id: panelSup.id })}
        onPassword={() => panelSup && open({ kind: 'password', id: panelSup.id })}
        onToggle={() => panelSup && open({ kind: panelSup.is_active ? 'stop' : 'start', id: panelSup.id })}
        onDelete={() => panelSup && open({ kind: 'delete', id: panelSup.id })} />

      <SupervisorLinesPanel open={overlay?.kind === 'lines'} onClose={closeOverlay} supervisor={target} photo={photoOf(target)} lines={lines}
        current={target ? linesOf.get(target.id) ?? [] : []}
        uncovered={new Set(target ? linesWithoutSupervisor(lines, supervisors.filter((s) => s.id !== target.id), supervisorsOf).map((l) => l.id) : [])}
        busy={busy} error={overlay?.kind === 'lines' ? formError : ''} onSave={(ids) => target && saveLines(target, ids)} />

      <SupervisorEditPanel open={overlay?.kind === 'edit'} onClose={closeOverlay} supervisor={target} busy={busy}
        serverError={overlay?.kind === 'edit' ? formError : ''} onSave={(n, p) => target && edit(target, n, p)} />

      <StopDialog open={overlay?.kind === 'stop'} supervisor={target} impact={stopImpact} busy={busy} onClose={closeOverlay} onConfirm={() => target && toggle(target)} />
      <StartDialog open={overlay?.kind === 'start'} supervisor={target} lineNames={target ? names(linesOf.get(target.id) ?? []) : []} busy={busy} onClose={closeOverlay} onConfirm={() => target && toggle(target)} />
      <DeleteDialog open={overlay?.kind === 'delete'} supervisor={target} sole={sole} busy={busy} onClose={closeOverlay} onConfirm={() => target && remove(target)}
        records={{ data: records.data, loading: records.loading, error: records.error }} />
      <RemovePhotoDialog open={overlay?.kind === 'photo'} supervisor={target} busy={busy} onClose={closeOverlay} onConfirm={() => target && removePhoto(target)} />
      <ResetPasswordDialog open={overlay?.kind === 'password'} supervisor={target} busy={busy} error={overlay?.kind === 'password' ? formError : ''}
        onClose={closeOverlay} onConfirm={(p) => target && resetPassword(target, p)} />
      <AssignLineDialog open={overlay?.kind === 'assign'} line={overlay?.kind === 'assign' ? lineById.get(overlay.lineId) ?? null : null}
        supervisors={assignable} busy={busy} error={overlay?.kind === 'assign' ? formError : ''} onClose={() => setOverlay(null)}
        onConfirm={(sid) => overlay?.kind === 'assign' && assignLine(overlay.lineId, sid)} onAdd={() => open({ kind: 'add' })} />

      <CredentialsDialog open={!!created} onClose={() => setCreated(null)} phone={created?.phone ?? ''} password={created?.password ?? ''}
        title={created?.reset ? `كلمة مرور ${created.name} الجديدة. سلّمها له الآن` : `أُضيف ${created?.name ?? ''}. سلّمه بيانات الدخول الآن`}
        text={created?.reset ? 'يدخل تطبيق باصك برقمه وهذه الكلمة. كلمة المرور القديمة لم تعد تعمل.'
          : `يدخل تطبيق باصك بهذين، ويرى ${linesPhrase(created?.lines ?? [])}.`} />
    </Page>
  );
};
