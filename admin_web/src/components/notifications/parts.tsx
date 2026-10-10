import React from 'react';
import { Button, Dialog as UiDialog, Icon, Note, SkeletonBar, type IconName, type Tone } from '../../ui';
import type { AudiencePreviewState } from '../../lib/notificationsData';
import { phonesText, supervisorsText } from '../../lib/notifications';

/** Kept for older callers: the design system's own field look now lives in ui/Field. */
export const fieldClass = 'mt-1 w-full rounded-control bg-surface px-3 h-11 text-small shadow-field outline-none focus:!shadow-field-focus disabled:bg-ground';
export const labelClass = 'text-label font-medium text-ink';

/** A centred dialog over the page (the design system's), wide when asked. */
export const Dialog: React.FC<{ title: React.ReactNode; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => (
  <UiDialog open onClose={onClose} title={title} w={wide ? 720 : 480}>{children}</UiDialog>
);

interface ConfirmProps {
  title: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
  children: React.ReactNode;
  icon?: IconName;
  tone?: Tone;
}

/** One question with its consequence spelled out, before anything is sent or removed. Cancel is «رجوع». */
export const ConfirmDialog: React.FC<ConfirmProps> = ({ title, confirmLabel, busy, danger, error, onConfirm, onClose, children, icon, tone }) => (
  <UiDialog open onClose={() => { if (!busy) onClose(); }} title={title} icon={icon ?? (danger ? 'trash' : 'megaphone')} tone={tone ?? (danger ? 'danger' : 'teal')}
    actions={[
      <Button key="b" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>,
      <Button key="c" kind={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>,
    ]}>
    {children}
    {error && <Note tone="danger" title="لم يتم">{error}</Note>}
  </UiDialog>
);

/** «من سيصله الإشعار»: who would receive it, as the server counts them right now. */
export const AudiencePreviewCard: React.FC<{ preview: AudiencePreviewState; hint?: string; className?: string }> = ({ preview, hint, className = '' }) => {
  const d = preview.data;
  const short = d ? d.label.replace(/^طلاب /, '') : '';
  return (
    <section aria-live="polite" className={`flex flex-col gap-2 rounded-card bg-surface px-4 py-4 shadow-card sm:px-5 ${className}`}>
      <h3 className="m-0 text-label font-medium text-ink-2">من سيصله الإشعار</h3>
      {preview.status === 'incomplete' && <p className="m-0 text-small text-ink-2">{hint || 'أكمل اختيار المستلمين لنحسب عدد من يصلهم.'}</p>}
      {preview.status === 'loading' && <div aria-busy="true" className="flex flex-col gap-2"><SkeletonBar w={140} h={26} /><SkeletonBar w={200} h={10} /></div>}
      {preview.status === 'error' && <p role="alert" className="m-0 text-small text-bad">تعذّر حساب المستلمين. غيّر الاختيار أو حاول بعد قليل.</p>}
      {preview.status === 'ready' && d && (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={`text-num-phone tabular ${d.students === 0 ? 'text-bad' : ''}`}>{d.students.toLocaleString('en-US')}</span>
            <span className="text-small font-medium">{d.students === 1 ? 'طالب' : d.students === 2 ? 'طالبان' : d.students <= 10 && d.students > 0 ? 'طلاب' : 'طالباً'} · {short}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-label text-ink-2">
            {d.supervisors > 0 && <span className="inline-flex items-center gap-1.5"><Icon name="scan" size={14} />{supervisorsText(d.supervisors)}</span>}
            <span className="inline-flex items-center gap-1.5"><Icon name="smartphone" size={14} />{d.devices ? `${phonesText(d.devices)} يصله التنبيه` : 'لا هواتف'}</span>
          </div>
          {d.students === 0
            ? <p role="alert" className="m-0 text-label font-medium text-bad">لا يوجد طلاب في هذا الاختيار، فلن يصل الإشعار إلى أحد.</p>
            : d.devices < d.students && <p className="m-0 text-cap text-ink-3">الباقون يجدونه داخل التطبيق عند فتحه.</p>}
        </>
      )}
    </section>
  );
};
