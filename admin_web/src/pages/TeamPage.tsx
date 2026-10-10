import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminScope, useCompany } from '../lib/adminScope';
import { keys } from '../lib/query';
import { useGuard } from '../lib/guard';
import { notifyError } from '../lib/toasts';
import { adminsCount, colleaguesOf, createCompanyAdmin, deleteCompanyAdmin, useCompanyAdmins, type CompanyAdmin } from '../lib/team';
import {
  Badge, Button, DataTable, EmptyState, ErrorState, Ltr, Note, Page, PageHeader, PhoneBar, SkeletonTable, dayText, cairo, errorText, useOnline, type Column,
} from '../ui';
import { PersonCell } from '../components/team/parts';
import { AdminAddPanel, AdminAddedDialog, PLATFORM_ONLY, RemoveAdminDialog, type AdminDraft } from '../components/team/AdminParts';

const addedOn = (iso: string) => dayText(cairo(iso).day);

/**
 * «مديرو الشركة» (docs/canvas/AdmManagers*, AdmManager*): who signs in to this
 * company's dashboard. A company admin sees the list only; adding and removing
 * are the platform admin's (inside the company, marked «لمدير المنصة فقط»).
 */
export const TeamPage: React.FC = () => {
  const me = useAdminScope();
  const company = useCompany();
  const platform = me.role === 'super_admin';
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const page = useCompanyAdmins(company.id);
  const admins = page.data ?? [];
  const only = admins.length === 1;

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [added, setAdded] = useState<{ name: string; email: string; invited: boolean } | null>(null);
  const [removing, setRemoving] = useState<CompanyAdmin | null>(null);

  const add = (d: AdminDraft) => void guard('add', async () => {
    setBusy(true); setFormError('');
    try {
      const r = await createCompanyAdmin({ companyId: company.id, fullName: d.fullName, email: d.email, password: d.how === 'password' ? d.password : undefined });
      setAdding(false);
      setAdded({ name: d.fullName.trim(), email: d.email.trim().toLowerCase(), invited: !!r?.invited });
      void page.reload();
      void client.invalidateQueries({ queryKey: keys.platform('companyAdmins') });
    } catch (e) { setFormError(errorText(e)); }
    setBusy(false);
  });

  const remove = (a: CompanyAdmin) => void guard(`remove:${a.id}`, async () => {
    setBusy(true);
    try {
      await deleteCompanyAdmin(a.id);
      client.setQueryData<CompanyAdmin[]>(keys.company(company.id, 'team'), (rows) => rows?.filter((r) => r.id !== a.id));
      void client.invalidateQueries({ queryKey: keys.platform('companyAdmins') });
      setRemoving(null);
    } catch (e) { notifyError('تعذّر إزالة المدير', errorText(e)); }
    setBusy(false);
  });

  const removeButton = (a: CompanyAdmin, phone?: boolean) => (
    <Button kind="outline" sm icon="trash" disabled={!online || only || a.id === me.id} className={phone ? '!h-11' : ''}
      aria-label={`إزالة ${a.full_name}`} onClick={() => setRemoving(a)}>إزالة</Button>
  );
  const you = (a: CompanyAdmin) => (a.id === me.id ? <Badge tone="teal">أنت</Badge> : null);
  const columns: Column<CompanyAdmin>[] = [
    { key: 'name', label: 'المدير', render: (a) => <PersonCell name={a.full_name} end={you(a)} /> },
    { key: 'email', label: 'البريد الإلكتروني', w: platform ? 300 : 320, render: (a) => <div className="truncate"><Ltr>{a.email}</Ltr></div> },
    { key: 'added', label: 'أُضيف في', w: platform ? 170 : 220, render: (a) => addedOn(a.created_at) },
    ...(platform ? [{ key: 'remove', label: <span className="sr-only">إزالة</span>, w: 120, align: 'end' as const, render: (a: CompanyAdmin) => removeButton(a) }] : []),
  ];

  return (
    <Page>
      <PageHeader title="مديرو الشركة" meta={platform ? PLATFORM_ONLY : undefined} phoneActions={false}
        sub="من يدخل هذه اللوحة باسم شركتك. كل مدير يرى كل الصفحات ويفعل كل شيء: لا درجات بينهم."
        actions={platform ? <Button icon="plus" disabled={!online} onClick={() => { setFormError(''); setAdding(true); }}>أضف مديراً</Button> : undefined} />

      {page.loading ? <SkeletonTable rows={2} cols={3} />
        : page.error ? <ErrorState card title="تعذّر تحميل المديرين" text="لم نستطع جلب قائمة المديرين. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void page.reload()} />
          : (
            <>
              <DataTable<CompanyAdmin> caption="مديرو الشركة" columns={columns} rows={admins} rowKey={(a) => a.id}
                empty={admins.length === 0 ? <EmptyState icon="shield" title="لا مديرين لهذه الشركة بعد" text={platform ? 'أضف أول مدير ليدخل لوحة الشركة.' : 'تواصل مع إدارة المنصة لإضافة مدير.'} /> : undefined}
                toolbar={<div className="flex items-center text-label text-ink-2 sm:min-h-[52px] sm:border-b sm:border-hair sm:px-4">{adminsCount(admins.length)} · يدخلون بالبريد الإلكتروني وكلمة المرور</div>}
                card={(a) => ({
                  title: <PersonCell name={a.full_name} />, end: you(a),
                  fields: [['البريد الإلكتروني', <Ltr key="e" className="break-all">{a.email}</Ltr>], ['أُضيف في', addedOn(a.created_at)]],
                  actions: platform ? removeButton(a, true) : undefined,
                })} />
              {platform && only && (
                <Note tone="warning" title="مدير واحد فقط">لا يُزال آخر مدير للشركة. أضف مديراً آخر إن أردت تغييره، وليبقى من يدخل اللوحة إن غاب.</Note>
              )}
              {platform ? (
                !only && <p className="m-0 text-label text-ink-2">كل حساب هنا يرى بيانات هذه الشركة فقط. الإضافة والإزالة تظهران لمدير المنصة وحده؛ مدير الشركة يرى القائمة فقط.</p>
              ) : (
                <Note tone="teal" icon="shield" title="إضافة مدير أو إزالته عند إدارة المنصة">
                  لا يستطيع مدير الشركة أن يضيف مديراً ولا أن يزيله. اطلب ذلك من إدارة المنصة واذكر الاسم والبريد الإلكتروني.
                </Note>
              )}
            </>
          )}

      {platform && <PhoneBar><Button icon="plus" full disabled={!online} onClick={() => { setFormError(''); setAdding(true); }}>أضف مديراً</Button></PhoneBar>}

      {platform && (
        <>
          <AdminAddPanel open={adding} onClose={() => setAdding(false)} variant="workspace" company={company} busy={busy}
            serverError={formError} onSubmit={add} disabled={!online} />
          <RemoveAdminDialog open={!!removing} admin={removing} companyName={company.name} variant="workspace" busy={busy}
            left={removing ? colleaguesOf(removing, admins) : []} onClose={() => setRemoving(null)} onConfirm={() => removing && remove(removing)} />
          <AdminAddedDialog result={added} onClose={() => setAdded(null)} />
        </>
      )}
    </Page>
  );
};
