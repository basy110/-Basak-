import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Card, Section } from '../ui/Layout';
import { Badge, CountBadge, Ltr } from '../ui/Status';
import { phoneText } from '../ui/format';
import { blockedBy, useBlockActions, type BlockedPhone } from '../lib/blockedPhones';
import { notifyDone } from '../lib/toasts';
import { ConfirmDialog } from './students/StudentDialogs';
import { fullDay } from './students/parts';

/**
 * Every blocked number, with who it belonged to and why, and a way to unblock
 * it: also the numbers whose account was deleted, which no students list shows.
 * Not shown while nothing is blocked.
 */
export const BlockedPhonesPanel: React.FC<{ list: BlockedPhone[] }> = ({ list }) => {
  const { unblock } = useBlockActions(null);
  const [target, setTarget] = useState<BlockedPhone | null>(null);
  if (list.length === 0) return null;
  return (
    <Section title="الأرقام المحظورة" meta={<CountBadge n={list.length} className="!bg-sunken !text-ink-2" />}>
      <p className="-mt-1 m-0 text-small text-ink-2">لا يمكن التسجيل بها، ولا يستطيع أصحابها الدخول إلى التطبيق. يبقى الرقم محظوراً حتى لو حُذف حسابه.</p>
      <Card className="overflow-hidden">
        {list.map((entry, i) => (
          <div key={entry.phone} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${i ? 'border-t border-hair' : ''}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-small font-semibold">
                <span>{entry.full_name ?? '—'}</span><Ltr className="font-normal text-ink-2">{phoneText(entry.phone)}</Ltr>
                {!entry.has_account && <Badge>الحساب محذوف</Badge>}
              </div>
              <div className="text-label text-ink-2">حظره {blockedBy(entry)} في {fullDay(entry.blocked_at)}{entry.reason ? ` · ${entry.reason}` : ''}</div>
            </div>
            <Button sm kind="outline" icon="shield" className="max-sm:!h-12" onClick={() => setTarget(entry)}>إلغاء الحظر</Button>
          </div>
        ))}
      </Card>
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} icon="shield" tone="teal" kind="primary" confirm="إلغاء الحظر"
        title={<>إلغاء حظر الرقم <Ltr>{phoneText(target?.phone)}</Ltr>؟</>}
        onConfirm={async () => { if (!target) return; await unblock(target.phone); notifyDone(`تم إلغاء حظر ${phoneText(target.phone)}`); }}>
        <p className="m-0">يصبح متاحاً للتسجيل{target?.has_account ? '، ويستطيع صاحب الحساب الدخول مرة أخرى' : ''}.</p>
      </ConfirmDialog>
    </Section>
  );
};
