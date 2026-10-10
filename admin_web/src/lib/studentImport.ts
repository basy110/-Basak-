/**
 * «استيراد من Excel» on the company's students page: the pure part. Each row of the
 * file becomes the same request «إضافة طالب» sends to admin-create-student
 * (supabase/functions/_shared/create-student.ts), after the same checks, with the
 * university, line, station and trips matched by name against what the company has.
 */
import { cleanText } from './excel';
import type { LineOption, TripOption, UniversityOption } from './lineOptions';
import { phoneDigits } from './students';

export type ImportKey = 'name' | 'phone' | 'password' | 'university' | 'college' | 'line' | 'station' | 'departure' | 'return' | 'type';
export type ImportRow = Record<ImportKey, string>;
export type SubscriptionType = 'termly' | 'yearly' | 'daily';

/** The body of admin-create-student, as AddStudentFlow sends it (no period: the database picks the current one). */
export interface CreateStudentBody {
  fullName: string; phone: string; university: string; college: string; password: string;
  lineId: string; stationId: string; subscriptionType: SubscriptionType;
  departureTripId: string; returnTripId: string | null;
}

export interface ImportContext {
  universities: UniversityOption[];
  /** The company's active lines with their stations and trips. */
  lines: LineOption[];
  /** Phones of the company's current students, when they could be read. */
  members?: Set<string> | null;
}

export type RowCheck = { ok: true; value: CreateStudentBody; label: string } | { ok: false; error: string; label: string };

