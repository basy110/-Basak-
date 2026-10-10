import React, { useRef, useState } from 'react';
import { notify } from '../../lib/toasts';
import {
  draftProblem, emptyDraft, idempotencyKeyFor, isDirty, platformAudience, platformCompanyIds, type NotificationDraft,
  type PlatformPreview,
} from '../../lib/notifications';
import { CAIRO_LABEL, cairoLocalToIso, cairoToday, formatCairo } from '../../lib/time';
import { awaitPlatformHistory, platformComposeNotification, usePlatformPreview } from '../../lib/notificationsData';
import { usePlatformCompanies, type CompanyOption } from '../../lib/reference';
import { NotificationForm } from './NotificationForm';
import { PhonePreview } from './PhonePreview';
import { AudiencePreviewCard, ConfirmDialog, labelClass } from './parts';
import { Button, Checkbox, Note, errorText } from '../../ui';

const pill = (on: boolean) => `inline-flex h-10 items-center rounded-full px-3.5 text-label disabled:opacity-50 sm:h-9 ${
  on ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink shadow-ring hover:bg-ground'}`;

interface PickerProps {
  all: boolean;
  selected: string[];
  onChange: (all: boolean, selected: string[]) => void;
  companies: CompanyOption[];
  loading: boolean;
  disabled: boolean;
}

