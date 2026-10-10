import { supabase } from './supabase';
import { rpcOr } from './rpc';
import { unwrap } from './query';
import type { StatusKey } from '../ui/Status';

/** One subscription of a student in the open company, as get_company_students_page(_v2) answers it. */
export interface StudentSubscription {
  id: string; status: string; type: string; price: number | string; created_at: string;
  start_date: string | null; end_date: string | null; period_label: string | null; period_phase: string | null;
  departure_time: string | null; return_time: string | null;
  line_name: string | null; trip_label: string | null; trip_university: string | null;
  /** From get_company_students_page_v2 (absent from the older function). */
  shown?: StatusKey; line_id?: string | null; station_name?: string | null; paid_at?: string | null;
}

/** A correction the company asked the platform for and that is still waiting. */
export interface PendingCorrection { id: string; field: 'full_name' | 'university'; old_value: string | null; new_value: string; created_at: string }

/** An active member of the company with their subscriptions to it. */
export interface StudentRow {
  id: string; phone: string; full_name: string; university: string; college: string;
  /** The student's specialisation (department), read-only here. Absent from an older database. */
  specialisation?: string | null;
  profile_image_url: string | null; created_at: string;
  subscriptions: StudentSubscription[];
  /** From get_company_students_page_v2. */
  joined_at?: string | null; university_id?: string | null; status?: Shown;
  corrections?: PendingCorrection[];
  open_reset?: { id: string; status: string; requested_at: string } | null;
}

/** `total` is filled only when it was asked for. */
export interface StudentsPageAnswer { rows: StudentRow[]; has_next: boolean; total: number | null }
export interface StudentsPageRequest { companyId: string; search: string; limit: number; offset: number; withTotal: boolean }

/** A page of the company's active members, newest first, in ONE request; the search is done by the database. */
export async function fetchStudentsPage(request: StudentsPageRequest): Promise<StudentsPageAnswer> {
  const page = await rpcOr<StudentsPageAnswer>('get_company_students_page',
    () => supabase.rpc('get_company_students_page', {
      p_company_id: request.companyId, p_search: request.search || null, p_limit: request.limit, p_offset: request.offset,
      p_with_total: request.withTotal,
    }),
    // The older way's code is downloaded only if it is ever needed.
    async () => (await import('./legacy')).legacyStudentsPage(request));
  return { rows: page?.rows ?? [], has_next: !!page?.has_next, total: page?.total ?? null };
}

// ── What the list shows (docs/canvas/AdmStudents) ──────────────────────

/** A subscription's status as the boards name it, plus «بلا اشتراك» for a student without one. */
export type Shown = StatusKey | 'none';
export const SHOWN_ORDER: Shown[] = ['active', 'review', 'unpaid', 'rejected', 'soon', 'ended', 'none'];
export type StudentSort = 'newest' | 'oldest' | 'name';

/** The same rule as subscription_display_status in the database. */
export function shownOf(sub: Pick<StudentSubscription, 'status' | 'start_date' | 'end_date'>, today: string): StatusKey {
  if (sub.status === 'expired' || (sub.end_date && sub.end_date < today)) return 'ended';
  if (sub.status === 'pending_review') return 'review';
  if (sub.status === 'rejected') return 'rejected';
  if (sub.status === 'pending_payment') return 'unpaid';
  if (sub.status === 'active') return sub.start_date && sub.start_date > today ? 'soon' : 'active';
  return 'ended';
}

