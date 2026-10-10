import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Card, Dialog, ErrorState, FormSection, Icon, Note, Page, PageHeader, SkeletonForm, TextField, Toggle,
  countText, rangeText, NOUN, errorText, useOnline, type IconName,
} from '../../ui';
import { supabase } from '../../lib/supabase';
import { keys, STALE, unwrap, usePageData } from '../../lib/query';
import { rpcOr } from '../../lib/rpc';
import { useGuard } from '../../lib/guard';
import { notify, notifyDone, notifyError } from '../../lib/toasts';
import { settingsKey, switchesKey } from '../../lib/reference';
import { readableWhatsApp, whatsappDigits, whatsappLink } from '../../lib/supportWhatsApp';
import { MONTHS, dayProblem, useIsPhone, followers, useCompanySwitches, type TermRow } from '../../lib/platform';
import { PlatformVoteSection } from '../../components/platform/VoteSection';

interface Period { period_code: string; label: string; start_date: string; end_date: string }
interface Settings { annual_global: boolean; can_edit_global: boolean; terms: TermRow[]; periods: Period[] | null }
interface Switches { daily_global: boolean }
type Draft = Record<string, { name: string; start_day: number | ''; start_month: number; end_day: number | ''; end_month: number }>;

const whatsappKey = keys.platform('supportWhatsApp');
const draftOf = (terms: TermRow[]): Draft => Object.fromEntries(terms.map((t) => [t.code, { name: t.name, start_day: t.start_day, start_month: t.start_month, end_day: t.end_day, end_month: t.end_month }]));

/**
 * «الإعدادات الافتراضية» (docs/canvas/AdmPlatDefaults*): what every new company
 * starts with and what the platform allows to be sold, each section saved by its
 * own button; switching an option off for everyone, or changing the hours every
 * following company uses at once, asks first with the real number of companies.
 */
export const PlatformDefaultsPage: React.FC = () => {
  const online = useOnline();
  const settings = usePageData(settingsKey(null), () => unwrap<Settings>(supabase.rpc('get_subscription_settings', { p_company_id: null })), { staleTime: STALE.reference });
  const switches = usePageData(switchesKey(null), () => unwrap<Switches>(supabase.rpc('get_subscription_switches', { p_company_id: null })), { staleTime: STALE.reference });
  const companies = useCompanySwitches();
  const f = companies.data ? followers(companies.data) : null;

  const header = <PageHeader title="الإعدادات الافتراضية" sub="القيم التي تبدأ بها كل شركة جديدة، وما يُسمح ببيعه على المنصة كلها. كل قسم يُحفظ بزرّه." />;
  if (settings.loading) return <Page>{header}<SkeletonForm rows={3} /><SkeletonForm rows={2} /><SkeletonForm rows={4} /></Page>;
  if (!settings.data) return <Page>{header}<ErrorState card title="تعذّر تحميل الإعدادات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void settings.reload()} /></Page>;
  const s = settings.data;

  return (
    <Page>
      {header}
      <Card className="flex flex-col gap-4 p-4 lg:p-6">
        <h2 className="m-0 text-card">كيف تصل هذه القيم إلى الشركات</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <How icon="copy" title="تُنسخ مرة واحدة" what="مواعيد الفصول">تأخذ الشركة نسختها يوم إنشائها. تغييرك هنا بعد ذلك لا يمس أي شركة قائمة.</How>
          <How icon="refresh" title="تُتبع حتى تغيّرها الشركة" what="مواعيد تأكيد الركوب">
            {f ? `${countText(f.followVote, NOUN.company)} من ${f.working} تتبع المنصة الآن: تغييرك يصلها فوراً.${f.working - f.followVote ? ` ${countText(f.working - f.followVote, NOUN.company)} لها مواعيدها.` : ''}`
              : 'كل شركة لم تحدد مواعيدها تتبع المنصة: تغييرك يصلها فوراً.'}
          </How>
          <How icon="power" title="توقف عند الجميع" what="الفصلان معاً · الاشتراك اليومي">إيقاف أحدهما هنا يوقفه عند كل الشركات. تشغيله يترك القرار لكل شركة.</How>
        </div>
      </Card>
      <TermsSection terms={s.terms} periods={s.periods ?? []} online={online} reload={settings.reload} />
      <SaleSection annual={s.annual_global} daily={switches.data?.daily_global ?? null} counts={f} online={online} />
      <PlatformVoteSection follow={f?.followVote ?? null} custom={f ? f.working - f.followVote : null} online={online} />
      <WhatsAppSection online={online} />
      <div className="flex items-start gap-3 rounded-card bg-sunken px-4 py-3.5 sm:px-6">
        <span className="pt-0.5 text-ink-2"><Icon name="idcard" size={18} /></span>
        <div className="flex flex-col"><span className="text-small font-semibold">بطاقة الطالب الافتراضية</span>
          <span className="text-label text-ink-2">كل شركة جديدة تبدأ ببطاقة بألوان باصك وبلا شعار. لا إعداد لها هنا؛ يغيّرها مدير الشركة من «بطاقة الطالب».</span></div>
      </div>
    </Page>
  );
};