/** Every active company, or the ones ticked. Only the choice leaves the page; the server works out the people. */
const CompanyPicker: React.FC<PickerProps> = ({ all, selected, onChange, companies, loading, disabled }) => {
  const toggle = (id: string) => onChange(false, selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <div>
      <span className={labelClass}>يصل إلى</span>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" disabled={disabled} aria-pressed={all} onClick={() => onChange(true, selected)} className={pill(all)}>
          كل الشركات المفعّلة
        </button>
        <button type="button" disabled={disabled} aria-pressed={!all} onClick={() => onChange(false, selected)} className={pill(!all)}>
          شركات محددة{!all && selected.length ? ` (${selected.length})` : ''}
        </button>
      </div>
      {!all && (
        <div className="mt-3 rounded-inner shadow-ring">
          <div className="flex items-center justify-between gap-2 border-b border-hair px-3 py-1.5 text-cap font-medium">
            <span className="text-ink-2">{selected.length} من {companies.length} شركة</span>
            <span className="flex gap-3">
              <button type="button" disabled={disabled} className="text-teal disabled:opacity-50"
                onClick={() => onChange(false, companies.map((company) => company.id))}>تحديد الكل</button>
              <button type="button" disabled={disabled || !selected.length} className="text-ink-2 disabled:opacity-50"
                onClick={() => onChange(false, [])}>مسح</button>
            </span>
          </div>
          <div className="grid max-h-44 grid-cols-1 gap-x-4 overflow-y-auto p-2 sm:grid-cols-2">
            {companies.map((company) => (
              <Checkbox key={company.id} className="px-2" checked={selected.includes(company.id)} disabled={disabled} onChange={() => toggle(company.id)} label={<span className="truncate">{company.name}</span>} />
            ))}
            {companies.length === 0 && (
              <p className="m-0 p-2 text-label text-ink-2">{loading ? 'جاري التحميل…' : 'لا توجد شركات مفعّلة.'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * A notification from the platform to the students of every active company, or
 * of the chosen ones. The server counts who would get it before anything is
 * sent, and creates one notification per company.
 */
export const PlatformComposer: React.FC = () => {
  const [today] = useState(() => cairoToday());
  const [draft, setDraft] = useState<NotificationDraft>(() => emptyDraft(today));
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  // The audience as it was counted when the admin pressed send: what the confirmation restates.
  const [confirming, setConfirming] = useState<PlatformPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  // One key per notification being written: a retry or a double click repeats
  // it, so the server sends once. A clean form (after a success) has none.
  const idempotencyKey = useRef<string | null>(null);
  idempotencyKey.current = idempotencyKeyFor(idempotencyKey.current, isDirty(draft));

  const lookup = usePlatformCompanies();
  // Before the lookup says which are active, none is hidden; the server refuses the ones it will not send to.
  const companies = (lookup.data ?? []).filter((company) => (company.status ?? 'active') === 'active');
  const preview = usePlatformPreview(all, selected);

  const problem = draftProblem(draft) || (!all && selected.length === 0 ? 'اختر شركة واحدة على الأقل.' : '');
  const students = preview.status === 'ready' ? preview.data?.students ?? 0 : 0;
  const canSend = !problem && preview.status === 'ready' && students > 0;
  const scheduled = draft.when === 'later';
  const scheduledIso = scheduled ? cairoLocalToIso(draft.scheduledLocal) : null;

  const change = (next: NotificationDraft) => { setDraft(next); setError(''); };

  const send = async () => {
    if (inFlight.current) return;
    // The minutes spent on the confirmation may have carried a scheduled time into the past.
    const late = draftProblem(draft);
    if (late || !idempotencyKey.current) { setError(late || 'أكمل بيانات الإشعار.'); return; }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await platformComposeNotification({
        title: draft.title.trim(), body: draft.body.trim(), companyIds: platformCompanyIds(all, selected),
        scheduledAt: scheduledIso, idempotencyKey: idempotencyKey.current, priority: draft.priority,
      });
      // `duplicate` means an earlier attempt with this key already went through: the same success, said once.
      notify(result.status === 'scheduled'
        ? { title: 'تمت جدولة الإشعار', body: `يُرسل إلى طلاب ${result.companies} شركة في موعده.` }
        : { title: 'تم إرسال الإشعار', body: `أُضيف إلى إشعارات ${result.students} طالب في ${result.companies} شركة داخل التطبيق.` });
      idempotencyKey.current = null;
      setDraft(emptyDraft(today));
      setConfirming(null);
      awaitPlatformHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الإشعار.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6"
        onSubmit={(e) => { e.preventDefault(); if (canSend && preview.data) { setError(''); setConfirming(preview.data); } }}>
        <div className="flex flex-col gap-4 lg:gap-6">
          <NotificationForm draft={draft} onChange={change} today={today} disabled={busy}
            audience={(
              <CompanyPicker all={all} selected={selected} companies={companies} loading={lookup.loading} disabled={busy}
                onChange={(nextAll, nextSelected) => { setAll(nextAll); setSelected(nextSelected); setError(''); }} />
            )} />
          {lookup.error && <Note tone="danger" title="تعذّر تحميل الشركات">{errorText(lookup.error)}</Note>}
          {error && !confirming && <Note tone="danger" title="لم يُرسل الإشعار">{error}</Note>}
        </div>
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:gap-6">
          <section className="flex flex-col gap-3 rounded-card bg-surface px-4 py-4 shadow-card sm:px-5">
            <h3 className="m-0 text-card">كما يظهر على هاتف الطالب</h3>
            <PhonePreview title={draft.title} body={draft.body} high={draft.priority === 'high'} />
          </section>
          <AudiencePreviewCard hint="اختر شركة واحدة على الأقل."
            preview={{ ...preview, data: preview.data && platformAudience(preview.data, all, selected.length) }} />
          <Button type="submit" full icon={scheduled ? 'calendar' : 'megaphone'} disabled={busy || !canSend}>{scheduled ? 'جدولة الإشعار' : 'إرسال الإشعار'}</Button>
          {!canSend && isDirty(draft) && problem && <p className="m-0 text-center text-label text-ink-2">{problem}</p>}
        </div>
      </form>

      {confirming && (
        <ConfirmDialog title={scheduled ? 'جدولة الإشعار؟' : `إرسال الإشعار إلى ${confirming.students} طالب؟`} busy={busy} error={error} icon={scheduled ? 'calendar' : 'megaphone'}
          confirmLabel={scheduled ? 'جدولة الإشعار' : `إرسال إلى ${confirming.students} طالب`}
          onConfirm={() => void send()} onClose={() => { setConfirming(null); setError(''); }}>
          <p className="m-0">
            {scheduled ? 'يُرسل إلى ' : 'يصل الآن إلى '}
            <b className="text-ink">{confirming.students} طالب</b> في <b className="text-ink">{confirming.companies} شركة</b>
            {all ? ' (كل الشركات المفعّلة التي بها مستلمون)' : ` (من ${selected.length} شركة مختارة)`}
            {confirming.supervisors ? `، ومعهم ${confirming.supervisors} مشرف` : ''}.
          </p>
          <p className="m-0 text-label">يُنشأ إشعار مستقل لكل شركة، والشركة التي لا يوجد بها من يستلمه تُتخطى.</p>
          {scheduled && scheduledIso && <p className="m-0">موعد الإرسال: <b className="text-ink">{formatCairo(scheduledIso, true)}</b> {CAIRO_LABEL}.</p>}
          {draft.priority === 'high' && <p className="m-0 font-semibold text-bad">عاجل.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
};
