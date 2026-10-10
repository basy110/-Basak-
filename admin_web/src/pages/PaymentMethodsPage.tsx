import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useCompany } from '../lib/adminScope';
import { keys, unwrap, usePageData } from '../lib/query';
import { forgetApplied, rememberApplied } from '../lib/recentChanges';
import { rpcOr } from '../lib/rpc';
import { useGuard } from '../lib/guard';
import { notify, notifyDone, notifyError } from '../lib/toasts';
import {
  DISPLAY_NAME_MAX, INSTRUCTIONS_MAX, METHOD_LABEL, METHOD_TYPES, emptyMethod, inOrder, methodErrors, methodRow, methodToDraft,
  methodsWord, moved, namesList, type MethodDraft, type MethodType, type PaymentMethod,
} from '../lib/money';
import { Button, Card, Dialog, EmptyState, ErrorState, Icon, IconButton, Menu, Note, Page, PageHeader, PhoneBar, Pill, RadioCards, RecordCard, SidePanel, SkeletonTable, TextArea, TextField, Toggle, errorText, useOnline } from '../ui';
import { ExportButton } from '../ui/Transfer';
import { exportSheet } from '../lib/excel';
import { AccountText, METHOD_ICON, PaymentPreview } from '../components/money/PaymentPreview';
import { autoDisplayName, hasCustomName, withDisplayName } from '../lib/paymentMethodName';

const COLUMNS = 'id, company_id, method_type, display_name, account_holder, instapay_address, wallet_phone, bank_name, bank_account_number, iban, instructions, is_active, sort_order, created_at';
const LISTS = ['paymentMethods'];

type Ask = { kind: 'stop' | 'start' | 'delete'; m: PaymentMethod };

