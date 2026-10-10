/**
 * The people who run a company: its supervisors (on the bus, with the phone app)
 * and its admins (this dashboard). The pure rules first (what a list shows,
 * what an action will do), then the requests.
 */
import { supabase } from './supabase';
import { keys, unwrap, usePageData } from './query';
import { rpcOr } from './rpc';
import { invokeEdgeFunction } from './edgeFunctions';
import { SUPERVISOR_COLUMNS, type LineName, type SupervisorLine, type SupervisorRow } from './reference';
import { countText, NOUN } from '../ui/format';

// ── Words ───────────────────────────────────────────────────────────
export const SUBSCRIBER: [string, string, string, string] = ['مشترك', 'مشتركان', 'مشتركين', 'مشتركاً'];
export const RECORD: [string, string, string, string] = ['سجل', 'سجلان', 'سجلات', 'سجلاً'];

/** «شربين، عزبة البرج». */
export const listText = (names: readonly string[]): string => names.join('، ');

/** «خط شربين» · «خطي شربين وعزبة البرج» · «خطوط فارسكور، شربين وعزبة البرج». */
export function linesPhrase(names: readonly string[]): string {
  if (names.length === 0) return 'أي خط';
  if (names.length === 1) return `خط ${names[0]}`;
  if (names.length === 2) return `خطي ${names[0]} و${names[1]}`;
  return `خطوط ${names.slice(0, -1).join('، ')} و${names[names.length - 1]}`;
}

/** «مدير واحد» · «مديران» · «3 مديرين» · «38 مديراً». */
export const adminsCount = (n: number): string => (n === 1 ? 'مدير واحد' : countText(n, [...NOUN.admin]));
/** «مشرف واحد» · «مشرفان» · «9 مشرفين». */
export const supervisorsCount = (n: number): string => (n === 1 ? 'مشرف واحد' : countText(n, [...NOUN.supervisor]));

/** «لـ» before a name: «للصفوة للرحلات», «لشركة النورس». */
export const forName = (name: string): string => (name.startsWith('ال') ? `لل${name.slice(2)}` : `ل${name}`);

/** The letter shown in place of a photo. */
export const initialOf = (name: string | null | undefined): string => (name ?? '').trim().charAt(0) || '؟';

// ── Phones and passwords ────────────────────────────────────────────
const EASTERN = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹';
/** Any way a number is typed (+20…, spaces, Arabic digits) → «01xxxxxxxxx», as the database stores it. */
export function normalizePhone(value: string): string {
  let digits = value.replace(/[٠-٩۰-۹]/g, (d) => String(EASTERN.indexOf(d) % 10)).replace(/\D/g, '');
  if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('1')) digits = `0${digits}`;
  return digits;
}
export const isEgyptianMobile = (phone: string): boolean => /^01[0125]\d{8}$/.test(phone);
/** The phone field's own mistake, or '' when it is fine. */
export function phoneProblem(value: string): string {
  if (!value.trim()) return 'اكتب رقم هاتف المشرف.';
  return isEgyptianMobile(normalizePhone(value)) ? '' : 'رقم مصري من 11 رقماً يبدأ بـ 010 أو 011 أو 012 أو 015.';
}
export const passwordProblem = (value: string): string => (value.length < 8 ? 'كلمة المرور يجب ألا تقل عن 8 أحرف.' : '');

// No look-alike characters (0/O, 1/l/I): it is read out over the phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
/** «Nq7-rb4K-2xm»: ten characters in three groups, always with a digit and a letter. */
export function generatePassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  for (;;) {
    const chars = [...random(10)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    if (/\d/.test(chars) && /[A-Za-z]/.test(chars)) return `${chars.slice(0, 3)}-${chars.slice(3, 7)}-${chars.slice(7)}`;
  }
}

// ── Supervisors and their lines ─────────────────────────────────────
export type SupervisorFilter = 'all' | 'on' | 'off' | 'nolines';
export type SupervisorSort = 'name' | 'newest';

