import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';
import { keys } from './query';
import { rpcOr } from './rpc';
import { hhmm } from './time';
import type { CompanyNumbers } from './overview';
import { forgetApplied, rememberApplied } from './recentChanges';

export const RECEIPTS_BUCKET = 'receipts';
/** How many pending receipts are loaded at a time (oldest first). */
const RECEIPTS_PAGE = 50;

export interface PendingReceiptRow {
  id: string;
  subscriptionId: string;
  studentId: string;
  studentName: string;
  studentPhone: string;
  university: string;
  college: string;
  /** The student's specialisation (department); empty when they gave none. */
  specialisation: string;
  companyId: string;
  companyName: string;
  lineName: string;
  stationName: string;
  departureTime: string;
  returnTime: string;
  subscriptionType: string;
  /** e.g. "الفصل الدراسي الثاني 2026/2027" (from academic_terms via the period_label computed field). */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** current | upcoming | expired */
  periodPhase: string;
  price: number;
  /** Where the image is stored. Its signed link is kept apart (lib/signedUrls.ts), so re-reading the list never re-signs it. */
  imagePath: string | null;
  /** Only for very old rows that stored a full link to somewhere else. */
  legacyImageUrl: string | null;
  attemptNumber: number;
  createdAt: string;
}

function decodeStoragePath(path: string): string {
  return path.split('/').map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join('/');
}

/** Accepts both current storage object paths and legacy Supabase object URLs. */
export function normalizeReceiptStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const pathname = new URL(raw).pathname;
      const bucketMarker = '/receipts/';
      const bucketIndex = pathname.indexOf(bucketMarker);
      if (bucketIndex < 0) return null;
      candidate = pathname.slice(bucketIndex + bucketMarker.length);
    } catch {
      return null;
    }
  } else {
    candidate = candidate.split(/[?#]/, 1)[0];
    candidate = candidate.replace(/^\/+/, '');
    candidate = candidate.replace(/^receipts\//i, '');
    const objectMarker = /^(?:storage\/v1\/)?object\/(?:public|sign|authenticated)\/receipts\//i;
    candidate = candidate.replace(objectMarker, '');
  }

  const decoded = decodeStoragePath(candidate.replace(/^\/+/, ''));
  return decoded && !decoded.split('/').some((part) => part === '..') ? decoded : null;
}

/** `total`: how many wait in all (absent from an older database). */
export interface PendingReceipts { rows: PendingReceiptRow[]; hasMore: boolean; total?: number }

/** One row of get_pending_receipts_page: the receipt with everything the review table shows about it. */
export interface ReceiptAnswerRow {
  id: string; image_url: string | null; attempt_number: number | null; created_at: string; amount: number | string | null;
  subscription_id: string; student_id: string | null; student_name: string | null; student_phone: string | null;
  university: string | null; college: string | null;
  /** Absent from a database that has not been given the column yet. */
  specialisation?: string | null;
  company_id: string | null; company_name: string | null;
  line_name: string | null; station_name: string | null; departure_time: string | null; return_time: string | null;
  subscription_type: string | null; period_label: string | null; period_start: string | null; period_end: string | null;
  period_phase: string | null; price: number | string | null;
}
export interface ReceiptsPageAnswer { rows: ReceiptAnswerRow[]; has_more: boolean; total?: number }

/** The server's row as the table shows it (placeholders for what is missing, the image as a storage path). */
export function toPendingRow(row: ReceiptAnswerRow): PendingReceiptRow {
  const imagePath = normalizeReceiptStoragePath(row.image_url);
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    studentId: row.student_id || '',
    studentName: row.student_name || 'بيانات الطالب غير متاحة',
    studentPhone: row.student_phone || '—',
    university: row.university || '—',
    college: row.college && row.college !== 'غير محدد' ? row.college : '',
    specialisation: (row.specialisation ?? '').trim(),
    companyId: row.company_id || '',
    companyName: row.company_name || '—',
    lineName: row.line_name || '—',
    stationName: row.station_name || '—',
    departureTime: hhmm(row.departure_time),
    returnTime: hhmm(row.return_time),
    subscriptionType: row.subscription_type || 'termly',
    periodLabel: row.period_label || '',
    periodStart: row.period_start || '',
    periodEnd: row.period_end || '',
    periodPhase: row.period_phase || '',
    // The amount recorded with the receipt; older receipts fall back to the subscription price.
    price: Number(row.amount ?? row.price ?? 0),
    imagePath,
    legacyImageUrl: !imagePath && /^https?:\/\//i.test(row.image_url || '') ? String(row.image_url) : null,
    attemptNumber: row.attempt_number || 1,
    createdAt: row.created_at,
  };
}

/** The oldest pending receipts of a company, in ONE request (get_pending_receipts_page). */
export async function fetchPendingReceipts(companyId: string, limit: number = RECEIPTS_PAGE): Promise<PendingReceipts> {
  const page = await rpcOr<ReceiptsPageAnswer>('get_pending_receipts_page',
    () => supabase.rpc('get_pending_receipts_page', { p_company_id: companyId, p_limit: limit }),
    // The older way's code is downloaded only if it is ever needed.
    async () => (await import('./legacy')).legacyPendingReceipts(companyId, limit));
  return { rows: (page?.rows ?? []).map(toPendingRow), hasMore: !!page?.has_more, ...(typeof page?.total === 'number' ? { total: page.total } : {}) };
}

/** What review_receipt answers: the decision and the company's numbers after it. */
interface ReviewAnswer { id: string; status: string; company_id: string; overview: CompanyNumbers | null; reviewed_at?: string | null }

/**
 * Whether an answer's numbers are newer than the ones already applied. Answers
 * to decisions taken close together can arrive in another order than the
 * decisions were saved; `reviewed_at` is when each was saved.
 */
export function isNewerReview(appliedAt: string | null, reviewedAt: string): boolean {
  return appliedAt === null || Date.parse(reviewedAt) >= Date.parse(appliedAt);
}

/**
 * The numbers of an answer while other decisions of this tab are still on their
 * way: those receipts have already left the screen, whether or not this answer
 * was computed before they were saved, so the waiting number never goes back up.
 */
export function withOptimisticPending<T extends { pending_receipts: number }>(numbers: T, shown: T | undefined, othersRunning: number): T {
  return othersRunning > 0 && shown ? { ...numbers, pending_receipts: Math.min(numbers.pending_receipts, shown.pending_receipts) } : numbers;
}

// ── Pure cache edits (what an approval or rejection does to what is on screen) ──

/** The list without the reviewed receipt. */
export function withoutReceipt(list: PendingReceipts | undefined, id: string): PendingReceipts | undefined {
  if (!list || !list.rows.some((row) => row.id === id)) return list;
  return { ...list, rows: list.rows.filter((row) => row.id !== id), ...(list.total !== undefined ? { total: Math.max(0, list.total - 1) } : {}) };
}

/** The list with a receipt put back in its place (oldest first) after a refused decision. */
export function withReceipt(list: PendingReceipts | undefined, row: PendingReceiptRow): PendingReceipts | undefined {
  if (!list || list.rows.some((item) => item.id === row.id)) return list;
  return { ...list, rows: [...list.rows, row].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), ...(list.total !== undefined ? { total: list.total + 1 } : {}) };
}

