/**
 * The platform admin's pages (docs/canvas/AdmPlat*): companies, a new company in
 * steps, universities and colleges, the platform defaults. The pure rules come
 * first (they are tested in platform.test.ts); the hooks that read the database
 * follow at the end.
 *
 * Three server functions come with migration 20261116000007_admin_platform
 * (platform_companies, platform_company_detail, platform_university_counts).
 * Until the database has them, each is answered the older way (lib/rpc.ts).
 */
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { keys, STALE, unwrap, usePageData } from './query';
import { rpcOr } from './rpc';
import { cairo, clock, countText, dayText, NOUN, num } from '../ui/format';

// =============================================================================
// Words
// =============================================================================

/** Arabic as people type it: one form for alef, yaa and taa marbuta, no tashkeel, no tatweel. */
export function foldArabic(text: string): string {
  return text.normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Whether every word of `query` is found in one of `fields`. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = foldArabic(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map((f) => foldArabic(f ?? '')).join(' ');
  return words.every((w) => hay.includes(w));
}

/** «أ وب وج»: after the first name, a leading «الفصل » is dropped («الفصل الثاني والصيفي»). */
export function joinNames(names: string[]): string {
  return names.map((n, i) => (i === 0 ? n : n.replace(/^الفصل\s+/, ''))).reduce((all, n, i) => (i === 0 ? n : `${all} و${n}`), '');
}

/** The adjective that agrees with a count: one, two, three or more («معروض / معروضان / معروضة»). */
export const agree = (n: number, forms: [string, string, string]) => (n === 1 ? forms[0] : n === 2 ? forms[1] : forms[2]);

// =============================================================================
// Companies
// =============================================================================

export type CompanyStatus = 'active' | 'suspended' | 'archived';
export interface PlatformCompany {
  id: string; name: string; status: CompanyStatus; created_at: string; status_changed_at: string | null;
  contact_phone: string | null; contact_label: string | null; logo_path?: string | null; emblem_path?: string | null;
  lines: number; active_lines: number; students: number; admins: number; supervisors: number;
  /** null: not known (a database without platform_companies). */
  payment_methods: number | null;
  selling: boolean | null;
}

export type CompanyFilter = 'current' | 'active' | 'suspended' | 'archived';
export type CompanySort = 'name' | 'newest' | 'students';

/** «الحالية» is every company that is not archived. */
export const inFilter = (c: Pick<PlatformCompany, 'status'>, f: CompanyFilter) => (f === 'current' ? c.status !== 'archived' : c.status === f);

export function companyCounts(rows: Pick<PlatformCompany, 'status'>[]): Record<CompanyFilter, number> {
  return {
    current: rows.filter((c) => c.status !== 'archived').length,
    active: rows.filter((c) => c.status === 'active').length,
    suspended: rows.filter((c) => c.status === 'suspended').length,
    archived: rows.filter((c) => c.status === 'archived').length,
  };
}

const collator = new Intl.Collator('ar');
export function listCompanies(rows: PlatformCompany[], o: { filter: CompanyFilter; search: string; sort: CompanySort }): PlatformCompany[] {
  const out = rows.filter((c) => inFilter(c, o.filter) && matches(o.search, c.name));
  const by: Record<CompanySort, (a: PlatformCompany, b: PlatformCompany) => number> = {
    name: (a, b) => collator.compare(a.name, b.name),
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    students: (a, b) => b.students - a.students || collator.compare(a.name, b.name),
  };
  return out.sort(by[o.sort]);
}

/** What happens to a company's people when its status changes, for the dialog that asks first. */
export function statusQuestion(to: CompanyStatus, c: Pick<PlatformCompany, 'name' | 'admins' | 'supervisors' | 'students' | 'active_lines'>): { title: string; body: string[]; confirm: string } {
  if (to === 'suspended') {
    const people = c.supervisors > 0
      ? `يفقد ${c.admins === 1 ? 'مديرها' : c.admins === 2 ? 'مديراها' : 'مديروها'} و${c.supervisors === 1 ? 'مشرفها' : 'مشرفوها'} ${c.admins + c.supervisors > 2 ? `الـ${num(c.admins + c.supervisors)} ` : ''}الدخول فوراً`
      : `يفقد ${c.admins === 1 ? 'مديرها' : c.admins === 2 ? 'مديراها' : 'مديروها'} الدخول فوراً`;
    return {
      title: `إيقاف «${c.name}»؟`,
      body: [
        `${people}، وتختفي الشركة من تطبيق ${c.students > 0 ? countText(c.students, NOUN.student) : 'طلابها'}: لا تأكيد ركوب ولا اشتراك جديد.`,
        'لا يُحذف شيء: الخطوط والاشتراكات والإيصالات تبقى، وتعود كما هي عند إعادة التشغيل.',
      ],
      confirm: 'أوقف الشركة',
    };
  }
  if (to === 'archived') {
    return {
      title: `أرشفة «${c.name}»؟`,
      body: ['تُخفى من قائمة الشركات الحالية ومن كل قوائم الاختيار، ويبقى العمل بها متوقفاً. تجدها بعد ذلك تحت «مؤرشفة».', 'لا يُحذف شيء، ويمكن إعادة تشغيلها في أي وقت.'],
      confirm: 'أرشف الشركة',
    };
  }
  const lines = c.active_lines > 0 ? `بخطوطها ${c.active_lines > 2 ? `الـ${num(c.active_lines)} ` : ''}` : 'بخطوطها ';
  return {
    title: `إعادة تشغيل «${c.name}»؟`,
    body: [`يعود ${c.admins === 1 ? 'مديرها' : 'مديروها'} و${c.supervisors === 1 ? 'مشرفها' : 'مشرفوها'} إلى الدخول، وتظهر للطلاب من جديد ${lines}واشتراكاتها كما كانت يوم الإيقاف.`],
    confirm: 'أعد تشغيل الشركة',
  };
}

// ── One company: can a student subscribe? ──────────────────────────────────
export type LineHidden = 'line_inactive' | 'no_stations' | 'no_departure' | 'unserved_university' | 'nothing_on_sale';
export interface CompanyDetail {
  company: { id: string; name: string; status: CompanyStatus; created_at: string; status_changed_at: string | null; contact_phone: string | null; contact_label: string | null };
  admins: { id: string; full_name: string; email: string }[];
  payment_methods: { method_type: string; display_name: string }[];
  supervisors: number;
  lines: { id: string; name: string; is_active: boolean; supervised: boolean; hidden: LineHidden | null; unserved_university: string | null }[];
  /** null: not known (a database without platform_company_detail). */
  sale: { option: string; name: string; on_sale: boolean }[] | null;
}

export const METHOD_NAME: Record<string, string> = { instapay: 'إنستاباي', vodafone_cash: 'محفظة هاتف', bank: 'حساب بنكي' };

const HIDDEN_WHY: Record<LineHidden, (u: string | null) => string> = {
  line_inactive: () => 'متوقف',
  no_stations: () => 'تنقصه المحطات',
  no_departure: () => 'تنقصه رحلة ذهاب',
  unserved_university: (u) => `تنقصه رحلة ذهاب إلى ${u ?? 'إحدى جامعاته'}`,
  nothing_on_sale: () => 'لا شيء معروض للبيع عليه',
};

export interface ReadyItem { key: string; ok: boolean; title: string; sub?: string }

/** «هل يستطيع طالب أن يشترك؟» in four lines: lines, payment, what is on sale, supervisors. */
export function readiness(d: CompanyDetail): ReadyItem[] {
  const items: ReadyItem[] = [];
  const total = d.lines.length;
  const active = d.lines.filter((l) => l.is_active);
  const hidden = active.filter((l) => l.hidden);
  if (total === 0) {
    items.push({ key: 'lines', ok: false, title: 'لا خطوط بعد', sub: 'بلا خط لا يرى الطلاب الشركة.' });
  } else {
    const n = active.length;
    const title = n === 0 ? `لا خط يعمل من ${num(total)}`
      : `${n === 1 ? 'خط واحد' : countText(n, NOUN.line)} ${agree(n, ['يعمل', 'يعملان', 'تعمل'])} من ${num(total)}`;
    const first = hidden[0];
    const sub = first ? `خط «${first.name}» لا يظهر للطلاب: ${HIDDEN_WHY[first.hidden!](first.unserved_university)}${hidden.length > 1 ? ` · و${countText(hidden.length - 1, NOUN.line)} غيره` : ''}` : undefined;
    items.push({ key: 'lines', ok: n > 0 && hidden.length < n, title, sub });
  }
  const pm = d.payment_methods.length;
  items.push(pm === 0
    ? { key: 'pay', ok: false, title: 'لا وسيلة دفع', sub: 'لا يستطيع أي طالب أن يدفع لهذه الشركة.' }
    : {
      key: 'pay', ok: true,
      title: pm === 1 ? 'وسيلة دفع تعمل' : pm === 2 ? 'وسيلتا دفع تعملان' : `${num(pm)} وسائل دفع تعمل`,
      sub: [...new Set(d.payment_methods.map((m) => METHOD_NAME[m.method_type] ?? m.display_name))].join(' · '),
    });
  if (d.sale) {
    const on = d.sale.filter((s) => s.on_sale).map((s) => s.name);
    const off = d.sale.filter((s) => !s.on_sale).map((s) => s.name);
    items.push(on.length === 0
      ? { key: 'sale', ok: false, title: 'لا شيء معروض للبيع', sub: off.length ? `${joinNames(off)} ${agree(off.length, ['موقوف', 'موقوفان', 'موقوفة'])} عن البيع` : undefined }
      : { key: 'sale', ok: true, title: `${joinNames(on)} ${agree(on.length, ['معروض', 'معروضان', 'معروضة'])} للبيع`, sub: off.length ? `${joinNames(off)} ${agree(off.length, ['موقوف', 'موقوفان', 'موقوفة'])} عن البيع` : undefined });
  }
  const unsupervised = active.filter((l) => !l.supervised);
  const s = d.supervisors;
  items.push({
    key: 'sup', ok: s > 0,
    title: s === 0 ? 'لا مشرفين' : s === 1 ? 'مشرف واحد' : countText(s, NOUN.supervisor),
    sub: unsupervised.length === 0 ? (s === 0 && total > 0 ? 'لا أحد يسجّل الركاب عند الصعود.' : undefined)
      : unsupervised.length === 1 ? `خط «${unsupervised[0].name}» بلا مشرف`
        : `${countText(unsupervised.length, NOUN.line)} بلا مشرف: ${unsupervised.slice(0, 3).map((l) => `«${l.name}»`).join('، ')}${unsupervised.length > 3 ? '…' : ''}`,
  });
  return items;
}

// =============================================================================
// A new company, in steps
// =============================================================================

export type MethodType = 'later' | 'instapay' | 'vodafone_cash' | 'bank';
export interface CompanyDraft {
  name: string; contactPhone: string; contactLabel: string;
  adminName: string; adminEmail: string; passwordMode: 'invite' | 'password'; password: string;
  method: MethodType; displayName: string; accountHolder: string; instapayAddress: string; walletPhone: string;
  bankName: string; bankAccount: string; iban: string;
}
export const emptyCompanyDraft = (): CompanyDraft => ({
  name: '', contactPhone: '', contactLabel: '', adminName: '', adminEmail: '', passwordMode: 'invite', password: '',
  method: 'later', displayName: '', accountHolder: '', instapayAddress: '', walletPhone: '', bankName: '', bankAccount: '', iban: '',
});
export type DraftField = keyof CompanyDraft;
export type Errors = Partial<Record<DraftField, string>>;

/** Arabic digits to Western, everything but digits dropped. */
export const digitsOf = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What is wrong with one step (0–2), field by field, in plain Arabic. Nothing is checked twice. */
export function stepErrors(step: number, d: CompanyDraft): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (d.name.trim().length < 2) e.name = 'اكتب اسم الشركة كاملاً (حرفان على الأقل).';
    const phone = digitsOf(d.contactPhone);
    if (d.contactPhone.trim() && !/^0\d{8,10}$/.test(phone)) e.contactPhone = 'اكتب رقماً صحيحاً يبدأ بـ 0، مثل 010 4471 2256.';
  }
  if (step === 1) {
    if (d.adminName.trim().split(/\s+/).filter(Boolean).length < 2) e.adminName = 'اكتب اسم مدير الشركة: الاسم الأول واسم العائلة على الأقل.';
    if (!EMAIL.test(d.adminEmail.trim())) e.adminEmail = 'اكتب البريد الإلكتروني كاملاً، وفيه @ ونقطة.';
    if (d.passwordMode === 'password' && d.password.length < 8) e.password = 'اكتب 8 أحرف على الأقل.';
  }
  if (step === 2 && d.method !== 'later') {
    if (!d.displayName.trim()) e.displayName = 'اكتب الاسم الذي يراه الطالب عند الدفع.';
    if (d.method === 'instapay' && !d.instapayAddress.trim()) e.instapayAddress = 'اكتب عنوان إنستاباي.';
    if (d.method === 'vodafone_cash') {
      const w = digitsOf(d.walletPhone);
      if (!/^01\d{9}$/.test(w)) e.walletPhone = w.length > 0 && w.length < 11 ? 'الرقم ناقص. اكتب 11 رقماً تبدأ بـ 01.' : 'اكتب 11 رقماً تبدأ بـ 01.';
    }
    if (d.method === 'bank') {
      if (!d.bankName.trim()) e.bankName = 'اكتب اسم البنك.';
      if (!digitsOf(d.bankAccount)) e.bankAccount = 'اكتب رقم الحساب.';
    }
  }
  return e;
}