const How: React.FC<{ icon: IconName; title: string; what: string; children: React.ReactNode }> = ({ icon, title, what, children }) => (
  <div className="flex flex-col gap-1 rounded-inner bg-ground p-4">
    <span className="flex items-center gap-1.5 text-small font-semibold text-teal"><Icon name={icon} size={16} stroke={2} />{title}</span>
    <span className="text-small font-semibold">{what}</span>
    <span className="text-label text-ink-2">{children}</span>
  </div>
);

/** Section 1: the default term dates (day and month; the year follows the academic year). */
const TermsSection: React.FC<{ terms: TermRow[]; periods: Period[]; online: boolean; reload: () => Promise<void> }> = ({ terms, periods, online, reload }) => {
  const phone = useIsPhone();
  const client = useQueryClient();
  const guard = useGuard();
  const [draft, setDraft] = useState<Draft>(() => draftOf(terms));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  // What is saved replaces the copy being edited only when nothing was typed (a refresh never undoes typing).
  const savedKey = JSON.stringify(draftOf(terms));
  const [base, setBase] = useState(savedKey);
  const dirty = JSON.stringify(draft) !== base;
  useEffect(() => { if (!dirty) { setDraft(draftOf(terms)); setBase(savedKey); } }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = Object.fromEntries(terms.map((t) => {
    const d = draft[t.code];
    return [t.code, { name: d.name.trim() ? null : 'اكتب اسم الفصل.', start: dayProblem(d.start_day, d.start_month), end: dayProblem(d.end_day, d.end_month) }];
  }));
  const bad = Object.values(problems).some((p) => p.name || p.start || p.end);
  const set = (code: string, p: Partial<Draft[string]>) => setDraft((x) => ({ ...x, [code]: { ...x[code], ...p } }));

  const save = () => void guard('terms', async () => {
    setTried(true);
    if (bad) return;
    const changed = terms.filter((t) => JSON.stringify(draftOf([t])[t.code]) !== JSON.stringify({ [t.code]: draft[t.code] }[t.code]));
    const payload = changed.map((t) => ({ code: t.code, name: draft[t.code].name.trim(), start_day: Number(draft[t.code].start_day), start_month: draft[t.code].start_month, end_day: Number(draft[t.code].end_day), end_month: draft[t.code].end_month }));
    if (!payload.length) return;
    setBusy(true);
    const done: string[] = [];
    try {
      await rpcOr('save_platform_terms', () => supabase.rpc('save_platform_terms', { p_terms: payload }), async () => {
        // A database without save_platform_terms: one term at a time, as before.
        for (const p of payload) {
          const { error } = await supabase.from('academic_terms').update({ name: p.name, start_day: p.start_day, start_month: p.start_month, end_day: p.end_day, end_month: p.end_month }).eq('code', p.code).select('code').single();
          if (error) throw new Error(error.message);
          done.push(p.name);
        }
        return null;
      });
      notifyDone('حُفظت مواعيد الفصول. تأخذها الشركات الجديدة.');
      setTried(false);
      await reload();
    } catch (e) {
      const left = payload.filter((p) => !done.includes(p.name)).map((p) => p.name);
      if (done.length) notify({ tone: 'error', title: `حُفظ ${done.join(' و')} فقط. ${left.join(' و')} لم ${left.length > 1 ? 'يُحفظا' : 'يُحفظ'}.`, action: { label: 'حاول مرة أخرى', run: save } }, 20_000);
      else notifyError('لم تُحفظ مواعيد الفصول', errorText(e));
      await reload();
    }
    setBusy(false);
    void client.invalidateQueries({ queryKey: settingsKey(null) });
  });

  const month = (code: string, k: 'start_month' | 'end_month', label: string) => (
    <label className="relative flex h-12 min-w-0 items-center rounded-control bg-surface px-3 text-small shadow-field focus-within:!shadow-field-focus hover:shadow-field-hover sm:h-11">
      <span className="sr-only">{label}</span>
      <select value={draft[code][k]} onChange={(e) => set(code, { [k]: Number(e.target.value) } as never)} className="h-full w-full cursor-pointer appearance-none bg-transparent pe-7 outline-none">
        {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <Icon name="down" size={18} className="pointer-events-none absolute end-3 text-ink-3" />
    </label>
  );
  const dayBox = (code: string, k: 'start_day' | 'end_day', label: string, err: string | null) => (
    <input aria-label={label} inputMode="numeric" dir="ltr" value={draft[code][k]} aria-invalid={!!err || undefined}
      onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 2); set(code, { [k]: n === '' ? '' : Number(n) } as never); }}
      className={`h-12 w-16 flex-none rounded-control bg-surface px-3 text-center text-small outline-none sm:h-11 ${err ? 'shadow-field-error' : 'shadow-field hover:shadow-field-hover focus:!shadow-field-focus'}`} />
  );
  const errLine = (t: string | null) => t && <div role="alert" className="flex items-start gap-1.5 text-label text-bad"><Icon name="alert" size={14} stroke={2} className="mt-[3px]" />{t}</div>;

  return (
    <FormSection title="مواعيد الفصول الدراسية" help="اليوم والشهر فقط؛ السنة تُحسب تلقائياً كل عام دراسي. تُنسخ إلى الشركة عند إنشائها، ثم يعدّلها مديرها من «مواعيد الاشتراك»."
      footer={<><span className="flex-1 text-label text-ink-2">لا يغيّر مواعيد أي شركة قائمة</span><Button loading={busy} disabled={!dirty || !online || (tried && bad)} onClick={save}>حفظ مواعيد الفصول</Button></>}>
      <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_150px] gap-3 text-label font-medium text-ink-2 sm:grid">
        <span>اسم الفصل</span><span>يبدأ</span><span>ينتهي</span><span>يُباع عند شركة جديدة</span>
      </div>
      {terms.map((t) => {
        const p = problems[t.code];
        const show = (x: string | null) => (tried || x?.includes('ليس فيه') ? x : null);
        return (
          <div key={t.code} className="flex flex-col gap-3 rounded-inner bg-ground p-3 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.6fr)_150px] sm:items-start sm:rounded-none sm:bg-transparent sm:p-0">
            <div>
              <TextField aria-label="اسم الفصل" label={phone ? 'اسم الفصل' : undefined} value={draft[t.code].name} onChange={(e) => set(t.code, { name: e.target.value })} maxLength={40} error={show(p.name) ?? undefined} />
            </div>
            <div className="flex flex-col gap-1.5"><span className="text-label font-medium sm:hidden">يبدأ</span><div className="flex gap-2">{dayBox(t.code, 'start_day', `يوم بداية ${t.name}`, show(p.start))}{month(t.code, 'start_month', `شهر بداية ${t.name}`)}</div>{errLine(show(p.start))}</div>
            <div className="flex flex-col gap-1.5"><span className="text-label font-medium sm:hidden">ينتهي</span><div className="flex gap-2">{dayBox(t.code, 'end_day', `يوم نهاية ${t.name}`, show(p.end))}{month(t.code, 'end_month', `شهر نهاية ${t.name}`)}</div>{errLine(show(p.end))}</div>
            <div className="flex items-center justify-between gap-2 sm:h-11 sm:justify-start"><span className="text-label text-ink-2 sm:hidden">يُباع عند شركة جديدة:</span>
              {t.is_on_sale ? <Badge tone="success">نعم</Badge> : <Badge>لا، تفتحه الشركة</Badge>}</div>
          </div>
        );
      })}
      {periods.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium text-ink-2">الفترات كما تُحسب الآن</span>
          <div className="flex flex-wrap gap-2">
            {periods.map((x) => <span key={`${x.period_code}${x.start_date}`} className="rounded-control bg-ground px-3 py-1.5 text-label"><b className="font-semibold">{x.label}</b> · {rangeText(x.start_date, x.end_date)}</span>)}
          </div>
        </div>
      )}
    </FormSection>
  );
};