/** Subscriptions that are not over, the current period before the next, newest first. */
export function openSubscriptions(student: Pick<StudentRow, 'subscriptions'>, today: string): StudentSubscription[] {
  return student.subscriptions
    .filter((sub) => shownOf(sub, today) !== 'ended')
    .sort((a, b) => Number(!!a.start_date && a.start_date > today) - Number(!!b.start_date && b.start_date > today)
      || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/** Ended subscriptions, the latest first. */
export function pastSubscriptions(student: Pick<StudentRow, 'subscriptions'>, today: string): StudentSubscription[] {
  return student.subscriptions.filter((sub) => shownOf(sub, today) === 'ended')
    .sort((a, b) => (b.start_date ?? b.created_at ?? '').localeCompare(a.start_date ?? a.created_at ?? ''));
}

/** The subscription the list row shows: the first open one, else the latest that ended. */
export function mainSubscription(student: Pick<StudentRow, 'subscriptions'>, today: string): StudentSubscription | undefined {
  return openSubscriptions(student, today)[0] ?? pastSubscriptions(student, today)[0];
}

/** The status of the row (the server's when it said, else worked out the same way). */
export function studentShown(student: Pick<StudentRow, 'subscriptions' | 'status'>, today: string): Shown {
  if (student.status) return student.status;
  const main = mainSubscription(student, today);
  return main ? shownOf(main, today) : 'none';
}

export type StatusCounts = Record<Shown | 'all', number>;
export const zeroCounts = (): StatusCounts => ({ all: 0, active: 0, review: 0, unpaid: 0, rejected: 0, soon: 0, ended: 0, none: 0 });

/** «2026/2027 الفصل الأول» without the year (phone cards, dialog sentences): «الفصل الأول». */
export const periodName = (label: string | null | undefined) => (label ?? '').replace(/\s*\d{4}\/\d{4}\s*$/, '').trim();

/**
 * How the dialogs call a student: the first two names, «عبد» kept with the name it
 * belongs to («عبد الرحمن محمد», «ملك حسام»).
 */
export function shortName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length && out.length < 2; i += 1) {
    if ((words[i] === 'عبد' || words[i] === 'أبو' || words[i] === 'ابو') && words[i + 1]) { out.push(`${words[i]} ${words[i + 1]}`); i += 1; }
    else out.push(words[i]);
  }
  return out.join(' ');
}

/** The first letter shown in a student's circle. */
export const initialOf = (fullName: string) => fullName.trim().charAt(0) || '؟';

// ── The named moves of a subscription (AdmStudentDialogs) ───────────────

export type SubscriptionAction = 'activate' | 'cancel' | 'end' | 'revert' | 'reactivate';
const NEXT_STATUS: Record<SubscriptionAction, string> = { activate: 'active', cancel: 'expired', end: 'expired', revert: 'pending_payment', reactivate: 'active' };

/** The moves a subscription offers, in the order they are drawn (the main one first). */
export function actionsFor(sub: Pick<StudentSubscription, 'status' | 'start_date' | 'end_date'>, today: string): SubscriptionAction[] {
  if (sub.status === 'pending_payment' || sub.status === 'rejected') return ['activate', 'cancel'];
  if (sub.status === 'active') return sub.end_date && sub.end_date < today ? [] : ['end', 'revert'];
  if (sub.status === 'expired') return !sub.end_date || sub.end_date >= today ? ['reactivate'] : [];
  return [];
}

export interface ActionAnswer {
  id: string; status: string; shown?: StatusKey; start_date: string | null; end_date: string | null;
  paid_at?: string | null; period_label: string | null; period_phase: string | null;
}

/**
 * One named move, checked by the database (admin_subscription_action). An older
 * database without the function gets the same status written directly, as the
 * dashboard always did; the move is then checked here only.
 */
export async function runSubscriptionAction(subscriptionId: string, action: SubscriptionAction): Promise<ActionAnswer> {
  return rpcOr<ActionAnswer>('admin_subscription_action',
    () => supabase.rpc('admin_subscription_action', { p_subscription_id: subscriptionId, p_action: action }),
    async () => {
      const row = await unwrap<{ id: string; status: string; start_date: string | null; end_date: string | null; paid_at: string | null }>(
        supabase.from('subscriptions').update({ status: NEXT_STATUS[action] }).eq('id', subscriptionId)
          .select('id, status, start_date, end_date, paid_at').single());
      return { ...row, period_label: null, period_phase: null };
    });
}

/** What a move's answer changes in the row on screen (the period label is kept when the answer has none). */
export function subscriptionPatch(answer: ActionAnswer, today: string): Partial<StudentSubscription> {
  const patch: Partial<StudentSubscription> = {
    status: answer.status, start_date: answer.start_date, end_date: answer.end_date, paid_at: answer.paid_at ?? null,
    shown: answer.shown ?? shownOf(answer, today),
  };
  if (answer.period_label) patch.period_label = answer.period_label;
  if (answer.period_phase) patch.period_phase = answer.period_phase;
  return patch;
}

// ── The list, filtered, sorted and counted by the database ─────────────

export interface StudentsQuery {
  companyId: string; search: string; status: Shown | ''; lineId: string; universityId: string; sort: StudentSort;
  limit: number; offset: number;
  /** One member only (the panel opened from the top bar's search). */
  studentId?: string;
}
export interface StudentsListAnswer {
  rows: StudentRow[]; total: number; has_next: boolean;
  /** Per status over the search, line and university (null from an older database: the chips then show no numbers). */
  counts: StatusCounts | null;
}

/**
 * One request (get_company_students_page_v2). Against an older database the older
 * function answers the search and the page; the status and line filters are then
 * applied to that page only, and the chips have no numbers.
 */
