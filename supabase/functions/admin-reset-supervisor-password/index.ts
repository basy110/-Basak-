import { assertCompanyAccess, requireAdmin } from '../_shared/admin-auth.ts';
import { errorMessage, errorStatus, jsonResponse, preflight } from '../_shared/http.ts';

// A supervisor forgot his password: the company's admin (or the platform admin)
// gives him a new one. The real Supabase Auth password is changed with the
// service role; Basak never stores it. The new password is returned once, only
// to the admin who asked, so it can be handed over (the dashboard shows it in a
// dialog with a copy button). Nothing else changes: his lines, his photo and
// the boarding records he scanned stay as they are.

// No look-alike characters (0/O, 1/l/I): it is read out over the phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** «Nq7-rb4K-2xm»: 10 characters in three groups, with a digit and a letter. */
function generatePassword(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  if (!/\d/.test(chars) || !/[A-Za-z]/.test(chars)) return generatePassword();
  return `${chars.slice(0, 3)}-${chars.slice(3, 7)}-${chars.slice(7)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const context = await requireAdmin(request);
    const { serviceClient } = context;
    const body = await request.json();
    const supervisorId = String(body.supervisorId ?? '').trim();
    const requested = typeof body.password === 'string' ? body.password : '';
    if (!UUID.test(supervisorId)) return jsonResponse({ error: 'اختر المشرف أولاً.' }, 400);
    if (requested && requested.length < 8) {
      return jsonResponse({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف.' }, 400);
    }
    if (requested.length > 72) return jsonResponse({ error: 'كلمة المرور أطول من اللازم.' }, 400);

    const { data: supervisor, error: lookupError } = await serviceClient
      .from('supervisors').select('id, company_id, full_name, phone').eq('id', supervisorId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!supervisor) return jsonResponse({ error: 'المشرف غير موجود.' }, 404);
    // A company admin acts on his own company's supervisors only.
    assertCompanyAccess(context, supervisor.company_id);

    const password = requested || generatePassword();
    const { error: updateError } = await serviceClient.auth.admin.updateUserById(supervisor.id, { password });
    if (updateError) {
      if (updateError.status === 404 || /not found/i.test(updateError.message)) {
        return jsonResponse({ error: 'لا يوجد حساب دخول لهذا المشرف. احذفه وأضفه من جديد.' }, 409);
      }
      throw updateError;
    }

    return jsonResponse({
      ok: true,
      supervisor: { id: supervisor.id, full_name: supervisor.full_name, phone: supervisor.phone },
      // Shown once by the dashboard; never logged or stored here.
      password,
      generated: !requested,
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error, 'تعذر تغيير كلمة مرور المشرف.') }, errorStatus(error));
  }
});
