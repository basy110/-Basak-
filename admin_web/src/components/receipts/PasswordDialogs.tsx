import React, { useEffect, useState } from 'react';
import { Button, Dialog, Icon, Ltr, Note, phoneText } from '../../ui';
import { CODE_MINUTES, codeText, type IssuedCode, type ResetRequest } from '../../lib/resetRequests';
import { shortName } from '../../lib/pendingReceipts';
import { cairo, clock } from '../../ui/format';

const untilText = (iso: string) => clock(cairo(iso).time);

/** Copies the code, and says so for a moment. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const t = window.setTimeout(() => setCopied(false), 2000); return () => window.clearTimeout(t); }, [copied]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return { copied, copy };
}

/** «هل تأكدت أنه …؟»: the call comes before the code. */
export const VerifyDialog: React.FC<{
  request: ResetRequest | null; view: 'company' | 'platform'; busy: boolean; disabled?: boolean; onClose: () => void; onIssue: () => void;
}> = ({ request, view, busy, disabled, onClose, onIssue }) => {
  if (!request) return null;
  const name = shortName(request.student_name);
  const phone = phoneText(request.student_phone);
  return (
    <Dialog open onClose={busy ? () => undefined : onClose} icon={view === 'company' ? 'key' : 'phone'} tone="teal"
      title={`هل تأكدت أنه ${name}؟`}
      actions={[
        <Button key="back" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>,
        <Button key="issue" icon={view === 'platform' ? 'key' : undefined} loading={busy} disabled={disabled} onClick={onIssue} data-autofocus>
          {view === 'company' ? 'إصدار الرمز' : 'أصدر الرمز'}
        </Button>,
      ]}>
      {view === 'company' ? (
        <>
          <p className="m-0">اتصل به على رقمه المسجّل واسأله عن اسمه وخطّه. من يأخذ الرمز يستطيع أن يغيّر كلمة المرور ويدخل إلى الحساب.</p>
          <div className="flex items-center gap-3 rounded-inner bg-ground px-4 py-3">
            <Icon name="phone" size={20} className="text-ink-2" />
            <Ltr className="flex-1 text-[20px] font-semibold leading-7 text-ink tabular">{phone}</Ltr>
            <a href={`tel:${request.student_phone}`} className="inline-flex h-9 items-center rounded-control bg-surface px-3 text-label font-medium text-ink shadow-ring hover:bg-ground">اتصل</a>
          </div>
          <p className="m-0">يصلح الرمز {CODE_MINUTES} دقيقة ولمرة واحدة.</p>
        </>
      ) : (
        <>
          <p className="m-0">اتصل به أولاً على <a href={`tel:${request.student_phone}`} className="font-semibold text-ink underline-offset-2 hover:underline"><Ltr>{phone}</Ltr></a> واسأله عن جامعته وخطه. من يأخذ الرمز يدخل الحساب.</p>
          <p className="m-0">بعد التأكد نُصدر رمزاً من 6 أرقام صالحاً {CODE_MINUTES} دقيقة، ويظهر لك <strong className="font-semibold text-ink">مرة واحدة فقط</strong>.</p>
        </>
      )}
    </Dialog>
  );
};

/**
 * The code, once. The dialog stays until the admin closes it with its button (a click
 * beside it or Escape does not lose the code); it can be copied, and says until when it works.
 */