/** supervisor → his lines, and line → its supervisors. */
export function assignmentMaps(assignments: readonly SupervisorLine[]) {
  const linesOf = new Map<string, string[]>();
  const supervisorsOf = new Map<string, string[]>();
  assignments.forEach(({ supervisor_id, line_id }) => {
    (linesOf.get(supervisor_id) ?? linesOf.set(supervisor_id, []).get(supervisor_id)!).push(line_id);
    (supervisorsOf.get(line_id) ?? supervisorsOf.set(line_id, []).get(line_id)!).push(supervisor_id);
  });
  return { linesOf, supervisorsOf };
}

const digitsOf = (s: string) => normalizePhone(s);
/** Part of a name, or of a phone typed in any script. */
export function matchesSearch(row: { full_name: string; phone?: string; email?: string }, search: string): boolean {
  const term = search.trim();
  if (!term) return true;
  if (row.full_name.includes(term)) return true;
  if (row.email && row.email.toLowerCase().includes(term.toLowerCase())) return true;
  const d = term.replace(/[٠-٩۰-۹]/g, (x) => String(EASTERN.indexOf(x) % 10)).replace(/\D/g, '');
  return !!d && !!row.phone && (row.phone.includes(d) || digitsOf(row.phone).includes(d.replace(/^0+/, '')));
}

export function supervisorCounts(rows: readonly SupervisorRow[], linesOf: Map<string, string[]>): Record<SupervisorFilter, number> {
  return {
    all: rows.length,
    on: rows.filter((r) => r.is_active).length,
    off: rows.filter((r) => !r.is_active).length,
    nolines: rows.filter((r) => !(linesOf.get(r.id)?.length)).length,
  };
}

export function filterSupervisors<T extends SupervisorRow & { created_at?: string }>(
  rows: readonly T[], linesOf: Map<string, string[]>, o: { search: string; filter: SupervisorFilter; sort: SupervisorSort },
): T[] {
  const kept = rows.filter((r) => matchesSearch(r, o.search) && (
    o.filter === 'all' || (o.filter === 'on' && r.is_active) || (o.filter === 'off' && !r.is_active)
    || (o.filter === 'nolines' && !(linesOf.get(r.id)?.length))));
  // Working first, then by name (or newest), so a stopped supervisor does not hide a working one.
  return [...kept].sort((a, b) => Number(b.is_active) - Number(a.is_active)
    || (o.sort === 'newest' ? (b.created_at ?? '').localeCompare(a.created_at ?? '') : a.full_name.localeCompare(b.full_name, 'ar')));
}

/** Running lines that no working supervisor covers: nobody records their riders. */
export function linesWithoutSupervisor(lines: readonly LineName[], supervisors: readonly SupervisorRow[], supervisorsOf: Map<string, string[]>): LineName[] {
  const working = new Set(supervisors.filter((s) => s.is_active).map((s) => s.id));
  return lines.filter((l) => l.is_active && !(supervisorsOf.get(l.id) ?? []).some((id) => working.has(id)));
}

export interface LineImpact { line: LineName; others: string[] }
/**
 * What stopping or deleting one supervisor does to each of his lines: the other
 * working supervisors who stay on it (none: the line is left without anyone).
 */
export function impactOn(supervisorId: string, lineIds: readonly string[], lines: readonly LineName[],
  supervisors: readonly SupervisorRow[], supervisorsOf: Map<string, string[]>): LineImpact[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const names = new Map(supervisors.filter((s) => s.is_active && s.id !== supervisorId).map((s) => [s.id, s.full_name]));
  return lineIds.flatMap((id) => {
    const line = byId.get(id);
    if (!line) return [];
    return [{ line, others: (supervisorsOf.get(id) ?? []).flatMap((sid) => (names.has(sid) ? [names.get(sid)!] : [])) }];
  });
}

