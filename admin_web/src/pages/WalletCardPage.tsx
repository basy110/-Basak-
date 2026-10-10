import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useCompany } from '../lib/adminScope';
import { keys, unwrap, usePageData } from '../lib/query';
import { invokeEdgeFunction } from '../lib/edgeFunctions';
import { useGuard } from '../lib/guard';
import { notifyDone, notifyError } from '../lib/toasts';
import { ACCEPTED_IMAGES, uploadWalletArtwork, validateImage, walletArtworkUrl } from '../lib/walletArtwork';
import {
  CARD_SWATCHES, TEXT_DARK, TEXT_LIGHT, contrast, isHex, labelColorFor, swatchName, textToneFor, unreadable,
} from '../lib/money';
import {
  Badge, Button, Card, Dialog, ErrorState, Icon, Note, Page, PageHeader, PhoneBar, RadioCards, SkeletonBar, SkeletonForm, TextField,
  cairo, dayText, errorText, num, useOnline,
} from '../ui';
import { ApplePreview, GooglePreview, type CardLook } from '../components/money/WalletPreviews';
import { LeaveDialog, useLeaveGuard } from '../components/money/LeaveGuard';

interface Settings {
  company_id: string; company_name: string; logo_path: string | null; contact_phone: string | null; contact_label: string | null;
  background_color: string; foreground_color: string; label_color: string; card_title: string | null; banner_path: string | null;
  revision: number; updated_at: string | null; updated_by_name: string | null; apple_cards: number; google_cards: number; pending_cards: number;
}
interface Draft { background: string; tone: 'light' | 'dark'; title: string; phone: string; phoneLabel: string }
/** undefined = keep the saved image, null = remove it, File = replace it. */
type ArtworkChange = File | null | undefined;
interface SyncResult { updated: number; failed: number; remaining: number; done: boolean; errors: string[] }
interface Rollout { running: boolean; updated: number; total: number; left: number; failed: boolean }

const PHONE = /^[0-9+][0-9 ()+-]{4,24}$/;
const toDraft = (s: Settings): Draft => ({
  background: isHex(s.background_color) ? s.background_color.toUpperCase() : '#00658D',
  tone: contrast(s.foreground_color, TEXT_LIGHT) < contrast(s.foreground_color, TEXT_DARK) ? 'light' : 'dark',
  title: s.card_title ?? '', phone: s.contact_phone ?? '', phoneLabel: s.contact_label ?? '',
});
const cardsWord = (n: number) => (n === 1 ? 'بطاقة واحدة' : n === 2 ? 'بطاقتين' : n <= 10 ? `${n} بطاقات` : `${num(n)} بطاقة`);

