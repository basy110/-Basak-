import { describe, expect, it } from 'vitest';
import {
  checkStudentRow, matchByName, normalizeName, normalizePhone, parseClock, parseType, type ImportContext, type ImportRow,
} from './studentImport';
import type { LineOption } from './lineOptions';

const UNIS = [
  { id: 'u1', name: 'جامعة المنصورة' }, { id: 'u2', name: 'جامعة المنصورة الأهلية' }, { id: 'u3', name: 'جامعة دمياط' },
];
const trip = (id: string, direction: 'departure' | 'return', start: string, stops: [string, string][], university_id: string | null = null) => ({
  id, direction, label: '', start_time: start, university_id, is_active: true,
  line_trip_stops: stops.map(([station_id, stop_time]) => ({ station_id, stop_time })),
});
const LINE: LineOption = {
  id: 'l1', name: 'دمياط الجديدة', company_id: 'c1', price_termly: 4200, price_yearly: 8000, price_daily: 60,
  stations: [
    { id: 's1', name: 'المنطقة الرابعة', is_active: true, order_index: 1 },
    { id: 's2', name: 'الحي الثالث', is_active: true, order_index: 2 },
    { id: 's3', name: 'محطة قديمة', is_active: false, order_index: 3 },
  ],
  line_trips: [
    trip('d2', 'departure', '07:30:00', [['s1', '07:45:00'], ['s2', '08:00:00']]),
    trip('d1', 'departure', '06:45:00', [['s1', '07:00:00'], ['s2', '07:15:00']]),
    trip('dx', 'departure', '06:00:00', [['s1', '06:10:00']], 'u3'),
    trip('r1', 'return', '15:00:00', []),
    trip('r2', 'return', '17:30:00', []),
  ],
};
const ctx = (patch: Partial<ImportContext> = {}): ImportContext => ({ universities: UNIS, lines: [LINE], members: new Set(['01011111111']), ...patch });
const row = (patch: Partial<ImportRow> = {}): ImportRow => ({
  name: 'محمد أحمد علي حسن', phone: '01012345678', password: 'Basak2026', university: 'جامعة المنصورة', college: 'الهندسة',
  line: 'دمياط الجديدة', station: 'المنطقة الرابعة', departure: '', return: '', type: '', ...patch,
});
const check = (r: ImportRow, c = ctx(), all = [r]) => checkStudentRow(r, all.indexOf(r) + 2, all, c);
const errorOf = (r: ImportRow, c?: ImportContext) => { const res = check(r, c); return res.ok ? '' : res.error; };