/** The change a new set of lines makes: what was added and what was taken off. */
export function linesChange(before: readonly string[], after: readonly string[]) {
  const was = new Set(before); const now = new Set(after);
  return { added: after.filter((id) => !was.has(id)), removed: before.filter((id) => !now.has(id)) };
}

/** Which field a server message is about (the functions write their messages in Arabic). */
export function fieldOf(message: string): 'phone' | 'password' | 'lines' | 'name' | 'email' | 'company' | null {
  if (/الهاتف|الرقم/.test(message)) return 'phone';
  if (/كلمة المرور/.test(message)) return 'password';
  if (/البريد/.test(message)) return 'email';
  if (/خط/.test(message)) return 'lines';
  if (/الشركة/.test(message)) return 'company';
  if (/اسم/.test(message)) return 'name';
  return null;
}

/** A server function that is not deployed yet (or not answering at all). */
export const UNAVAILABLE = 'هذه الخدمة لم تُفعَّل بعد على الخادم. حاول لاحقاً، أو تواصل مع إدارة المنصة.';
export function isUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /تعذر الاتصال بوظيفة الخادم|has no handler|HTTP 404|Requested function was not found|NOT_FOUND/i.test(message);
}
/** Calls an edge function; a missing one becomes one plain sentence. */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await invokeEdgeFunction<T>(name, body);
  } catch (error) {
    if (typeof navigator !== 'undefined' && navigator.onLine !== false && isUnavailable(error)) throw new Error(UNAVAILABLE);
    throw error;
  }
}

// ── Supervisor requests ─────────────────────────────────────────────
export interface NewSupervisor { fullName: string; phone: string; password: string; companyId: string; lineIds: string[] }
export const createSupervisor = (s: NewSupervisor) =>
  callFunction<{ id: string; lineIds: string[] }>('admin-create-supervisor', { ...s, phone: normalizePhone(s.phone) });

export const deleteSupervisor = (supervisorId: string) => callFunction<{ deleted: boolean }>('admin-delete-supervisor', { supervisorId });

export const setSupervisorLines = async (supervisorId: string, lineIds: string[]) => {
  const { error } = await supabase.rpc('set_supervisor_lines', { p_supervisor_id: supervisorId, p_line_ids: lineIds });
  if (error) throw new Error(error.message);
};

export const setSupervisorActive = (supervisorId: string, isActive: boolean) =>
  unwrap<SupervisorRow>(supabase.from('supervisors').update({ is_active: isActive }).eq('id', supervisorId).select(SUPERVISOR_COLUMNS).single());

/**
 * A corrected name and/or phone. A name alone is a plain row update (allowed to
 * the company's admins today); a new phone also moves his sign-in, which only
 * the server function can do.
 */
export async function updateSupervisor(current: SupervisorRow, fullName: string, phone: string): Promise<SupervisorRow> {
  const name = fullName.trim().replace(/\s+/g, ' ');
  const number = normalizePhone(phone);
  if (number === current.phone) {
    return unwrap<SupervisorRow>(supabase.from('supervisors').update({ full_name: name }).eq('id', current.id).select(SUPERVISOR_COLUMNS).single());
  }
  const answer = await callFunction<{ supervisor: SupervisorRow }>('admin-update-supervisor', { supervisorId: current.id, fullName: name, phone: number });
  return answer.supervisor;
}

/** A new password for a supervisor who forgot his: typed by the admin, or made by the server. Returned once. */
export const resetSupervisorPassword = (supervisorId: string, password?: string) =>
  callFunction<{ password: string; generated: boolean }>('admin-reset-supervisor-password', { supervisorId, password: password || undefined });

