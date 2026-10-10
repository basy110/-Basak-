import React, { useState } from 'react';
import { Button } from '../../ui/Button';
import { Note, SkeletonText } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { InfoRows } from '../../ui/Layout';
import { SidePanel } from '../../ui/Overlay';
import { CountBadge, Ltr } from '../../ui/Status';
import { agoText, countText, num, phoneText } from '../../ui/format';
import { keys, usePageData } from '../../lib/query';
import type { BlockedPhone } from '../../lib/blockedPhones';
import { companiesText, loadPlatformStudent, studyLine, type PlatformStudent } from '../../lib/students';
import { ResetStudentPasswordDialog } from '../ResetStudentPasswordDialog';
import { BlockStudentButton } from '../BlockStudentButton';
import { fullDay, PanelHead } from './parts';

const subsText = (n: number | undefined) => (n == null ? '' : n === 0 ? 'بلا اشتراك نشط' : n === 1 ? 'اشتراك نشط' : countText(n, ['اشتراك نشط', 'اشتراكان نشطان', 'اشتراكات نشطة', 'اشتراكاً نشطاً']));

/**
 * One account, read-only for the platform (docs/canvas/AdmPlatStudentsPanel, AdmPlatStudentPhone):
 * the account, every company it belongs to with a link into it, the correction waiting,
 * and the one write the platform has here — a temporary password (plus blocking).
 */
export const PlatformStudentPanel: React.FC<{ row: PlatformStudent; block?: BlockedPhone; online: boolean; onClose: () => void }> = ({ row, block, online, onClose }) => {
  const details = usePageData(keys.platform('students', 'one', { id: row.id }), () => loadPlatformStudent(row));
  const [reset, setReset] = useState(false);
  const d = details.data;
  const active = row.memberships.filter((m) => m.status === 'active').length;
  const memberships = d?.memberships ?? row.memberships;
  return (
    <SidePanel open onClose={onClose} title={row.full_name} sub={`حساب طالب · ${companiesText(active)}`} backLabel="كل الطلاب" w={520}
      footer={<Button kind="secondary" icon="key" disabled={!online} onClick={() => setReset(true)}>عيّن كلمة مرور مؤقتة</Button>}>
      {(d?.corrections ?? []).map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-inner bg-warn-bg px-4 py-3">
          <Icon name="alert" size={18} className="text-warn" />
          <div className="min-w-0 flex-1">
            <div className="text-small font-semibold">{c.field === 'full_name' ? 'طلب تصحيح اسم ينتظر قرارك' : 'طلب تصحيح جامعة ينتظر قرارك'}</div>
            <div className="text-label text-ink-2">من {c.company ?? 'شركة'}، {agoText(c.created_at)}.</div>
          </div>
          <Button sm kind="outline" to={`/platform/corrections?request=${c.id}`}>راجع</Button>
        </div>
      ))}

      <section className="flex flex-col gap-1">
        <PanelHead>الحساب</PanelHead>
        <InfoRows rows={[
          ['رقم الهاتف', <a key="p" href={`tel:${row.phone}`} className="text-ink hover:text-teal"><Ltr>{phoneText(row.phone)}</Ltr></a>],
          ['الجامعة', [row.university, d ? studyLine(d.college, d.specialisation, '', ' · ') : ''].filter(Boolean).join(' · ') || '—'],
          ['سُجّل في', fullDay(row.created_at)],
          ['اشتراكات نشطة', num(d?.active_subscriptions ?? row.active_subscriptions)],
        ]} />
      </section>

      <section className="flex flex-col gap-1">
        <PanelHead end={<CountBadge n={memberships.length} className="!bg-sunken !text-ink-2" />}>شركاته</PanelHead>
        {details.loading && !d ? <SkeletonText rows={3} /> : memberships.length === 0
          ? <p className="m-0 py-2 text-small text-ink-2">لا ينتمي إلى أي شركة الآن. يشترك من التطبيق، أو تضيفه شركة من صفحة طلابها.</p>
          : memberships.map((m) => (
            <div key={m.company_id} className="flex items-center gap-3 border-t border-hair py-3">
              <div className="min-w-0 flex-1">
                <div className="text-small font-semibold">{m.company}</div>
                <div className="text-label text-ink-2">{m.status === 'active'
                  ? <>عضو منذ {fullDay(m.joined_at)}{m.active_subscriptions != null && <> · {subsText(m.active_subscriptions)}</>}</>
                  : <>أُزيل · كان عضواً منذ {fullDay(m.joined_at)}</>}</div>
              </div>
              <Button sm kind="link" iconEnd="fwd" to={`/c/${m.company_id}/students${m.status === 'active' ? `?student=${row.id}` : ''}`}>افتحه في الشركة</Button>
            </div>
          ))}
      </section>

      <Note tone="teal">لتغيير اشتراك أو مراجعة إيصال أو حذف الحساب افتح الطالب في شركته. الاسم والجامعة يتغيّران بطلب تصحيح.</Note>

      <BlockStudentButton student={row} entry={block} companyId={null} disabled={!online} />

      {reset && <ResetStudentPasswordDialog student={{ id: row.id, full_name: row.full_name, phone: row.phone, university: row.university, company: null }} onClose={() => setReset(false)} />}
    </SidePanel>
  );
};
