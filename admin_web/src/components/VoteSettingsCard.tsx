import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, FormSection, Icon, Note, SelectField, SkeletonForm, ErrorState, errorText, useOnline } from '../ui';
import { supabase } from '../lib/supabase';
import { usePageData, keys, unwrap } from '../lib/query';
import { useGuard } from '../lib/guard';
import { notify, notifyError } from '../lib/toasts';
import { addDays, cairoToday, clockLabel } from '../lib/time';
import { useSaveVoteSettings, useVoteSettings } from '../lib/linesData';
import {
  REMINDERS, REMINDER_CHOICES, WEEK, changeCount, closesOnRideDay, dayName, holidayText, holidaysCount, reminderLabel,
  reminderTimes, remindersCount, timesCount, weekdaysText, type VoteValues, type VoteSettings,
} from '../lib/rideConfirmation';
import { TimeField, DayField } from './lines/fields';

const pick = (v: VoteValues): VoteValues => ({
  opens_at: v.opens_at.slice(0, 5), closes_at: v.closes_at.slice(0, 5), reminder_minutes: v.reminder_minutes,
  off_weekdays: [...(v.off_weekdays ?? [])].sort((a, b) => a - b), off_dates: [...(v.off_dates ?? [])].sort(),
});

/**
 * The editable copy of the vote settings, its checks and its one request.
 * Shared by «تأكيد الركوب» (a company) and the platform defaults (companyId null).
 */
