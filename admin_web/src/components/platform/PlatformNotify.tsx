import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, Card, Checkbox, Dialog, FormSection, Icon, InfoRows, Note, PageHeader, PhoneBar, RadioCards, SidePanel, StatePill, TextArea, TextField, Toggle,
  countText, num, NOUN, errorText, cairo, clock, dayText, useOnline, type StateKey,
} from '../../ui';
import { useGuard } from '../../lib/guard';
import { notifyDone } from '../../lib/toasts';
import { cairoLocalToIso, cairoToday } from '../../lib/time';
import { BODY_MAX, TITLE_MAX, idempotencyKeyFor, percent, type HistoryRow } from '../../lib/notifications';
import { awaitPlatformHistory, platformComposeNotification, usePlatformPreview } from '../../lib/notificationsData';
import { usePlatformCompanyList, type NoteGroup } from '../../lib/platform';
import { DayPicker, TimeSelect, pickedDay } from './fields';

export const NOTE_STATE: Record<string, [StateKey, string]> = { sent: ['sent', 'أُرسل'], scheduled: ['scheduled', 'مجدول'], failed: ['failed', 'فشل الإرسال'], cancelled: ['cancelled', 'أُلغي'] };
export const NoteState: React.FC<{ status: string }> = ({ status }) => <StatePill state={(NOTE_STATE[status] ?? NOTE_STATE.sent)[0]} label={(NOTE_STATE[status] ?? NOTE_STATE.sent)[1]} />;
const students = (n: number) => `${num(n)} ${n === 1 ? 'طالب' : n === 2 ? 'طالبان' : n <= 10 ? 'طلاب' : 'طالباً'}`;
const supervisors = (n: number) => `${num(n)} ${n === 1 ? 'مشرف' : n === 2 ? 'مشرفان' : n <= 10 ? 'مشرفين' : 'مشرفاً'}`;

/** A field's label with its length counter at the other end («14/80»). */
const LabelRow: React.FC<{ htmlFor: string; label: string; n: number; max: number }> = ({ htmlFor, label, n, max }) => (
  <div className="flex items-baseline gap-2">
    <label htmlFor={htmlFor} className="flex-1 text-label font-medium">{label}</label>
    <span dir="ltr" aria-label={`${n} من ${max} حرفاً`} className={`text-cap tabular ${n > max ? 'text-bad' : 'text-ink-3'}`}>{n}/{max}</span>
  </div>
);

/** The phone notification as a student sees it, drawn from what is typed. */
const PhoneCard: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="flex flex-col gap-3 rounded-card bg-ink p-4">
    <span className="text-cap text-[#C9D8E1]">كما يظهر على هاتف الطالب</span>
    <div className="flex items-start gap-3 rounded-inner bg-[#EAF0F4] p-3 text-ink">
      <span aria-hidden="true" className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-teal text-white"><Icon name="bus" size={16} /></span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-small font-semibold">{title.trim() || 'عنوان الإشعار'}</span><span className="text-cap text-ink-3">الآن</span></div>
        <span className="line-clamp-3 text-label text-ink-2">{body.trim() || 'نص الإشعار يظهر هنا.'}</span>
      </div>
    </div>
  </div>
);

/**
 * «إشعار جديد» from the platform (AdmPlatNotifyNew, AdmPlatNotifySend): to the
 * students of every working company or of chosen ones, counted by the server before
 * anything is sent; one confirmation that repeats the real numbers.
 */
