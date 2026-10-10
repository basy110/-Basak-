import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Icon, InfoRows, Note, PasswordField, SidePanel, StatePill, TextField, countText, errorText, phoneText,
} from '../../ui';
import type { LineName, SupervisorRow } from '../../lib/reference';
import {
  SUBSCRIBER, fieldOf, generatePassword, normalizePhone, passwordProblem, phoneProblem,
} from '../../lib/team';
import { Avatar, LinePicker, PhoneLtr } from './parts';

/** On a phone a panel is a page on the grey ground: its content sits in one white card. */
export const PHONE_CARD = 'max-sm:rounded-card max-sm:bg-surface max-sm:p-4 max-sm:shadow-card';

/* ── Add ─────────────────────────────────────────────────────────────── */
export interface AddDraft { fullName: string; phone: string; password: string; lineIds: string[] }
const EMPTY: AddDraft = { fullName: '', phone: '', password: '', lineIds: [] };

/**
 * «مشرف جديد»: name, phone, password (hidden while typed, or made here) and
 * at least one running line. The server creates all of it or nothing.
 */
export const SupervisorAddPanel: React.FC<{
  open: boolean; onClose: () => void; lines: LineName[]; uncovered: Set<string>;
  busy: boolean; serverError: string; onSubmit: (draft: AddDraft) => void; disabled?: boolean;
}> = ({ open, onClose, lines, uncovered, busy, serverError, onSubmit, disabled }) => {
  const [d, setD] = useState<AddDraft>(EMPTY);
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setD(EMPTY); setTried(false); } }, [open]);
  const problems = {
    name: d.fullName.trim().length < 2 ? 'اكتب اسم المشرف.' : '',
    phone: phoneProblem(d.phone),
    password: passwordProblem(d.password),
    lines: d.lineIds.length === 0 ? 'اختر خطاً واحداً على الأقل يشرف عليه.' : '',
  };
  const server = serverError ? fieldOf(serverError) : null;
  const err = (k: keyof typeof problems, f: string) => (tried && problems[k]) || (server === f ? serverError : '') || undefined;
  const submit = () => {
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    onSubmit({ ...d, fullName: d.fullName.trim(), phone: normalizePhone(d.phone) });
  };
  return (
    <SidePanel open={open} onClose={onClose} title="مشرف جديد" sub="يُنشأ حسابه فوراً ويدخل به تطبيق الهاتف" backLabel="المشرفون"
      footer={<>
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">رجوع</Button>
        <span className="hidden flex-1 sm:block" />
        <Button icon="plus" loading={busy} disabled={disabled} onClick={submit}>أضف المشرف</Button>
      </>}>
      <form className={`flex flex-col gap-4 ${PHONE_CARD}`} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <TextField label="اسم المشرف" value={d.fullName} autoComplete="off" data-autofocus
          onChange={(e) => setD({ ...d, fullName: e.target.value })} error={err('name', 'name')} />
        <TextField label="رقم الهاتف" type="tel" inputMode="tel" ltr value={d.phone} autoComplete="off" placeholder="010 0000 0000"
          onChange={(e) => setD({ ...d, phone: e.target.value })} error={err('phone', 'phone')}
          help="رقم مصري من 11 رقماً. يدخل به التطبيق." />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <PasswordField label="كلمة المرور" value={d.password} autoComplete="new-password" className="min-w-0 flex-1"
              onChange={(e) => setD({ ...d, password: e.target.value })} error={err('password', 'password')} />
            <Button kind="tonal" icon="wand" className="sm:mt-[26px]" onClick={() => setD({ ...d, password: generatePassword() })}>ولّد كلمة مرور</Button>
          </div>
          <p className="m-0 text-label text-ink-2">مخفية وأنت تكتب؛ العين تُظهرها. بعد الإضافة نعرضها لك مرة واحدة لتسلّمها له، ولا نستطيع عرضها بعد ذلك.</p>
        </div>
        <LinePicker lines={lines} selected={d.lineIds} onChange={(lineIds) => setD({ ...d, lineIds })} uncovered={uncovered}
          error={err('lines', 'lines')} help="خط واحد على الأقل. الخط المتوقف لا يُسند لمشرف جديد." />
        {serverError && !server && <Note tone="danger">{errorText(new Error(serverError))}</Note>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </SidePanel>
  );
};