/** The overview with its "receipts waiting" number moved by `delta` (never below zero). */
export function withPendingDelta<T extends { pending_receipts: number }>(overview: T | undefined, delta: number): T | undefined {
  return overview ? { ...overview, pending_receipts: Math.max(0, overview.pending_receipts + delta) } : overview;
}

/** Few rows left on screen while more wait in the database: time to load the next ones. */
export const shouldTopUp = (list: PendingReceipts | undefined, threshold = 10) =>
  !!list && list.hasMore && list.rows.length < threshold;

// ── Approvals held back for a few seconds (the «تراجع» of the approval toast) ──

/** How long an approval waits on this tab before it is sent: the life of its «تراجع» toast. */
export const APPROVAL_HOLD_MS = 6000;

export interface HoldTimers { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void }
const browserTimers: HoldTimers = { set: (run, ms) => window.setTimeout(run, ms), clear: (handle) => window.clearTimeout(handle as number) };

/**
 * Decisions kept on this tab until their moment comes. `hold` starts the clock;
 * `undo` takes one back while it is still waiting (true) or says it is too late
 * (false); `flush` sends every waiting one at once (the page closes, the tab is
 * hidden). Each is sent exactly once.
 */
export function createHoldQueue<T>(send: (id: string, item: T) => void, delayMs: number = APPROVAL_HOLD_MS, timers: HoldTimers = browserTimers) {
  const waiting = new Map<string, { item: T; handle: unknown }>();
  const fire = (id: string) => {
    const entry = waiting.get(id);
    if (!entry) return;
    waiting.delete(id);
    timers.clear(entry.handle);
    send(id, entry.item);
  };
  return {
    hold(id: string, item: T) {
      if (waiting.has(id)) return false;
      waiting.set(id, { item, handle: timers.set(() => fire(id), delayMs) });
      return true;
    },
    undo(id: string): T | null {
      const entry = waiting.get(id);
      if (!entry) return null;
      waiting.delete(id);
      timers.clear(entry.handle);
      return entry.item;
    },
    flush() { [...waiting.keys()].forEach(fire); },
    has: (id: string) => waiting.has(id),
    get size() { return waiting.size; },
  };
}