/** «وسائل الدفع»: the accounts students pay into, in the order they see them. */
export const PaymentMethodsPage: React.FC = () => {
  const companyId = useCompany().id;
  const online = useOnline();
  const client = useQueryClient();
  const guard = useGuard();
  const queryKey = keys.company(companyId, 'paymentMethods');
  const page = usePageData(queryKey, () => unwrap<PaymentMethod[]>(supabase.from('company_payment_methods').select(COLUMNS)
    .eq('company_id', companyId).order('sort_order').order('created_at')));
  const methods = useMemo(() => inOrder(page.data ?? []), [page.data]);
  const active = methods.filter((m) => m.is_active);

  const [editing, setEditing] = useState<MethodDraft | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);

  // Every write answers with the saved row, which goes straight into the list on screen.
  const apply = (change: (list: PaymentMethod[]) => PaymentMethod[], ...ids: string[]) => {
    rememberApplied(ids, LISTS);
    client.setQueryData<PaymentMethod[]>(queryKey, (list) => (list ? inOrder(change(list)) : list));
  };
  const put = (row: PaymentMethod) => apply((list) => (list.some((m) => m.id === row.id) ? list.map((m) => (m.id === row.id ? row : m)) : [...list, row]), row.id);

  /** A new order, at once on screen; the database gets the whole order in one go. */
  const reorder = (next: PaymentMethod[]) => guard('order', async () => {
    const before = methods;
    const ordered = next.map((m, i) => ({ ...m, sort_order: i }));
    apply(() => ordered, ...ordered.map((m) => m.id));
    try {
      await rpcOr('reorder_payment_methods',
        () => supabase.rpc('reorder_payment_methods', { p_company_id: companyId, p_ids: ordered.map((m) => m.id) }),
        async () => {
          // An older database: only the rows whose place changed, one by one.
          for (const m of ordered.filter((x, i) => before[i]?.id !== x.id)) {
            const { error } = await supabase.from('company_payment_methods').update({ sort_order: m.sort_order }).eq('id', m.id).select('id').single();
            if (error) throw new Error(error.message);
          }
          return null;
        });
    } catch {
      forgetApplied(ordered.map((m) => m.id));
      client.setQueryData<PaymentMethod[]>(queryKey, before);
      notify({ title: 'لم يتغيّر الترتيب. أعدنا الوسائل إلى ترتيبها المحفوظ.', tone: 'error', action: { label: 'حاول مرة أخرى', run: () => void reorder(next) } }, 12_000);
      void page.reload();
    }
  });
  const move = (i: number, to: number) => { if (online) void reorder(moved(methods, i, to)); };

  const setActive = (m: PaymentMethod, on: boolean) => guard(m.id, async () => {
    setBusy(true);
    const { data, error } = await supabase.from('company_payment_methods').update({ is_active: on, updated_at: new Date().toISOString() }).eq('id', m.id).select(COLUMNS).single();
    setBusy(false);
    setAsk(null);
    if (error || !data) return notifyError(on ? 'لم تُشغَّل الوسيلة' : 'لم تُوقَف الوسيلة', errorText(error));
    put(data as PaymentMethod);
    notifyDone(on ? `تظهر «${m.display_name}» للطلاب الآن` : `أوقفت «${m.display_name}»`, on ? undefined : 'تبقى محفوظة هنا لتشغّلها متى أردت.');
  });
  const remove = (m: PaymentMethod) => guard(m.id, async () => {
    setBusy(true);
    const { data, error } = await supabase.from('company_payment_methods').delete().eq('id', m.id).select('id');
    setBusy(false);
    setAsk(null);
    if (error || !data?.length) return notifyError('لم تُحذف الوسيلة', errorText(error));
    apply((list) => list.filter((x) => x.id !== m.id), m.id);
    setEditing(null);
    notifyDone(`حُذفت «${m.display_name}»`);
  });

  const header = (
    <PageHeader title="وسائل الدفع" phoneActions={false}
      sub="الحسابات التي يحوّل عليها الطلاب ثمن الاشتراك. الطالب يحوّل ثم يرفع صورة التحويل، وأنت تراجعها في «الإيصالات»."
      actions={<Button icon="plus" disabled={!online} onClick={() => setEditing(emptyMethod())}>إضافة وسيلة دفع</Button>} />
  );

  if (page.error && !page.data) {
    return <Page>{header}<ErrorState card title="تعذّر تحميل وسائل الدفع" text="لم نستطع جلب الوسائل. تأكد من اتصالك ثم حاول مرة أخرى." onRetry={() => void page.reload()} /></Page>;
  }

  const firstStopped = methods.find((m) => !m.is_active);
  const rowActions = (m: PaymentMethod, i: number) => [
    { label: m.is_active ? 'إيقاف الوسيلة' : 'تشغيل الوسيلة', icon: 'power' as const, onClick: () => setAsk({ kind: m.is_active ? 'stop' : 'start', m }) },
    { label: 'اجعلها الأولى', icon: 'aup' as const, hidden: i === 0, onClick: () => move(i, 0) },
    { label: 'حذف الوسيلة', icon: 'trash' as const, danger: true, onClick: () => setAsk({ kind: 'delete', m }) },
  ];

  return (
    <Page>
      {header}
      {page.loading ? <SkeletonTable rows={4} cols={5} /> : methods.length === 0 ? (
        <>
          <Note tone="danger" title="الطلاب لا يستطيعون الدفع الآن">
            <span className="hidden sm:inline">لا توجد وسيلة دفع. يرى الطالب الخطوط والأسعار، لكن لا يجد حساباً يحوّل عليه.</span>
            <span className="sm:hidden">لا توجد وسيلة دفع يحوّلون عليها.</span>
          </Note>
          <EmptyState card icon="card" title="أضف أول وسيلة دفع"
            text="حساب إنستاباي، أو محفظة فودافون كاش، أو حساب بنكي. يظهر للطالب في صفحة الدفع ليحوّل عليه ثمن الاشتراك."
            action={<Button icon="plus" disabled={!online} onClick={() => setEditing(emptyMethod())}>إضافة وسيلة دفع</Button>} />
        </>
      ) : (
        <>
          {active.length === 0 && (
            <Note tone="danger" title="الطلاب لا يستطيعون الدفع الآن"
              action={firstStopped && <Button sm kind="danger" className="hidden sm:inline-flex" disabled={!online} onClick={() => setAsk({ kind: 'start', m: firstStopped })}>شغّل «{firstStopped.display_name}»</Button>}>
              كل وسائل الدفع متوقفة. شغّل واحدة على الأقل ليعود الدفع.
            </Note>
          )}
          {/* Desktop and tablet */}
          <Card className="hidden overflow-hidden sm:block">
            <div className="flex min-h-[60px] items-center gap-3 border-b border-hair px-4 text-label text-ink-2">
              <span className="min-w-0 flex-1">{methodsWord(methods.length)} · {active.length === 0 ? 'لا واحدة تظهر للطلاب' : methods.length === 1 ? 'تظهر للطلاب' : `${active.length === methods.length ? 'كلها تظهر' : `${active.length} تظهر`} للطلاب بهذا الترتيب`}</span>
              <ExportButton count={methods.length} onExport={() => exportSheet<PaymentMethod>({
                name: 'وسائل الدفع', rows: methods,
                columns: [
                  { label: 'الترتيب', value: (m) => methods.indexOf(m) + 1, width: 9 },
                  { label: 'الوسيلة', value: (m) => m.display_name, width: 26 },
                  { label: 'النوع', value: (m) => METHOD_LABEL[m.method_type], width: 14 },
                  { label: 'الحساب الذي يحوّل عليه الطالب', value: (m) => m.instapay_address ?? m.wallet_phone ?? m.bank_account_number, width: 28 },
                  { label: 'البنك والفرع', value: (m) => m.bank_name, width: 26 },
                  { label: 'رقم الآيبان', value: (m) => m.iban, width: 32 },
                  { label: 'صاحب الحساب', value: (m) => m.account_holder, width: 24 },
                  { label: 'تعليمات للطالب', value: (m) => m.instructions, width: 40 },
                  { label: 'الحالة', value: (m) => (m.is_active ? 'تظهر للطلاب' : 'متوقفة'), width: 14 },
                ],
              })} />
            </div>
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">وسائل الدفع بترتيبها عند الطالب</caption>
              <thead>
                <tr className="h-11 bg-ground text-label text-ink-2">
                  <th scope="col" className="w-[120px] ps-4 text-start font-medium">الترتيب</th>
                  <th scope="col" className="px-3 text-start font-medium">الوسيلة</th>
                  <th scope="col" className="hidden w-[22%] px-3 text-start font-medium lg:table-cell">الحساب الذي يحوّل عليه الطالب</th>
                  <th scope="col" className="hidden w-[18%] px-3 text-start font-medium lg:table-cell">صاحب الحساب</th>
                  <th scope="col" className="w-[140px] px-3 text-start font-medium">الحالة</th>
                  <th scope="col" className="w-[132px] pe-4"><span className="sr-only">إجراءات</span></th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m, i) => (
                  <tr key={m.id} tabIndex={0} onClick={() => setEditing(methodToDraft(m))} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(methodToDraft(m)); }}
                    className={`h-[61px] cursor-pointer border-t border-hair hover:bg-ground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${editing?.id === m.id ? 'bg-teal-tint shadow-[inset_-3px_0_0_#00658D]' : ''}`}>
                    <td className="ps-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <span className="w-6 text-small font-semibold tabular">{i + 1}</span>
                        <IconButton sm icon="aup" size={18} label={`انقل «${m.display_name}» لأعلى`} disabled={i === 0 || !online} onClick={() => move(i, i - 1)} />
                        <IconButton sm icon="adown" size={18} label={`انقل «${m.display_name}» لأسفل`} disabled={i === methods.length - 1 || !online} onClick={() => move(i, i + 1)} />
                      </div>
                    </td>
                    <td className="px-3">
                      <div className="min-w-0">
                        <div className="truncate text-small font-semibold">{m.display_name}</div>
                        <div className="flex items-center gap-1.5 text-cap text-ink-3"><Icon name={METHOD_ICON[m.method_type]} size={13} /><span>{METHOD_LABEL[m.method_type]}</span></div>
                        <div className="truncate text-cap text-ink-2 lg:hidden"><AccountText m={m} /></div>
                      </div>
                    </td>
                    <td className="hidden truncate px-3 text-small font-medium lg:table-cell"><AccountText m={m} /></td>
                    <td className="hidden truncate px-3 text-small lg:table-cell">{m.account_holder ?? '—'}</td>
                    <td className="px-3">{m.is_active ? <Pill tone="success">تظهر للطلاب</Pill> : <Pill tone="neutral">متوقفة</Pill>}</td>
                    <td className="pe-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button sm kind="outline" disabled={!online} onClick={() => setEditing(methodToDraft(m))}>تعديل</Button>
                        <Menu label={`إجراءات «${m.display_name}»`} items={rowActions(m, i).map((a) => ({ ...a, onClick: () => { if (online) a.onClick(); } }))} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Phone */}
          <div className="flex flex-col gap-3 sm:hidden">
            <div className="text-label text-ink-2">{methodsWord(methods.length)} · {active.length === 0 ? 'لا واحدة تظهر للطلاب' : `${active.length} تظهر للطلاب بهذا الترتيب`}</div>
            {active.length === 0 && firstStopped && <Button kind="danger" full onClick={() => setAsk({ kind: 'start', m: firstStopped })}>شغّل «{firstStopped.display_name}»</Button>}
            {methods.map((m, i) => (
              <RecordCard key={m.id} onOpen={() => setEditing(methodToDraft(m))} spec={{
                title: m.display_name,
                sub: <span className="flex items-center gap-1.5"><Icon name={METHOD_ICON[m.method_type]} size={13} />{METHOD_LABEL[m.method_type]}</span>,
                end: m.is_active ? <Pill tone="success">تظهر للطلاب</Pill> : <Pill tone="neutral">متوقفة</Pill>,
                fields: [['الحساب', <AccountText key="a" m={m} />], ['صاحب الحساب', m.account_holder ?? '—']],
                actions: (
                  <>
                    <IconButton icon="aup" label={`انقل «${m.display_name}» لأعلى`} className="shadow-ring" disabled={i === 0 || !online} onClick={() => move(i, i - 1)} />
                    <IconButton icon="adown" label={`انقل «${m.display_name}» لأسفل`} className="shadow-ring" disabled={i === methods.length - 1 || !online} onClick={() => move(i, i + 1)} />
                    <span className="flex-1" />
                    <Button kind="outline" className="!h-12" disabled={!online} onClick={() => setAsk({ kind: m.is_active ? 'stop' : 'start', m })}>{m.is_active ? 'إيقاف' : 'تشغيل'}</Button>
                    <Button kind="secondary" className="!h-12" disabled={!online} onClick={() => setEditing(methodToDraft(m))}>تعديل</Button>
                  </>
                ),
              }} />
            ))}
          </div>
          <Note tone="teal" title="الترتيب هنا هو ترتيبها عند الطالب" className="hidden sm:flex">
            ضع في الأعلى الوسيلة التي تفضّل أن يحوّل عليها الطلاب. الوسيلة المتوقفة تبقى محفوظة ولا يراها أحد.
          </Note>
        </>
      )}

      {methods.length > 0 && <PhoneBar><Button full icon="plus" disabled={!online} onClick={() => setEditing(emptyMethod())}>إضافة وسيلة دفع</Button></PhoneBar>}

      {editing && (
        <MethodPanel key={editing.id ?? 'new'} start={editing} companyId={companyId} methods={methods} online={online}
          onClose={() => setEditing(null)} onSaved={(row) => { put(row); setEditing(null); }}
          onDelete={(m) => setAsk({ kind: 'delete', m })} />
      )}
      {ask && <AskDialog ask={ask} active={active} busy={busy} onClose={() => setAsk(null)}
        onConfirm={() => (ask.kind === 'delete' ? void remove(ask.m) : void setActive(ask.m, ask.kind === 'start'))} />}
    </Page>
  );
};