/** How many boarding records a supervisor has scanned, and whether deleting him keeps them. */
export interface SupervisorRecords { scans: number; kept: boolean }
const recordsFallback = async (supervisorId: string): Promise<SupervisorRecords> => {
  // A database without the migration: the records are still deleted with him.
  const { count, error } = await supabase.from('supervisor_scan_events').select('id', { count: 'exact', head: true }).eq('supervisor_id', supervisorId);
  if (error) throw new Error(error.message);
  return { scans: count ?? 0, kept: false };
};
export const useSupervisorRecords = (companyId: string, supervisorId: string | null) =>
  usePageData(keys.company(companyId, 'supervisorRecords', { id: supervisorId }), async () => {
    const id = supervisorId as string;
    const answer = await rpcOr<{ scans: number; kept: boolean } | SupervisorRecords>('admin_supervisor_records',
      () => supabase.rpc('admin_supervisor_records', { p_supervisor_id: id }), () => recordsFallback(id));
    return { scans: Number(answer.scans) || 0, kept: !!answer.kept };
  }, { enabled: !!supervisorId, staleTime: 0 });

// ── Company admins ──────────────────────────────────────────────────
export interface CompanyAdmin {
  id: string; email: string; full_name: string; company_id: string | null; created_at: string;
  /** undefined: not known (older database); null: never signed in (an invitation not yet opened). */
  last_sign_in_at?: string | null;
}

/** One company's admins, oldest first (the list «مديرو الشركة»). */
export const useCompanyAdmins = (companyId: string) =>
  usePageData(keys.company(companyId, 'team'), () => unwrap<CompanyAdmin[]>(
    supabase.from('admins').select('id, email, full_name, company_id, created_at').eq('company_id', companyId).eq('role', 'company_admin').order('created_at')));

/** Every company admin, newest first, with whether each has signed in yet (platform admin). */
export const usePlatformAdmins = () =>
  usePageData(keys.platform('companyAdmins'), () => rpcOr<CompanyAdmin[]>('admin_list_company_admins',
    () => supabase.rpc('admin_list_company_admins', {}),
    () => unwrap<CompanyAdmin[]>(supabase.from('admins').select('id, email, full_name, company_id, created_at')
      .eq('role', 'company_admin').order('created_at', { ascending: false }))));

export type AdminSort = 'newest' | 'oldest' | 'name';
export function filterAdmins<T extends CompanyAdmin>(rows: readonly T[], o: { search: string; company: string; sort: AdminSort }, companyName: (id: string | null) => string = () => ''): T[] {
  const term = o.search.trim();
  const kept = rows.filter((r) => (!o.company || r.company_id === o.company)
    && (!term || matchesSearch(r, term) || companyName(r.company_id).includes(term)));
  return [...kept].sort((a, b) => (o.sort === 'name' ? a.full_name.localeCompare(b.full_name, 'ar')
    : o.sort === 'oldest' ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
}

/** The other admins of the same company, by name (who is left after one is removed). */
export const colleaguesOf = (admin: CompanyAdmin, all: readonly CompanyAdmin[]): CompanyAdmin[] =>
  all.filter((a) => a.company_id === admin.company_id && a.id !== admin.id);

/** «يبقى للشركة مدير واحد: أحمد سعيد النورس.» · «يبقى للشركة مديران.» · «يبقى للشركة 3 مديرين.» */
export function remainingText(left: readonly CompanyAdmin[]): string {
  if (left.length === 1) return `يبقى للشركة مدير واحد: ${left[0].full_name}.`;
  return `يبقى للشركة ${adminsCount(left.length)}.`;
}

export interface NewAdmin { companyId: string; fullName: string; email: string; password?: string }
export const createCompanyAdmin = (a: NewAdmin) =>
  callFunction<{ invited?: boolean; id?: string }>('admin-create-company-admin', {
    companyId: a.companyId, fullName: a.fullName.trim(), email: a.email.trim().toLowerCase(), password: a.password || undefined,
  });
export const deleteCompanyAdmin = (adminId: string) => callFunction<{ deleted: boolean }>('admin-delete-company-admin', { adminId });

export const emailProblem = (value: string): string =>
  (!value.trim() ? 'اكتب البريد الإلكتروني.' : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'اكتب بريداً إلكترونياً صحيحاً، مثل name@company.com.');
