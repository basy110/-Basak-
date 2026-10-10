import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { PasswordField, TextField } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { AuthFrame, AuthHead, AuthNote } from '../components/platform/AuthFrame';
import { supabase } from '../lib/supabase';
import { AdminProfile } from '../lib/adminScope';
import { loadAdminProfile } from '../lib/adminProfile';
import { useGuard } from '../lib/guard';

interface LoginPageProps {
  onLogin: (admin: AdminProfile) => void;
}

type View = 'signin' | 'forgot' | 'sent' | 'expired';
type Problem = null | 'credentials' | 'notAdmin' | 'network' | 'unconfirmed' | 'busy' | 'other';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Set by the dashboard when a session ran out while working; read once here. */
export const SESSION_EXPIRED_FLAG = 'basak.admin.sessionExpired';
/** Set by the new-password page when its link had expired: open «استعادة كلمة المرور» at once. */
export const FORGOT_FLAG = 'basak.admin.forgot';
const readFlag = (key: string) => { try { const v = sessionStorage.getItem(key); sessionStorage.removeItem(key); return !!v; } catch { return false; } };

/** What went wrong, from the sign-in service's answer; the admin never reads that answer itself. */
export function signInProblem(message: string, online = true): Exclude<Problem, null> {
  const m = message.toLowerCase();
  if (!online || /fetch|network|timeout|load failed/.test(m)) return 'network';
  if (/invalid login|invalid_credentials|user not found|invalid grant/.test(m)) return 'credentials';
  if (/email not confirmed/.test(m)) return 'unconfirmed';
  if (/too many|rate limit|429/.test(m)) return 'busy';
  return 'other';
}

/**
 * «تسجيل الدخول» (docs/canvas/AdmSignIn, AdmSignInStates, AdmSignInForgotPhone): e-mail
 * and password, each problem in plain Arabic above or under the field it is about,
 * and «نسيت كلمة المرور؟» as its own small page that answers the same either way.
 */
