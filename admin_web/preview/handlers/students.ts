/**
 * The students pages (company «الطلاب», platform «كل الطلاب» and «طلبات تصحيح البيانات»):
 * every server function and edge function they call, over the shared sample rows.
 * The rows are copied here and varied (an upcoming term, earlier terms, a student
 * without a subscription) so every status of the boards appears; writes change the
 * copies for the life of the tab.
 */
import { registerFunctions, registerRpc, rpcs } from '../registry';
import { ADMINS, COMPANY_ID, COMPANY2_ID, LINES, RESET_REQUESTS, STUDENTS, TODAY, UNIVERSITIES, tables } from '../data';

type Row = Record<string, any>;
const empty = () => sessionStorage.getItem('preview.state') === 'empty';
// ?fail=students / ?hang=students: only this area's reads fail or never answer (the frame still loads),
// for the error and loading boards of these pages.
const own = new URLSearchParams(location.search);
['fail', 'hang'].forEach((k) => { if (own.has(k)) sessionStorage.setItem(`preview.${k}`, own.get(k) ?? ''); });
const mode = (name: string) => (sessionStorage.getItem('preview.fail') === name ? 'fail' : sessionStorage.getItem('preview.hang') === name ? 'hang' : '');
const reading = async <T,>(name: string, answer: () => T): Promise<T> => {
  if (mode(name) === 'fail') throw new Error('Failed to fetch');
  if (mode(name) === 'hang') await new Promise(() => undefined);
  return answer();
};
const uuid = () => crypto.randomUUID();
const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000).toISOString();
const COMPANY_NAME = 'النورس للنقل';
const fail = (message: string) => { throw new Error(message); };

const CURRENT = { start_date: '2026-09-19', end_date: '2027-01-14' };
const NEXT = { start_date: '2027-02-06', end_date: '2027-06-10' };
const universityId = (name: string) => UNIVERSITIES.find((u) => u.name === name)?.id ?? null;

// ── The company's members ────────────────────────────────────────────────
const ROWS: Row[] = STUDENTS.map((s, i) => {
  const base = s.subscriptions[0];
  const line = LINES.find((l) => l.id === base.line_id) ?? LINES[0];
  const sub = (patch: Row): Row => ({
    ...base, id: uuid(), line_id: line.id, line_name: line.name, station_name: base.station_name, paid_at: null, ...patch,
  });
  let subs: Row[] = [sub({ id: base.id, ...CURRENT, period_phase: base.status === 'expired' ? 'expired' : 'current', paid_at: base.status === 'active' ? s.created_at : null })];
  if (i % 13 === 11) subs = [];
  if (i % 11 === 8) subs = [sub({ status: 'active', ...NEXT, period_label: 'الفصل الثاني 2026/2027', period_phase: 'upcoming', paid_at: s.created_at, created_at: s.created_at })];
  if (i % 7 === 3 && subs.length && base.status === 'active') {
    subs.push(sub({ status: 'active', ...NEXT, period_label: 'الفصل الثاني 2026/2027', period_phase: 'upcoming', paid_at: s.created_at, created_at: daysAgo(i) }));
  }
  if (i % 4 === 1) {
    subs.push(sub({ status: 'expired', start_date: '2026-02-07', end_date: '2026-06-10', period_label: 'الفصل الثاني 2025/2026', period_phase: 'expired', price: 3900, created_at: daysAgo(240) }));
    subs.push(sub({ status: 'expired', start_date: '2025-09-20', end_date: '2026-01-15', period_label: 'الفصل الأول 2025/2026', period_phase: 'expired', price: 3900, created_at: daysAgo(390) }));
  }
  return {
    id: s.id, phone: s.phone, full_name: s.full_name, university: s.university, university_id: universityId(s.university),
    college: s.college, specialisation: s.specialisation, profile_image_url: null, created_at: s.created_at, joined_at: s.created_at,
    subscriptions: subs,
  };
});
// Accounts with no company and accounts in two companies: only «كل الطلاب» shows them.
const OTHERS: Row[] = [
  ['بسملة مجدي الجمال', '01035288168', 'جامعة المنصورة', []],
  ['عمر محمد السيد إسماعيل البنا', '01053602880', 'جامعة المنصورة', []],
  ['ندى حسام الدين البدراوي', '01071845568', 'جامعة المنصورة الأهلية', [COMPANY2_ID]],
].map(([full_name, phone, university, companies], i) => ({
  id: `a7e00000-0000-4000-8000-00000000000${i + 1}`, full_name, phone, university, college: 'الهندسة', specialisation: null,
  created_at: daysAgo(30 + i * 40), companies,
}));
const MULTI = new Set(ROWS.filter((_, i) => i % 9 === 4).map((r) => r.id));
const REMOVED: Row[] = [];

