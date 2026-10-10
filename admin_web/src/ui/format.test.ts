import { describe, expect, it } from 'vitest';
import { agoText, clock, countText, dayText, errorText, moneyText, NOUN, num, phoneText, rangeText } from './format';

describe('how the dashboard writes things', () => {
  it('uses Western digits with thousands separators', () => {
    expect(num(4500)).toBe('4,500');
    expect(num(null)).toBe('—');
    expect(moneyText(1912500)).toBe('1,912,500 ج.م');
  });

  it('writes times on a 12-hour clock with ص / م', () => {
    expect(clock('07:30:00')).toBe('7:30 ص');
    expect(clock('14:05')).toBe('2:05 م');
    expect(clock('00:15')).toBe('12:15 ص');
    expect(clock(null)).toBe('');
  });

  it('writes calendar days as «10 أكتوبر 2026», ranges with a dash', () => {
    expect(dayText('2026-10-10')).toBe('10 أكتوبر 2026');
    expect(dayText('2026-10-10', { weekday: true })).toBe('السبت 10 أكتوبر 2026');
    expect(rangeText('2026-09-20', '2027-01-31')).toBe('20 سبتمبر 2026 – 31 يناير 2027');
    expect(rangeText('2026-09-20', '2026-12-31')).toBe('20 سبتمبر – 31 ديسمبر 2026');
  });

  it('counts in Arabic: one, two, 3–10, 11+', () => {
    expect(countText(1, NOUN.receipt)).toBe('إيصال');
    expect(countText(2, NOUN.receipt)).toBe('إيصالان');
    expect(countText(7, NOUN.receipt)).toBe('7 إيصالات');
    expect(countText(25, NOUN.student)).toBe('25 طالباً');
  });

  it('says how long ago in words', () => {
    const now = new Date('2026-10-10T12:00:00Z');
    expect(agoText('2026-10-10T11:59:40Z', now)).toBe('الآن');
    expect(agoText('2026-10-10T09:00:00Z', now)).toBe('منذ 3 ساعات');
    expect(agoText('2026-10-09T10:00:00Z', now)).toBe('أمس');
  });

  it('groups Egyptian mobile numbers', () => {
    expect(phoneText('01023456789')).toBe('010 2345 6789');
    expect(phoneText('+201023456789')).toBe('+20 102 3456 789');
    expect(phoneText('12345')).toBe('12345');
  });

  it('never shows the server’s raw English text', () => {
    expect(errorText(new Error('duplicate key value violates unique constraint "students_phone_key"'))).toBe('هذه البيانات مسجلة من قبل.');
    expect(errorText(new Error('Failed to fetch'))).toContain('تعذّر الوصول');
    expect(errorText(new Error('some internal error'))).toContain('حدث خطأ');
    expect(errorText(new Error('هذا الرقم مسجل لطالب آخر.'))).toBe('هذا الرقم مسجل لطالب آخر.');
  });
});
