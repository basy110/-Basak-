import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Cell2, Chips, DataTable, Dialog, EmptyState, ErrorState, FieldRow, Menu, Money, MoneyField, Note, Page, PageHeader, Pager,
  PhoneBar, Pill, SearchBox, Section, SelectField, SidePanel, SkeletonStat, SkeletonTable, StatCard, TextArea, TextField, Toggle, Toolbar,
  agoText, countText, dayText, errorText, momentText, moneyText, num, rangeText, useOnline, type Column,
} from '../../ui';
import { ExportButton } from '../../ui/Transfer';
import { LineChart } from '../../ui/Chart';
import { exportSheet } from '../../lib/excel';
import { MONEY_FORMAT } from '../../lib/excelCells';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import { addDays } from '../../lib/time';
import {
  CATEGORIES, CATEGORY_LABEL, CHARGE_STATUS_LABEL, CYCLE_LABEL, CYCLE_PERIOD, billingKey, companyDues, deleteExpense, expenseErrors,
  firstOf, generateCharges, isOverdue, monthText, monthlyFee, mrrOf, planErrors, pnlRows, saveExpense, savePlan, setChargeStatus, usePlatformBilling,
  type BillingCompany, type Charge, type ChargeStatus, type Cycle, type Expense, type ExpenseCategory, type PlatformBilling, type PnlRow,
} from '../../lib/platformFinance';
import { CompanyState } from '../../components/platform/CompanyPanel';
import { Panel } from '../../components/analytics/Bars';

const PAGE = 25;
type Tab = 'plans' | 'charges' | 'expenses' | 'pnl';
const TABS: { value: Tab; label: string }[] = [
  { value: 'plans', label: 'اشتراكات الشركات' }, { value: 'charges', label: 'الفواتير' },
  { value: 'expenses', label: 'تكاليف التشغيل' }, { value: 'pnl', label: 'الأرباح شهرياً' },
];
const planText = (fee: number, cycle: Cycle) => `${moneyText(Number(fee))} ${CYCLE_LABEL[cycle]}`;

/**
 * «الحسابات»: what each company pays the platform (its plan and the history of
 * changes), the bills made from it and whether each was paid, what running the
 * platform costs, and the profit month by month. Platform admin only.
 */
export const PlatformBillingPage: React.FC = () => {
  const page = usePlatformBilling();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'plans') as Tab;
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); if (t === 'plans') n.delete('tab'); else n.set('tab', t); n.delete('company'); return n; }, { replace: true });

  const header = <PageHeader title="الحسابات" sub="ما تدفعه كل شركة للمنصة وفواتيرها، وتكاليف تشغيل المنصة، والربح شهراً بشهر." />;
  const tabs = <Tabs value={tab} onChange={setTab} />;

  if (page.loading) return <Page>{header}<div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">{[0, 1, 2, 3].map((i) => <SkeletonStat key={i} />)}</div>{tabs}<SkeletonTable rows={6} cols={6} /></Page>;
  if (page.error && !page.data) return <Page>{header}<ErrorState card title="تعذّر تحميل الحسابات" text="تأكد من اتصالك ثم حاول مرة أخرى. لم يتغيّر شيء." onRetry={() => void page.reload()} /></Page>;
  if (!page.data) {
    return <Page>{header}<EmptyState card icon="card" title="الحسابات غير متاحة بعد" text="تظهر هنا بعد تحديث النظام القادم. باقي اللوحة يعمل كالمعتاد." /></Page>;
  }
  const d = page.data;
  return (
    <Page>
      {header}
      <Totals data={d} />
      {tabs}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-5 sm:gap-6">
        {tab === 'plans' && <Plans data={d} reload={page.reload} />}
        {tab === 'charges' && <Charges data={d} reload={page.reload} />}
        {tab === 'expenses' && <Expenses data={d} />}
        {tab === 'pnl' && <Pnl data={d} />}
      </div>
    </Page>
  );
};
export default PlatformBillingPage;

