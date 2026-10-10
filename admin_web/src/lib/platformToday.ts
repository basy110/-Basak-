/**
 * «اليوم» of the platform admin (docs/canvas/AdmPlatToday*): one request,
 * `platform_today`, under an `overview` key so lib/sync.ts refreshes it with the
 * platform's overview. Kept apart from lib/today.ts so the company's first page
 * does not download it.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { keys } from './query';
import { rpcOr } from './rpc';
import { agoText, countText, num, NOUN } from '../ui/format';
import { forgotTitle, names, oldestText, type Attention, type PlatformCompanyRow, type PlatformToday } from './today';

export type { PlatformCompanyRow, PlatformToday };

export const platformTodayKey = keys.platform('overview', 'today');

export function usePlatformToday() {
  const query = useQuery({ queryKey: platformTodayKey, queryFn: loadPlatformToday, refetchOnMount: 'always' });
  return { data: query.data ?? null, loading: query.isPending, error: query.error, updatedAt: query.dataUpdatedAt, refresh: () => void query.refetch() };
}

export const loadPlatformToday = () => rpcOr<PlatformToday>('platform_today', () => supabase.rpc('platform_today'), () => import('./todayLegacy').then((m) => m.legacyPlatformToday()));

// ── Platform: what waits ────────────────────────────────────────────
/** «أُنشئت منذ 6 أيام», «أُنشئت أمس», «أُنشئت في 3 أكتوبر 2026». */
export function createdText(iso: string | null | undefined, now: Date = new Date()): string {
  const ago = agoText(iso, now);
  if (!ago) return 'أُنشئت';
  return ago.startsWith('منذ') || ago === 'أمس' || ago === 'الآن' ? `أُنشئت ${ago}` : `أُنشئت في ${ago}`;
}
const active =(r: PlatformCompanyRow) => r.company.status === 'active';

/** The platform's «يحتاج قرارك الآن». Counts of corrections and requests come live from the frame. */
export function platformAttention(d: PlatformToday, o: { corrections: number; passwordRequests: number; now?: Date }): Attention[] {
  const out: Attention[] = [];
  const now = o.now ?? new Date();
  if (o.corrections > 0) {
    const from = d.corrections.companies.length ? `من ${d.corrections.companies.slice(0, 2).join(' و')}${d.corrections.companies.length > 2 ? ' وغيرهما' : ''}` : '';
    out.push({
      key: 'corrections', count: o.corrections, tone: 'warning',
      title: `${o.corrections === 1 ? 'طلب تصحيح بيانات ينتظر' : o.corrections === 2 ? 'طلبا تصحيح بيانات ينتظران' : `${countText(o.corrections, NOUN.request)} تصحيح بيانات تنتظر`} قرارك`,
      sub: [oldestText(d.corrections.oldest_at, now), from].filter(Boolean).join(' · ') || 'من الشركات',
      action: 'راجع الطلبات', to: '/platform/corrections',
    });
  }
  if (o.passwordRequests > 0) {
    const w = Math.min(d.password_requests.without_company, o.passwordRequests);
    const sub = w === 0 ? 'تستطيع شركاتهم أن تعطيهم الرمز، أو أعطه أنت'
      : o.passwordRequests === 1 ? 'بلا شركة، ولا يستطيع أحد غيرك أن يعطيه رمزاً'
        : w === 1 ? `${o.passwordRequests === 2 ? 'أحدهما' : 'أحدهم'} بلا شركة، ولا يستطيع أحد غيرك أن يعطيه رمزاً`
          : `${num(w)} منهم بلا شركة، ولا يستطيع أحد غيرك أن يعطيهم رمزاً`;
    out.push({ key: 'passwords', count: o.passwordRequests, tone: 'teal', title: forgotTitle(o.passwordRequests), sub, action: 'افتح الطلبات', to: '/platform/password-requests' });
  }
  const working = d.per_company.filter(active);
  const lineless = working.filter((r) => r.lines === 0);
  if (lineless.length === 1) {
    const c = lineless[0];
    out.push({ key: 'lineless', icon: 'route', tone: 'danger', title: `${c.company.name} بلا أي خط`, sub: `${createdText(c.company.created_at, now)} ولا يراها الطلاب في التطبيق`, action: 'اعرض الشركة', to: `/c/${c.company.id}` });
  } else if (lineless.length > 1) {
    out.push({ key: 'lineless', icon: 'route', tone: 'danger', title: `${countText(lineless.length, NOUN.company)} بلا أي خط`, sub: `${names(lineless.map((c) => c.company.name))} — لا يراها الطلاب في التطبيق`, action: 'اعرض الشركات', to: '/platform/companies' });
  }
  const unpaid = working.filter((r) => r.payment_methods === 0);
  if (unpaid.length === 1) {
    out.push({ key: 'unpaid', icon: 'card', tone: 'danger', title: `${unpaid[0].company.name} بلا وسيلة دفع`, sub: 'لا يستطيع طلابها أن يدفعوا', action: 'اعرض الشركة', to: `/c/${unpaid[0].company.id}` });
  } else if (unpaid.length > 1) {
    out.push({ key: 'unpaid', icon: 'card', tone: 'danger', title: `${countText(unpaid.length, NOUN.company)} بلا وسيلة دفع`, sub: `${names(unpaid.map((c) => c.company.name))} — لا يستطيع طلابها أن يدفعوا`, action: 'اعرض الشركات', to: '/platform/companies' });
  }
  const idle = working.filter((r) => r.active_lines > 0 && (r.payment_methods ?? 0) > 0 && r.selling === false);
  if (idle.length === 1) {
    out.push({ key: 'idle', icon: 'calendar', tone: 'warning', title: `${idle[0].company.name} لا تعرض أي اشتراك للبيع`, sub: 'لها خطوط ووسيلة دفع، لكن كل الفصول موقوفة عن البيع', action: 'اعرض الشركة', to: `/c/${idle[0].company.id}/subscription-periods` });
  } else if (idle.length > 1) {
    out.push({ key: 'idle', icon: 'calendar', tone: 'warning', title: `${countText(idle.length, NOUN.company)} لا تعرض أي اشتراك للبيع`, sub: `${names(idle.map((c) => c.company.name))} — لها خطوط ووسيلة دفع`, action: 'اعرض الشركات', to: '/platform/companies' });
  }
  if (d.push_failed_24h > 0) {
    out.push({ key: 'push', icon: 'megaphone', tone: 'danger', title: `${countText(d.push_failed_24h, ['تنبيه لم يصل', 'تنبيهان لم يصلا', 'تنبيهات لم تصل', 'تنبيهاً لم تصل'])} إلى الهواتف في آخر 24 ساعة`, sub: 'الإشعارات نفسها ظهرت داخل التطبيق', action: 'افتح الإشعارات', to: '/platform/notifications' });
  }
  return out;
}

/** A receipt has waited more than a day: the company is falling behind. */
export const isPilingUp = (row: Pick<PlatformCompanyRow, 'oldest_receipt_at' | 'pending_receipts'>, now: Date = new Date()) =>
  row.pending_receipts > 0 && !!row.oldest_receipt_at && now.getTime() - new Date(row.oldest_receipt_at).getTime() > 24 * 3_600_000;

/** «26 تعمل · 2 موقوفتان». */
export function companiesHint(c: PlatformToday['companies']): string {
  const stopped = c.total - c.active;
  if (stopped === 0) return c.total === 0 ? 'لا شركات بعد' : 'كلها تعمل';
  return `${num(c.active)} تعمل · ${stopped === 2 ? '2 موقوفتان' : `${num(stopped)} موقوفة`}`;
}
