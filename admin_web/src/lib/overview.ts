import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { keys, queryClient, unwrap } from './query';
import { withBranding, type CompanyBrand, type SavedBranding } from './branding';

/** The numbers of one company, as computed by the database (company_overview). */
export interface CompanyNumbers {
  /** With the company's logo and emblem folders (lib/branding.ts); absent from a database that does not know them yet. */
  company: { id: string; name: string; status: 'active' | 'suspended' | 'archived'; created_at: string } & CompanyBrand;
  baseline: string | null;
  members: number;
  active_subscriptions: number;
  pending_receipts: number;
  revenue: number;
  riders_today: number;
  /** The day students are confirming for right now (tomorrow, once its vote opens), and how many have. */
  next_ride_date: string;
  riders_next: number;
  /** When the company's vote closes (HH:MM). */
  vote_closes_at?: string;
  riders_week: { date: string; riders: number }[];
  lines: number;
  active_lines: number;
  supervisors: number;
  admins: number;
  top_lines: { id: string; name: string; is_active: boolean; subscribers: number; company?: string }[];
}

/** Platform totals plus one row per company (platform_overview). */
export interface PlatformNumbers {
  companies: { total: number; active: number; suspended: number; archived: number };
  students: number;
  members: number;
  active_subscriptions: number;
  pending_receipts: number;
  revenue: number;
  riders_today: number;
  next_ride_date: string;
  riders_next: number;
  vote_closes_at?: string;
  riders_week: { date: string; riders: number }[];
  lines: number;
  supervisors: number;
  top_lines: CompanyNumbers['top_lines'];
  per_company: Omit<CompanyNumbers, 'top_lines' | 'riders_week'>[];
}

/** One company's numbers. Live events mark them stale; they are also re-read on focus. */
export function useCompanyOverview(companyId: string) {
  const query = useQuery({
    queryKey: keys.company(companyId, 'overview'),
    queryFn: () => unwrap<CompanyNumbers>(supabase.rpc('company_overview', { p_company_id: companyId })),
  });
  return { data: query.data ?? null, loading: query.isPending, error: query.error?.message ?? '', refresh: () => void query.refetch() };
}

/** The whole platform's numbers. */
export function usePlatformOverview() {
  const query = useQuery({
    queryKey: keys.platform('overview'),
    queryFn: () => unwrap<PlatformNumbers>(supabase.rpc('platform_overview')),
  });
  return { data: query.data ?? null, loading: query.isPending, error: query.error?.message ?? '', refresh: () => query.refetch() };
}

/**
 * A company's marks, from the overview the workspace frame already reads: the
 * sidebar, the company bar and the identity card ask for nothing of their own.
 */
export const useCompanyBrand = (companyId: string): CompanyBrand | null => useCompanyOverview(companyId).data?.company ?? null;

/**
 * Every company's marks by id, for the platform's lists. Read from the platform
 * overview when it is already known (it is the platform's first page), asked
 * for once when it is not, and never re-read just for the pictures.
 */
export function usePlatformBrands(): Record<string, CompanyBrand> {
  const { data } = useQuery({
    queryKey: keys.platform('overview'),
    queryFn: () => unwrap<PlatformNumbers>(supabase.rpc('platform_overview')),
    staleTime: Infinity,
  });
  return useMemo(() => Object.fromEntries((data?.per_company ?? []).map((row) => [row.company.id, row.company])), [data]);
}

/**
 * Shows a saved identity everywhere at once: in the company's own numbers (the
 * sidebar, the company bar, the identity card) and in the platform's list.
 */
export function applySavedBranding(saved: SavedBranding) {
  queryClient.setQueryData<CompanyNumbers>(keys.company(saved.company_id, 'overview'), (numbers) => (numbers ? withBranding(numbers, saved) : numbers));
  queryClient.setQueryData<PlatformNumbers>(keys.platform('overview'), (numbers) => (numbers
    ? { ...numbers, per_company: numbers.per_company.map((row) => withBranding(row, saved)) } : numbers));
}

/** Warms a company's overview before its workspace is opened (hovering its card). */
export const prefetchCompanyOverview = (companyId: string) => queryClient.prefetchQuery({
  queryKey: keys.company(companyId, 'overview'),
  queryFn: () => unwrap<CompanyNumbers>(supabase.rpc('company_overview', { p_company_id: companyId })),
});