const Tabs: React.FC<{ value: Tab; onChange: (t: Tab) => void }> = ({ value, onChange }) => {
  const move = (dir: 1 | -1) => {
    const i = TABS.findIndex((t) => t.value === value);
    const next = TABS[(i + dir + TABS.length) % TABS.length].value;
    onChange(next); document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="الحسابات" className="no-scrollbar -mx-4 flex overflow-x-auto border-b border-hair px-4 sm:mx-0 sm:px-0">
      {TABS.map((t) => (
        <button key={t.value} role="tab" type="button" id={`tab-${t.value}`} aria-selected={value === t.value} aria-controls={`panel-${t.value}`}
          tabIndex={value === t.value ? 0 : -1} onClick={() => onChange(t.value)}
          // RTL: the arrow to the left moves forward.
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') move(1); else if (e.key === 'ArrowRight') move(-1); }}
          className={`-mb-px flex h-12 flex-none items-center whitespace-nowrap border-b-2 px-4 text-small ${value === t.value ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
};

/** The cache's copy of the page, changed in place after a write. */
function usePatch() {
  const client = useQueryClient();
  return (fn: (d: PlatformBilling) => PlatformBilling) => client.setQueryData<PlatformBilling | null>(billingKey, (d) => (d ? fn(d) : d));
}

// ──────────────────────────────────────────────────────────────── totals ────

const Totals: React.FC<{ data: PlatformBilling }> = ({ data }) => {
  const today = data.today;
  const due = data.charges.filter((c) => c.status === 'due' && c.period_start <= today);
  const outstanding = due.reduce((t, c) => t + Number(c.amount), 0);
  const overdue = due.filter((c) => isOverdue(c, today, data.grace_days));
  const month = today.slice(0, 7);
  const costs = data.expenses.filter((e) => e.month.slice(0, 7) === month).reduce((t, e) => t + Number(e.amount), 0);
  const withPlan = data.companies.filter((c) => c.plan && c.status === 'active').length;
  const active = data.companies.filter((c) => c.status === 'active').length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">
      <StatCard label="الدخل الشهري المتكرر" value={num(mrrOf(data.companies, today))} unit="ج.م" hint={`${num(withPlan)} من ${countText(active, ['شركة تعمل', 'شركتين تعملان', 'شركات تعمل', 'شركة تعمل'])} لها اشتراك`} />
      <StatCard label="المستحق" value={num(outstanding)} unit="ج.م" hint={due.length ? countText(due.length, ['فاتورة', 'فاتورتان', 'فواتير', 'فاتورة']) : 'لا فواتير مستحقة'} />
      <StatCard label="المتأخر" value={num(overdue.reduce((t, c) => t + Number(c.amount), 0))} unit="ج.م" hint={`بعد ${countText(data.grace_days, ['يوم', 'يومين', 'أيام', 'يوماً'])} من بداية الفترة`} />
      <StatCard label={`تكاليف ${monthText(month, false)}`} value={num(costs)} unit="ج.م" hint="تكاليف التشغيل المسجلة لهذا الشهر" />
    </div>
  );
};

// ───────────────────────────────────────────────────────────────── plans ────

interface CompanyRow extends BillingCompany { due: ReturnType<typeof companyDues> }

const Plans: React.FC<{ data: PlatformBilling; reload: () => Promise<void> }> = ({ data, reload }) => {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search]);
  const rows: CompanyRow[] = useMemo(() => data.companies.map((c) => ({ ...c, due: companyDues(data.charges, c.id, data.today, data.grace_days) })), [data]);
  const shown = rows.filter((c) => !search.trim() || c.name.includes(search.trim()));
  const openId = params.get('company');
  const open = rows.find((c) => c.id === openId) ?? null;
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('company', id); else n.delete('company'); return n; }, { replace: !id });
  const noPlan = rows.filter((c) => c.status === 'active' && !c.plan).length;

  const columns: Column<CompanyRow>[] = [
    { key: 'name', label: 'الشركة', w: 220, render: (c) => <Cell2 main={c.name} sub={c.status !== 'active' ? undefined : c.plan?.note ?? undefined} /> },
    { key: 'status', label: 'الحالة', w: 110, hideTablet: true, render: (c) => <CompanyState status={c.status} /> },
    { key: 'plan', label: 'الاشتراك الحالي', w: 190, render: (c) => (c.plan ? <span className="font-medium">{planText(c.plan.fee_amount, c.plan.cycle)}</span> : <span className="text-label text-warn">بلا اشتراك</span>) },
    { key: 'from', label: 'منذ', w: 130, render: (c) => (c.plan ? dayText(c.plan.starts_on) : '—') },
    { key: 'monthly', label: 'في الشهر', w: 110, align: 'end', hideTablet: true, render: (c) => (c.plan ? <Money value={monthlyFee(Number(c.plan.fee_amount), c.plan.cycle)} /> : '—') },
    { key: 'due', label: 'المستحق', w: 120, align: 'end', render: (c) => (c.due.outstanding ? <span className={c.due.overdue ? 'font-semibold text-bad' : ''}><Money value={c.due.outstanding} /></span> : <span className="text-ink-3">—</span>) },
    { key: 'act', label: <span className="sr-only">تعديل</span>, w: 140, align: 'end', render: (c) => (
      <span onClick={(e) => e.stopPropagation()} className="inline-flex"><Button sm kind="tonal" onClick={() => setOpen(c.id)}>{c.plan ? 'تعديل الاشتراك' : 'حدّد الاشتراك'}</Button></span>
    ) },
  ];
  const card = (c: CompanyRow) => ({
    title: c.name, sub: c.plan ? `${planText(c.plan.fee_amount, c.plan.cycle)} · منذ ${dayText(c.plan.starts_on)}` : 'بلا اشتراك للمنصة',
    end: c.status !== 'active' ? <CompanyState status={c.status} /> : undefined,
    fields: [['المستحق', c.due.outstanding ? <Money key="d" value={c.due.outstanding} /> : '—']] as [React.ReactNode, React.ReactNode][],
  });
  const exportRows = () => exportSheet<CompanyRow>({
    name: 'اشتراكات الشركات', rows: shown, columns: [
      { label: 'الشركة', value: (c) => c.name, width: 28 }, { label: 'الحالة', value: (c) => ({ active: 'تعمل', suspended: 'موقوفة', archived: 'مؤرشفة' }[c.status]) },
      { label: 'المبلغ (ج.م)', value: (c) => (c.plan ? Number(c.plan.fee_amount) : null), format: MONEY_FORMAT, width: 14 },
      { label: 'الدورة', value: (c) => (c.plan ? CYCLE_LABEL[c.plan.cycle] : null), width: 14 }, { label: 'منذ', value: (c) => c.plan?.starts_on ?? null, width: 14 },
      { label: 'في الشهر (ج.م)', value: (c) => (c.plan ? Math.round(monthlyFee(Number(c.plan.fee_amount), c.plan.cycle)) : null), format: MONEY_FORMAT, width: 14 },
      { label: 'المستحق (ج.م)', value: (c) => c.due.outstanding, format: MONEY_FORMAT, width: 14 },
    ],
  });

  return (
    <>
      {noPlan > 0 && <Note tone="warning" title={`${countText(noPlan, ['شركة تعمل', 'شركتان تعملان', 'شركات تعمل', 'شركة تعمل'])} بلا اشتراك للمنصة`}>لا تصدر لها فواتير حتى تحدّد ما تدفعه وكل كم.</Note>}
      <DataTable<CompanyRow> id="platform-billing-plans" columns={columns} rows={shown.slice((page - 1) * PAGE, page * PAGE)} rowKey={(c) => c.id} card={card}
        onOpen={(c) => setOpen(c.id)} openKey={openId} caption="اشتراكات الشركات في المنصة" muted={(c) => c.status !== 'active'}
        toolbar={<Toolbar search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الشركة" />}
          count={<span>{countText(shown.length, ['شركة', 'شركتان', 'شركات', 'شركة'])}</span>}
          actions={<ExportButton count={shown.length} className="hidden sm:inline-flex" onExport={exportRows} />} />}
        empty={rows.length === 0 ? <EmptyState icon="building" title="لا شركات بعد" text="حين تضيف شركة تحدّد هنا ما تدفعه للمنصة." action={<Button kind="secondary" iconEnd="fwd" to="/platform/companies/new">شركة جديدة</Button>} />
          : shown.length === 0 ? <EmptyState icon="search" title="لا شركة بهذا الاسم" action={<Button kind="secondary" onClick={() => setSearch('')}>امسح البحث</Button>} /> : undefined}
        pager={shown.length > PAGE ? <Pager page={page} total={shown.length} onPage={setPage} /> : undefined} />
      {open && <PlanPanel key={open.id} company={open} data={data} onClose={() => setOpen(null)} reload={reload} />}
    </>
  );
};

const PlanPanel: React.FC<{ company: CompanyRow; data: PlatformBilling; onClose: () => void; reload: () => Promise<void> }> = ({ company, data, onClose, reload }) => {
  const guard = useGuard();
  const online = useOnline();
  const current = company.plan;
  const [fee, setFee] = useState<number | ''>('');
  const [cycle, setCycle] = useState<Cycle | ''>(current?.cycle ?? '');
  const [startsOn, setStartsOn] = useState(current ? '' : data.today);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = planErrors({ fee, cycle, startsOn }, current);
  const shownErrors = tried ? errors : {};
  const history = data.plans.filter((p) => p.company_id === company.id);

  const save = () => void guard('plan', async () => {
    if (fee === '' || !cycle) return;
    setBusy(true);
    const { error } = await savePlan(company.id, fee, cycle, startsOn, note);
    setBusy(false);
    if (error) { notifyError('لم يُحفظ الاشتراك', errorText(error)); return; }
    setAsking(false);
    await reload();
    notifyDone(`حُفظ اشتراك «${company.name}»: ${planText(fee, cycle)} من ${dayText(startsOn)}.`, 'الفواتير غير المسددة من هذا التاريخ تصدر من جديد بالمبلغ الجديد عند «توليد الفواتير».');
    onClose();
  });
  const ask = () => { setTried(true); if (!Object.keys(errors).length) setAsking(true); };

  return (
    <SidePanel open onClose={onClose} title={company.name} backLabel="اشتراكات الشركات" sub={current ? `الاشتراك الحالي ${planText(current.fee_amount, current.cycle)}` : 'بلا اشتراك للمنصة بعد'}
      meta={<CompanyState status={company.status} />} w={520}
      footer={<><span className="hidden flex-1 sm:block" /><Button kind="secondary" onClick={onClose}>رجوع</Button><Button disabled={!online} onClick={ask}>{current ? 'حفظ الاشتراك الجديد' : 'حفظ الاشتراك'}</Button></>}>
      {current && (
        <section className="flex flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-hair">
          <h3 className="m-0 text-card">الاشتراك الحالي</h3>
          <dl className="m-0 grid grid-cols-2 gap-3">
            {[['المبلغ', planText(current.fee_amount, current.cycle)], ['منذ', dayText(current.starts_on)], ['في الشهر', moneyText(monthlyFee(Number(current.fee_amount), current.cycle))],
              ['المستحق الآن', company.due.outstanding ? moneyText(company.due.outstanding) : 'لا شيء']].map(([k, v]) => (
              <div key={k} className="flex flex-col"><dt className="text-cap text-ink-3">{k}</dt><dd className="m-0 text-small font-medium">{v}</dd></div>
            ))}
          </dl>
          {current.note && <p className="m-0 text-label text-ink-2">{current.note}</p>}
        </section>
      )}
      <section className="flex flex-col gap-4">
        <div><h3 className="m-0 text-card">{current ? 'تعديل الاشتراك' : 'تحديد الاشتراك'}</h3>
          <p className="m-0 text-label text-ink-2">{current ? 'يبقى الاشتراك الحالي في السجل وينتهي في اليوم السابق لبداية الجديد.' : 'ما تدفعه الشركة للمنصة، وكل كم، ومن أي يوم.'}</p></div>
        <FieldRow>
          <MoneyField label="المبلغ" value={fee} onValue={setFee} error={shownErrors.fee} help="صفر إن كانت الشركة لا تدفع الآن." />
          <SelectField label="يُدفع" value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)} placeholder="اختر" error={shownErrors.cycle}
            options={(['monthly', 'termly', 'yearly'] as Cycle[]).map((c) => ({ value: c, label: CYCLE_LABEL[c] }))} />
        </FieldRow>
        <TextField label="يبدأ من" type="date" ltr value={startsOn} min={current?.starts_on} onChange={(e) => setStartsOn(e.target.value)} error={shownErrors.startsOn}
          help={cycle === 'termly' ? 'الفصل الدراسي من إعدادات الفصول؛ أول فاتورة تغطي الفصل الذي يبدأ فيه الاشتراك.' : cycle ? `فاتورة لكل ${CYCLE_PERIOD[cycle]} ابتداءً من هذا اليوم.` : undefined} />
        <TextArea label="ملاحظة" optional rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="مثال: خصم أول سنة" />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-card">السجل</h3>
        {history.length === 0 ? <p className="m-0 text-label text-ink-3">لم يُحدَّد اشتراك لهذه الشركة بعد.</p> : (
          <ul className="m-0 flex list-none flex-col divide-y divide-hair overflow-hidden rounded-inner bg-surface p-0 ring-1 ring-hair">
            {history.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="flex items-baseline gap-2"><span className="flex-1 text-small font-semibold">{planText(p.fee_amount, p.cycle)}</span>
                  {!p.ends_on ? <Badge tone="teal">الحالي</Badge> : p.ends_on < p.starts_on ? <Badge>لم يُطبَّق</Badge> : null}</span>
                <span className="text-label text-ink-2">{p.ends_on ? (p.ends_on < p.starts_on ? `كان سيبدأ ${dayText(p.starts_on)}` : rangeText(p.starts_on, p.ends_on)) : `منذ ${dayText(p.starts_on)}`}
                  {p.created_by_name ? ` · حفظه ${p.created_by_name}` : ''}</span>
                {p.note && <span className="text-cap text-ink-3">{p.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Dialog open={asking} onClose={() => setAsking(false)} icon="card" title={`${current ? 'تغيير' : 'تحديد'} اشتراك «${company.name}» إلى ${fee === '' || !cycle ? '' : planText(fee, cycle)}؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(false)}>رجوع</Button>, <Button key="g" loading={busy} onClick={save}>{current ? 'غيّر الاشتراك' : 'حدّد الاشتراك'}</Button>]}>
        <p className="m-0">يبدأ من <b className="text-ink">{dayText(startsOn)}</b>{current ? <>، وينتهي الاشتراك الحالي ({planText(current.fee_amount, current.cycle)}) في {dayText(addDays(startsOn, -1))}.</> : '.'}</p>
        <p className="m-0">{current ? 'الفواتير غير المسددة التي تبدأ من هذا اليوم تُلغى وتصدر من جديد بالمبلغ الجديد عند «توليد الفواتير». الفواتير المسددة والمعفاة لا تتغير.' : 'تصدر فواتيرها عند «توليد الفواتير» في صفحة الفواتير.'}</p>
        {fee === 0 && <p className="m-0">المبلغ صفر: لا تصدر للشركة فواتير ما دام هذا الاشتراك.</p>}
      </Dialog>
    </SidePanel>
  );
};

// ─────────────────────────────────────────────────────────────── charges ────

type ChargeFilter = 'all' | 'due' | 'overdue' | 'paid' | 'waived';
type ChargeAsk = { charge: Charge; to: ChargeStatus } | null;

const Charges: React.FC<{ data: PlatformBilling; reload: () => Promise<void> }> = ({ data, reload }) => {
  const guard = useGuard();
  const online = useOnline();
  const patch = usePatch();
  const [filter, setFilter] = useState<ChargeFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filter, search]);
  const [asking, setAsking] = useState<ChargeAsk>(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const today = data.today;
  const late = (c: Charge) => isOverdue(c, today, data.grace_days);
  const counts = {
    all: data.charges.length, due: data.charges.filter((c) => c.status === 'due').length, overdue: data.charges.filter(late).length,
    paid: data.charges.filter((c) => c.status === 'paid').length, waived: data.charges.filter((c) => c.status === 'waived').length,
  };
  const shown = data.charges.filter((c) => (filter === 'all' || (filter === 'overdue' ? late(c) : c.status === filter)) && (!search.trim() || c.company_name.includes(search.trim())));

  const ask = (charge: Charge, to: ChargeStatus) => { setMethod(''); setNote(''); setAsking({ charge, to }); };
  const mark = () => void guard('mark', async () => {
    if (!asking) return;
    const { charge, to } = asking;
    setBusy(true);
    const { data: saved, error } = await setChargeStatus(charge.id, to, to === 'paid' ? method.trim() || null : null, note.trim() ? note.trim() : null);
    setBusy(false);
    if (error || !saved) { notifyError('لم تتغيّر الفاتورة', errorText(error)); return; }
    patch((d) => ({ ...d, charges: d.charges.map((c) => (c.id === charge.id ? { ...c, ...(saved as Charge) } : c)) }));
    setAsking(null);
    notifyDone(to === 'paid' ? `سُجّل سداد ${moneyText(Number(charge.amount))} من «${charge.company_name}».` : to === 'waived' ? `أُعفيت «${charge.company_name}» من فاتورة ${rangeText(charge.period_start, charge.period_end)}.` : 'عادت الفاتورة مستحقة.');
  });
  const generate = () => void guard('generate', async () => {
    setBusy(true);
    const { data: res, error } = await generateCharges(today);
    setBusy(false);
    if (error) { notifyError('لم تصدر الفواتير', errorText(error)); return; }
    setGenerating(false);
    await reload();
    const r = (res ?? {}) as { charges_created?: number; expenses_carried?: number };
    const made = r.charges_created ?? 0; const carried = r.expenses_carried ?? 0;
    notifyDone(made ? `صدرت ${countText(made, ['فاتورة', 'فاتورتان', 'فواتير', 'فاتورة'])} جديدة.` : 'لا فواتير جديدة: كل الفترات حتى اليوم لها فواتير.',
      carried ? `وأُضيفت ${countText(carried, ['تكلفة متكررة', 'تكلفتان متكررتان', 'تكاليف متكررة', 'تكلفة متكررة'])} إلى أشهرها.` : undefined);
  });

  const status = (c: Charge) => (c.status === 'due'
    ? (late(c) ? <Pill tone="danger">متأخرة</Pill> : c.period_start > today ? <Pill tone="neutral">لم تبدأ</Pill> : <Pill tone="warning">{CHARGE_STATUS_LABEL.due}</Pill>)
    : <Pill tone={c.status === 'paid' ? 'success' : 'neutral'}>{CHARGE_STATUS_LABEL[c.status]}</Pill>);
  const rowActions = (c: Charge) => (c.status === 'due' ? (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1.5">
      <Button sm kind="tonal" disabled={!online} onClick={() => ask(c, 'paid')}>سُدّد</Button>
      <Button sm kind="secondary" disabled={!online} onClick={() => ask(c, 'waived')}>إعفاء</Button>
    </span>
  ) : (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex"><Menu items={[{ label: 'أعدها مستحقة', icon: 'undo', onClick: () => ask(c, 'due') }]} /></span>
  ));
  const columns: Column<Charge>[] = [
    { key: 'company', label: 'الشركة', w: 200, render: (c) => <Cell2 main={c.company_name} sub={c.note ?? undefined} /> },
    { key: 'period', label: 'الفترة', w: 200, render: (c) => rangeText(c.period_start, c.period_end) },
    { key: 'amount', label: 'المبلغ', w: 110, align: 'end', render: (c) => <Money value={Number(c.amount)} /> },
    { key: 'status', label: 'الحالة', w: 110, render: status },
    { key: 'paid', label: 'السداد', w: 170, hideTablet: true, render: (c) => (c.paid_at ? <Cell2 strong={false} main={momentText(c.paid_at)} sub={c.method ?? undefined} /> : <span className="text-ink-3">—</span>) },
    { key: 'act', label: <span className="sr-only">إجراءات</span>, w: 150, align: 'end', render: rowActions },
  ];
  const card = (c: Charge) => ({
    title: c.company_name, sub: rangeText(c.period_start, c.period_end), end: status(c),
    fields: [['المبلغ', <Money key="m" value={Number(c.amount)} />], ...(c.paid_at ? [['السداد', `${momentText(c.paid_at)}${c.method ? ` · ${c.method}` : ''}`]] : [])] as [React.ReactNode, React.ReactNode][],
    actions: c.status === 'due' ? <><Button sm kind="tonal" full disabled={!online} onClick={() => ask(c, 'paid')}>سُدّد</Button><Button sm kind="secondary" full disabled={!online} onClick={() => ask(c, 'waived')}>إعفاء</Button></>
      : <Button sm kind="secondary" full disabled={!online} onClick={() => ask(c, 'due')}>أعدها مستحقة</Button>,
  });
  const exportRows = () => exportSheet<Charge>({
    name: 'فواتير الشركات', rows: shown, columns: [
      { label: 'الشركة', value: (c) => c.company_name, width: 28 }, { label: 'من', value: (c) => c.period_start, width: 12 }, { label: 'إلى', value: (c) => c.period_end, width: 12 },
      { label: 'المبلغ (ج.م)', value: (c) => Number(c.amount), format: MONEY_FORMAT, width: 14 },
      { label: 'الحالة', value: (c) => (late(c) ? 'متأخرة' : CHARGE_STATUS_LABEL[c.status]) }, { label: 'سُدّدت في', value: (c) => (c.paid_at ? momentText(c.paid_at) : null), width: 22 },
      { label: 'الطريقة', value: (c) => c.method }, { label: 'ملاحظة', value: (c) => c.note, width: 30 },
    ],
  });
  const generateBtn = <Button icon="refresh" disabled={!online} onClick={() => setGenerating(true)}>توليد فواتير حتى اليوم</Button>;
  const plans = data.companies.filter((c) => c.plan && Number(c.plan.fee_amount) > 0).length;
  const a = asking;

  return (
    <>
      <DataTable<Charge> id="platform-billing-charges" columns={columns} rows={shown.slice((page - 1) * PAGE, page * PAGE)} rowKey={(c) => c.id} card={card}
        caption="فواتير الشركات" muted={(c) => c.status === 'waived'}
        toolbar={<Toolbar search={<SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الشركة" />}
          filters={data.charges.length === 0 ? undefined : <Chips value={filter} onChange={setFilter} options={[
            { value: 'all', label: 'الكل', count: counts.all }, { value: 'due', label: 'مستحقة', count: counts.due }, { value: 'overdue', label: 'متأخرة', count: counts.overdue },
            { value: 'paid', label: 'سُدّدت', count: counts.paid }, { value: 'waived', label: 'أُعفيت', count: counts.waived },
          ]} />}
          actions={<><ExportButton count={shown.length} className="hidden sm:inline-flex" onExport={exportRows} /><span className="hidden sm:inline-flex">{React.cloneElement(generateBtn, { sm: true })}</span></>} />}
        empty={data.charges.length === 0
          ? <EmptyState icon="receipt" title="لا فواتير بعد" text={plans ? 'اضغط «توليد فواتير حتى اليوم» لتصدر فاتورة لكل فترة بدأت من اشتراك كل شركة.' : 'حدّد اشتراك كل شركة أولاً، ثم أصدر فواتيرها من هنا.'}
            action={plans ? React.cloneElement(generateBtn) : <Button kind="secondary" iconEnd="fwd" to="/platform/billing">اشتراكات الشركات</Button>} />
          : shown.length === 0 ? <EmptyState icon="filter" title="لا فواتير بهذا الاختيار" action={<Button kind="secondary" onClick={() => { setFilter('all'); setSearch(''); }}>اعرض الكل</Button>} /> : undefined}
        pager={shown.length > PAGE ? <Pager page={page} total={shown.length} onPage={setPage} /> : undefined} />
      <PhoneBar>{React.cloneElement(generateBtn, { full: true })}</PhoneBar>

      <Dialog open={generating} onClose={() => setGenerating(false)} icon="receipt" title="إصدار الفواتير المستحقة حتى اليوم؟"
        actions={[<Button key="b" kind="secondary" onClick={() => setGenerating(false)}>رجوع</Button>, <Button key="g" loading={busy} onClick={generate}>أصدر الفواتير</Button>]}>
        <p className="m-0">تصدر فاتورة لكل فترة بدأت حتى {dayText(today)} ولم تصدر لها فاتورة، من اشتراك كل شركة ({countText(plans, ['شركة', 'شركتين', 'شركات', 'شركة'])} لها اشتراك بمبلغ). الفواتير الموجودة لا تتغير، ولا يُرسل شيء للشركات.</p>
        <p className="m-0">وتُنسخ التكاليف المعلَّمة «تتكرر كل شهر» إلى الأشهر التي بعدها حتى هذا الشهر.</p>
      </Dialog>

      <Dialog open={!!a} onClose={() => setAsking(null)} icon={a?.to === 'paid' ? 'check' : a?.to === 'waived' ? 'ban' : 'undo'}
        tone={a?.to === 'paid' ? 'success' : 'teal'}
        title={a ? (a.to === 'paid' ? `تسجيل سداد «${a.charge.company_name}» لفاتورة ${rangeText(a.charge.period_start, a.charge.period_end)}؟`
          : a.to === 'waived' ? `إعفاء «${a.charge.company_name}» من فاتورة ${rangeText(a.charge.period_start, a.charge.period_end)}؟`
            : `إعادة فاتورة «${a.charge.company_name}» إلى مستحقة؟`) : ''}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(null)}>رجوع</Button>,
          <Button key="g" loading={busy} onClick={mark}>{a?.to === 'paid' ? 'سجّل السداد' : a?.to === 'waived' ? 'أعفِ من الفاتورة' : 'أعدها مستحقة'}</Button>]}>
        {a && (
          <>
            <p className="m-0">{a.to === 'paid' ? <>تُسجَّل <b className="text-ink">{moneyText(Number(a.charge.amount))}</b> مدفوعة اليوم وتُحسب في المحصّل لهذا الشهر.</>
              : a.to === 'waived' ? <>لن تُطلب <b className="text-ink">{moneyText(Number(a.charge.amount))}</b> من الشركة، ولا تُحسب في المستحق ولا في المفوتر.</>
                : <>تعود <b className="text-ink">{moneyText(Number(a.charge.amount))}</b> إلى المستحق{a.charge.status === 'paid' ? ' ويُلغى تسجيل سدادها من المحصّل' : ''}.</>}</p>
            {a.to === 'paid' && <TextField label="طريقة الدفع" optional value={method} maxLength={60} onChange={(e) => setMethod(e.target.value)} placeholder="مثال: إنستاباي، تحويل بنكي، نقداً" />}
            {a.to !== 'due' && <TextField label="ملاحظة" optional value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}
          </>
        )}
      </Dialog>
    </>
  );
};

