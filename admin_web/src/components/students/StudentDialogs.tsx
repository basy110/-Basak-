import React, { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Feedback';
import { SelectField, TextArea, TextField } from '../../ui/Field';
import type { IconName } from '../../ui/Icon';
import { Dialog } from '../../ui/Overlay';
import { Ltr, type Tone } from '../../ui/Status';
import { errorText, phoneText } from '../../ui/format';
import { correctionProblem, type CorrectionField } from '../../lib/corrections';
import { shortName } from '../../lib/students';

/** A yes/no whose confirm runs a write: busy while it runs, the failure in plain Arabic inside the dialog. */
export const ConfirmDialog: React.FC<{
  open: boolean; onClose: () => void; title: React.ReactNode; icon: IconName; tone: Tone;
  confirm: string; kind?: 'primary' | 'danger'; cancel?: string; cancelKind?: 'secondary' | 'outline';
  onConfirm: () => Promise<void>; children?: React.ReactNode; disabled?: boolean;
}> = ({ open, onClose, title, icon, tone, confirm, kind = 'danger', cancel = 'رجوع', cancelKind = 'secondary', onConfirm, children, disabled }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);
  const close = () => { if (!busy) onClose(); };
  const run = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); setBusy(false); onClose(); } catch (e) { setBusy(false); setError(errorText(e)); }
  };
  return (
    <Dialog open={open} onClose={close} title={title} icon={icon} tone={tone}
      actions={[<Button key="c" kind={cancelKind} onClick={close} disabled={busy}>{cancel}</Button>,
        <Button key="o" kind={kind} loading={busy} disabled={disabled} onClick={() => void run()}>{confirm}</Button>]}>
      {children}
      {error && <Note tone="danger">{error}</Note>}
    </Dialog>
  );
};

/** «إزالة … من الشركة؟» (AdmStudentDialogs · Remove from the company). */
export const RemoveDialog: React.FC<{ open: boolean; onClose: () => void; name: string; company: string; onConfirm: () => Promise<void> }> = ({ open, onClose, name, company, onConfirm }) => (
  <ConfirmDialog open={open} onClose={onClose} icon="trash" tone="danger" title={`إزالة ${shortName(name)} من ${company}؟`} confirm="إزالة من الشركة" onConfirm={onConfirm}>
    <p className="m-0">تنتهي اشتراكاته المفتوحة مع الشركة ولا يظهر في قوائمها.</p>
    <p className="m-0">يبقى حسابه في التطبيق كما هو، وتبقى الإيرادات المسجلة في تقارير الشركة. إن أردت إعادته فأضفه من جديد وسيصله طلب انضمام.</p>
  </ConfirmDialog>
);

/** «حذف حساب … نهائياً من المنصة؟» — platform admin only. */
export const DeleteAccountDialog: React.FC<{ open: boolean; onClose: () => void; name: string; company: string; onConfirm: () => Promise<void> }> = ({ open, onClose, name, company, onConfirm }) => (
  <ConfirmDialog open={open} onClose={onClose} icon="trash" tone="danger" title={`حذف حساب ${shortName(name)} نهائياً من المنصة؟`} confirm="حذف الحساب" onConfirm={onConfirm}>
    <p className="m-0">يُحذف حسابه وبياناته واشتراكاته لدى كل الشركات، لا لدى {company} فقط. تبقى مبالغ الإيرادات في السجل المالي.</p>
    <p className="m-0 font-semibold text-bad">لا يمكن التراجع.</p>
  </ConfirmDialog>
);

/** «إلغاء الدعوة المرسلة إلى …؟». */
export const CancelInviteDialog: React.FC<{ phone: string | null; onClose: () => void; onConfirm: () => Promise<void> }> = ({ phone, onClose, onConfirm }) => (
  <ConfirmDialog open={!!phone} onClose={onClose} icon="x" tone="danger" title={<>إلغاء الدعوة المرسلة إلى <Ltr>{phoneText(phone)}</Ltr>؟</>} confirm="إلغاء الدعوة" onConfirm={onConfirm}>
    <p className="m-0">لن يستطيع صاحب الرقم قبولها من التطبيق. يمكنك دعوته مرة أخرى بإضافته من «إضافة طالب».</p>
  </ConfirmDialog>
);

