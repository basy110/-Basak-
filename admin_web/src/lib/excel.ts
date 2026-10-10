/**
 * Excel in and out of the dashboard. Both libraries are loaded only when an admin
 * actually exports or imports, so no page pays for them up front.
 *
 *   exportSheet({ name, columns, rows })   one .xlsx file, right-to-left, a bold header row
 *   readSheet(file)                        the first sheet of an .xlsx (or a .csv) as rows of text
 *   matchColumns(header, wanted)           which column holds which field, by its title
 */
import { cairoToday } from './time';

export type CellValue = string | number | boolean | Date | null | undefined;

export interface ExportColumn<T> {
  /** The column's title in the file (Arabic, as on the page). */
  label: string;
  value: (row: T) => CellValue;
  /** Width in characters. */
  width?: number;
  /** Excel number format, e.g. '#,##0' or 'yyyy-mm-dd'. */
  format?: string;
}

const HEADER = { fontWeight: 'bold' as const, backgroundColor: '#E1EFF5', textColor: '#17384A', borderColor: '#B9D3E0', borderStyle: 'thin' as const };

/** Hands the browser a file under our name (some browsers ignore the library's own). */
function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** «الطلاب-2026-10-10.xlsx»: the page's name and today's date (Cairo). */
export const fileNameFor = (name: string) => `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()}-${cairoToday()}.xlsx`;

function cell(value: CellValue, format?: string) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return { value, type: Date, format: format ?? 'yyyy-mm-dd' };
  if (typeof value === 'number') return { value, type: Number, ...(format ? { format } : {}) };
  if (typeof value === 'boolean') return { value: value ? 'نعم' : 'لا', type: String };
  return { value: String(value), type: String };
}

/** Builds the sheet and hands the browser the file. */
export async function exportSheet<T>({ name, sheet, columns, rows }: { name: string; sheet?: string; columns: ExportColumn<T>[]; rows: T[] }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [
    columns.map((c) => ({ value: c.label, type: String, ...HEADER })),
    ...rows.map((r) => columns.map((c) => cell(c.value(r), c.format))),
  ];
  await writeXlsxFile(data as never, {
    sheet: (sheet ?? name).slice(0, 31),
    rightToLeft: true,
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width ?? Math.min(40, Math.max(12, c.label.length + 4)) })),
  } as never, { fontFamily: 'Arial', fontSize: 12 }).toBlob().then((blob) => save(blob, fileNameFor(name)));
}

/** A blank file with just the header row (and optional example rows) to fill and import back. */
export async function exportTemplate(name: string, headers: string[], examples: CellValue[][] = []) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const data = [headers.map((h) => ({ value: h, type: String, ...HEADER })), ...examples.map((r) => r.map((v) => cell(v)))];
  await writeXlsxFile(data as never, {
    sheet: name.slice(0, 31), rightToLeft: true, stickyRowsCount: 1,
    columns: headers.map((h) => ({ width: Math.max(16, h.length + 6) })),
  } as never, { fontFamily: 'Arial', fontSize: 12 }).toBlob().then((blob) => save(blob, `${name}.xlsx`));
}

/** Arabic-Indic and Persian digits to Latin ones; trims and collapses spaces. */
export const cleanText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, ' ')
    .trim();
};

/** A simple CSV reader: quotes, doubled quotes, commas or semicolons, CRLF. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map(cleanText)).filter((r) => r.some((v) => v !== ''));
}

export const MAX_IMPORT_ROWS = 2000;

/** The first sheet of the file as rows of cleaned text; empty rows are dropped. */
export async function readSheet(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  const { readSheet: read } = await import('read-excel-file/browser');
  const rows = await read(file);
  return (rows as unknown[][]).map((r) => r.map(cleanText)).filter((r) => r.some((v) => v !== ''));
}

const norm = (s: string) => cleanText(s).replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\s_\-:()]/g, '').toLowerCase();

/**
 * Finds each wanted field's column in the header row by any of its accepted titles
 * («الاسم», «اسم الطالب», «name»…). Missing fields map to -1.
 */
export function matchColumns<K extends string>(header: string[], wanted: Record<K, string[]>): Record<K, number> {
  const titles = header.map(norm);
  const out = {} as Record<K, number>;
  for (const key of Object.keys(wanted) as K[]) {
    const names = wanted[key].map(norm);
    out[key] = titles.findIndex((t) => names.includes(t));
    if (out[key] < 0) out[key] = titles.findIndex((t) => names.some((n) => n.length > 2 && t.includes(n)));
  }
  return out;
}
