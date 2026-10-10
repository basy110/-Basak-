import { describe, expect, it } from 'vitest';
import {
  barWidths, bannerLine, defaultMessage, messageProblem, parseTermKey, reachText, releaseState, sampleStudent, termKeyOf, termLabel, termOptions,
  windowText, withRelease, type RecapRelease, type TermRecapOverview,
} from './termRecap';

const release = (o: Partial<RecapRelease> = {}): RecapRelease => ({
  academic_year: 2026, period_code: 'first', published: true, published_at: '2027-01-10T08:00:00Z', published_by_name: 'محمد عادل',
  unpublished_at: null, message: null, notified_at: '2027-01-10T08:00:00Z', notified_companies: 19, notified_students: 4218, ...o,
});

const overview = (o: Partial<TermRecapOverview> = {}): TermRecapOverview => ({
  today: '2026-10-10',
  term: { academic_year: 2026, period_code: 'first', name: 'الفصل الدراسي الأول', label: 'الفصل الدراسي الأول 2026/2027', start_date: '2026-09-05',
    end_date: '2027-01-30', until: '2026-10-10', window_opens: '2027-01-16', window_closes: '2027-02-27' },
  options: [
    { academic_year: 2026, period_code: 'first', label: 'الفصل الدراسي الأول 2026/2027', start_date: '2026-09-05', end_date: '2027-01-30', published: false },
    { academic_year: 2025, period_code: 'second', label: 'الفصل الدراسي الثاني 2025/2026', start_date: '2026-02-01', end_date: '2026-06-30', published: true },
  ],
  release: null,
  reach: { companies: 19, students: 4218 },
  totals: { students: 40, ride_days: 1000, return_days: 600, boardings: 900, companies: 3, lines: 5, stations: 30, universities: 2, median_ride_days: 22 },
  top_stations: [{ id: 's1', name: 'كوبري السرو', students: 9, ride_days: 300 }, { id: 's2', name: 'فارسكور', students: 4, ride_days: 75 }],
  top_lines: [{ id: 'l1', name: 'خط الزرقا', students: 20, ride_days: 500 }],
  top_universities: [],
  companies: [],
  ...o,
});

describe('term recap', () => {
  it('keys a term and reads it back', () => {
    expect(termKeyOf({ academic_year: 2026, period_code: 'second' })).toBe('2026:second');
    expect(parseTermKey('2026:second')).toEqual({ academic_year: 2026, period_code: 'second' });
    expect(parseTermKey('2026:both')).toBeNull();
    expect(parseTermKey('')).toBeNull();
  });

  it('names a term from the server, or from its code', () => {
    expect(termLabel({ academic_year: 2026, period_code: 'first', label: 'الفصل الدراسي الأول 2026/2027' })).toBe('الفصل الدراسي الأول 2026/2027');
    expect(termLabel({ academic_year: 2025, period_code: 'summer', label: null })).toBe('الفصل الصيفي 2025/2026');
    expect(defaultMessage({ academic_year: 2025, period_code: 'second' })).toBe('افتح التطبيق لترى ملخص الفصل الدراسي الثاني 2025/2026: أيام ركوبك ومحطتك ولقبك هذا الفصل.');
  });

  it('allows an empty message and refuses a long one', () => {
    expect(messageProblem('')).toBeNull();
    expect(messageProblem('أ'.repeat(600))).toBeNull();
    expect(messageProblem('أ'.repeat(601))).toBe('الرسالة طويلة: 600 حرف على الأكثر.');
  });

  it('tells published, stopped and never apart', () => {
    expect(releaseState(null)).toBe('never');
    expect(releaseState(release())).toBe('published');
    expect(releaseState(release({ published: false, unpublished_at: '2027-01-12T08:00:00Z' }))).toBe('stopped');
    expect(releaseState(release({ published: false, published_at: null }))).toBe('never');
  });

  it('says when Home shows the banner', () => {
    expect(windowText(overview().term)).toBe('من 16 يناير حتى 27 فبراير 2027');
    expect(windowText({ ...overview().term, window_opens: '2026-12-20', window_closes: '2027-01-30' })).toBe('من 20 ديسمبر 2026 حتى 30 يناير 2027');
    expect(windowText({ ...overview().term, window_opens: null })).toBe('');
  });

  it('draws bars against the first row, never quite empty', () => {
    expect(barWidths([{ ride_days: 300 }, { ride_days: 75 }, { ride_days: 1 }])).toEqual([100, 25, 2]);
    expect(barWidths([{ ride_days: 0 }])).toEqual([0]);
    expect(barWidths([])).toEqual([]);
  });

  it('builds the sample student from the median, the top stop and line', () => {
    expect(sampleStudent(overview())).toEqual({ days: 22, station: 'كوبري السرو', line: 'خط الزرقا' });
    const none = overview({ totals: { ...overview().totals, median_ride_days: null }, top_stations: [], top_lines: [] });
    expect(sampleStudent(none)).toEqual({ days: 25, station: null, line: null });
    expect(bannerLine(62)).toBe('62 يوم في الباص… والباقي جوّه.');
  });

  it('counts who is told', () => {
    expect(reachText({ companies: 19, students: 4218 })).toBe('يصل الإشعار إلى 4,218 طالباً في 19 شركة.');
    expect(reachText({ companies: 1, students: 2 })).toBe('يصل الإشعار إلى طالبان في شركة.');
    expect(reachText({ companies: 0, students: 0 })).toBe('لا يوجد طلاب يصلهم الإشعار الآن.');
  });

  it('lists the terms to pick, marking the published ones, with the shown term always among them', () => {
    expect(termOptions(overview())).toEqual([
      { value: '2026:first', label: 'الفصل الدراسي الأول 2026/2027' },
      { value: '2025:second', label: 'الفصل الدراسي الثاني 2025/2026 · منشور' },
    ]);
    const other = overview({ term: { ...overview().term, academic_year: 2024, label: null } });
    expect(termOptions(other)[0]).toEqual({ value: '2024:first', label: 'الفصل الدراسي الأول 2024/2025' });
  });

  it('puts a new release into the page, and only for its own term', () => {
    const o = withRelease(overview(), release());
    expect(o.release?.published).toBe(true);
    expect(o.options[0].published).toBe(true);
    expect(o.options[1].published).toBe(true);
    const other = withRelease(overview(), release({ academic_year: 2025, period_code: 'second', published: false }));
    expect(other.release).toBeNull();
    expect(other.options[1].published).toBe(false);
  });
});
