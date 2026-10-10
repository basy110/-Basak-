import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applySavedBranding, useCompanyOverview } from '../lib/overview';
import {
  BRAND_SOURCE_TYPES, checkBrandDimensions, checkBrandFile, isSquarish, logoUrl, brandFileUrl, nextPath,
  type BrandChange, type BrandKind, type SavedBranding,
} from '../lib/branding';
import { imageSize, removeArtworkFolders, uploadWalletArtwork } from '../lib/walletArtwork';
import { rememberApplied } from '../lib/recentChanges';
import { useGuard } from '../lib/guard';
import { notifyDone, notifyError } from '../lib/toasts';
import { CompanyMark } from './CompanyMark';
import { Badge, Button, FormSection, Icon, Note, SkeletonForm, errorText } from '../ui';

/** The lists a change to the company's row makes out of date that this card has already brought up to date (lib/sync.ts). */
const SHOWN_ALREADY = ['company', 'overview', 'settings', 'switches', 'vote'];
const ACCEPT = BRAND_SOURCE_TYPES.join(',');
/** PostgREST: the function is not in the database yet. */
const MISSING_FUNCTION = 'PGRST202';

const TEXT: Record<BrandKind, { title: string; where: string; advice: string; drop: string }> = {
  logo: {
    title: 'الشعار',
    where: 'الشكل الكامل لعلامة الشركة. يظهر على إيصال الاشتراك، وبطاقة الطالب، وعند اختيار الشركة في التطبيق.',
    advice: 'يُفضّل PNG بخلفية شفافة، بعرض 1024 بكسل أو أكثر. يُقبل أيضاً JPG و WebP حتى 5 ميجابايت. يُحفظ بنسبته كما هو ويُصغَّر إلى 1024 بكسل.',
    drop: 'اسحب صورة الشعار إلى هنا',
  },
  emblem: {
    title: 'الرمز',
    where: 'علامة مربعة صغيرة: بجوار اسم الشركة في القوائم، وفي الإشعارات، وأعلى لوحة التحكم.',
    advice: 'يُفضّل PNG مربع 512×512 بكسل أو أكثر، والرمز في المنتصف بهامش بسيط. يُحفظ داخل مربع 512 بكسل دون قص أي جزء منه.',
    drop: 'اسحب صورة الرمز إلى هنا',
  },
};


interface MarkFieldProps {
  kind: BrandKind;
  companyName: string;
  /** The saved picture's address, if there is one. */
  savedUrl: string | null;
  /** What shows when there is no picture of this kind: the fallback every screen uses. */
  fallback: React.ReactNode;
  change: BrandChange<File>;
  onChange: (change: BrandChange<File>) => void;
  disabled: boolean;
}

