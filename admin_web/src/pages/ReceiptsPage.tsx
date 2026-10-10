import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, Chips, EmptyState, ErrorState, IconButton, Note, Page, PageHeader, PhoneBar, RecordCard, SearchBox,
  SkeletonCards, SkeletonList, countText, NOUN, useOnline,
} from '../ui';
import { useCompany } from '../lib/adminScope';
import { useCompanyOverview } from '../lib/overview';
import {
  APPROVAL_HOLD_MS, RECEIPTS_BUCKET, filterReceipts, firstName, isAlreadyDecided, lineCounts, listName, shortName, usePendingReceipts, type PendingReceiptRow,
} from '../lib/pendingReceipts';
import { useSignedUrls } from '../lib/signedUrls';
import { useGuard } from '../lib/guard';
import { notify, notifyDone, notifyError, notifyUndoable } from '../lib/toasts';
import { ReceiptImage, type ImageState } from '../components/receipts/ReceiptImage';
import { RejectDialog } from '../components/receipts/RejectDialog';
import { AmountCard, LastAttemptNote, QueueRow, ReceiptFacts, receiptCard, waitedText } from '../components/receipts/ReceiptParts';

/** Desktop from 1024: the queue and the open receipt side by side. Below: the queue, and a receipt as its own page. */
function useWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}
/** «منذ …» moves on by itself. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(t); }, []);
  return now;
}
const waitingText = (n: number) => (n === 1 ? 'إيصال واحد ينتظر' : n === 2 ? 'إيصالان ينتظران' : `${countText(n, NOUN.receipt)} تنتظر`);
const SUB_PHONE = 'الأقدم أولاً. افتح الإيصال لترى الصورة وتقرر.';
const SUB = 'الأقدم أولاً. قارن المبلغ في صورة التحويل بالمبلغ المطلوب، ثم اقبل أو ارفض.';

/**
 * «الإيصالات»: the receipts waiting for a decision, oldest first. The picture opens large with
 * the amount beside it and the two decisions under it. Accepting has no question: the receipt
 * leaves at once, and «تراجع» on the toast takes it back for a few seconds before anything is
 * saved. Rejecting asks for the reason the student will read.
 */