describe('phones from a sheet', () => {
  it('reads the forms an admin types or Excel produces', () => {
    expect(normalizePhone('01012345678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678');
    expect(normalizePhone('+20 101 234 5678')).toBe('01012345678');
    expect(normalizePhone('00201012345678')).toBe('01012345678');
    expect(normalizePhone('1012345678')).toBe('01012345678'); // the 0 Excel dropped
    expect(normalizePhone('12345')).toBe('12345');
  });
});

describe('names matched loosely', () => {
  it('ignores alef, ta marbuta and ya spellings and the «جامعة» prefix', () => {
    expect(normalizeName('جامعة  المنصورة الأهلية')).toBe(normalizeName('جامعه المنصوره الاهليه'));
    expect(matchByName(UNIS, 'جامعه المنصوره')?.id).toBe('u1');
    expect(matchByName(UNIS, 'المنصورة الاهلية')?.id).toBe('u2');
    expect(matchByName(UNIS, 'دمياط')?.id).toBe('u3');
    expect(matchByName(UNIS, 'القاهرة')).toBeUndefined();
    expect(matchByName(UNIS, '')).toBeUndefined();
  });
});

describe('times and types', () => {
  it('parses the usual ways of writing a time', () => {
    expect(parseClock('7:30')).toBe(450);
    expect(parseClock('07:30:00')).toBe(450);
    expect(parseClock('7:30 ص')).toBe(450);
    expect(parseClock('3:00 م')).toBe(900);
    expect(parseClock('3 PM')).toBe(900);
    expect(parseClock('12:15 ص')).toBe(15);
    expect(parseClock('0.3125')).toBe(450);
    expect(parseClock('7')).toBeNull();
    expect(parseClock('بكرة')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
  });
  it('reads the subscription type, termly when empty', () => {
    expect(parseType('')).toBe('termly');
    expect(parseType('فصل دراسي')).toBe('termly');
    expect(parseType('الفصلان معاً')).toBe('yearly');
    expect(parseType('سنوي')).toBe('yearly');
    expect(parseType('يومي')).toBe('daily');
    expect(parseType('شهري')).toBeNull();
  });
});

describe('one row of the file', () => {
  it('becomes the request «إضافة طالب» sends, with the earliest trips by default', () => {
    const res = check(row({ phone: '+201012345678', university: 'جامعه المنصوره', line: 'دمياط الجديده', station: 'المنطقه الرابعه' }));
    expect(res).toEqual({ ok: true, label: 'محمد أحمد علي حسن', value: {
      fullName: 'محمد أحمد علي حسن', phone: '01012345678', university: 'جامعة المنصورة', college: 'الهندسة', password: 'Basak2026',
      lineId: 'l1', stationId: 's1', subscriptionType: 'termly', departureTripId: 'd1', returnTripId: 'r1',
    } });
  });
  it('picks the trips by their time at the station', () => {
    const res = check(row({ departure: '7:45 ص', return: '5:30 م', type: 'يومي', college: '' }));
    expect(res.ok && res.value).toMatchObject({ departureTripId: 'd2', returnTripId: 'r2', subscriptionType: 'daily', college: 'غير محدد' });
  });
  it('says what is wrong, in order', () => {
    expect(errorOf(row({ name: '' }))).toBe('الاسم فارغ.');
    expect(errorOf(row({ name: 'محمد أحمد' }))).toBe('اكتب الاسم ثلاثياً على الأقل.');
    expect(errorOf(row({ phone: '0101234' }))).toMatch(/غير صحيح/);
    expect(errorOf(row({ phone: '01311111111' }))).toMatch(/غير صحيح/);
    expect(errorOf(row({ phone: '01011111111' }))).toBe('هذا الرقم لطالب في شركتك بالفعل.');
    expect(errorOf(row({ password: '1234' }))).toBe('كلمة المرور أقصر من 8 أحرف.');
    expect(errorOf(row({ university: 'جامعة القاهرة' }))).toMatch(/لم نجد جامعة/);
    expect(errorOf(row({ line: 'الزرقا' }))).toMatch(/لا خط نشط/);
    expect(errorOf(row({ station: 'محطة قديمة' }))).toMatch(/لا محطة «محطة قديمة»/);
    expect(errorOf(row({ departure: '9:00 ص' }))).toMatch(/المتاح: 7:00 ص، 7:45 ص/);
    expect(errorOf(row({ departure: 'الصبح' }))).toMatch(/غير مفهوم/);
    expect(errorOf(row({ return: '4:00 م' }))).toMatch(/لا رحلة عودة في 4:00 م/);
    expect(errorOf(row({ type: 'شهري' }))).toMatch(/نوع الاشتراك/);
  });
  it('a trip open to one university only is offered to its students only', () => {
    const res = check(row({ university: 'جامعة دمياط', departure: '6:10 ص' }));
    expect(res.ok && res.value.departureTripId).toBe('dx');
    expect(errorOf(row({ departure: '6:10 ص' }))).toMatch(/لا رحلة ذهاب في 6:10 ص/);
  });
  it('a line with no trip to the university is refused', () => {
    const only = { ...LINE, line_trips: LINE.line_trips.filter((t) => t.id === 'dx') };
    expect(errorOf(row(), ctx({ lines: [only] }))).toBe('خط دمياط الجديدة ليس له رحلة إلى جامعة المنصورة.');
  });
  it('a phone repeated in the file is refused after its first row', () => {
    const a = row(); const b = row({ name: 'أحمد محمد علي حسن', phone: '010 1234 5678' });
    const all = [a, b];
    expect(check(a, ctx(), all).ok).toBe(true);
    const second = check(b, ctx(), all);
    expect(second.ok ? '' : second.error).toBe('الرقم مكرر في الملف (أول مرة في الصف 2).');
  });
  it('without the members list the server is left to refuse an existing member', () => {
    expect(check(row({ phone: '01011111111' }), ctx({ members: null })).ok).toBe(true);
  });
});
