import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Dialog, ErrorState, Icon, Page, PageHeader, PhoneBar, SelectField, SkeletonForm, dayText } from '../ui';
import { useCompany } from '../lib/adminScope';
import { useLines } from '../lib/reference';
import { addDays, clockLabel } from '../lib/time';
import {
  REMINDER_CHOICES, closesOnRideDay, dayName, holidaysCount, reminderLabel, reminderTimes, timeline, timesCount, valuesSentence, weekdaysText,
  type VoteValues,
} from '../lib/rideConfirmation';
import { Holidays, WeekdayBoxes, reminderOptions, remindersSentence, useVoteForm } from '../components/VoteSettingsCard';
import { TimeField } from '../components/lines/fields';

const T: React.FC<{ t: string; className?: string }> = ({ t, className = '' }) => {
  const [hm, ap] = clockLabel(t).split(' ');
  return <span className={`whitespace-nowrap tabular ${className}`}>{hm} {ap}</span>;
};

/**
 * «تأكيد الركوب»: when students confirm tomorrow's ride, when it closes, how
 * often the app reminds those who have not, and the days without a reminder
 * (docs/canvas/AdmRide*). Was the seventh card of the company settings.
 */
export const RideConfirmationPage: React.FC = () => {
  const company = useCompany();
  const f = useVoteForm(company.id);
  const lines = useLines(company.id).data;
  const [ask, setAsk] = useState<'save' | 'reset' | null>(null);
  const firstTrip = useMemo(() => (lines ?? []).filter((l) => l.is_active).flatMap((l) => l.line_trips.filter((t) => t.direction === 'departure' && t.is_active))
    .map((t) => t.start_time.slice(0, 5)).sort()[0] ?? null, [lines]);

  const header = (
    <PageHeader title="تأكيد الركوب"
      sub={<><span className="hidden sm:inline">كل مساء يؤكد الطالب في التطبيق أنه سيركب غداً، فتعرف كم راكباً في كل رحلة. هنا تحدد متى يُفتح التأكيد، متى يُقفل، ومتى نذكّر من لم يؤكد.</span><span className="sm:hidden">متى يؤكد الطلاب ركوب الغد، ومتى نذكّر من لم يؤكد.</span></>} />
  );
  if (f.page.loading) return <Page>{header}<SkeletonForm rows={4} /></Page>;
  if (!f.v || !f.data) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل مواعيد التأكيد" text="لم نستطع جلب المواعيد الحالية. تأكد من اتصالك ثم حاول مرة أخرى. لم يتغيّر شيء عند الطلاب." onRetry={() => void f.page.reload()} /></Page>;
  }
  const v = f.v;
  const custom = f.data.custom;
  const before = addDays(f.today, 0); const ride = addDays(f.today, 1);
  const save = async () => { if (await f.save()) setAsk(null); };
  const saveLabel = 'حفظ مواعيد التأكيد';

  return (
    <Page>
      {header}
      <Example v={v} before={before} ride={ride} firstTrip={firstTrip} same={f.sameTimes} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_362px]">
        <Card as="section" className="flex flex-col">
          <Row title="متى يؤكد الطلاب" help="التأكيد يُفتح في اليوم السابق للرحلة. إن كان موعد الإقفال قبل موعد الفتح فهو في صباح يوم الرحلة.">
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
              <TimeField label="يُفتح التأكيد" value={v.opens_at} assume="pm" disabled={!f.online} onChange={(x) => f.set({ opens_at: x })} help="في اليوم السابق للرحلة" />
              <TimeField label="يُقفل التأكيد" value={v.closes_at} assume="am" disabled={!f.online} onChange={(x) => f.set({ closes_at: x })}
                error={f.sameTimes ? 'موعد الإقفال يجب أن يختلف عن موعد الفتح.' : undefined} help={closesOnRideDay(v.opens_at, v.closes_at) ? 'يوم الرحلة نفسه' : 'في اليوم السابق نفسه'} />
            </div>
          </Row>
          <Row title="تذكير من لم يؤكد" help="إشعار في التطبيق لمن لم يؤكد ولم يلغِ فقط.">
            <SelectField label="كم مرة نذكّره" className="sm:max-w-[320px]" value={String(v.reminder_minutes)} disabled={!f.online}
              options={reminderOptions(v.reminder_minutes)} onChange={(e) => f.set({ reminder_minutes: Number(e.target.value) })} />
            <p className="m-0 rounded-control bg-ground px-3.5 py-2.5 text-label text-ink-2">{f.sameTimes ? '' : `${remindersSentence(v)} `}{REMINDER_CHOICES}</p>
          </Row>
          <Row title="أيام بلا تذكير" help="أيام لا تعمل فيها الرحلات. المقصود يوم الرحلة نفسه: اختيار الجمعة يوقف تذكير رحلة الجمعة. التأكيد نفسه يبقى متاحاً لمن أراد.">
            <div className="flex flex-col gap-2"><div className="text-label font-medium">كل أسبوع</div><WeekdayBoxes f={f} /></div>
            <Holidays f={f} label="إجازات رسمية" />
          </Row>
          <footer className="hidden items-center gap-3 border-t border-hair px-6 py-4 sm:flex">
            <span className="flex-1 text-label text-ink-2">{f.changes ? changedText(f.changes) : ''}</span>
            <Button kind="secondary" disabled={!f.changes || f.saving || !f.online} onClick={f.undo}>تراجع عن التغييرات</Button>
            <Button disabled={!f.canSave} onClick={() => setAsk('save')}>{saveLabel}</Button>
          </footer>
        </Card>
        <div className="flex flex-col gap-6">
          <Card as="section" className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2"><h2 className="m-0 flex-1 text-card">{custom ? 'مواعيد خاصة بشركتك' : 'تعمل بمواعيد المنصة'}</h2><Badge tone={custom ? 'teal' : 'neutral'}>{custom ? 'خاصة' : 'المنصة'}</Badge></div>
            <p className="m-0 text-label text-ink-2">{custom
              ? `مواعيد المنصة التي تركتها: ${valuesSentence(f.data.platform)}.`
              : 'لم تحدد شركتك مواعيدها بعد، فتتبع ما تضعه إدارة المنصة وتتغيّر معه. أي تعديل تحفظه هنا يصبح خاصاً بشركتك.'}</p>
            {custom && <Button kind="outline" icon="undo" full disabled={!f.online || f.saving} onClick={() => setAsk('reset')}>الرجوع إلى مواعيد المنصة</Button>}
          </Card>
          <Card as="section" className="flex flex-col gap-3 p-5">
            <h2 className="m-0 text-card">ما يراه الطالب</h2>
            <StudentSees v={v} before={before} ride={ride} same={f.sameTimes} />
            <p className="m-0 border-t border-hair pt-3 text-label text-ink-2">أعداد من أكّدوا تراها في <Link to={`/c/${company.id}`} className="font-semibold text-teal hover:underline">اليوم</Link>، ولكل خط في <Link to={`/c/${company.id}/lines`} className="font-semibold text-teal hover:underline">الخطوط</Link>.</p>
          </Card>
        </div>
      </div>
      <PhoneBar><Button full disabled={!f.canSave} onClick={() => setAsk('save')}>{saveLabel}</Button></PhoneBar>

      <Dialog open={ask === 'save'} onClose={() => !f.saving && setAsk(null)} icon="clock" title="حفظ مواعيد التأكيد؟"
        actions={[<Button key="c" kind="secondary" data-autofocus disabled={f.saving} onClick={() => setAsk(null)}>رجوع</Button>,
          <Button key="ok" loading={f.saving} disabled={!f.online} onClick={() => void save()}>حفظ المواعيد</Button>]}>
        <p className="m-0">لكل طلاب شركتك: يُفتح التأكيد <T t={v.opens_at} /> في اليوم السابق ويُقفل <T t={v.closes_at} /> {closesOnRideDay(v.opens_at, v.closes_at) ? 'يوم الرحلة' : 'في اليوم نفسه'}، {v.reminder_minutes ? `بتذكير ${reminderLabel(v.reminder_minutes)}` : 'بلا تذكير'}.</p>
        <p className="m-0">{offSentence(v)}{custom ? '' : ' تصبح هذه مواعيد خاصة بشركتك ولا تتبع المنصة بعدها.'}</p>
      </Dialog>
      <Dialog open={ask === 'reset'} onClose={() => !f.saving && setAsk(null)} icon="undo" title="الرجوع إلى مواعيد المنصة؟"
        actions={[<Button key="c" kind="secondary" data-autofocus disabled={f.saving} onClick={() => setAsk(null)}>رجوع</Button>,
          <Button key="ok" loading={f.saving} disabled={!f.online} onClick={async () => { if (await f.save(true)) setAsk(null); }}>الرجوع إلى مواعيد المنصة</Button>]}>
        <p className="m-0">تُمحى مواعيدك الخاصة{yourHolidays(f.saved?.off_dates.length ?? 0)}، وتتبع شركتك المنصة: {valuesSentence(f.data.platform)}.</p>
        <p className="m-0">إن غيّرت المنصة مواعيدها لاحقاً تغيّرت عندك معها.</p>
      </Dialog>
    </Page>
  );
};

