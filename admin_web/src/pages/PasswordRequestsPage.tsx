import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge, Button, Cell2, Chips, DataTable, EmptyState, ErrorState, IconButton, Ltr, Menu, Note, Page, PageHeader, Pager, Pill, SearchBox,
  SkeletonTable, SortSelect, Toolbar, countText, NOUN, phoneText, useOnline, agoText, cairo, type Column,
} from '../ui';
import { useCompany } from '../lib/adminScope';
import { cairoToday } from '../lib/time';
import { useGuard } from '../lib/guard';
import { notify } from '../lib/toasts';
import { canAct, isOpenReset, requestedText, resetState, useResetRequests, type IssuedCode, type ResetRequest } from '../lib/passwordRequests';
import { CancelDialog, CodeDialog, VerifyDialog } from '../components/receipts/PasswordDialogs';

type View = 'company' | 'platform';
const isToday = (iso: string, now: Date) => cairo(iso).day === cairoToday(now);
const PAGE = 25;
const SUB = 'طالب نسي كلمة المرور وطلب المساعدة من التطبيق. اتصل به لتتأكد أنه هو، ثم أعطه رمزاً يكتبه في التطبيق مع كلمة مرور جديدة.';
const SUB_PHONE = 'اتصل بالطالب لتتأكد أنه هو، ثم أعطه رمزاً يكتبه في التطبيق مع كلمة مرور جديدة.';
const PLATFORM_SUB = 'طلاب كل الشركات، ومعهم من لا شركة له. اتصل بالطالب لتتأكد أنه هو، ثم أعطه رمزاً يدخل به مرة واحدة ويختار كلمة مرور جديدة.';

/** «طلبات كلمة المرور» of one company: its members' requests. */
export const PasswordRequestsPage: React.FC = () => {
  const company = useCompany();
  return <RequestsView companyId={company.id} view="company" />;
};

/** «طلبات كلمة المرور» of the platform: every company's students, and those with no company. */
export const PlatformPasswordRequestsPage: React.FC = () => <RequestsView companyId={null} view="platform" />;

