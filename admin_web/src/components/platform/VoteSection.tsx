import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, FieldRow, FormSection, Icon, Note, SelectField, SkeletonForm, countText, NOUN, errorText, dayText } from '../../ui';
import { clockLabel, cairoToday } from '../../lib/time';
import { DayPicker, TimeSelect, pickedDay } from './fields';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import { useSaveVoteSettings, useVoteSettings } from '../../lib/linesData';
import {
  REMINDERS, WEEK, closesOnRideDay, reminderLabel, reminderTimes, timesCount, type VoteValues,
} from '../../lib/rideConfirmation';

const hh = (t: string) => t.slice(0, 5);
const same = (a: VoteValues, b: VoteValues) => hh(a.opens_at) === hh(b.opens_at) && hh(a.closes_at) === hh(b.closes_at) && a.reminder_minutes === b.reminder_minutes
  && [...a.off_weekdays].sort().join() === [...b.off_weekdays].sort().join() && [...a.off_dates].sort().join() === [...b.off_dates].sort().join();

/** «يُقفل التأكيد 5:00 ص بدل 6:00 ص»: what the save changes, in words. */
export function voteChanges(saved: VoteValues, now: VoteValues): string {
  const parts: string[] = [];
  if (hh(saved.opens_at) !== hh(now.opens_at)) parts.push(`يُفتح التأكيد ${clockLabel(now.opens_at)} بدل ${clockLabel(saved.opens_at)}`);
  if (hh(saved.closes_at) !== hh(now.closes_at)) parts.push(`يُقفل التأكيد ${clockLabel(now.closes_at)} بدل ${clockLabel(saved.closes_at)}`);
  if (saved.reminder_minutes !== now.reminder_minutes) parts.push(`التذكير ${reminderLabel(now.reminder_minutes)} بدل ${reminderLabel(saved.reminder_minutes)}`);
  if ([...saved.off_weekdays].sort().join() !== [...now.off_weekdays].sort().join() || [...saved.off_dates].sort().join() !== [...now.off_dates].sort().join()) parts.push('تتغيّر أيام التذكير');
  return parts.join('، ');
}

/**
 * The platform's ride-confirmation hours (AdmPlatDefaults, third section): every
 * company that has not set its own follows them, at once — so saving says how many.
 */