const today = () => TODAY;
function shownOf(s: Row): string {
  const t = today();
  if (s.status === 'expired' || (s.end_date && s.end_date < t)) return 'ended';
  if (s.status === 'pending_review') return 'review';
  if (s.status === 'rejected') return 'rejected';
  if (s.status === 'pending_payment') return 'unpaid';
  if (s.status === 'active') return s.start_date > t ? 'soon' : 'active';
  return 'ended';
}
function rowStatus(r: Row): string {
  const subs = [...r.subscriptions].sort((a, b) => Number(shownOf(a) === 'ended') - Number(shownOf(b) === 'ended')
    || Number(a.start_date > today()) - Number(b.start_date > today()) || String(b.created_at).localeCompare(String(a.created_at)));
  return subs[0] ? shownOf(subs[0]) : 'none';
}
const pendingCorrections = (studentId: string) => tables.student_correction_requests
  .filter((c) => c.student_id === studentId && c.status === 'pending')
  .map(({ id, field, old_value, new_value, created_at }) => ({ id, field, old_value, new_value, created_at }));
const openReset = (studentId: string) => {
  const r = RESET_REQUESTS.find((x) => x.student_id === studentId && ['pending', 'code_issued'].includes(x.status));
  return r ? { id: r.id, status: r.status, requested_at: r.requested_at } : null;
};
const findSub = (id: string) => {
  for (const r of ROWS) { const s = r.subscriptions.find((x: Row) => x.id === id); if (s) return { r, s }; }
  return null;
};
const digits = (v: string) => String(v ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '');

// ── Invitations and corrections the tabs show ───────────────────────────
const LINE_BY_NAME = (name: string) => LINES.find((l) => l.name === name)!;
tables.company_invites.forEach((inv, i) => Object.assign(inv, { lines: { name: LINES[i + 1].name }, expires_at: i === 0 ? daysAgo(-14) : daysAgo(-10), created_at: i === 0 ? daysAgo(0, 2) : daysAgo(4) }));
tables.company_invites.push(
  { id: uuid(), company_id: COMPANY_ID, phone: '01155026618', status: 'accepted', created_at: daysAgo(8), expires_at: daysAgo(-6), responded_at: daysAgo(7), lines: { name: LINE_BY_NAME('شربين').name } },
  { id: uuid(), company_id: COMPANY_ID, phone: '01520964471', status: 'declined', created_at: daysAgo(12), expires_at: daysAgo(-2), responded_at: daysAgo(11), lines: { name: LINE_BY_NAME('فارسكور').name } },
  { id: uuid(), company_id: COMPANY_ID, phone: '01088431120', status: 'cancelled', created_at: daysAgo(19), expires_at: daysAgo(5), responded_at: daysAgo(18), lines: { name: LINE_BY_NAME('الزرقا').name } },
  { id: uuid(), company_id: COMPANY_ID, phone: '01233175586', status: 'pending', created_at: daysAgo(28), expires_at: daysAgo(14), responded_at: null, lines: { name: LINE_BY_NAME('كفر سعد').name } },
);
tables.student_correction_requests.forEach((c) => Object.assign(c, { requested_by_name: ADMINS.company.full_name }));
[[20, 'full_name', 'عمر خالد اسماعيل البنا', 'عمر خالد إسماعيل البنا', 'approved', 7, null], [30, 'full_name', 'يوسف احمد عبد الفتاح', 'يوسف أحمد عبد الفتاح البنا', 'approved', 13, null],
  [40, 'full_name', 'سلمى طارق عبد الحميد سالم', 'سلمى طارق سالم', 'rejected', 21, 'الاسم المقترح أقل من ثلاثة أسماء.']].forEach(([n, field, old_value, new_value, status, ago, note]) => {
  tables.student_correction_requests.push({
    id: uuid(), student_id: STUDENTS[n as number].id, company_id: COMPANY_ID, field, old_value, new_value, note: null, status, requested_by: ADMINS.company.id,
    requested_by_name: ADMINS.company.full_name, created_at: daysAgo(ago as number), decided_by: ADMINS.platform.id, decided_at: daysAgo((ago as number) - 1), decision_note: note,
    companies: { name: COMPANY_NAME }, students: { full_name: STUDENTS[n as number].full_name, phone: STUDENTS[n as number].phone },
  });
});