// ── Stop, start, delete ─────────────────────────────────────────────
const AskDialog: React.FC<{ ask: Ask; active: PaymentMethod[]; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ ask, active, busy, onClose, onConfirm }) => {
  const { m } = ask;
  const others = active.filter((x) => x.id !== m.id);
  const last = m.is_active && others.length === 0;
  const back = <Button key="b" kind="secondary" onClick={onClose} disabled={busy}>رجوع</Button>;
  const cantPay = (
    <Note tone="danger" title="لن يستطيع أي طالب أن يدفع">تظهر له صفحة الدفع بلا حساب يحوّل عليه، حتى تشغّل وسيلة أخرى.</Note>
  );
  if (ask.kind === 'start') {
    return (
      <Dialog open onClose={onClose} title={`تشغيل «${m.display_name}»؟`} icon="power" tone="success"
        actions={[back, <Button key="c" onClick={onConfirm} loading={busy}>تشغيل الوسيلة</Button>]}>
        <p className="m-0">تظهر في صفحة الدفع عند الطلاب فوراً، في مكانها من الترتيب. يحوّلون عليها ثم يرفعون صورة التحويل.</p>
      </Dialog>
    );
  }
  if (ask.kind === 'stop') {
    return last ? (
      <Dialog open onClose={onClose} title="إيقاف آخر وسيلة دفع تعمل؟" icon="alert" tone="danger"
        actions={[back, <Button key="c" kind="danger" onClick={onConfirm} loading={busy}>إيقاف الوسيلة</Button>]}>
        <p className="m-0">«{m.display_name}» هي الوسيلة الوحيدة التي يراها الطلاب الآن.</p>
        {cantPay}
      </Dialog>
    ) : (
      <Dialog open onClose={onClose} title={`إيقاف «${m.display_name}»؟`} icon="power" tone="warning"
        actions={[back, <Button key="c" onClick={onConfirm} loading={busy}>إيقاف الوسيلة</Button>]}>
        <p className="m-0">تختفي من صفحة الدفع عند الطلاب فوراً، وتبقى محفوظة هنا لتشغّلها متى أردت.</p>
        <p className="m-0">{others.length === 1 ? `تبقى وسيلة واحدة تعمل: ${others[0].display_name}.` : `تبقى ${others.length === 2 ? 'وسيلتان تعملان' : `${others.length} وسائل تعمل`}: ${namesList(others.map((x) => x.display_name))}.`} الإيصالات التي رُفعت عليها من قبل لا تتأثر.</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={`حذف «${m.display_name}»؟`} icon="trash" tone="danger"
      actions={[back, <Button key="c" kind="danger" onClick={onConfirm} loading={busy}>حذف الوسيلة</Button>]}>
      <p className="m-0">تُحذف الوسيلة نهائياً ولا يمكن استرجاعها. الإيصالات السابقة تبقى محفوظة، لكن بلا اسم الوسيلة التي دُفعت بها.</p>
      {m.is_active
        ? (last ? cantPay : <p className="m-0">هي تظهر للطلاب الآن، وتختفي من صفحة الدفع فوراً. إن أردت إخفاءها فقط فأوقفها بدل حذفها.</p>)
        : <p className="m-0">هي متوقفة الآن ولا يراها الطلاب، فلا حاجة إلى الحذف إن أردت إخفاءها فقط.</p>}
    </Dialog>
  );
};

// ── Add / edit ──────────────────────────────────────────────────────
const FIELD_LABELS: Record<MethodType, { account: string; holder: string; holderHelp?: string }> = {
  instapay: { account: 'عنوان إنستاباي', holder: 'اسم صاحب الحساب' },
  vodafone_cash: { account: 'رقم المحفظة', holder: 'اسم صاحب المحفظة', holderHelp: 'كما يظهر للطالب عند التحويل.' },
  bank: { account: 'رقم الحساب', holder: 'اسم صاحب الحساب' },
};

const MethodPanel: React.FC<{
  start: MethodDraft; companyId: string; methods: PaymentMethod[]; online: boolean;
  onClose: () => void; onSaved: (row: PaymentMethod) => void; onDelete: (m: PaymentMethod) => void;
}> = ({ start, companyId, methods, online, onClose, onSaved, onDelete }) => {
  const [d, setD] = useState<MethodDraft>(start);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [serverError, setServerError] = useState('');
  // Only a saved method with a name of its own keeps it (and can change it);
  // every other name is the kind's, or the bank's.
  const [custom, setCustom] = useState(() => hasCustomName(start));
  const [renaming, setRenaming] = useState(false);
  const guard = useGuard();
  const saved = methods.find((m) => m.id === d.id);
  const out = withDisplayName(d, custom);
  const errors = methodErrors(out);
  const err = (k: keyof MethodDraft) => ((tried || shown.has(k)) ? errors[k] : undefined);
  const set = (patch: Partial<MethodDraft>) => { setD((x) => ({ ...x, ...patch })); setServerError(''); };
  const blur = (k: keyof MethodDraft) => () => setShown((s) => new Set(s).add(k));
  // What would be saved, against what was there: a name going back to the automatic one counts.
  const dirty = JSON.stringify(out) !== JSON.stringify(withDisplayName(start, hasCustomName(start)));
  const close = () => { if (dirty && !saving) setLeaving(true); else onClose(); };
  const others = methods.filter((m) => m.is_active && m.id !== d.id);
  const labels = FIELD_LABELS[d.method_type];

  const save = () => guard('save', async () => {
    setTried(true);
    if (Object.keys(methodErrors(out)).length) return;
    setSaving(true);
    const row = { ...methodRow(out), company_id: companyId, updated_at: new Date().toISOString() };
    const order = methods.length ? Math.max(...methods.map((m) => m.sort_order)) + 1 : 0;
    const { data, error } = d.id
      ? await supabase.from('company_payment_methods').update(row).eq('id', d.id).select(COLUMNS).single()
      : await supabase.from('company_payment_methods').insert({ ...row, sort_order: order }).select(COLUMNS).single();
    setSaving(false);
    if (error || !data) {
      setServerError(/payment_method_fields/.test(error?.message ?? '') ? 'أكمل بيانات الحساب: العنوان، أو رقم المحفظة، أو اسم البنك ورقم الحساب.' : errorText(error));
      return;
    }
    notifyDone(d.id ? 'حُفظت وسيلة الدفع' : `أُضيفت «${(data as PaymentMethod).display_name}»`, d.is_active ? 'تظهر للطلاب في صفحة الدفع الآن.' : 'محفوظة ومتوقفة؛ لا يراها الطلاب.');
    onSaved(data as PaymentMethod);
  });

  const form = (
    <div className="flex flex-col gap-4">
      <RadioCards<MethodType> label="نوع الوسيلة" value={d.method_type} onChange={(t) => set({ method_type: t })}
        options={METHOD_TYPES.map((t) => ({ value: t, label: METHOD_LABEL[t] }))} />
      {custom && (renaming ? (
        <div className="flex flex-col gap-1.5">
          <TextField label="الاسم الظاهر للطالب" value={d.display_name} maxLength={DISPLAY_NAME_MAX} autoFocus
            onChange={(e) => set({ display_name: e.target.value })} onBlur={blur('display_name')} error={err('display_name')} />
          {autoDisplayName(d) && (
            <Button kind="link" sm className="self-start" onClick={() => { setCustom(false); setRenaming(false); set({ display_name: start.display_name }); }}>
              استخدم «{autoDisplayName(d)}»
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small" data-testid="pm-custom-name">
          <span className="text-ink-2">الاسم الظاهر للطالب:</span>
          <span className="font-semibold">{d.display_name}</span>
          <Button kind="link" sm onClick={() => setRenaming(true)}>تغيير الاسم</Button>
        </div>
      ))}
      {d.method_type === 'instapay' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="عنوان إنستاباي" value={d.instapay_address} ltr placeholder="name@instapay" maxLength={60} autoCapitalize="off" spellCheck={false}
            help="العنوان كما في تطبيق إنستاباي، أو رقم الهاتف المربوط به." onChange={(e) => set({ instapay_address: e.target.value })} onBlur={blur('instapay_address')} error={err('instapay_address')} />
          <TextField label={labels.holder} value={d.account_holder} maxLength={80} onChange={(e) => set({ account_holder: e.target.value })} onBlur={blur('account_holder')} error={err('account_holder')} />
        </div>
      )}
      {d.method_type === 'vodafone_cash' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label={labels.account} value={d.wallet_phone} inputMode="tel" ltr placeholder="01xxxxxxxxx" maxLength={16}
            onChange={(e) => set({ wallet_phone: e.target.value })} onBlur={blur('wallet_phone')} error={err('wallet_phone')} />
          <TextField label={labels.holder} value={d.account_holder} maxLength={80} help={labels.holderHelp} onChange={(e) => set({ account_holder: e.target.value })} onBlur={blur('account_holder')} error={err('account_holder')} />
        </div>
      )}
      {d.method_type === 'bank' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="اسم البنك" value={d.bank_name} maxLength={DISPLAY_NAME_MAX} placeholder="مثل: البنك الأهلي المصري"
              help={custom ? undefined : 'هذا ما يراه الطالب في صفحة الدفع.'} onChange={(e) => set({ bank_name: e.target.value })} onBlur={blur('bank_name')} error={err('bank_name')} />
            <TextField label={labels.holder} value={d.account_holder} maxLength={80} onChange={(e) => set({ account_holder: e.target.value })} onBlur={blur('account_holder')} error={err('account_holder')} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="رقم الحساب" value={d.bank_account_number} inputMode="numeric" ltr maxLength={40} onChange={(e) => set({ bank_account_number: e.target.value })} onBlur={blur('bank_account_number')} error={err('bank_account_number')} />
            <TextField label="رقم الآيبان" optional value={d.iban} ltr placeholder="EG00 0000 0000 0000 0000 0000 0000 0" maxLength={40} autoCapitalize="characters" spellCheck={false}
              help="EG ثم 27 رقماً، كما في كشف الحساب." onChange={(e) => set({ iban: e.target.value })} onBlur={blur('iban')} error={err('iban')} />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pm-instructions" className="flex items-baseline gap-2 text-label font-medium text-ink">
          <span>تعليمات للطالب</span><span className="font-normal text-ink-3">اختياري</span><span className="flex-1" />
          <span className="font-normal text-cap text-ink-3 tabular" dir="ltr">{d.instructions.length} / {INSTRUCTIONS_MAX}</span>
        </label>
        <TextArea id="pm-instructions" value={d.instructions} maxLength={INSTRUCTIONS_MAX} rows={3}
          placeholder="مثال: حوّل المبلغ كاملاً ثم ارفع صورة التحويل." help={d.id ? 'تظهر تحت رقم الحساب. مثال: حوّل المبلغ كاملاً ثم ارفع صورة التحويل.' : undefined}
          onChange={(e) => set({ instructions: e.target.value })} error={err('instructions')} />
      </div>
      <Toggle label="تظهر للطلاب" checked={d.is_active} onChange={(on) => set({ is_active: on })}
        help={d.id ? 'عند إيقافها تبقى محفوظة هنا ولا يراها أحد في التطبيق.' : 'تظهر فور الحفظ في صفحة الدفع.'} />
      {serverError && <Note tone="danger" title="لم تُحفظ الوسيلة">{serverError}</Note>}
    </div>
  );

  return (
    <>
      <SidePanel open onClose={close} w={920} backLabel="وسائل الدفع"
        title={d.id ? 'تعديل وسيلة الدفع' : 'وسيلة دفع جديدة'}
        meta={saved && (saved.is_active ? <Pill tone="success">تظهر للطلاب</Pill> : <Pill tone="neutral">متوقفة</Pill>)}
        sub={saved ? `${saved.display_name} · ${METHOD_LABEL[saved.method_type]}` : undefined}
        footer={(
          <>
            {saved && <Button kind="dangerQuiet" icon="trash" className="hidden sm:inline-flex" disabled={!online} onClick={() => onDelete(saved)}>حذف الوسيلة</Button>}
            <span className="hidden flex-1 sm:block" />
            <Button kind="secondary" className="hidden sm:inline-flex" onClick={close}>رجوع</Button>
            <Button onClick={() => void save()} loading={saving} disabled={!online}>حفظ وسيلة الدفع</Button>
          </>
        )}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-card bg-surface p-4 sm:p-0">{form}</div>
          <PaymentPreview draft={out} others={others} className="lg:self-start" />
          {saved && <Button kind="dangerQuiet" icon="trash" full className="sm:hidden" disabled={!online} onClick={() => onDelete(saved)}>حذف الوسيلة</Button>}
        </div>
      </SidePanel>
      <Dialog open={leaving} onClose={() => setLeaving(false)} title="إغلاق دون حفظ؟" icon="alert" tone="warning"
        actions={[<Button key="s" kind="secondary" onClick={() => setLeaving(false)}>رجوع إلى الوسيلة</Button>, <Button key="l" kind="dangerQuiet" onClick={() => { setLeaving(false); onClose(); }}>الإغلاق دون حفظ</Button>]}>
        <p className="m-0">غيّرت بيانات الوسيلة ولم تحفظ. إن أغلقت الآن يبقى كل شيء كما كان.</p>
      </Dialog>
    </>
  );
};