export function useVoteForm(companyId: string | null) {
  const page = useVoteSettings(companyId);
  const saved = page.data ? pick(page.data) : null;
  const [v, setV] = useState<VoteValues | null>(saved);
  const [day, setDay] = useState('');
  const [dayError, setDayError] = useState('');
  const [saving, setSaving] = useState(false);
  const online = useOnline();
  const guard = useGuard();
  const send = useSaveVoteSettings(companyId);
  const savedKey = saved ? JSON.stringify(saved) : '';
  // The editable copy follows what is saved, whenever that changes.
  useEffect(() => { if (saved) setV(saved); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = cairoToday();
  const changes = saved && v ? changeCount(saved, v) : 0;
  const sameTimes = !!v && v.opens_at === v.closes_at;
  const set = (p: Partial<VoteValues>) => setV((x) => (x ? { ...x, ...p } : x));
  const toggleDay = (iso: number) => setV((x) => (x ? { ...x, off_weekdays: x.off_weekdays.includes(iso) ? x.off_weekdays.filter((d) => d !== iso) : [...x.off_weekdays, iso].sort((a, b) => a - b) } : x));
  const addHoliday = () => {
    if (!v || !day) return;
    if (day < today) { setDayError('اختر اليوم أو يوماً بعده.'); return; }
    if (v.off_dates.includes(day)) { setDayError('هذا اليوم مضاف من قبل.'); return; }
    set({ off_dates: [...v.off_dates, day].sort() }); setDay(''); setDayError('');
  };
  const pickDay = (d: string) => { setDay(d); setDayError(d && d < today ? 'اختر اليوم أو يوماً بعده.' : ''); };
  const save = (reset = false) => guard('vote', async () => {
    if (!v) return false;
    setSaving(true);
    try {
      await send(reset ? null : v);
      notify({ title: reset ? 'عادت شركتك إلى مواعيد المنصة.' : companyId ? 'حُفظت مواعيد التأكيد. تسري على كل طلاب الشركة.' : 'حُفظت مواعيد التأكيد. تصل فوراً إلى الشركات التي تتبع المنصة.', tone: 'success' });
      return true;
    } catch (error) {
      notifyError('لم تُحفظ مواعيد التأكيد', errorText(error));
      return false;
    } finally {
      setSaving(false);
    }
  });
  return {
    page, data: page.data as VoteSettings | undefined, saved, v, set, toggleDay, day, pickDay, addHoliday, dayError,
    removeHoliday: (d: string) => set({ off_dates: (v?.off_dates ?? []).filter((x) => x !== d) }),
    undo: () => { if (saved) setV(saved); setDay(''); setDayError(''); },
    changes, sameTimes, canSave: online && changes > 0 && !sameTimes && !saving && !dayError, online, saving, save, today,
  };
}
export type VoteForm = ReturnType<typeof useVoteForm>;

/** The reminder choices, plus a saved value that is not one of them. */
export const reminderOptions = (current: number) => (REMINDERS.some((r) => r.value === current) ? REMINDERS : [...REMINDERS, { value: current, label: reminderLabel(current) }])
  .map((r) => ({ value: String(r.value), label: r.label }));

/** The seven weekdays as checkbox cards (company page) or pills (platform). */
export const WeekdayBoxes: React.FC<{ f: VoteForm; pills?: boolean }> = ({ f, pills }) => (
  <div role="group" aria-label="أيام بلا تذكير كل أسبوع" className={pills ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-4'}>
    {WEEK.map((d) => {
      const on = !!f.v?.off_weekdays.includes(d.iso);
      if (pills) {
        return (
          <button key={d.iso} type="button" aria-pressed={on} disabled={!f.online} onClick={() => f.toggleDay(d.iso)}
            className={`inline-flex h-10 items-center rounded-full px-3.5 text-label sm:h-9 ${on ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink shadow-ring hover:bg-ground'}`}>
            {d.name}{on ? ' · بلا تذكير' : ''}
          </button>
        );
      }
      return (
        <label key={d.iso} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-control px-3.5 sm:min-h-11 ${on ? 'bg-teal-tint shadow-[inset_0_0_0_2px_#00658D]' : 'bg-surface shadow-field hover:shadow-field-hover'}`}>
          <input type="checkbox" className="peer sr-only" checked={on} onChange={() => f.toggleDay(d.iso)} />
          <span aria-hidden="true" className={`flex h-5 w-5 flex-none items-center justify-center rounded-md peer-focus-visible:shadow-focus ${on ? 'bg-teal text-white' : 'bg-surface shadow-[inset_0_0_0_1.5px_#58707F]'}`}>{on && <Icon name="check" size={14} stroke={3} />}</span>
          <span className={`text-small ${on ? 'font-semibold text-teal' : 'text-ink'}`}>{d.name}</span>
        </label>
      );
    })}
  </div>
);

/** «إجازات رسمية»: pick a day, add it, remove it. */
export const Holidays: React.FC<{ f: VoteForm; label: React.ReactNode; withYear?: boolean; addKind?: 'outline' | 'secondary' }> = ({ f, label, withYear, addKind = 'outline' }) => {
  const year = withYear ? '0000' : f.today.slice(0, 4);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-label font-medium">{label}</div>
      <div className="flex items-start gap-2">
        <DayField className="min-w-0 flex-1 sm:max-w-[330px]" label="إجازة رسمية" value={f.day} min={f.today} text={f.day ? holidayText(f.day, year) : ''} onChange={f.pickDay} error={f.dayError} disabled={!f.online} />
        <Button kind={addKind} icon="plus" onClick={f.addHoliday} disabled={!f.day || !!f.dayError || !f.online}>أضف</Button>
      </div>
      {(f.v?.off_dates.length ?? 0) === 0 ? <p className="m-0 text-label text-ink-2">لا إجازات قادمة.</p> : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {f.v!.off_dates.map((d) => (
            <li key={d} className="inline-flex h-9 items-center gap-1 rounded-control bg-sunken pe-1 ps-3 text-label font-semibold">
              {holidayText(d, year)}
              <button type="button" aria-label={`احذف ${holidayText(d, year)}`} disabled={!f.online} onClick={() => f.removeHoliday(d)} className="flex h-8 w-8 items-center justify-center rounded-control text-ink-2 hover:bg-hair"><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** «3 تذكيرات: 4:00 م، 10:00 م، 4:00 ص.» */
export function remindersSentence(v: VoteValues, long = 99): string {
  const t = reminderTimes(v.opens_at, v.closes_at, v.reminder_minutes);
  if (!t.length) return 'لا تُرسل تذكيرات.';
  const list = t.length > long ? `${t.slice(0, 3).map(clockLabel).join('، ')} … حتى ${clockLabel(t[t.length - 1])}` : t.map(clockLabel).join('، ');
  return `${remindersCount(t.length)}: ${list}.`;
}

/**
 * The vote hours as one form section. The company's own page is «تأكيد الركوب»
 * (pages/RideConfirmationPage); this card is the platform defaults' section
 * (companyId null), and still works for a company (same props as before).
 */
export const VoteSettingsCard: React.FC<{ companyId: string | null; companyName: string; followers?: number }> = ({ companyId, companyName, followers }) => {
  const f = useVoteForm(companyId);
  const [ask, setAsk] = useState(false);
  const counts = usePageData(keys.platform('voteFollowers'), () => unwrap<{ id: string; vote_opens_at: string | null }[]>(
    supabase.from('companies').select('id, vote_opens_at')), { enabled: companyId === null && followers == null });
  const follow = followers ?? (counts.data ? counts.data.filter((c) => !c.vote_opens_at).length : null);
  const own = counts.data ? counts.data.length - (follow ?? 0) : null;
  const firstChange = useMemo(() => {
    if (!f.saved || !f.v) return '';
    if (f.v.closes_at !== f.saved.closes_at) return `يُقفل التأكيد ${clockLabel(f.v.closes_at)} بدل ${clockLabel(f.saved.closes_at)}`;
    if (f.v.opens_at !== f.saved.opens_at) return `يُفتح التأكيد ${clockLabel(f.v.opens_at)} بدل ${clockLabel(f.saved.opens_at)}`;
    if (f.v.reminder_minutes !== f.saved.reminder_minutes) return `يصبح التذكير ${reminderLabel(f.v.reminder_minutes)} بدل ${reminderLabel(f.saved.reminder_minutes)}`;
    return 'تتغيّر أيام بلا تذكير';
  }, [f.saved, f.v]);

  if (f.page.loading) return <SkeletonForm rows={3} />;
  if (!f.v || !f.data) return <ErrorState card title="تعذّر تحميل مواعيد التأكيد" text="لم نستطع جلب المواعيد الحالية. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void f.page.reload()} />;
  const v = f.v;
  const editable = companyId ? true : f.data.can_edit_platform;
  const ride = addDays(f.today, 1);
  const before = dayName(f.today); const rideName = dayName(ride);
  const companyWord = (n: number) => `${n} ${n === 1 ? 'شركة' : n === 2 ? 'شركتين' : 'شركة'}`;
  return (
    <>
      <FormSection title="مواعيد تأكيد الركوب"
        help={companyId ? `متى يسأل التطبيق طلاب ${companyName} «هل تركب غداً؟» ومتى يذكّرهم.` : 'متى يسأل التطبيق الطالب «هل تركب غداً؟» ومتى يذكّره. تتبعها كل شركة لم تحدد مواعيدها من صفحة «تأكيد الركوب».'}
        footer={editable ? <>
          <span className="flex-1 text-label text-ink-2">{f.changes ? `${f.changes === 1 ? 'تغيير واحد' : f.changes === 2 ? 'تغييران' : `${f.changes} تغييرات`} لم يُحفظ بعد` : companyId ? '' : follow != null ? `يصل فوراً إلى ${companyWord(follow)} تتبع المنصة` : 'يصل فوراً إلى كل شركة تتبع المنصة'}</span>
          <Button disabled={!f.canSave} loading={f.saving} onClick={() => setAsk(true)}>حفظ مواعيد التأكيد</Button>
        </> : undefined}>
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
          <TimeField label="يفتح التأكيد" value={v.opens_at} assume="pm" disabled={!editable} onChange={(x) => f.set({ opens_at: x })} help="في اليوم السابق للرحلة" />
          <TimeField label="يُقفل التأكيد" value={v.closes_at} assume="am" disabled={!editable} onChange={(x) => f.set({ closes_at: x })}
            error={f.sameTimes ? 'موعد الإقفال يجب أن يختلف عن موعد الفتح.' : undefined} help={closesOnRideDay(v.opens_at, v.closes_at) ? 'يوم الرحلة نفسه' : 'في اليوم السابق نفسه'} />
          <SelectField label="تذكير من لم يؤكد" value={String(v.reminder_minutes)} disabled={!editable} options={reminderOptions(v.reminder_minutes)}
            onChange={(e) => f.set({ reminder_minutes: Number(e.target.value) })} help="يتوقف بمجرد أن يؤكد الطالب أو يلغي" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-label font-medium">أيام بلا تذكير</div>
          <WeekdayBoxes f={f} pills />
          <p className="m-0 text-label text-ink-2">المقصود يوم الرحلة: اختيار الجمعة يوقف تذكير رحلة الجمعة. التأكيد نفسه يبقى متاحاً.</p>
        </div>
        <Holidays f={f} withYear addKind="secondary" label={<>إجازات رسمية <span className="font-normal text-ink-3">بلا تذكير</span></>} />
        <Note tone="teal" icon="info" title={`مثال: رحلة ${rideName}`}>
          {f.sameTimes ? 'اختر موعدين مختلفين للفتح والإقفال.' : `يفتح التأكيد ${before} ${clockLabel(v.opens_at)} ويُقفل ${closesOnRideDay(v.opens_at, v.closes_at) ? rideName : before} ${clockLabel(v.closes_at)}. ${v.reminder_minutes ? `التذكير ${timesCount(reminderTimes(v.opens_at, v.closes_at, v.reminder_minutes).length)}: ${remindersSentence(v, 4).replace(/^[^:]+: /, '')}` : 'بلا تذكير.'}`}
        </Note>
      </FormSection>
      <Dialog open={ask} onClose={() => setAsk(false)} icon="clock" title={companyId ? 'حفظ مواعيد التأكيد؟' : 'حفظ مواعيد التأكيد الجديدة؟'}
        actions={[<Button key="c" kind="secondary" data-autofocus onClick={() => setAsk(false)}>رجوع</Button>,
          <Button key="ok" loading={f.saving} disabled={!f.online} onClick={async () => { if (await f.save()) setAsk(false); }}>احفظ المواعيد</Button>]}>
        {companyId
          ? <p className="m-0">لكل طلاب {companyName}: يُفتح التأكيد {clockLabel(v.opens_at)} في اليوم السابق ويُقفل {clockLabel(v.closes_at)} {closesOnRideDay(v.opens_at, v.closes_at) ? 'يوم الرحلة' : 'في اليوم نفسه'}.</p>
          : <p className="m-0">{firstChange} عند طلاب <b className="font-semibold text-ink">{follow != null ? companyWord(follow) : 'كل الشركات'}</b> تتبع المنصة، بداية من رحلات الغد.{own ? ` الشركات التي لها مواعيدها (${own}) لا تتأثر.` : ''}</p>}
        <p className="m-0">{weekdaysText(v.off_weekdays) || v.off_dates.length ? `بلا تذكير: ${[weekdaysText(v.off_weekdays), v.off_dates.length ? holidaysCount(v.off_dates.length) : ''].filter(Boolean).join('، و')}.` : 'التذكير كل أيام الأسبوع.'}</p>
      </Dialog>
    </>
  );
};