// ────────────────────────────────────────────────────────────── expenses ────

interface ExpenseDraft { month: string; category: ExpenseCategory | ''; amount: number | ''; note: string; recurring: boolean }

const Expenses: React.FC<{ data: PlatformBilling }> = ({ data }) => {
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [month, setMonth] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [month]);
  const months = [...new Set(data.expenses.map((e) => e.month.slice(0, 7)))].sort().reverse();
  const shown = data.expenses.filter((e) => !month || e.month.startsWith(month));
  const total = shown.reduce((t, e) => t + Number(e.amount), 0);
  const online = useOnline();

  const columns: Column<Expense>[] = [
    { key: 'month', label: 'الشهر', w: 140, render: (e) => monthText(e.month) },
    { key: 'cat', label: 'النوع', w: 180, render: (e) => <Cell2 main={CATEGORY_LABEL[e.category] ?? e.category} sub={e.note ?? undefined} /> },
    { key: 'amount', label: 'المبلغ', w: 130, align: 'end', render: (e) => <Money value={Number(e.amount)} /> },
    { key: 'rec', label: 'تتكرر', w: 110, render: (e) => (e.recurring ? <Badge tone="teal">كل شهر</Badge> : <span className="text-ink-3">—</span>) },
    { key: 'at', label: 'سُجّلت', w: 140, hideTablet: true, render: (e) => <span className="text-ink-2">{agoText(e.created_at)}</span> },
  ];
  const card = (e: Expense) => ({
    title: CATEGORY_LABEL[e.category] ?? e.category, sub: `${monthText(e.month)}${e.note ? ` · ${e.note}` : ''}`,
    end: <span className="text-small font-semibold"><Money value={Number(e.amount)} /></span>,
    fields: e.recurring ? [['تتكرر', 'كل شهر']] as [React.ReactNode, React.ReactNode][] : undefined,
  });
  const exportRows = () => exportSheet<Expense>({
    name: 'تكاليف التشغيل', rows: shown, columns: [
      { label: 'الشهر', value: (e) => monthText(e.month), width: 16 }, { label: 'النوع', value: (e) => CATEGORY_LABEL[e.category] ?? e.category, width: 22 },
      { label: 'المبلغ (ج.م)', value: (e) => Number(e.amount), format: MONEY_FORMAT, width: 14 }, { label: 'تتكرر كل شهر', value: (e) => e.recurring }, { label: 'ملاحظة', value: (e) => e.note, width: 30 },
    ],
  });
  const addBtn = <Button icon="plus" disabled={!online} onClick={() => setEditing('new')}>أضف تكلفة</Button>;

  return (
    <>
      <DataTable<Expense> id="platform-billing-expenses" columns={columns} rows={shown.slice((page - 1) * PAGE, page * PAGE)} rowKey={(e) => e.id} card={card}
        onOpen={(e) => setEditing(e)} openKey={editing && editing !== 'new' ? editing.id : null} caption="تكاليف تشغيل المنصة"
        foot={shown.length > 1 ? { month: 'المجموع', amount: <Money value={total} /> } : undefined}
        toolbar={<Toolbar
          filters={months.length > 1 ? <SelectField aria-label="الشهر" className="sm:w-[200px]" value={month} onChange={(e) => setMonth(e.target.value)}
            options={[{ value: '', label: 'كل الأشهر' }, ...months.map((m) => ({ value: m, label: monthText(m) }))]} /> : undefined}
          count={<span>{countText(shown.length, ['تكلفة', 'تكلفتان', 'تكاليف', 'تكلفة'])} · {moneyText(total)}</span>}
          actions={<><ExportButton count={shown.length} className="hidden sm:inline-flex" onExport={exportRows} /><span className="hidden sm:inline-flex">{React.cloneElement(addBtn, { sm: true })}</span></>} />}
        empty={data.expenses.length === 0
          ? <EmptyState icon="card" title="لا تكاليف مسجلة" text="سجّل ما يكلفه تشغيل المنصة كل شهر — الاستضافة والرسائل والمتاجر والرواتب — لترى الربح الحقيقي." action={React.cloneElement(addBtn)} /> : undefined}
        pager={shown.length > PAGE ? <Pager page={page} total={shown.length} onPage={setPage} /> : undefined} />
      <PhoneBar>{React.cloneElement(addBtn, { full: true })}</PhoneBar>
      {editing && <ExpensePanel key={editing === 'new' ? 'new' : editing.id} expense={editing === 'new' ? null : editing} today={data.today} onClose={() => setEditing(null)} />}
    </>
  );
};