/** One mark: where it is used, what to upload, and how it looks on a light and on a dark background. */
const MarkField: React.FC<MarkFieldProps> = ({ kind, companyName, savedUrl, fallback, change, onChange, disabled }) => {
  const text = TEXT[kind];
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const fileUrl = useMemo(() => (change ? URL.createObjectURL(change) : null), [change]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  // The choice was undone or saved from outside: its notes go with it.
  useEffect(() => { if (!change) setNote(''); }, [change]);

  const shown = fileUrl ?? (change === null ? null : savedUrl);
  const pick = async (file: File | undefined) => {
    if (!file || disabled) return;
    setNote('');
    const refused = checkBrandFile(file);
    if (refused) { setProblem(refused); return; }
    setChecking(true);
    try {
      const { width, height } = await imageSize(file);
      const unfit = checkBrandDimensions(kind, width, height);
      if (unfit) { setProblem(unfit); return; }
      setProblem('');
      if (kind === 'emblem' && !isSquarish(width, height)) setNote('الصورة ليست مربعة: ستوضع كاملة في منتصف مربع بهوامش شفافة. للحصول على أفضل شكل ارفع نسخة مربعة.');
      onChange(file);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'تعذر قراءة الصورة.');
    } finally {
      setChecking(false);
    }
  };

  const tile = (dark: boolean) => (
    <div className={`flex h-24 flex-1 items-center justify-center rounded-control p-3 ${dark ? 'bg-ink' : 'bg-surface shadow-ring'}`}>
      {shown
        ? <img src={shown} alt={dark ? `${text.title} على خلفية داكنة` : `${text.title} على خلفية فاتحة`} draggable={false}
            className={kind === 'emblem' ? 'h-16 w-16 rounded-inner object-contain' : 'max-h-full max-w-full object-contain'} />
        : fallback}
    </div>
  );

  return (
    <section aria-label={text.title} className="flex flex-col gap-3">
      <div>
        <h3 className="m-0 flex flex-wrap items-center gap-2 text-small font-semibold">
          {text.title}
          {change instanceof File && <Badge tone="warning">لم يُحفظ بعد</Badge>}
          {change === null && <Badge tone="danger">سيُزال عند الحفظ</Badge>}
        </h3>
        <p className="m-0 mt-0.5 text-label text-ink-2">{text.where}</p>
      </div>

      <div
        onDragOver={(event) => { if (disabled) return; event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); void pick(event.dataTransfer.files?.[0]); }}
        className={`rounded-inner border-2 border-dashed p-3 transition-colors ${over ? 'border-teal bg-teal-tint' : 'border-hair bg-ground'}`}
      >
        <div className="flex gap-3">{tile(false)}{tile(true)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className={`inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-control bg-surface px-3 text-label font-medium text-ink shadow-ring hover:bg-ground focus-within:shadow-focus sm:h-9 ${disabled ? 'pointer-events-none text-disabled' : ''}`}>
            <Icon name="image" size={16} /> {shown ? 'تغيير الصورة' : 'اختيار صورة'}
            <input type="file" accept={ACCEPT} className="sr-only" disabled={disabled} aria-label={`اختيار صورة ${text.title} لشركة ${companyName}`}
              onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void pick(file); }} />
          </label>
          {change !== undefined ? (
            <Button sm kind="secondary" icon="undo" disabled={disabled} onClick={() => { setProblem(''); onChange(undefined); }}>
              {change === null ? 'إبقاء الحالي' : 'تراجع عن الاختيار'}
            </Button>
          ) : savedUrl && (
            <Button sm kind="dangerQuiet" icon="trash" disabled={disabled} onClick={() => { setProblem(''); onChange(null); }}>إزالة</Button>
          )}
          <span className="text-label text-ink-3">{checking ? 'نقرأ الصورة…' : text.drop}</span>
        </div>
      </div>

      {problem && <Note tone="danger">{problem}</Note>}
      {!problem && note && <Note tone="warning">{note}</Note>}
      <p className="m-0 text-label text-ink-3">{text.advice}</p>
    </section>
  );
};

/**
 * The company's identity: its logo and its emblem. Each is uploaded, replaced
 * or removed here and then shown wherever the company is named: this
 * dashboard, the students' app, receipts and the Wallet card.
 */
