import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, Note, SkeletonList } from '../../ui/Feedback';
import { Ltr, Pill, type Tone } from '../../ui/Status';
import { DataTable, type Column } from '../../ui/Table';
import { cairo, countText, NOUN, phoneText } from '../../ui/format';
import { supabase } from '../../lib/supabase';
import { keys } from '../../lib/query';
import { rememberApplied } from '../../lib/recentChanges';
import { notifyDone } from '../../lib/toasts';
import { useGuard } from '../../lib/guard';
import { daysUntil, inviteState, type Invite } from '../../lib/students';
import type { CompanyCorrection } from '../../lib/corrections';
import { CancelInviteDialog } from './StudentDialogs';
import { shortDay } from './parts';

const sentDay = (iso: string) => (cairo(iso).day === cairo(new Date()).day ? 'اليوم' : shortDay(iso));

const INVITE_RESULT: Record<ReturnType<typeof inviteState>, [string, Tone]> = {
  pending: ['ينتظر موافقة الطالب', 'warning'], accepted: ['قبلها · صار في قائمتك', 'success'], declined: ['رفضها الطالب', 'danger'],
  cancelled: ['ألغيتها', 'neutral'], expired: ['انتهت بلا رد', 'neutral'],
};

/** The list's frame: «آخر 10 … · الأحدث أولاً» above the rows. */
const ListHead: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex h-14 items-center px-4 text-label text-ink-2 max-sm:h-auto max-sm:px-0">{children}</div>;

/** «الدعوات»: what happened to each invitation (docs/canvas/AdmStudentsInvites). */
export const InvitesTab: React.FC<{
  companyId: string; data: Invite[] | undefined; loading: boolean; error: string; reload: () => void; onAdd: () => void; online: boolean;
}> = ({ companyId, data, loading, error, reload, onAdd, online }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const [target, setTarget] = useState<Invite | null>(null);
  const now = new Date();
  const expires = (i: Invite) => {
    const s = inviteState(i, now);
    if (s === 'pending') { const d = daysUntil(i.expires_at, now); return d <= 0 ? 'اليوم' : d === 1 ? 'غداً' : `بعد ${countText(d, NOUN.day)}`; }
    if (s === 'expired') return `انتهت ${shortDay(i.expires_at)}`;
    return '—';
  };
  const cancel = async () => {
    if (!target) return;
    await guard(target.id, async () => {
      const { error: e } = await supabase.rpc('company_cancel_invite', { p_invite_id: target.id });
      if (e) { void reload(); throw new Error(e.message); }
      rememberApplied([target.id], ['invites', 'students']);
      client.setQueryData<Invite[]>(keys.company(companyId, 'invites'), (rows) => rows?.map((r) => (r.id === target.id ? { ...r, status: 'cancelled' } : r)));
      notifyDone(`أُلغيت الدعوة المرسلة إلى ${phoneText(target.phone)}`);
    });
  };
  const columns: Column<Invite>[] = [
    { key: 'phone', label: 'رقم الهاتف', render: (i) => <Ltr className="font-medium">{phoneText(i.phone)}</Ltr> },
    { key: 'line', label: 'الخط', render: (i) => i.lines?.name ?? '—' },
    { key: 'sent', label: 'أُرسلت', w: 130, render: (i) => sentDay(i.created_at) },
    { key: 'ends', label: 'تنتهي', w: 150, render: (i) => <span className={inviteState(i, now) === 'pending' ? '' : 'text-ink-2'}>{expires(i)}</span> },
    { key: 'result', label: 'النتيجة', w: 220, render: (i) => { const [l, t] = INVITE_RESULT[inviteState(i, now)]; return <Pill tone={t}>{l}</Pill>; } },
    { key: 'act', label: <span className="sr-only">إجراء</span>, w: 136, align: 'end', render: (i) => (inviteState(i, now) === 'pending'
      ? <Button sm kind="outline" disabled={!online} onClick={() => setTarget(i)}>إلغاء الدعوة</Button> : null) },
  ];
  const rows = data ?? [];
  return (
    <div id="panel-invites" role="tabpanel" aria-labelledby="tab-invites" className="flex flex-col gap-5 sm:gap-6">
      <Note tone="teal" title="متى تُرسل دعوة؟">عندما تضيف طالباً ولرقمه حساب في باصك من قبل. لا يُنشأ له حساب جديد: يوافق من التطبيق بحسابه الحالي ثم يظهر في قائمتك. تنتهي الدعوة بعد 14 يوماً.</Note>
      {loading ? <SkeletonList rows={4} />
        : error && !data ? <ErrorState title="تعذّر تحميل الدعوات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={reload} card />
          : rows.length === 0 ? <EmptyState icon="mail" card title="لم تُرسل أي دعوة" text="عندما تضيف طالباً ولرقمه حساب في باصك من قبل، تُرسل له دعوة بدل إنشاء حساب جديد، وتتابعها هنا."
            action={<Button icon="plus" disabled={!online} onClick={onAdd} full>إضافة طالب</Button>} />
            : (
              <DataTable<Invite> caption="الدعوات" columns={columns} rows={rows} rowKey={(i) => i.id}
                toolbar={<ListHead>آخر {rows.length >= 10 ? '10 دعوات' : countText(rows.length, ['دعوة واحدة', 'دعوتين', 'دعوات', 'دعوة'])} · الأحدث أولاً</ListHead>}
                card={(i) => {
                  const [l, t] = INVITE_RESULT[inviteState(i, now)];
                  return {
                    title: <Ltr>{phoneText(i.phone)}</Ltr>, sub: i.lines?.name ? `خط ${i.lines.name}` : undefined, end: <Pill tone={t}>{l}</Pill>,
                    fields: [['أُرسلت', sentDay(i.created_at)], ['تنتهي', expires(i)]],
                    actions: inviteState(i, now) === 'pending' ? <Button kind="outline" full disabled={!online} onClick={() => setTarget(i)}>إلغاء الدعوة</Button> : undefined,
                  };
                }} />
            )}
      <CancelInviteDialog phone={target?.phone ?? null} onClose={() => setTarget(null)} onConfirm={cancel} />
    </div>
  );
};