export const LoginPage: React.FC<LoginPageProps> = ({ onLogin }) => {
  const linkExpired = /error_code=otp_expired|error=access_denied/.test(window.location.hash);
  const [view, setView] = useState<View>(() => (linkExpired ? 'expired' : readFlag(FORGOT_FLAG) ? 'forgot' : 'signin'));
  const [sessionEnded] = useState(() => readFlag(SESSION_EXPIRED_FLAG));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(0);
  const passwordRef = useRef<HTMLInputElement>(null);
  const guard = useGuard();

  useEffect(() => {
    if (linkExpired) window.history.replaceState({}, document.title, window.location.pathname);
  }, [linkExpired]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const go = (v: View) => { setProblem(null); setFieldErrors({}); setView(v); };

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim();
    const errors = {
      email: !clean ? 'اكتب بريدك الإلكتروني.' : !EMAIL.test(clean) ? 'اكتب البريد الإلكتروني كاملاً، وفيه @ ونقطة.' : undefined,
      password: !password ? 'اكتب كلمة المرور.' : undefined,
    };
    setFieldErrors(errors);
    setProblem(null);
    if (errors.email || errors.password) return;
    void guard('auth', async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: clean, password });
        if (error) throw error;
        const admin = await loadAdminProfile(data.user.id);
        if (!admin) {
          // A student, a supervisor or an account no company holds any more: signed out again.
          await supabase.auth.signOut();
          setProblem('notAdmin');
          setPassword('');
          return;
        }
        onLogin(admin);
      } catch (err) {
        const p = signInProblem(err instanceof Error ? err.message : String((err as { message?: string })?.message ?? ''), navigator.onLine);
        setProblem(p);
        if (p === 'credentials') { setPassword(''); passwordRef.current?.focus(); }
      } finally {
        setLoading(false);
      }
    });
  };

  const sendLink = (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = email.trim();
    if (!EMAIL.test(clean)) { setFieldErrors({ email: clean ? 'اكتب البريد الإلكتروني كاملاً، وفيه @ ونقطة.' : 'اكتب بريدك الإلكتروني.' }); return; }
    setFieldErrors({});
    void guard('auth', async () => {
      setLoading(true);
      setProblem(null);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(clean, { redirectTo: window.location.origin });
        // The same answer whether or not the e-mail is registered; only a failed request is told.
        if (error && signInProblem(error.message, navigator.onLine) === 'network') throw error;
        setView('sent');
        setWait(60);
      } catch {
        setProblem('network');
      } finally {
        setLoading(false);
      }
    });
  };

  const notes: Record<Exclude<Problem, null | 'credentials'>, [tone: 'danger' | 'warning', title: string, text: string]> = {
    notAdmin: ['danger', 'هذا الحساب ليس حساب مدير', 'لوحة الشركات لمديري شركات النقل فقط. إن كنت طالباً أو مشرفاً فادخل من تطبيق باصك.'],
    network: ['danger', 'تعذّر الاتصال', view === 'signin' ? 'تأكد من اتصالك بالإنترنت ثم اضغط «دخول» مرة أخرى.' : 'تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.'],
    unconfirmed: ['warning', 'أكّد بريدك الإلكتروني أولاً', 'أرسلنا إليك رسالة عند إنشاء الحساب. افتحها واضغط الرابط، ثم ادخل.'],
    busy: ['warning', 'محاولات كثيرة', 'انتظر دقيقة ثم حاول مرة أخرى.'],
    other: ['danger', 'تعذّر الدخول الآن', 'حدث خطأ من جهتنا. حاول مرة أخرى بعد قليل، وإن تكرر فتواصل مع إدارة المنصة.'],
  };
  const note = problem && problem !== 'credentials' ? notes[problem] : null;
  const emailField = (
    <TextField label="البريد الإلكتروني" type="email" ltr value={email} autoComplete="username" inputMode="email" maxLength={120}
      onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: undefined })); }} error={fieldErrors.email} />
  );

  if (view === 'expired') {
    return (
      <AuthFrame>
        <div className="flex flex-col gap-6">
          <AuthHead title="كلمة مرور جديدة" sub="اختر كلمة مرور جديدة لحسابك، ثم تدخل مباشرة." />
          <AuthNote tone="danger" title="انتهت صلاحية الرابط">رابط الاستعادة يعمل مرة واحدة ولمدة قصيرة. اطلب رابطاً جديداً.</AuthNote>
          <Button full onClick={() => go('forgot')}>اطلب رابطاً جديداً</Button>
          <Button kind="link" onClick={() => go('signin')} className="self-start">رجوع إلى تسجيل الدخول</Button>
        </div>
      </AuthFrame>
    );
  }

  if (view === 'forgot' || view === 'sent') {
    return (
      <AuthFrame>
        <form className="flex flex-col gap-6" onSubmit={sendLink} noValidate>
          <button type="button" onClick={() => go('signin')} className="inline-flex items-center gap-1.5 self-start text-label font-medium text-teal hover:underline">
            <Icon name="arrowBack" size={14} stroke={2} />رجوع إلى تسجيل الدخول
          </button>
          <AuthHead title="استعادة كلمة المرور" sub="اكتب بريدك الإلكتروني، ونرسل إليه رابطاً تختار منه كلمة مرور جديدة." />
          {view === 'sent' && <AuthNote tone="success" title="إن كان البريد مسجلاً فقد أرسلنا الرابط">افتح بريدك واضغط الرابط. إن لم تجده فانظر في البريد غير المرغوب، ثم أعد المحاولة بعد دقيقة.</AuthNote>}
          {note && <AuthNote tone={note[0]} title={note[1]}>{note[2]}</AuthNote>}
          {emailField}
          {view === 'sent'
            ? <Button type="submit" kind="secondary" full loading={loading} disabled={wait > 0}>{wait > 0 ? `أرسل الرابط مرة أخرى بعد ${wait} ث` : 'أرسل الرابط مرة أخرى'}</Button>
            : <Button type="submit" full loading={loading}>أرسل رابط الاستعادة</Button>}
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <form className="flex flex-col gap-6" onSubmit={signIn} noValidate aria-busy={loading || undefined}>
        <AuthHead title="تسجيل الدخول" sub="ادخل ببريدك الإلكتروني وكلمة المرور التي اخترتها." />
        {sessionEnded && !problem && <AuthNote tone="warning" title="انتهت جلستك">للأمان نطلب الدخول من جديد بعد مدة. ادخل لتعود إلى حيث كنت.</AuthNote>}
        {note && <AuthNote tone={note[0]} title={note[1]}>{note[2]}</AuthNote>}
        <div className="flex flex-col gap-4">
          {emailField}
          <PasswordField ref={passwordRef} label="كلمة المرور" placeholder="كلمة المرور" value={password} autoComplete="current-password" maxLength={200}
            onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); if (problem === 'credentials') setProblem(null); }}
            error={problem === 'credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' : fieldErrors.password} />
          <button type="button" onClick={() => go('forgot')} className="-mt-1 self-start text-label font-medium text-teal hover:underline">نسيت كلمة المرور؟</button>
        </div>
        <Button type="submit" full loading={loading}>دخول</Button>
        <p className="m-0 flex items-start gap-2 text-label text-ink-2"><Icon name="lock" size={14} className="mt-[3px]" />للمديرين فقط. الطلاب والمشرفون يدخلون من تطبيق باصك برقم الهاتف.</p>
      </form>
    </AuthFrame>
  );
};
