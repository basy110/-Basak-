import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Dialog, EmptyState, ErrorState, Page, PageHeader, PhoneBar, Pill, Section, SelectField, SkeletonList, SkeletonStat, StatCard, TextArea,
  cairo, countText, dayText, errorText, momentText, num, NOUN, useOnline,
} from '../../ui';
import { keys } from '../../lib/query';
import { useGuard } from '../../lib/guard';
import { notifyDone, notifyError } from '../../lib/toasts';
import {
  BANNER_TITLE, MESSAGE_MAX, NOTICE_TITLE, bannerLine, barWidths, defaultMessage, messageProblem, parseTermKey, publishTermRecap, reachText,
  releaseState, sampleStudent, termKeyOf, termLabel, termOptions, unpublishTermRecap, useTermRecap, windowText, withRelease,
  type RecapRanked, type RecapRelease, type RecapTerm, type TermRecapOverview,
} from '../../lib/termRecap';

const TITLE = 'ملخص الفصل';
const SUB = 'ملخص نهاية الفصل لكل الطلاب: أيام ركوبهم ومحطتهم ولقبهم. يظهر في الصفحة الرئيسية للتطبيق بعد أن تنشره، ويصل إشعار لكل طالب.';

/**
 * «ملخص الفصل» — the platform owner publishes the end-of-term recap for everyone.
 * The term's numbers across the platform, what a student sees, and the switch.
 */
export const PlatformRecapPage: React.FC = () => {
  const [picked, setPicked] = useState<RecapTerm | null>(null);
  const page = useTermRecap(picked);
  const data = page.data;
  const header = (meta?: React.ReactNode) => <PageHeader title={TITLE} sub={SUB} meta={meta} />;

  if (page.loading) {
    return (
      <Page>
        {header()}
        <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
          <Card className="p-4 lg:p-5"><SkeletonList rows={3} /></Card>
        </div>
      </Page>
    );
  }
  if (page.error && !data) {
    return <Page>{header()}<ErrorState card title="تعذّر تحميل ملخص الفصل" text="تأكد من اتصالك ثم حاول مرة أخرى. لم يتغيّر شيء عند الطلاب." onRetry={() => void page.reload()} /></Page>;
  }
  if (!data) {
    return (
      <Page>
        {header()}
        <EmptyState card title="نشر الملخص غير متاح بعد" text="يعمل النشر بعد تحديث الخادم. حتى ذلك الحين يظهر الملخص للطلاب بمواعيد الفصل كما كان." />
      </Page>
    );
  }
  const state = releaseState(data.release);
  return (
    <Page>
      {header(state === 'published' ? <Pill tone="success">منشور</Pill> : <Pill tone="neutral">غير منشور</Pill>)}
      <div className="w-full sm:max-w-[420px]">
        <SelectField label="الفصل" value={termKeyOf(data.term)} options={termOptions(data)}
          onChange={(e) => { const t = parseTermKey(e.target.value); if (t) setPicked(t); }}
          help={data.term.start_date ? `${dayText(data.term.start_date)} – ${dayText(data.term.end_date)}` : undefined} />
      </div>
      <TermBody key={termKeyOf(data.term)} data={data} />
    </Page>
  );
};
export default PlatformRecapPage;

