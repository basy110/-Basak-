import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, useOnline } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { Page, PageHeader } from '../../ui/Layout';
import { Badge, Ltr } from '../../ui/Status';
import { Cell2, DataTable, SearchBox, SortSelect, Toolbar, type Column } from '../../ui/Table';
import { TextArea } from '../../ui/Field';
import { ExportButton } from '../../ui/Transfer';
import { agoText, countText, NOUN, num, phoneText } from '../../ui/format';
import { exportSheet } from '../../lib/excel';
import { excelMoment, excelNumber, MOMENT_FORMAT } from '../../lib/excelCells';
import { BulkDialog, BulkExportButton } from '../../components/BulkDialog';
import { keys, refreshIfNotUpdated, usePageData } from '../../lib/query';
import { forgetApplied, rememberApplied } from '../../lib/recentChanges';
import { useGuard } from '../../lib/guard';
import { notify, notifyDone } from '../../lib/toasts';
import { decideCorrection, FIELD_LABEL, loadPlatformCorrections, matchCorrection, type PlatformCorrection } from '../../lib/corrections';
import { atCompanies, CorrectionPanel, toastName } from '../../components/students/CorrectionPanel';
import { LinkSelect } from '../../components/students/parts';

type Order = 'oldest' | 'newest';
/** «9 طلبات تنتظر قرارك», «طلب واحد ينتظر قرارك». */
const waitingText = (n: number) => (n === 1 ? 'طلب واحد ينتظر قرارك' : n === 2 ? 'طلبان ينتظران قرارك' : `${countText(n, NOUN.request)} تنتظر قرارك`);
/** «طلبَي التصحيح المحددين», «5 من طلبات التصحيح» (n > 1). */
const chosenText = (n: number) => (n === 2 ? 'طلبَي التصحيح المحددين' : `${num(n)} من طلبات التصحيح`);
const STUDENTS: [string, string, string, string] = ['طالب', 'طالبين', 'طلاب', 'طالباً'];

/**
 * «طلبات تصحيح البيانات» (docs/canvas/AdmPlatCorrections*): the name and university
 * corrections companies proposed, oldest first; one opens in a panel to approve, or to
 * refuse with a reason the company reads. ?request=<id> opens one (from «كل الطلاب»).
 */
