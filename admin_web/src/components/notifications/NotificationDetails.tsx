import React from 'react';
import { percent, pushStatParts, senderLabel, senderShort, statusLabel, typeLabel, whenLabel, type HistoryRow } from '../../lib/notifications';
import { CAIRO_LABEL } from '../../lib/time';
import { Button, InfoRows, Note, SidePanel, StatePill } from '../../ui';

const Count: React.FC<{ label: string; value: number; note?: string }> = ({ label, value, note }) => (
  <div className="rounded-inner bg-ground px-3 py-2.5">
    <div className="flex items-baseline gap-1.5"><span className="text-[20px] font-semibold tabular">{value.toLocaleString('en-US')}</span>{note && <span className="text-cap font-semibold text-ok">{note}</span>}</div>
    <div className="text-cap text-ink-2">{label}</div>
  </div>
);

/**
 * Everything known about one notification. A company sees who received it and
 * who read it; the phone-alert delivery numbers are for the platform (`showPush`).
 */
export const NotificationDetails: React.FC<{
  row: HistoryRow; pushConfigured: boolean | null; onClose: () => void;
  showPush?: boolean; me?: string | null; onDelete?: () => void; onCancel?: () => void; onEdit?: () => void;
}> = ({ row, pushConfigured, onClose, showPush, me, onDelete, onCancel, onEdit }) => {
  const sent = row.status === 'sent';
  const mine = me && row.sender_name === me;
  return (
    <SidePanel open onClose={onClose} title={row.title} backLabel="الإشعارات"
      meta={<StatePill state={row.status} label={statusLabel(row.status)} />}
      sub={`${row.audience ?? ''}${row.sent_at || row.scheduled_at ? ` · ${whenLabel(row.sent_at ?? row.scheduled_at)}` : ''}`}
      footer={(
        <>
          {onDelete && <Button kind="dangerQuiet" icon="trash" onClick={onDelete}>حذف الإشعار</Button>}
          {onCancel && <Button kind="dangerQuiet" icon="x" onClick={onCancel}>إلغاء الإرسال</Button>}
          <span className="hidden flex-1 sm:block" />
          {onEdit && <Button kind="outline" onClick={onEdit}>تعديل</Button>}
          <Button kind="secondary" onClick={onClose}>إغلاق</Button>
        </>
      )}>
      <p className="m-0 whitespace-pre-line rounded-inner bg-ground px-4 py-3 text-small text-ink">{row.body}</p>
      {row.status_note && <Note tone={row.status === 'failed' ? 'danger' : 'teal'}>{row.status_note}</Note>}
      <InfoRows rows={[
        ['إلى', row.audience || '—'],
        ...(row.company_name ? [['الشركة', row.company_name] as [string, string]] : []),
        ['المرسل', mine ? `${row.sender_name} (أنت)` : senderShort(row) === 'النظام' ? 'النظام' : senderLabel(row.sender_role, row.sender_name, row.type).replace(/^الإدارة · /, '')],
        ['النوع', `${typeLabel(row.type, row.category)}${row.priority === 'high' ? ' · عاجل' : ''}`],
        ['أُنشئ', whenLabel(row.created_at)],
        ...(row.scheduled_at ? [['موعد الإرسال', whenLabel(row.scheduled_at)] as [string, string]] : []),
        ...(row.sent_at ? [['أُرسل', whenLabel(row.sent_at)] as [string, string]] : []),
      ]} />
      {sent && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-small font-semibold">داخل التطبيق</h3>
          <div className="grid grid-cols-3 gap-2">
            <Count label="طالباً وصلهم" value={row.students} />
            <Count label="قرؤوه" value={row.read} note={row.students ? `${percent(row.read, row.students)}%` : undefined} />
            <Count label="فتحوه من التنبيه" value={row.opened} />
          </div>
        </section>
      )}
      {sent && showPush && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-small font-semibold">التنبيه على الهواتف</h3>
          {pushConfigured !== true && <p className="m-0 text-label text-ink-2">التنبيه على الهواتف لم يُفعَّل بعد، فلم يُرسل شيء خارج التطبيق.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {pushStatParts(row.push).filter((p) => p.key !== 'queued').map((p) => (
              <Count key={p.key} value={p.value} label={{ devices: 'هاتفاً مسجّلاً', accepted: 'أُرسل إليها', failed: 'فشلت', skipped: 'بلا تنبيه', queued: '' }[p.key]} />
            ))}
          </div>
          <p className="m-0 text-cap text-ink-3">«أُرسل إليها» تعني أن خدمة التنبيهات استلمت الرسالة لتوصلها، ولا تؤكد أنها ظهرت على الهاتف. «بلا تنبيه»: طالب بلا هاتف مسجّل أو أوقف التنبيهات.</p>
        </section>
      )}
      <p className="m-0 text-cap text-ink-3">كل الأوقات {CAIRO_LABEL}.</p>
    </SidePanel>
  );
};