const membershipsOf = (id: string): Row[] => {
  const member = ROWS.find((r) => r.id === id);
  const other = OTHERS.find((o) => o.id === id);
  const list: Row[] = [];
  if (member) list.push({ company_id: COMPANY_ID, company: COMPANY_NAME, status: 'active', joined_at: member.joined_at, removed_at: null,
    active_subscriptions: member.subscriptions.filter((s: Row) => s.status === 'active' && s.end_date >= today()).length });
  if (member && MULTI.has(id)) list.push({ company_id: COMPANY2_ID, company: 'الدلتا للنقل الجامعي', status: 'active', joined_at: daysAgo(20), removed_at: null, active_subscriptions: 1 });
  const removed = REMOVED.find((r) => r.id === id);
  if (removed) list.push({ company_id: COMPANY_ID, company: COMPANY_NAME, status: 'removed', joined_at: removed.joined_at, removed_at: daysAgo(0), active_subscriptions: 0 });
  if (other) other.companies.forEach((c: string) => list.push({ company_id: c, company: 'الدلتا للنقل الجامعي', status: 'active', joined_at: daysAgo(60), removed_at: null, active_subscriptions: 1 }));
  return list;
};
const accounts = () => [...ROWS, ...REMOVED, ...OTHERS];

registerRpc({
  get_company_students_page_v2: ({ p_student_id, p_search, p_status, p_line_id, p_university_id, p_sort = 'newest', p_limit = 25, p_offset = 0 }) => {
    const zero = { all: 0, active: 0, review: 0, unpaid: 0, rejected: 0, soon: 0, ended: 0, none: 0 };
    if (empty()) return { rows: [], total: 0, has_next: false, counts: zero };
    const term = String(p_search ?? '').trim();
    const d = digits(term);
    const kept = ROWS.filter((r) => (!p_student_id || r.id === p_student_id) && (!term || r.full_name.includes(term) || r.university.includes(term) || (d.length > 0 && r.phone.includes(d)))
      && (!p_university_id || r.university_id === p_university_id)
      && (!p_line_id || r.subscriptions.some((s: Row) => s.line_id === p_line_id)))
      .map((r) => ({ ...r, status: rowStatus(r) }));
    const counts: Row = { ...zero, all: kept.length };
    kept.forEach((r) => { counts[r.status] += 1; });
    let rows = kept.filter((r) => !p_status || r.status === p_status);
    rows = [...rows].sort((a, b) => (p_sort === 'name' ? a.full_name.localeCompare(b.full_name, 'ar')
      : p_sort === 'oldest' ? a.joined_at.localeCompare(b.joined_at) : b.joined_at.localeCompare(a.joined_at)));
    const page = rows.slice(p_offset, p_offset + p_limit).map((r) => ({
      ...r, subscriptions: r.subscriptions.map((s: Row) => ({ ...s, shown: shownOf(s) })).sort((a: Row, b: Row) => String(b.created_at).localeCompare(String(a.created_at))),
      corrections: pendingCorrections(r.id), open_reset: openReset(r.id),
    }));
    return { rows: page, total: rows.length, has_next: p_offset + p_limit < rows.length, counts };
  },

  admin_subscription_action: ({ p_subscription_id, p_action }) => {
    const found = findSub(p_subscription_id);
    if (!found) fail('الاشتراك غير موجود أو خارج صلاحياتك.');
    const s = found!.s;
    const next = p_action === 'activate' && ['pending_payment', 'rejected'].includes(s.status) ? 'active'
      : p_action === 'cancel' && ['pending_payment', 'rejected'].includes(s.status) ? 'expired'
        : p_action === 'end' && s.status === 'active' ? 'expired'
          : p_action === 'revert' && s.status === 'active' ? 'pending_payment'
            : p_action === 'reactivate' && s.status === 'expired' && s.end_date >= today() ? 'active' : null;
    if (!next) fail(s.status === 'pending_review' ? 'لهذا الاشتراك إيصال ينتظر المراجعة. قرّر فيه من صفحة الإيصالات.' : 'تغيّرت حالة الاشتراك منذ فتحت الصفحة. حدّث الصفحة وحاول مرة أخرى.');
    s.status = next;
    s.paid_at = next === 'active' ? new Date().toISOString() : next === 'pending_payment' ? null : s.paid_at;
    s.period_phase = next === 'expired' ? 'expired' : s.start_date > today() ? 'upcoming' : 'current';
    return { id: s.id, status: s.status, shown: shownOf(s), start_date: s.start_date, end_date: s.end_date, paid_at: s.paid_at, period_label: s.period_label, period_phase: s.period_phase };
  },

  company_remove_student: ({ p_student_id }) => {
    const i = ROWS.findIndex((r) => r.id === p_student_id);
    if (i < 0) fail('هذا الطالب غير مسجل في الشركة.');
    const [r] = ROWS.splice(i, 1);
    let ended = 0;
    r.subscriptions.forEach((s: Row) => { if (['pending_payment', 'pending_review', 'active'].includes(s.status)) { s.status = 'expired'; ended += 1; } });
    REMOVED.push(r);
    return { removed: true, ended_subscriptions: ended };
  },

  request_student_correction: ({ p_company_id, p_student_id, p_field, p_new_value, p_note }) => {
    const r = ROWS.find((x) => x.id === p_student_id);
    if (!r) fail('هذا الطالب غير مسجل في شركتك.');
    const v = String(p_new_value ?? '').trim();
    if (p_field === 'full_name' && v.split(/\s+/).length < 4) fail('اكتب الاسم الرباعي كاملاً.');
    const old = p_field === 'full_name' ? r!.full_name : r!.university;
    if (old === v) fail('القيمة الجديدة مطابقة للحالية.');
    if (tables.student_correction_requests.some((c) => c.student_id === p_student_id && c.field === p_field && c.status === 'pending')) fail('يوجد طلب تصحيح مفتوح لهذا الحقل بالفعل.');
    const id = uuid();
    tables.student_correction_requests.push({
      id, student_id: p_student_id, company_id: p_company_id, field: p_field, old_value: old, new_value: v, note: p_note ?? null, status: 'pending',
      requested_by: ADMINS.company.id, requested_by_name: ADMINS.company.full_name, created_at: new Date().toISOString(), decided_by: null, decided_at: null, decision_note: null,
      companies: { name: COMPANY_NAME }, students: { full_name: r!.full_name, phone: r!.phone },
    });
    return id;
  },

  decide_student_correction: ({ p_request_id, p_approve, p_note }) => {
    const c = tables.student_correction_requests.find((x) => x.id === p_request_id && x.status === 'pending');
    if (!c) fail('الطلب غير موجود أو تم البت فيه.');
    if (p_approve) {
      const r = accounts().find((x) => x.id === c!.student_id);
      if (r) { if (c!.field === 'full_name') r.full_name = c!.new_value; else { r.university = c!.new_value; r.university_id = universityId(c!.new_value); } }
    }
    Object.assign(c!, { status: p_approve ? 'approved' : 'rejected', decided_at: new Date().toISOString(), decided_by: ADMINS.platform.id, decision_note: p_note ?? null });
    return null;
  },

  company_cancel_invite: ({ p_invite_id }) => {
    const inv = tables.company_invites.find((x) => x.id === p_invite_id && x.status === 'pending');
    if (!inv) fail('الدعوة غير موجودة أو خارج صلاحياتك.');
    Object.assign(inv!, { status: 'cancelled', responded_at: new Date().toISOString() });
    return null;
  },

  // ── Platform ──
  platform_students: ({ p_search, p_company_id, p_membership, p_limit = 25, p_offset = 0 }) => {
    if (empty()) return { total: 0, rows: [] };
    const term = String(p_search ?? '').trim();
    const d = digits(term);
    const rows = accounts().map((a) => ({ a, m: membershipsOf(a.id) }))
      .filter(({ a, m }) => (!term || a.full_name.includes(term) || a.university.includes(term) || (d.length > 2 && a.phone.includes(d)))
        && (!p_company_id || m.some((x) => x.company_id === p_company_id && x.status === 'active'))
        && (!p_membership || (p_membership === 'none' ? !m.some((x) => x.status === 'active') : m.filter((x) => x.status === 'active').length > 1)))
      .sort((x, y) => String(y.a.created_at).localeCompare(String(x.a.created_at)))
      .map(({ a, m }) => ({
        id: a.id, full_name: a.full_name, phone: a.phone, university: a.university, created_at: a.created_at,
        memberships: m.map(({ company_id, company, status, joined_at }) => ({ company_id, company, status, joined_at })),
        active_subscriptions: m.reduce((n, x) => n + (x.status === 'active' ? x.active_subscriptions : 0), 0),
      }));
    return { total: rows.length, rows: rows.slice(p_offset, p_offset + p_limit) };
  },
  platform_students_counts: ({ p_search, p_company_id }) => {
    if (empty()) return { all: 0, none: 0, multiple: 0 };
    const term = String(p_search ?? '').trim();
    const d = digits(term);
    const list = accounts().map((a) => ({ a, n: membershipsOf(a.id).filter((x) => x.status === 'active' && (!p_company_id || true)).length, m: membershipsOf(a.id) }))
      .filter(({ a, m }) => (!term || a.full_name.includes(term) || a.university.includes(term) || (d.length > 2 && a.phone.includes(d)))
        && (!p_company_id || m.some((x) => x.company_id === p_company_id && x.status === 'active')));
    return { all: list.length, none: list.filter((x) => x.n === 0).length, multiple: list.filter((x) => x.n > 1).length };
  },
  platform_student_details: ({ p_student_id }) => {
    const a = accounts().find((x) => x.id === p_student_id);
    if (!a) fail('الحساب غير موجود.');
    const m = membershipsOf(a!.id);
    return {
      id: a!.id, full_name: a!.full_name, phone: a!.phone, university: a!.university, college: a!.college, specialisation: a!.specialisation, created_at: a!.created_at,
      active_subscriptions: m.reduce((n, x) => n + (x.status === 'active' ? x.active_subscriptions : 0), 0), memberships: m,
      corrections: tables.student_correction_requests.filter((c) => c.student_id === a!.id && c.status === 'pending')
        .map((c) => ({ id: c.id, field: c.field, old_value: c.old_value, new_value: c.new_value, created_at: c.created_at, company_id: c.company_id, company: COMPANY_NAME })),
    };
  },
  platform_correction_requests: () => tables.student_correction_requests.filter((c) => c.status === 'pending')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((c) => {
      const a = accounts().find((x) => x.id === c.student_id);
      const m = a ? membershipsOf(a.id).filter((x) => x.status === 'active') : [];
      return {
        id: c.id, student_id: c.student_id, company_id: c.company_id, field: c.field, old_value: c.old_value, new_value: c.new_value, note: c.note,
        status: c.status, created_at: c.created_at, decided_at: null, decision_note: null, company: COMPANY_NAME, requested_by_name: c.requested_by_name ?? ADMINS.company.full_name,
        student_name: a?.full_name ?? null, student_phone: a?.phone ?? null, student_companies: m.map((x) => x.company),
        active_subscriptions: m.reduce((n, x) => n + x.active_subscriptions, 0),
      };
    }),

  // ── Blocking ──
  list_blocked_phones: ({ p_company_id }) => tables.blocked_phones.filter((b) => !p_company_id || b.company_id === p_company_id || ROWS.some((r) => r.phone === b.phone)),
  block_student: ({ p_student_id, p_reason, p_company_id }) => {
    const a = accounts().find((x) => x.id === p_student_id);
    if (!a) fail('الطالب غير موجود.');
    tables.blocked_phones.push({ phone: a!.phone, student_id: a!.id, full_name: a!.full_name, reason: p_reason ?? null, blocked_at: new Date().toISOString(), has_account: true,
      company_id: p_company_id ?? null, company_name: p_company_id ? COMPANY_NAME : null, can_unblock: true });
    return null;
  },
  unblock_phone: ({ p_phone }) => { tables.blocked_phones = tables.blocked_phones.filter((b) => b.phone !== p_phone); return null; },

  // ── What adding a student chooses from ──
  get_purchasable_periods: () => [
    { period_code: 'first', academic_year: 2026, label: 'الفصل الأول 2026/2027', subscription_type: 'termly', ...CURRENT, phase: 'current' },
    { period_code: 'second', academic_year: 2026, label: 'الفصل الثاني 2026/2027', subscription_type: 'termly', ...NEXT, phase: 'upcoming' },
  ],
  get_subscription_switches: () => ({ annual_effective: false, daily_effective: true, two_terms_effective: false }),
});

