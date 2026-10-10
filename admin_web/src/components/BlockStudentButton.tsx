import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Badge, Ltr } from '../ui/Status';
import { phoneText } from '../ui/format';
import { blockedBy, BLOCK_REASON_MAX, useBlockActions, type BlockedPhone } from '../lib/blockedPhones';
import { notifyDone } from '../lib/toasts';
import { BlockDialog, ConfirmDialog } from './students/StudentDialogs';
import { fullDay } from './students/parts';

/** «محظور» beside a blocked student's name; who blocked, and why when known, on hover. */
export const BlockedBadge: React.FC<{ entry: BlockedPhone }> = ({ entry }) => (
  <span title={`حظره: ${blockedBy(entry)}${entry.reason ? ` • ${entry.reason}` : ''}`}><Badge tone="danger">محظور</Badge></span>
);

/**
 * Block a student: their number can no longer be registered and their account
 * can no longer sign in. Nothing is deleted. On a blocked student it unblocks
 * instead, when the one asking may (a company lifts only its own blocks).
 * companyId: act as that company; null: as the platform. Drawn as a panel section.
 */
export const BlockStudentButton: React.FC<{
  student: { id: string; full_name: string; phone: string };
  entry: BlockedPhone | undefined;
  companyId: string | null;
  disabled?: boolean;
}> = ({ student, entry, companyId, disabled }) => {
  const { block, unblock } = useBlockActions(companyId);
  const [open, setOpen] = useState<'block' | 'unblock' | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-label font-semibold text-ink">الحظر</h3>
      {entry ? (
        <div className="flex flex-col gap-3 rounded-inner bg-bad-bg px-4 py-3">
          <div className="text-small font-semibold text-bad">محظور منذ {fullDay(entry.blocked_at)}</div>
          <div className="text-label text-ink-2">حظره {blockedBy(entry)}{entry.reason ? ` · ${entry.reason}` : ''}. لا يستطيع الدخول إلى التطبيق ولا التسجيل بالرقم <Ltr>{phoneText(entry.phone)}</Ltr>.</div>
          {entry.can_unblock !== false
            ? <Button sm kind="outline" icon="shield" disabled={disabled} className="self-start max-sm:!h-12 max-sm:self-stretch" onClick={() => setOpen('unblock')}>إلغاء الحظر</Button>
            : <div className="text-label text-ink-2">إدارة المنصة وحدها تلغي هذا الحظر.</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="m-0 flex-1 text-label text-ink-2">يمنعه من الدخول إلى التطبيق ومن التسجيل بالرقم نفسه. لا يُحذف شيء، ويمكن إلغاؤه.</p>
          <Button sm kind="dangerQuiet" icon="ban" disabled={disabled} className="max-sm:!h-12" onClick={() => setOpen('block')}>حظر الطالب</Button>
        </div>
      )}
      <BlockDialog open={open === 'block'} onClose={() => setOpen(null)} name={student.full_name} phone={student.phone} asCompany={!!companyId}
        onConfirm={async (reason) => { await block(student.id, reason.trim().slice(0, BLOCK_REASON_MAX) || null); notifyDone(`تم حظر ${student.full_name}`); }} />
      <ConfirmDialog open={open === 'unblock'} onClose={() => setOpen(null)} icon="shield" tone="teal" kind="primary" confirm="إلغاء الحظر"
        title={`إلغاء حظر ${student.full_name}؟`}
        onConfirm={async () => { await unblock(student.phone); notifyDone(`تم إلغاء حظر ${student.full_name}`); }}>
        <p className="m-0">يستطيع الدخول إلى التطبيق مرة أخرى، ويصبح رقمه متاحاً للتسجيل.</p>
      </ConfirmDialog>
    </section>
  );
};