/** «بطاقة الطالب»: the company's Wallet card — its identity, its look, and how far a new design has reached. */
export const WalletCardPage: React.FC = () => {
  const companyId = useCompany().id;
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const queryKey = keys.company(companyId, 'walletCard');
  const fetchSettings = () => unwrap<Settings>(supabase.rpc('get_wallet_card_settings', { p_company_id: companyId }));
  const page = usePageData(queryKey, fetchSettings);
  const settings = page.data ?? null;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [logoChange, setLogoChange] = useState<ArtworkChange>(undefined);
  const [bannerChange, setBannerChange] = useState<ArtworkChange>(undefined);
  const [logoError, setLogoError] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rollout, setRollout] = useState<Rollout | null>(null);
  const [phoneTab, setPhoneTab] = useState<'apple' | 'google'>('apple');
  const colorInput = useRef<HTMLInputElement>(null);

  // A background refresh never overwrites what the admin is editing.
  useEffect(() => {
    if (!settings) return;
    if (draft && base && JSON.stringify(draft) !== JSON.stringify(base)) return;
    const fresh = toDraft(settings);
    setDraft(fresh); setBase(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const load = async (resetDraft: boolean) => {
    try {
      const loaded = await client.fetchQuery({ queryKey, queryFn: fetchSettings, staleTime: 0 });
      if (resetDraft) { const d = toDraft(loaded); setDraft(d); setBase(d); setLogoChange(undefined); setBannerChange(undefined); }
      return loaded;
    } catch { return null; }
  };

  const logoFileUrl = useMemo(() => (logoChange ? URL.createObjectURL(logoChange) : null), [logoChange]);
  const bannerFileUrl = useMemo(() => (bannerChange ? URL.createObjectURL(bannerChange) : null), [bannerChange]);
  useEffect(() => () => { if (logoFileUrl) URL.revokeObjectURL(logoFileUrl); }, [logoFileUrl]);
  useEffect(() => () => { if (bannerFileUrl) URL.revokeObjectURL(bannerFileUrl); }, [bannerFileUrl]);
  const logo = logoFileUrl ?? (logoChange === null || !settings?.logo_path ? null : walletArtworkUrl(settings.logo_path, 'master.png'));
  const banner = bannerFileUrl ?? (bannerChange === null || !settings?.banner_path ? null : walletArtworkUrl(settings.banner_path, 'google.png'));

  const dirty = !!draft && !!base && (JSON.stringify(draft) !== JSON.stringify(base) || logoChange !== undefined || bannerChange !== undefined);
  const leave = useLeaveGuard(dirty && !saving);
  const busy = saving || !!rollout?.running;

  /** The colours to store: the saved ones while colour and writing are untouched, else the chosen writing and its quieter shade. */
  const colours = (d: Draft) => {
    if (settings && base && d.background === base.background && d.tone === base.tone) return { fg: settings.foreground_color, label: settings.label_color };
    const fg = d.tone === 'light' ? TEXT_LIGHT : TEXT_DARK;
    return { fg, label: labelColorFor(fg, d.background) };
  };

  /** Delivers the saved card to this company's installed cards, one batch per call. */
  const publish = async (total: number) => {
    let updated = 0;
    setRollout({ running: true, updated, total, left: total, failed: false });
    try {
      for (;;) {
        const r = await invokeEdgeFunction<SyncResult>('wallet-sync', { companyId });
        updated += r.updated;
        setRollout({ running: !r.done, updated, total, left: Math.max(0, total - updated), failed: false });
        if (r.done) break;
      }
      const left = (await load(false))?.pending_cards ?? 0;
      setRollout({ running: false, updated, total, left, failed: left > 0 });
      if (!left) notifyDone(total ? `وصل التصميم إلى ${cardsWord(updated)}` : 'حُفظ التصميم', total ? undefined : 'أول بطاقة يضيفها طالب تأخذ هذا التصميم.');
    } catch {
      const left = (await load(false))?.pending_cards ?? Math.max(0, total - updated);
      setRollout({ running: false, updated, total, left, failed: true });
    }
  };

  const save = () => guard('save', async () => {
    if (!settings || !draft) return;
    setSaving(true);
    setConfirming(false);
    setRollout(null);
    try {
      const logoPath = logoChange ? await uploadWalletArtwork(companyId, 'logo', logoChange) : logoChange === null ? null : settings.logo_path;
      const bannerPath = bannerChange ? await uploadWalletArtwork(companyId, 'banner', bannerChange) : bannerChange === null ? null : settings.banner_path;
      const { fg, label } = colours(draft);
      const { error } = await supabase.rpc('set_wallet_card_settings', {
        p_company_id: companyId, p_background_color: draft.background, p_foreground_color: fg, p_label_color: label,
        p_card_title: draft.title.trim(), p_banner_path: bannerPath, p_logo_path: logoPath, p_contact_phone: draft.phone.trim(), p_contact_label: draft.phoneLabel.trim(),
      });
      if (error) throw new Error(error.message);
      const saved = await load(true);
      setSaving(false);
      if (saved) await publish(saved.pending_cards);
    } catch (err) {
      setSaving(false);
      // What was chosen stays on the page.
      notifyError('لم يُحفظ التصميم', `اختياراتك ما زالت في الصفحة. ${errorText(err)}`);
    }
  });

  const header = (actions?: React.ReactNode) => (
    <PageHeader title="بطاقة الطالب" phoneActions={false} actions={actions}
      sub={<><span className="sm:hidden">بطاقة الركوب في محفظة هاتف الطالب، باسم شركتك وألوانها.</span><span className="hidden sm:inline">بطاقة الركوب في محفظة هاتف الطالب، باسم شركتك وألوانها. اللون للتمييز فقط؛ النظام هو الذي يتحقق من الاشتراك عند مسح الرمز.</span></>} />
  );
  if (page.error && !settings) {
    return <Page>{header()}<ErrorState card title="تعذّر تحميل بطاقة الطالب" text="لم نستطع جلب التصميم المحفوظ. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void page.reload()} /></Page>;
  }
  if (!settings || !draft) {
    return (
      <Page>{header()}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_430px]">
          <div className="flex flex-col gap-6"><SkeletonForm rows={2} /><SkeletonForm rows={3} /></div>
          <Card className="hidden h-[640px] flex-col gap-4 p-6 lg:flex"><SkeletonBar w={180} h={14} /><span className="skeleton block h-full rounded-inner" /></Card>
        </div>
      </Page>
    );
  }

  const { fg, label } = colours(draft);
  const look: CardLook = { title: draft.title.trim() || settings.company_name, background: draft.background, foreground: fg, label, logo, banner };
  const phoneOk = draft.phone.trim() === '' || PHONE.test(draft.phone.trim());
  const valid = phoneOk && draft.title.trim().length <= 40 && draft.phoneLabel.trim().length <= 30 && !logoError && !bannerError;
  const update = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const custom = !swatchName(draft.background);
  const badRead = unreadable(draft.background, fg);
  const firstUse = !settings.updated_at && settings.apple_cards + settings.google_cards === 0;
  const total = settings.apple_cards + settings.google_cards;
  const pending = !busy && (rollout ? rollout.left : settings.pending_cards);
  const colourName = swatchName(draft.background);
  const colourChanged = draft.background !== base?.background;

  const pick = (set: (c: ArtworkChange) => void, setErr: (e: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const problem = validateImage(file);
    if (problem) { setErr(file.size > 5 * 1024 * 1024 ? 'الصورة أكبر من 5 ميجابايت. اختر صورة أصغر، بصيغة PNG أو JPG.' : problem); return; }
    setErr(''); set(file);
  };
  const ArtRow: React.FC<{ id: string; src: string | null; onPick: (e: React.ChangeEvent<HTMLInputElement>) => void; onRemove: () => void; wide?: boolean; error?: string; help: string }> = ({ id, src, onPick, onRemove, wide, error, help }) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex flex-none items-center justify-center overflow-hidden rounded-control bg-ground shadow-ring ${wide ? 'h-11 w-[132px]' : 'h-11 w-16'}`}>
          {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : <Icon name="image" size={18} className="text-ink-3" />}
        </span>
        <label htmlFor={id} className={`inline-flex h-12 cursor-pointer items-center gap-2 rounded-control bg-surface px-4 text-small font-medium text-ink shadow-ring hover:bg-ground sm:h-11 ${busy || !online ? 'pointer-events-none opacity-50' : ''}`}>
          <Icon name="image" size={18} />{src ? 'تغيير الصورة' : 'اختيار صورة'}
          <input id={id} type="file" accept={ACCEPTED_IMAGES} className="sr-only" onChange={onPick} disabled={busy || !online} />
        </label>
        {src && <Button kind="link" icon="trash" disabled={busy} onClick={onRemove}>إزالة</Button>}
      </div>
      {error ? <div role="alert" className="flex items-start gap-1.5 text-label text-bad"><Icon name="alert" size={14} stroke={2} className="mt-[3px]" />{error}</div>
        : <div className="text-label text-ink-2">{help}</div>}
    </div>
  );

  const progress = rollout?.running && (
    <Card className="flex flex-col gap-2 px-4 py-4 sm:px-5">
      <div className="flex items-baseline gap-2"><span className="flex-1 text-small font-semibold">حُفظ التصميم، وننشره الآن على البطاقات</span><span className="text-label text-ink-2 tabular">{num(rollout.updated)} من {num(rollout.total)}</span></div>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded bg-sunken"><div className="h-1.5 rounded bg-teal transition-[width]" style={{ width: `${rollout.total ? Math.round((rollout.updated / rollout.total) * 100) : 100}%` }} /></div>
      <div className="text-label text-ink-2">اترك الصفحة مفتوحة حتى ينتهي. إن أغلقتها يبقى التصميم محفوظاً، وتكمل النشر عندما تعود.</div>
    </Card>
  );
  const status = (
    <Card className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5">
      <h2 className="m-0 text-card">أين وصل التصميم</h2>
      {pending ? (
        <Note tone="warning" title={`${cardsWord(pending)} لم ${pending === 1 ? 'يصلها' : 'يصلها'} آخر تصميم بعد`}
          action={<Button sm kind="outline" icon="refresh" className="bg-surface" disabled={!online} onClick={() => void publish(pending)}>أكمل النشر</Button>}>
          هواتف أصحابها كانت مغلقة أو بلا إنترنت. اضغط لنحاول من جديد.
        </Note>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {([['آخر تغيير', settings.updated_at ? dayText(cairo(settings.updated_at).day) : 'التصميم الافتراضي'], ['غيّره', settings.updated_by_name ?? '—'],
          ['بطاقات Apple Wallet', num(settings.apple_cards)], ['بطاقات Google Wallet', num(settings.google_cards)]] as [string, string][]).map(([k, v]) => (
          <div key={k}><dt className="text-cap text-ink-3">{k}</dt><dd className="m-0 text-small font-semibold tabular">{v}</dd></div>
        ))}
      </dl>
    </Card>
  );
  const previewCard = (
    <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:sticky lg:top-6">
      <div><h2 className="m-0 text-card sm:text-section">هكذا تظهر في محفظة الطالب</h2><p className="m-0 text-label text-ink-2">تتغيّر وأنت تختار. الشكل تقريبي.</p></div>
      <div role="tablist" aria-label="المحفظة" className="flex gap-2 lg:hidden">
        {(['apple', 'google'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={phoneTab === t} onClick={() => setPhoneTab(t)} dir="ltr"
            className={`h-10 rounded-full px-3.5 text-label ${phoneTab === t ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink shadow-ring'}`}>{t === 'apple' ? 'Apple Wallet' : 'Google Wallet'}</button>
        ))}
      </div>
      <div className="flex flex-col gap-5 rounded-inner bg-sunken/60 p-4 sm:p-5">
        <div className={`flex-col gap-2 ${phoneTab === 'apple' ? 'flex' : 'hidden lg:flex'}`}><span className="hidden text-cap font-medium text-ink-2 lg:block" dir="ltr">Apple Wallet</span><ApplePreview look={look} /></div>
        <div className={`flex-col gap-2 ${phoneTab === 'google' ? 'flex' : 'hidden lg:flex'}`}><span className="hidden text-cap font-medium text-ink-2 lg:block" dir="ltr">Google Wallet</span><GooglePreview look={look} /></div>
      </div>
      <p className="m-0 text-cap text-ink-2">الخط والمحطة يظهران للطالب صاحب الاشتراك المقبول فقط، وما لا يتوفر يختفي. في Google Wallet تظهر صورة الطالب ورقم التواصل في تفاصيل البطاقة، وهاتف الطالب يختار لون الكتابة.</p>
    </Card>
  );
  const saveLabel = 'حفظ ونشر على البطاقات';

  return (
    <Page>
      {header(<>
        <Button kind="outline" icon="undo" disabled={!dirty || busy} onClick={() => void load(true)}>تراجع عن التغييرات</Button>
        <Button icon="check" disabled={!dirty || !valid || busy || !online} loading={saving} onClick={() => setConfirming(true)}>{saveLabel}</Button>
      </>)}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)] lg:gap-6">
        <div className="flex flex-col gap-4 lg:gap-6">
          {/* Phone: what needs finishing first, then the card itself. */}
          {!!pending && <div className="lg:hidden">{status}</div>}
          <div className="lg:hidden">{previewCard}</div>
          {firstUse && <Note tone="teal" title="بطاقتك تعمل بالتصميم الافتراضي">أضف شعار شركتك واختر لونها متى أردت. أول بطاقة يضيفها طالب تأخذ ما تحفظه هنا.</Note>}
          {rollout && !rollout.running && rollout.failed && rollout.updated > 0 && (
            <Note tone="success" title={`وصل التصميم إلى ${cardsWord(rollout.updated)}`}>بقيت {cardsWord(rollout.left)}. لا يتأثر ركوب أصحابها: الرمز يعمل بأي لون.</Note>
          )}
          {progress}

          <Card className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
            <div><h2 className="m-0 text-card sm:text-section">هوية الشركة</h2><p className="m-0 text-label text-ink-2">تظهر على كل بطاقة، وعلى إيصال الطالب.</p></div>
            <div className="flex flex-col gap-1.5">
              <span className="text-label font-medium text-ink">شعار الشركة</span>
              <ArtRow id="card-logo" src={logo} onPick={pick(setLogoChange, setLogoError)} onRemove={() => { setLogoChange(null); setLogoError(''); }} error={logoError}
                help="يظهر أعلى البطاقة بجوار اسم الشركة. الأفضل صورة PNG بخلفية شفافة، حتى 5 ميجابايت. بلا شعار يظهر الاسم وحده." />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="رقم التواصل" optional ltr inputMode="tel" maxLength={25} value={draft.phone} placeholder="0100 000 0000" disabled={busy}
                onChange={(e) => update({ phone: e.target.value })} error={phoneOk ? undefined : 'اكتب رقماً صحيحاً، أرقاماً فقط.'} help="يظهر في تفاصيل البطاقة لا على وجهها." />
              <TextField label="وصف الرقم" optional maxLength={30} value={draft.phoneLabel} placeholder="مكتب النقل" disabled={busy}
                onChange={(e) => update({ phoneLabel: e.target.value })} help="مثل: مكتب النقل، خدمة العملاء." />
            </div>
          </Card>

          <Card className="flex flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
            <div><h2 className="m-0 text-card sm:text-section">شكل البطاقة</h2><p className="m-0 text-label text-ink-2">اختيارات قليلة ومضمونة القراءة.</p></div>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="لون البطاقة">
              <span className="text-label font-medium text-ink">لون البطاقة</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CARD_SWATCHES.map((s) => {
                  const on = draft.background.toLowerCase() === s.hex.toLowerCase();
                  return (
                    <button key={s.hex} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => update({ background: s.hex, tone: textToneFor(s.hex) })}
                      className={`flex h-12 items-center gap-2.5 rounded-control px-3 text-small sm:h-11 ${on ? 'bg-teal-tint font-semibold shadow-[inset_0_0_0_2px_#00658D]' : 'bg-surface shadow-field hover:shadow-field-hover'}`}>
                      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(23,56,74,.18)]" style={{ background: s.hex }}>
                        {on && <Icon name="check" size={14} stroke={3} className={textToneFor(s.hex) === 'light' ? 'text-white' : 'text-ink'} />}
                      </span>
                      <span className="truncate">{s.name}</span>
                    </button>
                  );
                })}
                {custom && (
                  <button type="button" role="radio" aria-checked onClick={() => colorInput.current?.click()} className="flex h-12 items-center gap-2.5 rounded-control bg-teal-tint px-3 text-small font-semibold shadow-[inset_0_0_0_2px_#00658D] sm:h-11">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full" style={{ background: draft.background }}><Icon name="check" size={14} stroke={3} className={textToneFor(draft.background) === 'light' ? 'text-white' : 'text-ink'} /></span>
                    <span className="truncate">لونك</span>
                  </button>
                )}
              </div>
              <div className="flex">
                <Button kind="link" icon="pencil" disabled={busy} onClick={() => colorInput.current?.click()}>لون آخر</Button>
                <input ref={colorInput} type="color" className="sr-only" tabIndex={-1} aria-label="لون آخر" value={draft.background.toLowerCase()}
                  onChange={(e) => update({ background: e.target.value.toUpperCase(), tone: textToneFor(e.target.value) })} />
              </div>
              <span className="text-label text-ink-2">غيّره مع كل فصل ليعرف المشرف البطاقة الحالية من نظرة.</span>
            </div>
            <RadioCards<'light' | 'dark'> label="لون الكتابة" value={draft.tone} cols={2} onChange={(t) => update({ tone: t })} options={[
              { value: 'light', label: 'فاتحة', sub: 'للألوان الغامقة' }, { value: 'dark', label: 'داكنة', sub: 'للألوان الفاتحة' },
            ]} />
            {badRead ? (
              <Note tone="warning" title="الكتابة لن تُقرأ على هذا اللون"
                action={<Button sm kind="outline" className="bg-surface" onClick={() => update({ tone: draft.tone === 'light' ? 'dark' : 'light' })}>{draft.tone === 'light' ? 'اجعلها داكنة' : 'اجعلها فاتحة'}</Button>}>
                {colourName ? `اللون ال${colourName.split(' ')[0]}` : 'هذا اللون'} {draft.tone === 'light' ? 'فاتح، والكتابة الفاتحة تختفي عليه. اختر «داكنة».' : 'غامق، والكتابة الداكنة تختفي عليه. اختر «فاتحة».'}
              </Note>
            ) : <span className="-mt-2 text-label text-ink-2"><span dir="ltr">في Apple Wallet</span>. العناوين الصغيرة تأخذ درجة أهدأ من اللون نفسه تلقائياً.</span>}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="card-title" className="flex items-baseline gap-2 text-label font-medium text-ink">
                <span>اسم آخر على البطاقة</span><span className="font-normal text-ink-3">اختياري</span><span className="flex-1" /><span className="text-cap font-normal text-ink-3 tabular" dir="ltr">{draft.title.length} / 40</span>
              </label>
              <TextField id="card-title" value={draft.title} maxLength={40} placeholder={settings.company_name} disabled={busy} onChange={(e) => update({ title: e.target.value })}
                help="يظهر مكان اسم الشركة. اتركه فارغاً ليظهر اسم الشركة." />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-2 text-label font-medium text-ink">صورة عرضية أسفل البطاقة<span className="font-normal text-ink-3">اختياري</span><Badge><span dir="ltr">Google Wallet</span> فقط</Badge></span>
              <ArtRow id="card-banner" wide src={banner} onPick={pick(setBannerChange, setBannerError)} onRemove={() => { setBannerChange(null); setBannerError(''); }} error={bannerError}
                help="شريط عريض، عرضه ثلاثة أمثال ارتفاعه تقريباً." />
            </div>
          </Card>

          <div className={pending ? 'hidden lg:block' : ''}>{status}</div>
        </div>
        <div className="hidden lg:block">{previewCard}</div>
      </div>

      <PhoneBar><Button full icon="check" disabled={!dirty || !valid || busy || !online} loading={saving} onClick={() => setConfirming(true)}>{saveLabel}</Button></PhoneBar>

      <Dialog open={confirming} onClose={() => setConfirming(false)} icon="idcard"
        title={total ? `حفظ التصميم ونشره على ${cardsWord(total)}؟` : 'حفظ التصميم؟'}
        actions={[<Button key="b" kind="secondary" onClick={() => setConfirming(false)}>رجوع</Button>, <Button key="s" onClick={() => void save()}>حفظ ونشر</Button>]}>
        {total ? (
          <p className="m-0">
            {colourChanged && colourName ? `يتغيّر لون البطاقة إلى ${colourName.startsWith('ال') ? colourName : `ال${colourName}`}` : 'يتغيّر تصميم البطاقة'} عند كل طالب أضافها إلى محفظته
            {' '}(<span dir="ltr">{num(settings.apple_cards)}</span> على <span dir="ltr">Apple Wallet</span> و<span dir="ltr">{num(settings.google_cards)}</span> على <span dir="ltr">Google Wallet</span>)، خلال دقائق. رمز الركوب واشتراك الطالب لا يتغيّران.
          </p>
        ) : <p className="m-0">لا توجد بطاقات في محافظ الطلاب بعد؛ أول بطاقة يضيفها طالب تأخذ هذا التصميم.</p>}
        <p className="m-0">لا يوجد حفظ بلا نشر: ما تحفظه هو ما يراه الطلاب.</p>
      </Dialog>
      <LeaveDialog guard={leave} what="غيّرت تصميم البطاقة" />
    </Page>
  );
};