/** The first step that still has something to fix, or -1. */
export function firstBadStep(d: CompanyDraft): number {
  for (let s = 0; s < 3; s += 1) if (Object.keys(stepErrors(s, d)).length) return s;
  return -1;
}

/** Anything typed (closing then asks first). */
export const draftTouched = (d: CompanyDraft) => (Object.keys(d) as DraftField[])
  .some((k) => k !== 'passwordMode' && k !== 'method' && String(d[k]).trim() !== '') || d.method !== 'later';

/** What admin-create-company is called with. */
export function createPayload(d: CompanyDraft) {
  return {
    name: d.name.trim(),
    contactPhone: digitsOf(d.contactPhone) || null,
    contactLabel: d.contactLabel.trim() || null,
    admin: { fullName: d.adminName.trim().replace(/\s+/g, ' '), email: d.adminEmail.trim().toLowerCase(), password: d.passwordMode === 'password' ? d.password : '' },
    paymentMethod: d.method === 'later' ? null : {
      methodType: d.method, displayName: d.displayName.trim(), accountHolder: d.accountHolder.trim(),
      instapayAddress: d.method === 'instapay' ? d.instapayAddress.trim() : '',
      walletPhone: d.method === 'vodafone_cash' ? digitsOf(d.walletPhone) : '',
      bankName: d.method === 'bank' ? d.bankName.trim() : '',
      bankAccountNumber: d.method === 'bank' ? d.bankAccount.replace(/\s+/g, '') : '',
      iban: d.method === 'bank' ? d.iban.replace(/\s+/g, '').toUpperCase() : '',
    },
  };
}