/** Letters an admin's file may write either way: أ/إ/آ/ا, ة/ه, ى/ي, diacritics and tatweel, spaces. */
export function normalizeName(value: string): string {
  return cleanText(value)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[.\-_،,()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
const withoutPrefix = (name: string) => name.replace(/^(جامعه|الجامعه|معهد|المعهد)\s+/, '');

/**
 * An Egyptian mobile in its 11-digit form (01xxxxxxxxx), from what a sheet holds:
 * Arabic digits, spaces and dashes, +20 / 0020 / 20 in front, or the leading 0 that
 * Excel drops from a number cell. Anything else comes back as its digits.
 */
export function normalizePhone(value: string): string {
  let d = phoneDigits(cleanText(value));
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return d;
}
export const isEgyptianMobile = (phone: string) => /^01[0125]\d{8}$/.test(phone);

/** The one item whose name matches, ignoring the spellings above; «جامعة» in front is optional. */
export function matchByName<T extends { name: string }>(items: T[], value: string): T | undefined {
  const wanted = normalizeName(value);
  if (!wanted) return undefined;
  const exact = items.filter((i) => normalizeName(i.name) === wanted);
  if (exact.length === 1) return exact[0];
  const loose = items.filter((i) => withoutPrefix(normalizeName(i.name)) === withoutPrefix(wanted));
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * A time as a sheet may hold it, to minutes since midnight: «7:30», «07:30:00», «7:30 ص»,
 * «3:00 م», «3 PM», or Excel's fraction of a day (0.3125). Null when it is not a time.
 */
export function parseClock(value: string): number | null {
  const v = cleanText(value).toLowerCase();
  if (!v) return null;
  if (/^0?\.\d+$/.test(v)) { const m = Math.round(Number(v) * 24 * 60); return m >= 0 && m < 24 * 60 ? m : null; }
  const m = v.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(ص|م|صباحا|صباحاً|مساء|مساءً|am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  const mark = m[3];
  if (min > 59 || h > 23) return null;
  if (mark) {
    if (h < 1 || h > 12) return null;
    const pm = /^(م|مساء|pm|p)/.test(mark);
    h = (h % 12) + (pm ? 12 : 0);
  } else if (m[2] === undefined) return null; // a bare «7» is not read as a time
  return h * 60 + min;
}
const minutes = (time: string) => { const [h, m] = time.slice(0, 5).split(':').map(Number); return h * 60 + m; };

/** «فصل دراسي» (default), «الفصلان معاً» / «سنوي», «يومي». Null when the value is something else. */
export function parseType(value: string): SubscriptionType | null {
  const v = normalizeName(value);
  if (!v) return 'termly';
  if (/يومي|daily/.test(v)) return 'daily';
  if (/سنوي|سنه|الفصلان|الفصلين|ترمين|yearly|annual/.test(v)) return 'yearly';
  if (/فصل|ترم|termly|term/.test(v)) return 'termly';
  return null;
}

// Active trips of a line open to the university, with their time at the station (as AddStudentFlow offers them).
const serving = (line: LineOption, direction: 'departure' | 'return', universityId: string) =>
  (line.line_trips ?? []).filter((t) => t.is_active && t.direction === direction && (!t.university_id || t.university_id === universityId));
export function tripChoices(line: LineOption, direction: 'departure' | 'return', stationId: string, universityId: string): { trip: TripOption; time: string }[] {
  return serving(line, direction, universityId)
    .map((trip) => ({ trip, time: direction === 'return' ? trip.start_time : trip.line_trip_stops.find((s) => s.station_id === stationId)?.stop_time }))
    .filter((o): o is { trip: TripOption; time: string } => !!o.time)
    .sort((a, b) => a.time.localeCompare(b.time));
}
const clockText = (time: string) => {
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`;
};
const list = (items: string[]) => (items.length > 6 ? `${items.slice(0, 6).join('، ')}…` : items.join('، '));

// The first row of the file holding each phone, worked out once per file.
const firstRows = new WeakMap<ImportRow[], Map<string, number>>();
function firstRowOf(all: ImportRow[], phone: string): number | undefined {
  let map = firstRows.get(all);
  if (!map) {
    map = new Map();
    all.forEach((r, i) => { const p = normalizePhone(r.phone); if (p && !map!.has(p)) map!.set(p, i + 2); });
    firstRows.set(all, map);
  }
  return map.get(phone);
}

/**
 * One row of the file. `row` is its number in the file (the header is row 1), `all`
 * the whole file (for numbers repeated in it). The first problem found is reported.
 */
export function checkStudentRow(r: ImportRow, row: number, all: ImportRow[], ctx: ImportContext): RowCheck {
  const fullName = cleanText(r.name);
  const phone = normalizePhone(r.phone);
  const label = fullName || cleanText(r.phone);
  const bad = (error: string): RowCheck => ({ ok: false, error, label });

  if (!fullName) return bad('الاسم فارغ.');
  if (fullName.split(' ').length < 3) return bad('اكتب الاسم ثلاثياً على الأقل.');
  if (!phone) return bad('رقم الهاتف فارغ.');
  if (!isEgyptianMobile(phone)) return bad(`الرقم «${cleanText(r.phone)}» غير صحيح. اكتب 11 رقماً تبدأ بـ 010 أو 011 أو 012 أو 015.`);
  const first = firstRowOf(all, phone);
  if (first !== undefined && first < row) return bad(`الرقم مكرر في الملف (أول مرة في الصف ${first}).`);
  if (ctx.members?.has(phone)) return bad('هذا الرقم لطالب في شركتك بالفعل.');
  const password = String(r.password ?? '').trim();
  if (!password) return bad('كلمة المرور فارغة.');
  if (password.length < 8) return bad('كلمة المرور أقصر من 8 أحرف.');

  if (!cleanText(r.university)) return bad('الجامعة فارغة.');
  const university = matchByName(ctx.universities, r.university);
  if (!university) return bad(`لم نجد جامعة باسم «${cleanText(r.university)}». اكتب الاسم كما في قائمة الجامعات.`);

  if (!cleanText(r.line)) return bad('الخط فارغ.');
  const line = matchByName(ctx.lines, r.line);
  if (!line) return bad(`لا خط نشط باسم «${cleanText(r.line)}» في شركتك.`);
  const stations = (line.stations ?? []).filter((s) => s.is_active).sort((a, b) => a.order_index - b.order_index);
  if (!cleanText(r.station)) return bad('المحطة فارغة.');
  const station = matchByName(stations, r.station);
  if (!station) return bad(`لا محطة «${cleanText(r.station)}» على خط ${line.name}. محطاته: ${list(stations.map((s) => s.name))}.`);

  if (serving(line, 'departure', university.id).length === 0) return bad(`خط ${line.name} ليس له رحلة إلى ${university.name}.`);
  const departures = tripChoices(line, 'departure', station.id, university.id);
  if (departures.length === 0) return bad(`لا رحلة ذهاب تمر على محطة ${station.name}.`);
  let departure = departures[0];
  if (cleanText(r.departure)) {
    const at = parseClock(r.departure);
    if (at === null) return bad(`ميعاد الذهاب «${cleanText(r.departure)}» غير مفهوم. اكتبه مثل 7:30 ص.`);
    const found = departures.find((o) => minutes(o.time) === at);
    if (!found) return bad(`لا رحلة ذهاب في ${clockText(`${Math.floor(at / 60)}:${at % 60}`)} من محطة ${station.name}. المتاح: ${list(departures.map((o) => clockText(o.time)))}.`);
    departure = found;
  }
  const returns = tripChoices(line, 'return', station.id, university.id);
  let back: { trip: TripOption; time: string } | undefined = returns[0];
  if (cleanText(r.return)) {
    const at = parseClock(r.return);
    if (at === null) return bad(`ميعاد العودة «${cleanText(r.return)}» غير مفهوم. اكتبه مثل 3:00 م.`);
    back = returns.find((o) => minutes(o.time) === at);
    if (!back) return bad(returns.length ? `لا رحلة عودة في ${clockText(`${Math.floor(at / 60)}:${at % 60}`)}. المتاح: ${list(returns.map((o) => clockText(o.time)))}.` : `لا رحلة عودة على خط ${line.name} من ${university.name}.`);
  }
  const type = parseType(r.type);
  if (!type) return bad(`نوع الاشتراك «${cleanText(r.type)}» غير مفهوم. اكتب «فصل دراسي» أو «الفصلان معاً» أو «يومي».`);

  return {
    ok: true, label: fullName,
    value: {
      fullName, phone, university: university.name, college: cleanText(r.college) || 'غير محدد', password,
      lineId: line.id, stationId: station.id, subscriptionType: type,
      departureTripId: departure.trip.id, returnTripId: back?.trip.id ?? null,
    },
  };
}