export const CompanyIdentityCard: React.FC<{ companyId: string; companyName: string }> = ({ companyId, companyName }) => {
  // The overview the workspace frame already keeps: the card asks for nothing of its own.
  const overview = useCompanyOverview(companyId);
  const company = overview.data?.company ?? null;
  const [logo, setLogo] = useState<BrandChange<File>>(undefined);
  const [emblem, setEmblem] = useState<BrandChange<File>>(undefined);
  const [stage, setStage] = useState<'upload' | 'save' | null>(null);
  const guard = useGuard();

  if (!company) {
    return overview.error
      ? <Note tone="danger" title="تعذّر تحميل هوية الشركة" action={<Button kind="link" sm onClick={overview.refresh}>إعادة المحاولة</Button>}>{errorText(overview.error)}</Note>
      : <SkeletonForm rows={2} />;
  }
  // An older database answers without the two fields: saving from here would wipe a logo this page cannot see.
  const known = 'emblem_path' in company && 'logo_path' in company;
  const busy = stage !== null;
  const dirty = logo !== undefined || emblem !== undefined;

  // Uploads what was chosen, saves both paths in one call and shows the server's answer: one run at a time.
  const save = () => guard('save', async () => {
    if (!known || !dirty) return;
    const uploaded: string[] = [];
    try {
      setStage('upload');
      const newLogo = logo instanceof File ? await uploadWalletArtwork(companyId, 'logo', logo) : logo;
      if (typeof newLogo === 'string') uploaded.push(newLogo);
      const newEmblem = emblem instanceof File ? await uploadWalletArtwork(companyId, 'emblem', emblem) : emblem;
      if (typeof newEmblem === 'string') uploaded.push(newEmblem);
      setStage('save');
      const { data, error } = await supabase.rpc('set_company_branding', {
        p_company_id: companyId, p_logo_path: nextPath(company.logo_path, newLogo), p_emblem_path: nextPath(company.emblem_path, newEmblem),
      });
      if (error) {
        throw new Error(error.code === MISSING_FUNCTION ? 'قاعدة البيانات لم تُحدَّث بعد لهذه الخاصية. حاول لاحقاً.' : error.message);
      }
      const saved = data as SavedBranding;
      const logoChanged = saved.logo_path !== (company.logo_path ?? null);
      // The company row's announcement would otherwise read again what is put on screen right here.
      rememberApplied([companyId], SHOWN_ALREADY);
      applySavedBranding(saved);
      setLogo(undefined);
      setEmblem(undefined);
      notifyDone('حُفظت هوية الشركة.', logoChanged
        ? 'الشعار الجديد يظهر على الإيصالات التي تصدر من الآن، وتُحدَّث به بطاقات المحفظة المثبّتة (تُتابَع من صفحة «بطاقة الطالب»)؛ الإيصالات السابقة تحتفظ بشعارها.'
        : 'تظهر الآن في لوحة التحكم وفي تطبيق الطلاب.');
      // What nothing shows any more is removed; a folder still in use is refused by the database.
      void removeArtworkFolders(saved.stale);
    } catch (error) {
      void removeArtworkFolders(uploaded);
      notifyError('لم تُحفظ هوية الشركة', errorText(error));
    } finally {
      setStage(null);
    }
  });

  const logoAfter = logo === null ? null : company.logo_path;
  return (
    <div aria-busy={busy}>
      <FormSection title={<span className="flex items-center gap-3"><CompanyMark name={companyName} brand={company} size="md" />هوية الشركة</span>}
        help={`شعار ${companyName} ورمزها كما يراهما الطلاب والمشرفون. تُحفظ الصور بصيغة PNG بعد تصغيرها هنا في المتصفح. بدون رمز يُستخدم الشعار داخل مربع، وبدون شعار يظهر أول حرف مميِّز من اسم الشركة.`}
        footer={<>
          {dirty && !busy && <Button kind="secondary" onClick={() => { setLogo(undefined); setEmblem(undefined); }}>تراجع عن التغييرات</Button>}
          <Button disabled={!dirty || !known} loading={busy} onClick={() => void save()}>{stage === 'upload' ? 'نرفع الصور…' : stage === 'save' ? 'نحفظ…' : 'حفظ الهوية'}</Button>
        </>}>
        {!known && <Note tone="warning">رفع الشعار والرمز من هنا يحتاج إلى تحديث قاعدة البيانات أولاً. حتى ذلك الحين يُرفع الشعار من صفحة «بطاقة الطالب».</Note>}
        <MarkField kind="logo" companyName={companyName} savedUrl={logoUrl(company)} change={logo} onChange={setLogo} disabled={busy || !known}
          fallback={<span className="text-label text-ink-3">لا يوجد شعار: يظهر اسم الشركة نصاً</span>} />
        <MarkField kind="emblem" companyName={companyName} savedUrl={brandFileUrl(company.emblem_path, 'master.png')} change={emblem} onChange={setEmblem}
          disabled={busy || !known}
          fallback={<CompanyMark name={companyName} brand={{ logo_path: logoAfter }} size="lg" />} />
        <p className="m-0 text-label text-ink-3">ملفات SVG غير مقبولة.</p>
      </FormSection>
    </div>
  );
};
