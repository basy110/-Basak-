/**
 * Two small charts drawn in SVG, without a charting library (the dashboard keeps
 * its bundle small). Kept out of ui/index.ts so only the pages that draw a chart
 * download it.
 *
 *   ColumnChart  one value per category: months, 15-minute slots, weekdays
 *   LineChart    values over days, one to three series; `compact` draws a sparkline
 *
 * Reading order: like the rest of the dashboard (RTL), the first item is on the
 * right and time flows to the left; the value axis sits on the right too.
 * Colour: teal for the main series, ink and a muted dashed ink for the others —
 * never status colours. Every chart is an image with a sentence for screen
 * readers plus a hidden table of its numbers, and a tooltip on hover/touch.
 */
import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { dayText, num } from './format';

const TEAL = '#00658D';
const INK = '#17384A';
const MUTED = '#9DB0BB';
const HAIR = '#DCE6EC';
const AXIS_W = 44;
const BOTTOM = 26;
const TOP = 22;

/** The element's width in pixels, followed as it changes. */
function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => setWidth(el.clientWidth || fallback);
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/** A round top for the axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(value));
  const f = value / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Which of `n` labels to print so that none collide (always the first and the last). */
export function labelStep(n: number, width: number, labelW: number): number {
  if (n <= 1 || width <= 0) return 1;
  return Math.max(1, Math.ceil((n * labelW) / width));
}

/** Label i of n when every `every`-th is printed: the last always, and none crowding it. */
export const showLabel = (i: number, n: number, every: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= every);

