import React from 'react';

export type Tone = 'success' | 'warning' | 'danger' | 'teal' | 'neutral';
export const TONE: Record<Tone, string> = {
  success: 'bg-ok-bg text-ok', warning: 'bg-warn-bg text-warn', danger: 'bg-bad-bg text-bad',
  teal: 'bg-teal-tint text-teal', neutral: 'bg-sunken text-ink-2',
};
const DOT: Record<Tone, string> = { success: 'bg-ok', warning: 'bg-warn', danger: 'bg-bad', teal: 'bg-teal', neutral: 'bg-ink-2' };

/** A plain tag: counts, kinds, «آخر محاولة». */
export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'neutral', children, className = '' }) => (
  <span className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-control px-2.5 text-cap font-medium leading-5 ${TONE[tone]} ${className}`}>{children}</span>
);

const DotPill: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex flex-none items-center gap-[7px] whitespace-nowrap rounded-full py-[3px] pe-3 ps-2.5 text-label font-medium ${TONE[tone]}`}>
    <span className={`h-[7px] w-[7px] flex-none rounded-full ${DOT[tone]}`} aria-hidden="true" />
    <span>{children}</span>
  </span>
);

/** The six subscription statuses. Labels are fixed; never write them by hand. */
export const STATUS = {
  active: ['نشط', 'success'], review: ['قيد المراجعة', 'warning'], unpaid: ['بانتظار الدفع', 'teal'],
  rejected: ['إيصال مرفوض', 'danger'], soon: ['يبدأ قريباً', 'teal'], ended: ['منتهٍ', 'neutral'],
} as const satisfies Record<string, readonly [string, Tone]>;
export type StatusKey = keyof typeof STATUS;
export const StatusPill: React.FC<{ status: StatusKey }> = ({ status }) => <DotPill tone={STATUS[status][1]}>{STATUS[status][0]}</DotPill>;

/** Things that run or stop, and request / message states. */
export const STATE = {
  on: ['يعمل', 'success'], off: ['متوقف', 'neutral'], archived: ['مؤرشفة', 'neutral'], suspended: ['موقوفة', 'warning'],
  open: ['بانتظار الرد', 'warning'], done: ['تم', 'success'], cancelled: ['أُلغي', 'neutral'], failed: ['فشل الإرسال', 'danger'],
  scheduled: ['مجدول', 'teal'], sent: ['أُرسل', 'success'],
} as const satisfies Record<string, readonly [string, Tone]>;
export type StateKey = keyof typeof STATE;
export const StatePill: React.FC<{ state: StateKey; label?: string }> = ({ state, label }) => <DotPill tone={STATE[state][1]}>{label ?? STATE[state][0]}</DotPill>;
/** A dot pill with any label and tone (for states the two lists above do not name). */
export const Pill: React.FC<{ tone: Tone; children: React.ReactNode }> = DotPill;

/** The red count on navigation entries. */
export const CountBadge: React.FC<{ n: number; className?: string }> = ({ n, className = '' }) => (n > 0
  ? <span className={`h-5 min-w-5 flex-none rounded-full bg-badge px-1.5 text-center text-cap font-semibold leading-5 text-white tabular ${className}`}>{n > 99 ? '99+' : n}</span>
  : null);

/** Phone numbers, codes, e-mails: left to right, isolated, aligned to the start edge. */
export const Ltr: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <span dir="ltr" className={`[unicode-bidi:isolate] ${className}`}>{children}</span>
);

/** «4,500 ج.م» with the unit quieter. */
export const Money: React.FC<{ value: number | null | undefined; unitClass?: string }> = ({ value, unitClass = 'text-cap' }) => (
  <span className="whitespace-nowrap tabular">{value == null ? '—' : Math.round(value).toLocaleString('en-US')} <span className={`font-normal text-ink-3 ${unitClass}`}>ج.م</span></span>
);