// The reads that the error and loading boards cover.
([['get_company_students_page_v2', 'students'], ['platform_students', 'platform-students'], ['platform_students_counts', 'platform-students'],
  ['platform_correction_requests', 'corrections']] as const).forEach(([name, area]) => {
  const h = rpcs[name];
  rpcs[name] = (args, ctx) => reading(area, () => h(args, ctx));
});

const EXISTING_ELSEWHERE = new Set(['01112345679', '01071845568']);
registerFunctions({
  'admin-create-student': (body) => {
    const phone = digits(body.phone);
    // The edge function's own sentences (supabase/functions/_shared/create-student.ts).
    if (ROWS.some((r) => r.phone === phone)) throw new Error('هذا الطالب مسجل في شركتك بالفعل. أضف له اشتراكاً من قائمة الطلاب.');
    if (tables.company_invites.some((i) => i.phone === phone && i.status === 'pending')) throw new Error('توجد دعوة معلقة لهذا الرقم بالفعل. تظهر للطالب في التطبيق.');
    const line = LINES.find((l) => l.id === body.lineId)!;
    if (EXISTING_ELSEWHERE.has(phone) || OTHERS.some((o) => o.phone === phone)) {
      tables.company_invites.unshift({ id: uuid(), company_id: COMPANY_ID, phone, status: 'pending', created_at: new Date().toISOString(), expires_at: daysAgo(-14), responded_at: null, lines: { name: line.name } });
      return { invited: true };
    }
    const id = uuid();
    const period = body.periodCode === 'second' ? { ...NEXT, period_label: 'الفصل الثاني 2026/2027', period_phase: 'upcoming' } : { ...CURRENT, period_label: 'الفصل الأول 2026/2027', period_phase: 'current' };
    const station = line.stations.find((s: Row) => s.id === body.stationId);
    ROWS.unshift({
      id, phone, full_name: body.fullName, university: body.university, university_id: universityId(body.university), college: 'غير محدد', specialisation: null,
      profile_image_url: null, created_at: new Date().toISOString(), joined_at: new Date().toISOString(),
      subscriptions: [{ id: uuid(), status: 'pending_payment', type: body.subscriptionType, price: body.subscriptionType === 'daily' ? line.price_daily : 4200, created_at: new Date().toISOString(),
        ...(body.subscriptionType === 'daily' ? { start_date: null, end_date: null, period_label: 'اشتراك يومي', period_phase: 'current' } : period),
        departure_time: '07:15:00', return_time: '15:15:00', line_id: line.id, line_name: line.name, station_name: station?.name ?? null, trip_label: null, trip_university: body.university, paid_at: null }],
    });
    return { id };
  },
  'admin-delete-student': ({ studentId }) => {
    const i = ROWS.findIndex((r) => r.id === studentId);
    if (i >= 0) ROWS.splice(i, 1);
    return { deleted: true };
  },
});
void ADMINS;
