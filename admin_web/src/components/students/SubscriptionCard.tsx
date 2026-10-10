import React, { useState } from 'react';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Feedback';
import { InfoRows } from '../../ui/Layout';
import { Dialog } from '../../ui/Overlay';
import { Money, StatusPill, type Tone } from '../../ui/Status';
import { clock, errorText } from '../../ui/format';
import type { IconName } from '../../ui/Icon';
import { actionsFor, periodName, shortName, shownOf, type SubscriptionAction, type StudentSubscription } from '../../lib/students';
import { fullDay } from './parts';

/** «ذهاب 7:15 ص · عودة 3:00 م». */
export const tripsText = (sub: Pick<StudentSubscription, 'departure_time' | 'return_time'>) =>
  [sub.departure_time && `ذهاب ${clock(sub.departure_time)}`, sub.return_time && `عودة ${clock(sub.return_time)}`].filter(Boolean).join(' · ');

const EXPLAIN: Partial<Record<string, (sub: StudentSubscription) => string>> = {
  unpaid: () => 'لم يدفع بعد. يدفع من التطبيق ويرسل إيصالاً، أو يدفع لك نقداً فتفعّله أنت.',
  review: () => 'أرسل إيصالاً ينتظر مراجعتك في صفحة الإيصالات.',
  rejected: () => 'رُفض إيصاله. يرسل إيصالاً جديداً من التطبيق، أو يدفع لك نقداً فتفعّله أنت.',
  soon: (sub) => `مدفوع مقدماً. يبدأ مع بداية ${periodName(sub.period_label) || 'فترته'}.`,
};

const LABEL: Record<SubscriptionAction, string> = {
  activate: 'تفعيل بعد دفع نقدي', cancel: 'إلغاء الاشتراك', end: 'إنهاء الاشتراك', revert: 'فُعّل بالخطأ؟ أعده إلى بانتظار الدفع', reactivate: 'إعادة التفعيل',
};

/** One current subscription: its facts and the moves its status allows (AdmStudentPanel, AdmStudentDialogs). */
export const SubscriptionCard: React.FC<{
  sub: StudentSubscription; today: string; studentName: string; receiptsTo: string; online: boolean;
  onAction: (sub: StudentSubscription, action: SubscriptionAction) => void;
}> = ({ sub, today, studentName: _n, receiptsTo, online, onAction }) => {
  const shown = sub.shown ?? shownOf(sub, today);
  const actions = actionsFor(sub, today);
  const explain = EXPLAIN[shown]?.(sub);
  const rows: [React.ReactNode, React.ReactNode][] = [
    ['الخط', sub.line_name ?? '—'],
    ['الرحلات', <span key="t" className="flex flex-col"><span>{tripsText(sub) || '—'}</span>{sub.trip_university && <span className="text-label text-ink-2">إلى {sub.trip_university}</span>}</span>],
  ];
  if (sub.start_date) rows.push(['المدة', sub.end_date && sub.end_date !== sub.start_date ? `من ${fullDay(sub.start_date)} إلى ${fullDay(sub.end_date)}` : fullDay(sub.start_date)]);
  rows.push(['السعر', <Money key="m" value={Number(sub.price)} />]);
  return (
    <div className="flex flex-col gap-1 rounded-inner bg-surface px-4 py-3 shadow-ring">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-small font-semibold">{sub.period_label ?? 'اشتراك'}</span>
        <StatusPill status={shown} />
      </div>
      {explain && <p className="m-0 text-label text-ink-2">{explain}</p>}
      <InfoRows rows={rows} labelW={96} />
      {(actions.length > 0 || shown === 'review') && (
        <div className="flex flex-col gap-2 border-t border-hair pt-3 sm:flex-row sm:flex-wrap sm:items-center">
          {shown === 'review' && <Button sm kind="primary" iconEnd="fwd" to={receiptsTo} className="max-sm:!h-12">راجع الإيصال</Button>}
          {actions.map((a, i) => (
            a === 'revert'
              ? <Button key={a} sm kind="link" disabled={!online} onClick={() => onAction(sub, a)} className="max-sm:!h-11 sm:ms-auto">{LABEL[a]}</Button>
              : <Button key={a} sm kind={i === 0 && (a === 'activate' || a === 'reactivate') ? 'primary' : 'secondary'} icon={a === 'activate' ? 'check' : a === 'reactivate' ? 'refresh' : undefined}
                disabled={!online} onClick={() => onAction(sub, a)} className="max-sm:!h-12">{LABEL[a]}</Button>
          ))}
        </div>
      )}
    </div>
  );
};

