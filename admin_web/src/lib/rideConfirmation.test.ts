import { describe, expect, it } from 'vitest';
import {
  changeCount, changedText, closesOnRideDay, dayName, holidaysCount, holidayText, reminderTimes, remindersCount, timeline,
  timesCount, valuesSentence, weekdaysText, type VoteValues,
} from './rideConfirmation';

const v = (p: Partial<VoteValues> = {}): VoteValues => ({ opens_at: '16:00', closes_at: '06:00', reminder_minutes: 360, off_weekdays: [5], off_dates: [], ...p });

describe('the confirmation window', () => {
  it('closes on the ride day when the closing time is not after the opening', () => {
    expect(closesOnRideDay('16:00', '06:00')).toBe(true);
    expect(closesOnRideDay('08:00', '22:00')).toBe(false);
  });
  it('reminds at the opening, then every N minutes while open', () => {
    expect(reminderTimes('16:00', '06:00', 360)).toEqual(['16:00', '22:00', '04:00']);
    expect(reminderTimes('16:00', '06:00', 180)).toEqual(['16:00', '19:00', '22:00', '01:00', '04:00']);
    expect(reminderTimes('16:00', '06:00', 1440)).toEqual(['16:00']);
    expect(reminderTimes('16:00', '06:00', 0)).toEqual([]);
    expect(reminderTimes('16:00', '16:00', 60)).toEqual([]);
  });
  it('places the example ride on a line from noon to noon', () => {
    const t = timeline(v());
    expect(t.open.at).toBeCloseTo(4 / 24);
    expect(t.close.at).toBeCloseTo(18 / 24);
    expect(t.midnight).toBeCloseTo(0.5);
    expect(t.reminders.map((r) => [r.time, r.day])).toEqual([['16:00', 'before'], ['22:00', 'before'], ['04:00', 'ride']]);
    expect(t.reminders[2].at).toBeCloseTo(16 / 24);
  });
});

describe('words', () => {
  it('counts', () => {
    expect(remindersCount(3)).toBe('3 تذكيرات');
    expect(remindersCount(1)).toBe('تذكير واحد');
    expect(timesCount(3)).toBe('3 مرات');
    expect(holidaysCount(3)).toBe('3 إجازات');
  });
  it('days without a reminder', () => {
    expect(weekdaysText([5])).toBe('كل جمعة');
    expect(weekdaysText([5, 6])).toBe('كل سبت وجمعة');
    expect(weekdaysText([])).toBe('');
  });
  it('the platform values in one sentence', () => {
    expect(valuesSentence(v({ reminder_minutes: 180 }))).toBe('يُفتح 4:00 م، يُقفل 6:00 ص، تذكير كل 3 ساعات، وبلا تذكير كل جمعة');
    expect(valuesSentence(v({ reminder_minutes: 0 }))).toBe('يُفتح 4:00 م، يُقفل 6:00 ص، بلا تذكير');
  });
  it('holidays and day names', () => {
    expect(holidayText('2026-10-22', '2026')).toBe('الخميس 22 أكتوبر');
    expect(holidayText('2027-01-25', '2026')).toBe('الاثنين 25 يناير 2027');
    expect(dayName('2026-10-11')).toBe('الأحد');
  });
});

describe('unsaved changes', () => {
  it('counts each field, weekday and date once', () => {
    const saved = v({ off_dates: ['2026-10-22'] });
    expect(changeCount(saved, saved)).toBe(0);
    expect(changeCount(saved, v({ reminder_minutes: 180, off_weekdays: [5, 6], off_dates: ['2026-11-01'] }))).toBe(4);
    expect(changedText(3)).toBe('غيّرت 3 أشياء ولم تُحفظ');
    expect(changedText(1)).toBe('غيّرت شيئاً واحداً ولم يُحفظ');
  });
});
