import { DISPLAY_NAME_MAX, METHOD_LABEL, type MethodDraft } from './money';

/**
 * The name a student sees for a payment method, unless the method keeps a name
 * of its own: «إنستاباي» and «فودافون كاش» by their kind, a bank by its own name
 * (so the admin never types the same name twice). `display_name` is still saved.
 */
export const autoDisplayName = (d: Pick<MethodDraft, 'method_type' | 'bank_name'>): string =>
  d.method_type === 'bank' ? d.bank_name.trim().slice(0, DISPLAY_NAME_MAX).trim() : METHOD_LABEL[d.method_type];

/** A saved method whose name is not the one it would get by itself (e.g. «فودافون كاش (المكتب)»). */
export const hasCustomName = (d: MethodDraft): boolean =>
  !!d.id && d.display_name.trim() !== '' && d.display_name.trim() !== autoDisplayName(d);

/** The draft as it is saved and previewed: the automatic name unless it keeps its own. */
export const withDisplayName = (d: MethodDraft, custom: boolean): MethodDraft =>
  (custom ? d : { ...d, display_name: autoDisplayName(d) });