/* ── Change lines ────────────────────────────────────────────────────── */
export const SupervisorLinesPanel: React.FC<{
  open: boolean; onClose: () => void; supervisor: SupervisorRow | null; photo?: string | null; lines: LineName[]; current: string[];
  uncovered: Set<string>; busy: boolean; error: string; onSave: (ids: string[]) => void;
}> = ({ open, onClose, supervisor, photo, lines, current, uncovered, busy, error, onSave }) => {
  const [ids, setIds] = useState<string[]>(current);
  const key = current.join(',');
  useEffect(() => { if (open) setIds(current); }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopped = lines.filter((l) => !l.is_active && ids.includes(l.id)).map((l) => l.name);
  const changed = ids.length !== current.length || ids.some((id) => !current.includes(id));
  return (
    <SidePanel open={open && !!supervisor} onClose={onClose} title="خطوط المشرف" sub="أضف خطاً أو ارفعه عنه" backLabel={supervisor?.full_name}
      footer={<>
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">رجوع</Button>
        <span className="hidden flex-1 sm:block" />
        <Button loading={busy} disabled={!changed} onClick={() => onSave(ids)}>حفظ الخطوط</Button>
      </>}>
      <div className={`flex flex-col gap-4 ${PHONE_CARD}`}>
      {supervisor && (
        <div className="flex items-center gap-3">
          <Avatar name={supervisor.full_name} src={photo} size={44} />
          <div className="min-w-0"><div className="truncate text-small font-semibold">{supervisor.full_name}</div><PhoneLtr phone={supervisor.phone} className="text-label text-ink-2" /></div>
        </div>
      )}
      <LinePicker lines={lines} selected={ids} onChange={setIds} uncovered={uncovered} had={current} error={error || undefined}
        help={<>
          يرى في التطبيق هذه الخطوط فقط، من لحظة الحفظ.
          {stopped.length > 0 && ` ${stopped.length === 1 ? `خط ${stopped[0]} متوقف: يبقى معه` : `خطوط ${stopped.join('، ')} متوقفة: تبقى معه`}، ولا يُسند لغيره حتى يعمل.`}
          {ids.length === 0 && ' بلا خطوط لن يرى أي خط في التطبيق.'}
        </>} />
      </div>
    </SidePanel>
  );
};

/* ── Correct name and phone ──────────────────────────────────────────── */
export const SupervisorEditPanel: React.FC<{
  open: boolean; onClose: () => void; supervisor: SupervisorRow | null; busy: boolean; serverError: string;
  onSave: (fullName: string, phone: string) => void;
}> = ({ open, onClose, supervisor, busy, serverError, onSave }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open && supervisor) { setName(supervisor.full_name); setPhone(phoneText(supervisor.phone)); setTried(false); } }, [open, supervisor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameProblem = name.trim().length < 2 ? 'اكتب اسم المشرف.' : '';
  const numProblem = phoneProblem(phone);
  const phoneChanged = !!supervisor && !numProblem && normalizePhone(phone) !== supervisor.phone;
  const changed = !!supervisor && (name.trim().replace(/\s+/g, ' ') !== supervisor.full_name || phoneChanged);
  const server = serverError ? fieldOf(serverError) : null;
  const submit = () => { setTried(true); if (!nameProblem && !numProblem && changed) onSave(name, phone); };
  return (
    <SidePanel open={open && !!supervisor} onClose={onClose} title="بيانات المشرف" sub="الاسم ورقم الهاتف الذي يدخل به" backLabel={supervisor?.full_name}
      footer={<>
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">رجوع</Button>
        <span className="hidden flex-1 sm:block" />
        <Button loading={busy} disabled={!changed} onClick={submit}>حفظ البيانات</Button>
      </>}>
      <form className={`flex flex-col gap-4 ${PHONE_CARD}`} onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <TextField label="اسم المشرف" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-autofocus
          error={(tried && nameProblem) || (server === 'name' ? serverError : '') || undefined} help="يظهر له في التطبيق ولطلاب خطوطه." />
        <TextField label="رقم الهاتف" type="tel" inputMode="tel" ltr value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off"
          error={(tried && numProblem) || (server === 'phone' ? serverError : '') || undefined}
          help="يدخل به التطبيق. رقم واحد لكل حساب: لا يُقبل رقم مسجل لطالب أو مشرف آخر." />
        {phoneChanged && (
          <Note tone="warning" title="يتغيّر رقم دخوله">
            من لحظة الحفظ يدخل التطبيق بالرقم <PhoneLtr phone={normalizePhone(phone)} /> وكلمة مروره نفسها، ولا يعمل الرقم القديم. أخبره قبل أن تحفظ.
          </Note>
        )}
        {serverError && server !== 'name' && server !== 'phone' && <Note tone="danger">{errorText(new Error(serverError))}</Note>}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </SidePanel>
  );
};

/* ── One supervisor ──────────────────────────────────────────────────── */
export interface LineFacts { line: LineName; subscribers?: number; departures?: number; returns?: number }

