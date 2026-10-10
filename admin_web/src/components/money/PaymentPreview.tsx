import React from 'react';
import { Icon, Ltr, Money, type IconName } from '../../ui';
import { accountText, groups4, normalizeIban, onlyDigits, type MethodDraft, type MethodType, type PaymentMethod } from '../../lib/money';

export const METHOD_ICON: Record<MethodType, IconName> = { instapay: 'card', vodafone_cash: 'smartphone', bank: 'building' };

/** The account line of a draft, as the student will copy it. */
function draftAccount(d: MethodDraft): string {
  if (d.method_type === 'instapay') return d.instapay_address.trim();
  if (d.method_type === 'vodafone_cash') {
    const p = onlyDigits(d.wallet_phone);
    return p.length > 3 ? `${p.slice(0, 3)} ${p.slice(3, 7)} ${p.slice(7)}`.trim() : p;
  }
  return groups4(onlyDigits(d.bank_account_number));
}

/**
 * «هكذا يراها الطالب»: the app's payment page, redrawn as the admin types.
 * A sketch of the wording and the order; the app draws it its own way.
 */
export const PaymentPreview: React.FC<{ draft: MethodDraft; others: PaymentMethod[]; className?: string }> = ({ draft, others, className = '' }) => {
  const account = draftAccount(draft);
  const iban = normalizeIban(draft.iban);
  return (
    <aside aria-label="هكذا يراها الطالب" className={`flex flex-col gap-4 rounded-card bg-sunken/70 p-4 sm:p-5 ${className}`}>
      <div><h3 className="m-0 text-card">هكذا يراها الطالب</h3><p className="m-0 text-label text-ink-2">صفحة الدفع في التطبيق، وتتغيّر وأنت تكتب.</p></div>
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-[20px] bg-surface/80 p-3.5 shadow-card">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-[17px] font-semibold">ادفع اشتراكك</span>
          <span className="text-small font-semibold"><Money value={4500} /></span>
        </div>
        <div className="-mt-2 text-cap text-ink-2">اختر وسيلة، حوّل المبلغ، ثم ارفع صورة التحويل.</div>
        <div className="flex flex-col gap-2.5 rounded-inner bg-surface p-3 shadow-[inset_0_0_0_2px_#00658D]">
          <div className="flex items-center gap-2 text-small font-semibold">
            <Icon name={METHOD_ICON[draft.method_type]} size={18} className="text-ink-2" />
            <span className="min-w-0 flex-1 truncate">{draft.display_name.trim() || 'اسم الوسيلة'}</span>
          </div>
          <div className="flex items-center gap-2 rounded-control bg-teal-tint px-3 py-2.5">
            <span className={`min-w-0 flex-1 truncate text-start text-small font-semibold tabular ${account ? 'text-ink' : 'text-ink-3'}`}><Ltr>{account || '—'}</Ltr></span>
            <span className="inline-flex items-center gap-1 text-label font-medium text-teal"><Icon name="copy" size={14} />نسخ</span>
          </div>
          {draft.method_type === 'bank' && (draft.bank_name.trim() || iban) && (
            <div className="text-cap text-ink-2">
              {draft.bank_name.trim() && <div>{draft.bank_name.trim()}</div>}
              {iban && <div><Ltr>{groups4(iban)}</Ltr> <Ltr>IBAN</Ltr></div>}
            </div>
          )}
          {draft.account_holder.trim() && <div className="text-cap text-ink-2">باسم: <b className="font-semibold text-ink">{draft.account_holder.trim()}</b></div>}
          {draft.instructions.trim() && <div className="whitespace-pre-line border-t border-hair pt-2.5 text-cap text-ink-2">{draft.instructions.trim()}</div>}
        </div>
        {others.map((m) => (
          <div key={m.id} className="flex h-11 items-center gap-2 rounded-inner bg-surface px-3 text-label font-semibold shadow-ring">
            <Icon name={METHOD_ICON[m.method_type]} size={16} className="text-ink-2" />
            <span className="min-w-0 flex-1 truncate">{m.display_name}</span>
            <Icon name="down" size={16} className="text-ink-3" />
          </div>
        ))}
        <div className="flex h-11 items-center justify-center gap-2 rounded-control bg-sunken text-label font-medium text-ink-2">
          <Icon name="image" size={16} />ارفع صورة التحويل
        </div>
      </div>
      <p className="m-0 text-center text-cap text-ink-2">الطالب يضغط «نسخ» فينسخ رقم الحساب كما كتبته.</p>
    </aside>
  );
};

/** For lists: the account in one line, left to right. */
export const AccountText: React.FC<{ m: PaymentMethod }> = ({ m }) => <Ltr className="tabular">{accountText(m)}</Ltr>;
