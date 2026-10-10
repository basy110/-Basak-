/**
 * Students' «نسيت كلمة المرور» requests (supabase/migrations/20261004000003_student_password_reset.sql).
 * The admin checks the student by phone, then issues a one-time 6-digit code
 * (30 minutes, 5 tries) that the student types into the app with a new password.
 * Passwords never reach the dashboard.
 */
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { keys, unwrap, usePageData } from './query';
import { rpcOr } from './rpc';
import { rememberApplied } from './recentChanges';
import { firstName } from './pendingReceipts';
import { cairoToday } from './time';
import { cairo, clock, dayText } from '../ui/format';
import type { Tone } from '../ui/Status';

import { isOpenReset } from './resetRequests';

export { OPEN_RESET_STATUSES, isOpenReset } from './resetRequests';

export type ResetStatus = 'pending' | 'code_issued' | 'completed' | 'cancelled' | 'expired';
export interface ResetRequest {
  id: string;
  student_id: string;
  student_name: string;
  student_phone: string;
  status: ResetStatus;
  requested_at: string;
  code_issued_at: string | null;
  code_expires_at: string | null;
  failed_attempts: number;
  closed_at?: string | null;
  /** The platform admin only: the companies the student rides with (empty: none). Absent from an older database. */
  companies?: string[] | null;
}
export interface IssuedCode { code: string; expires_at: string }

/** How many wrong tries a code allows (check_student_password_reset_code). */
export const CODE_TRIES = 5;
/** How long a code lasts, in minutes. */
export const CODE_MINUTES = 30;

/** Cache key of the list (lib/sync.ts refreshes «resetRequests» when a request changes). */
export const resetRequestsKey = (companyId: string | null) => (companyId ? keys.company(companyId, 'resetRequests') : keys.platform('resetRequests'));
const countKey = (companyId: string | null) => [...resetRequestsKey(companyId), 'count'] as const;

/** The last 30 days of requests, open ones first; with the student's companies when the database has them. */
export async function fetchResetRequests(companyId: string | null): Promise<ResetRequest[]> {
  return rpcOr<ResetRequest[]>('admin_password_reset_requests',
    () => supabase.rpc('admin_password_reset_requests', { p_company_id: companyId }),
    () => unwrap<ResetRequest[]>(supabase.rpc('admin_list_password_reset_requests', { p_company_id: companyId })));
}

/** What a request's status says, as each board writes it. */
export function resetState(request: Pick<ResetRequest, 'status' | 'code_expires_at'>, view: 'company' | 'platform', now: Date = new Date()): { tone: Tone; text: string } {
  const expired = request.status === 'expired' || (request.status === 'code_issued' && !!request.code_expires_at && Date.parse(request.code_expires_at) < now.getTime());
  if (expired) return { tone: 'neutral', text: view === 'company' ? 'انتهى الرمز ولم يُستعمل' : 'انتهت صلاحية الرمز' };
  switch (request.status) {
    case 'pending': return { tone: 'warning', text: view === 'company' ? 'ينتظر رمزاً منك' : 'ينتظر التحقق' };
    case 'code_issued': {
      const until = request.code_expires_at ? clock(cairo(request.code_expires_at).time) : '';
      return { tone: 'teal', text: view === 'company' ? `معه رمز · صالح حتى ${until}` : `رمز صالح حتى ${until}` };
    }
    case 'completed': return { tone: 'success', text: 'غيّر كلمة المرور' };
    default: return { tone: 'neutral', text: 'أُلغي' };
  }
}

/** A request the admin can still act on: pending, or a code that has not run out. */
export const canAct = (request: Pick<ResetRequest, 'status' | 'code_expires_at'>, now: Date = new Date()) =>
  request.status === 'pending' || (request.status === 'code_issued' && !(request.code_expires_at && Date.parse(request.code_expires_at) < now.getTime()));

/** «اليوم 9:02 ص», «أمس · 6:15 م», «8 أكتوبر · 10:05 ص» (Cairo time). `sep` is what stands between the day and the time. */
export function requestedText(iso: string, now: Date = new Date(), sep = ' · '): string {
  const at = cairo(iso);
  const today = cairoToday(now);
  const yesterday = cairoToday(new Date(now.getTime() - 86_400_000));
  const day = at.day === today ? 'اليوم' : at.day === yesterday ? 'أمس' : dayText(at.day, { year: at.day.slice(0, 4) !== today.slice(0, 4) });
  return `${day}${at.day === today ? ' ' : sep}${clock(at.time)}`;
}

/** «482916» → «482 916». */
export const codeText = (code: string) => (/^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

/** Why a code was not issued, from what the request turned out to be when the list was read again. */
export function issueRefusal(now: ResetRequest | undefined, firstName: string): string {
  if (now?.status === 'completed') return `لم يُصدر رمز: غيّر ${firstName} كلمة المرور قبل لحظات برمز سابق.`;
  if (now?.status === 'cancelled') return 'لم يُصدر رمز: أُلغي هذا الطلب قبل لحظات.';
  if (now?.status === 'expired') return 'لم يُصدر رمز: انتهى هذا الطلب. يستطيع الطالب أن يطلب المساعدة من التطبيق مرة أخرى.';
  return 'تعذّر إصدار الرمز. لم يتغيّر شيء في حساب الطالب.';
}

/**
 * The requests of a company (or of every company for the platform admin), and the
 * two things an admin does to one: issue a code, cancel it. Each write puts the
 * server's answer on screen; its own announcement then re-reads nothing.
 */
export function useResetRequests(companyId: string | null) {
  const listKey = resetRequestsKey(companyId);
  const client = useQueryClient();
  const page = usePageData(listKey, () => fetchResetRequests(companyId));

  const apply = (request: ResetRequest, change: Partial<ResetRequest>) => {
    rememberApplied([request.id], ['resetRequests']);
    client.setQueryData<ResetRequest[]>(listKey, (rows) => rows?.map((row) => (row.id === request.id ? { ...row, ...change } : row)));
    const closes = isOpenReset(request) && change.status !== undefined && !isOpenReset({ status: change.status });
    if (closes) client.setQueryData<number>(countKey(companyId), (count) => (count === undefined ? count : Math.max(0, count - 1)));
  };

  /** Issues a new code. On a refusal the list is read again and the reason is thrown in plain words. */
  const issue = async (request: ResetRequest): Promise<IssuedCode> => {
    const { data, error } = await supabase.rpc('admin_issue_password_reset_code', { p_request_id: request.id });
    if (error || !data) {
      const fresh = await fetchResetRequests(companyId).catch(() => undefined);
      if (fresh) client.setQueryData(listKey, fresh);
      void client.invalidateQueries({ queryKey: countKey(companyId), exact: true });
      throw new Error(issueRefusal(fresh?.find((row) => row.id === request.id), firstName(request.student_name)));
    }
    const issued = data as IssuedCode;
    apply(request, { status: 'code_issued', code_issued_at: new Date().toISOString(), code_expires_at: issued.expires_at, failed_attempts: 0 });
    return issued;
  };

  const cancel = async (request: ResetRequest) => {
    const { error } = await supabase.rpc('admin_cancel_password_reset', { p_request_id: request.id });
    if (error) {
      // It may have been completed or cancelled meanwhile: show what it is now.
      void page.reload();
      void client.invalidateQueries({ queryKey: countKey(companyId), exact: true });
      throw new Error(error.message);
    }
    apply(request, { status: 'cancelled', closed_at: new Date().toISOString() });
  };

  return { ...page, requests: page.data ?? EMPTY, issue, cancel };
}
const EMPTY: ResetRequest[] = [];