const CORRECTION_RESULT = (c: CompanyCorrection): [string, Tone] => (c.status === 'pending' ? ['عند إدارة المنصة', 'warning']
  : c.status === 'approved' ? [c.field === 'full_name' ? 'اعتُمد · تغيّر الاسم' : 'اعتُمد · تغيّرت الجامعة', 'success'] : ['رُفض', 'danger']);

/** «طلبات تصحيح الاسم»: what the company asked the platform for, and the answers (docs/canvas/AdmStudentsCorrections). */
export const CorrectionsTab: React.FC<{ data: CompanyCorrection[] | undefined; loading: boolean; error: string; reload: () => void }> = ({ data, loading, error, reload }) => {
  const rows = data ?? [];
  const field = (c: CompanyCorrection) => (c.field === 'university' ? <span className="me-1.5 rounded-control bg-sunken px-1.5 text-cap text-ink-2">الجامعة</span> : null);
  const columns: Column<CompanyCorrection>[] = [
    { key: 'old', label: 'الاسم الحالي', render: (c) => <span className="text-ink-3 line-through">{c.old_value ?? '—'}</span> },
    { key: 'new', label: 'الاسم المقترح', render: (c) => <span className="font-semibold">{field(c)}{c.new_value}</span> },
    { key: 'sent', label: 'أُرسل', w: 110, render: (c) => sentDay(c.created_at) },
    { key: 'result', label: 'النتيجة', w: 190, render: (c) => { const [l, t] = CORRECTION_RESULT(c); return <Pill tone={t}>{l}</Pill>; } },
    { key: 'note', label: 'ملاحظة إدارة المنصة', w: 260, render: (c) => <span className="text-label text-ink-2">{c.decision_note || '—'}</span> },
  ];
  return (
    <div id="panel-corrections" role="tabpanel" aria-labelledby="tab-corrections" className="flex flex-col gap-5 sm:gap-6">
      <Note tone="teal" title="من يعتمد التصحيح؟">اسم الطالب يخص حسابه في باصك كله، فتعتمده إدارة المنصة. تطلب التصحيح من صفحة الطالب («طلب تصحيح الاسم»)، وترى النتيجة هنا.</Note>
      {loading ? <SkeletonList rows={4} />
        : error && !data ? <ErrorState title="تعذّر تحميل الطلبات" text="تأكد من اتصالك ثم حاول مرة أخرى." onRetry={reload} card />
          : rows.length === 0 ? <EmptyState icon="pencil" card title="لم تطلب أي تصحيح" text="إن وجدت خطأ في اسم طالب فافتح صفحته واضغط «طلب تصحيح الاسم». تعتمده إدارة المنصة وتظهر النتيجة هنا." />
            : (
              <DataTable<CompanyCorrection> caption="طلبات تصحيح الاسم" columns={columns} rows={rows} rowKey={(c) => c.id}
                toolbar={<ListHead>آخر {rows.length >= 10 ? '10 طلبات' : countText(rows.length, ['طلب واحد', 'طلبين', 'طلبات', 'طلباً'])} · الأحدث أولاً</ListHead>}
                card={(c) => {
                  const [l, t] = CORRECTION_RESULT(c);
                  return {
                    title: <>{field(c)}{c.new_value}</>, sub: <span className="line-through">{c.old_value ?? '—'}</span>,
                    fields: [['أُرسل', sentDay(c.created_at)], ['النتيجة', <Pill key="p" tone={t}>{l}</Pill>], ...(c.decision_note ? [['ملاحظة المنصة', c.decision_note] as [string, string]] : [])],
                  };
                }} />
            )}
    </div>
  );
};
