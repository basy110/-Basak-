import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge, Button, Card, Dialog, EmptyState, ErrorState, FieldRow, Note, Page, PageHeader, PhoneBar, SkeletonForm, TextField,
  cairo, dayText, errorText, useOnline,
} from '../../ui';
import { supabase } from '../../lib/supabase';
import { keys, STALE, unwrap, usePageData } from '../../lib/query';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import {
  PLATFORMS, WHATS_NEW_MAX, draftChanged, draftErrors, draftFromRow, filledLines, neverSet, platformLabel, raisesMinimum, readAs, storeName, toSave,
  type AppVersionDraft, type AppVersionRow, type Platform,
} from '../../lib/appVersions';
import { AppPreview } from '../../components/platform/AppPreview';

const versionsKey = keys.platform('appVersions');
const COLUMNS = 'platform, min_version, latest_version, whats_new, store_url, updated_at';

/**
 * «إصدارات التطبيق» (docs/canvas/AdmPlatVersions*): for each store, the oldest
 * version still allowed in, the newest one, what is new and where to get it, with
 * what the student will see drawn as it is typed. Raising the minimum stops the app
 * for everyone older, so it asks first.
 */
export const AppVersionsPage: React.FC = () => {
  const page = usePageData(versionsKey, () => unwrap<AppVersionRow[]>(supabase.from('app_versions').select(COLUMNS).order('platform')), { staleTime: STALE.reference });
  const [tab, setTab] = useState<Platform>('android');
  const header = <PageHeader title="إصدارات التطبيق" sub="متى يطلب التطبيق من الطالب والمشرف أن يحدّث، وماذا يقول له. يقرأ التطبيق هذه القيم عند كل فتح." />;
  const tabs = (
    <div role="tablist" aria-label="المتجر" className="-mx-4 flex border-b border-hair px-4 sm:mx-0 sm:px-0">
      {PLATFORMS.map((p) => (
        <button key={p} role="tab" type="button" aria-selected={tab === p} id={`tab-${p}`} aria-controls={`panel-${p}`} onClick={() => setTab(p)}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const n = tab === 'android' ? 'ios' : 'android'; setTab(n); document.getElementById(`tab-${n}`)?.focus(); } }}
          tabIndex={tab === p ? 0 : -1}
          className={`-mb-px flex h-12 flex-1 items-center justify-center gap-2 border-b-2 px-4 text-small sm:flex-none sm:justify-start ${tab === p ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-2 hover:text-ink'}`}>
          <span>{platformLabel[p]}</span><span dir="ltr" className="text-cap font-normal text-ink-3">{storeName[p]}</span>
        </button>
      ))}
    </div>
  );
  if (page.loading) return <Page>{header}{tabs}<SkeletonForm rows={4} /></Page>;
  if (page.error && !page.data) return <Page>{header}<ErrorState card title="تعذّر تحميل الإصدارات" text="تأكد من اتصالك ثم حاول مرة أخرى. لم يتغيّر شيء في التطبيق." onRetry={() => void page.reload()} /></Page>;
  const rows = page.data ?? [];
  return (
    <Page>
      {header}
      {tabs}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <VersionForm key={tab} platform={tab} row={rows.find((r) => r.platform === tab)} />
      </div>
    </Page>
  );
};

