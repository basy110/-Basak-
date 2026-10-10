import { describe, expect, it } from 'vitest';
import {
  companyCounts, createFailure, createPayload, dayProblem, digitsOf, draftTouched, emptyCompanyDraft, firstBadStep, foldArabic, followers,
  groupNotes, joinNames, listCompanies, matches, readiness, saleLine, shortTerm, statusQuestion, stepErrors, termsLine, universityProblem,
  collegeProblem, collegeStudents, whenText, type CompanyDetail, type NoteRow, type PlatformCompany, type TermRow,
} from './platform';
import { draftErrors, draftFromRow, raisesMinimum, readAs } from './appVersions';
import { signInProblem } from '../pages/LoginPage';

const company = (o: Partial<PlatformCompany>): PlatformCompany => ({
  id: 'x', name: 'شركة', status: 'active', created_at: '2026-01-01T00:00:00Z', status_changed_at: null, contact_phone: null, contact_label: null,
  lines: 2, active_lines: 2, students: 10, admins: 1, supervisors: 2, payment_methods: 1, selling: true, ...o,
});

describe('words', () => {
  it('folds Arabic spelling forms', () => {
    expect(foldArabic('  الإسكندريّة  ')).toBe(foldArabic('الاسكندرية'));
    expect(matches('النورس', 'شركة النُّورس للنقل')).toBe(true);
    expect(matches('نورس دمياط', 'النورس', 'دمياط الجديدة')).toBe(true);
    expect(matches('طنطا', 'النورس')).toBe(false);
    expect(matches('', 'anything')).toBe(true);
  });
  it('joins names, dropping a repeated «الفصل»', () => {
    expect(joinNames(['الفصل الثاني', 'الفصل الصيفي'])).toBe('الفصل الثاني والصيفي');
    expect(joinNames(['الفصل الأول', 'الفصلان معاً'])).toBe('الفصل الأول والفصلان معاً');
  });
});

describe('companies', () => {
  const rows = [company({ id: '1', name: 'ب', status: 'active', students: 5, created_at: '2026-01-02T00:00:00Z' }), company({ id: '2', name: 'أ', status: 'suspended', students: 9 }), company({ id: '3', name: 'ج', status: 'archived' })];
  it('counts «الحالية» as everything not archived', () => {
    expect(companyCounts(rows)).toEqual({ current: 2, active: 1, suspended: 1, archived: 1 });
  });
  it('filters, searches and sorts', () => {
    expect(listCompanies(rows, { filter: 'current', search: '', sort: 'name' }).map((c) => c.id)).toEqual(['2', '1']);
    expect(listCompanies(rows, { filter: 'current', search: '', sort: 'students' }).map((c) => c.id)).toEqual(['2', '1']);
    expect(listCompanies(rows, { filter: 'archived', search: '', sort: 'name' }).map((c) => c.id)).toEqual(['3']);
    expect(listCompanies(rows, { filter: 'current', search: 'ب', sort: 'name' }).map((c) => c.id)).toEqual(['1']);
  });
  it('says what a suspension does with the real numbers', () => {
    const q = statusQuestion('suspended', company({ name: 'النورس للنقل', admins: 2, supervisors: 4, students: 806 }));
    expect(q.title).toBe('إيقاف «النورس للنقل»؟');
    expect(q.body[0]).toContain('مديراها');
    expect(q.body[0]).toContain('806');
    expect(q.body[1]).toContain('لا يُحذف شيء');
    expect(q.confirm).toBe('أوقف الشركة');
    expect(statusQuestion('archived', company({})).confirm).toBe('أرشف الشركة');
    expect(statusQuestion('active', company({})).confirm).toBe('أعد تشغيل الشركة');
  });
});

describe('readiness', () => {
  const detail: CompanyDetail = {
    company: { id: 'x', name: 'x', status: 'active', created_at: '', status_changed_at: null, contact_phone: null, contact_label: null },
    admins: [], supervisors: 4,
    payment_methods: [{ method_type: 'instapay', display_name: 'a' }, { method_type: 'vodafone_cash', display_name: 'b' }],
    lines: [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, name: `خط ${i}`, is_active: true, supervised: true, hidden: null, unserved_university: null })),
      { id: 'k', name: 'كفر البطيخ', is_active: true, supervised: true, hidden: 'no_departure' as const, unserved_university: null },
      { id: 's', name: 'شربين', is_active: false, supervised: false, hidden: 'line_inactive' as const, unserved_university: null },
    ],
    sale: [{ option: 'first', name: 'الفصل الأول', on_sale: true }, { option: 'both', name: 'الفصلان معاً', on_sale: true }, { option: 'second', name: 'الفصل الثاني', on_sale: false }, { option: 'summer', name: 'الفصل الصيفي', on_sale: false }],
  };
  it('reads like the board', () => {
    const [lines, pay, sale, sup] = readiness(detail);
    expect(lines.title).toBe('7 خطوط تعمل من 8');
    expect(lines.sub).toBe('خط «كفر البطيخ» لا يظهر للطلاب: تنقصه رحلة ذهاب');
    expect(pay.title).toBe('وسيلتا دفع تعملان');
    expect(pay.sub).toBe('إنستاباي · محفظة هاتف');
    expect(sale.title).toBe('الفصل الأول والفصلان معاً معروضان للبيع');
    expect(sale.sub).toBe('الفصل الثاني والصيفي موقوفان عن البيع');
    expect(sup.title).toBe('4 مشرفين');
  });
  it('a new company: nothing yet', () => {
    const items = readiness({ ...detail, lines: [], payment_methods: [], supervisors: 0, sale: null });
    expect(items.map((i) => i.ok)).toEqual([false, false, false]);
    expect(items[0].title).toBe('لا خطوط بعد');
  });
});

