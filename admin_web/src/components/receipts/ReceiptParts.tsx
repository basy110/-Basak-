import React from 'react';
import { Badge, Icon, Ltr, Money, Note, agoText, cairo, clock, dayText, phoneText, rangeText, type CardSpec } from '../../ui';
import { isLastAttempt, listName, MAX_ATTEMPTS, type PendingReceiptRow } from '../../lib/pendingReceipts';
import { cairoToday } from '../../lib/time';

/** «منذ ساعة ونصف» where it reads better than a rounded hour; otherwise as everywhere. */
export function waitedText(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  return minutes >= 80 && minutes < 105 ? 'منذ ساعة ونصف' : agoText(iso, now);
}

/** «اليوم 6:12 ص · منذ 3 ساعات», «أمس 9:40 م · …», «8 أكتوبر 10:05 ص · …». */
export function sentText(iso: string, now: Date = new Date()): string {
  const at = cairo(iso);
  const today = cairoToday(now);
  const yesterday = cairoToday(new Date(now.getTime() - 86_400_000));
  const day = at.day === today ? 'اليوم' : at.day === yesterday ? 'أمس' : dayText(at.day, { year: false });
  return `${day} ${clock(at.time)} · ${waitedText(iso, now)}`;
}

/** «من 19 سبتمبر 2026 إلى 14 يناير 2027». */
const periodRange = (from: string, to: string) => (from && to ? `من ${dayText(from)} إلى ${dayText(to)}` : rangeText(from, to));

/** «آخر محاولة» and «دفع مقدم»: what makes a receipt stand out in the queue. */
export const ReceiptTags: React.FC<{ row: PendingReceiptRow; only?: 'last' | 'ahead' }> = ({ row, only }) => (
  <>
    {only !== 'ahead' && isLastAttempt(row) && <Badge tone="danger">آخر محاولة</Badge>}
    {only !== 'last' && row.periodPhase === 'upcoming' && <Badge tone="teal">دفع مقدم</Badge>}
  </>
);

/** The amount to look for in the picture. */
export const AmountCard: React.FC<{ row: PendingReceiptRow }> = ({ row }) => (
  <div className="flex flex-col gap-1 rounded-inner bg-teal-tint px-4 py-3.5 sm:px-5 sm:py-4">
    <span className="text-small font-medium text-ink">المبلغ المطلوب</span>
    <span className="text-[32px] font-semibold leading-10 text-ink"><Money value={row.price} unitClass="text-body" /></span>
    <span className="text-label text-ink-2">يجب أن يطابق المبلغ في الصورة، وأن يكون التحويل إلى حسابك.</span>
  </div>
);

export const LastAttemptNote: React.FC<{ row: PendingReceiptRow }> = ({ row }) => (isLastAttempt(row)
  ? <Note tone="danger" title="آخر محاولة لهذا الطالب">إن رفضت هذا الإيصال فلن يستطيع إرسال إيصال آخر لهذا الاشتراك. راجعه بعناية.</Note>
  : null);

/** Who paid, for what, and when: everything the queue knows about the receipt. */
export const ReceiptFacts: React.FC<{ row: PendingReceiptRow; now?: Date }> = ({ row, now }) => {
  const rows: [string, React.ReactNode][] = [
    ['الطالب', <><div className="font-semibold">{row.studentName}</div><Ltr className="text-label text-ink-2">{phoneText(row.studentPhone)}</Ltr></>],
    ['الجامعة', [row.university, row.college, row.specialisation].filter((x) => x && x !== '—').join(' · ') || '—'],
    ['الخط والمحطة', `${row.lineName} · ${row.stationName}`],
    ['الرحلات', [row.departureTime && `ذهاب ${clock(row.departureTime)}`, row.returnTime && `عودة ${clock(row.returnTime)}`].filter(Boolean).join(' · ') || '—'],
    ['الاشتراك', <>
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.periodLabel || '—'}</span><ReceiptTags row={row} only="ahead" /></div>
      {row.periodStart && <div className="text-label text-ink-2">{periodRange(row.periodStart, row.periodEnd)}</div>}
    </>],
    ['المحاولة', <span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{row.attemptNumber} من {MAX_ATTEMPTS}</span><ReceiptTags row={row} only="last" /></span>],
    ['أُرسل', <span className="font-semibold">{sentText(row.createdAt, now)}</span>],
  ];
  return (
    <dl className="m-0 flex flex-col">
      {rows.map(([k, v], i) => (
        <div key={k} className={`flex items-baseline gap-4 py-3 ${i ? 'border-t border-hair' : ''}`}>
          <dt className="w-[88px] flex-none text-label text-ink-2">{k}</dt>
          <dd className="m-0 min-w-0 flex-1 text-small font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
};

/** A small picture of the receipt in the queue, or its outline while there is none. */
export const Thumb: React.FC<{ url: string | null; failed?: boolean; onFail?: () => void }> = ({ url, failed, onFail }) => (
  <span aria-hidden="true" className="flex h-[52px] w-10 flex-none items-center justify-center overflow-hidden rounded-[8px] bg-surface shadow-[inset_0_0_0_1.5px_#DCE6EC]">
    {url && !failed
      ? <img src={url} alt="" width={40} height={52} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={onFail} />
      : <span className={`flex h-full w-full items-center justify-center ${failed ? 'bg-sunken text-ink-3' : 'text-ink-3'}`}><Icon name={failed ? 'image' : 'receipt'} size={18} /></span>}
  </span>
);

/** One receipt in the queue on a desktop: picture, who, line and amount, how long it has waited. */
export const QueueRow: React.FC<{
  row: PendingReceiptRow; url: string | null; failed: boolean; onFail: () => void; selected: boolean; onOpen: () => void; now?: Date;
}> = ({ row, url, failed, onFail, selected, onOpen, now }) => (
  <li>
    <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}
      className={`flex min-h-[72px] w-full items-center gap-3 px-4 py-2.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${selected ? 'bg-teal-tint shadow-[inset_-3px_0_0_#00658D]' : 'hover:bg-ground'}`}>
      <Thumb url={url} failed={failed} onFail={onFail} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-ink">{listName(row.studentName)}</span>
        <span className="truncate text-label text-ink-2">{row.lineName} · <Money value={row.price} unitClass="text-label" /></span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1">
        <ReceiptTags row={row} />
        <span className="text-label text-ink-2">{waitedText(row.createdAt, now)}</span>
      </span>
    </button>
  </li>
);

/** The same receipt as a phone card: the fields in the order of the desktop panel. */
export const receiptCard = (row: PendingReceiptRow, now?: Date): CardSpec => ({
  title: row.studentName,
  sub: `${row.lineName} · ${row.stationName}`,
  end: <Icon name="fwd" size={18} className="mt-1 text-ink-3" />,
  fields: [
    ['المبلغ المطلوب', <span className="font-semibold"><Money value={row.price} /></span>],
    ['الاشتراك', <span className="inline-flex flex-col items-end gap-1"><span className="font-semibold">{row.periodLabel || '—'}</span><ReceiptTags row={row} only="ahead" /></span>],
    ['المحاولة', <span className="inline-flex items-center gap-2"><ReceiptTags row={row} only="last" /><span className="font-semibold">{row.attemptNumber} من {MAX_ATTEMPTS}</span></span>],
    ['أُرسل', <span className="font-semibold">{waitedText(row.createdAt, now)}</span>],
  ],
});
