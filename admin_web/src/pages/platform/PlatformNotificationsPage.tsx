import React, { useEffect, useMemo, useState } from 'react';
import { Select } from '../../ui/Select';
import { useSearchParams } from 'react-router-dom';
import {
  Button, Cell2, Chips, DataTable, Dialog, EmptyState, ErrorState, Icon, Note, Page, PageHeader, Pager, PhoneBar, SearchBox, SectionHead,
  SkeletonStat, SkeletonTable, SortSelect, StatCard, StatePill, Toolbar, errorText, num, useOnline, type Column,
} from '../../ui';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import type { HistoryRow, StatusFilter } from '../../lib/notifications';
import { usePlatformNotificationActions, usePlatformNotificationHistory } from '../../lib/notificationsData';
import { groupNotes, matches, usePlatformCompanyList, whenText, type NoteGroup } from '../../lib/platform';
import { NoteDetails, NoteState, PlatformCompose } from '../../components/platform/PlatformNotify';

const PAGE = 25;
type G = NoteGroup<HistoryRow>;
const atOf = (r: HistoryRow) => r.sent_at ?? r.scheduled_at ?? r.created_at;

/**
 * «إشعارات المنصة» (docs/canvas/AdmPlatNotifications*, AdmPlatNotify*): whether push
 * reaches phones, what the platform and every company sent with what is known about
 * each, and — on «إشعار جديد» — a message to the students of all or chosen companies.
 */
export const PlatformNotificationsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  if (params.get('new') === '1') return <Page><PlatformCompose /></Page>;
  return <HistoryView params={params} setParams={setParams} />;
};

