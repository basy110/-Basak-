import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AttentionList, Badge, Button, Card, DataTable, EmptyState, ErrorState, Icon, Money, Page, PageHeader, Section, SkeletonList,
  SkeletonStat, SkeletonTable, SortSelect, StatCard, Toolbar, cairo, clock, countText, dayText, num, NOUN, useOnline, type Column,
} from '../../ui';
import { useResetRequestCount } from '../../areas/Workspace';
import { useOpenCorrectionsCount } from '../../areas/PlatformArea';
import { prefetchCompanyOverview } from '../../lib/overview';
import { nOf, rideDayText, SUBSCRIBER } from '../../lib/today';
import { companiesHint, isPilingUp, platformAttention, usePlatformToday, type PlatformCompanyRow, type PlatformToday } from '../../lib/platformToday';

/** «اليوم» — the platform admin's first page (docs/canvas/AdmPlatToday, AdmPlatTodayPhone, AdmPlatTodayStates, AdmPlatTodayEmptyPhone). */
export const PlatformTodayPage: React.FC = () => {
  const { data, loading, error, updatedAt, refresh } = usePlatformToday();
  const corrections = useOpenCorrectionsCount();
  const passwordRequests = useResetRequestCount(null);
  const online = useOnline();
  const today = data?.today ?? cairo(new Date()).day;
  const first = !!data && data.companies.total === 0;
  const stale = !online && updatedAt ? updatedAt : 0;

  return (
    <Page>
      <PageHeader title="اليوم" sub={dayText(today, { weekday: true })} phoneActions={false}
        actions={(!data && error) || first ? undefined : <Button kind="outline" icon="megaphone" to="/platform/notifications" disabled={!online}>إرسال إشعار من المنصة</Button>} />
      {!data && error ? (
        <ErrorState card title="تعذّر تحميل أرقام المنصة" text="لم نستطع جلب الطلبات وأرقام الشركات. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={refresh} />
      ) : first ? (
        <FirstUse data={data!} />
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Attention data={data} loading={loading} corrections={corrections} passwordRequests={passwordRequests} stale={stale} />
            <Numbers data={data} loading={loading} />
          </div>
          {loading ? <SkeletonTable rows={6} cols={7} /> : data && <CompaniesTable data={data} />}
        </>
      )}
    </Page>
  );
};

/* ── يحتاج قرارك الآن ───────────────────────────────────────────────── */
const Attention: React.FC<{ data: PlatformToday | null; loading: boolean; corrections: number; passwordRequests: number; stale: number }> = ({ data, loading, corrections, passwordRequests, stale }) => {
  const items = useMemo(() => (data ? platformAttention(data, { corrections, passwordRequests }) : []), [data, corrections, passwordRequests]);
  return (
    <Section title="يحتاج قرارك الآن"
      meta={data && items.length > 0 ? <Badge>{countText(items.length, NOUN.item)}</Badge> : undefined}
      end={stale ? <span className="text-label text-ink-3">آخر تحديث {clock(cairo(new Date(stale)).time)}</span> : undefined}>
      {loading || !data ? <SkeletonList rows={4} />
        : <AttentionList items={items.map((a, i) => ({ ...a, primary: i === 0 }))} zeroTitle="لا شيء ينتظر قرارك" zeroSub="لا طلبات مفتوحة، وكل شركة تعمل لها خط ووسيلة دفع." />}
    </Section>
  );
};

