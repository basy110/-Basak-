/**
 * Name and university corrections (table `student_correction_requests`). A
 * company proposes one for its own member (request_student_correction); the
 * platform admin approves it, which changes the account for every company, or
 * refuses it with a reason the company sees (decide_student_correction).
 */
import { supabase } from './supabase';
import { rpcOr } from './rpc';
import { unwrap } from './query';

export type CorrectionField = 'full_name' | 'university';
export const FIELD_LABEL: Record<CorrectionField, string> = { full_name: 'الاسم', university: 'الجامعة' };

/** A company's request as its «طلبات تصحيح الاسم» tab lists it. */
export interface CompanyCorrection {
  id: string; student_id: string; field: CorrectionField; old_value: string | null; new_value: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string; decision_note: string | null;
}

/** The last 10 requests of the company, newest first. */
export const loadCompanyCorrections = (companyId: string) => unwrap<CompanyCorrection[]>(
  supabase.from('student_correction_requests').select('id, student_id, field, old_value, new_value, status, created_at, decision_note')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(10));

/**
 * What is wrong with a proposed value, in the dialog's words; null when it can be
 * sent. The server checks the same (four names; a university from the list).
 */
export function correctionProblem(field: CorrectionField, current: string | null | undefined, value: string): string | null {
  const next = value.trim().replace(/\s+/g, ' ');
  if (!next) return field === 'full_name' ? 'اكتب الاسم الصحيح.' : 'اختر الجامعة الصحيحة.';
  if (next === (current ?? '').trim().replace(/\s+/g, ' ')) return field === 'full_name' ? 'اكتب اسماً مختلفاً عن الاسم الحالي.' : 'اختر جامعة مختلفة عن الحالية.';
  if (field === 'full_name' && next.split(' ').length < 4) return 'اكتب الاسم الرباعي كاملاً.';
  return null;
}

/** Sends the request; answers its id. */
export async function requestCorrection(companyId: string, studentId: string, field: CorrectionField, value: string, note?: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('request_student_correction', {
    p_company_id: companyId, p_student_id: studentId, p_field: field, p_new_value: value.trim().replace(/\s+/g, ' '), p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

// ── The platform's queue (AdmPlatCorrections) ──────────────────────────

export interface PlatformCorrection {
  id: string; student_id: string; company_id: string; field: CorrectionField;
  old_value: string | null; new_value: string; note: string | null; status: string; created_at: string;
  company: string | null; requested_by_name: string | null;
  student_name: string | null; student_phone: string | null;
  /** The companies the student belongs to now (the change reaches all of them). Null from an older database. */
  student_companies: string[] | null; active_subscriptions: number | null;
}

type Row = Record<string, any>;
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/** Waiting requests, oldest first, in one request (platform_correction_requests); the table read on an older database. */
export async function loadPlatformCorrections(): Promise<PlatformCorrection[]> {
  return rpcOr<PlatformCorrection[]>('platform_correction_requests',
    () => supabase.rpc('platform_correction_requests', { p_status: 'pending', p_limit: 200 }),
    async () => {
      const rows = await unwrap<Row[]>(supabase.from('student_correction_requests')
        .select('id, student_id, company_id, field, old_value, new_value, note, status, created_at, companies(name), students(full_name, phone)')
        .eq('status', 'pending').order('created_at') as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>);
      return rows.map((r) => ({
        id: r.id, student_id: r.student_id, company_id: r.company_id, field: r.field, old_value: r.old_value, new_value: r.new_value,
        note: r.note ?? null, status: r.status, created_at: r.created_at, company: one<Row>(r.companies)?.name ?? null,
        requested_by_name: null, student_name: one<Row>(r.students)?.full_name ?? null, student_phone: one<Row>(r.students)?.phone ?? null,
        student_companies: null, active_subscriptions: null,
      }));
    });
}

/** Approve, or refuse with a reason the company reads. */
export async function decideCorrection(id: string, approve: boolean, note?: string): Promise<void> {
  const { error } = await supabase.rpc('decide_student_correction', { p_request_id: id, p_approve: approve, p_note: note?.trim() || null });
  if (error) throw new Error(error.message);
}

/** The queue filtered by the search box: the student's name or phone, or the company. */
export function matchCorrection(row: Pick<PlatformCorrection, 'student_name' | 'student_phone' | 'company' | 'old_value' | 'new_value'>, search: string): boolean {
  const term = search.trim();
  if (!term) return true;
  const digits = term.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
  return [row.student_name, row.company, row.old_value, row.new_value].some((v) => (v ?? '').includes(term))
    || (digits.length >= 3 && (row.student_phone ?? '').includes(digits));
}