/**
 * Where a refusal of admin-create-company belongs: the step and field to fix,
 * and a sentence that says it. Nothing was created in any of these cases.
 */
export function createFailure(message: string, d: CompanyDraft, online = true): { step: number | null; field?: DraftField; text: string; action?: string } {
  const m = message || '';
  if (!online || /fetch|network|تعذر الاتصال|Failed/i.test(m)) return { step: null, text: 'انقطع الاتصال قبل أن يكتمل الإنشاء. لم يُحفظ شيء؛ ما كتبته ما زال هنا.' };
  if (/الدعوة/.test(m)) return { step: 1, field: 'passwordMode', text: 'تعذّر إرسال الدعوة بالبريد الآن، فلم يُنشأ شيء. اختر «أكتب كلمة مرور مبدئية الآن» أو حاول بعد قليل.', action: 'غيّر طريقة الدخول' };
  if (/البريد|email/i.test(m)) return { step: 1, field: 'adminEmail', text: `البريد ${d.adminEmail.trim()} مستعمل لحساب آخر. غيّره في خطوة «مدير الشركة» ثم حاول مرة أخرى.`, action: 'عدّل البريد' };
  if (/شركة بهذا الاسم/.test(m)) return { step: 0, field: 'name', text: `توجد شركة باسم «${d.name.trim()}». اختر اسماً آخر في خطوة «بيانات الشركة».`, action: 'عدّل الاسم' };
  if (/وسيلة الدفع/.test(m)) return { step: 2, text: 'بيانات وسيلة الدفع غير مكتملة. راجعها في خطوة «وسيلة الدفع».', action: 'عدّل وسيلة الدفع' };
  if (/كلمة المرور/.test(m)) return { step: 1, field: 'password', text: 'كلمة المرور المبدئية قصيرة. اكتب 8 أحرف على الأقل.', action: 'عدّل كلمة المرور' };
  if (/الجلسة|جلسة/.test(m)) return { step: null, text: 'انتهت جلسة الدخول. حدّث الصفحة وسجّل الدخول، ثم أعد المحاولة.' };
  return { step: null, text: 'لم يكتمل الإنشاء ولم يُحفظ شيء. حاول مرة أخرى بعد قليل.' };
}