/* ── أرقام الفصل ────────────────────────────────────────────────────── */
const Numbers: React.FC<{ data: TermRecapOverview }> = ({ data }) => {
  const t = data.totals;
  const until = data.term.until && data.term.end_date && data.term.until < data.term.end_date ? `حتى ${dayText(data.term.until)}` : 'الفصل كله';
  if (t.students === 0) {
    return (
      <Section title="أرقام الفصل">
        <EmptyState card title="لا ركوب مسجّل في هذا الفصل" text="الملخص يظهر لمن ركب يوماً واحداً على الأقل. اختر فصلاً آخر، أو انشره ليظهر لمن يركب قبل نهايته." />
      </Section>
    );
  }
  return (
    <Section title="أرقام الفصل" meta={<span className="text-label text-ink-3">{until}</span>}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <StatCard label="طلاب ركبوا" value={num(t.students)} hint={`ركبوا يوماً واحداً على الأقل · في المنتصف ${countText(t.median_ride_days ?? 0, NOUN.day)}`} />
        <StatCard label="أيام ركوب" value={num(t.ride_days)} hint={`منها ${num(t.return_days)} بالعودة في الباص`} />
        <StatCard label="مرات صعود مسجّلة" value={num(t.boardings)} hint="بمسح المشرف، ذهاباً وعودة" />
        <StatCard label="الشركات" value={num(t.companies)} hint={`${countText(t.lines, NOUN.line)} · ${countText(t.stations, NOUN.station)} · ${num(t.universities)} جامعة`} />
      </div>
    </Section>
  );
};

