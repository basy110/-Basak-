import { describe, expect, it } from 'vitest';
import {
  adminsCount, assignmentMaps, forName, colleaguesOf, emailProblem, fieldOf, filterAdmins, filterSupervisors, generatePassword, impactOn,
  initialOf, isEgyptianMobile, isUnavailable, linesChange, linesPhrase, linesWithoutSupervisor, matchesSearch, normalizePhone,
  passwordProblem, phoneProblem, remainingText, supervisorCounts, supervisorsCount, type CompanyAdmin,
} from './team';
import type { LineName, SupervisorLine, SupervisorRow } from './reference';

const sup = (id: string, full_name: string, phone: string, is_active = true, created_at = '2026-01-01'): SupervisorRow & { created_at: string } =>
  ({ id, full_name, phone, is_active, profile_image_url: null, created_at });
const SUPS = [
  sup('a', 'إبراهيم الدسوقي', '01023456789', true, '2026-01-01'),
  sup('b', 'محمود السيد', '01134567890', true, '2026-02-01'),
  sup('c', 'هاني عبد المقصود', '01245678901', true, '2026-03-01'),
  sup('d', 'طارق سليمان', '01590123456', false, '2026-04-01'),
  sup('e', 'مصطفى كمال', '01289012345', true, '2026-05-01'),
];
const LINES: LineName[] = [
  { id: 'l1', name: 'دمياط الجديدة', is_active: true }, { id: 'l2', name: 'الزرقا', is_active: true },
  { id: 'l3', name: 'شربين', is_active: true }, { id: 'l4', name: 'فارسكور', is_active: true },
  { id: 'l5', name: 'رأس البر', is_active: false }, { id: 'l6', name: 'عزبة البرج', is_active: true },
];
const ASSIGN: SupervisorLine[] = [
  { supervisor_id: 'a', line_id: 'l1' }, { supervisor_id: 'b', line_id: 'l2' }, { supervisor_id: 'c', line_id: 'l4' },
  { supervisor_id: 'c', line_id: 'l5' }, { supervisor_id: 'd', line_id: 'l2' }, { supervisor_id: 'd', line_id: 'l6' },
  { supervisor_id: 'a', line_id: 'l4' },
];
const { linesOf, supervisorsOf } = assignmentMaps(ASSIGN);

describe('words', () => {
  it('names one, two or more lines the Arabic way', () => {
    expect(linesPhrase(['شربين'])).toBe('خط شربين');
    expect(linesPhrase(['شربين', 'عزبة البرج'])).toBe('خطي شربين وعزبة البرج');
    expect(linesPhrase(['فارسكور', 'شربين', 'عزبة البرج'])).toBe('خطوط فارسكور، شربين وعزبة البرج');
  });
  it('counts admins and supervisors', () => {
    expect(adminsCount(1)).toBe('مدير واحد');
    expect(adminsCount(2)).toBe('مديران');
    expect(adminsCount(3)).toBe('3 مديرين');
    expect(adminsCount(38)).toBe('38 مديراً');
    expect(supervisorsCount(9)).toBe('9 مشرفين');
    expect(supervisorsCount(1)).toBe('مشرف واحد');
  });
  it('joins «لـ» to a name', () => {
    expect(forName('الصفوة للرحلات')).toBe('للصفوة للرحلات');
    expect(forName('النورس للنقل')).toBe('للنورس للنقل');
    expect(forName('باصات النيل')).toBe('لباصات النيل');
  });
  it('takes the first letter for a photo-less avatar', () => {
    expect(initialOf(' هاني عبد المقصود')).toBe('ه');
    expect(initialOf('')).toBe('؟');
  });
});

describe('phones and passwords', () => {
  it('reads a number however it is typed', () => {
    expect(normalizePhone('010 4455 6677')).toBe('01044556677');
    expect(normalizePhone('+20 10 4455 6677')).toBe('01044556677');
    expect(normalizePhone('٠١٠٤٤٥٥٦٦٧٧')).toBe('01044556677');
    expect(normalizePhone('1044556677')).toBe('01044556677');
  });
  it('accepts Egyptian mobiles only', () => {
    expect(isEgyptianMobile('01044556677')).toBe(true);
    expect(isEgyptianMobile('01344556677')).toBe(false);
    expect(isEgyptianMobile('0104455667')).toBe(false);
    expect(phoneProblem('')).not.toBe('');
    expect(phoneProblem('010 4455 6677')).toBe('');
    expect(phoneProblem('0123')).not.toBe('');
  });
  it('asks for 8 characters', () => {
    expect(passwordProblem('1234567')).not.toBe('');
    expect(passwordProblem('12345678')).toBe('');
  });
  it('makes a readable password in three groups with a letter and a digit', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[A-Za-z2-9]{3}-[A-Za-z2-9]{4}-[A-Za-z2-9]{3}$/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[A-Za-z]/);
      expect(p).not.toMatch(/[01OIl]/);
    }
  });
  it('tries again when a draw has no digit', () => {
    let call = 0;
    const draws = [new Uint8Array(10).fill(0), Uint8Array.from([0, 1, 2, 46, 4, 5, 6, 7, 8, 9])];
    const p = generatePassword(() => draws[call++]);
    expect(call).toBe(2);
    expect(p).toMatch(/\d/);
  });
});