const VersionForm: React.FC<{ platform: Platform; row: AppVersionRow | undefined }> = ({ platform, row }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const online = useOnline();
  const [d, setD] = useState<AppVersionDraft>(() => draftFromRow(row));
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setD(draftFromRow(row)); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (p: Partial<AppVersionDraft>) => { setTouched(true); setD((x) => ({ ...x, ...p })); };
  const errors = draftErrors(d);
  const bad = Object.keys(errors).length > 0;
  const changed = draftChanged(d, row);
  const raising = raisesMinimum(row, d);
  const name = platformLabel[platform];
  const lines = filledLines(d.whatsNew);

  const save = () => void guard('save', async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('save_app_version', toSave(platform, d));
    setBusy(false);
    if (error) { notifyError(`لم يُحفظ إصدار ${name}`, errorText(error)); return; }
    const saved = data as AppVersionRow | null;
    if (saved) client.setQueryData<AppVersionRow[]>(versionsKey, (all) => [...(all ?? []).filter((r) => r.platform !== platform), saved]);
    else await client.invalidateQueries({ queryKey: versionsKey });
    setAsking(false); setTouched(false);
    notifyDone(`حُفظ إصدار ${name}.`, raising ? `من عنده أقدم من ${d.minVersion.trim()} يُطلب منه التحديث للمتابعة.` : undefined);
  });
  const onSave = () => (raising ? setAsking(true) : save());
  const v = (k: 'minVersion' | 'latestVersion') => ({ value: d[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => patch({ [k]: e.target.value }), ltr: true, inputMode: 'decimal' as const, maxLength: 14 });
  const readMin = readAs(d.minVersion); const readLatest = readAs(d.latestVersion);
  const saveBtn = <Button disabled={!changed || bad || !online} loading={busy && !asking} onClick={onSave}>حفظ إصدار {name}</Button>;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Card className="flex flex-col">
        <div className="flex flex-col gap-4 p-4 lg:p-6">
          <div className="hidden items-baseline gap-3 sm:flex"><h2 className="m-0 flex-1 text-card">إصدار {name}</h2>{row?.updated_at && <span className="text-label text-ink-2">آخر حفظ {dayText(cairo(row.updated_at).day)}</span>}</div>
          <FieldRow>
            <TextField label="أقل إصدار مسموح" {...v('minVersion')} error={errors.minVersion}
              help={readMin ? `يُقرأ ${readMin}` : 'من عنده أقدم منه لا يستطيع المتابعة قبل التحديث. تبقى بطاقة الطالب متاحة له.'} />
            <TextField label="آخر إصدار في المتجر" {...v('latestVersion')} error={errors.latestVersion}
              help={readLatest ? `يُقرأ ${readLatest}` : 'من عنده أقدم منه يُعرض عليه التحديث مرة واحدة.'} />
          </FieldRow>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-label"><span className="font-medium">ما الجديد</span> <span className="text-ink-2">حتى ثلاثة أسطر، تظهر للمستخدم كما تكتبها · {WHATS_NEW_MAX} حرفاً للسطر</span></legend>
            {d.whatsNew.map((line, i) => (
              <TextField key={i} aria-label={`السطر ${i + 1} من ما الجديد`} value={line} maxLength={WHATS_NEW_MAX + 20}
                placeholder={i === 0 ? 'مثال: دخول أسرع ببصمة الوجه أو الإصبع' : ''}
                error={line.trim().length > WHATS_NEW_MAX ? errors.whatsNew : undefined}
                onChange={(e) => patch({ whatsNew: d.whatsNew.map((x, j) => (j === i ? e.target.value : x)) })} />
            ))}
          </fieldset>
          <TextField label="رابط التطبيق في المتجر" ltr type="url" value={d.storeUrl} onChange={(e) => patch({ storeUrl: e.target.value })} error={errors.storeUrl}
            placeholder={platform === 'ios' ? 'https://apps.apple.com/app/…' : 'https://play.google.com/store/apps/details?id=…'}
            help="يفتحه زر «تحديث الآن». يجب أن يبدأ بـ https://" />
          {raising && row && (
            <Note tone="warning" title={`رفعت أقل إصدار مسموح من ${row.min_version} إلى ${d.minVersion.trim()}`}>عند الحفظ يتوقف التطبيق عند كل من لم يحدّث على {name}، وسنسألك للتأكيد.</Note>
          )}
          <Note tone="neutral">القيمة 0.0.0 لا تطلب تحديثاً من أحد. أقل إصدار مسموح لا يمكن أن يكون أحدث من آخر إصدار.</Note>
        </div>
        <div className="hidden justify-end gap-2 border-t border-hair px-6 py-3 sm:flex">
          <Button kind="secondary" disabled={!changed} onClick={() => { setD(draftFromRow(row)); setTouched(false); }}>تراجع عن التغييرات</Button>
          {saveBtn}
        </div>
      </Card>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3"><h2 className="m-0 text-card sm:text-section">كما يراه المستخدم</h2>{!neverSet(d) && <span className="hidden sm:inline-flex"><Badge tone="teal">يتغيّر وأنت تكتب</Badge></span>}</div>
        <Card className="p-4 lg:p-5">
          {neverSet(d) ? (
            <EmptyState icon="smartphone" title="لا يُطلب تحديث من أحد"
              text={`اكتب آخر إصدار في ${storeName[platform]} ورابطه ليظهر «تحديث جديد متاح» لمن عنده أقدم منه.`} />
          ) : <AppPreview latest={readAs(d.latestVersion) ?? d.latestVersion.trim()} lines={lines} />}
        </Card>
      </section>
      <PhoneBar>{React.cloneElement(saveBtn, { full: true })}</PhoneBar>
      <Dialog open={asking} onClose={() => setAsking(false)} icon="alert" tone="danger" title={`رفع أقل إصدار مسموح على ${name} إلى ${d.minVersion.trim()}؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(false)}>رجوع</Button>, <Button key="g" kind="danger" loading={busy} onClick={save}>ارفع أقل إصدار</Button>]}>
        <p className="m-0">كل هاتف {name} عليه إصدار أقدم من <span dir="ltr" className="font-semibold text-ink">{d.minVersion.trim()}</span> <b className="text-ink">يتوقف التطبيق عنده فوراً</b>: الطالب لا يؤكد ركوبه ولا يرفع إيصالاً، والمشرف لا يسجّل الصعود، حتى يحدّث من المتجر.</p>
        <p className="m-0">تبقى بطاقة الطالب تعمل. افعل هذا فقط إن كان الإصدار <span dir="ltr" className="font-semibold text-ink">{d.minVersion.trim()}</span> متاحاً في {storeName[platform]} منذ أيام.</p>
      </Dialog>
    </div>
  );
};