export async function fetchStudentsList(q: StudentsQuery, today: string): Promise<StudentsListAnswer> {
  return rpcOr<StudentsListAnswer>('get_company_students_page_v2',
    () => supabase.rpc('get_company_students_page_v2', {
      p_company_id: q.companyId, p_search: q.search || null, p_status: q.status || null, p_line_id: q.lineId || null,
      p_university_id: q.universityId || null, p_sort: q.sort, p_limit: q.limit, p_offset: q.offset,
      ...(q.studentId ? { p_student_id: q.studentId } : {}),
    }),
    async () => {
      if (q.studentId) {
        const rows = (await (await import('./legacy')).legacyStudentsPage({ companyId: q.companyId, search: '', limit: 100, offset: 0, withTotal: false })).rows
          .filter((row) => row.id === q.studentId).map((row) => ({ ...row, status: studentShown(row, today) }));
        return { rows, total: rows.length, has_next: false, counts: null };
      }
      const page = await fetchStudentsPage({ companyId: q.companyId, search: q.search, limit: q.limit, offset: q.offset, withTotal: true });
      const rows = page.rows
        .map((row) => ({ ...row, status: studentShown(row, today) }))
        .filter((row) => (!q.status || row.status === q.status)
          && (!q.lineId || row.subscriptions.some((sub) => sub.line_id === q.lineId || sub.line_name === q.lineId)));
      return { rows, total: q.status || q.lineId ? rows.length : page.total ?? rows.length, has_next: page.has_next, counts: null };
    });
}

// ── Pure cache edits (what this page's own writes do to what is on screen) ──

/** The page with one subscription changed to what the server answered. */
export function withSubscription<P extends { rows: StudentRow[] }>(page: P | undefined, subscriptionId: string, patch: Partial<StudentSubscription>): P | undefined {
  if (!page || !page.rows.some((student) => student.subscriptions.some((sub) => sub.id === subscriptionId))) return page;
  return {
    ...page,
    rows: page.rows.map((student) => (student.subscriptions.some((sub) => sub.id === subscriptionId)
      ? { ...student, status: undefined, subscriptions: student.subscriptions.map((sub) => (sub.id === subscriptionId ? { ...sub, ...patch } : sub)) }
      : student)),
  };
}

/** The page without a student who left the company. */
export function withoutStudent<P extends { rows: StudentRow[] }>(page: P | undefined, studentId: string): P | undefined {
  if (!page || !page.rows.some((student) => student.id === studentId)) return page;
  return { ...page, rows: page.rows.filter((student) => student.id !== studentId) };
}

/** The page with one student changed (a correction asked for). */
export function withStudent<P extends { rows: StudentRow[] }>(page: P | undefined, studentId: string, patch: (student: StudentRow) => StudentRow): P | undefined {
  if (!page || !page.rows.some((student) => student.id === studentId)) return page;
  return { ...page, rows: page.rows.map((student) => (student.id === studentId ? patch(student) : student)) };
}

/**
 * What the dashboard shows under a student's university: the college, then the
 * specialisation when the student gave one ("الهندسة • مدني"). A college never
 * chosen is stored as 'غير محدد' and shown as `none`.
 */
export function studyLine(college: string | null | undefined, specialisation: string | null | undefined, none = '', separator = ' • '): string {
  const parts = [college, specialisation].map((part) => (part ?? '').trim()).filter((part) => part && part !== 'غير محدد');
  return parts.length ? parts.join(separator) : none;
}

// ── Adding a student (AdmStudentAdd*) ───────────────────────────────────

/** Arabic or Persian digits typed into a phone become Western ones; anything else is dropped. */
export const phoneDigits = (value: string) => value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\D/g, '');

/** Step 1's checks (same rules as the server: three names, an Egyptian mobile, 8 characters). */
export function studentProblems(draft: { fullName: string; phone: string; password: string; universityId: string }): Partial<Record<'fullName' | 'phone' | 'password' | 'universityId', string>> {
  const out: Partial<Record<'fullName' | 'phone' | 'password' | 'universityId', string>> = {};
  if (draft.fullName.trim().split(/\s+/).filter(Boolean).length < 3) out.fullName = 'اكتب الاسم ثلاثياً على الأقل.';
  const digits = phoneDigits(draft.phone);
  if (!digits) out.phone = 'اكتب رقم هاتف الطالب.';
  else if (!/^01[0125]\d{8}$/.test(digits)) out.phone = digits.length < 11 ? 'الرقم ناقص. اكتب 11 رقماً تبدأ بـ 01.' : 'الرقم غير صحيح. اكتب 11 رقماً تبدأ بـ 010 أو 011 أو 012 أو 015.';
  if (!draft.universityId) out.universityId = 'اختر الجامعة.';
  if (draft.password.length < 8) out.password = draft.password ? 'كلمة المرور أقصر من 8 أحرف.' : 'اكتب كلمة مرور من 8 أحرف على الأقل.';
  return out;
}