describe('a new company', () => {
  it('checks each step, field by field', () => {
    const d = { ...emptyCompanyDraft(), name: 'ا', contactPhone: '010 44' };
    expect(stepErrors(0, d)).toEqual({ name: 'اكتب اسم الشركة كاملاً (حرفان على الأقل).', contactPhone: expect.any(String) });
    expect(stepErrors(1, { ...d, adminName: 'كريم', adminEmail: 'x@y' }).adminName).toBeTruthy();
    expect(stepErrors(1, { ...d, adminName: 'كريم حسن', adminEmail: 'karim@elsafwa.example' })).toEqual({});
    expect(stepErrors(1, { ...d, adminName: 'كريم حسن', adminEmail: 'karim@elsafwa.example', passwordMode: 'password', password: '123' }).password).toBeTruthy();
    expect(stepErrors(2, { ...d, method: 'vodafone_cash', displayName: 'محفظة', walletPhone: '010 4471' }).walletPhone).toBe('الرقم ناقص. اكتب 11 رقماً تبدأ بـ 01.');
    expect(stepErrors(2, { ...d, method: 'vodafone_cash', displayName: 'محفظة', walletPhone: '٠١٠٤٤٧١٢٢٥٦' })).toEqual({});
    expect(stepErrors(2, { ...d, method: 'later' })).toEqual({});
  });
  it('finds the first step to fix, and knows when something was typed', () => {
    expect(firstBadStep(emptyCompanyDraft())).toBe(0);
    expect(draftTouched(emptyCompanyDraft())).toBe(false);
    expect(draftTouched({ ...emptyCompanyDraft(), adminEmail: 'a' })).toBe(true);
  });
  it('builds what the edge function takes', () => {
    const p = createPayload({ ...emptyCompanyDraft(), name: ' الصفوة ', contactPhone: '010 4471 2256', adminName: 'كريم  حسن', adminEmail: 'Karim@X.example',
      method: 'bank', displayName: 'حساب', bankName: 'الأهلي', bankAccount: '2010 0456', iban: 'eg38 0003' });
    expect(p.contactPhone).toBe('01044712256');
    expect(p.admin).toEqual({ fullName: 'كريم حسن', email: 'karim@x.example', password: '' });
    expect(p.paymentMethod).toMatchObject({ methodType: 'bank', bankAccountNumber: '20100456', iban: 'EG380003', instapayAddress: '' });
    expect(createPayload(emptyCompanyDraft()).paymentMethod).toBeNull();
    expect(digitsOf('٠١٠ 12')).toBe('01012');
  });
  it('sends a refusal to the step that can fix it', () => {
    const d = { ...emptyCompanyDraft(), name: 'الصفوة', adminEmail: 'karim@x.example' };
    expect(createFailure('هذا البريد مسجل بالفعل كمسؤول.', d)).toMatchObject({ step: 1, field: 'adminEmail', action: 'عدّل البريد' });
    expect(createFailure('توجد شركة بهذا الاسم بالفعل.', d)).toMatchObject({ step: 0, field: 'name' });
    expect(createFailure('تعذر إرسال الدعوة بالبريد (x).', d)).toMatchObject({ step: 1, field: 'passwordMode' });
    expect(createFailure('Failed to fetch', d).step).toBeNull();
    expect(createFailure('', d, false).text).toContain('انقطع الاتصال');
  });
});

describe('universities and colleges', () => {
  const all = [{ id: '1', name: 'جامعة المنصورة', city: 'المنصورة', is_active: true }];
  it('needs a name, a city, and no twin', () => {
    expect(universityProblem('جا', '', all)).toEqual({ name: expect.any(String), city: expect.any(String) });
    expect(universityProblem('جامعة  المنصورة', 'المنصورة', all).name).toContain('توجد جامعة');
    expect(universityProblem('جامعة المنصورة', 'المنصورة الجديدة', all, '1')).toEqual({});
  });
  it('colleges', () => {
    const colleges = [{ id: 'c', university_id: '1', name: 'الهندسة', is_active: true }];
    expect(collegeProblem('الهندسة', colleges, '1')).toBeTruthy();
    expect(collegeProblem('الهندسة', colleges, '2')).toBeNull();
    const counts = { universities: [], colleges: [{ university_id: '1', college: 'الهندسة ', students: 3 }, { university_id: '1', college: 'الطب', students: 1 }] };
    expect(collegeStudents(counts, '1', 'الهندسة')).toBe(3);
    expect(collegeStudents(undefined, '1', 'الهندسة')).toBeNull();
  });
});

