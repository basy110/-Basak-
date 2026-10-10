import React, { useEffect, useState } from 'react';
import { Badge, Button, Dialog, Ltr, Note, PasswordField, RadioCards, SelectField, SidePanel, TextField, errorText } from '../../ui';
import { emailProblem, fieldOf, forName, passwordProblem, remainingText, type CompanyAdmin } from '../../lib/team';
import { PHONE_CARD } from './SupervisorPanels';

export const PLATFORM_ONLY = <Badge>لمدير المنصة فقط</Badge>;

export interface AdminDraft { companyId: string; fullName: string; email: string; how: 'invite' | 'password'; password: string }

/**
 * A new company admin. Inside a company («مديرو الشركة») the company is fixed;
 * on the platform page it is chosen among the working companies. Either an
 * e-mail invitation (he picks his own password) or a first password typed now.
 */
export const AdminAddPanel: React.FC<{
  open: boolean; onClose: () => void; variant: 'workspace' | 'platform';
  company?: { id: string; name: string }; companies?: { id: string; name: string }[];
  busy: boolean; serverError: string; onSubmit: (d: AdminDraft) => void; disabled?: boolean;
}> = ({ open, onClose, variant, company, companies = [], busy, serverError, onSubmit, disabled }) => {
  const platform = variant === 'platform';
  const blank: AdminDraft = { companyId: company?.id ?? companies[0]?.id ?? '', fullName: '', email: '', how: 'invite', password: '' };
  const [d, setD] = useState<AdminDraft>(blank);
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setD(blank); setTried(false); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = {
    company: d.companyId ? '' : 'اختر الشركة.',
    name: d.fullName.trim().length < 2 ? 'اكتب اسم المدير.' : '',
    email: emailProblem(d.email),
    password: d.how === 'password' ? passwordProblem(d.password) : '',
  };
  const server = serverError ? fieldOf(serverError) : null;
  const err = (k: keyof typeof problems) => (tried && problems[k]) || (server === k ? serverError : '') || undefined;
  const submit = () => { setTried(true); if (!Object.values(problems).some(Boolean)) onSubmit(d); };
  const verb = d.how === 'invite' ? 'أرسل الدعوة' : 'أنشئ الحساب';
  return (
    <SidePanel open={open} onClose={onClose} backLabel={platform ? 'مديرو الشركات' : 'مديرو الشركة'}
      title={platform ? 'إضافة مدير شركة' : `مدير جديد لشركة ${company?.name ?? ''}`}
      sub={platform ? 'حساب جديد يدخل لوحة شركة واحدة' : undefined} meta={platform ? undefined : PLATFORM_ONLY}
      footer={<>
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">{platform ? 'إلغاء' : 'رجوع'}</Button>
        <span className="hidden flex-1 sm:block" />
        <Button icon={d.how === 'invite' ? 'mail' : 'key'} loading={busy} disabled={disabled} onClick={submit}>{verb}</Button>
      </>}>
      <form className={`flex flex-col gap-4 ${PHONE_CARD}`} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {platform && (
          <SelectField label="الشركة" value={d.companyId} onChange={(e) => setD({ ...d, companyId: e.target.value })} error={err('company')}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            help="الشركات التي تعمل فقط. لا يمكن نقل المدير إلى شركة أخرى بعد الإضافة." />
        )}
        <TextField label="اسم المدير" value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} error={err('name')} autoComplete="off" data-autofocus />
        <TextField label="البريد الإلكتروني" type="email" ltr value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })}
          error={err('email')} autoComplete="off" help={platform ? 'به يسجّل الدخول.' : 'يدخل به اللوحة.'} />
        <RadioCards<'invite' | 'password'> label="كيف يحصل على كلمة المرور؟" value={d.how} cols={1} onChange={(how) => setD({ ...d, how })}
          options={platform ? [
            { value: 'invite', label: 'أرسل له دعوة بالبريد', sub: 'يفتح الرابط ويختار كلمة المرور بنفسه' },
            { value: 'password', label: 'أكتب كلمة مرور الآن', sub: '8 أحرف على الأقل، تسلّمها له بنفسك' },
          ] : [
            { value: 'invite', label: 'دعوة بالبريد', sub: 'يصله رابط يفتحه ويختار كلمة مروره بنفسه' },
            { value: 'password', label: 'كلمة مرور مبدئية أكتبها الآن', sub: 'يدخل بها فوراً، وتسلّمها له أنت' },
          ]} />
        {d.how === 'password' && (
          <PasswordField label={platform ? 'كلمة المرور' : 'كلمة المرور المبدئية'} value={d.password} autoComplete="new-password"
            onChange={(e) => setD({ ...d, password: e.target.value })} error={err('password')}
            help={platform ? 'تُحفظ مشفّرة ولا يمكن عرضها بعد الإضافة.' : '8 أحرف أو أكثر.'} />
        )}
        <Note tone="teal" title={platform ? 'يرى كل شيء في شركته' : 'يرى كل شيء في هذه الشركة'}>
          {platform ? 'الإيصالات والطلاب والخطوط والإيرادات والإعدادات. لا يرى أي شركة أخرى ولا صفحات المنصة.'
            : 'الإيصالات، الطلاب، الخطوط، الإيرادات والإعدادات. لا درجات صلاحيات بين المديرين.'}
        </Note>
        {serverError && !server && <Note tone="danger">{errorText(new Error(serverError))}</Note>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </SidePanel>
  );
};

