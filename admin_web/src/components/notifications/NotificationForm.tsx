import React from 'react';
import type { LineOption, UniversityOption } from '../../lib/lineOptions';
import { BODY_MAX, TITLE_MAX, dayLong, scheduleProblem, type NotificationDraft } from '../../lib/notifications';
import { CAIRO_LABEL, isoToCairoLocal } from '../../lib/time';
import { Chip, FieldRow, RadioCards, TextArea, TextField, Toggle } from '../../ui';
import { AudiencePicker } from './AudiencePicker';

interface Props {
  draft: NotificationDraft;
  onChange: (next: NotificationDraft) => void;
  lines?: LineOption[];
  universities?: UniversityOption[];
  optionsLoading?: boolean;
  /** Another way to choose who gets it (the platform's companies), in place of the company's own audience picker. */
  audience?: React.ReactNode;
  today: string;
  /** Editing a scheduled notification: it stays scheduled, and its urgency is not part of the edit. */
  scheduledOnly?: boolean;
  disabled?: boolean;
  /** Ready-made messages: [button, title, text]. */
  templates?: [string, string, string][];
  /** Without the three numbered cards (inside a panel). */
  plain?: boolean;
  /** How many students the company has (under «كل طلاب الشركة»). */
  companyCount?: number | null;
  /** Say what is missing under each field (after a first try, or as soon as it is wrong). */
  showErrors?: boolean;
  /** Under «إلى من؟» on a phone (the reach card). */
  afterAudience?: React.ReactNode;
}

const Counter: React.FC<{ n: number; max: number }> = ({ n, max }) => (
  <span className={`text-cap font-normal tabular ${n > max ? 'font-semibold text-bad' : 'text-ink-3'}`} dir="ltr">{n} / {max}</span>
);

const Section: React.FC<{ n: number; title: string; plain?: boolean; children: React.ReactNode }> = ({ n, title, plain, children }) => (plain ? <>{children}</> : (
  <section className="flex flex-col gap-4 rounded-card bg-surface px-4 py-4 shadow-card sm:px-6 sm:py-6">
    <h2 className="m-0 text-card sm:text-section"><span className="tabular">{n}</span> · {title}</h2>
    {children}
  </section>
));

/** The fields of a notification, shared by the composer and by the edit of a scheduled one. */
export const NotificationForm: React.FC<Props> = ({
  draft, onChange, lines = [], universities = [], optionsLoading, audience, today, scheduledOnly, disabled, templates, plain, companyCount, showErrors, afterAudience,
}) => {
  const set = (patch: Partial<NotificationDraft>) => onChange({ ...draft, ...patch });
  const later = scheduledOnly || draft.when === 'later';
  const [day, time] = (draft.scheduledLocal || '').split('T');
  const timeProblem = later && draft.scheduledLocal ? scheduleProblem(draft.scheduledLocal) : '';
  const titleOver = draft.title.trim().length - TITLE_MAX;
  const titleError = titleOver > 0 ? `العنوان أطول من ${TITLE_MAX} حرفاً. اختصره بـ ${titleOver} ${titleOver <= 10 ? 'أحرف' : 'حرفاً'}.`
    : showErrors && !draft.title.trim() ? 'اكتب عنوان الإشعار.' : undefined;
  const bodyError = draft.body.trim().length > BODY_MAX ? `النص أطول من ${BODY_MAX} حرف.` : showErrors && !draft.body.trim() ? 'اكتب نص الإشعار.' : undefined;
  const setWhen = (local: string) => set({ scheduledLocal: local });

  return (
    <>
      <Section n={1} title="إلى من؟" plain={plain}>
        {audience ?? (
          <AudiencePicker value={draft.audience} onChange={(next) => set({ audience: next })} lines={lines} universities={universities}
            today={today} loading={optionsLoading} disabled={disabled} companyCount={companyCount} showErrors={showErrors} />
        )}
      </Section>
      {afterAudience}

      <Section n={2} title="الرسالة" plain={plain}>
        {templates && templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label text-ink-2">رسائل جاهزة</span>
            {templates.map(([label, title, body]) => (
              <Chip key={label} on={draft.title === title && draft.body === body} onClick={() => { if (!disabled) set({ title, body }); }}>{label}</Chip>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nt-title" className="flex items-baseline gap-2 text-label font-medium text-ink"><span>العنوان</span><span className="flex-1" /><Counter n={draft.title.length} max={TITLE_MAX} /></label>
          <TextField id="nt-title" value={draft.title} maxLength={TITLE_MAX + 40} placeholder="مثال: إجازة رسمية" disabled={disabled}
            onChange={(e) => set({ title: e.target.value })} error={titleError} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="nt-body" className="flex items-baseline gap-2 text-label font-medium text-ink"><span>نص الإشعار</span><span className="flex-1" /><Counter n={draft.body.length} max={BODY_MAX} /></label>
          <TextArea id="nt-body" rows={4} value={draft.body} maxLength={BODY_MAX + 100} placeholder="اكتب ما تريد أن يعرفه الطلاب" disabled={disabled}
            onChange={(e) => set({ body: e.target.value })} error={bodyError} />
        </div>
        {!scheduledOnly && (
          <Toggle label="عاجل" help="للأمور العاجلة فقط، مثل تغيير يخص رحلة اليوم." checked={draft.priority === 'high'} disabled={disabled}
            onChange={(on) => set({ priority: on ? 'high' : 'normal' })} />
        )}
      </Section>

      <Section n={3} title="متى؟" plain={plain}>
        {!scheduledOnly && (
          <RadioCards<'now' | 'later'> label="موعد الإرسال" cols={2} value={draft.when} onChange={(when) => {
            if (disabled) return;
            // A sensible start for the picker: an hour from now, Cairo time.
            set({ when, scheduledLocal: when === 'later' && !draft.scheduledLocal ? isoToCairoLocal(new Date(Date.now() + 3_600_000)).replace(/:\d\d$/, ':00') : draft.scheduledLocal });
          }} options={[{ value: 'now', label: 'الآن', disabled }, { value: 'later', label: 'في موعد لاحق', disabled }]} />
        )}
        {later && (
          <FieldRow cols="repeat(2, minmax(0, 1fr))">
            <TextField label="اليوم" type="date" ltr min={today} value={day ?? ''} disabled={disabled}
              onChange={(e) => setWhen(`${e.target.value}T${time || '09:00'}`)}
              error={timeProblem || (showErrors && !day ? 'اختر يوم الإرسال.' : undefined)} help={day ? dayLong(day) : undefined} />
            <TextField label="الساعة" type="time" ltr value={time ?? ''} disabled={disabled} help={CAIRO_LABEL}
              onChange={(e) => setWhen(`${day || today}T${e.target.value}`)} />
          </FieldRow>
        )}
      </Section>
    </>
  );
};