const HistoryView: React.FC<{ params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1] }> = ({ params, setParams }) => {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [companyId, setCompanyId] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'new' | 'old'>('new');
  const [page, setPage] = useState(1);
  const history = usePlatformNotificationHistory(filter, companyId);
  const actions = usePlatformNotificationActions();
  const companies = usePlatformCompanyList().data ?? [];
  const online = useOnline();
  const guard = useGuard();
  const [asking, setAsking] = useState<'delete' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(1), [filter, companyId, search, sort]);

  const groups = useMemo(() => {
    const g = groupNotes(history.rows).filter((x) => matches(search, x.first.title, x.first.body, x.first.company_name));
    return sort === 'old' ? [...g].reverse() : g;
  }, [history.rows, search, sort]);
  // The list is read 30 at a time: reaching its last loaded page asks for the next.
  const pages = Math.ceil(groups.length / PAGE);
  useEffect(() => { if (page >= pages && history.hasMore && !history.loadingMore) history.loadMore(); }, [page, pages, history]);
  const rows = groups.slice((page - 1) * PAGE, page * PAGE);
  const openId = params.get('note');
  const open = groups.find((g) => g.key === openId) ?? null;
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('note', id); else n.delete('note'); return n; }, { replace: !id });

  const act = (kind: 'delete' | 'cancel', g: G) => void guard(`${kind}:${g.key}`, async () => {
    setBusy(true);
    try {
      for (const r of g.rows) await (kind === 'delete' ? actions.remove(r.id) : actions.cancel(r.id));
      setAsking(null);
      if (kind === 'delete') setOpen(null);
      notifyDone(kind === 'delete' ? 'حُذف الإشعار من السجل.' : 'أُلغي الإشعار المجدول. لن يُرسل.');
    } catch (e) { notifyError(kind === 'delete' ? 'لم يُحذف الإشعار' : 'لم يُلغَ الإشعار', errorText(e)); }
    setBusy(false);
  });

  const push = history.push;
  const header = (
    <PageHeader title="إشعارات المنصة" sub="ما أرسلته المنصة وما أرسلته كل شركة لطلابها. الإشعار يظهر داخل التطبيق دائماً، وكتنبيه على الهاتف إن كانت التنبيهات مفعّلة."
      actions={<Button icon="plus" onClick={() => setParams({ new: '1' })}>إشعار جديد</Button>} phoneActions={false} />
  );
  if (history.error && !history.rows.length && !history.loading) return <Page>{header}<ErrorState card title="تعذّر تحميل الإشعارات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={history.reload} /></Page>;

  const columns: Column<G>[] = [
    { key: 'note', label: 'الإشعار', render: (g) => <Cell2 main={g.first.title} sub={g.first.body} /> },
    { key: 'from', label: 'المرسل', w: 190, render: (g) => <span className="line-clamp-2">{g.platform ? `المنصة · ${g.rows.length} ${g.rows.length > 10 ? 'شركة' : g.rows.length > 2 ? 'شركات' : g.rows.length === 2 ? 'شركتان' : 'شركة'}` : g.first.company_name}</span> },
    { key: 'state', label: 'الحالة', w: 130, render: (g) => <NoteState status={g.first.status} /> },
    { key: 'at', label: <span className="inline-flex items-center gap-1">الموعد<Icon name={sort === 'new' ? 'adown' : 'aup'} size={14} stroke={2} /></span>, w: 140, render: (g) => whenText(atOf(g.first)) },
    { key: 'to', label: 'المستلمون', w: 100, hideTablet: true, render: (g) => (g.first.status === 'sent' || g.first.status === 'failed' ? <span className="tabular">{num(g.students)}</span> : <span className="text-ink-3">—</span>) },
    { key: 'read', label: 'قرأه', w: 88, hideTablet: true, render: (g) => (g.first.status === 'sent' || g.first.status === 'failed' ? <span className="tabular">{num(g.read)}</span> : <span className="text-ink-3">—</span>) },
    { key: 'open', label: <span className="sr-only">التفاصيل</span>, w: 104, align: 'end', render: (g) => <span onClick={(e) => e.stopPropagation()} className="inline-flex"><Button sm kind="outline" onClick={() => setOpen(g.key)}>التفاصيل</Button></span> },
  ];
  const toolbar = (
    <Toolbar
      search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث في العنوان أو النص" />}
      filters={<Chips value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'الكل' }, { value: 'sent', label: 'أُرسل' }, { value: 'scheduled', label: 'مجدول' }, { value: 'failed', label: 'فشل الإرسال' }, { value: 'cancelled', label: 'أُلغي' },
      ]} />}
      sort={<SortSelect value={sort} onChange={setSort} options={[{ value: 'new', label: 'الأحدث أولاً' }, { value: 'old', label: 'الأقدم أولاً' }]} />}
      actions={(
        <Select value={companyId} onChange={setCompanyId} ariaLabel="الشركة" icon="building" minListWidth={240}
          options={[{ value: '', label: 'كل الشركات' }, ...companies.filter((c) => c.status !== 'archived').map((c) => ({ value: c.id, label: c.name }))]}
          className="inline-flex h-10 max-w-[220px] flex-none items-center gap-1.5 rounded-control px-2.5 text-label font-semibold shadow-ring hover:bg-ground sm:h-9" />
      )}
    />
  );
  const empty = groups.length === 0 && !history.loading ? (
    search || filter !== 'all' || companyId
      ? <EmptyState icon="search" title="لا إشعارات بهذا الوصف" text="جرّب كلمة أخرى، أو اعرض كل الإشعارات." action={<Button kind="secondary" onClick={() => { setSearch(''); setFilter('all'); setCompanyId(''); }}>اعرض الكل</Button>} />
      : <EmptyState icon="megaphone" title="لم يُرسل أي إشعار بعد" text="هنا يظهر كل ما ترسله المنصة وما ترسله كل شركة لطلابها، ومن قرأه."
        action={<Button icon="plus" onClick={() => setParams({ new: '1' })}>إشعار جديد</Button>} />
  ) : undefined;

  return (
    <Page>
      {header}
      <section className="flex flex-col gap-3">
        <SectionHead title="التنبيهات على الهواتف" meta={history.loading ? undefined : push?.configured ? <StatePill state="on" label="تعمل" /> : <StatePill state="off" label="غير مربوطة" />} />
        {history.loading ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
          : push?.configured === false ? (
            <Note tone="warning" title="خدمة التنبيهات غير مربوطة">الإشعارات تصل داخل التطبيق فقط ولا تظهر كتنبيه على الهاتف.</Note>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard icon="smartphone" label="هواتف مسجّلة" value={num(push?.devices)} hint={push ? `آيفون ${num(push.ios)} · أندرويد ${num(push.android)}` : undefined} />
                <StatCard icon="clock" label="تنتظر الإرسال الآن" value={num(push?.queued)} />
                <StatCard icon="check" label="سُلّمت لخدمة التنبيهات" value={num(push?.accepted_24h)} hint="آخر 24 ساعة" />
                <StatCard icon="alert" tone={(push?.failed_24h ?? 0) > 0 ? 'danger' : undefined} label="فشلت" value={num(push?.failed_24h)} hint="آخر 24 ساعة" />
              </div>
              <p className="m-0 text-label text-ink-2">«سُلّمت» تعني أن خدمة التنبيهات استلمتها لتوصلها، لا أنها ظهرت على كل هاتف.</p>
            </>
          )}
      </section>
      <section className="flex flex-col gap-3">
        <SectionHead title="سجل الإشعارات" meta={history.refreshing ? <span className="text-label text-ink-3">يُحدَّث…</span> : undefined} />
        {history.loading ? <SkeletonTable rows={8} cols={6} /> : (
          <DataTable caption="سجل الإشعارات" columns={columns} rows={rows} rowKey={(g) => g.key} onOpen={(g) => setOpen(g.key)} openKey={openId} toolbar={toolbar} empty={empty}
            pager={<Pager page={page} total={groups.length} onPage={setPage} />}
            card={(g) => ({
              title: g.first.title, sub: g.platform ? `المنصة · ${num(g.rows.length)} شركة` : g.first.company_name ?? undefined, end: <NoteState status={g.first.status} />,
              fields: [['الموعد', whenText(atOf(g.first))], ['المستلمون', g.first.status === 'sent' ? num(g.students) : '—'], ['قرأه', g.first.status === 'sent' ? num(g.read) : '—']],
            })} />
        )}
        {history.hasMore && page >= pages && <p className="m-0 text-center text-label text-ink-3">{history.loadingMore ? 'نحمّل الأقدم…' : ''}</p>}
      </section>
      <PhoneBar><Button full icon="plus" onClick={() => setParams({ new: '1' })}>إشعار جديد</Button></PhoneBar>
      <NoteDetails g={open} online={online} onClose={() => setOpen(null)} onDelete={() => setAsking('delete')} onCancel={() => setAsking('cancel')} />
      <Dialog open={!!asking && !!open} onClose={() => setAsking(null)} icon={asking === 'delete' ? 'trash' : 'x'} tone="danger"
        title={asking === 'delete' ? 'حذف الإشعار من السجل؟' : 'إلغاء الإشعار المجدول؟'}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(null)}>رجوع</Button>,
          <Button key="g" kind="danger" loading={busy} onClick={() => open && asking && act(asking, open)}>{asking === 'delete' ? 'احذف من السجل' : 'ألغِ الإرسال'}</Button>]}>
        <p className="m-0">{asking === 'delete'
          ? `يختفي «${open?.first.title}» من السجل${open && open.rows.length > 1 ? ` عند ${num(open.rows.length)} شركة` : ''} ومن صندوق إشعارات الطلاب في التطبيق. ما ظهر من قبل على هواتفهم كتنبيه لا يُسحب.`
          : `لن يُرسل «${open?.first.title}» في موعده${open && open.rows.length > 1 ? ` إلى أي من الـ${num(open.rows.length)} شركة` : ''}. يبقى في السجل بحالة «أُلغي».`}</p>
      </Dialog>
    </Page>
  );
};
