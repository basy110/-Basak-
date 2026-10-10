import React, { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';
import { Note } from '../../ui/Feedback';
import { TextArea } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { InfoRows } from '../../ui/Layout';
import { Dialog, SidePanel } from '../../ui/Overlay';
import { Badge, Ltr, StatePill } from '../../ui/Status';
import { agoText, cairo, clock, dayText, errorText, num, phoneText } from '../../ui/format';
import type { PlatformCorrection } from '../../lib/corrections';
import { shortName } from '../../lib/students';
import { PanelHead } from './parts';

const ORDINAL = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
/** «الأول من 9», «رقم 12 من 30». */
export const placeText = (i: number, n: number) => `${ORDINAL[i] ?? `رقم ${i + 1}`} من ${num(n)}`;
/** «عند شركتين», «عند 3 شركات», «عند شركة واحدة». */
export const atCompanies = (n: number) => (n <= 1 ? 'عند شركة واحدة' : n === 2 ? 'عند شركتين' : n <= 10 ? `عند ${n} شركات` : `عند ${n} شركة`);
/** «منذ يومين · الخميس 8 أكتوبر 4:20 م». */
export const whenText = (iso: string) => { const c = cairo(iso); return `${agoText(iso)} · ${dayText(c.day, { weekday: true, year: false })} ${clock(c.time)}`; };

const label = (c: PlatformCorrection) => (c.field === 'full_name' ? 'الاسم' : 'الجامعة');
/** «عبد الرحمن محمد» and «النورس للنقل والفيروز لنقل الطلاب». */
const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join('، ')} و${names[names.length - 1]}`);

/**
 * One correction to decide (docs/canvas/AdmPlatCorrectionsPanel, AdmPlatCorrectionsDetailPhone,
 * AdmPlatCorrectionsStates): the value now and after, who asked, the student, and what the
 * approval reaches. Approving needs no second question; refusing asks for the reason the company reads.
 */
export const CorrectionPanel: React.FC<{
  row: PlatformCorrection; index: number; count: number; online: boolean; onClose: () => void;
  onApprove: () => Promise<void>; onReject: (reason: string) => Promise<void>;
}> = ({ row, index, count, online, onClose, onApprove, onReject }) => {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  useEffect(() => { setReason(''); setError(''); setRejecting(false); }, [row.id]);
  const companies = row.student_companies ?? (row.company ? [row.company] : []);
  const what = label(row);
  const approve = async () => { setBusy(true); try { await onApprove(); } catch { /* the page has said so in a toast with a retry */ } finally { setBusy(false); } };
  const reject = async () => {
    if (!reason.trim()) { setError('اكتب سبب الرفض؛ تقرؤه الشركة.'); return; }
    setRejectBusy(true); setError('');
    try { await onReject(reason.trim()); setRejecting(false); } catch (e) { setError(errorText(e)); } finally { setRejectBusy(false); }
  };
  return (
    <SidePanel open onClose={onClose} title={row.student_name ?? 'طالب'} meta={<StatePill state="open" label="ينتظر قرارك" />} w={560}
      backLabel="طلبات التصحيح" sub={`طلب تصحيح ${what} · ${placeText(index, count)}`}
      footer={<>
        <Button kind="dangerQuiet" disabled={!online || busy} onClick={() => setRejecting(true)}>ارفض الطلب</Button>
        <span className="hidden flex-1 sm:block" />
        <Button icon="check" loading={busy} disabled={!online} onClick={() => void approve()}>اعتمد التغيير</Button>
      </>}>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 rounded-inner bg-ground px-4 py-3 sm:bg-sunken/60">
          <div className="text-cap text-ink-2">{what} الآن</div>
          <div className="text-body text-ink-2">{row.old_value ?? '—'}</div>
        </div>
        <Icon name={/* RTL: the new value is on the left */ 'arrowFwd'} size={18} className="hidden flex-none self-center text-ink-3 sm:block" />
        <Icon name="adown" size={18} className="flex-none self-center text-ink-3 sm:hidden" />
        <div className="min-w-0 flex-1 rounded-inner bg-teal-tint px-4 py-3 shadow-[inset_0_0_0_1.5px_#00658D]">
          <div className="text-cap text-teal">{what} بعد التغيير</div>
          <div className="text-body font-semibold">{row.new_value}</div>
        </div>
      </div>

      <section className="flex flex-col gap-1">
        <PanelHead>من طلب التغيير</PanelHead>
        <InfoRows rows={[
          ['الشركة', row.company ?? '—'],
          ...(row.requested_by_name ? [['كتبه', row.requested_by_name] as [string, string]] : []),
          ['متى', whenText(row.created_at)],
          ...(row.note ? [['ملاحظة الشركة', row.note] as [string, string]] : []),
        ]} />
      </section>

      <section className="flex flex-col gap-1">
        <PanelHead>الطالب</PanelHead>
        <InfoRows rows={[
          ['رقم الهاتف', row.student_phone ? <Ltr key="p">{phoneText(row.student_phone)}</Ltr> : '—'],
          ...(row.student_companies ? [['شركاته', <span key="c" className="flex flex-wrap gap-1">{row.student_companies.length ? row.student_companies.map((c) => <Badge key={c} tone="teal">{c}</Badge>) : <Badge tone="warning">بلا شركة</Badge>}</span>] as [string, React.ReactNode]] : []),
          ...(row.active_subscriptions != null ? [['اشتراكات نشطة', num(row.active_subscriptions)] as [string, string]] : []),
        ]} />
      </section>

      <Note tone="teal" title={`${row.field === 'full_name' ? 'يتغيّر الاسم' : 'تتغيّر الجامعة'} ${atCompanies(Math.max(1, companies.length))}`}>
        {row.field === 'full_name'
          ? `سيظهر الاسم الجديد في بطاقة الطالب وفي إيصالاته القادمة${companies.length ? ` وفي قوائم ${joinNames(companies)}` : ''}. الإيصالات القديمة لا تتغيّر.`
          : `ستظهر الجامعة الجديدة في بطاقة الطالب وفي إيصالاته القادمة${companies.length ? ` وفي قوائم ${joinNames(companies)}` : ''}. الإيصالات القديمة لا تتغيّر.`}
      </Note>

      <Dialog open={rejecting} onClose={() => { if (!rejectBusy) setRejecting(false); }} icon="x" tone="danger" title={`رفض طلب تصحيح ${what}؟`}
        actions={[<Button key="c" kind="secondary" disabled={rejectBusy} onClick={() => setRejecting(false)}>رجوع</Button>,
          <Button key="o" kind="danger" loading={rejectBusy} onClick={() => void reject()}>ارفض الطلب</Button>]}>
        <p className="m-0">يبقى {row.field === 'full_name' ? 'اسم الطالب' : 'جامعة الطالب'} كما {row.field === 'full_name' ? 'هو' : 'هي'}: «{row.old_value ?? '—'}». تعرف {row.company ?? 'الشركة'} أن الطلب رُفض وترى السبب الذي تكتبه.</p>
        <TextArea label="سبب الرفض" rows={3} maxLength={300} value={reason} data-autofocus className="text-ink"
          placeholder={row.field === 'full_name' ? 'مثال: الاسم المقترح لا يطابق البطاقة التي أرسلها الطالب.' : 'مثال: الطالب مسجّل في هذه الجامعة بالفعل.'}
          onChange={(e) => { setReason(e.target.value); setError(''); }} error={error || undefined} />
      </Dialog>
    </SidePanel>
  );
};

/** The short name a toast uses. */
export const toastName = (row: PlatformCorrection) => shortName(row.student_name ?? row.old_value ?? '');
