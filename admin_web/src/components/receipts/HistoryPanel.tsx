import React, { useEffect, useState } from 'react';
import { Button, Ltr, Money, Note, Pill, SidePanel, dayText, momentText, phoneText } from '../../ui';
import { RECEIPTS_BUCKET, MAX_ATTEMPTS } from '../../lib/pendingReceipts';
import { useSignedUrls } from '../../lib/signedUrls';
import type { HistoryRow } from '../../lib/receiptsHistory';
import { ReceiptImage } from './ReceiptImage';

/** «تم تأكيد الدفع» / «مرفوض». */
export const OutcomePill: React.FC<{ status: HistoryRow['status'] }> = ({ status }) => (status === 'approved'
  ? <Pill tone="success">تم تأكيد الدفع</Pill>
  : <Pill tone="danger">مرفوض</Pill>);

/** «10 أكتوبر 2026 · 7:30 م»; «—» when unknown. */
export const when = (iso: string | null | undefined) => momentText(iso) || '—';
export const reviewerText = (row: HistoryRow) => row.reviewerName || 'مدير لم يعد في الفريق';

/** Below 640 the panel is a page of its own: the picture's tools take their short labels. */
function usePhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 639px)');
    const on = () => setPhone(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

/** One decided receipt: its picture, the decision and everything known about it. */
export const HistoryPanel: React.FC<{ row: HistoryRow | null; onClose: () => void; studentsPath: string }> = ({ row, onClose, studentsPath }) => {
  const signed = useSignedUrls(RECEIPTS_BUCKET, row?.imagePath ? [row.imagePath] : []);
  const phone = usePhone();
  if (!row) return null;
  const url = (row.imagePath ? signed[row.imagePath] : undefined) ?? row.legacyImageUrl ?? null;
  const facts: [string, React.ReactNode][] = [
    ['الطالب', <><div className="font-semibold">{row.studentName}</div>{row.studentPhone && <Ltr className="text-label text-ink-2">{phoneText(row.studentPhone)}</Ltr>}</>],
    ['الخط والمحطة', `${row.lineName} · ${row.stationName}`],
    ['الاشتراك', <><div className="font-semibold">{row.periodLabel || '—'}</div>{row.periodStart && row.periodEnd && <div className="text-label text-ink-2">من {dayText(row.periodStart)} إلى {dayText(row.periodEnd)}</div>}</>],
    ['وسيلة الدفع', row.paymentMethod || '—'],
    ['المحاولة', `${row.attemptNumber} من ${MAX_ATTEMPTS}`],
    ['أُرسل', when(row.createdAt)],
    [row.status === 'approved' ? 'قبله' : 'رفضه', <><div className="font-semibold">{reviewerText(row)}</div><div className="text-label text-ink-2">{when(row.reviewedAt)}</div></>],
  ];
  return (
    <SidePanel open onClose={onClose} title={row.studentName} meta={<OutcomePill status={row.status} />} sub={`${row.lineName} · ${row.periodLabel || '—'}`} w={560} backLabel="السجل"
      footer={row.studentId ? <><span className="hidden flex-1 sm:block" /><Button kind="secondary" iconEnd="fwd" to={`${studentsPath}?student=${row.studentId}`}>افتح صفحة الطالب</Button></> : undefined}>
      <div className={`flex items-center justify-between gap-4 rounded-inner px-4 py-3.5 ${row.status === 'approved' ? 'bg-ok-bg' : 'bg-bad-bg'}`}>
        <span className="text-small font-medium text-ink">{row.status === 'approved' ? 'المبلغ المؤكد' : 'مبلغ الإيصال'}</span>
        <span className="text-[26px] font-semibold leading-9 text-ink"><Money value={row.amount} unitClass="text-small" /></span>
      </div>
      {row.status === 'rejected' && (
        <Note tone="danger" title="سبب الرفض كما قرأه الطالب">{row.rejectionReason || 'لم يُكتب سبب.'}</Note>
      )}
      <ReceiptImage row={row} url={url} onState={() => undefined} phone={phone} className="h-[420px] flex-none rounded-inner" />
      <dl className="m-0 flex flex-col">
        {facts.map(([k, v], i) => (
          <div key={k} className={`flex items-baseline gap-4 py-3 ${i ? 'border-t border-hair' : ''}`}>
            <dt className="w-[96px] flex-none text-label text-ink-2">{k}</dt>
            <dd className="m-0 min-w-0 flex-1 text-small font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </SidePanel>
  );
};
