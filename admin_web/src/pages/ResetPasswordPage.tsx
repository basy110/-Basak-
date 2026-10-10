import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/Field';
import { AuthFrame, AuthHead, AuthNote } from '../components/platform/AuthFrame';
import { supabase } from '../lib/supabase';
import { useGuard } from '../lib/guard';

interface ResetPasswordPageProps {
  onComplete: () => void;
}

/** Same as LoginPage's: the sign-in page opens «استعادة كلمة المرور» when it finds it. */
const FORGOT_FLAG = 'basak.admin.forgot';

/**
 * «كلمة مرور جديدة» (docs/canvas/AdmSignInNewPassword*): reached from a recovery or an
 * invitation link. The admin chooses a password and goes straight in; an expired link
 * holds the fields back and offers a new one in one press.
 */
export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({ onComplete }) => {
  const invite = /type=invite/.test(window.location.hash);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [failure, setFailure] = useState('');
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const guard = useGuard();

  // A link that was used before or opened too late arrives without a session.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data }) => { if (live && !data.session) setExpired(true); });
    }, 600);
    return () => { live = false; window.clearTimeout(t); };
  }, []);

  const newLink = () => {
    try { sessionStorage.setItem(FORGOT_FLAG, '1'); } catch { /* private window */ }
    window.history.replaceState({}, document.title, window.location.pathname);
    void supabase.auth.signOut().finally(onComplete);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const e = {
      password: password.length < 8 ? (password ? 'قصيرة. اكتب 8 أحرف على الأقل.' : 'اكتب كلمة المرور الجديدة.') : undefined,
      confirmation: !e0(password) && confirmation !== password ? 'الكلمتان غير متطابقتين. أعد كتابة الثانية.' : undefined,
    };
    setErrors(e);
    setFailure('');
    if (e.password || e.confirmation) return;
    void guard('save', async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setExpired(true); return; }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        // The verified session stays: the admin continues straight into the dashboard.
        window.history.replaceState({}, document.title, window.location.pathname);
        onComplete();
      } catch (err) {
        const m = err instanceof Error ? err.message.toLowerCase() : '';
        if (/expired|invalid.*token|session/.test(m)) setExpired(true);
        else if (/different from the old|same password/.test(m)) setErrors({ password: 'هذه كلمة المرور القديمة نفسها. اختر غيرها.' });
        else if (/weak|pwned|characters/.test(m)) setErrors({ password: 'كلمة مرور ضعيفة أو شائعة. اختر أطول منها، وفيها أرقام وحروف.' });
        else if (/fetch|network/.test(m) || !navigator.onLine) setFailure('تعذّر الاتصال. تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.');
        else setFailure('لم تُحفظ كلمة المرور. حاول مرة أخرى بعد قليل، أو اطلب رابطاً جديداً.');
      } finally {
        setLoading(false);
      }
    });
  };

  return (
    <AuthFrame>
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <AuthHead title={invite ? 'اختر كلمة مرورك' : 'كلمة مرور جديدة'} sub={invite ? 'أهلاً بك في باصك. اختر كلمة مرور لحسابك، ثم تدخل مباشرة.' : 'اختر كلمة مرور جديدة لحسابك، ثم تدخل مباشرة.'} />
        {expired && <AuthNote tone="danger" title="انتهت صلاحية الرابط">{invite ? 'رابط الدعوة يعمل مرة واحدة ولمدة محدودة. اطلب رابطاً جديداً ببريدك.' : 'رابط الاستعادة يعمل مرة واحدة ولمدة قصيرة. اطلب رابطاً جديداً.'}</AuthNote>}
        {failure && <AuthNote tone="danger" title="لم تُحفظ كلمة المرور">{failure}</AuthNote>}
        <div className="flex flex-col gap-4">
          <PasswordField label="كلمة المرور الجديدة" placeholder="8 أحرف على الأقل" autoComplete="new-password" value={password} disabled={expired} maxLength={200}
            onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }} error={errors.password} help="8 أحرف أو أكثر." />
          <PasswordField label="أعد كتابتها" placeholder="أعد كتابة كلمة المرور" autoComplete="new-password" value={confirmation} disabled={expired} maxLength={200}
            onChange={(e) => { setConfirmation(e.target.value); setErrors((x) => ({ ...x, confirmation: undefined })); }} error={errors.confirmation} />
        </div>
        <Button type="submit" full loading={loading} disabled={expired}>حفظ كلمة المرور والدخول</Button>
        {expired && <Button kind="secondary" full onClick={newLink}>اطلب رابطاً جديداً</Button>}
      </form>
    </AuthFrame>
  );
};

/** True when the first field already has its own error (the second is not judged against it). */
const e0 = (password: string) => password.length < 8;
