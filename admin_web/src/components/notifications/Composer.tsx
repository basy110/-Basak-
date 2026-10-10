import React, { useRef, useState } from 'react';
import { notifyDone } from '../../lib/toasts';
import {
  audienceToPayload, draftProblem, emptyDraft, idempotencyKeyFor, isDirty, studentsText, supervisorsText, type AudiencePreview, type NotificationDraft,
} from '../../lib/notifications';
import { CAIRO_LABEL, cairoLocalToIso, cairoToday } from '../../lib/time';
import { composeNotification, useAudiencePreview, useNotificationActions } from '../../lib/notificationsData';
import { useLineOptions } from '../../lib/reference';
import { useCompanyOverview } from '../../lib/overview';
import { Button, Note, PageHeader, PhoneBar, errorText, useOnline } from '../../ui';
import { whenLabel } from '../../lib/notifications';
import { NotificationForm } from './NotificationForm';
import { PhonePreview } from './PhonePreview';
import { AudiencePreviewCard, ConfirmDialog } from './parts';
import { LeaveDialog, useLeaveGuard } from '../money/LeaveGuard';

/** Ready-made messages: [button, title, text]. */
export const TEMPLATES: [string, string, string][] = [
  ['إجازة رسمية', 'إجازة رسمية', 'غداً إجازة رسمية ولا توجد رحلات. تعود الرحلات في مواعيدها بعد الإجازة.'],
  ['تعديل المواعيد', 'تعديل مواعيد الرحلات', 'تم تعديل مواعيد بعض الرحلات، راجع مواعيدك في التطبيق قبل تأكيد الركوب.'],
  ['تذكير بالدفع', 'تذكير بسداد الاشتراك', 'اقترب موعد سداد الاشتراك. ادفع من صفحة الاشتراك في التطبيق لتستمر رحلاتك.'],
];

/**
 * «إشعار جديد»: who gets it (counted by the server before anything is sent),
 * what it says, and whether it goes now or at a set Cairo time.
 */