export const PlatformVoteSection: React.FC<{ follow: number | null; custom: number | null; online: boolean }> = ({ follow, custom, online }) => {
  const q = useVoteSettings(null);
  const save = useSaveVoteSettings(null);
  const guard = useGuard();
  const saved = q.data;
  const [v, setV] = useState<VoteValues | null>(null);
  const [day, setDay] = useState({ day: '', month: '' });
  const [dayError, setDayError] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (saved) setV({ opens_at: hh(saved.opens_at), closes_at: hh(saved.closes_at), reminder_minutes: saved.reminder_minutes, off_weekdays: [...(saved.off_weekdays ?? [])], off_dates: [...(saved.off_dates ?? [])].sort() }); }, [saved]);
  const today = cairoToday();
  const times = useMemo(() => (v ? reminderTimes(v.opens_at, v.closes_at, v.reminder_minutes) : []), [v]);

  if (q.loading) return <SkeletonForm rows={4} />;
  if (!saved || !v) {
    return (
      <FormSection title="مواعيد تأكيد الركوب">
        <Note tone="danger" title="تعذّر تحميل مواعيد التأكيد" action={<Button kind="link" sm onClick={() => void q.reload()}>إعادة المحاولة</Button>}>تأكد من اتصالك ثم حاول مرة أخرى.</Note>
      </FormSection>
    );
  }
  const base: VoteValues = { opens_at: hh(saved.opens_at), closes_at: hh(saved.closes_at), reminder_minutes: saved.reminder_minutes, off_weekdays: saved.off_weekdays ?? [], off_dates: saved.off_dates ?? [] };
  const changed = !same(base, v);
  const sameTimes = v.opens_at === v.closes_at;
  const set = (p: Partial<VoteValues>) => setV((x) => (x ? { ...x, ...p } : x));
  const toggleDay = (iso: number) => set({ off_weekdays: v.off_weekdays.includes(iso) ? v.off_weekdays.filter((d) => d !== iso) : [...v.off_weekdays, iso].sort() });
  const addDay = () => {
    const picked = pickedDay(day);
    if (!picked) { setDayError('اكتب اليوم واختر الشهر.'); return; }
    if (picked === 'bad') { setDayError('هذا الشهر ليس فيه هذا اليوم.'); return; }
    const day_ = picked;
    if (day_ < today) { setDayError('هذا اليوم مضى. اختر اليوم أو بعده.'); return; }
    if (v.off_dates.includes(day_)) { setDayError('هذا اليوم مضاف من قبل.'); return; }
    set({ off_dates: [...v.off_dates, day_].sort() }); setDay({ day: '', month: '' }); setDayError('');
  };
  const doSave = () => void guard('vote', async () => {
    setBusy(true);
    try {
      await save(v);
      setAsking(false);
      notifyDone('حُفظت مواعيد التأكيد.', follow ? `تصل فوراً إلى ${countText(follow, NOUN.company)} تتبع المنصة.` : undefined);
    } catch (e) { notifyError('لم تُحفظ مواعيد التأكيد', errorText(e)); }
    setBusy(false);
  });
  const options = REMINDERS.some((r) => r.value === v.reminder_minutes) ? REMINDERS : [...REMINDERS, { value: v.reminder_minutes, label: reminderLabel(v.reminder_minutes) }];
  const example = (() => {
    if (sameTimes) return null;
    const closeDay = closesOnRideDay(v.opens_at, v.closes_at) ? 'الخميس' : 'الأربعاء';
    const r = times.length === 0 ? 'لا تذكير.' : times.length <= 4
      ? `التذكير ${timesCount(times.length)}: ${times.map(clockLabel).join('، ')}.`
      : `التذكير ${timesCount(times.length)}: ${times.slice(0, 3).map(clockLabel).join('، ')} … حتى ${clockLabel(times[times.length - 1])}.`;
    return `يفتح التأكيد الأربعاء ${clockLabel(v.opens_at)} ويُقفل ${closeDay} ${clockLabel(v.closes_at)}. ${v.off_weekdays.includes(4) ? 'الخميس بلا تذكير.' : r}`;
  })();

  return (
    <>
      <FormSection title="مواعيد تأكيد الركوب" help="متى يسأل التطبيق الطالب «هل تركب غداً؟» ومتى يذكّره. تتبعها كل شركة لم تحدد مواعيدها من صفحة «تأكيد الركوب»."
        footer={<>
          <span className="flex-1 text-label text-ink-2">{follow != null ? `يصل فوراً إلى ${countText(follow, NOUN.company)} ${follow === 1 ? 'تتبع' : follow === 2 ? 'تتبعان' : 'تتبع'} المنصة` : 'يصل فوراً إلى كل شركة تتبع المنصة'}</span>
          <Button disabled={!changed || sameTimes || !online} onClick={() => setAsking(true)}>حفظ مواعيد التأكيد</Button>
        </>}>
        <FieldRow>
          <TimeSelect label="يفتح التأكيد" value={v.opens_at} onChange={(t) => set({ opens_at: t })} help="في اليوم السابق للرحلة" />
          <TimeSelect label="يُقفل التأكيد" value={v.closes_at} onChange={(t) => set({ closes_at: t })}
            error={sameTimes ? 'موعد القفل يجب أن يختلف عن موعد الفتح.' : undefined} help={closesOnRideDay(v.opens_at, v.closes_at) ? 'يوم الرحلة نفسه' : 'في اليوم السابق نفسه'} />
          <SelectField label="تذكير من لم يؤكد" value={String(v.reminder_minutes)} onChange={(e) => set({ reminder_minutes: Number(e.target.value) })}
            options={options.map((r) => ({ value: String(r.value), label: r.label }))} help="يتوقف بمجرد أن يؤكد الطالب أو يلغي" />
        </FieldRow>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 text-label font-medium">أيام بلا تذكير</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((d) => {
              const off = v.off_weekdays.includes(d.iso);
              return (
                <button key={d.iso} type="button" aria-pressed={off} onClick={() => toggleDay(d.iso)}
                  className={`inline-flex h-10 items-center rounded-full px-3.5 text-label sm:h-9 ${off ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink shadow-ring hover:bg-ground'}`}>
                  {d.name}{off && ' · بلا تذكير'}
                </button>
              );
            })}
          </div>
          <p className="m-0 text-label text-ink-2">المقصود يوم الرحلة: اختيار الجمعة يوقف تذكير رحلة الجمعة. التأكيد نفسه يبقى متاحاً.</p>
        </fieldset>
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <DayPicker label={<span>إجازات رسمية <span className="font-normal text-ink-3">بلا تذكير</span></span>} today={today} value={day}
              onChange={(x) => { setDay(x); setDayError(''); }} error={dayError || undefined} className="flex-1 sm:max-w-[320px]" />
            <Button kind="secondary" icon="plus" onClick={addDay} className={dayError ? 'mb-7' : ''}>أضف</Button>
          </div>
          {v.off_dates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {v.off_dates.map((d) => (
                <span key={d} className="inline-flex h-8 items-center gap-1 rounded-full bg-sunken pe-1 ps-3 text-label">
                  {dayText(d, { weekday: true })}
                  <button type="button" aria-label={`احذف ${dayText(d, { weekday: true })}`} onClick={() => set({ off_dates: v.off_dates.filter((x) => x !== d) })}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-2 hover:bg-hair"><Icon name="x" size={14} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        {example && <Note title="مثال: رحلة الخميس">{example}</Note>}
      </FormSection>
      <Dialog open={asking} onClose={() => setAsking(false)} title="حفظ مواعيد التأكيد الجديدة؟" icon="clock" tone="warning"
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(false)}>رجوع</Button>, <Button key="g" loading={busy} onClick={doSave}>احفظ المواعيد</Button>]}>
        <p className="m-0">
          {voteChanges(base, v)} عند طلاب <b className="text-ink">{follow != null ? countText(follow, NOUN.company) : 'كل شركة'}</b> تتبع المنصة، بداية من رحلات الغد.
          {custom ? ` ${custom === 1 ? 'الشركة التي لها مواعيدها لا تتأثر' : custom === 2 ? 'الشركتان اللتان لهما مواعيدهما لا تتأثران' : `الـ${countText(custom, NOUN.company)} التي لها مواعيدها لا تتأثر`}.` : ''}
        </p>
      </Dialog>
    </>
  );
};
