/**
 * How wide each column of a table is. Pure, so ui/Table.tsx stays about drawing.
 *
 * On a wide screen the spare width is shared between the columns in proportion
 * to their widths, instead of all of it going to the first one (a name next to
 * a wide empty gap while the next columns are cut with «…»). The first column
 * grows only up to a cap; a button or chevron column never grows. An admin can
 * also drag a column's edge; that width is kept for the table in this browser.
 */
import type React from 'react';

export interface ColMeta { key: string; w?: number }

export const MIN_W = 72;
export const MAX_W = 720;
/** The first column's width when the page gives none. */
export const MAIN_W = 260;
/** How far the first column grows with the screen on its own. */
export const MAIN_CAP = 360;
export const DEFAULT_W = 150;
/** Columns this narrow or narrower (a button, a chevron) never grow with the screen. */
export const FIXED_MAX = 96;
/** On a narrow screen columns shrink to this share of their width before the table scrolls sideways. */
export const MIN_SCALE = 0.7;

/** The plain text of a column title (titles may be elements: an arrow, a hidden label). */
export function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in node) return nodeText((node as { props?: { children?: React.ReactNode } }).props?.children);
  return '';
}

export const isFixed = (w: number | undefined) => w != null && w <= FIXED_MAX;
export const clampW = (w: number, fixed = false) => (fixed ? w : Math.round(Math.min(MAX_W, Math.max(MIN_W, w))));

/** A column's width before the screen is shared out: the admin's own, else the page's, else a default. */
export const baseWidth = (col: ColMeta, first: boolean, saved: Record<string, number> = {}) =>
  clampW(saved[col.key] ?? col.w ?? (first ? MAIN_W : DEFAULT_W), isFixed(col.w));

/**
 * Pixel widths filling `available`. Below the sum of the bases the growing
 * columns shrink together, down to MIN_SCALE; past that the table scrolls
 * sideways. Above it, the first column grows like the others
 * but not past MAIN_CAP (or its own base if that is wider); the rest goes to the
 * other growing columns in proportion to their bases. `factors[i]` is each
 * column's width over its base, to turn a dragged width back into a base.
 */
export function fitWidths(bases: number[], available: number, mainIndex = 0): { widths: number[]; factors: number[] } {
  const grow = bases.map((w) => w > FIXED_MAX);
  const sum = bases.reduce((a, w) => a + w, 0);
  const same = { widths: [...bases], factors: bases.map(() => 1) };
  const growSum = bases.reduce((a, w, i) => a + (grow[i] ? w : 0), 0);
  if (!growSum || available === sum) return same;
  const fixedSum = sum - growSum;
  if (available < sum) {
    const shrink = Math.max(MIN_SCALE, (available - fixedSum) / growSum);
    const widths = bases.map((w, i) => (grow[i] ? Math.floor(w * shrink) : w));
    return { widths, factors: widths.map((w, i) => w / bases[i]) };
  }
  let scale = (available - fixedSum) / growSum;
  const widths = [...bases];
  const others = bases.reduce((a, w, i) => a + (grow[i] && i !== mainIndex ? w : 0), 0);
  if (grow[mainIndex] && others > 0) {
    const cap = Math.max(bases[mainIndex], MAIN_CAP);
    const main = Math.min(cap, bases[mainIndex] * scale);
    widths[mainIndex] = Math.floor(main);
    scale = (available - fixedSum - widths[mainIndex]) / others;
  }
  bases.forEach((w, i) => { if (grow[i] && !(i === mainIndex && others > 0)) widths[i] = Math.floor(w * scale); });
  return { widths, factors: widths.map((w, i) => w / bases[i]) };
}

const KEY = (id: string) => `basak.table.${id}`;
/** The widths an admin dragged for one table (column key → base width). */
export function readWidths(id: string): Record<string, number> {
  try { const v = localStorage.getItem(KEY(id)); const p = v ? JSON.parse(v) : null; return p && typeof p === 'object' ? (p.widths ?? p) : {}; } catch { return {}; }
}
export function writeWidths(id: string, widths: Record<string, number>) {
  try {
    if (!Object.keys(widths).length) localStorage.removeItem(KEY(id));
    else localStorage.setItem(KEY(id), JSON.stringify({ widths }));
  } catch { /* private window or storage off: the widths last for this visit */ }
}
