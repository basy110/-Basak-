/**
 * Cell values for `exportSheet` (lib/excel.ts): days and moments as real Excel
 * dates in Cairo time, money as numbers with a thousands format.
 *
 * write-excel-file turns a Date into a serial number from its UTC time, so a
 * Cairo wall time is written as the UTC instant with the same digits.
 */
import { cairo } from '../ui/format';

export const MONEY_FORMAT = '#,##0';
export const DAY_FORMAT = 'yyyy-mm-dd';
export const MOMENT_FORMAT = 'yyyy-mm-dd hh:mm';

/** «2026-10-10» (or the day part of an ISO string) → a Date Excel shows as that day. */
export function excelDay(day: string | null | undefined): Date | null {
  const d = (day ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const at = new Date(`${d}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** An instant → a Date Excel shows as its Cairo day and wall time. */
export function excelMoment(iso: string | null | undefined): Date | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  const c = cairo(iso);
  return new Date(`${c.day}T${c.time}:00Z`);
}

/** A number or nothing: null and NaN stay empty cells instead of «0». */
export const excelNumber = (n: number | string | null | undefined): number | null => {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
};

/**
 * Every page of a list read a page at a time (`before` cursor), up to `max`
 * rows, for an export of all that matches rather than what is on screen.
 */
export async function allPages<T>(load: (before: string | null) => Promise<{ items: T[]; next_before: string | null }>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  let before: string | null = null;
  for (;;) {
    const page = await load(before);
    out.push(...(page.items ?? []));
    if (!page.next_before || out.length >= max || page.next_before === before) break;
    before = page.next_before;
  }
  return out.slice(0, max);
}

/** Every row of a list read with limit/offset, `size` at a time, until `total` (or a short page). */
export async function allOffsets<T>(load: (offset: number, limit: number) => Promise<{ rows: T[]; total?: number | null }>, size = 2000, max = 50_000): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const page = await load(out.length, size);
    const rows = page.rows ?? [];
    out.push(...rows);
    if (rows.length < size || out.length >= max || (page.total != null && out.length >= page.total)) break;
  }
  return out.slice(0, max);
}