const TINTS = ['bg-ok-bg text-ok', 'bg-teal-tint text-teal', 'bg-warn-bg text-warn', 'bg-sunken text-ink-2'];
const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span aria-hidden="true" className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-small font-semibold ${TINTS[(name.charCodeAt(0) + name.length) % TINTS.length]}`}>{name.trim().charAt(0)}</span>
);

const RequestsView: React.FC<{ companyId: string | null; view: View }> = ({ companyId, view }) => {
  const data = useResetRequests(companyId);
  const online = useOnline();
  const guard = useGuard();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(t); }, []);

  const [filter, setFilter] = useState<'open' | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'new' | 'old'>('new');
  const [page, setPage] = useState(1);
  const [verifying, setVerifying] = useState<ResetRequest | null>(null);
  const [cancelling, setCancelling] = useState<ResetRequest | null>(null);
  const [issued, setIssued] = useState<{ request: ResetRequest; code: IssuedCode } | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data.requests;
  const open = useMemo(() => all.filter((r) => canAct(r, now)), [all, now]);
  const waiting = all.filter((r) => isOpenReset(r) && canAct(r, now)).length;
  const rows = useMemo(() => {
    const term = search.trim();
    const digits = term.replace(/\D/g, '');
    const list = (filter === 'open' ? open : all).filter((r) => !term || r.student_name.includes(term) || (digits.length >= 3 && r.student_phone.includes(digits)));
    // Open requests first, as the server orders them; then by the chosen time order.
    if (view === 'platform') return [...list].sort((a, b) => Number(canAct(b, now)) - Number(canAct(a, now)) || (sort === 'new' ? 1 : -1) * b.requested_at.localeCompare(a.requested_at));
    return list;
  }, [all, open, filter, search, sort, view, now]);
  useEffect(() => { setPage(1); }, [filter, search, sort]);
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  const issue = (request: ResetRequest) => guard(`issue:${request.id}`, async () => {
    setBusy(true);
    try {
      const code = await data.issue(request);
      setVerifying(null);
      setIssued({ request, code });
    } catch (error) {
      setVerifying(null);
      const text = error instanceof Error ? error.message : '';
      const generic = !text.startsWith('لم يُصدر');
      notify({ title: generic ? 'تعذّر إصدار الرمز. لم يتغيّر شيء في حساب الطالب.' : text, tone: 'error',
        ...(generic ? { action: { label: 'حاول مرة أخرى', run: () => setVerifying(request) } } : {}) }, 12_000);
    } finally { setBusy(false); }
  });
  const cancel = (request: ResetRequest) => guard(`cancel:${request.id}`, async () => {
    setBusy(true);
    try {
      await data.cancel(request);
      setCancelling(null);
    } catch {
      setCancelling(null);
      notify({ title: 'تعذّر إلغاء الطلب. لم يتغيّر شيء؛ ما تراه الآن هو حالته الحالية.', tone: 'error' }, 12_000);
    } finally { setBusy(false); }
  });

  const firstName = (r: ResetRequest) => r.student_name;
  const state = (r: ResetRequest) => {
    const s = resetState(r, view, now);
    return (
      <div className="flex flex-col items-start gap-1">
        <Pill tone={s.tone}>{s.text}</Pill>
        {view === 'company' && r.status === 'code_issued' && canAct(r, now) && r.failed_attempts > 0 && (
          <span className="text-cap text-ink-2">أخطأ في كتابته {r.failed_attempts} من 5</span>
        )}
      </div>
    );
  };
  const mainAction = (r: ResetRequest, phone = false) => {
    if (!canAct(r, now)) return null;
    const fresh = r.status === 'code_issued';
    const label = fresh ? 'رمز جديد' : view === 'company' ? 'أعطه رمزاً' : 'أصدر رمزاً';
    return (
      <Button sm={!phone} kind={fresh ? 'tonal' : 'primary'} icon={view === 'company' || !fresh ? (fresh ? 'refresh' : 'key') : undefined} disabled={!online}
        className={phone ? 'min-w-0 !flex-1' : ''} onClick={(e) => { e.stopPropagation(); setVerifying(r); }}>{label}</Button>
    );
  };
  const more = (r: ResetRequest) => (canAct(r, now) ? (
    <Menu items={[
      { label: 'اتصل بالطالب', icon: 'phone', onClick: () => { window.location.href = `tel:${r.student_phone}`; } },
      { label: 'إلغاء الطلب', icon: 'x', danger: true, onClick: () => setCancelling(r) },
    ]} />
  ) : null);

  const companyColumns: Column<ResetRequest>[] = [
    { key: 'student', label: 'الطالب', render: (r) => <div className="flex items-center gap-3"><Avatar name={r.student_name} /><Cell2 main={<span className="font-semibold">{firstName(r)}</span>} sub={<Ltr>{phoneText(r.student_phone)}</Ltr>} /></div> },
    { key: 'when', label: 'طلب المساعدة', w: 190, render: (r) => <Cell2 strong={false} main={requestedText(r.requested_at, now)} sub={isToday(r.requested_at, now) ? agoText(r.requested_at, now) : undefined} /> },
    { key: 'state', label: 'الحالة', w: 230, render: state },
    { key: 'act', label: <span className="sr-only">إجراءات</span>, w: 200, align: 'end', render: (r) => <div className="flex items-center justify-end gap-2">{mainAction(r)}{more(r)}</div> },
  ];
  const platformColumns: Column<ResetRequest>[] = [
    { key: 'student', label: 'الطالب', render: (r) => <Cell2 main={<span className="font-semibold">{r.student_name}</span>} sub={<Ltr>{phoneText(r.student_phone)}</Ltr>} /> },
    { key: 'company', label: 'شركته', w: 220, render: (r) => companyCell(r) },
    { key: 'when', label: <span className="inline-flex items-center gap-1">وقت الطلب<span aria-hidden="true">{sort === 'new' ? '↓' : '↑'}</span></span>, w: 170, render: (r) => requestedText(r.requested_at, now, ' ') },
    { key: 'state', label: 'الحالة', w: 200, render: state },
    { key: 'act', label: <span className="sr-only">إجراءات</span>, w: 170, align: 'end', render: (r) => (
      <div className="flex items-center justify-end gap-1.5">{mainAction(r)}{canAct(r, now) && <IconButton sm icon="x" label={`إلغاء طلب ${r.student_name}`} disabled={!online} onClick={(e) => { e.stopPropagation(); setCancelling(r); }} />}</div>
    ) },
  ];

  const companyCell = (r: ResetRequest) => {
    if (r.companies === undefined || r.companies === null) return <span className="text-ink-3">—</span>;
    if (!r.companies.length) return <Badge tone="warning">بلا شركة</Badge>;
    return <span className="truncate">{r.companies.join('، ')}</span>;
  };

  const card = (r: ResetRequest) => view === 'company' ? ({
    title: r.student_name,
    sub: <Ltr>{phoneText(r.student_phone)}</Ltr>,
    fields: [
      ['طلب المساعدة', <span className="font-semibold">{requestedText(r.requested_at, now)}{isToday(r.requested_at, now) ? ` · ${agoText(r.requested_at, now)}` : ''}</span>],
      ['الحالة', <span className="inline-flex flex-col items-end">{state(r)}</span>],
    ] as [React.ReactNode, React.ReactNode][],
    actions: canAct(r, now) ? <>{mainAction(r, true)}<span className="[&_button]:!h-12 [&_button]:!w-12 [&_button]:bg-sunken">{more(r)}</span></> : undefined,
  }) : ({
    title: r.student_name,
    sub: <Ltr>{phoneText(r.student_phone)}</Ltr>,
    end: <Pill tone={resetState(r, view, now).tone}>{resetState(r, view, now).text}</Pill>,
    fields: [['شركته', companyCell(r)], ['وقت الطلب', <span className="font-semibold">{requestedText(r.requested_at, now, ' ')}</span>]] as [React.ReactNode, React.ReactNode][],
    actions: canAct(r, now) ? <>{mainAction(r, true)}{r.status === 'pending' && <Button kind="secondary" disabled={!online} onClick={() => setCancelling(r)}>ألغِ الطلب</Button>}</> : undefined,
  });

  const header = (
    <PageHeader title="طلبات كلمة المرور"
      meta={view === 'company' && !data.loading && !data.error ? <span className="hidden sm:inline-flex"><Badge tone={waiting ? 'warning' : 'success'}>{waiting === 1 ? '1 ينتظر' : `${waiting} تنتظر`}</Badge></span> : undefined}
      sub={view === 'company' ? <><span className="sm:hidden">{SUB_PHONE}</span><span className="hidden sm:inline">{SUB}</span></> : PLATFORM_SUB} />
  );
  const rule = view === 'company' && (
    <Note tone="teal" title="الرمز يصلح 30 دقيقة ولمرة واحدة">للطالب 5 محاولات لكتابته. لا تظهر كلمات المرور هنا أبداً، ولا يستطيع أحد غير الطالب أن يختار كلمته الجديدة.</Note>
  );

  if (data.loading) return <Page>{header}{rule}<SkeletonTable rows={6} cols={4} /></Page>;
  if (data.error && all.length === 0) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل الطلبات" text={view === 'company' ? 'لم نستطع جلب طلبات كلمة المرور. تأكد من اتصالك ثم حاول مرة أخرى.' : 'تأكد من اتصالك ثم حاول مرة أخرى.'} onRetry={() => void data.reload()} /></Page>;
  }
  if (all.length === 0 && view === 'company') {
    return (
      <Page>{header}
        <EmptyState card icon="key" title="لا طلبات الآن" text="عندما ينسى طالب كلمة المرور ويضغط «نسيت كلمة المرور» في التطبيق يظهر طلبه هنا، ويظهر عدده بجانب «طلبات كلمة المرور» في القائمة." />
      </Page>
    );
  }

  const chips = (
    <Chips value={filter} onChange={setFilter}
      options={view === 'company'
        ? [{ value: 'open', label: 'تنتظرك', count: open.length }, { value: 'all', label: 'كل الطلبات', count: all.length }]
        : [{ value: 'open', label: 'مفتوحة', count: open.length }, { value: 'all', label: 'كل الطلبات', count: all.length }]} />
  );
  const countLine = view === 'company'
    ? (rows.length === 1 ? 'طلب واحد' : `${countText(rows.length, NOUN.request)} · الأحدث أولاً`)
    : `${countText(rows.length, NOUN.request)} في آخر 30 يوماً`;
  const empty = rows.length === 0 ? (
    filter === 'open' || all.length === 0
      ? <EmptyState icon={view === 'company' ? 'check' : 'key'} title="لا أحد ينتظر رمزاً"
          text={view === 'company' ? 'أجبت كل الطلبات. الطلبات السابقة تجدها في «كل الطلبات».' : 'عندما يضغط طالب «نسيت كلمة المرور» في التطبيق يظهر طلبه هنا، وعند مدير شركته إن كانت له شركة.'} />
      : <EmptyState icon="search" title="لا نتيجة للبحث" text="لا طلب بهذا الاسم أو الرقم في آخر 30 يوماً." action={<Button kind="secondary" onClick={() => setSearch('')}>امسح البحث</Button>} />
  ) : undefined;

  return (
    <Page>
      {header}
      {rule}
      <DataTable<ResetRequest>
        caption="طلبات كلمة المرور"
        columns={view === 'company' ? companyColumns : platformColumns}
        rows={shown} rowKey={(r) => r.id} card={card} empty={empty} rowH={view === 'company' ? 58 : 57}
        toolbar={view === 'company' ? (
          <Toolbar filters={chips}
            count={rows.length ? <span>{countLine}</span> : null}
            actions={<IconButton icon="refresh" label="تحديث القائمة" onClick={() => void data.reload()} className="hidden sm:inline-flex" />} />
        ) : (
          <Toolbar search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث بالاسم أو رقم الهاتف" className="!bg-ground" />}
            filters={chips}
            actions={rows.length ? (
              <div className="hidden items-center gap-3 sm:flex">
                <span className="whitespace-nowrap text-label text-ink-2">{countLine}</span>
                <SortSelect value={sort} onChange={setSort} options={[{ value: 'new', label: 'الأحدث أولاً' }, { value: 'old', label: 'الأقدم أولاً' }]} />
              </div>
            ) : null} />
        )}
        pager={<Pager page={page} total={rows.length} onPage={setPage} />} />

      <VerifyDialog request={verifying} view={view} busy={busy} disabled={!online} onClose={() => setVerifying(null)} onIssue={() => verifying && void issue(verifying)} />
      <CodeDialog issued={issued} view={view} onClose={() => setIssued(null)} />
      <CancelDialog request={cancelling} view={view} busy={busy} disabled={!online} onClose={() => setCancelling(null)} onCancel={() => cancelling && void cancel(cancelling)} />
    </Page>
  );
};
