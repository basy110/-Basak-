import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, useOnline } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { Page, PageHeader } from '../../ui/Layout';
import { Badge, Ltr } from '../../ui/Status';
import { Cell2, DataTable, SearchBox, SortSelect, type Column } from '../../ui/Table';
import { agoText, countText, NOUN, phoneText } from '../../ui/format';
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

  const decide = (row: PlatformCorrection, approve: boolean, reason?: string) => guard(row.id, async () => {
    // The row leaves the queue at once; an approval changes the account, so its announcement reads the accounts again.
    rememberApplied([row.id], approve ? ['corrections'] : ['corrections', 'students']);
    try {
      await decideCorrection(row.id, approve, reason);
    } catch (e) {
      forgetApplied([row.id]);
      if (approve) notify({ title: 'تعذّر حفظ القرار. الطلب ما زال في القائمة.', tone: 'error', action: { label: 'حاول مرة أخرى', run: () => void decide(row, true) } }, 15_000);
      throw e;
    }
    const next = rows[rows.findIndex((r) => r.id === row.id) + 1] ?? rows.filter((r) => r.id !== row.id)[0];
    client.setQueryData<PlatformCorrection[]>(queueKey, (list) => list?.filter((r) => r.id !== row.id));
    if (approve) refreshIfNotUpdated(keys.platform('students'));
    setOpen(next ? next.id : null);
    const n = Math.max(1, row.student_companies?.length ?? 1);
    notifyDone(approve
      ? `تم تغيير ${row.field === 'full_name' ? 'اسم' : 'جامعة'} ${toastName(row)} ${atCompanies(n)}.`
      : `رُفض طلب تصحيح ${FIELD_LABEL[row.field]} ${toastName(row)}. تعرف ${row.company ?? 'الشركة'} السبب.`);
  });

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

  const toolbar = (
    <div className="flex flex-col gap-3 sm:min-h-[60px] sm:flex-row sm:flex-wrap sm:items-center sm:border-b sm:border-hair sm:px-4 sm:py-2">
      <SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الطالب أو الشركة" className="sm:w-[280px]" />
      <span className="hidden flex-1 sm:block" />
      <div className="flex min-h-6 items-center gap-2 sm:contents">
        <span aria-live="polite" className="flex-1 whitespace-nowrap text-label text-ink-2 sm:flex-none">{queue.data ? (search ? `${countText(rows.length, NOUN.request)} من ${all.length}` : waitingText(all.length)) : ''}</span>
        <span className="sm:hidden"><LinkSelect<Order> label="الترتيب" value={order} onChange={setOrder} options={[{ value: 'oldest', label: 'الأقدم أولاً' }, { value: 'newest', label: 'الأحدث أولاً' }]} /></span>
        <span className="hidden sm:inline-flex"><SortSelect<Order> value={order} onChange={setOrder} options={[{ value: 'oldest', label: 'الأقدم أولاً' }, { value: 'newest', label: 'الأحدث أولاً' }]} /></span>
      </div>
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
        toolbar={toolbar} rowH={60}
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
      {open && (
        <CorrectionPanel key={open.id} row={open} index={Math.max(0, openIndex)} count={rows.length || all.length} online={online} onClose={() => setOpen(null)}
          onApprove={async () => { await decide(open, true); }} onReject={async (reason) => { await decide(open, false, reason); }} />
      )}
    </Page>
  );
};