/** A subscription that ended: one line, and «إعادة التفعيل» while its dates have not passed. */
export const PastSubscriptionRow: React.FC<{ sub: StudentSubscription; today: string; online: boolean; onAction: (sub: StudentSubscription, action: SubscriptionAction) => void }> = ({ sub, today, online, onAction }) => {
  const canReactivate = actionsFor(sub, today).includes('reactivate');
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-small font-semibold">{sub.period_label ?? 'اشتراك'}</div>
        <div className="text-label text-ink-2">{sub.line_name ?? '—'} · <Money value={Number(sub.price)} /></div>
      </div>
      {canReactivate && <Button sm kind="secondary" icon="refresh" disabled={!online} onClick={() => onAction(sub, 'reactivate')}>إعادة التفعيل</Button>}
      <StatusPill status="ended" />
    </div>
  );
};

const DIALOG: Record<SubscriptionAction, { icon: IconName; tone: Tone; confirm: string; kind: 'primary' | 'danger' }> = {
  activate: { icon: 'check', tone: 'success', confirm: 'تفعيل الاشتراك', kind: 'primary' },
  cancel: { icon: 'x', tone: 'danger', confirm: 'إلغاء الاشتراك', kind: 'danger' },
  end: { icon: 'power', tone: 'danger', confirm: 'إنهاء الاشتراك', kind: 'danger' },
  revert: { icon: 'undo', tone: 'warning', confirm: 'إعادة إلى بانتظار الدفع', kind: 'primary' },
  reactivate: { icon: 'refresh', tone: 'teal', confirm: 'إعادة التفعيل', kind: 'primary' },
};

/** The confirmation of one move, saying exactly what changes and the amount. */
export const SubscriptionActionDialog: React.FC<{
  target: { sub: StudentSubscription; action: SubscriptionAction } | null; studentName: string;
  onClose: () => void; onConfirm: () => Promise<void>;
}> = ({ target, studentName, onClose, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!target) return null;
  const { sub, action } = target;
  const who = shortName(studentName);
  const period = sub.period_label ?? 'الاشتراك';
  const line = sub.line_name ?? '';
  const money = <Money value={Number(sub.price)} />;
  const d = DIALOG[action];
  const close = () => { if (!busy) { setError(''); onClose(); } };
  const confirm = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); setBusy(false); onClose(); } catch (e) { setBusy(false); setError(errorText(e)); }
  };
  const title = {
    activate: `تفعيل اشتراك ${who} بعد دفع نقدي؟`, cancel: `إلغاء اشتراك ${who}؟`, end: `إنهاء اشتراك ${who}؟`,
    revert: `إعادة اشتراك ${who} إلى «بانتظار الدفع»؟`, reactivate: `إعادة تفعيل اشتراك ${who}؟`,
  }[action];
  const body = {
    activate: <><p className="m-0">يصير اشتراكه في {period}{line && ` على خط ${line}`} <b className="font-semibold text-ink">نشطاً</b> الآن، ويركب به من الغد.</p>
      <p className="m-0">يُحسب {money} ضمن إيرادات الشركة كأنه دُفع، ولا يُطلب منه إيصال. تأكد أنك استلمت المبلغ.</p></>,
    cancel: <p className="m-0">اشتراكه في {period} لم يُدفع بعد. بعد الإلغاء يصير «منتهٍ» ولا يستطيع أن يدفعه. يبقى الطالب في شركتك ويستطيع أن يشترك من جديد.</p>,
    end: <><p className="m-0">يتوقف اشتراكه في {period}{line && ` على خط ${line}`} اليوم، ولا يركب به بعد الآن.</p>
      <p className="m-0">لا يُردّ المبلغ من هنا، ويبقى ما دفعه ({money}) في الإيرادات. يستطيع أن يشترك من جديد.</p></>,
    revert: <p className="m-0">استعمل هذا إن فُعّل الاشتراك بالخطأ. يتوقف عن الركوب به حتى يدفع، ويخرج {money} من الإيرادات.</p>,
    reactivate: <p className="m-0">يعود اشتراكه في {period} نشطاً بالمدة نفسها، ويُحسب {money} ضمن الإيرادات. استعمل هذا إن أُنهي بالخطأ.</p>,
  }[action];
  return (
    <Dialog open onClose={close} title={title} icon={d.icon} tone={d.tone}
      actions={[<Button key="c" kind="secondary" onClick={close} disabled={busy}>رجوع</Button>,
        <Button key="o" kind={d.kind} loading={busy} onClick={() => void confirm()}>{d.confirm}</Button>]}>
      {body}
      {error && <Note tone="danger">{error}</Note>}
    </Dialog>
  );
};