/** «010 4471 2256» as it is typed or stored. */
export function phoneGroups(phone: string | null | undefined): string {
  const d = digitsOf(phone ?? '');
  if (/^01\d{9}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  return phone ?? '';
}

// =============================================================================
// Universities and colleges
// =============================================================================

export interface UniversityRow { id: string; name: string; city: string; is_active: boolean }
export interface CollegeRow { id: string; university_id: string; name: string; is_active: boolean }
export interface UniversityCounts {
  universities: { id: string; students: number; lines: number; companies: { id: string; name: string }[] }[];
  colleges: { university_id: string; college: string; students: number }[];
}
export type UniversityFilter = 'all' | 'shown' | 'hidden';

/** A name as it is compared: two that differ only in spelling forms or spaces are the same name. */
export const sameName = (a: string, b: string) => foldArabic(a) === foldArabic(b);

export function universityProblem(name: string, city: string, all: UniversityRow[], selfId?: string): { name?: string; city?: string } {
  const out: { name?: string; city?: string } = {};
  if (name.trim().length < 3) out.name = 'اكتب اسم الجامعة كما يعرفه الطلاب.';
  else if (all.some((u) => u.id !== selfId && sameName(u.name, name))) out.name = 'توجد جامعة بهذا الاسم. افتحها بدل إضافتها مرة أخرى.';
  if (city.trim().length < 2) out.city = 'اكتب المدينة التي فيها الجامعة.';
  return out;
}

export function collegeProblem(name: string, colleges: CollegeRow[], universityId: string): string | null {
  if (name.trim().length < 2) return 'اكتب اسم الكلية.';
  if (colleges.some((c) => c.university_id === universityId && sameName(c.name, name))) return 'هذه الكلية موجودة في هذه الجامعة.';
  return null;
}

/** Students of one college, matched by name (the student's college is stored as text). */
export function collegeStudents(counts: UniversityCounts | undefined, universityId: string, college: string): number | null {
  if (!counts) return null;
  return counts.colleges.filter((c) => c.university_id === universityId && sameName(c.college, college)).reduce((a, c) => a + c.students, 0);
}

// =============================================================================
// Platform defaults
// =============================================================================

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** Days in a month of the calendar the terms repeat on (February: 28, since it comes back every year). */
export const daysIn = (month: number) => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;

export function dayProblem(day: number | '', month: number): string | null {
  if (day === '' || !Number.isInteger(day) || day < 1) return 'اكتب اليوم بالأرقام.';
  if (day > daysIn(month)) return `${MONTHS[month - 1]} ليس فيه يوم ${day}. اكتب يوماً من 1 إلى ${daysIn(month)}.`;
  return null;
}

// =============================================================================
// Reading
// =============================================================================

/** The list's key lives under the platform overview, so the platform's live topic refreshes it with the totals. */
export const companiesKey = keys.platform('overview', 'companies');
export const companyDetailKey = (id: string) => keys.platform('overview', 'companyDetail', id);

interface OverviewRow { company: { id: string; name: string; status: CompanyStatus; created_at: string; logo_path?: string | null; emblem_path?: string | null }; members: number; lines: number; active_lines: number; supervisors: number; admins: number }

/** Every company with what the list shows; one request when the database has platform_companies. */
async function loadCompanies(): Promise<PlatformCompany[]> {
  return rpcOr<PlatformCompany[]>('platform_companies', () => supabase.rpc('platform_companies'), async () => {
    const [overview, rows, methods] = await Promise.all([
      unwrap<{ per_company: OverviewRow[] }>(supabase.rpc('platform_overview')),
      unwrap<{ id: string; contact_phone: string | null; contact_label: string | null }[]>(supabase.from('companies').select('id, contact_phone, contact_label')),
      unwrap<{ company_id: string }[]>(supabase.from('company_payment_methods').select('company_id').eq('is_active', true)),
    ]);
    return overview.per_company.map((r) => {
      const row = rows.find((x) => x.id === r.company.id);
      return {
        ...r.company, status_changed_at: null, contact_phone: row?.contact_phone ?? null, contact_label: row?.contact_label ?? null,
        lines: r.lines, active_lines: r.active_lines, students: r.members, admins: r.admins, supervisors: r.supervisors,
        payment_methods: methods.filter((m) => m.company_id === r.company.id).length, selling: null,
      };
    });
  });
}
export const usePlatformCompanyList = () => usePageData(companiesKey, loadCompanies);

interface FallbackLine { id: string; name: string; is_active: boolean; stations: { is_active: boolean }[]; line_trips: { direction: string; is_active: boolean }[] }
async function loadDetail(id: string): Promise<CompanyDetail> {
  return rpcOr<CompanyDetail>('platform_company_detail', () => supabase.rpc('platform_company_detail', { p_company_id: id }), async () => {
    const [company, admins, methods, lines, supervisors, assigned] = await Promise.all([
      unwrap<CompanyDetail['company']>(supabase.from('companies').select('id, name, status, created_at, contact_phone, contact_label').eq('id', id).single()),
      unwrap<CompanyDetail['admins']>(supabase.from('admins').select('id, full_name, email').eq('company_id', id).order('created_at')),
      unwrap<CompanyDetail['payment_methods']>(supabase.from('company_payment_methods').select('method_type, display_name').eq('company_id', id).eq('is_active', true)),
      unwrap<FallbackLine[]>(supabase.from('lines').select('id, name, is_active, stations(is_active), line_trips(direction, is_active)').eq('company_id', id).order('name') as never),
      unwrap<{ id: string }[]>(supabase.from('supervisors').select('id').eq('company_id', id).eq('is_active', true)),
      unwrap<{ line_id: string; supervisor_id: string }[]>(supabase.from('supervisor_lines').select('line_id, supervisor_id').eq('company_id', id)),
    ]);
    const activeSup = new Set(supervisors.map((s) => s.id));
    return {
      company: { ...company, status_changed_at: null }, admins, payment_methods: methods, supervisors: supervisors.length, sale: null,
      lines: lines.map((l) => ({
        id: l.id, name: l.name, is_active: l.is_active, unserved_university: null,
        supervised: assigned.some((a) => a.line_id === l.id && activeSup.has(a.supervisor_id)),
        hidden: !l.is_active ? 'line_inactive' : !(l.stations ?? []).some((s) => s.is_active) ? 'no_stations'
          : !(l.line_trips ?? []).some((t) => t.direction === 'departure' && t.is_active) ? 'no_departure' : null,
      })),
    };
  });
}
export const useCompanyDetail = (id: string | null) => usePageData(companyDetailKey(id ?? ''), () => loadDetail(id!), { enabled: !!id });

export const collegesKey = keys.platform('colleges');
export const universityCountsKey = keys.platform('universityCounts');
export const useColleges = () => usePageData(collegesKey, () => unwrap<CollegeRow[]>(supabase.from('colleges').select('id, university_id, name, is_active').order('name')), { staleTime: STALE.reference });
/** Counted by the server; when it fails (or the function is not there yet) the pages show a dash. */
export const useUniversityCounts = () => usePageData(universityCountsKey,
  () => rpcOr<UniversityCounts | null>('platform_university_counts', () => supabase.rpc('platform_university_counts'), async () => null),
  { staleTime: STALE.reference });

/** The companies' own settings the defaults page counts («19 شركة من 26 تتبع المنصة»). */
export interface CompanySwitchRow { id: string; status: CompanyStatus; vote_closes_at: string | null; annual_subscription_enabled: boolean | null; daily_subscription_enabled: boolean | null }
export const useCompanySwitches = () => usePageData(keys.platform('companyNames', 'switches'),
  () => unwrap<CompanySwitchRow[]>(supabase.from('companies').select('id, status, vote_closes_at, annual_subscription_enabled, daily_subscription_enabled')));

export function followers(rows: CompanySwitchRow[]) {
  const working = rows.filter((r) => r.status === 'active');
  return {
    working: working.length,
    followVote: working.filter((r) => r.vote_closes_at == null).length,
    annual: working.filter((r) => r.annual_subscription_enabled !== false).length,
    daily: working.filter((r) => r.daily_subscription_enabled !== false).length,
  };
}

/** A term as the defaults store it (academic_terms). */
export interface TermRow {
  code: 'first' | 'second' | 'summer'; name: string; sort_order: number;
  start_month: number; start_day: number; end_month: number; end_day: number; is_on_sale: boolean;
}
/** «الفصل الأول» → «الأول», for a list of terms in one line. */
export const shortTerm = (name: string) => name.replace(/^الفصل\s+(الدراسي\s+)?/, '');
/** «الأول 20 سبتمبر – 15 يناير · الثاني …». */
export const termsLine = (terms: TermRow[]) => terms.map((t) => `${shortTerm(t.name)} ${t.start_day} ${MONTHS[t.start_month - 1]} – ${t.end_day} ${MONTHS[t.end_month - 1]}`).join(' · ');
/** «الفصل الأول والثاني معروضان · الصيفي موقوف حتى يفتحه المدير». */
export function saleLine(terms: TermRow[]): string {
  const on = terms.filter((t) => t.is_on_sale).map((t) => t.name);
  const off = terms.filter((t) => !t.is_on_sale).map((t) => shortTerm(t.name));
  const a = on.length ? `${joinNames(on)} ${agree(on.length, ['معروض', 'معروضان', 'معروضة'])}` : 'لا فصل معروض';
  return off.length ? `${a} · ${off.join(' و')} ${agree(off.length, ['موقوف', 'موقوفان', 'موقوفة'])} حتى يفتحه المدير` : a;
}

const phoneQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 639px)') : null;
/** Below 640: the phone layout (a few words differ from the board's desktop form). */
export const useIsPhone = () => useSyncExternalStore(
  (cb) => { phoneQuery?.addEventListener('change', cb); return () => phoneQuery?.removeEventListener('change', cb); },
  () => !!phoneQuery?.matches, () => false);