export const CorrectionsPage: React.FC = () => {
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const [params, setParams] = useSearchParams();
  const openId = params.get('request');
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('request', id); else n.delete('request'); return n; });
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<Order>('oldest');
  const queueKey = keys.platform('corrections');
  const queue = usePageData(queueKey, loadPlatformCorrections);
  const all = queue.data ?? [];
  const rows = useMemo(() => {
    const kept = all.filter((r) => matchCorrection(r, search));
    return order === 'oldest' ? kept : [...kept].reverse();
  }, [all, search, order]);
  const openIndex = rows.findIndex((r) => r.id === openId);
  const open = openIndex >= 0 ? rows[openIndex] : all.find((r) => r.id === openId);

  /** The decision itself, and the queue brought up to date: the one write both a single decision and a chosen batch make. */
  const write = async (row: PlatformCorrection, approve: boolean, reason?: string) => {
    // The row leaves the queue at once; an approval changes the account, so its announcement reads the accounts again.
    rememberApplied([row.id], approve ? ['corrections'] : ['corrections', 'students']);
    try {
      await decideCorrection(row.id, approve, reason);
    } catch (e) {
      forgetApplied([row.id]);
      throw e;
    }
    client.setQueryData<PlatformCorrection[]>(queueKey, (list) => list?.filter((r) => r.id !== row.id));
    if (approve) refreshIfNotUpdated(keys.platform('students'));
  };

  const decide = (row: PlatformCorrection, approve: boolean, reason?: string) => guard(row.id, async () => {
    try {
      await write(row, approve, reason);
    } catch (e) {
      if (approve) notify({ title: 'تعذّر حفظ القرار. الطلب ما زال في القائمة.', tone: 'error', action: { label: 'حاول مرة أخرى', run: () => void decide(row, true) } }, 15_000);
      throw e;
    }
    const next = rows[rows.findIndex((r) => r.id === row.id) + 1] ?? rows.filter((r) => r.id !== row.id)[0];
    setOpen(next ? next.id : null);
    const n = Math.max(1, row.student_companies?.length ?? 1);
    notifyDone(approve
      ? `تم تغيير ${row.field === 'full_name' ? 'اسم' : 'جامعة'} ${toastName(row)} ${atCompanies(n)}.`
      : `رُفض طلب تصحيح ${FIELD_LABEL[row.field]} ${toastName(row)}. تعرف ${row.company ?? 'الشركة'} السبب.`);
  });

  // ── Chosen rows: approve or refuse them together, or export them ────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = rows.filter((r) => selected.has(r.id));
  const [bulk, setBulk] = useState<{ approve: boolean; list: PlatformCorrection[] } | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const runOne = async (row: PlatformCorrection) => {
    const done = await guard(row.id, async () => { await write(row, !!bulk?.approve, bulk?.approve ? undefined : bulkReason.trim()); return true; });
    if (!done) throw new Error('هذا الطلب يُحفظ الآن من مكان آخر.');
  };
  const exportRows = (list: PlatformCorrection[]) => exportSheet<PlatformCorrection>({
    name: 'طلبات تصحيح البيانات', rows: list,
    columns: [
      { label: 'الطالب', value: (r) => r.student_name, width: 28 },
      { label: 'رقم الهاتف', value: (r) => r.student_phone, width: 15 },
      { label: 'يُطلب تغيير', value: (r) => FIELD_LABEL[r.field], width: 12 },
      { label: 'من', value: (r) => r.old_value, width: 28 },
      { label: 'إلى', value: (r) => r.new_value, width: 28 },
      { label: 'الشركة الطالبة', value: (r) => r.company, width: 22 },
      { label: 'كتبه', value: (r) => r.requested_by_name, width: 20 },
      { label: 'ملاحظة الشركة', value: (r) => r.note, width: 30 },
      { label: 'شركات الطالب', value: (r) => (r.student_companies ? r.student_companies.join('، ') || 'بلا شركة' : null), width: 26 },
      { label: 'اشتراكات نشطة', value: (r) => excelNumber(r.active_subscriptions), width: 13 },
      { label: 'وقت الطلب', value: (r) => excelMoment(r.created_at), format: MOMENT_FORMAT, width: 18 },
    ],
  });
  const ask = (approve: boolean) => { setBulkReason(''); setReasonError(''); setBulk({ approve, list: chosen }); };
  const bulkList = bulk?.list ?? [];
  const names = bulkList.filter((r) => r.field === 'full_name').length;
  const unis = bulkList.length - names;
  const reach = new Set(bulkList.flatMap((r) => r.student_companies ?? (r.company ? [r.company] : []))).size;

  const columns: Column<PlatformCorrection>[] = [
    { key: 'student', label: 'الطالب', render: (r) => <Cell2 main={r.student_name ?? '—'} sub={r.student_phone ? <Ltr>{phoneText(r.student_phone)}</Ltr> : undefined} /> },
    { key: 'field', label: 'يُطلب تغيير', w: 104, render: (r) => <Badge>{FIELD_LABEL[r.field]}</Badge> },
    { key: 'from', label: 'من', w: 170, render: (r) => <span className="line-clamp-2 whitespace-normal text-ink-2">{r.old_value ?? '—'}</span> },
    { key: 'to', label: 'إلى', w: 180, render: (r) => <span className="line-clamp-2 whitespace-normal font-semibold">{r.new_value}</span> },
    { key: 'company', label: 'الشركة الطالبة', w: 170, hideTablet: true, render: (r) => r.company ?? '—' },
    { key: 'since', w: 120, hideTablet: true, label: (
      <button type="button" onClick={(e) => { e.stopPropagation(); setOrder(order === 'oldest' ? 'newest' : 'oldest'); }} className="inline-flex items-center gap-1 font-semibold text-ink"
        aria-label={order === 'oldest' ? 'منذ: الأقدم أولاً. اضغط للأحدث أولاً' : 'منذ: الأحدث أولاً. اضغط للأقدم أولاً'}>
        منذ<Icon name={order === 'oldest' ? 'aup' : 'adown'} size={14} stroke={2} />
      </button>), render: (r) => <span className="whitespace-nowrap">{agoText(r.created_at)}</span> },
    { key: 'act', label: <span className="sr-only">قرار</span>, w: 92, align: 'end', render: (r) => <Button sm kind="tonal" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>راجع</Button> },
  ];

  const toolbar = chosen.length > 0 ? (
    <Toolbar bulk={{
      count: chosen.length, onClear: () => setSelected(new Set()), total: rows.length, onAll: () => setSelected(new Set(rows.map((r) => r.id))),
      actions: (
        <>
          <BulkExportButton count={chosen.length} onExport={() => exportRows(chosen)} />
          <Button sm kind="secondary" icon="x" disabled={!online} onClick={() => ask(false)}>ارفض المحدد</Button>
          <Button sm kind="secondary" icon="check" disabled={!online} onClick={() => ask(true)}>اعتمد المحدد</Button>
        </>
      ),
    }} />
  ) : (
    <div className="flex flex-col gap-3 sm:min-h-[60px] sm:flex-row sm:flex-wrap sm:items-center sm:border-b sm:border-hair sm:px-4 sm:py-2">
      <SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الطالب أو الشركة" className="sm:w-[280px]" />
      <span className="hidden flex-1 sm:block" />
      <div className="flex min-h-6 items-center gap-2 sm:contents">
        <span aria-live="polite" className="flex-1 whitespace-nowrap text-label text-ink-2 sm:flex-none">{queue.data ? (search ? `${countText(rows.length, NOUN.request)} من ${all.length}` : waitingText(all.length)) : ''}</span>
        <span className="sm:hidden"><LinkSelect<Order> label="الترتيب" value={order} onChange={setOrder} options={[{ value: 'oldest', label: 'الأقدم أولاً' }, { value: 'newest', label: 'الأحدث أولاً' }]} /></span>
        <span className="hidden sm:inline-flex"><SortSelect<Order> value={order} onChange={setOrder} options={[{ value: 'oldest', label: 'الأقدم أولاً' }, { value: 'newest', label: 'الأحدث أولاً' }]} /></span>
      </div>
      {rows.length > 0 && <ExportButton count={rows.length} className="hidden sm:inline-flex" onExport={() => exportRows(rows)} />}
    </div>
  );

  const sub = 'تقترحها الشركات عندما يكون اسم طالب أو جامعته خطأ. اعتمادك يغيّر بيانات الحساب عند كل الشركات التي ينتمي إليها.';
  let body: React.ReactNode;
  if (queue.loading) {
    body = <div aria-busy="true" className="overflow-hidden rounded-card bg-surface shadow-card">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex h-14 items-center gap-6 border-t border-hair px-4 first:border-t-0">{[24, 8, 18, 18, 14, 10].map((w, c) => <span key={c} className="skeleton block h-3 rounded-md" style={{ width: `${w}%` }} />)}</div>)}</div>;
  } else if (queue.error && !queue.data) {
    body = <ErrorState card title="تعذّر تحميل الطلبات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void queue.reload()} />;
  } else if (all.length === 0) {
    body = <EmptyState card icon="check" title="لا طلبات تصحيح الآن" text="عندما تجد شركة خطأ في اسم طالب أو جامعته، ترسل الطلب من صفحة طلابها ويظهر هنا لتقرر." />;
  } else {
    body = (
      <DataTable<PlatformCorrection> caption="طلبات تصحيح البيانات" columns={columns} rows={rows} rowKey={(r) => r.id} onOpen={(r) => setOpen(r.id)} openKey={openId}
        toolbar={toolbar} rowH={60} selectable selected={selected} onSelect={setSelected}
        empty={rows.length === 0 ? <div className="sm:[&>div]:!rounded-none sm:[&>div]:!shadow-none"><EmptyState card icon="search" title={`لا طلب يطابق «${search}»`} text="جرّب اسم الطالب أو اسم الشركة أو رقم الهاتف." action={<Button kind="outline" full onClick={() => setSearch('')}>مسح البحث</Button>} /></div> : undefined}
        card={(r) => ({
          title: r.student_name ?? '—', sub: r.student_phone ? <Ltr>{phoneText(r.student_phone)}</Ltr> : undefined, end: <Badge>{FIELD_LABEL[r.field]}</Badge>,
          fields: [['من', <span key="f" className="text-ink-2">{r.old_value ?? '—'}</span>], ['إلى', <span key="t" className="font-semibold">{r.new_value}</span>], ['الشركة الطالبة', r.company ?? '—'], ['منذ', agoText(r.created_at)]],
        })} />
    );
  }

  return (
    <Page>
      <PageHeader title="طلبات تصحيح البيانات" sub={sub} />
      {body}
      <BulkDialog<PlatformCorrection> open={!!bulk} onClose={() => setBulk(null)} items={bulkList} labelOf={(r) => `${r.student_name ?? '—'} · ${FIELD_LABEL[r.field]}`}
        run={runOne} disabled={!online} icon={bulk?.approve ? 'check' : 'x'} tone={bulk?.approve ? 'teal' : 'danger'} danger={!bulk?.approve}
        title={bulk?.approve
          ? (bulkList.length === 1 ? 'اعتماد طلب التصحيح المحدد؟' : `اعتماد ${chosenText(bulkList.length)}؟`)
          : (bulkList.length === 1 ? 'رفض طلب التصحيح المحدد؟' : `رفض ${chosenText(bulkList.length)}؟`)}
        confirmLabel={bulk?.approve
          ? (bulkList.length === 1 ? 'اعتمد التغيير' : `اعتمد ${countText(bulkList.length, ['تغيير', 'تغييرين', 'تغييرات', 'تغييراً'])}`)
          : (bulkList.length === 1 ? 'ارفض الطلب' : `ارفض ${bulkList.length === 2 ? 'طلبين' : countText(bulkList.length, NOUN.request)}`)}
        check={() => { const empty = !bulk?.approve && !bulkReason.trim(); setReasonError(empty ? 'اكتب سبب الرفض؛ تقرؤه كل شركة طلبت.' : ''); return empty; }}
        doneText={(n) => (n === 0 ? 'لم يُحفظ أي قرار.' : bulk?.approve ? `اعتُمد ${n === 1 ? 'طلب واحد' : countText(n, NOUN.request)}.` : `رُفض ${n === 1 ? 'طلب واحد' : countText(n, NOUN.request)}.`)}
        onFinished={(done) => {
          setSelected((s) => { const next = new Set(s); done.forEach((r) => next.delete(r.id)); return next; });
          if (open && done.some((r) => r.id === open.id)) setOpen(null);
        }}>
        {bulk?.approve ? (
          <p className="m-0">
            {names > 0 && `يتغيّر ${names === 1 ? 'اسم طالب واحد' : `اسم ${countText(names, STUDENTS)}`}`}
            {names > 0 && unis > 0 && '، و'}
            {unis > 0 && `تتغيّر ${unis === 1 ? 'جامعة طالب واحد' : `جامعة ${countText(unis, STUDENTS)}`}`}
            {' '}إلى القيمة المقترحة في كل طلب، عند كل الشركات التي ينتمي إليها كل طالب{reach > 0 ? ` (${reach === 1 ? 'شركة واحدة' : countText(reach, ['شركة', 'شركتين', 'شركات', 'شركة'])})` : ''}.
            الإيصالات القديمة لا تتغيّر، ولا يمكن التراجع إلا بطلب تصحيح جديد.
          </p>
        ) : (
          <>
            <p className="m-0">تبقى بيانات الطلاب كما هي. تعرف كل شركة طلبت أن طلبها رُفض، وترى السبب الذي تكتبه هنا (واحد للجميع).</p>
            <TextArea label="سبب الرفض" rows={3} maxLength={300} value={bulkReason} className="text-ink"
              placeholder="مثال: الاسم المقترح لا يطابق البطاقة التي أرسلها الطالب." error={reasonError || undefined}
              onChange={(e) => { setBulkReason(e.target.value); setReasonError(''); }} />
          </>
        )}
        <p className="m-0 text-ink">{bulkList.slice(0, 5).map((r) => `${r.student_name ?? '—'}: ${r.new_value}`).join('، ')}{bulkList.length > 5 ? ` و${num(bulkList.length - 5)} غيرها` : ''}.</p>
      </BulkDialog>
      {open && (
        <CorrectionPanel key={open.id} row={open} index={Math.max(0, openIndex)} count={rows.length || all.length} online={online} onClose={() => setOpen(null)}
          onApprove={async () => { await decide(open, true); }} onReject={async (reason) => { await decide(open, false, reason); }} />
      )}
    </Page>
  );
};
