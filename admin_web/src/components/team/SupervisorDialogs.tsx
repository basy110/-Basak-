import React, { useEffect, useState } from 'react';
import { Button, Dialog, Note, PasswordField, SelectField, SkeletonText, countText, num } from '../../ui';
import type { LineName, SupervisorRow } from '../../lib/reference';
import {
  RECORD, SUBSCRIBER, generatePassword, linesPhrase, passwordProblem, type LineImpact, type SupervisorRecords,
} from '../../lib/team';
import { phoneText } from '../../ui/format';
import { CopyRow, copyText } from './parts';

const B: React.FC<{ children: React.ReactNode }> = ({ children }) => <b className="font-semibold text-ink">{children}</b>;

/** «خط فارسكور يبقى معه مشرف آخر (أحمد رضا الجمل). خط رأس البر متوقف. خط شربين يصبح بلا مشرف.» */
const ImpactLines: React.FC<{ impact: LineImpact[] }> = ({ impact }) => {
  if (!impact.length) return null;
  return (
    <p className="m-0">
      {impact.map(({ line, others }, i) => (
        <React.Fragment key={line.id}>
          {i > 0 && ' '}
          خط <B>{line.name}</B>{' '}
          {!line.is_active ? 'متوقف.'
            : others.length === 1 ? `يبقى معه مشرف آخر (${others[0]}).`
              : others.length > 1 ? `يبقى معه ${others.length === 2 ? 'مشرفان آخران' : `${num(others.length)} مشرفين آخرين`} (${others.join('، ')}).`
                : 'يصبح بلا مشرف ولا يسجّل ركابه أحد.'}
        </React.Fragment>
      ))}
    </p>
  );
};

/** Stop: is_active = false. The app stops answering him; nothing is deleted. */
export const StopDialog: React.FC<{ open: boolean; supervisor: SupervisorRow | null; impact: LineImpact[]; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ open, supervisor, impact, busy, onClose, onConfirm }) => (
  <Dialog open={open && !!supervisor} onClose={onClose} icon="power" tone="danger" title={`إيقاف المشرف ${supervisor?.full_name ?? ''}؟`}
    actions={[<Button key="c" kind="secondary" onClick={onClose} data-autofocus>رجوع</Button>, <Button key="o" kind="danger" loading={busy} onClick={onConfirm}>إيقاف المشرف</Button>]}>
    <p className="m-0">لن يرى خطوطه ولن يسجّل الركوب في التطبيق، ولن يظهر لطلاب خطوطه. حسابه وخطوطه تبقى كما هي، وتشغّله متى شئت.</p>
    <ImpactLines impact={impact} />
  </Dialog>
);

export const StartDialog: React.FC<{ open: boolean; supervisor: SupervisorRow | null; lineNames: string[]; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ open, supervisor, lineNames, busy, onClose, onConfirm }) => (
  <Dialog open={open && !!supervisor} onClose={onClose} icon="power" title={`تشغيل المشرف ${supervisor?.full_name ?? ''}؟`}
    actions={[<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="o" loading={busy} onClick={onConfirm}>تشغيل المشرف</Button>]}>
    <p className="m-0">
      {lineNames.length
        ? `يعود ليرى ${linesPhrase(lineNames)} ويسجّل ${lineNames.length === 1 ? 'ركابه' : 'ركابها'} في التطبيق بنفس رقمه وكلمة مروره.`
        : 'يعود يدخل التطبيق بنفس رقمه وكلمة مروره. لا خطوط معه بعد: أسند إليه خطاً ليرى ركابه.'}
    </p>
  </Dialog>
);

/**
 * Delete: the sign-in account, the photo and the line assignments go. What
 * happens to the boarding records he scanned depends on the database: kept
 * (with his name) once the team migration is applied, deleted before.
 */
