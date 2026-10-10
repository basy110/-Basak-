import { describe, expect, it } from 'vitest';
import { allOffsets, allPages, excelDay, excelMoment, excelNumber } from './excelCells';

describe('excel cells', () => {
  it('writes a day as midnight UTC of that day', () => {
    expect(excelDay('2026-10-10')?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(excelDay('2026-10-10T21:30:00Z')?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(excelDay(null)).toBeNull();
    expect(excelDay('soon')).toBeNull();
  });

  it('writes a moment as its Cairo wall time', () => {
    // 21:30 UTC is 00:30 the next day in Cairo (UTC+3 in October 2026).
    expect(excelMoment('2026-10-10T21:30:00Z')?.toISOString()).toBe('2026-10-11T00:30:00.000Z');
    expect(excelMoment('')).toBeNull();
    expect(excelMoment('x')).toBeNull();
  });

  it('keeps missing numbers empty', () => {
    expect(excelNumber(null)).toBeNull();
    expect(excelNumber('')).toBeNull();
    expect(excelNumber('4500')).toBe(4500);
    expect(excelNumber(Number.NaN)).toBeNull();
  });

  it('reads every page of a cursor list', async () => {
    const data = Array.from({ length: 7 }, (_, i) => i);
    const rows = await allPages<number>(async (before) => {
      const from = before ? Number(before) : 0;
      const items = data.slice(from, from + 3);
      return { items, next_before: from + 3 < data.length ? String(from + 3) : null };
    });
    expect(rows).toEqual(data);
  });

  it('reads every page of an offset list', async () => {
    const data = Array.from({ length: 5 }, (_, i) => i);
    const rows = await allOffsets<number>(async (offset, limit) => ({ rows: data.slice(offset, offset + limit), total: data.length }), 2);
    expect(rows).toEqual(data);
  });
});
