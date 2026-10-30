import React, { useEffect, useMemo, useState } from 'react';
import { useCompany } from '../lib/adminScope';
import {
  Button, Card, EmptyState, IconButton, Money, Note, Page, PageHeader, SelectField, Section, SkeletonStat, StatCard, TextField,
  moneyText, num, useOnline,
} from '../ui';
import {
  EXPENSE_PERIOD_LABEL, addCompanyExpense, deleteCompanyExpense, getCompanyFinance,
  type CompanyFinance, type ExpensePeriod,
} from '../lib/finance';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthName = (d: Date) => `${['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][d.getMonth()]} ${d.getFullYear()}`;

interface Period { key: string; label: string; from: string; to: string }

function buildPeriods(): Period[] {
  const now = new Date();
  const months: Period[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    months.push({ key: `m${i}`, label: monthName(d), from: iso(d), to: iso(end) });
  }
  const termFrom = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const termTo = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [{ key: 'term', label: 'الترم (آخر 4 شهور)', from: iso(termFrom), to: iso(termTo) }, ...months];
}

export const FinancePage: React.FC = () => {
  const company = useCompany();
  const online = useOnline();
  const periods = useMemo(buildPeriods, []);
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const [data, setData] = useState<CompanyFinance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    getCompanyFinance(period.from, period.to)
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (live) { setError(e instanceof Error ? e.message : 'تعذّر تحميل الماليّة.'); setLoading(false); } });
    return () => { live = false; };
  }, [period.from, period.to, reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <Page>
      <PageHeader title="الماليّة" sub={`الدخل والمصروفات وصافي ربح ${company.name}.`}
        actions={<SelectField aria-label="الفترة" value={periodKey} className="w-52" options={periods.map((p) => ({ value: p.key, label: p.label }))} onChange={(e) => setPeriodKey(e.target.value)} />} />

      {error ? (
        <Note tone="danger" title="تعذّر تحميل الماليّة" action={<Button kind="link" sm onClick={reload}>إعادة المحاولة</Button>}>{error}</Note>
      ) : loading || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="الدخل" value={moneyText(data.income)} unit="ج.م" hint="من الإيصالات في الفترة" />
            <StatCard label="المصروفات" value={moneyText(data.cost_total)} unit="ج.م" hint="المرتبات + المصروفات" />
            <StatCard label="صافي الربح" value={moneyText(data.net)} unit="ج.م" hint={data.net >= 0 ? 'ربح' : 'خسارة'} tone={data.net >= 0 ? 'success' : 'danger'} />
          </div>

          <Section title="مرتبات المشرفين" meta={<Money value={data.salary_total} />}>
            {data.salaries.length === 0 ? (
              <EmptyState card icon="info" title="لا مرتبات مسجّلة" text="أضف مرتب المشرف عند إنشائه ليظهر هنا." />
            ) : (
              <Card className="flex flex-col p-0">
                {data.salaries.map((s, i) => (
                  <div key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${i > 0 ? 'border-t border-hair' : ''}`}>
                    <span className="min-w-0"><span className="block truncate text-small font-semibold">{s.name}</span>
                      <span className="text-label text-ink-2">{EXPENSE_PERIOD_LABEL[s.period as ExpensePeriod]} · {moneyText(s.amount)}</span></span>
                    <Money value={s.cost} />
                  </div>
                ))}
              </Card>
            )}
          </Section>

          <Section title="المصروفات" meta={<Money value={data.expense_total} />}>
            <ExpenseForm online={online} onAdded={reload} />
            {data.expenses.length > 0 && (
              <Card className="mt-3 flex flex-col p-0">
                {data.expenses.map((e, i) => (
                  <div key={e.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${i > 0 ? 'border-t border-hair' : ''}`}>
                    <span className="min-w-0"><span className="block truncate text-small font-semibold">{e.label}</span>
                      <span className="text-label text-ink-2">{EXPENSE_PERIOD_LABEL[e.period as ExpensePeriod]}{e.period === 'once' && e.spent_on ? ` · ${e.spent_on}` : ''} · {moneyText(e.amount)}</span></span>
                    <span className="flex items-center gap-2"><Money value={e.cost} />
                      <IconButton icon="trash" tone="danger" label={`حذف ${e.label}`} onClick={() => void deleteCompanyExpense(e.id).then(reload)} /></span>
                  </div>
                ))}
              </Card>
            )}
          </Section>

          <p className="m-0 text-label text-ink-3">تُحسب التكلفة على مدى الفترة: الشهري ×عدد الشهور، اليومي ×عدد الأيام، والترمي على الترم. المصروف «مرة واحدة» يُحسب في فترته فقط.</p>
        </>
      )}
    </Page>
  );
};

const PERIOD_OPTIONS = [
  { value: 'once', label: 'مرة واحدة' }, { value: 'monthly', label: 'شهري' },
  { value: 'termly', label: 'بالترم' }, { value: 'daily', label: 'يومي' },
];

const ExpenseForm: React.FC<{ online: boolean; onAdded: () => void }> = ({ online, onAdded }) => {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<ExpensePeriod>('monthly');
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(amount);
  const valid = label.trim().length > 0 && amount.trim() !== '' && Number.isFinite(n) && n >= 0;
  const reset = () => { setLabel(''); setAmount(''); setPeriod('monthly'); setDay(''); setErr(null); };
  const add = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr(null);
    try {
      await addCompanyExpense(label.trim(), n, period, period === 'once' ? (day || null) : null);
      reset(); setOpen(false); onAdded();
    } catch (e) { setErr(e instanceof Error ? e.message : 'تعذّر الحفظ.'); }
    setBusy(false);
  };
  if (!open) {
    return <Button kind="secondary" icon="plus" disabled={!online} onClick={() => setOpen(true)}>أضف مصروفاً</Button>;
  }
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <TextField label="المصروف" value={label} className="min-w-0 flex-1" placeholder="مثال: صيانة باص" onChange={(e) => setLabel(e.target.value)} />
        <TextField label="المبلغ" type="number" inputMode="numeric" ltr value={amount} className="sm:w-32" placeholder="0" onChange={(e) => setAmount(e.target.value)} />
        <SelectField label="النوع" value={period} className="sm:w-36" options={PERIOD_OPTIONS} onChange={(e) => setPeriod(e.target.value as ExpensePeriod)} />
        {period === 'once' && <TextField label="التاريخ" type="date" ltr value={day} className="sm:w-40" onChange={(e) => setDay(e.target.value)} />}
      </div>
      {err && <Note tone="danger">{err}</Note>}
      <div className="flex gap-2">
        <Button icon="plus" loading={busy} disabled={!valid || !online} onClick={add}>أضف</Button>
        <Button kind="secondary" onClick={() => { reset(); setOpen(false); }}>إلغاء</Button>
      </div>
    </Card>
  );
};