// =============================================================================
// Platform notifications
// =============================================================================

/** The fields of a notification row the platform's list groups by (lib/notifications.ts · HistoryRow). */
export interface NoteRow {
  id: string; type: string | null; title: string; body: string; status: 'scheduled' | 'sent' | 'cancelled' | 'failed'; created_at: string;
  scheduled_at: string | null; sent_at: string | null; students: number; read: number; opened: number; priority: string | null;
  company_id?: string; company_name?: string | null; sender_name: string | null; sender_role: string; audience: string | null;
  push: { devices: number; queued: number; accepted: number; failed: number; skipped: number } | null;
}
export interface NoteGroup<R extends NoteRow = NoteRow> { key: string; rows: R[]; platform: boolean; first: R; students: number; read: number; opened: number }

/**
 * One platform announcement is stored once per company it reached; the list shows
 * it once («المنصة · 26 شركة»). Rows of the same announcement: platform type, same
 * title, body and status, written within two minutes of each other.
 */
export function groupNotes<R extends NoteRow>(rows: R[]): NoteGroup<R>[] {
  const out: NoteGroup<R>[] = [];
  for (const r of rows) {
    const platform = r.type === 'announcement.platform';
    const g = platform ? out.find((x) => x.platform && x.first.title === r.title && x.first.body === r.body && x.first.status === r.status
      && Math.abs(new Date(x.first.created_at).getTime() - new Date(r.created_at).getTime()) < 120_000) : undefined;
    if (g) { g.rows.push(r); g.students += r.students; g.read += r.read; g.opened += r.opened; }
    else out.push({ key: r.id, rows: [r], platform, first: r, students: r.students, read: r.read, opened: r.opened });
  }
  return out;
}

/** When a notification goes or went out: «اليوم 6:40 ص», «أمس 8:12 م», «غداً 9:00 ص», «5 أكتوبر 6:00 م». */
export function whenText(iso: string, now: Date = new Date()): string {
  const c = cairo(iso); const today = cairo(now).day;
  const shift = (n: number) => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const name = c.day === today ? 'اليوم' : c.day === shift(-1) ? 'أمس' : c.day === shift(1) ? 'غداً' : dayText(c.day, { year: c.day.slice(0, 4) !== today.slice(0, 4) });
  return `${name} ${clock(c.time)}`;
}