/** Where a refusal of the server belongs in the steps: the phone field for «already a member / invited». */
export const isPhoneRefusal = (message: string) => /مسجل في شركتك|دعوة معلقة|مسجل بالفعل/.test(message);

// ── Invitations (AdmStudentsInvites) ────────────────────────────────────

export interface Invite { id: string; phone: string; status: string; created_at: string; expires_at: string; responded_at?: string | null; lines: { name: string } | null }

/** The last 10 invitations of the company, newest first. */
export const loadInvites = (companyId: string) => unwrap<Invite[]>(supabase.from('company_invites')
  .select('id, phone, status, created_at, expires_at, responded_at, lines(name)')
  .eq('company_id', companyId).order('created_at', { ascending: false }).limit(10) as unknown as PromiseLike<{ data: Invite[] | null; error: { message: string } | null }>);

/** A pending invitation whose day has passed is shown as expired, as the app treats it. */
export function inviteState(invite: Pick<Invite, 'status' | 'expires_at'>, now: Date = new Date()): 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' {
  if (invite.status === 'pending' && invite.expires_at && new Date(invite.expires_at).getTime() < now.getTime()) return 'expired';
  return (['pending', 'accepted', 'declined', 'cancelled', 'expired'].includes(invite.status) ? invite.status : 'expired') as ReturnType<typeof inviteState>;
}

/** Whole days from now until an instant (at least 0), rounded up. */
export const daysUntil = (iso: string, now: Date = new Date()) => Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));

// ── The platform's directory (AdmPlatStudents) ─────────────────────────

export interface PlatformMembership { company_id: string; company: string; status: 'active' | 'removed'; joined_at: string; removed_at?: string | null; active_subscriptions?: number }
export interface PlatformStudent {
  id: string; full_name: string; phone: string; university: string; created_at: string;
  memberships: PlatformMembership[]; active_subscriptions: number;
}
export type Membership = '' | 'none' | 'multiple';
export interface PlatformCounts { all: number; none: number; multiple: number }

/** One page of every account (platform_students), newest first. */
export const loadPlatformStudents = (q: { search: string; companyId: string; membership: Membership; limit: number; offset: number }) =>
  unwrap<{ total: number; rows: PlatformStudent[] }>(supabase.rpc('platform_students', {
    p_search: q.search || null, p_company_id: q.companyId || null, p_membership: q.membership || null, p_limit: q.limit, p_offset: q.offset,
  }));

/** The chips' numbers in one request; on an older database, three counting requests. */
export async function loadPlatformCounts(search: string, companyId: string): Promise<PlatformCounts> {
  return rpcOr<PlatformCounts>('platform_students_counts',
    () => supabase.rpc('platform_students_counts', { p_search: search || null, p_company_id: companyId || null }),
    async () => {
      const [all, none, multiple] = await Promise.all((['', 'none', 'multiple'] as Membership[]).map((membership) =>
        loadPlatformStudents({ search, companyId, membership, limit: 1, offset: 0 }).then((page) => page.total)));
      return { all, none, multiple };
    });
}

export interface PlatformStudentDetails {
  id: string; full_name: string; phone: string; university: string; college: string | null; specialisation: string | null; created_at: string;
  active_subscriptions: number; memberships: PlatformMembership[];
  corrections: { id: string; field: 'full_name' | 'university'; old_value: string | null; new_value: string; created_at: string; company_id: string; company: string | null }[];
}

/** One account (platform_student_details); an older database answers with what the list row knows. */
export async function loadPlatformStudent(row: PlatformStudent): Promise<PlatformStudentDetails> {
  return rpcOr<PlatformStudentDetails>('platform_student_details',
    () => supabase.rpc('platform_student_details', { p_student_id: row.id }),
    async () => ({ ...row, college: null, specialisation: null, corrections: [] }));
}

/** «في شركتين», «في شركة واحدة», «بلا شركة». */
export function companiesText(n: number): string {
  if (n === 0) return 'بلا شركة';
  if (n === 1) return 'في شركة واحدة';
  if (n === 2) return 'في شركتين';
  return n <= 10 ? `في ${n} شركات` : `في ${n} شركة`;
}
