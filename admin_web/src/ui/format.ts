/**
 * How numbers, money, times, dates and errors are written everywhere in the
 * dashboard (docs/canvas/AdmSystem · «Plain words»): Western digits, 12-hour
 * times with ص / م, «10 أكتوبر 2026», «4,500 ج.م», and never the server's raw text.
 */
import { CAIRO_ZONE, clockLabel } from '../lib/time';

/** 4500 → «4,500». */
export const num = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));

/** 4500 → «4,500 ج.م». */
export const moneyText = (n: number | null | undefined): string => `${num(n)} ج.م`;

/** `07:30:00` → «7:30 ص». */
export const clock = (time: string | null | undefined): string => clockLabel(time ?? null);

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** `2026-10-10` → «10 أكتوبر 2026» (a calendar day, no time zone involved). */
export function dayText(day: string | null | undefined, o: { year?: boolean; weekday?: boolean } = {}): string {
  if (!day) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return '';
  const y = +m[1]; const mo = +m[2]; const d = +m[3];
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${o.weekday ? `${wd} ` : ''}${d} ${MONTHS[mo - 1]}${o.year === false ? '' : ` ${y}`}`;
}

/** `2026-09-20` → `2027-01-31` → «20 سبتمبر – 31 يناير 2027». */
export function rangeText(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return '';
  if (!from) return dayText(to);
  if (!to) return dayText(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${dayText(from, { year: !sameYear })} – ${dayText(to)}`;
}

const cairoParts = new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** An instant → its Cairo calendar day and wall time. */
export function cairo(iso: string | Date): { day: string; time: string } {
  const parts: Record<string, string> = {};
  cairoParts.formatToParts(typeof iso === 'string' ? new Date(iso) : iso).forEach((p) => { parts[p.type] = p.value; });
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
}

/** An instant → «10 أكتوبر 2026 · 7:30 م» in Cairo time. */
export function momentText(iso: string | null | undefined, o: { year?: boolean } = {}): string {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return '';
  const c = cairo(iso);
  return `${dayText(c.day, { year: o.year ?? true })} · ${clock(c.time)}`;
}

/** «منذ 3 ساعات», «منذ دقيقتين», «أمس», then the date. */
export function agoText(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${countText(min, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'])}`;
  const h = Math.round(min / 60);
  if (h < 24) return `منذ ${countText(h, ['ساعة', 'ساعتين', 'ساعات', 'ساعة'])}`;
  const d = Math.round(h / 24);
  if (d === 1) return 'أمس';
  if (d < 7) return `منذ ${countText(d, ['يوم', 'يومين', 'أيام', 'يوماً'])}`;
  return dayText(cairo(iso).day);
}

/**
 * Arabic counting: [one, two, few (3–10), many (11+)].
 * countText(1, …) → «ساعة» · 2 → «ساعتين» · 5 → «5 ساعات» · 12 → «12 ساعة».
 */
export function countText(n: number, forms: [string, string, string, string]): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  if (n >= 3 && n <= 10) return `${num(n)} ${forms[2]}`;
  return `${num(n)} ${forms[3]}`;
}

/** Common nouns for countText. */
export const NOUN = {
  student: ['طالب', 'طالبان', 'طلاب', 'طالباً'],
  rider: ['راكب', 'راكبان', 'ركاب', 'راكباً'],
  line: ['خط', 'خطان', 'خطوط', 'خطاً'],
  trip: ['رحلة', 'رحلتان', 'رحلات', 'رحلة'],
  receipt: ['إيصال', 'إيصالان', 'إيصالات', 'إيصالاً'],
  request: ['طلب', 'طلبان', 'طلبات', 'طلباً'],
  supervisor: ['مشرف', 'مشرفان', 'مشرفين', 'مشرفاً'],
  station: ['محطة', 'محطتان', 'محطات', 'محطة'],
  company: ['شركة', 'شركتان', 'شركات', 'شركة'],
  day: ['يوم', 'يومان', 'أيام', 'يوماً'],
  admin: ['مدير', 'مديران', 'مديرين', 'مديراً'],
  item: ['أمر', 'أمران', 'أمور', 'أمراً'],
  seat: ['مقعد', 'مقعدان', 'مقاعد', 'مقعداً'],
} as const satisfies Record<string, [string, string, string, string]>;

/** `01023456789` → «010 2345 6789» (Egyptian mobile grouping); anything else unchanged. */
export function phoneText(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  if (/^201\d{9}$/.test(digits)) return `+20 ${digits.slice(2, 5)} ${digits.slice(5, 9)} ${digits.slice(9)}`;
  return phone;
}

const ARABIC = /[؀-ۿ]/;
/**
 * What the admin reads when something failed: the server's own sentence when it
 * wrote one in Arabic (the database functions raise readable messages), otherwise
 * a plain sentence — never «Failed to fetch», a constraint name or an HTTP code.
 */
export function errorText(error: unknown, fallback = 'حدث خطأ من جهتنا. حاول مرة أخرى، وإن تكرر فتواصل مع الدعم.'): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'لا يوجد اتصال بالإنترنت. لم يُحفظ شيء؛ حاول حين يعود الاتصال.';
  if (!message) return fallback;
  if (/failed to fetch|network|load failed|fetch/i.test(message)) return 'تعذّر الوصول إلى باصك. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.';
  if (/jwt|session|not authenticated|انتهت جلسة/i.test(message)) return 'انتهت جلسة الدخول. حدّث الصفحة وسجّل الدخول مرة أخرى.';
  if (/duplicate key|already exists|unique/i.test(message)) return 'هذه البيانات مسجلة من قبل.';
  if (/permission denied|not allowed|row-level security|forbidden/i.test(message)) return 'ليست لديك صلاحية لهذا الإجراء.';
  // An Arabic sentence written for the admin, without the technical tail some functions append.
  if (ARABIC.test(message)) return message.replace(/\s*\((HTTP|PGRST|code)[^)]*\)\s*$/i, '').replace(/supabase/gi, 'باصك');
  return fallback;
}