/**
 * «طلب تصحيح اسم …» (one field; the platform admin decides). The send button waits
 * for a value that differs from the current one. The same dialog asks for a university.
 */
export const CorrectionDialog: React.FC<{
  open: boolean; onClose: () => void; field: CorrectionField; name: string; current: string;
  universities?: { id: string; name: string }[]; onSend: (value: string) => Promise<void>;
}> = ({ open, onClose, field, name, current, universities = [], onSend }) => {
  const [value, setValue] = useState(current);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setValue(field === 'full_name' ? current : ''); setTouched(false); setError(''); } }, [open, current, field]);
  const problem = correctionProblem(field, current, value);
  const same = problem === 'اكتب اسماً مختلفاً عن الاسم الحالي.' || problem === 'اختر جامعة مختلفة عن الحالية.';
  const shownProblem = touched || (field === 'full_name' && value !== current) ? problem : null;
  const close = () => { if (!busy) onClose(); };
  const send = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true); setError('');
    try { await onSend(value); setBusy(false); onClose(); } catch (e) { setBusy(false); setError(errorText(e)); }
  };
  const who = shortName(name);
  return (
    <Dialog open={open} onClose={close} icon="pencil" tone="teal"
      title={field === 'full_name' ? `طلب تصحيح اسم ${who}` : `طلب تصحيح جامعة ${who}`}
      actions={[<Button key="c" kind="secondary" onClick={close} disabled={busy}>رجوع</Button>,
        <Button key="o" loading={busy} disabled={same} onClick={() => void send()}>إرسال الطلب</Button>]}>
      <p className="m-0">{field === 'full_name'
        ? 'الاسم يخص حساب الطالب وقد تشاركه شركات أخرى، لذلك تعتمده إدارة المنصة. لا يتغيّر شيء قبل أن توافق.'
        : 'الجامعة تخص حساب الطالب وقد تشاركه شركات أخرى، لذلك تعتمدها إدارة المنصة. لا يتغيّر شيء قبل أن توافق.'}</p>
      <form className="text-ink" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {field === 'full_name'
          ? <TextField label="الاسم الصحيح (رباعي)" value={value} data-autofocus autoComplete="off" onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)} error={shownProblem ?? undefined} help={`الاسم الحالي: ${current}`} />
          : <SelectField label="الجامعة الصحيحة" value={value} placeholder="اختر الجامعة" onChange={(e) => { setValue(e.target.value); setTouched(true); }}
            options={universities.filter((u) => u.name !== current).map((u) => ({ value: u.name, label: u.name }))}
            error={touched ? problem ?? undefined : undefined} help={`الجامعة الحالية: ${current || '—'}`} />}
      </form>
      {error && <Note tone="danger">{error}</Note>}
    </Dialog>
  );
};

/** Block: the reason is optional and seen only by those who manage the block. */
export const BlockDialog: React.FC<{ open: boolean; onClose: () => void; name: string; phone: string; asCompany: boolean; onConfirm: (reason: string) => Promise<void> }> = ({ open, onClose, name, phone, asCompany, onConfirm }) => {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <ConfirmDialog open={open} onClose={onClose} icon="ban" tone="danger" title={`حظر ${shortName(name)}؟`} confirm="حظر الطالب" onConfirm={() => onConfirm(reason)}>
      <p className="m-0">لن يستطيع الدخول إلى التطبيق، ولا التسجيل مرة أخرى بالرقم <Ltr>{phoneText(phone)}</Ltr> حتى لو حُذف حسابه. لا يُحذف شيء من بياناته، ويمكن إلغاء الحظر لاحقاً. عند مسح بطاقته يظهر للمشرف أنه محظور.</p>
      <TextArea label="سبب الحظر" optional rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
        help={asCompany ? 'يراه مديرو شركتك وإدارة المنصة فقط.' : 'تراه إدارة المنصة فقط.'} className="text-ink" />
    </ConfirmDialog>
  );
};