/** Removing an admin deletes his sign-in account for good; says what is left for the company. */
export const RemoveAdminDialog: React.FC<{
  open: boolean; admin: CompanyAdmin | null; companyName: string; left: CompanyAdmin[]; variant: 'workspace' | 'platform';
  busy: boolean; onClose: () => void; onConfirm: () => void;
}> = ({ open, admin, companyName, left, variant, busy, onClose, onConfirm }) => {
  const platform = variant === 'platform';
  const verb = platform ? 'احذف المدير' : 'إزالة المدير';
  const last = left.length === 0;
  return (
    <Dialog open={open && !!admin} onClose={onClose} icon={last ? 'alert' : 'trash'} tone={last ? 'warning' : 'danger'}
      title={last ? `حذف المدير الوحيد ${forName(companyName)}؟` : platform ? `حذف المدير ${admin?.full_name ?? ''}؟` : `إزالة المدير ${admin?.full_name ?? ''}؟`}
      actions={[<Button key="c" kind="secondary" onClick={onClose} data-autofocus>رجوع</Button>, <Button key="o" kind="danger" loading={busy} onClick={onConfirm}>{verb}</Button>]}>
      {last ? (
        <p className="m-0">{admin?.full_name} هو مديرها الوحيد. بعد حذفه لا يستطيع أحد من الشركة دخول لوحتها حتى تضيف مديراً آخر. الشركة نفسها تبقى تعمل عند الطلاب.</p>
      ) : platform ? (
        <>
          <p className="m-0">يُحذف حساب دخوله نهائياً ولن يستطيع فتح لوحة «{companyName}». لا رجوع عن الحذف؛ لإعادته تضيفه من جديد.</p>
          <p className="m-0">{remainingText(left)} لا يتغيّر شيء في بيانات الشركة.</p>
        </>
      ) : (
        <>
          <p className="m-0">يُحذف حساب دخوله <Ltr>{admin?.email}</Ltr> نهائياً ولا يدخل اللوحة بعدها. لا يمكن التراجع؛ لإعادته تضيفه من جديد.</p>
          <p className="m-0">المشرفون الذين أضافهم يبقون. {remainingText(left)}</p>
        </>
      )}
    </Dialog>
  );
};

/** After adding (inside a company): an invitation sent, or an account made with a password. */
export const AdminAddedDialog: React.FC<{ result: { name: string; email: string; invited: boolean } | null; onClose: () => void }> = ({ result, onClose }) => (
  <Dialog open={!!result} onClose={onClose} icon={result?.invited ? 'mail' : 'check'} tone="success"
    title={result?.invited ? `أُرسلت الدعوة إلى ${result?.name}` : `أُنشئ حساب ${result?.name ?? ''}`}
    actions={[<Button key="ok" onClick={onClose} data-autofocus>تم</Button>]}>
    {result?.invited ? (
      <>
        <p className="m-0">وصله بريد على <Ltr>{result.email}</Ltr> فيه رابط. يفتحه ويختار كلمة مروره، ثم يدخل اللوحة.</p>
        <p className="m-0">يظهر الآن في قائمة المديرين.</p>
      </>
    ) : (
      <p className="m-0">يدخل اللوحة الآن بالبريد <Ltr>{result?.email}</Ltr> وكلمة المرور التي كتبتها. سلّمها له، ويستطيع تغييرها من «نسيت كلمة المرور» في صفحة الدخول.</p>
    )}
  </Dialog>
);
