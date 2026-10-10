import { describe, expect, it } from 'vitest';
import { hoursText, insightText, topInsights } from './analyticsInsights';

/** Texts carry a left-to-right mark after «%»; compare without it. */
const plain = (s: string) => s.replace(/\u200E/g, '');
import { fillRate, monthLabel, periodRange, stationsOf, type Insight, type TripStat } from './analytics';

const base = '/c/co1';
const trip = { trip_id: 't1', line_id: 'l1', line_name: 'الزرقا', direction: 'departure', start_time: '07:15', label: null, capacity: 50, ride_days: 22 };
const text = (key: string, severity: Insight['severity'], data: Record<string, unknown>) => {
  const t = insightText({ key, severity, data }, base);
  return { ...t, title: plain(t.title), sub: plain(t.sub) };
};

describe('insightText', () => {
  it('over_capacity: the trip, its seats, how often and the busiest day; opens the line', () => {
    const t = text('over_capacity', 'act', { ...trip, days_over: 6, peak_riders: 58, avg_riders: 47.5 });
    expect(t.tone).toBe('danger');
    expect(t.title).toBe('رحلة الذهاب 7:15 ص على خط الزرقا تمتلئ فوق المقاعد');
    expect(t.sub).toContain('50 مقعداً');
    expect(t.sub).toContain('6 أيام من 22 يوماً');
    expect(t.sub).toContain('58');
    expect(t.action).toEqual({ label: 'افتح الخط', to: '/c/co1/lines/l1' });
  });

  it('low_utilisation: average riders against seats, with the share', () => {
    const t = text('low_utilisation', 'watch', { ...trip, direction: 'return', start_time: '14:00', avg_riders: 12.4, pct: 25 });
    expect(t.tone).toBe('warning');
    expect(t.title).toBe('رحلة العودة 2:00 م على خط الزرقا شبه فارغة');
    expect(t.sub).toContain('12.4 راكباً');
    expect(t.sub).toContain('(25%)');
    expect(t.action?.to).toBe('/c/co1/lines/l1');
  });

  it('empty_trip: names the trip with its label and the ride days', () => {
    const t = text('empty_trip', 'watch', { ...trip, label: 'الأولى', ride_days: 9 });
    expect(t.title).toBe('لم يؤكد أحد رحلة الذهاب «الأولى» 7:15 ص على خط الزرقا');
    expect(t.sub).toContain('9 أيام');
    expect(t.action?.to).toBe('/c/co1/lines/l1');
  });

  it('unserved_university: how many students and which university; opens the lines', () => {
    const t = text('unserved_university', 'act', { university_id: 'u1', university_name: 'جامعة حورس', members: 14 });
    expect(t.tone).toBe('danger');
    expect(t.title).toBe('14 طالباً من جامعة حورس بلا خط يوصلهم');
    expect(t.action).toEqual({ label: 'افتح الخطوط', to: '/c/co1/lines' });
  });

  it('station_concentration: the share, the station and the counts', () => {
    const t = text('station_concentration', 'watch', { line_id: 'l2', line_name: 'شربين', station_name: 'ميدان شربين', count: 41, line_total: 96, pct: 43 });
    expect(t.tone).toBe('teal');
    expect(t.title).toBe('43% من مشتركي خط شربين يركبون من «ميدان شربين»');
    expect(t.sub).toContain('41 من 96');
    expect(t.action?.to).toBe('/c/co1/lines/l2');
  });

  it('never_subscribed: points to notifications', () => {
    const t = text('never_subscribed', 'watch', { count: 23, members: 410 });
    expect(t.title).toBe('23 طالباً انضموا ولم يشتركوا بعد');
    expect(t.sub).toContain('410 طالباً');
    expect(t.action).toEqual({ label: 'أرسل إشعاراً', to: '/c/co1/notifications' });
  });

  it('ending_soon: counts students and days', () => {
    const t = text('ending_soon', 'act', { count: 7, days: 14 });
    expect(t.tone).toBe('danger');
    expect(t.title).toBe('اشتراك 7 طلاب ينتهي خلال 14 يوماً');
    expect(t.action?.to).toBe('/c/co1/notifications');
  });

  it('low_confirmation_line: the line rate against the company rate, in whole percents', () => {
    const t = text('low_confirmation_line', 'watch', { line_id: 'l3', line_name: 'فارسكور', rate: 0.412, company_rate: 0.684 });
    expect(t.title).toBe('طلاب خط فارسكور يؤكدون الركوب أقل من غيرهم');
    expect(t.sub).toContain('41%');
    expect(t.sub).toContain('68%');
  });

  it('method_rejections: the method by name, a deleted one by a word', () => {
    const t = text('method_rejections', 'watch', { method_id: 'm1', name: 'فودافون كاش', rejected: 9, total: 30, pct: 30 });
    expect(t.title).toBe('30% من إيصالات «فودافون كاش» تُرفض');
    expect(t.sub).toContain('9 إيصالات من 30');
    expect(t.action).toEqual({ label: 'افتح وسائل الدفع', to: '/c/co1/payment-methods' });
    expect(text('method_rejections', 'watch', { name: null, rejected: 3, total: 9, pct: 33 }).title).toContain('«وسيلة محذوفة»');
  });

  it('slow_review: hours become days past two days', () => {
    expect(text('slow_review', 'act', { median_hours: 30, reviewed: 120 }).title).toBe('مراجعة الإيصال تأخذ 30 ساعة');
    const t = text('slow_review', 'act', { median_hours: 75, reviewed: 12 });
    expect(t.title).toBe('مراجعة الإيصال تأخذ 3 أيام');
    expect(t.action).toEqual({ label: 'افتح الإيصالات', to: '/c/co1/receipts' });
  });

  it('no_capacity: one line by name, several by count; opens the first', () => {
    expect(text('no_capacity', 'watch', { count: 1, lines: [{ id: 'l9', name: 'السرو' }] }).title).toBe('خط السرو بلا عدد مقاعد');
    const t = text('no_capacity', 'watch', { count: 3, lines: [{ id: 'l7', name: 'أ' }, { id: 'l8', name: 'ب' }, { id: 'l9', name: 'ج' }] });
    expect(t.title).toBe('3 خطوط بلا عدد مقاعد');
    expect(t.action?.to).toBe('/c/co1/lines/l7');
  });

  it('high_confirmation and fast_review are good news, without an action', () => {
    const a = text('high_confirmation', 'good', { rate: 0.86, ride_days: 40 });
    expect(a).toMatchObject({ tone: 'success', title: '86% من المشتركين يؤكدون ركوبهم' });
    expect(a.action).toBeUndefined();
    const b = text('fast_review', 'good', { median_hours: 0.4, reviewed: 50 });
    expect(b).toMatchObject({ tone: 'success', title: 'تراجع الإيصالات خلال أقل من ساعة' });
  });

  it('an unknown rule still reads as a plain note in its severity', () => {
    expect(text('something_new', 'act', {})).toMatchObject({ tone: 'danger', title: 'ملاحظة على الخدمة' });
  });
});

