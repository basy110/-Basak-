import { describe, expect, it } from 'vitest';
import {
  actionsFor, companiesText, daysUntil, inviteState, isPhoneRefusal, mainSubscription, openSubscriptions, pastSubscriptions,
  periodName, phoneDigits, shortName, shownOf, studentProblems, studentShown, subscriptionPatch, withStudent, withSubscription,
  type StudentRow, type StudentSubscription,
} from './students';
import { correctionProblem, matchCorrection } from './corrections';

const TODAY = '2026-10-10';
const sub = (patch: Partial<StudentSubscription>): StudentSubscription => ({
  id: 's', status: 'active', type: 'termly', price: 4200, created_at: '2026-09-01T08:00:00Z', start_date: '2026-09-19', end_date: '2027-01-14',
  period_label: 'الفصل الأول 2026/2027', period_phase: 'current', departure_time: '07:15:00', return_time: '15:00:00',
  line_name: 'فارسكور', trip_label: null, trip_university: 'جامعة حورس', ...patch,
});
const student = (subs: StudentSubscription[], patch: Partial<StudentRow> = {}): StudentRow => ({
  id: 'st', phone: '01134567891', full_name: 'عبد الرحمن محمد السيد الشربيني', university: 'جامعة حورس', college: 'الصيدلة',
  profile_image_url: null, created_at: '2026-10-10T08:00:00Z', subscriptions: subs, ...patch,
});

describe('the status a subscription shows', () => {
  it('names the six statuses as the database does', () => {
    expect(shownOf(sub({ status: 'active' }), TODAY)).toBe('active');
    expect(shownOf(sub({ status: 'active', start_date: '2027-02-06', end_date: '2027-06-10' }), TODAY)).toBe('soon');
    expect(shownOf(sub({ status: 'pending_review' }), TODAY)).toBe('review');
    expect(shownOf(sub({ status: 'pending_payment' }), TODAY)).toBe('unpaid');
    expect(shownOf(sub({ status: 'rejected' }), TODAY)).toBe('rejected');
    expect(shownOf(sub({ status: 'expired' }), TODAY)).toBe('ended');
    // Past its last day it is over whatever it says.
    expect(shownOf(sub({ status: 'active', end_date: '2026-06-10' }), TODAY)).toBe('ended');
    expect(shownOf(sub({ status: 'pending_payment', end_date: '2026-06-10' }), TODAY)).toBe('ended');
  });
  it('shows the current open subscription first, then the next, then the latest ended', () => {
    const next = sub({ id: 'next', start_date: '2027-02-06', end_date: '2027-06-10', created_at: '2026-10-01T00:00:00Z' });
    const now = sub({ id: 'now', created_at: '2026-09-01T00:00:00Z' });
    const old = sub({ id: 'old', status: 'expired', start_date: '2026-02-07', end_date: '2026-06-10' });
    const older = sub({ id: 'older', status: 'expired', start_date: '2025-09-20', end_date: '2026-01-15' });
    const s = student([old, next, now, older]);
    expect(openSubscriptions(s, TODAY).map((x) => x.id)).toEqual(['now', 'next']);
    expect(pastSubscriptions(s, TODAY).map((x) => x.id)).toEqual(['old', 'older']);
    expect(mainSubscription(s, TODAY)?.id).toBe('now');
    expect(studentShown(s, TODAY)).toBe('active');
    expect(mainSubscription(student([older, old]), TODAY)?.id).toBe('old');
    expect(studentShown(student([]), TODAY)).toBe('none');
    // The server's word wins when it gave one.
    expect(studentShown(student([now], { status: 'review' }), TODAY)).toBe('review');
  });
});

describe('the named moves of a subscription', () => {
  it('offers only the moves that fit the status; never sets «قيد المراجعة» by hand', () => {
    expect(actionsFor(sub({ status: 'pending_payment' }), TODAY)).toEqual(['activate', 'cancel']);
    expect(actionsFor(sub({ status: 'rejected' }), TODAY)).toEqual(['activate', 'cancel']);
    expect(actionsFor(sub({ status: 'pending_review' }), TODAY)).toEqual([]);
    expect(actionsFor(sub({ status: 'active' }), TODAY)).toEqual(['end', 'revert']);
    expect(actionsFor(sub({ status: 'active', start_date: '2027-02-06', end_date: '2027-06-10' }), TODAY)).toEqual(['end', 'revert']);
    expect(actionsFor(sub({ status: 'expired' }), TODAY)).toEqual(['reactivate']);
    // An ended term whose dates have passed cannot come back.
    expect(actionsFor(sub({ status: 'expired', end_date: '2026-06-10' }), TODAY)).toEqual([]);
    expect(actionsFor(sub({ status: 'active', end_date: '2026-06-10' }), TODAY)).toEqual([]);
  });
  it('puts the answer into the row, keeping the label when the answer has none', () => {
    const page = { rows: [student([sub({ id: 'a', status: 'pending_payment' }), sub({ id: 'b', status: 'expired' })], { status: 'unpaid' })], total: 1 };
    const patch = subscriptionPatch({ id: 'a', status: 'active', start_date: '2026-09-19', end_date: '2027-01-14', paid_at: '2026-10-10T09:00:00Z', period_label: null, period_phase: null }, TODAY);
    const next = withSubscription(page, 'a', patch)!;
    expect(next.rows[0].subscriptions[0]).toMatchObject({ status: 'active', shown: 'active', period_label: 'الفصل الأول 2026/2027', paid_at: '2026-10-10T09:00:00Z' });
    // The row's own status is worked out again from its subscriptions.
    expect(next.rows[0].status).toBeUndefined();
    expect(studentShown(next.rows[0], TODAY)).toBe('active');
    expect(next.total).toBe(1);
  });
  it('adds a correction to one student only', () => {
    const page = { rows: [student([], { id: 'x' }), student([], { id: 'y' })] };
    const next = withStudent(page, 'x', (s) => ({ ...s, corrections: [{ id: 'c', field: 'full_name', old_value: 'a', new_value: 'b', created_at: '' }] }))!;
    expect(next.rows[0].corrections).toHaveLength(1);
    expect(next.rows[1]).toBe(page.rows[1]);
    expect(withStudent(page, 'nope', (s) => s)).toBe(page);
  });
});