const ORD = ['', '', '', 'الثلاث', 'الأربع', 'الخمس', 'الست', 'السبع', 'الثماني', 'التسع', 'العشر'];
/** «وإجازاتك الثلاث», «وإجازتك», «وإجازتيك», «وإجازاتك الـ12». */
function yourHolidays(n: number) {
  if (!n) return '';
  if (n === 1) return ' وإجازتك';
  if (n === 2) return ' وإجازتيك';
  return ` وإجازاتك ${n <= 10 ? ORD[n] : `الـ${n}`}`;
}
/** «غيّرت 3 أشياء ولم تُحفظ». */
function changedText(n: number) {
  if (n === 1) return 'غيّرت شيئاً واحداً ولم يُحفظ';
  if (n === 2) return 'غيّرت شيئين ولم يُحفظا';
  return `غيّرت ${n} ${n <= 10 ? 'أشياء' : 'شيئاً'} ولم تُحفظ`;
}
/** «بلا تذكير: كل جمعة، و3 إجازات.» */
function offSentence(v: VoteValues) {
  const w = weekdaysText(v.off_weekdays); const d = v.off_dates.length ? holidaysCount(v.off_dates.length) : '';
  if (!w && !d) return 'التذكير كل أيام الأسبوع.';
  return `بلا تذكير: ${[w, d].filter(Boolean).join('، و')}.`;
}

