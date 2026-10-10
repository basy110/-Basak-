/** Supervisors and company admins: the server functions and edge functions of the «team» area. */
import { registerFunctions, registerRpc } from '../registry';
import { ADMINS, COMPANY_ID } from '../data';

type Row = Record<string, any>;
const COLS = ['id', 'phone', 'full_name', 'is_active', 'profile_image_url'];
const pick = (r: Row) => Object.fromEntries(COLS.map((c) => [c, r[c]]));
const fail = (message: string): never => { throw new Error(message); };
const norm = (p: unknown) => {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('20') && d.length >= 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return d;
};
// Invented boarding counts per supervisor (the sample data has no scan rows).
const scans = (id: string) => [412, 268, 731, 0, 54][Number.parseInt(id.slice(-1), 16) % 5] ?? 0;
// Who has opened their invitation: everyone but the newest sample admin.
const signedIn = (a: Row, newest: string) => (a.id === newest ? null : a.created_at);

registerRpc({
  set_supervisor_lines: ({ p_supervisor_id, p_line_ids }, { tables }) => {
    const sup = tables.supervisors.find((s) => s.id === p_supervisor_id) ?? fail('المشرف غير موجود.');
    tables.supervisor_lines = tables.supervisor_lines.filter((r) => r.supervisor_id !== p_supervisor_id)
      .concat((p_line_ids as string[]).map((line_id) => ({ supervisor_id: p_supervisor_id, line_id, company_id: sup.company_id })));
    return null;
  },
  admin_supervisor_records: ({ p_supervisor_id }) => ({ scans: scans(p_supervisor_id), checked_in: scans(p_supervisor_id), kept: true }),
  admin_list_company_admins: ({ p_company_id }, { tables }) => {
    const rows = tables.admins.filter((a) => a.role === 'company_admin' && (!p_company_id || a.company_id === p_company_id))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const newest = rows[0]?.id;
    return rows.map((a) => ({ id: a.id, email: a.email, full_name: a.full_name, company_id: a.company_id, created_at: a.created_at, last_sign_in_at: signedIn(a, newest) }));
  },
});

registerFunctions({
  'admin-create-supervisor': ({ fullName, phone, password, companyId, lineIds }, { tables }) => {
    const p = norm(phone);
    if (!fullName || !/^01[0125]\d{8}$/.test(p)) fail('أدخل اسم المشرف ورقم هاتف مصري صحيح.');
    if (String(password).length < 8) fail('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    if (!lineIds?.length) fail('اختر خطاً واحداً على الأقل يكون المشرف مسؤولاً عنه.');
    if (tables.supervisors.some((s) => s.phone === p)) fail('رقم الهاتف مسجل بالفعل لمشرف آخر.');
    const id = crypto.randomUUID();
    tables.supervisors.unshift({ id, full_name: fullName, phone: p, company_id: companyId || COMPANY_ID, is_active: true, profile_image_url: null, created_at: new Date().toISOString() });
    (lineIds as string[]).forEach((line_id) => tables.supervisor_lines.push({ supervisor_id: id, line_id, company_id: companyId || COMPANY_ID }));
    return { id, lineIds };
  },
  'admin-delete-supervisor': ({ supervisorId }, { tables }) => {
    const i = tables.supervisors.findIndex((s) => s.id === supervisorId);
    if (i < 0) fail('المشرف غير موجود.');
    tables.supervisors.splice(i, 1);
    tables.supervisor_lines = tables.supervisor_lines.filter((r) => r.supervisor_id !== supervisorId);
    return { deleted: true };
  },
  'admin-update-supervisor': ({ supervisorId, fullName, phone }, { tables }) => {
    const sup = tables.supervisors.find((s) => s.id === supervisorId) ?? fail('المشرف غير موجود.');
    const p = norm(phone);
    if (!/^01[0125]\d{8}$/.test(p)) fail('رقم الهاتف غير صحيح. اكتب رقماً مصرياً من 11 رقماً.');
    if (tables.supervisors.some((s) => s.phone === p && s.id !== supervisorId)) fail('رقم الهاتف مسجل بالفعل لمشرف آخر.');
    if ((tables.students ?? []).some((s) => s.phone === p)) fail('رقم الهاتف مسجل بالفعل لطالب.');
    Object.assign(sup, { full_name: String(fullName).trim(), phone: p });
    return { supervisor: pick(sup), phoneChanged: true };
  },
  'admin-reset-supervisor-password': ({ supervisorId, password }, { tables }) => {
    const sup = tables.supervisors.find((s) => s.id === supervisorId) ?? fail('المشرف غير موجود.');
    if (password && String(password).length < 8) fail('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    return { ok: true, supervisor: pick(sup), password: password || 'Kp4-tw7M-9qe', generated: !password };
  },
  'admin-create-company-admin': ({ companyId, fullName, email, password }, { tables, as }) => {
    if (as !== 'platform') fail('هذا الإجراء متاح لمدير النظام فقط.');
    const e = String(email).trim().toLowerCase();
    if (tables.admins.some((a) => a.email === e)) fail('هذا البريد مسجل لمدير آخر.');
    const company = tables.companies.find((c) => c.id === companyId) ?? fail('الشركة غير موجودة.');
    tables.admins.push({ id: crypto.randomUUID(), email: e, full_name: fullName, role: 'company_admin', company_id: company.id, created_at: new Date().toISOString(),
      companies: { id: company.id, name: company.name, status: company.status } });
    return { invited: !password };
  },
  'admin-delete-company-admin': ({ adminId }, { tables, as }) => {
    if (as !== 'platform') fail('هذا الإجراء متاح لمدير النظام فقط.');
    if (adminId === ADMINS.platform.id) fail('لا يمكنك حذف حسابك الحالي.');
    const i = tables.admins.findIndex((a) => a.id === adminId && a.role === 'company_admin');
    if (i < 0) fail('مدير الشركة غير موجود.');
    tables.admins.splice(i, 1);
    return { deleted: true };
  },
});
