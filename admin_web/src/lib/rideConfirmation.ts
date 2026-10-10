/**
 * «تأكيد الركوب»: when students may confirm tomorrow's ride, when it closes,
 * how often the app reminds those who have not, and the ride days without a
 * reminder. Read and saved through get_vote_settings / set_vote_settings
 * (companyId null = the platform's own, which every company follows until it
 * saves its own). Pure helpers here; the hook is useVoteSettings.
 */
import { clockLabel } from './time';
import { dayText } from '../ui/format';

export interface VoteValues {
  opens_at: string; closes_at: string; reminder_minutes: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  off_weekdays: number[];
  /** `YYYY-MM-DD`, upcoming only. */
  off_dates: string[];
}
export interface VoteSettings extends VoteValues {
  window_text?: string;
  /** The company saved its own (otherwise it follows the platform). */
  custom: boolean;
  can_edit_platform: boolean;
  platform: VoteValues;
}

/** The week as it is lived in Egypt, Saturday first. */
export const WEEK = [
  { iso: 6, name: 'السبت' }, { iso: 7, name: 'الأحد' }, { iso: 1, name: 'الاثنين' }, { iso: 2, name: 'الثلاثاء' },
  { iso: 3, name: 'الأربعاء' }, { iso: 4, name: 'الخميس' }, { iso: 5, name: 'الجمعة' },
] as const;
const weekdayName = (iso: number) => WEEK.find((d) => d.iso === iso)?.name ?? '';

export const REMINDERS: { value: number; label: string }[] = [
  { value: 0, label: 'بدون تذكير' }, { value: 15, label: 'كل 15 دقيقة' }, { value: 30, label: 'كل 30 دقيقة' },
  { value: 60, label: 'كل ساعة' }, { value: 120, label: 'كل ساعتين' }, { value: 180, label: 'كل 3 ساعات' },
  { value: 240, label: 'كل 4 ساعات' }, { value: 360, label: 'كل 6 ساعات' }, { value: 1440, label: 'مرة واحدة عند فتح التأكيد' },
];
export const REMINDER_CHOICES = 'الاختيارات: بدون تذكير، كل 15 أو 30 دقيقة، كل ساعة، ساعتين، 3، 4 أو 6 ساعات، أو مرة واحدة عند فتح التأكيد.';
export const reminderLabel = (m: number) => REMINDERS.find((r) => r.value === m)?.label ?? `كل ${m} دقيقة`;

