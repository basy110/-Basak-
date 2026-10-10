import React, { useState } from 'react';
import { audienceFromSpec, audienceToPayload, draftProblem, studentsText, supervisorsText, type HistoryRow, type NotificationDraft } from '../../lib/notifications';
import { cairoLocalToIso, cairoToday, isoToCairoLocal } from '../../lib/time';
import { updateScheduledNotification, useAudiencePreview, useNotificationActions } from '../../lib/notificationsData';
import { useLineOptions } from '../../lib/reference';
import { useGuard } from '../../lib/guard';
import { notifyDone } from '../../lib/toasts';
import { Button, Note, SidePanel, StatePill, errorText } from '../../ui';
import { useCompanyOverview } from '../../lib/overview';
import { NotificationForm } from './NotificationForm';

/** A scheduled notification before it goes out: its words, its audience and its time can still change. */
export const EditScheduledDialog: React.FC<{ companyId: string; row: HistoryRow; onClose: () => void; onCancelSend?: () => void }> = ({ companyId, row, onClose, onCancelSend }) => {
  const [today] = useState(() => cairoToday());
  const [draft, setDraft] = useState<NotificationDraft>(() => ({
    title: row.title, body: row.body, audience: audienceFromSpec(row.audience_spec, today),
    priority: row.priority === 'high' ? 'high' : 'normal', when: 'later',
    scheduledLocal: row.scheduled_at ? isoToCairoLocal(row.scheduled_at) : '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = useLineOptions(companyId);
  const members = useCompanyOverview(companyId).data?.members ?? null;
  const guard = useGuard();
  const audience = audienceToPayload(draft.audience);
  const preview = useAudiencePreview(companyId, audience);
  const { refresh } = useNotificationActions(companyId);
  const problem = draftProblem(draft);
  const students = preview.status === 'ready' ? preview.data?.students ?? 0 : 0;
  const canSave = !problem && preview.status === 'ready' && students > 0;

  const save = () => guard('save', async () => {
    const scheduledAt = cairoLocalToIso(draft.scheduledLocal);
    const late = draftProblem(draft);
    if (late || !audience || !scheduledAt) { if (late) setError(late); return; }
    setBusy(true);
    setError('');
    try {
      await updateScheduledNotification({ id: row.id, title: draft.title.trim(), body: draft.body.trim(), audience, scheduledAt });
      notifyDone('حُفظ تعديل الإشعار المجدول');
      void refresh(row.id);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  });

  return (
    <SidePanel open onClose={() => { if (!busy) onClose(); }} title="تعديل إشعار مجدول" meta={<StatePill state="scheduled" />} sub="لم يُرسل بعد: تستطيع تغيير كلماته ومستلميه وموعده." w={560} backLabel="الإشعارات"
      footer={(
        <>
          {onCancelSend && <Button kind="dangerQuiet" icon="x" onClick={onCancelSend} disabled={busy}>إلغاء الإرسال</Button>}
          <span className="hidden flex-1 sm:block" />
          <Button kind="secondary" onClick={onClose} disabled={busy} className="hidden sm:inline-flex">رجوع</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!canSave}>حفظ التعديل</Button>
        </>
      )}>
      {!row.audience_spec && <Note tone="warning" title="اختر المستلمين من جديد">تعذّرت قراءة المستلمين المحفوظين لهذا الإشعار ({row.audience || 'غير معروف'}).</Note>}
      <NotificationForm draft={draft} onChange={(next) => { setDraft(next); setError(''); }} lines={options.data?.lines ?? []} plain showErrors companyCount={members}
        universities={options.data?.universities ?? []} optionsLoading={options.loading} today={today} scheduledOnly disabled={busy} />
      <div className="rounded-inner bg-ground px-4 py-3">
        <div className="text-small font-semibold">{preview.status === 'ready' && preview.data
          ? `يصل إلى ${studentsText(preview.data.students)}${preview.data.supervisors ? ` و${supervisorsText(preview.data.supervisors)}` : ''}` : 'نحسب المستلمين…'}</div>
        <div className="text-label text-ink-2">يُحسب المستلمون من جديد عند الإرسال.</div>
      </div>
      {error && <Note tone="danger" title="لم يُحفظ التعديل">{error}</Note>}
    </SidePanel>
  );
};