/** A column with a 4px round top, standing on the baseline. */
const column = (x: number, y: number, w: number, h: number) => {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const shortX = (s: string) => (isDay(s) ? dayText(s, { year: false }) : s);

const Tip: React.FC<{ x: number; width: number; children: React.ReactNode }> = ({ x, width, children }) => (
  <div role="presentation" className="pointer-events-none absolute top-0 z-10 rounded-control bg-ink px-2.5 py-1.5 text-cap text-white shadow-floating"
    style={{ left: Math.max(0, Math.min(width - 160, x - 80)), minWidth: 120, maxWidth: 200 }}>
    {children}
  </div>
);

const Grid: React.FC<{ width: number; top: number; plotH: number; max: number; format: (n: number) => string }> = ({ width, top, plotH, max, format }) => (
  <g aria-hidden="true">
    {[0, 0.5, 1].map((f) => {
      const y = top + plotH - f * plotH;
      return (
        <g key={f}>
          <line x1={0} x2={width - AXIS_W + 6} y1={y} y2={y} stroke={HAIR} strokeWidth={1} strokeDasharray={f === 0 ? undefined : '2 4'} />
          <text x={width - 2} y={y + 4} textAnchor="end" className="fill-ink-3 text-cap tabular">{format(max * f)}</text>
        </g>
      );
    })}
  </g>
);

// ───────────────────────────────────────────────────────────── columns ────

export interface ColumnItem { label: string; value: number; sub?: string }

export const ColumnChart: React.FC<{
  items: ColumnItem[]; format?: (n: number) => string; height?: number;
  /** What the chart shows, for screen readers and the hidden table («الإيرادات حسب الشهر»). */
  label?: string;
}> = ({ items, format = num, height = 180, label = '' }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const max = niceMax(Math.max(0, ...items.map((i) => i.value)));
  const plotW = Math.max(0, width - AXIS_W - 4);
  const plotH = Math.max(20, height - TOP - BOTTOM);
  const step = items.length ? plotW / items.length : 0;
  const barW = Math.max(4, Math.min(32, step * 0.62));
  // RTL: item 0 sits next to the axis on the right.
  const cx = (i: number) => plotW - (i + 0.5) * step;
  const every = labelStep(items.length, plotW, 52);
  const top = items.reduce((best, it, i) => (it.value > (items[best]?.value ?? -1) ? i : best), 0);
  const summary = `${label}: ${items.map((i) => `${i.label} ${format(i.value)}`).join('، ')}`;
  const at = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((plotW - (clientX - rect.left)) / (step || 1));
    setHover(i >= 0 && i < items.length ? i : null);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} aria-describedby={tableId}
          onPointerMove={(e) => at(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)} className="block touch-pan-y" direction="ltr">
          <Grid width={width} top={TOP} plotH={plotH} max={max} format={format} />
          {items.map((it, i) => {
            const h = (it.value / max) * plotH;
            const x = cx(i) - barW / 2;
            return (
              <g key={`${it.label}${i}`}>
                {hover === i && <rect x={cx(i) - step / 2} y={TOP} width={step} height={plotH} fill="#F0F5F8" aria-hidden="true" />}
                <path d={column(x, TOP + plotH - h, barW, h)} fill={TEAL} opacity={hover === null || hover === i ? 1 : 0.55} />
                {i === top && it.value > 0 && hover === null && (
                  <text x={cx(i)} y={TOP + plotH - h - 6} textAnchor="middle" className="fill-ink-2 text-cap font-semibold tabular">{format(it.value)}</text>
                )}
                {showLabel(i, items.length, every) && (
                  <text x={cx(i)} y={height - 6} textAnchor="middle" direction="rtl" className="fill-ink-3 text-cap">{it.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && items[hover] && (
        <Tip x={cx(hover)} width={width}>
          <div className="font-semibold">{items[hover].label}</div>
          <div className="tabular">{format(items[hover].value)}{items[hover].sub ? <span className="text-white/75"> · {items[hover].sub}</span> : null}</div>
        </Tip>
      )}
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <tbody>{items.map((it, i) => <tr key={i}><th scope="row">{it.label}</th><td>{format(it.value)}{it.sub ? ` (${it.sub})` : ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────── lines ────

export type LineTone = 'teal' | 'ink' | 'muted';
export interface LineSeries { name: string; points: { x: string; y: number }[]; tone: LineTone }

const STROKE: Record<LineTone, { color: string; dash?: string }> = { teal: { color: TEAL }, ink: { color: INK }, muted: { color: MUTED, dash: '5 4' } };

export const LineChart: React.FC<{
  series: LineSeries[]; height?: number; format?: (n: number) => string;
  /** A sparkline: no axes, labels, legend or grid (for «اليوم»'s cards). */
  compact?: boolean;
  label?: string;
  /** How an x value is written in labels and the tooltip (days become «10 أكتوبر»). */
  xFormat?: (x: string) => string;
}> = ({ series, height, format = num, compact = false, label = '', xFormat = shortX }) => {
  const h = height ?? (compact ? 64 : 220);
  const [ref, width] = useWidth<HTMLDivElement>(compact ? 200 : 600);
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const xs = series[0]?.points.map((p) => p.x) ?? [];
  const n = xs.length;
  const top = compact ? 4 : TOP - 8;
  const bottom = compact ? 4 : BOTTOM;
  const axis = compact ? 0 : AXIS_W;
  const plotW = Math.max(0, width - axis - (compact ? 0 : 4));
  const plotH = Math.max(10, h - top - bottom);
  const max = compact ? Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y))) : niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y))));
  // RTL: the first day on the right, the latest on the left.
  const px = (i: number) => (n <= 1 ? plotW / 2 : plotW - (i / (n - 1)) * plotW);
  const py = (v: number) => top + plotH - (v / max) * plotH;
  const every = labelStep(n, plotW, 70);
  const last = (s: LineSeries) => s.points[s.points.length - 1];
  const summary = `${label}${label ? ': ' : ''}${series.map((s) => `${s.name} ${last(s) ? `آخره ${format(last(s)!.y)}` : 'لا بيانات'}`).join('، ')}`;
  const at = (clientX: number, rect: DOMRect) => {
    if (n === 0) return;
    const f = 1 - (clientX - rect.left) / (plotW || 1);
    const i = Math.round(f * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {!compact && series.length > 1 && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-cap text-ink-2" aria-hidden="true">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <svg width="18" height="6"><line x1="1" x2="17" y1="3" y2="3" stroke={STROKE[s.tone].color} strokeWidth={2} strokeDasharray={STROKE[s.tone].dash} strokeLinecap="round" /></svg>
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative w-full" style={{ height: h }}>
        {width > 0 && (
          <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={summary} aria-describedby={tableId}
            onPointerMove={(e) => at(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setHover(null)} className="block touch-pan-y" direction="ltr">
            {!compact && <Grid width={width} top={top} plotH={plotH} max={max} format={format} />}
            {!compact && xs.map((x, i) => showLabel(i, n, every) && (
              <text key={x} x={Math.min(plotW - 4, Math.max(28, px(i)))} y={h - 6} textAnchor="middle" direction="rtl" className="fill-ink-3 text-cap" aria-hidden="true">{xFormat(x)}</text>
            ))}
            {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={top} y2={top + plotH} stroke={MUTED} strokeWidth={1} aria-hidden="true" />}
            {series.map((s) => (
              <path key={s.name} d={s.points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join('')}
                fill="none" stroke={STROKE[s.tone].color} strokeWidth={2} strokeDasharray={STROKE[s.tone].dash} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover !== null && series.map((s) => s.points[hover] && (
              <circle key={s.name} cx={px(hover)} cy={py(s.points[hover].y)} r={4} fill={STROKE[s.tone].color} stroke="#fff" strokeWidth={2} />
            ))}
            {n === 1 && series.map((s) => <circle key={s.name} cx={px(0)} cy={py(s.points[0].y)} r={4} fill={STROKE[s.tone].color} />)}
          </svg>
        )}
        {hover !== null && xs[hover] !== undefined && (
          <Tip x={px(hover)} width={width}>
            <div className="font-semibold">{xFormat(xs[hover])}</div>
            {series.map((s) => <div key={s.name} className="flex justify-between gap-3"><span className="text-white/75">{s.name}</span><span className="tabular">{format(s.points[hover]?.y ?? 0)}</span></div>)}
          </Tip>
        )}
      </div>
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">اليوم</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((x, i) => <tr key={x}><th scope="row">{xFormat(x)}</th>{series.map((s) => <td key={s.name}>{format(s.points[i]?.y ?? 0)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
};