export const DeleteDialog: React.FC<{
  open: boolean; supervisor: SupervisorRow | null; sole: { line: LineName; subscribers?: number }[];
  records: { data?: SupervisorRecords; loading: boolean; error: string }; busy: boolean; onClose: () => void; onConfirm: () => void;
}> = ({ open, supervisor, sole, records, busy, onClose, onConfirm }) => {
  const r = records.data;
  const n = r?.scans ?? 0;
  const count = n === 0 ? '' : ` (${countText(n, RECORD)})`;
  return (
    <Dialog open={open && !!supervisor} onClose={onClose} icon="trash" tone="danger" title={`حذف المشرف ${supervisor?.full_name ?? ''}؟`}
      actions={[<Button key="c" kind="secondary" onClick={onClose} data-autofocus>رجوع</Button>,
        <Button key="o" kind="danger" loading={busy} disabled={records.loading} onClick={onConfirm}>حذف المشرف</Button>]}>
      {records.loading ? <SkeletonText rows={2} />
        : !r ? <p className="m-0">يُحذف حساب دخوله وصورته نهائياً. لا يمكن التراجع.</p>
          : r.kept ? (
            <p className="m-0">
              يُحذف حساب دخوله وصورته نهائياً، ولا يمكن التراجع.{' '}
              {n === 0 ? 'لم يسجّل أي ركوب بعد.' : <>سجلات الركوب التي سجّلها{count} <B>تبقى</B> في تقارير الشركة باسمه.</>}
            </p>
          ) : (
            <p className="m-0">
              يُحذف حساب دخوله وصورته نهائياً{n === 0 ? '. لم يسجّل أي ركوب بعد.' : <>، وتُحذف معه سجلات الركوب التي سجّلها{count}.</>} لا يمكن التراجع{n === 0 ? '.' : '؛ الإيقاف يحفظها.'}
            </p>
          )}
      {sole.length > 0 ? (
        <p className="m-0">
          هو المشرف الوحيد على{' '}
          {sole.map(({ line, subscribers }, i) => (
            <React.Fragment key={line.id}>
              {i > 0 && (i === sole.length - 1 ? ' و' : '، ')}
              <B>{line.name}</B>{subscribers ? ` (${countText(subscribers, SUBSCRIBER)})` : ''}
            </React.Fragment>
          ))}
          : {sole.length === 1 ? 'يصبح بلا مشرف ولا يسجّل ركابه أحد حتى تسنده لمشرف آخر.' : sole.length === 2
            ? 'يصبحان بلا مشرف ولا يسجّل ركابهما أحد حتى تسند كل خط لمشرف آخر.'
            : 'تصبح بلا مشرف ولا يسجّل ركابها أحد حتى تسند كل خط لمشرف آخر.'}
        </p>
      ) : (
        <p className="m-0">{supervisor && 'لن يصبح أي خط بلا مشرف.'}{r && !r.kept && n > 0 ? ' إن أردت الاحتفاظ بسجلاته فأوقفه بدلاً من حذفه.' : ''}</p>
      )}
      {records.error && <p className="m-0 text-label text-ink-3">تعذّر عدّ سجلاته الآن.</p>}
    </Dialog>
  );
};

export const RemovePhotoDialog: React.FC<{ open: boolean; supervisor: SupervisorRow | null; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ open, supervisor, busy, onClose, onConfirm }) => (
  <Dialog open={open && !!supervisor} onClose={onClose} icon="image" tone="danger" title={`إزالة صورة ${supervisor?.full_name ?? ''}؟`}
    actions={[<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="o" kind="dangerQuiet" loading={busy} onClick={onConfirm}>إزالة الصورة</Button>]}>
    <p className="m-0">يظهر مكانها الحرف الأول من اسمه، عنده في التطبيق وعند طلاب خطوطه. تستطيع إضافة صورة أخرى بعدها.</p>
  </Dialog>
);

/** One field: a new password, typed or made here. Nothing else about him changes. */
export const ResetPasswordDialog: React.FC<{
  open: boolean; supervisor: SupervisorRow | null; busy: boolean; error: string; onClose: () => void; onConfirm: (password: string) => void;
}> = ({ open, supervisor, busy, error, onClose, onConfirm }) => {
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setPassword(generatePassword()); setTried(false); } }, [open]);
  const problem = passwordProblem(password);
  const submit = () => { setTried(true); if (!problem) onConfirm(password); };
  const first = supervisor?.full_name.split(' ')[0] ?? '';
  return (
    <Dialog open={open && !!supervisor} onClose={onClose} icon="key" tone="warning" title={`كلمة مرور جديدة لـ${first}؟`}
      actions={[<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="o" icon="key" loading={busy} onClick={submit}>عيّن كلمة المرور</Button>]}>
      <p className="m-0">تتوقف كلمة مروره الحالية فوراً، ويدخل التطبيق بالجديدة ورقمه نفسه. خطوطه وصورته وسجلات الركوب تبقى كما هي.</p>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <PasswordField label="كلمة المرور الجديدة" value={password} autoComplete="new-password" className="min-w-0 flex-1"
            onChange={(e) => setPassword(e.target.value)} error={(tried && problem) || error || undefined}
            help="ولّدناها لك؛ تستطيع كتابة غيرها. نعرضها بعد الحفظ لتسلّمها له." />
          <Button kind="tonal" icon="wand" className="sm:mt-[26px]" onClick={() => setPassword(generatePassword())}>ولّد غيرها</Button>
        </div>
      </form>
    </Dialog>
  );
};

