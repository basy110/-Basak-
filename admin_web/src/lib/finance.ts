import { supabase } from './supabase';

export type ExpensePeriod = 'once' | 'daily' | 'monthly' | 'termly';
export const EXPENSE_PERIOD_LABEL: Record<ExpensePeriod, string> = {
  once: 'مرة واحدة', daily: 'يومي', monthly: 'شهري', termly: 'بالترم',
};

export interface FinanceLine {
  id: string; label?: string; name?: string; period: ExpensePeriod | 'daily' | 'monthly' | 'termly';
  amount: number; cost: number; spent_on?: string | null;
}
export interface CompanyFinance {
  from: string; to: string; income: number;
  salaries: FinanceLine[]; salary_total: number;
  expenses: FinanceLine[]; expense_total: number;
  cost_total: number; net: number;
}

async function call<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Profit and loss over a date range (inclusive, YYYY-MM-DD). */
export const getCompanyFinance = (from: string, to: string) =>
  call<CompanyFinance>('get_company_finance', { p_from: from, p_to: to });

export const addCompanyExpense = (label: string, amount: number, period: ExpensePeriod, spentOn: string | null) =>
  call<{ id: string }>('add_company_expense', { p_label: label, p_amount: amount, p_period: period, p_spent_on: spentOn });

export const deleteCompanyExpense = (id: string) =>
  call<{ deleted: boolean }>('delete_company_expense', { p_id: id });