// ── What the review page shows about the loaded queue ──

/** «كل الخطوط» and one chip per line, the busiest first. */
export function lineCounts(rows: readonly PendingReceiptRow[]): { line: string; count: number }[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.lineName, (counts.get(row.lineName) ?? 0) + 1));
  return [...counts].map(([line, count]) => ({ line, count })).sort((a, b) => b.count - a.count || a.line.localeCompare(b.line, 'ar'));
}

/** Arabic letters compared without the forms that vary in typing (أ إ آ ا, ة ه, ى ي) or spaces in a phone. */
const fold = (text: string) => text.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();

/** The loaded receipts that match a search (name or phone) and a line. */
export function filterReceipts(rows: readonly PendingReceiptRow[], search: string, line: string | null): PendingReceiptRow[] {
  const term = fold(search);
  const digits = search.replace(/\D/g, '');
  return rows.filter((row) => (!line || row.lineName === line)
    && (!term || fold(row.studentName).includes(term) || (digits.length >= 3 && row.studentPhone.replace(/\D/g, '').includes(digits))));
}

/** A receipt has five tries; the fifth is the last. */
export const MAX_ATTEMPTS = 5;
export const isLastAttempt = (row: Pick<PendingReceiptRow, 'attemptNumber'>) => row.attemptNumber >= MAX_ATTEMPTS;

/** The reason sent to the student: the chosen one, then the admin's own words. Never ends with two stops. */
export function rejectionReason(preset: string | null, note: string): string {
  const clean = (text: string) => text.trim().replace(/[.。؛،\s]+$/u, '');
  const parts = [preset, note].map((part) => clean(part ?? '')).filter(Boolean);
  return parts.join('. ');
}

/** What the app tells the student after a rejection about sending another receipt. */
export function attemptsLeftText(attemptNumber: number): string {
  const left = Math.max(0, MAX_ATTEMPTS - attemptNumber);
  if (left === 0) return 'لا يمكنك إرسال إيصال آخر لهذا الاشتراك.';
  const count = left === 1 ? 'محاولة واحدة' : left === 2 ? 'محاولتان' : `${left} محاولات`;
  return `يمكنك إرسال إيصال جديد. بقيت لك ${count}.`;
}

/** The database refused because the receipt is no longer waiting: another admin decided it first. */
export const isAlreadyDecided = (error: unknown) =>
  /لم يعد قيد المراجعة|BR010/.test(error instanceof Error ? error.message : String(error ?? ''));

/** A full name in its names, a compound name («عبد الرحمن», «منة الله», «حسام الدين») counting as one. */
function nameUnits(full: string): string[] {
  const words = full.trim().split(/\s+/).filter(Boolean);
  const names: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const joinsNext = /^(عبد|أبو|ابو|أبي)$/.test(words[i]) || /^(الله|الدين|الرحمن|الرحيم)$/.test(words[i + 1] ?? '');
    if (joinsNext && words[i + 1]) { names.push(`${words[i]} ${words[i + 1]}`); i += 1; } else names.push(words[i]);
  }
  return names;
}
const isCompound = (unit: string) => unit.includes(' ');

/** «منة الله إبراهيم عبد الرازق» → «منة الله». */
export const firstName = (full: string) => nameUnits(full)[0] ?? full;

/** «منة الله إبراهيم عبد الرازق» → «منة الله إبراهيم», «سلمى طارق عبد الحميد» → «سلمى طارق»: the first two names (titles, toasts). */
export function shortName(full: string): string {
  return nameUnits(full).slice(0, 2).join(' ') || full;
}

/** The name in the queue: up to three names, stopping before a compound third («نورهان محمود عبد العزيز» → «نورهان محمود»). */
export function listName(full: string): string {
  const units = nameUnits(full);
  const take = units.length > 2 && !isCompound(units[2]) && !isCompound(units[0]) ? 3 : 2;
  return units.slice(0, take).join(' ') || full;
}

/**
 * The receipts one company still has to review. New ones arrive through the
 * workspace's live topic. A decision is ONE request: the row leaves the list at
 * once, and the server's answer carries the company's numbers after it, which
 * replace the cached ones. Nothing is read again for the admin who decided,
 * not even on the change's own announcement (other admins follow through the
 * live topic).
 */
