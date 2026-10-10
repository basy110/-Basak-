import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, Icon, Note, Page, PageHeader, Section, StepList, clock, NOUN, type IconName } from '../../ui';
import { useAdminScope } from '../../lib/adminScope';
import { cannotSubscribeText, nOf, onSaleText, ridersTitle, setupSteps, type CompanyToday } from '../../lib/today';

/**
 * «اليوم» of a company still being set up (docs/canvas/AdmTodayNew, AdmTodayNewPhone):
 * the three steps before a first subscription instead of a page of zeros. Its own
 * chunk: an established company's first page never downloads it.
 */
/* ── First run: «أهلاً كريم، لنجهّز شركتك» ──────────────────────────── */
const LaterRow: React.FC<{ icon: IconName; title: string; sub: React.ReactNode; to: string }> = ({ icon, title, sub, to }) => {
  const navigate = useNavigate();
  return (
    <li className="border-t border-hair">
      <button type="button" onClick={() => navigate(to)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-start hover:bg-ground sm:px-5">
        <Icon name={icon} size={20} className="text-ink-2" />
        <span className="flex min-w-0 flex-1 flex-col"><span className="text-small font-semibold">{title}</span><span className="text-label text-ink-2">{sub}</span></span>
        <Icon name="fwd" size={18} className="text-ink-3" />
      </button>
    </li>
  );
};

export const FirstRun: React.FC<{ data: CompanyToday; base: string }> = ({ data, base }) => {
  const admin = useAdminScope();
  const steps = setupSteps(data);
  const blocked = cannotSubscribeText(data);
  const first = data.setup.first_line;
  const firstName = (admin.full_name || '').trim().split(/\s+/)[0];
  const greeting = admin.role === 'super_admin' ? `لنجهّز ${data.company.name}` : `أهلاً${firstName ? ` ${firstName}` : ''}، لنجهّز شركتك`;
  const stepButton = (state: string, label: string, to: string, disabled = false) => (
    <div className="mt-3"><Button kind={state === 'current' ? 'primary' : 'secondary'} icon="plus" to={to} disabled={disabled} className="max-sm:w-full">{label}</Button></div>
  );
  const seeLink = (label: string, to: string) => <div className="mt-2"><Button kind="link" sm iconEnd="fwd" to={to}>{label}</Button></div>;
  const doneCount = steps.done === 0 ? 'لم تتم أي خطوة بعد' : steps.done === 3 ? 'تمت الخطوات الثلاث' : `تمت ${steps.done === 1 ? 'خطوة واحدة' : 'خطوتان'} من 3`;
  return (
    <Page>
      <div className="sr-only"><PageHeader title="اليوم" /></div>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-page-phone sm:text-page">{greeting}</h2>
        <p className="m-0 text-small text-ink-2">ثلاث خطوات، وبعدها يستطيع أول طالب أن يشترك من التطبيق.</p>
      </div>
      <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Card className="flex flex-col gap-5 p-4 sm:p-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2"><h3 className="m-0 text-section">تجهيز الشركة</h3><span className="flex-1" /><span className="text-label text-ink-2">{doneCount}</span></div>
            <div aria-hidden="true" className="grid grid-cols-3 gap-1">
              {[steps.line, steps.pay, steps.sup].map((s, i) => <span key={i} className={`h-1 rounded-sm ${s === 'done' ? 'bg-ok' : 'bg-sunken'}`} />)}
            </div>
          </div>
          <StepList steps={[
            {
              label: 'أضف أول خط', state: steps.line,
              sub: first ? `خط ${first.name} · ${nOf(first.stations, NOUN.station)} · ${nOf(first.departures, ['رحلة ذهاب', 'رحلتا ذهاب', 'رحلات ذهاب', 'رحلة ذهاب'])} و${nOf(first.returns, ['رحلة عودة', 'رحلتا عودة', 'رحلات عودة', 'رحلة عودة'])}`
                : 'محطاته ومواعيد رحلاته وأسعاره. يراه الطلاب في التطبيق ويختارونه عند الاشتراك.',
              body: first ? seeLink('عرض الخط', `${base}/lines/${first.id}`) : stepButton(steps.line, 'أضف خطاً', `${base}/lines/new`),
            },
            {
              label: 'أضف وسيلة دفع', state: steps.pay,
              sub: data.setup.payment_methods > 0 ? `${nOf(data.setup.payment_methods, ['وسيلة مفعّلة', 'وسيلتان مفعّلتان', 'وسائل مفعّلة', 'وسيلة مفعّلة'])}`
                : 'الحساب الذي يحوّل عليه الطلاب ثمن الاشتراك: إنستاباي، محفظة هاتف، أو حساب بنكي. بدونها لا يستطيع أحد أن يدفع.',
              body: data.setup.payment_methods > 0 ? seeLink('عرض وسائل الدفع', `${base}/payment-methods`) : stepButton(steps.pay, 'أضف وسيلة دفع', `${base}/payment-methods`),
            },
            {
              label: 'أضف مشرفاً', state: steps.sup,
              sub: data.setup.supervisors > 0 ? nOf(data.setup.supervisors, NOUN.supervisor)
                : `من يركب مع الباص ويسجّل صعود الطلاب بهاتفه. يلزمه خط واحد على الأقل${data.setup.lines > 0 ? '، وقد أضفته.' : '؛ أضف الخط أولاً.'}`,
              body: data.setup.supervisors > 0 ? seeLink('عرض المشرفين', `${base}/supervisors`) : stepButton(steps.sup, 'أضف مشرفاً', `${base}/supervisors`, data.setup.lines === 0),
            },
          ]} />
          <div className="flex items-start gap-3 border-t border-hair pt-4">
            <Icon name="users" size={20} className="mt-0.5 text-ink-2" />
            <div className="min-w-0 flex-1"><div className="text-small font-semibold">بعدها: أول طالب يشترك</div><div className="text-label text-ink-2">سيصلك إيصاله في صفحة «الإيصالات» لتراجعه، ويظهر هنا عدد الركاب كل يوم.</div></div>
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          {blocked && <Note tone="warning" title="لا يستطيع الطلاب الاشتراك بعد">{blocked}</Note>}
          <Card as="section" className="overflow-hidden">
            <div className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5"><h3 className="m-0 text-card">لاحقاً، متى أردت</h3><p className="m-0 text-label text-ink-2">تعمل الآن بإعدادات المنصة. غيّرها عندما تحتاج.</p></div>
            <ul className="m-0 list-none p-0">
              <LaterRow icon="calendar" title="مواعيد الاشتراك" sub={onSaleText(data.setup.on_sale)} to={`${base}/subscription-periods`} />
              <LaterRow icon="clock" title="تأكيد الركوب" sub={data.vote_closes_at ? `يؤكد الطلاب حتى ${clock(data.vote_closes_at)} كل يوم` : 'متى يؤكد الطلاب ركوبهم'} to={`${base}/ride-confirmation`} />
              <LaterRow icon="idcard" title="بطاقة الطالب" sub={data.setup.wallet_custom ? 'بشعار شركتك وألوانها' : 'بالشعار والألوان الافتراضية'} to={`${base}/wallet-card`} />
              <LaterRow icon="building" title="بيانات الإيصال" sub={data.setup.receipt_info ? 'مكتوبة وتُطبع على كل إيصال' : 'لم تُكتب بعد'} to={`${base}/receipt-details`} />
            </ul>
          </Card>
        </div>
      </div>
      <Section title={ridersTitle(data.today, data.ride_date)}>
        <EmptyState card icon="users" title="لا ركاب بعد" text="عندما يشترك الطلاب ويؤكدون ركوبهم كل مساء، ترى هنا عدد ركاب الغد في كل خط لتعرف كم باصاً تحتاج." />
      </Section>
    </Page>
  );
};