/* ── الأكثر ركوباً ──────────────────────────────────────────────────── */
const BarList: React.FC<{ title: string; rows: RecapRanked[]; sub?: (r: RecapRanked) => string | null | undefined; value: (r: RecapRanked) => string }> = ({ title, rows, sub, value }) => {
  const widths = barWidths(rows);
  return (
    <Card className="flex flex-col px-4 py-3.5 sm:px-5 sm:py-4">
      <h3 className="m-0 text-small font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="m-0 mt-2 text-label text-ink-3">لا شيء بعد</p> : (
        <ol className="m-0 mt-1 flex list-none flex-col p-0">
          {rows.map((r, i) => (
            <li key={r.id ?? r.name} className={`flex flex-col gap-1.5 py-2.5 ${i ? 'border-t border-hair' : ''}`}>
              <div className="flex items-baseline gap-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium">{r.name}</span>{sub?.(r) && <span className="block truncate text-cap text-ink-3">{sub(r)}</span>}</span>
                <span className="flex-none text-label text-ink-2 tabular">{value(r)}</span>
              </div>
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded bg-sunken"><div className="h-1.5 rounded bg-teal" style={{ width: `${widths[i]}%` }} /></div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
};
const days = (r: RecapRanked) => `${num(r.ride_days)} يوم ركوب`;
const Ranks: React.FC<{ data: TermRecapOverview }> = ({ data }) => (
  <Section title="الأكثر ركوباً">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <BarList title="المحطات" rows={data.top_stations} value={days} sub={(r) => [r.line_name, r.company_name].filter(Boolean).join(' · ')} />
      <BarList title="الخطوط" rows={data.top_lines} value={days} sub={(r) => r.company_name} />
      <BarList title="الجامعات" rows={data.top_universities} value={(r) => countText(r.students, NOUN.student)} />
      <BarList title="الشركات" rows={data.companies.slice(0, 5)} value={days} sub={(r) => countText(r.students, NOUN.student)} />
    </div>
  </Section>
);

/* ── النشر ──────────────────────────────────────────────────────────── */
/** Everything under the term picker; its draft starts again when another term is picked. */
const TermBody: React.FC<{ data: TermRecapOverview }> = ({ data }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const online = useOnline();
  const release = data.release;
  const state = releaseState(release);
  const term = data.term;
  const label = termLabel(term);
  const [message, setMessage] = useState(release?.message ?? '');
  const [asking, setAsking] = useState<'publish' | 'stop' | null>(null);
  const [busy, setBusy] = useState<'publish' | 'stop' | 'save' | null>(null);
  const problem = messageProblem(message);
  const changed = message.trim() !== (release?.message ?? '');
  const shown = windowText(term);

  const apply = (r: RecapRelease) => {
    client.setQueriesData<TermRecapOverview | null>({ queryKey: keys.platform('termRecap') }, (o) => (o ? withRelease(o, r) : o));
  };
  const publish = (kind: 'publish' | 'save') => void guard('write', async () => {
    setBusy(kind);
    try {
      const r = await publishTermRecap(term, message);
      apply(r);
      setAsking(null);
      if (kind === 'save') notifyDone('حُفظت الرسالة.');
      else notifyDone(`نُشر ملخص ${label}.`, r.notified_now && r.notified_students
        ? `وصل الإشعار إلى ${countText(r.notified_students, NOUN.student)} في ${countText(r.notified_companies ?? 0, NOUN.company)}.`
        : 'يظهر للطلاب في الصفحة الرئيسية للتطبيق. أُرسل الإشعار من قبل، فلم يُرسل مرة ثانية.');
    } catch (e) {
      notifyError(kind === 'save' ? 'لم تُحفظ الرسالة' : 'لم يُنشر الملخص', errorText(e));
    } finally { setBusy(null); }
  });
  const stop = () => void guard('write', async () => {
    setBusy('stop');
    try {
      apply(await unpublishTermRecap(term));
      setAsking(null);
      notifyDone(`أُوقف نشر ملخص ${label}.`, 'اختفى من الصفحة الرئيسية عند الطلاب.');
    } catch (e) {
      notifyError('لم يُوقف النشر', errorText(e));
    } finally { setBusy(null); }
  });

  const primary = state === 'published'
    ? <Button kind="dangerQuiet" disabled={!online} onClick={() => setAsking('stop')}>أوقف النشر</Button>
    : <Button disabled={!online || !!problem} onClick={() => setAsking('publish')}>انشر الملخص</Button>;
  const sentOnce = release?.notified_at;

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
          <Numbers data={data} />
          {data.totals.students > 0 && <Ranks data={data} />}
        </div>
        <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
          <Section title="النشر">
      <Card className="flex flex-col">
        <div className="flex flex-col gap-4 p-4 lg:p-5">
          <p className="m-0 text-small text-ink-2">
            {state === 'published'
              ? `نُشر في ${momentText(release!.published_at)}${release!.published_by_name ? ` · ${release!.published_by_name}` : ''}. يرى كل طالب ركب في ${label} شريط الملخص في الصفحة الرئيسية${shown ? ` ${shown}` : ''}.`
              : state === 'stopped'
                ? `أُوقف النشر في ${momentText(release!.unpublished_at)}. لا يرى الطلاب الملخص حتى تنشره مرة أخرى.`
                : `لم يُنشر بعد. بعد النشر يرى كل طالب ركب في ${label} شريط الملخص في الصفحة الرئيسية${shown ? ` ${shown}` : ''}.`}
          </p>
          <TextArea label="رسالة الإشعار" optional rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder={defaultMessage(term)} error={problem ?? undefined}
            help={sentOnce
              ? `أُرسل الإشعار في ${momentText(sentOnce)} إلى ${countText(release!.notified_students ?? 0, NOUN.student)}. تغيير الرسالة لا يرسل إشعاراً جديداً.`
              : `عنوانه «${NOTICE_TITLE}». تُرسل الرسالة المكتوبة هنا مرة واحدة عند أول نشر · ${num(MESSAGE_MAX)} حرف على الأكثر.`} />
        </div>
        <div className="hidden justify-end gap-2 border-t border-hair px-5 py-3 sm:flex">
          {state === 'published' && <Button kind="secondary" disabled={!changed || !!problem || !online} loading={busy === 'save'} onClick={() => publish('save')}>احفظ الرسالة</Button>}
          {primary}
        </div>
      </Card>
          </Section>
          <Section title="كما يراه الطالب"><StudentPreview data={data} /></Section>
        </div>
      </div>
      <PhoneBar>{React.cloneElement(primary, { full: true })}</PhoneBar>

      <Dialog open={asking === 'publish'} onClose={() => setAsking(null)} title={`نشر ملخص ${label}؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(null)}>رجوع</Button>,
          <Button key="g" loading={busy === 'publish'} disabled={!online} onClick={() => publish('publish')}>انشر الملخص</Button>]}>
        <p className="m-0"><b className="text-ink">سيظهر لكل الطلاب في التطبيق ويصلهم إشعار.</b></p>
        <p className="m-0">{sentOnce ? `أُرسل الإشعار من قبل في ${momentText(sentOnce)}، فلن يُرسل مرة ثانية.` : reachText(data.reach)}</p>
        <p className="m-0">يرى الملخص من ركب يوماً واحداً على الأقل في {label}{shown ? `، في الصفحة الرئيسية ${shown}` : ''}. تستطيع إيقاف النشر في أي وقت.</p>
      </Dialog>
      <Dialog open={asking === 'stop'} onClose={() => setAsking(null)} tone="danger" title={`إيقاف نشر ملخص ${label}؟`}
        actions={[<Button key="b" kind="secondary" onClick={() => setAsking(null)}>رجوع</Button>,
          <Button key="g" kind="danger" loading={busy === 'stop'} disabled={!online} onClick={stop}>أوقف النشر</Button>]}>
        <p className="m-0">يختفي شريط الملخص من الصفحة الرئيسية عند كل الطلاب، ولا يفتحه الإشعار الذي وصلهم.</p>
        <p className="m-0">لا يُحذف شيء ولا يُرسل إشعار. إذا نشرته مرة أخرى يعود كما كان دون إشعار جديد.</p>
      </Dialog>
    </>
  );
};

/* ── كما يراه الطالب ────────────────────────────────────────────────── */
const StudentPreview: React.FC<{ data: TermRecapOverview }> = ({ data }) => {
  const sample = useMemo(() => sampleStudent(data), [data]);
  const body = data.release?.message?.trim() || defaultMessage(data.term);
  const now = cairo(new Date()).time;
  return (
    <Card className="flex flex-col items-center gap-3 p-4 lg:p-5">
      <div aria-hidden="true" className="flex h-[440px] w-[220px] flex-none flex-col gap-2.5 overflow-hidden rounded-[28px] border-[5px] border-ink bg-ground p-3">
        <div className="flex flex-col gap-0.5 rounded-[12px] bg-surface p-2.5 shadow-ring">
          <span className="text-[10px] text-ink-3">منصة باصك · <span dir="ltr">{now}</span></span>
          <span className="text-[12px] font-semibold leading-[18px]">{NOTICE_TITLE}</span>
          <span className="line-clamp-3 text-[10px] leading-[15px] text-ink-2">{body}</span>
        </div>
        <span className="mt-1 text-[11px] font-semibold text-ink-2">الرئيسية</span>
        <div className="flex flex-col rounded-[12px] bg-teal-tint px-3 py-2.5">
          <span className="text-[12px] font-semibold leading-[18px]">{BANNER_TITLE}</span>
          <span className="text-[10px] leading-[15px] text-ink-2">{bannerLine(sample.days)}</span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 rounded-[12px] bg-surface p-3">
          <span className="text-[10px] text-ink-3">{termLabel(data.term)}</span>
          <span className="text-[30px] font-extrabold leading-[36px] tabular">{num(sample.days)}</span>
          <span className="-mt-1 text-[11px] text-ink-2">يوم ركوب هذا الفصل</span>
          <span className="mt-auto border-t border-hair pt-2 text-[10px] text-ink-3">محطتك</span>
          <span className="-mt-1 truncate text-[12px] font-semibold">{sample.station ?? '—'}</span>
          {sample.line && <span className="-mt-1 truncate text-[10px] text-ink-2">{sample.line}</span>}
        </div>
      </div>
      <p className="m-0 max-w-[340px] text-center text-label text-ink-2">
        {data.totals.students > 0
          ? `عيّنة من أرقام الفصل: الطالب في المنتصف ركب ${countText(sample.days, NOUN.day)}، وأكثر محطة ركوباً ${sample.station ?? '—'}. يرى كل طالب أرقامه هو.`
          : 'عيّنة فارغة: لا ركوب مسجّل بعد. يرى كل طالب أرقامه هو.'}
      </p>
    </Card>
  );
};
