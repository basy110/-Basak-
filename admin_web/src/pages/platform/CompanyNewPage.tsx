import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Dialog, FieldRow, FormSection, Icon, InfoRows, Ltr, Note, Page, PageHeader, PasswordField, PhoneBar, RadioCards,
  Stepper, StepList, TextField, useOnline, type Step,
} from '../../ui';
import { invokeEdgeFunction } from '../../lib/edgeFunctions';
import { keys, STALE, unwrap, usePageData } from '../../lib/query';
import { supabase } from '../../lib/supabase';
import { useGuard } from '../../lib/guard';
import { clockLabel } from '../../lib/time';
import { reminderLabel } from '../../lib/rideConfirmation';
import { useVoteSettings } from '../../lib/linesData';
import { settingsKey } from '../../lib/reference';
import {
  companiesKey, createFailure, createPayload, draftTouched, emptyCompanyDraft, firstBadStep, METHOD_NAME, phoneGroups, saleLine,
  stepErrors, termsLine, useIsPhone, type CompanyDraft, type DraftField, type Errors, type MethodType, type TermRow,
} from '../../lib/platform';

const STEPS = ['بيانات الشركة', 'مدير الشركة', 'وسيلة الدفع', 'المراجعة والإنشاء'];
interface Created { id: string; name: string; invited: boolean; email: string; adminFirst: string; method: boolean }

/**
 * «شركة جديدة» (docs/canvas/AdmPlatCompanyNew1–4, AdmPlatCompanyCreated): the company,
 * its first admin and how students pay it, in four short steps. Nothing is saved
 * before the last one, which creates all of it in one request or nothing; then the
 * page says whether the invitation went out and what remains before a first student.
 */