/** One section of the form: title and help on the start side, fields on the end side; stacked on a phone. */
const Row: React.FC<{ title: string; help: string; children: React.ReactNode }> = ({ title, help, children }) => (
  <div className="grid grid-cols-1 gap-4 border-b border-hair p-4 last-of-type:border-b-0 sm:p-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-8">
    <div><h2 className="m-0 text-card">{title}</h2><p className="m-0 mt-0.5 text-label text-ink-2">{help}</p></div>
    <div className="flex min-w-0 flex-col gap-4">{children}</div>
  </div>
);

/** «مثال: رحلة الأحد 11 أكتوبر»: the confirmation window on a line from noon to noon (a list on a phone). */
const Example: React.FC<{ v: VoteValues; before: string; ride: string; firstTrip: string | null; same: boolean }> = ({ v, before, ride, firstTrip, same }) => {
  const tl = timeline(v);
  const rideText = dayText(ride, { weekday: true, year: false });
  const at = (x: number) => `${(x * 100).toFixed(2)}%`;
  const reminders = tl.reminders;
  const phoneRows: { day: string; t: string; text: string; tone: 'teal' | 'mute' | 'ink' | 'ok' }[] = same ? [] : [
    ...(reminders.length > 4 ? [reminders[0], reminders[reminders.length - 1]] : reminders).map((r, i) => ({ day: dayName(r.day === 'before' ? before : ride), t: r.time,
      text: i === 0 ? 'يُفتح التأكيد، ويصل أول تذكير' : reminders.length > 4 ? `آخر تذكير (${reminderLabel(v.reminder_minutes)}، ${timesCount(reminders.length)} في الليلة)` : 'تذكير لمن لم يؤكد',
      tone: (i === 0 ? 'teal' : 'mute') as 'teal' | 'mute' })),
    ...(reminders.length ? [] : [{ day: dayName(before), t: v.opens_at, text: 'يُفتح التأكيد', tone: 'teal' as const }]),
    { day: dayName(tl.close.day === 'before' ? before : ride), t: v.closes_at, text: 'يُقفل التأكيد وتثبت الأعداد', tone: 'ink' },
    ...(firstTrip ? [{ day: dayName(ride), t: firstTrip, text: 'أول رحلة ذهاب', tone: 'ok' as const }] : []),
  ];
  return (
    <Card as="section" className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <h2 className="m-0 flex-1 text-card">مثال: رحلة {rideText}</h2>
        <span className="hidden items-center gap-2 text-label text-ink-2 sm:flex"><span aria-hidden="true" className="h-2 w-5 rounded-full bg-teal" />التأكيد مفتوح</span>
      </div>
      {same ? <p className="m-0 text-small text-bad">اختر موعدين مختلفين للفتح والإقفال.</p> : (
        <>
          {/* Desktop and tablet: the line */}
          <div className="relative hidden h-[124px] sm:block" aria-hidden="true">
            <div className="absolute inset-x-0 top-[60px] h-1.5 rounded-full bg-sunken" />
            <div className="absolute top-[60px] h-1.5 rounded-full bg-teal" style={{ insetInlineStart: at(tl.open.at), width: at(tl.close.at - tl.open.at) }} />
            <div className="absolute bottom-0 top-[28px] border-s border-dashed border-disabled" style={{ insetInlineStart: at(tl.midnight) }} />
            <Mark x={at(tl.open.at)} up title={<>يُفتح <T t={v.opens_at} /></>} sub="يظهر السؤال للطلاب" dot="bg-teal" tone="text-teal" />
            <Mark x={at(tl.close.at)} up title={<>يُقفل <T t={v.closes_at} /></>} sub="تثبت الأعداد للمشرف ولك" dot="bg-ink" tone="text-ink" />
            {reminders.map((r, i) => ({ r, i, label: reminders.length <= 7 || i === reminders.length - 1 || (i % Math.ceil(reminders.length / 6) === 0 && reminders.length - 1 - i >= Math.ceil(reminders.length / 6) / 2 + 0.5) })).map(({ r, i, label }) => (
              <div key={i} className="absolute top-[78px] flex translate-x-1/2 flex-col items-center text-cap text-ink-2" style={{ insetInlineStart: at(r.at) }}>
                <Icon name="megaphone" size={14} className="text-ink-3" />{label && <span className="whitespace-nowrap">{reminders.length <= 7 ? 'تذكير ' : ''}<T t={r.time} /></span>}
              </div>
            ))}
          </div>
          <span className="sr-only">يُفتح التأكيد {clockLabel(v.opens_at)} ويُقفل {clockLabel(v.closes_at)}، {remindersSentence(v)}</span>
          <div className="hidden items-center gap-4 border-t border-hair pt-3 text-label text-ink-2 sm:flex">
            <span className="flex-1"><b className="font-semibold text-ink">{dayText(before, { weekday: true, year: false })}</b> · اليوم السابق للرحلة</span>
            <span><b className="font-semibold text-ink">{rideText}</b> · يوم الرحلة{firstTrip ? <>، وأول رحلة <T t={firstTrip} /></> : ''}</span>
          </div>
          {/* Phone: the same moments as a list */}
          <ol className="m-0 flex list-none flex-col p-0 sm:hidden">
            {phoneRows.map((r, i) => (
              <li key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`mt-1.5 h-3 w-3 flex-none rounded-full ${r.tone === 'teal' ? 'bg-teal' : r.tone === 'ink' ? 'bg-ink' : r.tone === 'ok' ? 'bg-ok' : 'bg-disabled'}`} />
                  {i < phoneRows.length - 1 && <span className={`w-1 flex-1 ${phoneRows.slice(0, i + 1).some((x) => x.tone === 'ink') ? 'bg-sunken' : 'bg-teal'}`} />}
                </div>
                <div className="pb-3"><div className="text-small font-semibold">{r.day} <T t={r.t} /></div><div className="text-label text-ink-2">{r.text}</div></div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
};

const Mark: React.FC<{ x: string; up?: boolean; title: React.ReactNode; sub: string; dot: string; tone: string }> = ({ x, title, sub, dot, tone }) => (
  <>
    <div className="absolute top-0 flex translate-x-1/2 flex-col items-center" style={{ insetInlineStart: x }}>
      <span className={`whitespace-nowrap text-small font-semibold ${tone}`}>{title}</span>
      <span className="whitespace-nowrap text-cap text-ink-2">{sub}</span>
    </div>
    <span className={`absolute top-[56px] h-3.5 w-3.5 translate-x-1/2 rounded-full ${dot} shadow-[0_0_0_3px_#fff]`} style={{ insetInlineStart: x }} />
  </>
);

const StudentSees: React.FC<{ v: VoteValues; before: string; ride: string; same: boolean }> = ({ v, before, ride, same }) => {
  if (same) return <p className="m-0 text-small text-ink-2">اختر موعدين مختلفين للفتح والإقفال لترى ما يراه الطالب.</p>;
  const n = reminderTimes(v.opens_at, v.closes_at, v.reminder_minutes).length;
  const rideName = dayName(ride); const closeDay = closesOnRideDay(v.opens_at, v.closes_at) ? rideName : dayName(before);
  const rows: [React.ComponentProps<typeof Icon>['name'], React.ReactNode][] = [
    ['smartphone', <>من <T t={v.opens_at} /> {dayName(before)} حتى <T t={v.closes_at} /> {closeDay} يؤكد ركوبه لرحلة {rideName} أو يلغيه.</>],
    ['megaphone', n ? <>من لم يؤكد يصله تذكير في التطبيق {timesCount(n)}. يتوقف التذكير حين يؤكد أو يلغي.</> : <>لا يصله تذكير؛ يؤكد متى فتح التطبيق.</>],
    ['lock', <>بعد <T t={v.closes_at} /> يُقفل تأكيد رحلة {rideName}.</>],
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map(([icon, text], i) => (
        <li key={i} className="flex items-start gap-3 text-small"><Icon name={icon} size={18} className="mt-0.5 text-teal" /><span>{text}</span></li>
      ))}
    </ul>
  );
};