/**
 * The sign-in details, shown once (after adding a supervisor, or a new password):
 * each with a copy button, both at once, and a plain warning that they will not
 * be shown again.
 */
export const CredentialsDialog: React.FC<{
  open: boolean; onClose: () => void; title: string; text: React.ReactNode; phone: string; password: string;
}> = ({ open, onClose, title, text, phone, password }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} icon="check" tone="success" title={title} w={520}
      actions={[
        <Button key="copy" kind="outline" icon={copied ? 'check' : 'copy'} onClick={() => void copyText(`رقم الهاتف: ${phone}\nكلمة المرور: ${password}`).then(setCopied)}>
          {copied ? 'نُسخت البيانات' : 'نسخ البيانات معاً'}
        </Button>,
        <Button key="ok" onClick={onClose} data-autofocus>سلّمتها، إغلاق</Button>,
      ]}>
      <p className="m-0">{text}</p>
      <div className="flex flex-col gap-2">
        <CopyRow label="رقم الهاتف" value={phone} shown={phoneText(phone)} />
        <CopyRow label="كلمة المرور" value={password} />
      </div>
      <Note tone="warning" title="هذه آخر مرة تظهر فيها كلمة المرور">
        تُحفظ مشفّرة ولا نستطيع عرضها بعد إغلاق هذه النافذة. إن نسيها فعيّن له كلمة مرور جديدة من بياناته.
      </Note>
    </Dialog>
  );
};

/** «اختر مشرفاً لخط شربين»: one select, the line added to that supervisor's lines. */
export const AssignLineDialog: React.FC<{
  open: boolean; line: LineName | null; supervisors: (SupervisorRow & { lines: number })[]; busy: boolean; error: string;
  onClose: () => void; onConfirm: (supervisorId: string) => void; onAdd: () => void;
}> = ({ open, line, supervisors, busy, error, onClose, onConfirm, onAdd }) => {
  const [pick, setPick] = useState('');
  useEffect(() => { if (open) setPick(''); }, [open]);
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) setTried(false); }, [open]);
  if (!supervisors.length) {
    return (
      <Dialog open={open && !!line} onClose={onClose} icon="users" title={`من يشرف على خط ${line?.name ?? ''}؟`}
        actions={[<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="o" icon="plus" onClick={onAdd}>أضف مشرفاً</Button>]}>
        <p className="m-0">لا يوجد مشرف يعمل الآن. أضف مشرفاً واختر له هذا الخط.</p>
      </Dialog>
    );
  }
  return (
    <Dialog open={open && !!line} onClose={onClose} icon="users" title={`من يشرف على خط ${line?.name ?? ''}؟`}
      actions={[<Button key="c" kind="secondary" onClick={onClose}>رجوع</Button>,
        <Button key="o" loading={busy} onClick={() => { setTried(true); if (pick) onConfirm(pick); }}>أسند الخط</Button>]}>
      <p className="m-0">يرى المشرف الخط في التطبيق من لحظة الحفظ ويسجّل ركابه. تبقى خطوطه الأخرى معه.</p>
      <SelectField label="المشرف" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="اختر مشرفاً"
        error={(tried && !pick ? 'اختر المشرف.' : '') || error || undefined}
        options={supervisors.map((s) => ({ value: s.id, label: `${s.full_name} · ${s.lines === 0 ? 'بلا خطوط' : s.lines === 1 ? 'خط واحد' : countText(s.lines, ['خط', 'خطان', 'خطوط', 'خطاً'])}` }))} />
    </Dialog>
  );
};