export function usePendingReceipts(companyId: string) {
  const client = useQueryClient();
  const [limit, setLimit] = useState(RECEIPTS_PAGE);
  const root = keys.company(companyId, 'receipts', 'pending');
  const overviewKey = keys.company(companyId, 'overview');
  const query = useQuery({
    queryKey: [...root, limit],
    // A receipt approved here but still held back (its «تراجع» is open) stays off the list.
    queryFn: async () => {
      const list = await fetchPendingReceipts(companyId, limit);
      const hidden = hiddenFor(companyId);
      if (!hidden.size) return list;
      const rows = list.rows.filter((row) => !hidden.has(row.id));
      return { ...list, rows, ...(list.total !== undefined ? { total: Math.max(0, list.total - (list.rows.length - rows.length)) } : {}) };
    },
    placeholderData: keepPreviousData,   // "load more" keeps the rows on screen
  });
  // Decisions under way. Answers can arrive in another order than the decisions were
  // saved, so each is applied only if it is newer (`reviewed_at`) than the last one
  // applied. `unordered` is for a database whose answers do not say when: after
  // overlapping decisions the numbers are then read once instead.
  const flight = useRef({ running: 0, unordered: false, appliedAt: null as string | null });

  const review = useMutation({
    mutationFn: ({ id, decision, reason }: ReviewInput) => rpcOr<ReviewAnswer | null>('review_receipt',
      () => supabase.rpc('review_receipt', { p_receipt_id: id, p_decision: decision, p_reason: reason ?? null }),
      async () => (await import('./legacy')).legacyReviewReceipt(id, decision, reason)),
    onMutate: async ({ id, held }) => {
      flight.current.running += 1;
      // A read that is under way would bring the row back; it is repeated once the decision is saved.
      const interrupted = client.isFetching({ queryKey: root }) > 0;
      await client.cancelQueries({ queryKey: root });
      hiddenFor(companyId).add(id);
      if (held) {
        // Held back: the row already left the screen (and the waiting number) when it was approved.
        const echoes = [id, held.row.subscriptionId];
        rememberApplied(echoes, APPLIED_HERE);
        return { held: held.keys, row: held.row, interrupted, echoes } satisfies ReviewContext;
      }
      const lists = client.getQueriesData<PendingReceipts>({ queryKey: root });
      const row = lists.flatMap(([, list]) => list?.rows ?? []).find((item) => item.id === id);
      // The database announces this change to us as well (the receipt and its
      // subscription); that echo must re-read neither the queue nor the numbers.
      const echoes = [id, row?.subscriptionId];
      rememberApplied(echoes, APPLIED_HERE);
      client.setQueriesData<PendingReceipts>({ queryKey: root }, (list) => withoutReceipt(list, id));
      if (row) client.setQueryData<CompanyNumbers>(overviewKey, (numbers) => withPendingDelta(numbers, -1));
      return { held: lists.filter(([, list]) => list?.rows.some((item) => item.id === id)).map(([key]) => key), row, interrupted, echoes } satisfies ReviewContext;
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      forgetApplied(context.echoes);
      const { row } = context;
      if (!row) return;
      // Only this receipt comes back: other decisions taken meanwhile stay as they are.
      context.held.forEach((key) => client.setQueryData<PendingReceipts>(key, (list) => withReceipt(list, row)));
      client.setQueryData<CompanyNumbers>(overviewKey, (numbers) => withPendingDelta(numbers, +1));
    },
    onSuccess: (answer, _input, context) => {
      // The answer may have taken a while: keep recognising the echo from now.
      rememberApplied(context?.echoes ?? [], APPLIED_HERE);
      const numbers = answer?.overview;
      const others = flight.current.running - 1;
      // No numbers in the answer (the older database): they are read once.
      if (!numbers) void client.invalidateQueries({ queryKey: overviewKey });
      else if (answer.reviewed_at) {
        if (isNewerReview(flight.current.appliedAt, answer.reviewed_at)) {
          flight.current.appliedAt = answer.reviewed_at;
          client.setQueryData<CompanyNumbers>(overviewKey, (shown) => withOptimisticPending(numbers, shown, others));
        }
      } else if (others > 0 || flight.current.unordered) flight.current.unordered = true;
      else client.setQueryData<CompanyNumbers>(overviewKey, numbers);
      // The queue is not read again, except for the next receipts once the loaded ones run out.
      if (context?.interrupted || shouldTopUp(client.getQueryData<PendingReceipts>([...root, limit]))) {
        void client.invalidateQueries({ queryKey: root });
      }
    },
    onSettled: (_data, error, input, context) => {
      hiddenFor(companyId).delete(input.id);
      // A refused decision usually means the receipt is no longer waiting (another admin
      // decided it first): the queue is read once to show what is really there.
      if (error) void client.invalidateQueries({ queryKey: root });
      flight.current.running -= 1;
      if (flight.current.running > 0 || !flight.current.unordered) return;
      // Overlapping decisions whose answers carry no time: one read after the last of them settles the numbers.
      flight.current.unordered = false;
      void client.invalidateQueries({ queryKey: overviewKey });
    },
  });

  // Approvals wait here for APPROVAL_HOLD_MS, then go as one request each. Leaving the
  // page, hiding or closing the tab sends the waiting ones at once: an approval the
  // admin did not take back is never lost.
  const send = useRef(review.mutateAsync);
  send.current = review.mutateAsync;
  const queue = useRef<ReturnType<typeof createHoldQueue<HeldApproval>>>();
  queue.current ??= createHoldQueue<HeldApproval>((id, item) => {
    send.current({ id, decision: 'approved', held: { row: item.row, keys: item.keys } }).then(item.onDone, item.onError);
  });
  useEffect(() => {
    const held = queue.current!;
    const flushIfHidden = () => { if (document.visibilityState === 'hidden') held.flush(); };
    const flush = () => held.flush();
    document.addEventListener('visibilitychange', flushIfHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flushIfHidden);
      window.removeEventListener('pagehide', flush);
      held.flush();
    };
  }, []);

  /** Approve with a few seconds to take it back. The row leaves at once; false if it is not on screen. */
  const approveLater = useCallback((id: string, callbacks: { onDone?: () => void; onError?: (error: unknown) => void } = {}) => {
    const lists = client.getQueriesData<PendingReceipts>({ queryKey: root });
    const row = lists.flatMap(([, list]) => list?.rows ?? []).find((item) => item.id === id);
    if (!row || queue.current!.has(id)) return false;
    hiddenFor(companyId).add(id);
    void client.cancelQueries({ queryKey: root });
    const held = lists.filter(([, list]) => list?.rows.some((item) => item.id === id)).map(([key]) => key);
    client.setQueriesData<PendingReceipts>({ queryKey: root }, (list) => withoutReceipt(list, id));
    client.setQueryData<CompanyNumbers>(overviewKey, (numbers) => withPendingDelta(numbers, -1));
    queue.current!.hold(id, { row, keys: held, onDone: callbacks.onDone ?? noop, onError: callbacks.onError ?? noop });
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, companyId]);

  /** «تراجع»: the held approval is dropped and the receipt goes back in its place. False once it has been sent. */
  const undoApproval = useCallback((id: string) => {
    const item = queue.current!.undo(id);
    if (!item) return false;
    hiddenFor(companyId).delete(id);
    item.keys.forEach((key) => client.setQueryData<PendingReceipts>(key, (list) => withReceipt(list, item.row)));
    client.setQueryData<CompanyNumbers>(overviewKey, (numbers) => withPendingDelta(numbers, +1));
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, companyId]);

  const shown = query.data;
  return {
    receipts: shown?.rows ?? EMPTY,
    hasMore: shown?.hasMore ?? false,
    /** How many wait in all, when the database says (the list itself is loaded 50 at a time). */
    total: shown?.total,
    loadingMore: query.isPlaceholderData,
    loadMore: () => setLimit((current) => current + RECEIPTS_PAGE),
    loading: query.isPending,
    error: query.error?.message ?? '',
    refresh: () => void query.refetch(),
    review: async (id: string, decision: 'approved' | 'rejected', reason?: string) => { await review.mutateAsync({ id, decision, reason }); },
    approveLater,
    undoApproval,
    /** Whether the list has been read at least once (the first answer may still be on its way). */
    loaded: query.data !== undefined,
  };
}

/** What a decision brings up to date in this tab (names as in lib/sync.ts). */
const APPLIED_HERE = ['receipts', 'overview'] as const;
const EMPTY: PendingReceiptRow[] = [];
interface ReviewInput { id: string; decision: 'approved' | 'rejected'; reason?: string; held?: { row: PendingReceiptRow; keys: QueryKey[] } }
interface HeldApproval { row: PendingReceiptRow; keys: QueryKey[]; onDone: () => void; onError: (error: unknown) => void }
const noop = () => undefined;
/** Per company: receipts approved on this tab whose request has not been answered yet (held back or on its way). */
const hiddenIds = new Map<string, Set<string>>();
const hiddenFor = (companyId: string) => { let set = hiddenIds.get(companyId); if (!set) { set = new Set(); hiddenIds.set(companyId, set); } return set; };
interface ReviewContext {
  held: QueryKey[]; row: PendingReceiptRow | undefined; interrupted: boolean; echoes: (string | undefined)[];
}