/** Section 2: the two platform-wide switches, saved together by their button; turning one off asks first. */
const SaleSection: React.FC<{ annual: boolean; daily: boolean | null; counts: ReturnType<typeof followers> | null; online: boolean }> = ({ annual, daily, counts, online }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const [a, setA] = useState(annual);
  const [d, setD] = useState(daily ?? true);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setA(annual), [annual]);
  useEffect(() => { if (daily != null) setD(daily); }, [daily]);
  const changed = a !== annual || (daily != null && d !== daily);
  const offs = [...(annual && !a ? ['الفصلان معاً'] : []), ...(daily && !d ? ['الاشتراك اليومي'] : [])];
  const selling = (annual && !a ? counts?.annual : 0) || (daily && !d ? counts?.daily : 0) || 0;

  const save = () => void guard('sale', async () => {
    setBusy(true);
    try {
      if (a !== annual) { const { error } = await supabase.rpc('set_annual_subscription', { p_enabled: a, p_company_id: null }); if (error) throw new Error(error.message); }
      if (daily != null && d !== daily) { const { error } = await supabase.rpc('set_daily_subscription', { p_enabled: d, p_company_id: null }); if (error) throw new Error(error.message); }
      setAsking(false);
      notifyDone('حُفظ ما يُسمح ببيعه على المنصة.');
    } catch (e) { notifyError('لم يُحفظ', errorText(e)); }
    // Every company's preview follows these switches: read again.
    await Promise.all([client.invalidateQueries({ queryKey: settingsKey(null) }), client.invalidateQueries({ queryKey: switchesKey(null) })]);
    setBusy(false);
  });
  const sells = (n: number | undefined) => (n == null ? '' : ` ${countText(n, NOUN.company)} ${n === 1 ? 'تبيعه' : n === 2 ? 'تبيعانه' : 'تبيعه'} الآن.`);
  return (
    <>
      <FormSection title="ما يُسمح ببيعه على المنصة" help="مفتاحان فوق قرار كل شركة. لا يتغيّر شيء قبل الضغط على «حفظ»."
        footer={<Button disabled={!changed || !online} onClick={() => (offs.length ? setAsking(true) : save())} loading={busy && !asking}>حفظ ما يُسمح ببيعه</Button>}>
        <Toggle label="الفصلان معاً (الأول والثاني)" checked={a} onChange={setA}
          help={`اشتراك واحد يغطي الفصلين ولا يشمل الصيفي. يُباع حتى نهاية الفصل الأول.${sells(counts?.annual)}`} />
        <div className="border-t border-hair" />
        <Toggle label="الاشتراك اليومي (نقداً في الباص)" checked={d} onChange={setD} disabled={daily == null}
          help={`عند الإيقاف لا يظهر للطلاب ولا يمكن إنشاؤه، ويُقفل سعره في صفحة الخطوط.${sells(counts?.daily)}`} />
      </FormSection>
      <Dialog open={asking} onClose={() => setAsking(false)} icon="power" tone="danger" title={`إيقاف ${offs.map((o) => `«${o}»`).join(' و')} على المنصة كلها؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(false)}>رجوع</Button>, <Button key="g" kind="danger" loading={busy} onClick={save}>أوقفه على المنصة</Button>]}>
        <p className="m-0">يختفي {offs.length > 1 ? 'هذان الاشتراكان' : 'هذا الاشتراك'} من التطبيق عند طلاب <b className="text-ink">{counts ? countText(selling, NOUN.company) : 'كل شركة'}</b> {selling === 1 ? 'تبيعه' : 'تبيعه'} الآن، ولا تستطيع أي شركة تشغيله حتى تعيده أنت.</p>
        <p className="m-0">من اشتراه من قبل يبقى اشتراكه نشطاً حتى نهايته. الإيصالات قيد المراجعة تُراجع كالعادة.</p>
      </Dialog>
    </>
  );
};

/**
 * The platform's WhatsApp number: the app's «أدخل الرمز» screen opens a chat with it
 * so a student who forgot the password can ask for the code. Empty hides that button.
 * (Not on the boards; it moved here from the old app-settings page.)
 */
const WhatsAppSection: React.FC<{ online: boolean }> = ({ online }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const q = usePageData(whatsappKey, () => unwrap<string | null>(supabase.rpc('get_support_whatsapp')), { staleTime: STALE.reference });
  const saved = q.data ?? '';
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(saved ? readableWhatsApp(saved) : ''); }, [saved]);
  const digits = whatsappDigits(draft);
  const changed = digits !== null && digits !== saved;
  const save = () => void guard('wa', async () => {
    if (digits === null) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('save_support_whatsapp', { p_phone: digits });
    setBusy(false);
    if (error) { notifyError('لم يُحفظ رقم واتساب', errorText(error)); return; }
    client.setQueryData(whatsappKey, (data as string | null) ?? null);
    notifyDone(data ? 'حُفظ رقم واتساب الدعم.' : 'أُخفي زر واتساب من التطبيق.');
  });
  return (
    <FormSection title="واتساب استعادة كلمة المرور" help="في شاشة «أدخل الرمز» يظهر للطالب زر «اطلب الرمز على واتساب» يفتح محادثة مع هذا الرقم ومعها رقم هاتفه. اتركه فارغاً لإخفاء الزر."
      footer={<>
        {saved && !changed && <a href={whatsappLink(saved)} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-control px-4 text-small font-medium text-teal hover:underline sm:h-11"><Icon name="external" size={16} />جرّب المحادثة</a>}
        <span className="hidden flex-1 sm:block" />
        <Button disabled={!changed || !online} loading={busy} onClick={save}>حفظ رقم واتساب</Button>
      </>}>
      {q.error && !q.data && q.data !== null ? <Note tone="danger" title="تعذّر تحميل الرقم" action={<Button kind="link" sm onClick={() => void q.reload()}>إعادة المحاولة</Button>}>تأكد من اتصالك ثم حاول مرة أخرى.</Note> : (
        <TextField label="رقم واتساب" optional ltr type="tel" inputMode="tel" value={draft} disabled={q.loading} onChange={(e) => setDraft(e.target.value)} placeholder="010 1234 5678"
          error={digits === null ? 'اكتب رقماً صحيحاً، مثل 010 1234 5678.' : undefined} help={saved ? <>يفتح التطبيق المحادثة مع <span dir="ltr" className="[unicode-bidi:isolate]">{readableWhatsApp(saved)}</span>.</> : 'لا رقم الآن: الزر لا يظهر في التطبيق.'} />
      )}
    </FormSection>
  );
};