/* ── أرقام المنصة ───────────────────────────────────────────────────── */
const STORE: Record<string, string> = { android: 'أندرويد', ios: 'آيفون' };
const Numbers: React.FC<{ data: PlatformToday | null; loading: boolean }> = ({ data, loading }) => {
  if (loading || !data) {
    return (
      <Section title="أرقام المنصة">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
      </Section>
    );
  }
  const share = data.active_subscriptions > 0 ? Math.min(100, Math.round((data.riders_next / data.active_subscriptions) * 100)) : 0;
  return (
    <Section title="أرقام المنصة">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <StatCard label="الشركات" icon="building" to="/platform/companies" value={num(data.companies.total)} hint={companiesHint(data.companies)} />
        <StatCard label="الطلاب" icon="users" to="/platform/students" value={num(data.students)} hint="حساباً على المنصة" />
        <StatCard label="اشتراكات نشطة" icon="check" value={num(data.active_subscriptions)} hint="في كل الشركات اليوم" />
        <StatCard label="إيصالات تنتظر" icon="receipt" value={num(data.pending_receipts)}
          hint={data.receipt_companies === 0 ? 'لا شيء ينتظر' : data.receipt_companies === 1 ? 'عند شركة واحدة' : `عند ${countText(data.receipt_companies, NOUN.company)}`} />
        <StatCard className="col-span-2" label={`ركاب الغد · ${rideDayText(data.next_ride_date)}`} icon="bus" value={num(data.riders_next)} bar={share}
          unit={`راكباً من ${nOf(data.active_subscriptions, SUBSCRIBER)}`}
          hint={`التأكيد مفتوح عند أغلب الشركات حتى ${clock(data.vote_closes_at ?? '06:00')} · الأعداد تتغيّر`} />
        {data.app_versions.length > 0 && (
          <Card className="col-span-2 flex flex-col gap-3 px-4 py-3.5 sm:px-5 sm:py-[18px]">
            <div className="flex items-center gap-2 text-label font-medium text-ink-2">
              <Icon name="smartphone" size={16} stroke={2} className="text-ink-3" /><span className="flex-1">إصدارات التطبيق</span>
              <Button kind="link" sm iconEnd="fwd" to="/platform/app-versions" className="!h-7 font-semibold">غيّرها</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {data.app_versions.map((v) => (
                <div key={v.platform} className="flex flex-col rounded-control bg-ground px-3 py-2">
                  <span className="text-cap text-ink-3">{STORE[v.platform] ?? v.platform}</span>
                  <span className="text-small font-semibold">آخر إصدار <span dir="ltr" className="tabular">{v.latest_version}</span></span>
                  <span className="text-cap text-ink-2">أقل إصدار مسموح <span dir="ltr" className="tabular">{v.min_version}</span></span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Section>
  );
};

/* ── اليوم في كل شركة ───────────────────────────────────────────────── */
type Sort = 'receipts' | 'students' | 'riders' | 'revenue';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'receipts', label: 'الأكثر إيصالات منتظرة أولاً' }, { value: 'students', label: 'الأكثر طلاباً أولاً' },
  { value: 'riders', label: 'الأكثر ركاباً أولاً' }, { value: 'revenue', label: 'الأعلى إيرادات أولاً' },
];
const SORT_KEY: Record<Sort, (r: PlatformCompanyRow) => number> = {
  receipts: (r) => r.pending_receipts, students: (r) => r.members, riders: (r) => r.riders_next, revenue: (r) => Number(r.revenue),
};
const TOP = 12;
const TOP_PHONE = 6;

const Lines: React.FC<{ r: PlatformCompanyRow }> = ({ r }) => <span className="whitespace-nowrap tabular">{num(r.active_lines)} <span className="text-label text-ink-3">من {num(r.lines)}</span></span>;
const Receipts: React.FC<{ r: PlatformCompanyRow }> = ({ r }) => (
  <span className="inline-flex items-center gap-2"><span className="font-semibold tabular">{num(r.pending_receipts)}</span>{isPilingUp(r) && <Badge tone="warning">متراكمة</Badge>}</span>
);

const CompaniesTable: React.FC<{ data: PlatformToday }> = ({ data }) => {
  const navigate = useNavigate();
  const [sort, setSort] = useState<Sort>('receipts');
  const working = useMemo(() => data.per_company.filter((r) => r.company.status === 'active'), [data.per_company]);
  const rows = useMemo(() => [...working].sort((a, b) => SORT_KEY[sort](b) - SORT_KEY[sort](a) || b.members - a.members || a.company.name.localeCompare(b.company.name, 'ar')), [working, sort]);
  const shown = rows.slice(0, TOP);
  const sorted = (label: string, on: boolean) => (on ? <span className="inline-flex items-center gap-1">{label}<Icon name="adown" size={13} stroke={2} /></span> : label);
  const enter = (r: PlatformCompanyRow) => `/c/${r.company.id}`;
  const columns: Column<PlatformCompanyRow>[] = [
    { key: 'name', label: 'الشركة', render: (r) => <span className="block truncate font-medium" onMouseEnter={() => void prefetchCompanyOverview(r.company.id)}>{r.company.name}</span> },
    { key: 'students', label: sorted('الطلاب', sort === 'students'), w: 96, render: (r) => <span className="tabular">{num(r.members)}</span> },
    { key: 'subs', label: 'اشتراكات نشطة', w: 128, hideTablet: true, render: (r) => <span className="tabular">{num(r.active_subscriptions)}</span> },
    { key: 'riders', label: sorted('ركاب الغد', sort === 'riders'), w: 104, render: (r) => <span className="font-semibold tabular">{num(r.riders_next)}</span> },
    { key: 'receipts', label: sorted('إيصالات تنتظر', sort === 'receipts'), w: 150, render: (r) => <Receipts r={r} /> },
    { key: 'lines', label: 'خطوط تعمل', w: 120, hideTablet: true, render: (r) => <Lines r={r} /> },
    { key: 'revenue', label: sorted('الإيرادات المسجّلة', sort === 'revenue'), w: 156, hideTablet: true, render: (r) => <Money value={Number(r.revenue)} /> },
    { key: 'go', label: <span className="sr-only">دخول</span>, w: 108, align: 'end', render: (r) => <Button kind="tonal" sm iconEnd="fwd" to={enter(r)} onClick={(e) => e.stopPropagation()}>ادخل</Button> },
  ];
  const count = rows.length > TOP
    ? `أعلى ${num(TOP)} شركة من ${num(rows.length)} تعمل · اضغط شركة لتدخل لوحتها`
    : `${countText(rows.length, NOUN.company)} ${rows.length > 2 ? 'تعمل' : rows.length === 2 ? 'تعملان' : 'تعمل'} · اضغط شركة لتدخل لوحتها`;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-7 flex-wrap items-center gap-3 sm:min-h-9">
        <h2 className="m-0 text-card sm:text-section">اليوم في كل شركة</h2>
        {rows.length > TOP_PHONE && <span className="text-label text-ink-2 sm:hidden">أعلى {num(TOP_PHONE)} من {num(rows.length)}</span>}
        <span className="flex-1" />
        <span className="hidden sm:inline-flex"><Button kind="link" sm iconEnd="fwd" to="/platform/companies">كل الشركات</Button></span>
      </div>
      {rows.length === 0 ? (
        <EmptyState card icon="building" title="لا شركة تعمل الآن" text="كل الشركات موقوفة. افتح صفحة الشركات لتفعيل إحداها." action={<Button kind="secondary" to="/platform/companies">افتح الشركات</Button>} />
      ) : (
        <>
          <div className="hidden sm:block">
            <DataTable<PlatformCompanyRow>
              caption="أرقام اليوم في كل شركة" columns={columns} rows={shown} rowKey={(r) => r.company.id} onOpen={(r) => navigate(enter(r))}
              toolbar={<Toolbar count={count} sort={<SortSelect value={sort} onChange={setSort} options={SORTS} />} />}
              foot={{ name: 'إجمالي كل الشركات', students: num(data.students), subs: num(data.active_subscriptions), riders: num(data.riders_next), receipts: num(data.pending_receipts), revenue: <Money value={data.revenue} /> }}
              card={() => ({ title: '' })} />
          </div>
          <div className="flex flex-col gap-3 sm:hidden">
            <DataTable<PlatformCompanyRow>
              columns={columns} rows={rows.slice(0, TOP_PHONE)} rowKey={(r) => r.company.id} onOpen={(r) => navigate(enter(r))}
              card={(r) => ({
                title: r.company.name,
                sub: `${nOf(r.members, NOUN.student)} · ${nOf(r.active_subscriptions, ['اشتراك نشط', 'اشتراكان نشطان', 'اشتراكات نشطة', 'اشتراكاً نشطاً'])}`,
                end: <Icon name="fwd" size={18} className="mt-1 text-ink-3" />,
                stats: [['ركاب الغد', num(r.riders_next)], ['إيصالات تنتظر', num(r.pending_receipts)]],
                fields: [['خطوط تعمل', <Lines key="l" r={r} />], ['الإيرادات المسجّلة', <Money key="m" value={Number(r.revenue)} />]],
              })} />
            <Button kind="outline" full iconEnd="fwd" to="/platform/companies">كل الشركات ({num(data.companies.total)})</Button>
          </div>
        </>
      )}
    </section>
  );
};

/* ── A new platform: the two things to do, in order ─────────────────── */
const FirstUse: React.FC<{ data: PlatformToday }> = ({ data }) => {
  const needUniversities = data.universities === 0;
  const items = [
    ...(needUniversities ? [{ key: 'uni', icon: 'school' as const, tone: 'teal' as const, title: 'أضف الجامعات أولاً', sub: 'لا تستطيع أي شركة أن تنشئ خطاً قبل أن توجد جامعته هنا', action: 'افتح الجامعات', to: '/platform/universities' }] : []),
    { key: 'company', icon: 'building' as const, tone: 'teal' as const, title: needUniversities ? 'ثم أنشئ أول شركة' : 'أنشئ أول شركة', sub: 'باسمها ومديرها الأول، وهو يكمل الخطوط ووسائل الدفع', action: 'شركة جديدة', to: '/platform/companies/new' },
  ].map((a, i) => ({ ...a, primary: i === 0 }));
  return (
    <>
      <div className="sm:hidden">
        <EmptyState card icon="building" title="لا شركات بعد" text="أضف الجامعات، ثم أنشئ أول شركة باسمها ومديرها الأول. بعدها ترى هنا ما يحتاج قرارك وأرقام كل شركة."
          action={<><Button icon="plus" full to="/platform/companies/new">شركة جديدة</Button><Button kind="secondary" full to="/platform/universities">افتح الجامعات</Button></>} />
      </div>
      <div className="hidden grid-cols-1 items-start gap-6 sm:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Section title="يحتاج قرارك الآن"><AttentionList items={items} /></Section>
        <Section title="أرقام المنصة">
          <EmptyState card icon="chart" title="لا أرقام بعد" text="عندما تعمل أول شركة ويشترك طلابها، ترى هنا عدد الطلاب والاشتراكات وركاب الغد في كل الشركات." />
        </Section>
      </div>
    </>
  );
};