describe('supervisors list', () => {
  it('counts each chip', () => {
    expect(supervisorCounts(SUPS, linesOf)).toEqual({ all: 5, on: 4, off: 1, nolines: 1 });
  });
  it('finds by name or by any part of the phone, in any digits', () => {
    expect(matchesSearch(SUPS[2], 'هاني')).toBe(true);
    expect(matchesSearch(SUPS[2], '4567 8901')).toBe(true);
    expect(matchesSearch(SUPS[2], '٤٥٦٧')).toBe(true);
    expect(matchesSearch(SUPS[2], 'محمود')).toBe(false);
  });
  it('filters and puts the working ones first', () => {
    expect(filterSupervisors(SUPS, linesOf, { search: '', filter: 'nolines', sort: 'name' }).map((s) => s.id)).toEqual(['e']);
    expect(filterSupervisors(SUPS, linesOf, { search: '', filter: 'off', sort: 'name' }).map((s) => s.id)).toEqual(['d']);
    const all = filterSupervisors(SUPS, linesOf, { search: '', filter: 'all', sort: 'newest' }).map((s) => s.id);
    expect(all).toEqual(['e', 'c', 'b', 'a', 'd']);
  });
  it('names the running lines no working supervisor covers', () => {
    // l2 has b (working); l6 only d (stopped); l3 nobody; l5 is stopped itself.
    expect(linesWithoutSupervisor(LINES, SUPS, supervisorsOf).map((l) => l.name)).toEqual(['شربين', 'عزبة البرج']);
  });
  it('says what stopping a supervisor leaves on each of his lines', () => {
    const impact = impactOn('c', linesOf.get('c')!, LINES, SUPS, supervisorsOf);
    expect(impact.map((i) => [i.line.name, i.others])).toEqual([['فارسكور', ['إبراهيم الدسوقي']], ['رأس البر', []]]);
    // A stopped colleague does not count as cover.
    expect(impactOn('b', ['l2'], LINES, SUPS, supervisorsOf)[0].others).toEqual([]);
  });
  it('tells added from removed lines', () => {
    expect(linesChange(['l1', 'l4'], ['l4', 'l3'])).toEqual({ added: ['l3'], removed: ['l1'] });
  });
  it('puts a server message under the field it is about', () => {
    expect(fieldOf('رقم الهاتف مسجل بالفعل لمشرف آخر.')).toBe('phone');
    expect(fieldOf('كلمة المرور يجب ألا تقل عن 8 أحرف.')).toBe('password');
    expect(fieldOf('اختر خطاً واحداً على الأقل يكون المشرف مسؤولاً عنه.')).toBe('lines');
    expect(fieldOf('هذا البريد مسجل لمدير آخر.')).toBe('email');
    expect(fieldOf('تعذر إضافة المشرف.')).toBeNull();
  });
  it('recognises a function that is not deployed', () => {
    expect(isUnavailable(new Error('تعذر الاتصال بوظيفة الخادم "x". تأكد من نشرها'))).toBe(true);
    expect(isUnavailable(new Error('رقم الهاتف مسجل بالفعل'))).toBe(false);
  });
});

describe('company admins', () => {
  const admin = (id: string, full_name: string, company_id: string, created_at: string, email = `${id}@x.example`): CompanyAdmin =>
    ({ id, full_name, company_id, created_at, email });
  const ALL = [
    admin('1', 'أحمد سعيد النورس', 'c1', '2025-03-14'), admin('2', 'هدى سعيد النورس', 'c1', '2026-09-02'),
    admin('3', 'كريم حسن الشناوي', 'c2', '2026-10-10', 'karim@elsafwa.example'),
  ];
  it('filters by company and search, newest first by default', () => {
    expect(filterAdmins(ALL, { search: '', company: '', sort: 'newest' }).map((a) => a.id)).toEqual(['3', '2', '1']);
    expect(filterAdmins(ALL, { search: '', company: 'c1', sort: 'oldest' }).map((a) => a.id)).toEqual(['1', '2']);
    expect(filterAdmins(ALL, { search: 'ELSAFWA', company: '', sort: 'newest' }).map((a) => a.id)).toEqual(['3']);
    expect(filterAdmins(ALL, { search: 'الصفوة', company: '', sort: 'newest' }, (id) => (id === 'c2' ? 'الصفوة للرحلات' : '')).map((a) => a.id)).toEqual(['3']);
  });
  it('says who is left after a removal', () => {
    expect(remainingText(colleaguesOf(ALL[1], ALL))).toBe('يبقى للشركة مدير واحد: أحمد سعيد النورس.');
    expect(colleaguesOf(ALL[2], ALL)).toEqual([]);
    expect(remainingText([ALL[0], ALL[1]])).toBe('يبقى للشركة مديران.');
  });
  it('checks an e-mail', () => {
    expect(emailProblem('')).not.toBe('');
    expect(emailProblem('mona@elsafwa-trips.example')).toBe('');
    expect(emailProblem('mona@')).not.toBe('');
  });
});