describe('defaults', () => {
  it('February has no 31st', () => {
    expect(dayProblem(31, 2)).toBe('فبراير ليس فيه يوم 31. اكتب يوماً من 1 إلى 28.');
    expect(dayProblem(30, 9)).toBeNull();
    expect(dayProblem('', 1)).toBeTruthy();
  });
  const terms: TermRow[] = [
    { code: 'first', name: 'الفصل الأول', sort_order: 1, start_month: 9, start_day: 20, end_month: 1, end_day: 15, is_on_sale: true },
    { code: 'second', name: 'الفصل الثاني', sort_order: 2, start_month: 2, start_day: 7, end_month: 6, end_day: 10, is_on_sale: true },
    { code: 'summer', name: 'الفصل الصيفي', sort_order: 3, start_month: 7, start_day: 1, end_month: 8, end_day: 31, is_on_sale: false },
  ];
  it('says the terms in one line', () => {
    expect(shortTerm('الفصل الدراسي الأول')).toBe('الأول');
    expect(termsLine(terms)).toBe('الأول 20 سبتمبر – 15 يناير · الثاني 7 فبراير – 10 يونيو · الصيفي 1 يوليو – 31 أغسطس');
    expect(saleLine(terms)).toBe('الفصل الأول والثاني معروضان · الصيفي موقوف حتى يفتحه المدير');
  });
  it('counts who follows the platform', () => {
    expect(followers([
      { id: '1', status: 'active', vote_closes_at: null, annual_subscription_enabled: true, daily_subscription_enabled: false },
      { id: '2', status: 'active', vote_closes_at: '05:00', annual_subscription_enabled: false, daily_subscription_enabled: true },
      { id: '3', status: 'suspended', vote_closes_at: null, annual_subscription_enabled: true, daily_subscription_enabled: true },
    ])).toEqual({ working: 2, followVote: 1, annual: 1, daily: 1 });
  });
});

describe('notifications', () => {
  const row = (o: Partial<NoteRow>): NoteRow => ({ id: Math.random().toString(), type: 'announcement.admin', title: 't', body: 'b', status: 'sent', created_at: '2026-10-05T15:00:00Z',
    scheduled_at: null, sent_at: '2026-10-05T15:00:00Z', students: 10, read: 5, opened: 1, priority: 'normal', sender_name: null, sender_role: 'admin', audience: null, push: null, ...o });
  it('shows one platform announcement once', () => {
    const g = groupNotes([row({ type: 'announcement.platform', students: 3 }), row({ type: 'announcement.platform', students: 4, created_at: '2026-10-05T15:00:30Z' }), row({})]);
    expect(g).toHaveLength(2);
    expect(g[0].rows).toHaveLength(2);
    expect(g[0].students).toBe(7);
  });
  it('says when, in Cairo', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    expect(whenText('2026-10-10T03:40:00Z', now)).toBe('اليوم 6:40 ص');
    expect(whenText('2026-10-09T17:12:00Z', now)).toBe('أمس 8:12 م');
    expect(whenText('2026-10-11T06:00:00Z', now)).toBe('غداً 9:00 ص');
    expect(whenText('2026-10-05T15:00:00Z', now)).toBe('5 أكتوبر 6:00 م'); // Cairo is UTC+3 in October
  });
});

describe('app versions', () => {
  const row = { platform: 'android' as const, min_version: '2.3.0', latest_version: '2.5.0', whats_new: [], store_url: null };
  it('puts each rule under its field', () => {
    expect(draftErrors({ ...draftFromRow(row), minVersion: '2.6.0' }).minVersion).toBe('أقل إصدار مسموح لا يمكن أن يكون أحدث من آخر إصدار.');
    expect(draftErrors({ ...draftFromRow(row), latestVersion: 'v2.5' }).latestVersion).toBeTruthy();
    expect(draftErrors({ ...draftFromRow(row), storeUrl: 'play.google.com' }).storeUrl).toBe('رابط المتجر يجب أن يبدأ بـ https://');
    expect(readAs('2.5')).toBe('2.5.0');
    expect(readAs('2.5.0')).toBeNull();
  });
  it('asks before raising the minimum', () => {
    expect(raisesMinimum(row, { ...draftFromRow(row), minVersion: '2.5.0' })).toBe(true);
    expect(raisesMinimum(row, { ...draftFromRow(row), minVersion: '2.3' })).toBe(false);
  });
});

describe('sign-in', () => {
  it('never shows the service text', () => {
    expect(signInProblem('Invalid login credentials')).toBe('credentials');
    expect(signInProblem('Email not confirmed')).toBe('unconfirmed');
    expect(signInProblem('Failed to fetch')).toBe('network');
    expect(signInProblem('anything', false)).toBe('network');
    expect(signInProblem('Request rate limit reached')).toBe('busy');
    expect(signInProblem('boom')).toBe('other');
  });
});