const ExpensePanel: React.FC<{ expense: Expense | null; today: string; onClose: () => void }> = ({ expense, today, onClose }) => {
  const guard = useGuard();
  const online = useOnline();
  const patch = usePatch();
  const [d, setD] = useState<ExpenseDraft>(() => (expense
    ? { month: expense.month.slice(0, 7), category: expense.category, amount: Number(expense.amount), note: expense.note ?? '', recurring: expense.recurring }
    : { month: today.slice(0, 7), category: '', amount: '', note: '', recurring: false }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const errors = expenseErrors(d);
  const shownErrors = tried ? errors : {};
  const set = (p: Partial<ExpenseDraft>) => setD((x) => ({ ...x, ...p }));
  const name = (e: { category: ExpenseCategory; month: string }) => `${CATEGORY_LABEL[e.category]} لشهر ${monthText(e.month)}`;

  const save = () => void guard('save', async () => {
    setTried(true);
    if (Object.keys(errors).length || !d.category || d.amount === '') return;
    setBusy(true);
    const { data: saved, error } = await saveExpense(expense?.id ?? null, { month: firstOf(d.month), category: d.category, amount: d.amount, note: d.note, recurring: d.recurring });
    setBusy(false);
    if (error || !saved) { notifyError('لم تُحفظ التكلفة', errorText(error)); return; }
    const row = saved as Expense;
    patch((x) => ({ ...x, expenses: [row, ...x.expenses.filter((e) => e.id !== row.id)].sort((a, b) => b.month.localeCompare(a.month) || Number(b.amount) - Number(a.amount)) }));
    notifyDone(`${expense ? 'عُدّلت' : 'أُضيفت'} تكلفة ${name(row)}: ${moneyText(Number(row.amount))}.`, row.recurring ? 'تُنسخ إلى الأشهر التالية عند «توليد الفواتير».' : undefined);
    onClose();
  });
  const remove = () => void guard('delete', async () => {
    if (!expense) return;
    setBusy(true);
    const { error } = await deleteExpense(expense.id);
    setBusy(false);
    if (error) { notifyError('لم تُحذف التكلفة', errorText(error)); return; }
    patch((x) => ({ ...x, expenses: x.expenses.filter((e) => e.id !== expense.id) }));
    setDeleting(false);
    notifyDone(`حُذفت تكلفة ${name(expense)}.`);
    onClose();
  });

  return (
    <SidePanel open onClose={onClose} title={expense ? 'تعديل تكلفة' : 'تكلفة جديدة'} backLabel="تكاليف التشغيل" sub={expense ? name(expense) : 'ما صرفته على تشغيل المنصة في شهر'}
      footer={<>
        {expense && <Button kind="dangerQuiet" icon="trash" disabled={!online} onClick={() => setDeleting(true)}>حذف</Button>}
        <span className="hidden flex-1 sm:block" />
        <Button kind="secondary" onClick={onClose}>رجوع</Button>
        <Button loading={busy && !deleting} disabled={!online} onClick={save}>حفظ التكلفة</Button>
      </>}>
      <FieldRow>
        <TextField label="الشهر" type="month" ltr value={d.month} onChange={(e) => set({ month: e.target.value })} error={shownErrors.month} />
        <SelectField label="النوع" value={d.category} placeholder="اختر" onChange={(e) => set({ category: e.target.value as ExpenseCategory })} error={shownErrors.category}
          options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
      </FieldRow>
      <MoneyField label="المبلغ" value={d.amount} onValue={(v) => set({ amount: v })} error={shownErrors.amount} />
      <TextField label="ملاحظة" optional value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="مثال: Supabase Pro" />
      <Toggle label="تتكرر كل شهر" checked={d.recurring} onChange={(on) => set({ recurring: on })}
        help="تُنسخ إلى كل شهر بعد هذا عند «توليد الفواتير»، حتى تلغي التكرار من آخر نسخة." />
      <Dialog open={deleting} onClose={() => setDeleting(false)} icon="trash" tone="danger" title={expense ? `حذف تكلفة ${name(expense)}؟` : ''}
        actions={[<Button key="b" kind="secondary" onClick={() => setDeleting(false)}>رجوع</Button>, <Button key="g" kind="danger" loading={busy} onClick={remove}>احذف التكلفة</Button>]}>
        {expense && <p className="m-0">تُحذف <b className="text-ink">{moneyText(Number(expense.amount))}</b> من تكاليف {monthText(expense.month)} ويزيد ربح ذلك الشهر بمقدارها. {expense.recurring ? 'نسخها في الأشهر الأخرى تبقى كما هي.' : ''}</p>}
      </Dialog>
    </SidePanel>
  );
};

// ─────────────────────────────────────────────────────────────────── pnl ────

const Pnl: React.FC<{ data: PlatformBilling }> = ({ data }) => {
  const rows = useMemo(() => pnlRows(data.charges, data.expenses, data.today), [data]);
  const [page, setPage] = useState(1);
  const desc = rows.slice().reverse();
  const crossYear = new Set(rows.map((r) => r.month.slice(0, 4))).size > 1;
  const sum = (k: keyof Omit<PnlRow, 'month'>) => rows.reduce((t, r) => t + Number(r[k]), 0);
  const series = [
    { name: 'المحصّل', tone: 'teal' as const, points: rows.map((r) => ({ x: r.month, y: r.collected })) },
    { name: 'التكاليف', tone: 'ink' as const, points: rows.map((r) => ({ x: r.month, y: r.costs })) },
    { name: 'المفوتر', tone: 'muted' as const, points: rows.map((r) => ({ x: r.month, y: r.billed })) },
  ];
  // A loss reads «-1,200 ج.م»: the number is kept left to right so its sign stays in front.
  const profit = (v: number) => (
    <span className={`whitespace-nowrap font-semibold tabular ${v < 0 ? 'text-bad' : ''}`}>
      <span dir="ltr" className="[unicode-bidi:isolate]">{num(v)}</span> <span className="text-cap font-normal text-ink-3">ج.م</span>
    </span>
  );
  const columns: Column<PnlRow>[] = [
    { key: 'month', label: 'الشهر', w: 160, render: (r) => monthText(r.month) },
    { key: 'billed', label: 'المفوتر', w: 130, align: 'end', render: (r) => <Money value={r.billed} /> },
    { key: 'collected', label: 'المحصّل', w: 130, align: 'end', render: (r) => <Money value={r.collected} /> },
    { key: 'costs', label: 'التكاليف', w: 130, align: 'end', render: (r) => <Money value={r.costs} /> },
    { key: 'profit', label: 'الربح', w: 130, align: 'end', render: (r) => profit(r.profit) },
  ];
  const card = (r: PnlRow) => ({
    title: monthText(r.month), end: profit(r.profit),
    stats: [['المحصّل', num(r.collected)], ['التكاليف', num(r.costs)], ['المفوتر', num(r.billed)]] as [React.ReactNode, React.ReactNode][],
  });
  const exportRows = () => exportSheet<PnlRow>({
    name: 'الأرباح شهرياً', rows: rows, columns: [
      { label: 'الشهر', value: (r) => monthText(r.month), width: 16 }, { label: 'المفوتر (ج.م)', value: (r) => r.billed, format: MONEY_FORMAT, width: 14 },
      { label: 'المحصّل (ج.م)', value: (r) => r.collected, format: MONEY_FORMAT, width: 14 }, { label: 'التكاليف (ج.م)', value: (r) => r.costs, format: MONEY_FORMAT, width: 14 },
      { label: 'الربح (ج.م)', value: (r) => r.profit, format: MONEY_FORMAT, width: 14 },
    ],
  });
  if (!rows.length) {
    return <EmptyState card icon="trend" title="لا أرقام بعد" text="يظهر هنا الربح شهراً بشهر حين تصدر فواتير الشركات وتسجّل تكاليف التشغيل." />;
  }
  return (
    <>
      <Panel title="المحصّل والتكاليف شهرياً" sub="بالجنيه. المحصّل بتاريخ السداد، والمفوتر بشهر بداية الفاتورة">
        <LineChart series={series} label="المحصّل والتكاليف شهرياً" xFormat={(m) => monthText(m, crossYear && m.endsWith('-01'))} />
      </Panel>
      <Section title="الأرباح شهرياً" meta={<span className="text-label text-ink-3">الربح = المحصّل − التكاليف</span>}>
        <DataTable<PnlRow> id="platform-billing-pnl" columns={columns} rows={desc.slice((page - 1) * PAGE, page * PAGE)} rowKey={(r) => r.month} card={card} caption="الأرباح شهرياً"
          foot={{ month: 'المجموع', billed: <Money value={sum('billed')} />, collected: <Money value={sum('collected')} />, costs: <Money value={sum('costs')} />, profit: profit(sum('profit')) }}
          toolbar={<Toolbar count={<span>{countText(rows.length, ['شهر', 'شهران', 'أشهر', 'شهراً'])}</span>} actions={<ExportButton count={rows.length} className="hidden sm:inline-flex" onExport={exportRows} />} />}
          pager={desc.length > PAGE ? <Pager page={page} total={desc.length} onPage={setPage} /> : undefined} />
      </Section>
    </>
  );
};
