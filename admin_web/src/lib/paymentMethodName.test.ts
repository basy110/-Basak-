import { describe, expect, it } from 'vitest';
import { emptyMethod, methodErrors, methodRow, type MethodDraft } from './money';
import { autoDisplayName, hasCustomName, withDisplayName } from './paymentMethodName';

const draft = (patch: Partial<MethodDraft>): MethodDraft => ({ ...emptyMethod(), ...patch });

describe('the name a student sees for a payment method', () => {
  it('is the kind for a wallet or InstaPay, the bank\'s own name for a bank', () => {
    expect(autoDisplayName(draft({ method_type: 'instapay' }))).toBe('إنستاباي');
    expect(autoDisplayName(draft({ method_type: 'vodafone_cash' }))).toBe('فودافون كاش');
    expect(autoDisplayName(draft({ method_type: 'bank', bank_name: '  البنك الأهلي المصري ' }))).toBe('البنك الأهلي المصري');
    expect(autoDisplayName(draft({ method_type: 'bank', bank_name: '' }))).toBe('');
  });

  it('is saved without being typed: a new wallet passes with no name field', () => {
    const d = draft({ method_type: 'vodafone_cash', wallet_phone: '01012345678', account_holder: 'شركة النورس' });
    expect(methodErrors(d).display_name).toBeDefined();
    const out = withDisplayName(d, false);
    expect(methodErrors(out)).toEqual({});
    expect(methodRow(out).display_name).toBe('فودافون كاش');
  });

  it('a bank needs its name, which is then its display name', () => {
    const d = draft({ method_type: 'bank', account_holder: 'شركة النورس', bank_account_number: '1234567890' });
    expect(methodErrors(withDisplayName(d, false)).bank_name).toBe('اكتب اسم البنك.');
    const named = withDisplayName({ ...d, bank_name: 'بنك مصر' }, false);
    expect(methodErrors(named)).toEqual({});
    expect(methodRow(named)).toMatchObject({ display_name: 'بنك مصر', bank_name: 'بنك مصر' });
  });

  it('a saved method keeps a name of its own; a new one never has one', () => {
    expect(hasCustomName(draft({ id: 'm1', method_type: 'vodafone_cash', display_name: 'فودافون كاش (المكتب)' }))).toBe(true);
    expect(hasCustomName(draft({ id: 'm1', method_type: 'vodafone_cash', display_name: 'فودافون كاش' }))).toBe(false);
    expect(hasCustomName(draft({ id: 'm2', method_type: 'bank', bank_name: 'بنك مصر', display_name: 'بنك مصر' }))).toBe(false);
    expect(hasCustomName(draft({ method_type: 'instapay', display_name: 'إنستاباي النورس' }))).toBe(false);
    const own = draft({ id: 'm1', method_type: 'instapay', display_name: 'إنستاباي النورس' });
    expect(withDisplayName(own, true).display_name).toBe('إنستاباي النورس');
    expect(withDisplayName(own, false).display_name).toBe('إنستاباي');
  });
});
