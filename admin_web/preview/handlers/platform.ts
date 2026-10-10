/**
 * The platform admin's pages (docs/canvas/AdmPlat*): companies, a new company,
 * universities and colleges, the defaults, app versions, platform notifications.
 * Answers the functions of supabase/migrations/20261116000007_admin_platform.sql
 * and the older ones these pages call, from the sample rows plus the companies
 * and universities the boards show (added here, signed in as the platform admin).
 */
import { registerFunctions, registerRpc, rpcs } from '../registry';
import { ADMINS, COMPANY_ID, COMPANY2_ID, tables } from '../data';

type Row = Record<string, any>;
const params = new URLSearchParams(location.search);
const as = params.get('as') ?? sessionStorage.getItem('preview.as') ?? 'company';
const state = () => sessionStorage.getItem('preview.state') || params.get('state') || '';
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const fail = (message: string): never => { throw new Error(message); };
const uid = (n: number) => `c0aa0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── The companies of AdmPlatCompanies ─────────────────────────────────────────
// name, created days ago, students, lines active/total, admins, payment methods, selling, status
const MORE: [string, number, number, number, number, number, number, boolean, string][] = [
  ['الصفوة للرحلات', 0, 0, 1, 1, 1, 0, false, 'active'], ['باصات النيل', 625, 50, 2, 2, 3, 2, true, 'active'],
  ['الفيروز لنقل الطلاب', 645, 400, 1, 2, 2, 3, true, 'active'], ['أبناء الدقهلية للنقل الجماعي', 637, 322, 1, 2, 3, 1, true, 'active'],
  ['السلام ترافل', 380, 140, 2, 2, 2, 3, true, 'active'], ['المدينة للرحلات الجامعية', 649, 417, 1, 2, 1, 3, false, 'active'],
  ['الأمانة لنقل الطلاب', 645, 586, 1, 2, 2, 1, true, 'active'], ['رحلات الشروق', 649, 353, 2, 2, 1, 3, true, 'active'],
  ['الهدى للنقل', 645, 561, 1, 2, 2, 2, false, 'suspended'], ['خطوط الدلتا', 645, 619, 2, 2, 1, 2, true, 'active'],
  ['الريان باص', 400, 335, 1, 2, 2, 2, true, 'active'], ['النخبة للنقل الجامعي', 142, 342, 2, 2, 1, 0, true, 'active'],
  ['المنارة ترانس', 27, 70, 1, 2, 1, 2, true, 'active'], ['الوفاء لنقل الطلاب', 262, 379, 1, 2, 1, 3, true, 'active'],
  ['البدر للرحلات', 23, 318, 1, 2, 1, 1, true, 'active'], ['أولاد الحاج سعيد للنقل', 154, 179, 1, 2, 2, 3, true, 'active'],
  ['الياسمين باص', 6, 0, 0, 0, 1, 0, false, 'active'], ['القمة للنقل', 266, 553, 1, 2, 2, 2, true, 'active'],
  ['الأصدقاء للرحلات', 19, 365, 1, 2, 1, 1, true, 'active'], ['طيبة لنقل الطلاب', 262, 215, 1, 2, 3, 2, true, 'active'],
  ['الرحاب ترانس', 282, 258, 1, 2, 3, 2, true, 'active'], ['النجمة الذهبية للنقل', 258, 143, 1, 2, 1, 2, false, 'suspended'],
  ['المستقبل باص', 39, 491, 1, 2, 3, 2, true, 'active'], ['الإخلاص للرحلات الجامعية', 282, 193, 1, 2, 2, 2, true, 'active'],
  ['دمياط الجديدة للنقل الجماعي', 300, 288, 2, 3, 2, 2, true, 'active'],
  ['الشروق القديمة', 900, 0, 0, 2, 1, 1, false, 'archived'], ['النصر للنقل', 800, 0, 0, 1, 1, 0, false, 'archived'], ['ركاب الجامعة', 700, 0, 0, 1, 1, 1, false, 'archived'],
];
const STATS: Record<string, Row> = {
  [COMPANY_ID]: { students: 806, lines: 8, active_lines: 7, admins: 2, payment_methods: 2, selling: true, supervisors: 4 },
  [COMPANY2_ID]: { students: 212, lines: 3, active_lines: 3, admins: 1, payment_methods: 1, selling: true, supervisors: 2 },
};
if (as === 'platform' && !tables.companies.some((c) => c.id === uid(1))) {
  tables.companies[0].created_at = '2025-01-25T08:00:00Z';
  MORE.forEach(([name, ago, students, active, lines, admins, pm, selling, status], i) => {
    const id = uid(i + 1);
    tables.companies.push({ id, name, status, is_active: status === 'active', created_at: daysAgo(ago), status_changed_at: status === 'suspended' ? '2026-10-02T09:00:00Z' : null,
      contact_phone: `010${String(44712256 + i * 9173).slice(0, 8)}`, contact_label: i % 3 ? null : 'خدمة العملاء', address: null, logo_path: null, emblem_path: null,
      annual_subscription_enabled: i % 4 !== 1, daily_subscription_enabled: i % 3 === 0, advance_subscription_enabled: false,
      vote_opens_at: i % 4 === 0 ? '15:00:00' : null, vote_closes_at: i % 4 === 0 ? '05:30:00' : null });
    STATS[id] = { students, lines, active_lines: active, admins, payment_methods: pm, selling, supervisors: Math.max(0, lines) };
  });
}

const companyRow = (c: Row) => {
  const s = STATS[c.id] ?? { students: 0, lines: 0, active_lines: 0, admins: 0, payment_methods: 0, selling: false, supervisors: 0 };
  return {
    id: c.id, name: c.name, status: c.status, created_at: c.created_at, status_changed_at: c.status_changed_at ?? null,
    contact_phone: c.contact_phone ?? null, contact_label: c.contact_label ?? null, logo_path: c.logo_path ?? null, emblem_path: c.emblem_path ?? null,
    lines: s.lines, active_lines: s.active_lines, students: s.students, supervisors: s.supervisors,
    admins: tables.admins.filter((a) => a.company_id === c.id).length || s.admins,
    payment_methods: c.id === COMPANY_ID ? tables.company_payment_methods.filter((m) => m.company_id === c.id && m.is_active).length : s.payment_methods,
    selling: c.status === 'active' && s.selling,
  };
};

function detail(id: string) {
  const c = tables.companies.find((x) => x.id === id) ?? fail('الشركة غير موجودة.');
  const s = companyRow(c);
  const admins = tables.admins.filter((a) => a.company_id === id).map((a) => ({ id: a.id, full_name: a.full_name, email: a.email }));
  const nawras = id === COMPANY_ID;
  const lines = nawras
    ? tables.lines.filter((l) => l.company_id === id).map((l, i) => ({
      id: l.id, name: l.name, is_active: l.is_active || i === 7, supervised: tables.supervisor_lines.some((x) => x.line_id === l.id),
      hidden: i === 7 ? 'no_departure' : null, unserved_university: null }))
    : Array.from({ length: s.lines }, (_, i) => ({ id: `${id}-l${i}`, name: ['الخط الأول', 'الخط الثاني', 'الخط الثالث'][i], is_active: i < s.active_lines, supervised: i > 0, hidden: i < s.active_lines ? null : 'line_inactive', unserved_university: null }));
  return {
    company: { id: c.id, name: c.name, status: c.status, created_at: c.created_at, status_changed_at: c.status_changed_at ?? null, contact_phone: c.contact_phone, contact_label: nawras ? 'خدمة العملاء' : c.contact_label },
    admins: admins.length ? admins : [{ id: `${id}-a`, full_name: 'مدير الشركة', email: 'owner@company.example' }],
    payment_methods: nawras
      ? tables.company_payment_methods.filter((m) => m.company_id === id && m.is_active).map((m) => ({ method_type: m.type === 'wallet' ? 'vodafone_cash' : m.type, display_name: m.display_name }))
      : Array.from({ length: s.payment_methods }, (_, i) => ({ method_type: ['instapay', 'vodafone_cash', 'bank'][i % 3], display_name: 'حساب الشركة' })),
    supervisors: s.supervisors,
    lines,
    sale: [
      { option: 'first', name: 'الفصل الأول', on_sale: s.selling }, { option: 'both', name: 'الفصلان معاً', on_sale: s.selling },
      { option: 'second', name: 'الفصل الثاني', on_sale: false }, { option: 'summer', name: 'الفصل الصيفي', on_sale: false },
    ],
  };
}

// ── The universities of AdmPlatUniversities ───────────────────────────────────
const MORE_UNIS: [string, string][] = [
  ['جامعة الدلتا للعلوم والتكنولوجيا', 'جمصة'], ['الأكاديمية العربية للعلوم والتكنولوجيا', 'دمياط الجديدة'], ['المعهد العالي للعلوم الإدارية', 'المنصورة'],
  ['جامعة الأزهر · فرع دمياط الجديدة', 'دمياط الجديدة'], ['جامعة كفر الشيخ', 'كفر الشيخ'],
];
if (as === 'platform' && !tables.universities.some((u) => u.name === MORE_UNIS[0][0])) {
  MORE_UNIS.forEach(([name, city], i) => tables.universities.push({ id: `d0aa0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name, city, is_active: true, created_at: daysAgo(100 - i) }));
  const horus = tables.universities.find((u) => u.name === 'جامعة حورس');
  if (horus) {
    horus.is_active = true;
    ['الصيدلة', 'طب الأسنان', 'العلاج الطبيعي', 'الهندسة', 'إدارة الأعمال', 'الفنون التطبيقية', 'الذكاء الاصطناعي', 'التمريض', 'الإعلام'].forEach((name, i) =>
      tables.colleges.push({ id: `e0aa0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, university_id: horus.id, name, is_active: i !== 8, created_at: daysAgo(50) }));
  }
  const egypt = tables.universities.find((u) => u.name === 'المعهد العالي للهندسة');
  if (egypt) egypt.is_active = false;
}
const UNI_STUDENTS = [1386, 2140, 874, 238, 197, 511, 962, 874, 94, 61, 19, 0];
const HORUS_COLLEGES: Record<string, number> = { الصيدلة: 312, 'طب الأسنان': 204, 'العلاج الطبيعي': 168, الهندسة: 121, 'إدارة الأعمال': 74, 'الفنون التطبيقية': 49, 'الذكاء الاصطناعي': 34 };
function universityCounts() {
  const companies = tables.companies.filter((c) => c.status !== 'archived').map((c) => ({ id: c.id, name: c.name }));
  return {
    universities: tables.universities.map((u, i) => {
      const students = UNI_STUDENTS[i] ?? 0;
      const n = students === 0 ? 0 : Math.max(1, Math.min(companies.length, Math.round(students / 150)));
      return { id: u.id, students, lines: n, companies: companies.slice(0, n) };
    }),
    colleges: tables.colleges.map((c) => {
      const u = tables.universities.find((x) => x.id === c.university_id);
      return { university_id: c.university_id, college: c.name, students: u?.name === 'جامعة حورس' ? HORUS_COLLEGES[c.name] ?? 0 : (c.name.length * 13) % 90 };
    }),
  };
}

// ── The defaults ──────────────────────────────────────────────────────────────
const TERMS: Row[] = [
  { code: 'first', name: 'الفصل الأول', sort_order: 1, start_month: 9, start_day: 20, start_year_offset: 0, end_month: 1, end_day: 15, end_year_offset: 1, included_in_annual: true, is_on_sale: true },
  { code: 'second', name: 'الفصل الثاني', sort_order: 2, start_month: 2, start_day: 7, start_year_offset: 1, end_month: 6, end_day: 10, end_year_offset: 1, included_in_annual: true, is_on_sale: true },
  { code: 'summer', name: 'الفصل الصيفي', sort_order: 3, start_month: 7, start_day: 1, start_year_offset: 1, end_month: 8, end_day: 31, end_year_offset: 1, included_in_annual: false, is_on_sale: false },
];
const pad = (n: number) => String(n).padStart(2, '0');
const periods = () => TERMS.map((t) => ({
  period_code: t.code, academic_year: 2026, label: t.code === 'summer' ? 'الصيفي 2027' : `${t.name} 2026/2027`,
  start_date: `${2026 + t.start_year_offset}-${pad(t.start_month)}-${pad(t.start_day)}`, end_date: `${2026 + t.end_year_offset}-${pad(t.end_month)}-${pad(t.end_day)}`,
}));
const settings = () => tables.app_settings[0];
const platformSettings = () => ({
  company_id: null, annual_global: settings().annual_subscription_enabled, annual_company: null, annual_effective: settings().annual_subscription_enabled,
  advance_enabled: null, can_edit_global: true, receipt_info: null, terms: TERMS.map((t) => ({ ...t })), periods: periods(), purchasable: [], sale_periods: [], sale_preview: [], companies: [],
});
const voteOf = (s: Row) => ({ opens_at: String(s.vote_opens_at).slice(0, 5), closes_at: String(s.vote_closes_at).slice(0, 5), reminder_minutes: s.vote_reminder_minutes, off_weekdays: s.vote_reminder_off_weekdays ?? [], off_dates: s.vote_reminder_off_dates ?? [] });
const platformVote = () => ({ ...voteOf(settings()), window_text: '', custom: false, can_edit_platform: true, platform: voteOf(settings()) });
if (as === 'platform') {
  Object.assign(settings(), { vote_opens_at: '14:00:00', vote_closes_at: '06:00:00', vote_reminder_minutes: 120, vote_reminder_off_weekdays: [5], vote_reminder_off_dates: ['2026-10-22', '2027-01-25'] });
}

/** Functions other areas answer for one company: the platform's own answer when no company is named. */
const platformOr = (name: string, mine: (args: Row) => unknown) => {
  const theirs = rpcs[name];
  return (args: Row, ctx: never) => (args.p_company_id == null || !theirs ? mine(args) : theirs(args, ctx));
};

const register = () => registerRpc({
  platform_companies: () => (state() === 'one' ? [companyRow(tables.companies[0])] : tables.companies.map(companyRow)),
  platform_company_detail: ({ p_company_id }) => detail(p_company_id),
  platform_university_counts: () => (state() === 'nocounts' ? fail('Failed to fetch') : universityCounts()),
  get_subscription_settings: platformOr('get_subscription_settings', platformSettings),
  get_subscription_switches: platformOr('get_subscription_switches', () => ({ daily_global: settings().daily_subscription_enabled, daily_company: null, daily_effective: settings().daily_subscription_enabled, annual_effective: settings().annual_subscription_enabled })),
  get_vote_settings: platformOr('get_vote_settings', platformVote),
  set_vote_settings: platformOr('set_vote_settings', (a) => {
    Object.assign(settings(), { vote_opens_at: `${a.p_opens_at}:00`, vote_closes_at: `${a.p_closes_at}:00`, vote_reminder_minutes: a.p_reminder_minutes, vote_reminder_off_weekdays: a.p_off_weekdays, vote_reminder_off_dates: a.p_off_dates });
    return platformVote();
  }),
  set_annual_subscription: platformOr('set_annual_subscription', (a) => { settings().annual_subscription_enabled = a.p_enabled; return { global: a.p_enabled, effective: a.p_enabled }; }),
  set_daily_subscription: platformOr('set_daily_subscription', (a) => { settings().daily_subscription_enabled = a.p_enabled; return { global: a.p_enabled, effective: a.p_enabled }; }),
  save_platform_terms: (a) => {
    (a.p_terms as Row[]).forEach((t) => Object.assign(TERMS.find((x) => x.code === t.code)!, t));
    return platformSettings();
  },
  save_app_version: (a) => {
    const row = { platform: a.p_platform, min_version: a.p_min_version, latest_version: a.p_latest_version, whats_new: a.p_whats_new, store_url: a.p_store_url, updated_at: new Date().toISOString(), updated_by: ADMINS.platform.id };
    const i = tables.app_versions.findIndex((r) => r.platform === a.p_platform);
    if (i >= 0) tables.app_versions[i] = row; else tables.app_versions.push(row);
    return row;
  },
  get_support_whatsapp: () => settings().support_whatsapp ?? null,
  save_support_whatsapp: (a) => { settings().support_whatsapp = a.p_phone || null; return settings().support_whatsapp; },
});
// After the other handler files: a company's own answers stay theirs.
register();
setTimeout(register, 0);

// The academic terms as a table (the defaults page writes them one by one where save_platform_terms is missing).
tables.academic_terms = TERMS;

registerFunctions({
  'admin-create-company': (body, { as: who }) => {
    if (who !== 'platform') fail('هذا الإجراء متاح لمدير النظام فقط.');
    const name = String(body.name ?? '').trim();
    if (name.length < 2) fail('أدخل اسم الشركة.');
    if (tables.companies.some((c) => c.name.trim() === name)) fail('توجد شركة بهذا الاسم بالفعل.');
    const email = String(body.admin?.email ?? '').toLowerCase();
    if (tables.admins.some((a) => a.email === email) || email.startsWith('taken@')) fail('هذا البريد مسجل بالفعل كمسؤول.');
    if (email.startsWith('nosmtp@') && !body.admin?.password) fail('تعذر إرسال الدعوة بالبريد (SMTP). اكتب كلمة مرور لإنشاء الحساب مباشرة.');
    const id = crypto.randomUUID();
    tables.companies.push({ id, name, status: 'active', is_active: true, created_at: new Date().toISOString(), contact_phone: body.contactPhone, contact_label: body.contactLabel, logo_path: null, emblem_path: null, annual_subscription_enabled: true, daily_subscription_enabled: true });
    STATS[id] = { students: 0, lines: 0, active_lines: 0, admins: 1, payment_methods: body.paymentMethod ? 1 : 0, selling: false, supervisors: 0 };
    const adminId = crypto.randomUUID();
    tables.admins.push({ id: adminId, email, full_name: body.admin.fullName, role: 'company_admin', company_id: id, created_at: new Date().toISOString(), companies: { id, name, status: 'active' } });
    return { id, name, adminId, invited: !body.admin.password };
  },
});

// ── Platform notifications (AdmPlatNotifications) ─────────────────────────────
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const NOTE_TEXTS: [string, string][] = [
  ['تذكير بتأكيد الركوب', 'أكّد ركوبك قبل 6:00 ص حتى نحجز لك مقعداً.'], ['تعديل موعد رحلة العودة', 'رحلة العودة 3:00 م تتحرك 3:30 م هذا الأسبوع فقط.'],
  ['إجازة رسمية', 'لا رحلات يوم الخميس. تعود الرحلات السبت في مواعيدها.'], ['خط جديد إلى جامعة حورس', 'بدأ خط جديد إلى جامعة حورس. اشترك من صفحة الخطوط.'],
  ['آخر موعد لرفع الإيصال', 'ارفع إيصال الدفع قبل نهاية الأسبوع ليبقى اشتراكك نشطاً.'], ['تغيير رقم التواصل', 'رقم خدمة العملاء تغيّر. تجده في بطاقتك.'],
];
const companiesFor = () => tables.companies.filter((c) => c.status === 'active');
const note = (i: number, o: Row): Row => ({
  id: `f0aa0000-0000-4000-8000-${String(i).padStart(12, '0')}`, type: 'announcement.admin', category: 'announcement', priority: 'normal',
  status_note: null, sender_role: 'admin', sender_name: 'أحمد سعيد النورس', audience: 'كل طلاب الشركة', audience_spec: { kind: 'company' }, line_id: null,
  read: 0, opened: 0, push: { devices: 0, queued: 0, accepted: 0, failed: 0, skipped: 0 }, ...o,
});
const NOTES: Row[] = [];
if (as === 'platform') {
  const all = companiesFor();
  all.forEach((c, k) => NOTES.push(note(1000 + k, {
    type: 'announcement.platform', sender_name: 'محمد عادل', title: 'إجازة 6 أكتوبر', body: 'لا رحلات يوم الثلاثاء 6 أكتوبر. تعود الرحلات الأربعاء في مواعيدها.',
    created_at: hoursAgo(120), scheduled_at: null, sent_at: hoursAgo(120), status: 'sent', company_id: c.id, company_name: c.name,
    students: [718, 33, 280, 225][k] ?? 200, read: [520, 22, 200, 160][k] ?? 150, opened: 80, push: { devices: 150, queued: 0, accepted: 140, failed: k === 0 ? 14 : 0, skipped: 40 },
  })));
  all.forEach((c, k) => NOTES.push(note(2000 + k, {
    type: 'announcement.platform', sender_name: 'محمد عادل', title: 'تحديث جديد للتطبيق', body: 'حدّث التطبيق لتأكيد الركوب بضغطة واحدة من الإشعار.',
    created_at: hoursAgo(2), scheduled_at: new Date(Date.now() + 20 * 3_600_000).toISOString(), sent_at: null, status: 'scheduled', company_id: c.id, company_name: c.name, students: 0,
  })));
  NOTES.push(note(1, { title: 'تأخير رحلة 7:15 ص', body: 'رحلة فارسكور تتأخر 20 دقيقة اليوم بسبب عطل. نعتذر.', created_at: hoursAgo(3), sent_at: hoursAgo(3), scheduled_at: null, status: 'sent', company_id: COMPANY_ID, company_name: 'النورس للنقل', students: 71, read: 64, opened: 30, priority: 'high', push: { devices: 60, queued: 0, accepted: 58, failed: 2, skipped: 11 } }));
  NOTES.push(note(2, { title: 'موعد تجديد الفصل الثاني', body: 'باب الاشتراك في الفصل الثاني مفتوح حتى 7 فبراير.', created_at: hoursAgo(16), sent_at: null, scheduled_at: null, status: 'failed', status_note: 'لم يُرسل', company_id: all[2]?.id, company_name: all[2]?.name, students: 0 }));
  NOTES.push(note(3, { title: 'تغيير موقف المحطة الثالثة', body: 'موقف الحي الثالث انتقل أمام الصيدلية بداية من الأحد.', created_at: hoursAgo(40), sent_at: null, scheduled_at: hoursAgo(30), status: 'cancelled', company_id: all[3]?.id, company_name: all[3]?.name, students: 0 }));
  for (let i = 0; i < 40; i += 1) {
    const c = all[(i * 7) % all.length]; const [title, body] = NOTE_TEXTS[i % NOTE_TEXTS.length];
    const students = 41 + ((i * 53) % 320);
    NOTES.push(note(10 + i, { title, body, created_at: hoursAgo(48 + i * 9), sent_at: hoursAgo(48 + i * 9), scheduled_at: null, status: i % 13 === 5 ? 'scheduled' : 'sent', company_id: c.id, company_name: c.name, students, read: Math.round(students * 0.7), opened: Math.round(students * 0.3), push: { devices: students - 10, queued: 0, accepted: students - 12, failed: 2, skipped: 10 } }));
  }
  NOTES.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
const missing = (map: Record<string, (a: Row, c: never) => unknown>) => {
  const fill = () => Object.entries(map).forEach(([k, f]) => { if (!rpcs[k]) registerRpc({ [k]: f }); });
  fill(); setTimeout(fill, 0);
};
missing({
  get_platform_notifications_page: ({ p_before, p_limit = 30, p_status, p_company_id }) => {
    if (state() === 'empty') return { items: [], next_before: null, push: { configured: false, devices: 0, ios: 0, android: 0, queued: 0, accepted_24h: 0, failed_24h: 0 } };
    const rows = NOTES.filter((n) => (!p_status || n.status === p_status) && (!p_company_id || n.company_id === p_company_id) && (!p_before || n.created_at < p_before));
    const items = rows.slice(0, p_limit);
    return { items, next_before: rows.length > p_limit ? items[items.length - 1].created_at : null,
      push: { configured: true, devices: 5120, ios: 1840, android: 3280, queued: 36, accepted_24h: 8412, failed_24h: 14 } };
  },
  platform_preview_notification: ({ p_company_ids }) => {
    const ids: string[] | null = p_company_ids;
    const chosen = companiesFor().filter((c) => !ids || ids.includes(c.id));
    const students = chosen.reduce((a, c) => a + (STATS[c.id]?.students ?? 0), 0);
    return { companies: chosen.filter((c) => (STATS[c.id]?.students ?? 0) > 0).length, students, supervisors: Math.round(students / 130), devices: Math.round(students * 0.86) };
  },
  platform_compose_notification: ({ p_title, p_body, p_company_ids, p_scheduled_at, p_priority }) => {
    const ids: string[] | null = p_company_ids;
    const chosen = companiesFor().filter((c) => !ids || ids.includes(c.id));
    chosen.forEach((c, k) => NOTES.unshift(note(5000 + NOTES.length + k, { type: 'announcement.platform', sender_name: 'محمد عادل', title: p_title, body: p_body, priority: p_priority,
      created_at: new Date().toISOString(), scheduled_at: p_scheduled_at, sent_at: p_scheduled_at ? null : new Date().toISOString(), status: p_scheduled_at ? 'scheduled' : 'sent',
      company_id: c.id, company_name: c.name, students: p_scheduled_at ? 0 : STATS[c.id]?.students ?? 0 })));
    return { status: p_scheduled_at ? 'scheduled' : 'sent', companies: chosen.length, students: chosen.reduce((a, c) => a + (STATS[c.id]?.students ?? 0), 0), duplicate: false };
  },
  delete_notification: ({ p_id }) => { const i = NOTES.findIndex((n) => n.id === p_id); if (i >= 0) NOTES.splice(i, 1); return null; },
  cancel_scheduled_notification: ({ p_id }) => { const n = NOTES.find((x) => x.id === p_id); if (n) n.status = 'cancelled'; return null; },
});
