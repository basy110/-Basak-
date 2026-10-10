import { assertCompanyAccess, requireAdmin } from '../_shared/admin-auth.ts';
import { errorMessage, errorStatus, HttpError, jsonResponse, preflight } from '../_shared/http.ts';
import { isEgyptianMobile, loginEmail, normalizeEgyptianPhone } from '../_shared/phone.ts';

// Correct a supervisor's name or phone number (company admin of his company, or
// the platform admin).
//
// The phone is also how he signs in (<phone>@busak.app), and the database
// refuses a row whose phone differs from its login (enforce_account_phone), so a
// new number moves the sign-in account first and the row second; if the row
// cannot be saved the sign-in account is put back. One number, one account:
// a number already used by a student, another supervisor or any other sign-in
// account is refused before anything changes.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, phone, full_name, is_active, profile_image_url';
const TAKEN = 'رقم الهاتف مسجل بالفعل لحساب آخر (طالب أو مشرف).';

Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requireAdmin(request);
    const { serviceClient } = context;
    const body = await request.json();
    const supervisorId = String(body.supervisorId ?? '').trim();
    const fullName = String(body.fullName ?? '').trim().replace(/\s+/g, ' ');
    const phone = normalizeEgyptianPhone(body.phone);
    if (!UUID.test(supervisorId)) return jsonResponse({ error: 'اختر المشرف أولاً.' }, 400);
    if (fullName.length < 2 || fullName.length > 80) return jsonResponse({ error: 'اكتب اسم المشرف.' }, 400);
    if (!isEgyptianMobile(phone)) {
      return jsonResponse({ error: 'رقم الهاتف غير صحيح. اكتب رقماً مصرياً من 11 رقماً.' }, 400);
    }

    const { data: supervisor, error: lookupError } = await serviceClient
      .from('supervisors').select('id, company_id, phone, full_name').eq('id', supervisorId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!supervisor) return jsonResponse({ error: 'المشرف غير موجود.' }, 404);
    assertCompanyAccess(context, supervisor.company_id);

    const phoneChanged = phone !== supervisor.phone;
    let restoreLogin: (() => Promise<unknown>) | null = null;

    if (phoneChanged) {
      const [student, other] = await Promise.all([
        serviceClient.from('students').select('id').eq('phone', phone).maybeSingle(),
        serviceClient.from('supervisors').select('id').eq('phone', phone).neq('id', supervisor.id).maybeSingle(),
      ]);
      if (student.error) throw student.error;
      if (other.error) throw other.error;
      if (other.data) throw new HttpError(409, 'رقم الهاتف مسجل بالفعل لمشرف آخر.');
      if (student.data) throw new HttpError(409, 'رقم الهاتف مسجل بالفعل لطالب.');

      // Only a phone login moves with the number (a supervisor may sign in by e-mail).
      const { data: login, error: loginError } = await serviceClient.auth.admin.getUserById(supervisor.id);
      if (loginError && !/not found/i.test(loginError.message)) throw loginError;
      const current = login?.user?.email ?? '';
      if (current.endsWith('@busak.app')) {
        const { error: moveError } = await serviceClient.auth.admin.updateUserById(supervisor.id, {
          email: loginEmail(phone), email_confirm: true,
          user_metadata: { ...(login?.user?.user_metadata ?? {}), phone, full_name: fullName },
        });
        if (moveError) {
          if (/already|registered|exists/i.test(moveError.message)) throw new HttpError(409, TAKEN);
          throw moveError;
        }
        restoreLogin = () => serviceClient.auth.admin.updateUserById(supervisor.id, {
          email: current, email_confirm: true, user_metadata: login?.user?.user_metadata ?? {},
        });
      }
    }

    const { data: row, error: saveError } = await serviceClient.from('supervisors')
      .update({ full_name: fullName, phone }).eq('id', supervisor.id).select(COLUMNS).single();
    if (saveError || !row) {
      if (restoreLogin) {
        const { error: restoreError } = await restoreLogin() as { error?: { message: string } | null };
        if (restoreError) console.error('admin-update-supervisor: login not restored', supervisor.id);
      }
      if (saveError && /duplicate|unique|23505/i.test(`${saveError.code ?? ''} ${saveError.message}`)) throw new HttpError(409, TAKEN);
      throw saveError ?? new Error('تعذر حفظ بيانات المشرف.');
    }
    return jsonResponse({ supervisor: row, phoneChanged });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error, 'تعذر حفظ بيانات المشرف.') }, errorStatus(error));
  }
});