export const SupervisorPanel: React.FC<{
  open: boolean; onClose: () => void; supervisor: SupervisorRow | null; photo?: string | null; uploading: boolean;
  lines: LineFacts[]; writable: boolean;
  onPhoto: () => void; onRemovePhoto: () => void; onEdit: () => void; onLines: () => void; onPassword: () => void;
  onToggle: () => void; onDelete: () => void;
}> = ({ open, onClose, supervisor: s, photo, uploading, lines, writable, onPhoto, onRemovePhoto, onEdit, onLines, onPassword, onToggle, onDelete }) => {
  const facts = useMemo(() => lines.map(({ line, subscribers, departures, returns }) => {
    const parts = [subscribers != null ? countText(subscribers, SUBSCRIBER) : null];
    if (!line.is_active) parts.push('الخط متوقف');
    else if (departures != null) parts.push(`${departures} ذهاب`, `${returns ?? 0} عودة`);
    return parts.filter(Boolean).join(' · ');
  }), [lines]);
  if (!s) return null;
  return (
    <SidePanel open={open} onClose={onClose} title={s.full_name} sub="مشرف" backLabel="المشرفون"
      meta={<StatePill state={s.is_active ? 'on' : 'off'} />}
      footer={<>
        <Button kind="dangerQuiet" icon="trash" disabled={!writable} onClick={onDelete} className="hidden sm:inline-flex">حذف المشرف</Button>
        <span className="hidden flex-1 sm:block" />
        {s.is_active
          ? <Button kind="outline" icon="power" disabled={!writable} onClick={onToggle}>إيقاف المشرف</Button>
          : <Button icon="power" disabled={!writable} onClick={onToggle}>تشغيل المشرف</Button>}
      </>}>
      <div className={`flex flex-col gap-5 ${PHONE_CARD}`}>
        <div className="flex items-start gap-4">
          <div className="relative flex-none">
            <Avatar name={s.full_name} src={photo} size={72} />
            <span aria-hidden="true" className="absolute -bottom-0.5 -start-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-teal text-white shadow-[0_0_0_2px_#fff]"><Icon name="image" size={13} stroke={2} /></span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="m-0 text-label text-ink-2">صورته تظهر له في التطبيق ولطلاب خطوطه.</p>
            <div className="flex flex-wrap items-center gap-1">
              <Button kind="outline" sm icon="image" loading={uploading} disabled={!writable} onClick={onPhoto}>{s.profile_image_url ? 'تغيير الصورة' : 'أضف صورة'}</Button>
              {s.profile_image_url && <Button kind="link" sm disabled={!writable} onClick={onRemovePhoto} className="!text-bad">إزالة الصورة</Button>}
            </div>
          </div>
        </div>
        <div>
          <InfoRows labelW={96} rows={[
            ['رقم الهاتف', <PhoneLtr key="p" phone={s.phone} className="font-medium" />],
            ['الحالة', <span key="s" className="flex flex-wrap items-center gap-x-3 gap-y-1"><StatePill state={s.is_active ? 'on' : 'off'} /><span className="text-label text-ink-2">{s.is_active ? 'يرى خطوطه ويسجّل الركوب' : 'لا يرى خطوطه ولا يسجّل الركوب'}</span></span>],
          ]} />
          <div className="flex flex-col items-start gap-1 border-t border-hair pt-2.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="min-w-0 flex-1 text-label text-ink-2">إن تغيّر رقمه أو كُتب اسمه خطأ فصحّحه هنا.</span>
            <Button kind="link" sm icon="pencil" disabled={!writable} onClick={onEdit}>تعديل الاسم والرقم</Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-hair pt-5">
          <div className="flex items-center gap-2">
            <h3 className="m-0 flex-1 text-card">خطوطه</h3>
            <Button kind="link" sm icon="pencil" disabled={!writable} onClick={onLines}>تغيير الخطوط</Button>
          </div>
          {lines.length === 0 ? (
            <Note tone="warning">لا خطوط معه بعد، فلا يرى شيئاً في التطبيق. أسند إليه خطاً من «تغيير الخطوط».</Note>
          ) : lines.map(({ line }, i) => (
            <div key={line.id} className="flex min-h-[52px] items-center gap-3 rounded-control px-3 py-2 shadow-ring">
              <Icon name="route" size={18} className="text-ink-3" />
              <div className="min-w-0 flex-1"><div className="truncate text-small font-medium">{line.name}</div>{facts[i] && <div className="truncate text-cap text-ink-2">{facts[i]}</div>}</div>
              {!line.is_active && <StatePill state="off" />}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-hair pt-5">
          <h3 className="m-0 text-card">كلمة المرور</h3>
          <Note tone="teal" icon="lock" title="لا نستطيع عرضها">
            تُحفظ مشفّرة فلا يراها أحد. إن نسيها المشرف فعيّن له كلمة مرور جديدة وسلّمها له؛ لا يتغيّر شيء آخر.
          </Note>
          <Button kind="outline" icon="key" disabled={!writable} onClick={onPassword} className="w-full sm:w-auto sm:self-end">تعيين كلمة مرور جديدة</Button>
        </div>
      </div>
      <Button kind="link" disabled={!writable} onClick={onDelete} className="mx-auto !text-bad sm:hidden">حذف المشرف</Button>
    </SidePanel>
  );
};