export const CompanyNewPage: React.FC = () => {
  const navigate = useNavigate();
  const client = useQueryClient();
  const guard = useGuard();
  const online = useOnline();
  const phone = useIsPhone();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<CompanyDraft>(emptyCompanyDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<ReturnType<typeof createFailure> | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const focusField = useRef<DraftField | null>(null);

  const set = <K extends DraftField>(k: K, v: CompanyDraft[K]) => {
    setD((x) => {
      const next = { ...x, [k]: v };
      // The name students see starts from the kind of account; it is theirs to change.
      if (k === 'method' && !x.displayName.trim()) {
        const name = x.name.trim().split(/\s+/)[0] ?? '';
        next.displayName = v === 'instapay' ? `إنستاباي ${name}`.trim() : v === 'vodafone_cash' ? 'محفظة الشركة' : v === 'bank' ? 'حساب الشركة' : '';
      }
      return next;
    });
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const touched = draftTouched(d);

  // A closed tab loses the steps: the browser asks first once anything is typed.
  useEffect(() => {
    if (!touched || created) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [touched, created]);

  // The field to fix gets the focus once its step is on screen.
  useEffect(() => {
    const f = focusField.current;
    if (!f) return;
    focusField.current = null;
    window.setTimeout(() => document.querySelector<HTMLElement>(`[name="${f}"]`)?.focus(), 30);
  }, [step]);

  const go = (to: number, field?: DraftField) => {
    focusField.current = field ?? null;
    setStep(to);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (field) window.setTimeout(() => document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus(), 60);
  };
  const next = () => {
    const e = stepErrors(step, d);
    setErrors(e);
    const bad = Object.keys(e)[0] as DraftField | undefined;
    if (bad) { document.querySelector<HTMLElement>(`[name="${bad}"]`)?.focus(); return; }
    go(step + 1);
  };
  const cancel = () => (touched ? setLeaving(true) : navigate('/platform/companies'));

  const create = () => void guard('create', async () => {
    const bad = firstBadStep(d);
    if (bad >= 0) { setErrors(stepErrors(bad, d)); go(bad, Object.keys(stepErrors(bad, d))[0] as DraftField); return; }
    setSaving(true);
    setFailure(null);
    try {
      const out = await invokeEdgeFunction<{ id: string; name: string; invited: boolean }>('admin-create-company', createPayload(d));
      setCreated({ id: out.id, name: out.name ?? d.name.trim(), invited: !!out.invited, email: d.adminEmail.trim().toLowerCase(), adminFirst: d.adminName.trim().split(/\s+/)[0], method: d.method !== 'later' });
      void client.invalidateQueries({ queryKey: companiesKey });
      void client.invalidateQueries({ queryKey: keys.platform('companyNames') });
      void client.invalidateQueries({ queryKey: keys.platform('overview') });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setFailure(createFailure(err instanceof Error ? err.message : '', d, navigator.onLine));
    } finally {
      setSaving(false);
    }
  });

  if (created) return <CreatedView c={created} />;

  const steps: Step[] = STEPS.map((label, i) => ({ label, state: i < step ? 'done' : i === step ? 'current' : 'todo' }));
  const nextLabel = step < 3 ? `التالي: ${STEPS[step + 1]}` : 'أنشئ الشركة';
  const primary = step < 3
    ? <Button iconEnd="arrowFwd" onClick={next}>{nextLabel}</Button>
    : <Button icon="check" loading={saving} disabled={!online} onClick={create}>أنشئ الشركة</Button>;
  const back = step > 0 ? <Button kind="secondary" icon="arrowBack" disabled={saving} onClick={() => go(step - 1)}>السابق</Button> : null;
  const e = errors;
  const field = (name: DraftField) => ({ name, value: d[name] as string, error: e[name], onChange: (ev: React.ChangeEvent<HTMLInputElement>) => set(name, ev.target.value as never) });

  return (
    <Page>
      <PageHeader title="شركة جديدة" back={{ label: 'الشركات', to: '/platform/companies' }}
        sub={phone ? undefined : 'أربع خطوات قصيرة. تُنشأ الشركة ومديرها ووسيلة دفعها معاً في آخر خطوة، أو لا يُنشأ شيء.'} />
      <Card className="!bg-transparent !shadow-none sm:!bg-surface sm:px-6 sm:py-[18px] sm:!shadow-card"><Stepper steps={steps} /></Card>

      {failure && (
        <Note tone="danger" title="لم تُنشأ الشركة" className="items-center"
          action={failure.step != null
            ? <Button sm kind="outline" onClick={() => go(failure.step!, failure.field)}>{failure.action ?? 'عدّل'}</Button>
            : <Button sm kind="outline" icon="refresh" loading={saving} onClick={create}>حاول مرة أخرى</Button>}>
          {failure.text}
        </Note>
      )}

      {step === 0 && (
        <FormSection title="بيانات الشركة" help="الاسم الذي يراه الطلاب في التطبيق وعلى بطاقاتهم وإيصالاتهم. الشعار والألوان يضبطها مدير الشركة لاحقاً من «بطاقة الطالب».">
          <TextField label="اسم الشركة" {...field('name')} autoComplete="organization" maxLength={80} autoFocus />
          <FieldRow>
            <TextField label="رقم التواصل" optional ltr inputMode="tel" {...field('contactPhone')} help={e.contactPhone ? undefined : 'يظهر للطلاب على بطاقة الطالب.'} maxLength={20} />
            <TextField label="اسم جهة التواصل" optional {...field('contactLabel')} maxLength={40} />
          </FieldRow>
        </FormSection>
      )}

      {step === 1 && (
        <FormSection title="مدير الشركة الأول" help="صاحب الشركة أو من يديرها. يدخل اللوحة ببريده، ويستطيع بعدها أن يعمل وحده. تضيف مديرين آخرين من «مديرو الشركات».">
          <TextField label="اسم مدير الشركة" {...field('adminName')} autoComplete="off" maxLength={80} />
          <TextField label="البريد الإلكتروني" type="email" ltr {...field('adminEmail')} autoComplete="off" help="به يسجّل الدخول. تأكد منه حرفاً حرفاً." />
          <RadioCards label="كيف يحصل على كلمة المرور؟" name="passwordMode" value={d.passwordMode} onChange={(v) => set('passwordMode', v)} cols={2}
              options={[
                { value: 'invite', label: 'أرسل له دعوة بالبريد', sub: 'يفتح الرابط ويختار كلمة المرور بنفسه' },
                { value: 'password', label: 'أكتب كلمة مرور مبدئية الآن', sub: 'تسلّمها له بنفسك' },
              ]} />
          {d.passwordMode === 'password' && (
            <PasswordField label="كلمة المرور المبدئية" {...field('password')} autoComplete="new-password"
              help={e.password ? undefined : '8 أحرف على الأقل. لا يمكن عرضها بعد الإنشاء.'} />
          )}
        </FormSection>
      )}

      {step === 2 && (
        <FormSection title="وسيلة الدفع الأولى" help="الحساب الذي يحوّل عليه الطلاب ثمن الاشتراك. بدون وسيلة دفع لا يستطيع أي طالب أن يدفع لهذه الشركة. يمكن تركها للمدير.">
          <RadioCards<MethodType> label="النوع" name="method" value={d.method} onChange={(v) => set('method', v)} cols={4}
            options={[{ value: 'later', label: 'لاحقاً', sub: 'يضيفها المدير' }, { value: 'instapay', label: 'إنستاباي' }, { value: 'vodafone_cash', label: 'محفظة هاتف' }, { value: 'bank', label: 'حساب بنكي' }]} />
          {d.method === 'later' ? (
            <Note tone="warning" title="ستُنشأ الشركة بلا وسيلة دفع">يظهر لمديرها في صفحة «اليوم» أن هذه أول خطوة عليه، وتظهر لك في «يحتاج قرارك» حتى يضيفها.</Note>
          ) : (
            <>
              <FieldRow>
                <TextField label="الاسم الظاهر للطالب" {...field('displayName')} maxLength={60} />
                <TextField label="اسم صاحب الحساب" optional {...field('accountHolder')} maxLength={80} />
              </FieldRow>
              {d.method === 'instapay' && <TextField label="عنوان إنستاباي" ltr {...field('instapayAddress')} maxLength={80} />}
              {d.method === 'vodafone_cash' && <TextField label="رقم المحفظة" ltr inputMode="tel" {...field('walletPhone')} maxLength={16} help={e.walletPhone ? undefined : '11 رقماً تبدأ بـ 01.'} />}
              {d.method === 'bank' && (
                <>
                  <FieldRow>
                    <TextField label="اسم البنك" {...field('bankName')} maxLength={60} />
                    <TextField label="رقم الحساب" ltr inputMode="numeric" {...field('bankAccount')} maxLength={40} />
                  </FieldRow>
                  <TextField label="رقم الآيبان (IBAN)" optional ltr {...field('iban')} maxLength={40} />
                </>
              )}
            </>
          )}
        </FormSection>
      )}

      {step === 3 && <Review d={d} onEdit={(s) => go(s)} />}

      <div className="hidden items-center gap-3 sm:flex">
        <Button kind="link" onClick={cancel} disabled={saving}>إلغاء</Button>
        <span className="text-label text-ink-2">لا يُحفظ شيء قبل الخطوة الأخيرة</span>
        <span className="flex-1" />
        {back}{primary}
      </div>
      <PhoneBar>
        {React.cloneElement(primary, { full: true, icon: undefined, iconEnd: undefined })}
        {back ? React.cloneElement(back, { full: true, icon: undefined }) : <Button kind="secondary" full onClick={cancel} disabled={saving}>إلغاء</Button>}
      </PhoneBar>

      <Dialog open={leaving} onClose={() => setLeaving(false)} icon="alert" tone="warning" title="ترك إنشاء الشركة؟"
        actions={[
          <Button key="stay" kind="secondary" onClick={() => setLeaving(false)}>أكمل الإنشاء</Button>,
          <Button key="leave" kind="danger" onClick={() => navigate('/platform/companies')}>اترك ولا تحفظ</Button>,
        ]}>
        <p className="m-0">{d.name.trim() ? `لم تُنشأ «${d.name.trim()}» بعد.` : 'لم تُنشأ الشركة بعد.'} إن خرجت الآن يضيع ما كتبته في {step === 0 ? 'هذه الخطوة' : step === 1 ? 'الخطوتين' : 'الخطوات الثلاث'}.</p>
      </Dialog>
    </Page>
  );
};

/** Step 4: what was typed, and what the company starts with from the platform's defaults. */
const Review: React.FC<{ d: CompanyDraft; onEdit: (step: number) => void }> = ({ d, onEdit }) => {
  const settings = usePageData(settingsKey(null), () => unwrap<{ terms: TermRow[] }>(supabase.rpc('get_subscription_settings', { p_company_id: null })), { staleTime: STALE.reference });
  const vote = useVoteSettings(null);
  const terms = settings.data?.terms ?? [];
  const v = vote.data;
  const part = (title: string, s: number, rows: [React.ReactNode, React.ReactNode][]) => (
    <div className="flex flex-col">
      <div className="flex items-center gap-2"><h3 className="m-0 flex-1 text-small font-semibold">{title}</h3><Button kind="link" sm onClick={() => onEdit(s)}>تعديل</Button></div>
      <InfoRows labelW={120} rows={rows} />
    </div>
  );
  const method = d.method === 'later' ? null : d.method;
  return (
    <>
      <FormSection title="ما كتبته" help="راجعه قبل الإنشاء. اضغط «تعديل» لتعود إلى خطوته.">
        {part('بيانات الشركة', 0, [
          ['الاسم', d.name.trim()],
          ['التواصل', d.contactPhone.trim() || d.contactLabel.trim()
            ? <span>{d.contactPhone.trim() && <Ltr>{phoneGroups(d.contactPhone)}</Ltr>}{d.contactPhone.trim() && d.contactLabel.trim() && ' · '}{d.contactLabel.trim()}</span>
            : <span className="text-ink-3">لم يُكتب</span>],
        ])}
        {part('مدير الشركة', 1, [
          ['الاسم', d.adminName.trim()],
          ['البريد', <Ltr>{d.adminEmail.trim().toLowerCase()}</Ltr>],
          ['كلمة المرور', d.passwordMode === 'invite' ? 'تصله دعوة بالبريد ليختارها' : 'كتبتها أنت، وتسلّمها له بنفسك'],
        ])}
        {part('وسيلة الدفع', 2, method ? [
          ['النوع', `${METHOD_NAME[method]} · «${d.displayName.trim()}»`],
          ...(method === 'instapay' ? [['العنوان', <Ltr>{d.instapayAddress.trim()}</Ltr>]] as [string, React.ReactNode][] : []),
          ...(method === 'vodafone_cash' ? [['الرقم', <Ltr>{phoneGroups(d.walletPhone)}</Ltr>]] as [string, React.ReactNode][] : []),
          ...(method === 'bank' ? [['البنك', d.bankName.trim()], ['رقم الحساب', <Ltr>{d.bankAccount.trim()}</Ltr>]] as [string, React.ReactNode][] : []),
          ...(d.accountHolder.trim() ? [['صاحب الحساب', d.accountHolder.trim()]] as [string, React.ReactNode][] : []),
        ] : [['النوع', <span className="text-warn">لاحقاً: يضيفها المدير. لا يستطيع طالب أن يدفع قبلها</span>]])}
      </FormSection>
      <FormSection title="ما تأخذه الشركة من إعدادات المنصة" help="تبدأ الشركة بهذه القيم ثم يغيّرها مديرها متى أراد. تغييرك لـ«الإعدادات الافتراضية» بعد اليوم لا يمس مواعيد فصولها.">
        <InfoRows labelW={120} rows={[
          ['مواعيد الفصول', terms.length ? `نسخة خاصة بها: ${termsLine(terms)}` : settings.error ? 'نسخة من مواعيد المنصة' : '…'],
          ['معروض للبيع', terms.length ? saleLine(terms) : '…'],
          ['تأكيد الركوب', v ? `تتبع المنصة: يفتح ${clockLabel(v.opens_at)} ويُقفل ${clockLabel(v.closes_at)}، ${v.reminder_minutes ? `تذكير ${reminderLabel(v.reminder_minutes)}` : 'بلا تذكير'} — حتى يحدد المدير مواعيده` : vote.error ? 'تتبع مواعيد المنصة حتى يحدد المدير مواعيده' : '…'],
          ['بطاقة الطالب', 'التصميم الافتراضي بألوان باصك، حتى يضع المدير شعاره'],
          ['ما لا يُنسخ', 'الخطوط والأسعار والمشرفون: يضيفها المدير، وتظهر له خطوات التجهيز في صفحة «اليوم»'],
        ]} />
      </FormSection>
    </>
  );
};

/** After the last step (AdmPlatCompanyCreated): whether the invitation went out, and what remains before a first student. */
const CreatedView: React.FC<{ c: Created }> = ({ c }) => {
  const steps: (Step & { body?: React.ReactNode })[] = [
    { label: c.method ? 'الشركة ومديرها ووسيلة الدفع' : 'الشركة ومديرها', state: 'done',
      sub: c.invited ? `أُنشئت معاً. أُرسلت الدعوة إلى ${c.email}` : `أُنشئت معاً. يدخل المدير بـ ${c.email} وكلمة المرور التي كتبتها.` },
    ...(!c.method ? [{ label: 'وسيلة دفع', state: 'current' as const, sub: 'حساب يحوّل عليه الطلاب ثمن الاشتراك. بدونها لا يستطيع طالب أن يدفع.' }] : []),
    { label: 'أول خط', state: c.method ? 'current' : 'todo', sub: 'جامعة واحدة على الأقل، محطات، رحلة ذهاب ورحلة عودة، وسعر. بدونه لا يرى الطلاب الشركة.' },
    { label: 'مشرف', state: 'todo', sub: 'من يركب الباص ويسجّل صعود الطلاب. يلزمه خط.' },
  ];
  const go = <Button iconEnd="fwd" to={c.method ? `/c/${c.id}/lines/new` : `/c/${c.id}/payment-methods`}>{c.method ? 'ادخل إلى الشركة وأضف أول خط' : 'ادخل إلى الشركة وأضف وسيلة الدفع'}</Button>;
  const back = <Button kind="secondary" to="/platform/companies">العودة إلى الشركات</Button>;
  return (
    <Page>
      <PageHeader title="شركة جديدة" back={{ label: 'الشركات', to: '/platform/companies' }} />
      <Card className="flex w-full max-w-[760px] flex-col gap-5 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ok-bg text-ok"><Icon name="check" size={22} stroke={2.25} /></span>
          <div className="flex min-w-0 flex-col" role="status">
            <h2 className="m-0 text-section">أُنشئت «{c.name}»</h2>
            <p className="m-0 text-label text-ink-2">لا يراها الطلاب بعد: ينقصها {c.method ? 'خط' : 'وسيلة دفع وخط'}.</p>
          </div>
        </div>
        {c.invited ? (
          <Note tone="teal" icon="mail" title={`أُرسلت الدعوة إلى بريد ${c.adminFirst}`}>
            يفتح الرابط ويختار كلمة المرور. الرابط صالح 24 ساعة؛ إن لم يصله فاحذف حسابه من «مديرو الشركات» وأضفه من جديد.
          </Note>
        ) : (
          <Note tone="teal" icon="key" title={`حساب ${c.adminFirst} جاهز`}>
            يدخل ببريده وكلمة المرور التي كتبتها. سلّمها له بنفسك؛ لا يمكن عرضها بعد الآن، ويستطيع تغييرها من «نسيت كلمة المرور؟».
          </Note>
        )}
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-card">ما بقي حتى يشترك أول طالب</h3>
          <StepList steps={steps} />
          <p className="m-0 text-label text-ink-2">هذه الخطوات نفسها تظهر لـ{c.adminFirst} في صفحة «اليوم» عند أول دخول. تستطيع أن تبدأها أنت الآن من داخل لوحة الشركة.</p>
        </section>
        <div className="hidden justify-end gap-2 border-t border-hair pt-4 sm:flex">{back}{go}</div>
      </Card>
      <PhoneBar>{React.cloneElement(go, { full: true, children: c.method ? 'ادخل وأضف أول خط' : 'ادخل وأضف وسيلة الدفع' })}{React.cloneElement(back, { full: true })}</PhoneBar>
    </Page>
  );
};