describe('words', () => {
  it('calls a student by the first two names, «عبد» kept with its name', () => {
    expect(shortName('عبد الرحمن محمد السيد الشربيني')).toBe('عبد الرحمن محمد');
    expect(shortName('ملك حسام الدين مصطفى الغنام')).toBe('ملك حسام');
    expect(shortName('محمد عبد الله أحمد')).toBe('محمد عبد الله');
    expect(shortName('  كريم  ')).toBe('كريم');
  });
  it('drops the year from a period name', () => {
    expect(periodName('الفصل الأول 2026/2027')).toBe('الفصل الأول');
    expect(periodName('اشتراك يومي')).toBe('اشتراك يومي');
    expect(periodName(null)).toBe('');
  });
  it('counts companies', () => {
    expect([0, 1, 2, 3, 12].map(companiesText)).toEqual(['بلا شركة', 'في شركة واحدة', 'في شركتين', 'في 3 شركات', 'في 12 شركة']);
  });
});

describe('adding a student', () => {
  it('checks step 1 with the server\'s rules, in the board\'s words', () => {
    expect(studentProblems({ fullName: 'كريم وائل', phone: '011 1234', password: 'kareem', universityId: '' })).toEqual({
      fullName: 'اكتب الاسم ثلاثياً على الأقل.', phone: 'الرقم ناقص. اكتب 11 رقماً تبدأ بـ 01.', password: 'كلمة المرور أقصر من 8 أحرف.', universityId: 'اختر الجامعة.',
    });
    expect(studentProblems({ fullName: 'كريم وائل السعيد', phone: '٠١١١٢٣٤٥٦٧٩', password: 'Kareem#4471', universityId: 'u' })).toEqual({});
    expect(studentProblems({ fullName: 'كريم وائل السعيد', phone: '01712345678', password: 'Kareem#4471', universityId: 'u' }).phone).toMatch(/غير صحيح/);
  });
  it('reads Arabic digits and spaces in a phone', () => {
    expect(phoneDigits('٠١١ ٢٣٤٥ ٦٧٨٩')).toBe('01123456789');
    expect(phoneDigits('+20 112')).toBe('20112');
  });
  it('knows which refusals belong under the phone', () => {
    expect(isPhoneRefusal('هذا الطالب مسجل في شركتك بالفعل. أضف له اشتراكاً من قائمة الطلاب.')).toBe(true);
    expect(isPhoneRefusal('توجد دعوة معلقة لهذا الرقم بالفعل. تظهر للطالب في التطبيق.')).toBe(true);
    expect(isPhoneRefusal('الخط غير موجود أو غير نشط.')).toBe(false);
  });
});

describe('invitations', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  it('shows a pending invitation past its day as ended', () => {
    expect(inviteState({ status: 'pending', expires_at: '2026-10-24T10:00:00Z' }, now)).toBe('pending');
    expect(inviteState({ status: 'pending', expires_at: '2026-09-26T10:00:00Z' }, now)).toBe('expired');
    expect(inviteState({ status: 'accepted', expires_at: '2026-09-26T10:00:00Z' }, now)).toBe('accepted');
    expect(inviteState({ status: 'weird', expires_at: '' }, now)).toBe('expired');
  });
  it('counts whole days left', () => {
    expect(daysUntil('2026-10-24T10:00:00Z', now)).toBe(14);
    expect(daysUntil('2026-10-10T11:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-10-01T00:00:00Z', now)).toBe(0);
  });
});

describe('corrections', () => {
  it('waits for a different, four-part name', () => {
    expect(correctionProblem('full_name', 'عبد الرحمن محمد السيد الشربيني', ' عبد الرحمن  محمد السيد الشربيني ')).toBe('اكتب اسماً مختلفاً عن الاسم الحالي.');
    expect(correctionProblem('full_name', 'أ ب ج د', 'أ ب ج')).toBe('اكتب الاسم الرباعي كاملاً.');
    expect(correctionProblem('full_name', 'أ ب ج د', 'أ ب ج هـ')).toBeNull();
    expect(correctionProblem('university', 'جامعة دمياط', 'جامعة دمياط')).toBe('اختر جامعة مختلفة عن الحالية.');
    expect(correctionProblem('university', 'جامعة دمياط', '')).toBe('اختر الجامعة الصحيحة.');
  });
  it('finds a request by student, company or phone digits', () => {
    const row = { student_name: 'ملك حسام', student_phone: '01556789012', company: 'النورس للنقل', old_value: 'جامعة دمياط', new_value: 'جامعة حورس' };
    expect(matchCorrection(row, 'ملك')).toBe(true);
    expect(matchCorrection(row, 'النورس')).toBe(true);
    expect(matchCorrection(row, '٠١٥٥٦')).toBe(true);
    expect(matchCorrection(row, 'سارة')).toBe(false);
    expect(matchCorrection(row, '')).toBe(true);
  });
});