export const ReceiptsPage: React.FC = () => {
  const company = useCompany();
  const base = `/c/${company.id}/receipts`;
  const queue = usePendingReceipts(company.id);
  const overview = useCompanyOverview(company.id).data;
  // How many wait in all: the queue's own count, else the overview's (the sidebar badge's); never fewer than shown.
  const total = queue.loaded && queue.receipts.length === 0 && !queue.hasMore ? 0
    : Math.max(queue.total ?? overview?.pending_receipts ?? 0, queue.receipts.length);
  const wide = useWide();
  const online = useOnline();
  const now = useMinute();
  const guard = useGuard();

  const [params, setParams] = useSearchParams();
  const openId = params.get('r');
  const open = useCallback((id: string | null, replace = false) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('r', id); else n.delete('r'); return n; }, { replace });
  }, [setParams]);

  const [search, setSearch] = useState('');
  const [line, setLine] = useState<string | null>(null);
  const visible = useMemo(() => filterReceipts(queue.receipts, search, line), [queue.receipts, search, line]);
  const lines = useMemo(() => lineCounts(queue.receipts), [queue.receipts]);
  // A line whose receipts are all decided leaves the chips: back to all lines.
  useEffect(() => { if (line && !lines.some((l) => l.line === line)) setLine(null); }, [line, lines]);

  // Another admin decided this one first: it stays open, saying so, until the admin moves on.
  const [stale, setStale] = useState<PendingReceiptRow | null>(null);
  const movedFrom = useRef<{ from: string; to: string | null } | null>(null);

  const found = visible.find((r) => r.id === openId);
  const selected: PendingReceiptRow | undefined = stale && stale.id === openId ? stale : found ?? (wide && !openId ? visible[0] : undefined);
  const index = selected ? visible.findIndex((r) => r.id === selected.id) : -1;
  const lastIndex = useRef(0);
  if (index >= 0) lastIndex.current = index;

  // The open receipt left the queue (decided here or elsewhere): open the one that took its place.
  useEffect(() => {
    if (!openId || found || (stale && stale.id === openId) || !queue.loaded) return;
    const next = visible[Math.min(lastIndex.current, visible.length - 1)];
    open(next?.id ?? null, true);
  }, [openId, found, stale, visible, queue.loaded, open]);

  const signed = useSignedUrls(RECEIPTS_BUCKET, queue.receipts.map((r) => r.imagePath));
  const urlOf = (row: PendingReceiptRow) => (row.imagePath ? signed[row.imagePath] : undefined) ?? row.legacyImageUrl ?? null;
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});
  const [image, setImage] = useState<ImageState>('loading');
  const [zoomSignal, setZoomSignal] = useState(0);
  const [rejecting, setRejecting] = useState<PendingReceiptRow | null>(null);

  const isStale = !!(selected && stale && stale.id === selected.id);
  const canDecide = !!selected && !isStale && image === 'shown' && online;

  /** After a decision: the next receipt (the one at the same place), remembered to come back if the save is refused. */
  const moveOn = (row: PendingReceiptRow) => {
    const at = visible.findIndex((r) => r.id === row.id);
    const rest = visible.filter((r) => r.id !== row.id);
    const next = rest[Math.min(Math.max(at, 0), rest.length - 1)] ?? null;
    movedFrom.current = { from: row.id, to: next?.id ?? null };
    if (stale) setStale(null);
    open(next?.id ?? null, true);
  };

  /** A decision that did not save. The receipt is back in the queue (lib/pendingReceipts.ts), unless another admin decided it. */
  const failed = (row: PendingReceiptRow, verb: 'قبول' | 'رفض', error: unknown, retry: () => void) => {
    const name = shortName(row.studentName);
    if (isAlreadyDecided(error)) {
      const current = new URLSearchParams(window.location.search).get('r');
      if (movedFrom.current?.from === row.id && (current ?? null) === movedFrom.current.to) {
        setStale(row);
        open(row.id, true);
      } else {
        notify({ title: `قرّر مدير آخر في إيصال ${name} قبلك.`, body: 'لم يُحفظ قرارك ولا تحتاج أن تفعل شيئاً.', tone: 'info' });
      }
      return;
    }
    notify({ title: `لم يُحفظ ${verb} إيصال ${firstName(row.studentName)}. ما زال في الانتظار؛ حاول مرة أخرى.`, tone: 'error', action: { label: 'إعادة المحاولة', run: retry } }, 12_000);
  };

  const approve = (row: PendingReceiptRow) => {
    if (!online) return;
    const held = queue.approveLater(row.id, { onError: (error) => failed(row, 'قبول', error, () => { open(row.id); }) });
    if (!held) return;
    moveOn(row);
    const name = shortName(row.studentName);
    notifyUndoable(`قُبل إيصال ${name}. ${row.periodPhase === 'upcoming' ? 'يبدأ الاشتراك في موعده.' : 'صار الاشتراك نشطاً.'}`, () => {
      if (queue.undoApproval(row.id)) open(row.id, true);
      else notifyError('لم يعد التراجع ممكناً', `حُفظ قبول إيصال ${name}.`);
    }, APPROVAL_HOLD_MS);
  };

  const reject = (row: PendingReceiptRow, reason: string) => {
    setRejecting(null);
    if (!online) return;
    moveOn(row);
    void guard(row.id, async () => {
      try {
        await queue.review(row.id, 'rejected', reason);
        notifyDone(`رُفض إيصال ${shortName(row.studentName)}.`, 'يرى الطالب السبب في التطبيق ويستطيع إرسال إيصال جديد.');
      } catch (error) {
        failed(row, 'رفض', error, () => { open(row.id); setRejecting(row); });
      }
    });
  };

  const step = (by: 1 | -1) => {
    if (isStale) { setStale(null); }
    const at = index < 0 ? (by > 0 ? -1 : visible.length) : index;
    const target = visible[at + by];
    if (target) open(target.id, true);
  };
  const nextAfterStale = () => {
    const rest = visible.filter((r) => r.id !== stale?.id);
    setStale(null);
    open(rest[0]?.id ?? null, true);
  };

  // A, R, ↑ ↓ and Z on a desktop, while nothing else has the keyboard.
  const keys = useRef({ approve, step, canDecide, selected, setRejecting });
  keys.current = { approve, step, canDecide, selected, setRejecting };
  useEffect(() => {
    if (!wide) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"]'))) return;
      const k = keys.current;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); k.step(e.code === 'ArrowDown' ? 1 : -1); }
      else if (e.code === 'KeyA' && k.canDecide && k.selected) { e.preventDefault(); k.approve(k.selected); }
      else if (e.code === 'KeyR' && k.canDecide && k.selected) { e.preventDefault(); k.setRejecting(k.selected); }
      else if (e.code === 'KeyZ' && k.selected) { e.preventDefault(); setZoomSignal((z) => z + 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wide]);

  useEffect(() => { setImage('loading'); }, [selected?.id]);

  const header = (
    <PageHeader title="الإيصالات"
      meta={queue.loaded ? <span className="hidden sm:inline-flex"><Badge tone={total ? 'warning' : 'success'}>{total} تنتظر</Badge></span> : undefined}
      sub={<><span className="sm:hidden">{SUB_PHONE}</span><span className="hidden sm:inline">{SUB}</span></>} />
  );

  // ── Loading, failure, nothing waiting ──
  if (queue.loading) {
    return (
      <Page>
        {header}
        <div className="hidden grid-cols-[340px_minmax(0,1fr)] items-start gap-6 lg:grid">
          <SkeletonList rows={5} />
          <Card className="grid grid-cols-[minmax(0,1fr)_minmax(0,316px)] gap-5 p-5">
            <span className="skeleton block h-[400px] rounded-inner" />
            <div className="flex flex-col gap-3"><span className="skeleton block h-[72px] rounded-inner" />
              {[90, 70, 80, 50, 64, 90].map((w, i) => <span key={i} className="skeleton block h-3 rounded" style={{ width: `${w}%` }} />)}</div>
          </Card>
        </div>
        <div className="lg:hidden"><SkeletonCards rows={4} /></div>
      </Page>
    );
  }
  if (queue.error && queue.receipts.length === 0) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل الإيصالات" text="لم نستطع جلب الإيصالات المنتظرة. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={queue.refresh} /></Page>;
  }
  if (queue.receipts.length === 0 && !stale) {
    const firstUse = overview?.members === 0;
    return (
      <Page>
        {header}
        {firstUse
          ? <EmptyState card icon="receipt" title="هنا تراجع إيصالات الدفع"
              text="يحوّل الطالب ثمن الاشتراك إلى حسابك ثم يرسل صورة التحويل من التطبيق. تفتحها هنا، تقارن المبلغ، وتقبل أو ترفض. لم يصل أي إيصال بعد."
              action={<Button kind="secondary" iconEnd="fwd" to={`/c/${company.id}/payment-methods`}>تأكد من وسائل الدفع</Button>} />
          : <EmptyState card icon="check" title="لا إيصالات تنتظرك"
              text="راجعت كل ما وصل. عندما يدفع طالب ويرسل صورة التحويل من التطبيق تظهر هنا فوراً، ويظهر عددها بجانب «الإيصالات» في القائمة." />}
      </Page>
    );
  }

  const chips = (
    <Chips value={line ?? ''} onChange={(v) => setLine(v || null)}
      options={[{ value: '', label: 'كل الخطوط', count: total }, ...lines.map((l) => ({ value: l.line, label: l.line, count: l.count }))]} />
  );
  const searchBox = <SearchBox value={search} onChange={setSearch} placeholder="ابحث باسم الطالب أو هاتفه" className="!bg-ground" />;
  const noMatch = visible.length === 0;
  const more = queue.hasMore && (
    <div className="flex flex-col items-center gap-2 border-t border-hair px-4 py-4 text-center lg:py-3">
      <span className="text-label text-ink-2">معروض <span className="tabular">{queue.receipts.length}</span> من <span className="tabular">{total}</span></span>
      <Button kind="outline" sm loading={queue.loadingMore} onClick={queue.loadMore}>عرض المزيد من الإيصالات</Button>
    </div>
  );
  const noMatchLine = (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="text-small text-ink-2">لا إيصال منتظر بهذا الاسم أو الرقم.</span>
      <Button kind="link" sm onClick={() => { setSearch(''); setLine(null); }}>امسح البحث</Button>
    </div>
  );
  const noMatchPanel = (
    <EmptyState icon="search" title="لا نتيجة للبحث"
      text="البحث في الإيصالات المنتظرة فقط. إن كان إيصال الطالب قد قُبل أو رُفض فستجد حالة اشتراكه في صفحة «الطلاب»."
      action={<Button kind="secondary" iconEnd="fwd" to={`/c/${company.id}/students`}>ابحث في الطلاب</Button>} />
  );

  const decide = (full: boolean) => (
    <>
      <Button kind="dangerQuiet" icon="x" disabled={!canDecide} onClick={() => selected && setRejecting(selected)} className={full ? 'min-w-0 !flex-1' : ''}>رفض</Button>
      <Button kind="primary" icon="check" disabled={!canDecide} onClick={() => selected && approve(selected)} className={full ? 'min-w-0 !flex-[2]' : 'min-w-[160px]'}>قبول الإيصال</Button>
    </>
  );
  const staleNote = isStale && (
    <Note tone="teal" title="قرّر مدير آخر في هذا الإيصال قبلك">لم يُحفظ قرارك ولا تحتاج أن تفعل شيئاً. حالة اشتراك الطالب الآن تجدها في صفحة «الطلاب».</Note>
  );
  const imageBox = (row: PendingReceiptRow, phone?: boolean, className = '') => (
    <ReceiptImage row={row} url={urlOf(row)} onState={setImage} zoomSignal={zoomSignal} phone={phone} className={className} />
  );
  const position = selected && index >= 0 ? <span className="tabular">{index + 1} من {visible.length}</span> : null;
  const dialog = <RejectDialog row={rejecting} onClose={() => setRejecting(null)} onReject={reject} disabled={!online} />;

  // ── Desktop: the queue and the open receipt side by side ──
  if (wide) {
    return (
      <Page>
        {header}
        <div className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-6">
          <Card className="sticky top-[88px] flex max-h-[calc(100vh-112px)] flex-col overflow-hidden">
            <div className="flex flex-col gap-3 p-4">{searchBox}{chips}</div>
            {noMatch ? noMatchLine : (
              <ul className="m-0 min-h-0 list-none overflow-y-auto border-t border-hair p-0 [&>li+li]:border-t [&>li+li]:border-hair" aria-label="الإيصالات المنتظرة">
                {visible.map((row) => (
                  <QueueRow key={row.id} row={row} now={now} url={urlOf(row)} failed={!!thumbFailed[row.id] || (!row.imagePath && !row.legacyImageUrl)} onFail={() => setThumbFailed((f) => ({ ...f, [row.id]: true }))}
                    selected={row.id === selected?.id} onOpen={() => { setStale(null); open(row.id, true); }} />
                ))}
              </ul>
            )}
            {more}
          </Card>

          <Card className="flex min-w-0 flex-col">
            {!selected ? noMatchPanel : (
              <>
                <div className="flex items-center gap-3 border-b border-hair px-6 py-4">
                  <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-ok-bg text-card text-ok">{selected.studentName.trim().charAt(0)}</span>
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 truncate text-card">{selected.studentName}</h2>
                    <div className="truncate text-label text-ink-2">{selected.lineName} · {selected.periodLabel}</div>
                  </div>
                  <span className="text-label text-ink-2">{position}</span>
                  <IconButton icon="up" label="الإيصال السابق" disabled={index <= 0} onClick={() => step(-1)} />
                  <IconButton icon="down" label="الإيصال التالي" disabled={index < 0 || index >= visible.length - 1} onClick={() => step(1)} />
                </div>
                <div className="flex flex-col gap-5 p-5">
                  {staleNote}
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,316px)] items-start gap-5">
                    {imageBox(selected, false, 'h-[560px]')}
                    <div className="flex min-w-0 flex-col gap-3">
                      <AmountCard row={selected} />
                      <LastAttemptNote row={selected} />
                      <ReceiptFacts row={selected} now={now} />
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-4 border-t border-hair px-6 py-4">
                  {isStale ? (
                    <><span className="flex-1" /><Button iconEnd="fwd" onClick={nextAfterStale}>افتح الإيصال التالي</Button></>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-label text-ink-2" aria-label="اختصارات لوحة المفاتيح">
                        <Kbd k="A">قبول</Kbd><Kbd k="R">رفض</Kbd><Kbd k="↑ ↓">الإيصال السابق والتالي</Kbd><Kbd k="Z">تكبير</Kbd>
                      </div>
                      {decide(false)}
                    </>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
        {dialog}
      </Page>
    );
  }

  // ── Phone and tablet: one receipt is a page of its own ──
  if (selected) {
    const next = visible[index + 1];
    return (
      <Page className="flex-1">
        <PageHeader title={listName(selected.studentName)} back={{ label: 'الإيصالات', to: base }} />
        <div className="-mt-5 flex items-center gap-2 sm:mt-0">
          <span className="flex-1 text-label text-ink-2">{position}{position && ' · '}{waitedText(selected.createdAt, now)}</span>
          {isStale
            ? <Button kind="link" sm iconEnd="fwd" onClick={nextAfterStale}>التالي</Button>
            : next && <Button kind="link" sm iconEnd="fwd" onClick={() => open(next.id, true)}>التالي</Button>}
        </div>
        {staleNote}
        <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:items-start sm:gap-6">
          <div className="flex flex-col gap-4">
            <AmountCard row={selected} />
            <LastAttemptNote row={selected} />
            <Card className="hidden px-4 py-1 sm:block"><ReceiptFacts row={selected} now={now} /></Card>
          </div>
          {imageBox(selected, true, '-mx-4 h-[440px] sm:mx-0 sm:h-[560px] sm:rounded-inner')}
          <Card className="px-4 py-1 sm:hidden"><ReceiptFacts row={selected} now={now} /></Card>
        </div>
        <div className="hidden justify-end gap-2 sm:flex">
          {isStale ? <Button iconEnd="fwd" onClick={nextAfterStale}>افتح الإيصال التالي</Button> : decide(false)}
        </div>
        <PhoneBar>
          {isStale ? <Button full iconEnd="fwd" onClick={nextAfterStale}>افتح الإيصال التالي</Button> : <div className="flex gap-2">{decide(true)}</div>}
        </PhoneBar>
        {dialog}
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <div className="flex flex-col gap-3">
        {searchBox}
        {chips}
        <span className="text-label text-ink-2">{waitingText(total)}</span>
      </div>
      {noMatch ? <Card>{noMatchLine}</Card> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((row) => <RecordCard key={row.id} spec={receiptCard(row, now)} onOpen={() => { setStale(null); open(row.id); }} />)}
        </div>
      )}
      {more && <Card>{more}</Card>}
      {dialog}
    </Page>
  );
};

const Kbd: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <span className="inline-flex items-center gap-1.5">
    <kbd dir="ltr" className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md bg-surface px-1.5 font-sans text-cap font-semibold text-ink shadow-ring">{k}</kbd>
    <span>{children}</span>
  </span>
);


