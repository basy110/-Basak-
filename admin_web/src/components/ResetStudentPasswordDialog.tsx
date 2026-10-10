import React, { useState } from 'react';
import { Button, Checkbox, Dialog, Icon, Ltr, Note, RadioCards, TextField, errorText, phoneText } from '../ui';
import { invokeEdgeFunction } from '../lib/edgeFunctions';
import { useGuard } from '../lib/guard';
import { shortName } from '../lib/pendingReceipts';

interface Props {
  student: { id: string; full_name: string; phone: string; university: string; company?: string | null };
  onClose: () => void;
}
const MIN = 8;

/**
 * Super admin only (boards AdmPasswordReset, AdmPasswordResetDone, AdmPasswordResetStates):
 * sets a temporary password on the student's account (edge function
 * admin-reset-student-password, service role) and forces a change at the next sign-in.
 * The password is shown here once and is never stored or logged. A company admin
 * answers the student's own request on «طلبات كلمة المرور» instead.
 */
export const ResetStudentPasswordDialog: React.FC<Props> = ({ student, onClose }) => {
  const [mode, setMode] = useState<'generate' | 'manual'>('generate');
  const [password, setPassword] = useState('');
  const [blurred, setBlurred] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const guard = useGuard();
  const name = shortName(student.full_name);
  const short = mode === 'manual' && password.length < MIN;
  const fieldError = mode === 'manual' && blurred && password.length > 0 && short ? 'كلمة المرور المؤقتة أقصر من 8 أحرف.' : undefined;

  // A second click must not set a second password while the first is being set.
  const submit = () => guard('reset', async () => {
    if (!checked || short) { setBlurred(true); return; }
    setError('');
    setBusy(true);
    try {
      const answer = await invokeEdgeFunction<{ temporaryPassword?: string }>('admin-reset-student-password', {
        studentId: student.id, ...(mode === 'manual' ? { password } : {}),
      });
      setResult(mode === 'manual' ? password : answer.temporaryPassword ?? '');
      setPassword('');
    } catch (e) {
      setError(errorText(e, 'لم تتغيّر كلمة المرور. حاول مرة أخرى.'));
    } finally {
      setBusy(false);
    }
  });
  const copy = async () => { try { await navigator.clipboard.writeText(result ?? ''); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* the admin can read it */ } };

  if (result !== null) {
    // Shown once: only the button closes it, so a stray click cannot lose the password.
    return (
      <Dialog open onClose={() => undefined} icon="check" tone="success" title={`تغيّرت كلمة مرور ${name}`}
        actions={[<Button key="done" onClick={onClose} data-autofocus>تم، سلّمتها للطالب</Button>]}>
        <div className="flex items-center gap-3 rounded-inner bg-teal-tint px-5 py-4 max-sm:px-4">
          <Ltr className="flex-1 text-center text-[28px] font-semibold leading-9 tracking-[0.06em] text-ink">{result}</Ltr>
          <button type="button" onClick={() => void copy()} className="inline-flex h-10 flex-none items-center gap-1.5 rounded-control bg-surface px-3 text-small font-medium text-ink shadow-ring hover:bg-ground">
            <Icon name={copied ? 'check' : 'copy'} size={16} /><span>{copied ? 'نُسخت' : 'نسخ'}</span>
          </button>
        </div>
        <p className="m-0">سلّمها للطالب بنفسك، في مقابلة أو مكالمة. سيُطلب منه تغييرها عند أول دخول.</p>
        <Note tone="warning" title="تظهر مرة واحدة فقط">لا تُحفظ ولا يمكن عرضها بعد إغلاق هذه النافذة.</Note>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} icon="key" tone="warning" w={520} title={`إعادة تعيين كلمة مرور ${name}؟`}
      actions={[
        <Button key="back" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>,
        <Button key="reset" loading={busy} disabled={!checked || short} onClick={() => void submit()}>إعادة التعيين</Button>,
      ]}>
      <div className="flex items-center gap-3 rounded-inner bg-ground px-4 py-3">
        <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-ok-bg text-card text-ok">{student.full_name.trim().charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-small font-semibold text-ink">{student.full_name}</div>
          <div className="truncate text-label text-ink-2"><Ltr>{phoneText(student.phone)}</Ltr>{student.university ? ` · ${student.university}` : ''}{student.company ? ` · ${student.company}` : ''}</div>
        </div>
      </div>
      <RadioCards label="كلمة المرور المؤقتة" name="temp-password" cols={2} value={mode} onChange={(v) => { setMode(v); setError(''); }}
        options={[
          { value: 'generate', label: 'يولّدها النظام', sub: 'كلمة آمنة تظهر لك مرة واحدة' },
          { value: 'manual', label: 'أكتبها أنا', sub: `${MIN} أحرف على الأقل` },
        ]} />
      {mode === 'manual' && (
        <TextField label="الكلمة المؤقتة" ltr autoComplete="off" spellCheck={false} value={password} error={fieldError} data-autofocus
          onChange={(e) => setPassword(e.target.value)} onBlur={() => setBlurred(true)} />
      )}
      <Checkbox checked={checked} onChange={setChecked} label={<span className="text-ink">تحققت من هوية الطالب، وأعرف أن كلمته الحالية ستتوقف عن العمل.</span>} />
      {error && <Note tone="danger">{error}</Note>}
    </Dialog>
  );
};