describe('topInsights', () => {
  const ins = (key: string, severity: Insight['severity']): Insight => ({ key, severity, data: {} });
  it('keeps act before watch before good, the server order within each, and drops unknown rules', () => {
    const data = { insights: [ins('station_concentration', 'watch'), ins('fast_review', 'good'), ins('mystery', 'act'), ins('ending_soon', 'act'), ins('over_capacity', 'act')] };
    expect(topInsights(data, 3).map((i) => i.key)).toEqual(['ending_soon', 'over_capacity', 'station_concentration']);
    expect(topInsights(data, 10)).toHaveLength(4);
    expect(topInsights(null, 3)).toEqual([]);
  });
});

describe('helpers', () => {
  it('hoursText', () => {
    expect(hoursText(0.2)).toBe('أقل من ساعة');
    expect(hoursText(1)).toBe('ساعة');
    expect(hoursText(2)).toBe('ساعتين');
    expect(hoursText(5.4)).toBe('5 ساعات');
    expect(hoursText(49)).toBe('يومين');
  });

  it('periodRange: Cairo days for each preset', () => {
    expect(periodRange('30d', '2026-10-10')).toEqual({ from: '2026-09-11', to: null });
    expect(periodRange('month', '2026-10-10')).toEqual({ from: '2026-10-01', to: null });
    expect(periodRange('term', '2026-10-10')).toEqual({ from: '2026-06-13', to: null });
    expect(periodRange('all', '2026-10-10')).toEqual({ from: null, to: null });
  });

  it('fillRate: riders over seats of the trips that ran and have a capacity', () => {
    const t = (avg: number, cap: number | null, active = 5) => ({ avg_riders: avg, capacity: cap, active_days: active } as TripStat);
    expect(fillRate([t(40, 50), t(10, 50), t(30, null), t(0, 50, 0)])).toBeCloseTo(0.5);
    expect(fillRate([t(5, null)])).toBeNull();
  });

  it('stationsOf ranks a line’s stations, busiest first', () => {
    const rows = [
      { line_id: 'a', line_name: 'أ', station_id: '1', station_name: 's1', order_index: 0, count: 3 },
      { line_id: 'b', line_name: 'ب', station_id: '2', station_name: 's2', order_index: 0, count: 9 },
      { line_id: 'a', line_name: 'أ', station_id: '3', station_name: 's3', order_index: 1, count: 7 },
    ];
    expect(stationsOf(rows, 'a').map((r) => r.station_id)).toEqual(['3', '1']);
    expect(stationsOf(rows, '').map((r) => r.station_id)).toEqual(['2', '3', '1']);
  });

  it('monthLabel', () => {
    expect(monthLabel('2026-09')).toBe('سبتمبر');
    expect(monthLabel('2027-01', true)).toBe('يناير 2027');
  });
});