export const Composer: React.FC<{ companyId: string; onBack?: () => void; onDone?: () => void; backTo?: string }> = ({ companyId, onBack, onDone, backTo }) => {
  const online = useOnline();
  const [today] = useState(() => cairoToday());
  const [draft, setDraft] = useState<NotificationDraft>(() => emptyDraft(today));
  // The audience as it was counted when the admin pressed send: what the confirmation restates.
  const [confirming, setConfirming] = useState<AudiencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);
  const inFlight = useRef(false);

  // One key per notification being written: a retry or a double click repeats it, so the server sends once.
  const idempotencyKey = useRef<string | null>(null);
  idempotencyKey.current = idempotencyKeyFor(idempotencyKey.current, isDirty(draft));

  const options = useLineOptions(companyId);
  const members = useCompanyOverview(companyId).data?.members ?? null;
  const audience = audienceToPayload(draft.audience);
  const preview = useAudiencePreview(companyId, audience);
  const { refresh } = useNotificationActions(companyId);

  const problem = draftProblem(draft);
  const students = preview.status === 'ready' ? preview.data?.students ?? 0 : 0;
  const canSend = !problem && preview.status === 'ready' && students > 0 && online;
  const scheduled = draft.when === 'later';
  const scheduledIso = scheduled ? cairoLocalToIso(draft.scheduledLocal) : null;
  const leave = useLeaveGuard(isDirty(draft) && !busy);

  const change = (next: NotificationDraft) => { setDraft(next); setError(''); };
  const ask = () => { setTried(true); if (canSend && preview.data) { setError(''); setConfirming(preview.data); } };

  const send = async () => {
    if (inFlight.current) return;
    // The minutes spent on the confirmation may have carried a scheduled time into the past.
    const late = draftProblem(draft);
    if (late || !audience || !idempotencyKey.current) { setError(late || 'أكمل بيانات الإشعار.'); return; }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await composeNotification(companyId, {
        title: draft.title.trim(), body: draft.body.trim(), audience,
        scheduledAt: scheduledIso, idempotencyKey: idempotencyKey.current, priority: draft.priority,
      });
      // `duplicate` means an earlier attempt with this key already went through: the same success, said once.
      notifyDone(result.status === 'scheduled' ? 'جُدول الإشعار' : 'أُرسل الإشعار',
        result.status === 'scheduled' ? `يُرسل إلى ${confirming?.label ?? 'المستلمين'} في موعده.` : `وصل إلى ${studentsText(result.students)} داخل التطبيق.`);
      idempotencyKey.current = null;
      setDraft(emptyDraft(today));
      setConfirming(null);
      void refresh(result.id);
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const reach = (c: AudiencePreview) => `${studentsText(c.students)}${c.supervisors ? ` و${supervisorsText(c.supervisors)}` : ''}`;
  const sendLabel = scheduled ? 'جدولة الإشعار' : 'إرسال الإشعار';
  return (
    <>
      <PageHeader title="إشعار جديد" back={backTo ? { label: 'الإشعارات', to: backTo } : undefined} phoneActions={false}
        actions={<>
          <Button kind="secondary" onClick={() => (isDirty(draft) && backTo ? leave.ask(backTo) : onBack?.())}>رجوع</Button>
          <Button icon="megaphone" disabled={busy || (tried && !canSend)} onClick={ask}>{sendLabel}</Button>
        </>} />
      <form className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <div className="flex flex-col gap-4 lg:gap-6">
          <NotificationForm draft={draft} onChange={change} lines={options.data?.lines ?? []} universities={options.data?.universities ?? []}
            optionsLoading={options.loading} today={today} disabled={busy} templates={TEMPLATES} companyCount={members} showErrors={tried} />
          {options.error && <Note tone="danger" title="تعذّر تحميل الخطوط والجامعات">{errorText(options.error)}</Note>}
          {error && !confirming && <Note tone="danger" title="لم يُرسل الإشعار">{error}</Note>}
        </div>
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:gap-6">
          <section className="hidden flex-col gap-3 rounded-card bg-surface px-4 py-4 shadow-card sm:px-5 lg:flex">
            <h3 className="m-0 text-card">كما يظهر على هاتف الطالب</h3>
            <PhonePreview title={draft.title} body={draft.body} high={draft.priority === 'high'} />
          </section>
          <AudiencePreviewCard preview={preview} hint={draft.audience.kind === 'university' ? 'اختر الجامعة لنحسب عدد من يصلهم.' : draft.audience.kind === 'company' ? undefined : 'اختر الخط لنحسب عدد من يصلهم.'} />
        </div>
      </form>
      <PhoneBar><Button full icon="megaphone" disabled={busy || (tried && !canSend)} onClick={ask}>{sendLabel}</Button></PhoneBar>

      {confirming && (
        <ConfirmDialog title={scheduled ? 'جدولة الإشعار؟' : `إرسال الإشعار إلى ${studentsText(confirming.students)}؟`} busy={busy} error={error}
          confirmLabel={scheduled ? 'جدولة الإشعار' : `إرسال إلى ${studentsText(confirming.students)}`} icon={scheduled ? 'calendar' : 'megaphone'}
          onConfirm={() => void send()} onClose={() => { setConfirming(null); setError(''); }}>
          {scheduled && scheduledIso ? (
            <p className="m-0">يُرسل إلى <b className="text-ink">{confirming.label}</b> ({reach(confirming)}) {/^(اليوم|غداً)/.test(whenLabel(scheduledIso)) ? '' : 'يوم '}<b className="text-ink">{whenLabel(scheduledIso).replace(' · ', '، ')}</b> {CAIRO_LABEL}. يُحسب المستلمون من جديد عند الإرسال، ويمكنك تعديله أو إلغاؤه قبل موعده.</p>
          ) : (
            <>
              <p className="m-0">يصل الآن إلى <b className="text-ink">{confirming.label}</b> ({reach(confirming)}). لا يمكن تعديله بعد الإرسال، ويمكن حذفه من عندهم.</p>
              <PhonePreview title={draft.title} body={draft.body} high={draft.priority === 'high'} className="!max-w-[280px]" />
            </>
          )}
        </ConfirmDialog>
      )}
      <LeaveDialog guard={leave} what="كتبت إشعاراً" />
    </>
  );
};