const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };
const fromMin = (total: number) => { const t = ((total % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** The vote closes on the ride day itself when its closing time is not after its opening time. */
export const closesOnRideDay = (opens: string, closes: string) => toMin(closes) <= toMin(opens);
/** Minutes the vote stays open. */
export const windowLength = (opens: string, closes: string) => (closesOnRideDay(opens, closes) ? toMin(closes) + 1440 : toMin(closes)) - toMin(opens);

/** Reminder times in one window: when it opens, then every `every` minutes while it is still open. */
export function reminderTimes(opens: string, closes: string, every: number): string[] {
  if (!every || opens.slice(0, 5) === closes.slice(0, 5)) return [];
  if (every >= 1440) return [fromMin(toMin(opens))];
  const out: string[] = [];
  for (let t = 0; t < windowLength(opens, closes); t += every) out.push(fromMin(toMin(opens) + t));
  return out;
}

/** «3 تذكيرات», «تذكير واحد», «تذكيران». */
export function remindersCount(n: number): string {
  if (n === 1) return 'تذكير واحد';
  if (n === 2) return 'تذكيران';
  return `${n} ${n <= 10 ? 'تذكيرات' : 'تذكيراً'}`;
}
/** «3 مرات», «مرة واحدة», «مرتين». */
export function timesCount(n: number): string {
  if (n === 1) return 'مرة واحدة';
  if (n === 2) return 'مرتين';
  return `${n} ${n <= 10 ? 'مرات' : 'مرة'}`;
}

/** «كل جمعة» · «كل جمعة وسبت». */
export function weekdaysText(weekdays: number[]): string {
  const names = WEEK.filter((d) => weekdays.includes(d.iso)).map((d) => d.name.replace(/^ال/, ''));
  if (!names.length) return '';
  return `كل ${names.length === 1 ? names[0] : `${names.slice(0, -1).join('، ')} و${names[names.length - 1]}`}`;
}
/** «3 إجازات», «إجازة واحدة», «إجازتان». */
export function holidaysCount(n: number): string {
  if (n === 1) return 'إجازة واحدة';
  if (n === 2) return 'إجازتان';
  return `${n} ${n <= 10 ? 'إجازات' : 'إجازة'}`;
}

/** The platform's (or any) values in one sentence: «يُفتح 4:00 م، يُقفل 6:00 ص، تذكير كل 3 ساعات، وبلا تذكير كل جمعة». */
export function valuesSentence(v: VoteValues): string {
  const parts = [`يُفتح ${clockLabel(v.opens_at)}`, `يُقفل ${clockLabel(v.closes_at)}`,
    v.reminder_minutes ? `تذكير ${reminderLabel(v.reminder_minutes)}` : 'بلا تذكير'];
  const off = weekdaysText(v.off_weekdays ?? []);
  if (off && v.reminder_minutes) return `${parts.join('، ')}، وبلا تذكير ${off}`;
  return parts.join('، ');
}

/** How many things differ from what is saved (each field once, each weekday and each date on its own). */
export function changeCount(saved: VoteValues, now: VoteValues): number {
  let n = 0;
  if (saved.opens_at.slice(0, 5) !== now.opens_at.slice(0, 5)) n += 1;
  if (saved.closes_at.slice(0, 5) !== now.closes_at.slice(0, 5)) n += 1;
  if (saved.reminder_minutes !== now.reminder_minutes) n += 1;
  const a = new Set(saved.off_weekdays); const b = new Set(now.off_weekdays);
  [...new Set([...a, ...b])].forEach((d) => { if (a.has(d) !== b.has(d)) n += 1; });
  const x = new Set(saved.off_dates); const y = new Set(now.off_dates);
  [...new Set([...x, ...y])].forEach((d) => { if (x.has(d) !== y.has(d)) n += 1; });
  return n;
}
/** «غيّرت 3 أشياء ولم تُحفظ». */
export function changedText(n: number): string {
  if (n === 1) return 'غيّرت شيئاً واحداً ولم يُحفظ';
  if (n === 2) return 'غيّرت شيئين ولم يُحفظا';
  return `غيّرت ${n} ${n <= 10 ? 'أشياء' : 'شيئاً'} ولم تُحفظ`;
}

/** A holiday as a chip: «الخميس 22 أكتوبر» (the year only when it is not this year). */
export const holidayText = (day: string, thisYear: string) => dayText(day, { weekday: true, year: day.slice(0, 4) !== thisYear });
/** The ride's weekday name without «ال»: «الأحد» → «الأحد» (kept), used in sentences. */
export const dayName = (day: string) => weekdayName(((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1);

export interface TimelinePoint { at: number; time: string; day: 'before' | 'ride' }
/**
 * The example ride's day as a line from noon the day before to noon on the ride
 * day (widened when the window starts earlier or ends later): where it opens,
 * closes, and each reminder, as fractions 0…1 from the start.
 */
export function timeline(v: Pick<VoteValues, 'opens_at' | 'closes_at' | 'reminder_minutes'>) {
  const open = toMin(v.opens_at);
  const close = open + windowLength(v.opens_at, v.closes_at);
  const start = Math.min(720, open - 60);
  const end = Math.max(1440 + 720, close + 60);
  const at = (m: number) => (m - start) / (end - start);
  const point = (m: number): TimelinePoint => ({ at: at(m), time: fromMin(m), day: m < 1440 ? 'before' : 'ride' });
  return {
    open: point(open), close: point(close), midnight: at(1440),
    reminders: reminderTimes(v.opens_at, v.closes_at, v.reminder_minutes).map((t, i) => point(open + (i === 0 ? 0 : (toMin(t) - open + 1440) % 1440))),
  };
}