export const PlatformCompose: React.FC = () => {
  const navigate = useNavigate();
  const online = useOnline();
  const guard = useGuard();
  const list = usePlatformCompanyList();
  const working = useMemo(() => (list.data ?? []).filter((c) => c.status === 'active'), [list.data]);
  const [all, setAll] = useState<'all' | 'some'>('all');
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [high, setHigh] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [day, setDay] = useState({ day: '', month: '' });
  const [time, setTime] = useState('18:00');
  const [tried, setTried] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const preview = usePlatformPreview(all === 'all', chosen);
  const p = preview.data;

  const picked = pickedDay(day);
  const scheduledAt = when === 'later' && picked && picked !== 'bad' ? cairoLocalToIso(`${picked}T${time}`) : null;
  const errors = {
    companies: all === 'some' && chosen.length === 0 ? 'اختر شركة واحدة على الأقل.' : undefined,
    title: !title.trim() ? 'اكتب عنوان الإشعار.' : title.trim().length > TITLE_MAX ? `العنوان أطول من ${TITLE_MAX} حرفاً.` : undefined,
    body: !body.trim() ? 'اكتب نص الإشعار.' : body.trim().length > BODY_MAX ? `النص أطول من ${BODY_MAX} حرفاً.` : undefined,
    when: when !== 'later' ? undefined : !picked ? 'اكتب اليوم واختر الشهر.' : picked === 'bad' ? 'هذا الشهر ليس فيه هذا اليوم.'
      : !scheduledAt || new Date(scheduledAt).getTime() <= Date.now() ? 'اختر موعداً لم يأتِ بعد (بتوقيت القاهرة).' : undefined,
  };
  const bad = Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  const toggle = (id: string, on: boolean) => setChosen((x) => (on ? [...new Set([...x, id])] : x.filter((y) => y !== id)));

  const ask = () => { setTried(true); setError(''); if (!bad && preview.status === 'ready') setAsking(true); };
  const send = () => void guard('send', async () => {
    const k = idempotencyKeyFor(key, true);
    setKey(k);
    setBusy(true);
    try {
      const out = await platformComposeNotification({ title: title.trim(), body: body.trim(), companyIds: all === 'all' ? null : [...chosen].sort(), scheduledAt, idempotencyKey: k!, priority: high ? 'high' : 'normal' });
      awaitPlatformHistory();
      notifyDone(out.status === 'scheduled' ? `جُدول الإشعار لطلاب ${countText(out.companies, NOUN.company)}.` : `أُرسل الإشعار إلى ${students(out.students)} في ${countText(out.companies, NOUN.company)}.`);
      navigate('/platform/notifications');
    } catch (e) { setError(errorText(e)); setAsking(false); }
    setBusy(false);
  });

  const count = p ? p.students : null;
  const recipients = (
    <Card className="flex flex-col gap-3 p-4 lg:p-5">
      <span className="text-small font-semibold">من سيصله</span>
      {preview.status === 'loading' || preview.status === 'incomplete' ? <span className="text-label text-ink-3">{preview.status === 'incomplete' ? 'اختر الشركات أولاً.' : 'نعدّ المستلمين…'}</span>
        : preview.status === 'error' ? <span className="text-label text-bad">تعذّر عدّ المستلمين. تأكد من اتصالك.</span> : p && (
          <>
            <div className="flex items-baseline gap-2"><span className="text-num tabular">{num(p.students)}</span><span className="text-label text-ink-2">{p.students === 1 ? 'طالب' : 'طالباً'} في {countText(p.companies, NOUN.company)}</span></div>
            <InfoRows labelW={110} rows={[
              ['مشرفون', num(p.supervisors)],
              ['هواتف مسجّلة', `${num(p.devices)} — يظهر عليها كتنبيه`],
              ['شركة بلا مستلمين', 'تُتخطى تلقائياً'],
            ]} />
            <span className="text-label text-ink-2">يُنشأ إشعار مستقل لكل شركة، ويظهر في سجلّها.</span>
          </>
        )}
    </Card>
  );
  const primary = <Button icon={when === 'later' ? 'clock' : 'send'} disabled={!online || (tried && bad)} onClick={ask}>{when === 'later' ? 'جدول الإشعار' : 'أرسل الإشعار'}</Button>;
  const cancel = <Button kind="secondary" onClick={() => navigate('/platform/notifications')}>إلغاء</Button>;

  return (
    <>
      <PageHeader title="إشعار جديد" back={{ label: 'إشعارات المنصة', to: '/platform/notifications' }} sub="رسالة من المنصة إلى طلاب كل الشركات أو شركات تختارها. نعدّ من سيصله قبل أن يُرسل شيء." />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col">
          <div className="flex flex-col gap-5 p-4 lg:p-6">
            <RadioCards label="يصل إلى" value={all} onChange={setAll} cols={2} options={[
              { value: 'all', label: 'طلاب كل الشركات التي تعمل', sub: countText(working.length, NOUN.company) },
              { value: 'some', label: 'شركات أختارها', sub: countText(chosen.length, NOUN.company) },
            ]} />
            {all === 'some' && (
              <div className={`flex flex-col overflow-hidden rounded-inner ${show('companies') ? 'shadow-field-error' : 'shadow-ring'}`}>
                <div className="flex items-center gap-3 bg-ground px-4 py-2.5">
                  <span className="flex-1 text-label font-medium">{num(chosen.length)} من {countText(working.length, NOUN.company)} تعمل</span>
                  <Button kind="link" sm onClick={() => setChosen(working.map((c) => c.id))}>حدد الكل</Button>
                  <Button kind="link" sm onClick={() => setChosen([])}>امسح</Button>
                </div>
                <div className="grid max-h-[280px] grid-cols-1 gap-x-6 overflow-y-auto px-4 py-1 sm:grid-cols-2">
                  {working.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Checkbox label={c.name} checked={chosen.includes(c.id)} onChange={(on) => toggle(c.id, on)} className="min-w-0 flex-1" />
                      <span className="text-cap text-ink-3 tabular">{num(c.students)}</span>
                    </div>
                  ))}
                </div>
                <span className="border-t border-hair px-4 py-1.5 text-cap text-ink-3">مرّر لترى باقي الشركات · الرقم عدد الطلاب</span>
                {show('companies') && <span role="alert" className="px-4 pb-2 text-label text-bad">{errors.companies}</span>}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <LabelRow htmlFor="pn-title" label="العنوان" n={title.trim().length} max={TITLE_MAX} />
              <TextField id="pn-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX + 20} error={show('title')} />
            </div>
            <div className="flex flex-col gap-1.5"><LabelRow htmlFor="pn-body" label="نص الإشعار" n={body.trim().length} max={BODY_MAX} /><TextArea id="pn-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={BODY_MAX + 50} error={show('body')} /></div>
            <Toggle label="أولوية عالية" help="للأمور العاجلة فقط، مثل تغيير يخص رحلة اليوم." checked={high} onChange={setHigh} />
            <RadioCards label="موعد الإرسال" value={when} onChange={setWhen} cols={2} options={[{ value: 'now', label: 'الآن' }, { value: 'later', label: 'في موعد لاحق' }]} />
            {when === 'later' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DayPicker label="اليوم" today={cairoToday()} value={day} onChange={setDay} error={show('when')} />
                <TimeSelect label="الساعة" value={time} onChange={setTime} help="بتوقيت القاهرة" />
              </div>
            )}
            {error && <Note tone="danger" title="لم يُرسل الإشعار">{error}</Note>}
          </div>
          <div className="hidden justify-end gap-2 border-t border-hair px-6 py-3 sm:flex">{cancel}{primary}</div>
        </Card>
        <div className="flex flex-col gap-4">
          <PhoneCard title={title} body={body} />
          {recipients}
        </div>
      </div>
      <PhoneBar>{React.cloneElement(primary, { full: true })}</PhoneBar>
      <Dialog open={asking} onClose={() => setAsking(false)} icon={when === 'later' ? 'clock' : 'send'}
        title={when === 'later' ? `جدولة الإشعار إلى ${count != null ? students(count) : 'الطلاب'}؟` : `إرسال الإشعار إلى ${count != null ? students(count) : 'الطلاب'}؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(false)}>رجوع</Button>, <Button key="g" loading={busy} onClick={send}>{when === 'later' ? 'جدول الإشعار' : 'أرسل الإشعار'}</Button>]}>
        <p className="m-0">
          {when === 'later' && scheduledAt ? `يُرسل ${dayText(cairo(scheduledAt).day, { weekday: true })} ${clock(cairo(scheduledAt).time)} إلى ` : 'يُرسل الآن إلى '}
          <b className="text-ink">{p ? `${students(p.students)} و${supervisors(p.supervisors)}` : 'الطلاب'}</b>{' '}
          {all === 'all' ? `في كل الشركات التي تعمل (${countText(p?.companies ?? working.length, NOUN.company)}).` : `في ${countText(p?.companies ?? chosen.length, NOUN.company)} اخترتها.`}
          {when === 'later' ? ' تستطيع إلغاءه من السجل قبل موعده.' : ' لا يمكن استرجاعه بعد الإرسال.'}
        </p>
      </Dialog>
    </>
  );
};

/** One notification (AdmPlatNotifyDetails): what was sent, to whom, when, and what happened. */
export const NoteDetails: React.FC<{
  g: NoteGroup<HistoryRow> | null; onClose: () => void; onDelete: () => void; onCancel: () => void; online: boolean;
}> = ({ g, onClose, onDelete, onCancel, online }) => {
  if (!g) return null;
  const r = g.first;
  const push = g.rows.reduce((a, x) => ({ accepted: a.accepted + (x.push?.accepted ?? 0), failed: a.failed + (x.push?.failed ?? 0), skipped: a.skipped + (x.push?.skipped ?? 0) }), { accepted: 0, failed: 0, skipped: 0 });
  const at = r.sent_at ?? r.scheduled_at ?? r.created_at;
  const c = cairo(at);
  const done = r.status === 'sent';
  return (
    <SidePanel open onClose={onClose} title="تفاصيل الإشعار" meta={<NoteState status={r.status} />} sub={g.platform ? 'أرسلته المنصة' : `أرسلته ${r.company_name ?? 'الشركة'}`} backLabel="إشعارات المنصة"
      footer={<>
        {r.status === 'scheduled'
          ? <Button kind="dangerQuiet" icon="x" disabled={!online} onClick={onCancel}>ألغِ الإرسال</Button>
          : <Button kind="dangerQuiet" icon="trash" disabled={!online} onClick={onDelete}>احذف من السجل</Button>}
        <span className="hidden flex-1 sm:block" />
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">إغلاق</Button>
      </>}>
      <div className="flex flex-col gap-0.5 rounded-inner bg-ground px-4 py-3">
        <span className="text-small font-semibold">{r.title}</span>
        <span className="whitespace-pre-line text-label text-ink-2">{r.body}</span>
      </div>
      <section className="flex flex-col gap-1">
        <h3 className="m-0 text-card">الإرسال</h3>
        <InfoRows labelW={140} rows={[
          ['المرسل', g.platform ? `المنصة${r.sender_name ? ` · ${r.sender_name}` : ''}` : `${r.company_name ?? ''}${r.sender_name ? ` · ${r.sender_name}` : ''}`],
          ['إلى', g.platform ? `طلاب ${countText(g.rows.length, NOUN.company)} ${g.rows.length > 2 ? 'تعمل' : ''}`.trim() : r.audience ?? 'طلاب الشركة'],
          [r.status === 'scheduled' ? 'يُرسل' : 'الموعد', `${dayText(c.day, { weekday: true, year: false })} ${clock(c.time)}`],
          ['النوع', r.priority === 'high' ? 'عاجل' : 'عادي'],
        ]} />
      </section>
      {done && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-card">ماذا حدث</h3>
          <InfoRows labelW={160} rows={[
            ['المستلمون', students(g.students)],
            ['قرأه في التطبيق', `${num(g.read)} (${percent(g.read, g.students)}%)`],
            ['فتحه من التنبيه', num(g.opened)],
            ['سُلّم لخدمة التنبيهات', num(push.accepted)],
            ['فشل', `${num(push.failed)} ${push.failed === 1 ? 'هاتف' : push.failed === 2 ? 'هاتفان' : push.failed <= 10 ? 'هواتف' : 'هاتفاً'}`],
            ['لم يُرسل له تنبيه', `${num(push.skipped)} — بلا هاتف مسجّل أو أوقف التنبيهات`],
          ]} />
        </section>
      )}
      {r.status === 'failed' && <Note tone="danger" title="لم يُرسل">{r.status_note && /[؀-ۿ]/.test(r.status_note) ? r.status_note : 'تعذّر الإرسال من جهتنا. أعد كتابته وأرسله من جديد.'}</Note>}
      {done && g.platform && g.rows.length > 1 && (
        <section className="flex flex-col gap-1">
          <h3 className="m-0 text-card">في كل شركة</h3>
          <InfoRows labelW={220} rows={g.rows.slice(0, 4).map((x) => [<span className="text-small text-ink">{x.company_name}</span>, <span className="text-ink-2">{done ? `${num(x.students)} مستلماً` : '—'}</span>])} />
          {g.rows.length > 4 && <span className="text-label text-teal">و{countText(g.rows.length - 4, NOUN.company)} أخرى</span>}
        </section>
      )}
    </SidePanel>
  );
};
