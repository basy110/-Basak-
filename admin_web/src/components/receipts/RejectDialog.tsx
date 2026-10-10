import React, { useEffect, useState } from 'react';
import { Button, Dialog, RadioCards, TextArea, TextField } from '../../ui';
import { attemptsLeftText, rejectionReason, shortName, type PendingReceiptRow } from '../../lib/pendingReceipts';

/** The reasons an admin gives most; «سبب آخر» asks for the admin's own words. */
export const REJECT_REASONS = ['الصورة غير واضحة', 'المبلغ أقل من المطلوب', 'التحويل ليس إلى حساب الشركة', 'الإيصال قديم أو مكرر'] as const;
const OTHER = 'other';

/**
 * «رفض إيصال …؟»: a ready-made reason (or the admin's own), and exactly what the
 * student will read in the app. The confirm button repeats the verb.
 */
export const RejectDialog: React.FC<{
  row: PendingReceiptRow | null; onClose: () => void; onReject: (row: PendingReceiptRow, reason: string) => void; disabled?: boolean;
}> = ({ row, onClose, onReject, disabled }) => {
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ choice?: string; note?: string }>({});
  useEffect(() => { setChoice(null); setNote(''); setError({}); }, [row?.id]);
  if (!row) return null;

  const other = choice === OTHER;
  const reason = rejectionReason(other ? null : choice, note);
  const submit = () => {
    if (!choice) { setError({ choice: 'اختر سبب الرفض؛ يقرؤه الطالب في التطبيق.' }); return; }
    if (other && !note.trim()) { setError({ note: 'اكتب السبب كما سيقرؤه الطالب.' }); return; }
    onReject(row, reason);
  };
  return (
    <Dialog open={!!row} onClose={onClose} icon="x" tone="danger" w={560}
      title={`رفض إيصال ${shortName(row.studentName)}؟`}
      actions={[
        <Button key="back" kind="secondary" onClick={onClose}>رجوع</Button>,
        <Button key="reject" kind="danger" onClick={submit} disabled={disabled}>رفض الإيصال</Button>,
      ]}>
      <p className="m-0">اختر السبب. يبقى اشتراكه «إيصال مرفوض» حتى يرسل إيصالاً جديداً.</p>
      <RadioCards label="سبب الرفض" name="reject-reason" cols={2} value={choice} error={error.choice}
        onChange={(v) => { setChoice(v); setError({}); }}
        options={[...REJECT_REASONS.map((r) => ({ value: r as string, label: r })), { value: OTHER, label: 'سبب آخر' }]} />
      {other ? (
        <TextArea label="اكتب السبب للطالب" rows={2} maxLength={300} value={note} error={error.note} data-autofocus
          onChange={(e) => { setNote(e.target.value); setError({}); }} />
      ) : (
        <TextField label="توضيح للطالب" optional maxLength={200} value={note} placeholder={choice === REJECT_REASONS[1] ? `مثال: المحوَّل 4,000 والمطلوب ${Math.round(row.price).toLocaleString('en-US')}` : undefined}
          onChange={(e) => setNote(e.target.value)} />
      )}
      <div className="flex flex-col gap-1 rounded-inner bg-ground px-4 py-3" aria-live="polite">
        <span className="text-label font-medium text-ink-2">ما سيقرؤه الطالب في التطبيق</span>
        <span className="text-small text-ink">{reason ? `«رُفض إيصالك: ${reason}.»` : '«رُفض إيصالك: …»'}</span>
        <span className="text-label text-ink-2">ثم: «{attemptsLeftText(row.attemptNumber)}»</span>
      </div>
    </Dialog>
  );
};