export const CodeDialog: React.FC<{ issued: { request: ResetRequest; code: IssuedCode } | null; view: 'company' | 'platform'; onClose: () => void }> = ({ issued, view, onClose }) => {
  const { copied, copy } = useCopy();
  if (!issued) return null;
  const { request, code } = issued;
  const phone = <Ltr className="font-semibold text-ink">{phoneText(request.student_phone)}</Ltr>;
  const copyButton = (
    <button type="button" onClick={() => void copy(code.code)} aria-live="polite"
      className="inline-flex h-10 flex-none items-center gap-1.5 rounded-control bg-surface px-3 text-small font-medium text-ink shadow-ring hover:bg-ground">
      <Icon name={copied ? 'check' : 'copy'} size={16} /><span>{copied ? 'نُسخ' : view === 'company' ? 'نسخ' : 'انسخ الرمز'}</span>
    </button>
  );
  const codeLine = <Ltr className="text-[40px] font-semibold leading-[48px] tracking-[0.12em] text-ink tabular">{codeText(code.code)}</Ltr>;
  return (
    <Dialog open onClose={() => undefined} icon="check" tone="success" title={view === 'company' ? `رمز ${shortName(request.student_name)}` : `رمز ${request.student_name}`}
      actions={[<Button key="done" onClick={onClose} data-autofocus>{view === 'company' ? 'تم، أبلغته بالرمز' : 'أغلق، أبلغته بالرمز'}</Button>]}>
      {view === 'company' ? (
        <>
          <div className="flex items-center gap-3 rounded-inner bg-teal-tint px-5 py-4 max-sm:px-4">
            <span className="flex-1 text-center">{codeLine}</span>
            {copyButton}
          </div>
          <p className="m-0 flex items-center gap-2 text-ink"><Icon name="clock" size={16} className="text-ink-2" />صالح حتى {untilText(code.expires_at)} ({CODE_MINUTES} دقيقة) ولمرة واحدة.</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-ink">
            <li className="flex gap-2.5"><Step n={1} /><span>أبلغه بالرمز في مكالمة، أو في رسالة واتساب إلى الرقم نفسه {phone}.</span></li>
            <li className="flex gap-2.5"><Step n={2} /><span>يفتح التطبيق ويضغط «نسيت كلمة المرور»، ثم يكتب الرمز وكلمة مرور جديدة يختارها.</span></li>
          </ol>
          <Note tone="warning" title="لن يظهر الرمز مرة أخرى">بعد إغلاق هذه النافذة لا يمكن عرضه. إن ضاع فأصدر رمزاً جديداً من الصف نفسه.</Note>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 rounded-inner bg-ok-bg px-5 py-4">{codeLine}{copyButton}</div>
          <p className="m-0">أملِه عليه في المكالمة على {phone}. يكتبه في التطبيق مع كلمة مرور جديدة. صالح حتى {untilText(code.expires_at)}، ولن يظهر مرة أخرى بعد إغلاق هذه النافذة.</p>
        </>
      )}
    </Dialog>
  );
};
const Step: React.FC<{ n: number }> = ({ n }) => (
  <span aria-hidden="true" className="mt-0.5 flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-sunken text-cap font-semibold text-ink tabular">{n}</span>
);

/** «إلغاء طلب …؟». */
export const CancelDialog: React.FC<{ request: ResetRequest | null; view: 'company' | 'platform'; busy: boolean; disabled?: boolean; onClose: () => void; onCancel: () => void }> = ({ request, view, busy, disabled, onClose, onCancel }) => {
  if (!request) return null;
  return (
    <Dialog open onClose={busy ? () => undefined : onClose} icon="x" tone="danger" title={`إلغاء طلب ${shortName(request.student_name)}؟`}
      actions={[
        <Button key="back" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>,
        <Button key="cancel" kind="danger" loading={busy} disabled={disabled} onClick={onCancel}>{view === 'company' ? 'إلغاء الطلب' : 'ألغِ الطلب'}</Button>,
      ]}>
      <p className="m-0">{view === 'company'
        ? 'يُغلق الطلب، ويتوقف الرمز الذي أعطيته له عن العمل. تبقى كلمة مروره الحالية كما هي، ويستطيع أن يطلب المساعدة من التطبيق مرة أخرى.'
        : request.status === 'code_issued'
          ? 'يُغلق الطلب ويتوقف الرمز الذي أُعطي له عن العمل. تبقى كلمة مروره الحالية كما هي، ويستطيع أن يطلب من جديد من التطبيق.'
          : 'يُغلق الطلب ولا يصدر له رمز. تبقى كلمة مروره الحالية كما هي، ويستطيع أن يطلب من جديد من التطبيق.'}</p>
    </Dialog>
  );
};
