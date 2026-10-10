/**
 * The words of a platform recommendation (platform_analytics → insights). The
 * database decides which rules fired and with which numbers; this turns each into
 * a title, a line of numbers and where to act. Pure: no React, no network
 * (unit-tested in platformInsights.test.ts).
 */
import { countText, dayText, moneyText, num, NOUN } from '../ui/format';
import { hoursText, percentText } from './analyticsInsights';
import { platformLabel } from './appVersions';
import type { PlatformInsight } from './platformFinance';

export type InsightTone = 'danger' | 'warning' | 'success' | 'teal';
export interface InsightText { tone: InsightTone; title: string; sub: string; action?: { label: string; to: string } }

const n = (v: unknown) => Number(v ?? 0);
const companyLink = (id: unknown) => ({ label: 'افتح الشركة', to: id ? `/platform/companies?company=${id}` : '/platform/companies' });
const name = (v: unknown) => `«${String(v ?? '')}»`;
const days = (v: unknown) => countText(n(v), NOUN.day);
/** «4,500 ج.م» that never breaks between the number and its unit. */
const money = (v: number) => moneyText(v).replace(' ', '\u00A0');
const TONE_OF = { act: 'danger', watch: 'warning', good: 'success' } as const;

/** Title, numbers and action for one recommendation. */
export function platformInsightText(insight: PlatformInsight): InsightText {
  const d = insight.data ?? {};
  const tone: InsightTone = TONE_OF[insight.severity] ?? 'warning';
  switch (insight.key) {
    case 'company_overdue':
      return {
        tone: 'danger',
        title: `${name(d.name)} متأخرة في سداد ${money(n(d.amount))}`,
        sub: `أقدم فاتورة لم تُسدّد بدأت ${d.oldest_due ? dayText(String(d.oldest_due)) : ''}${d.days != null ? `، منذ ${days(d.days)}` : ''}. ذكّرها، أو سجّل السداد إن وصل.`,
        action: { label: 'افتح الفواتير', to: '/platform/billing?tab=charges' },
      };
    case 'no_plan': {
      const list: { id: string; name: string }[] = Array.isArray(d.companies) ? d.companies : [];
      const count = n(d.count) || list.length;
      return {
        tone: 'danger',
        title: count === 1 && list[0] ? `${name(list[0].name)} بلا اشتراك للمنصة` : `${countText(count, NOUN.company)} بلا اشتراك للمنصة`,
        sub: count > 1 && list.length
          ? `${list.slice(0, 3).map((c) => c.name).join('، ')}${count > 3 ? ' وغيرها' : ''}. حدّد ما تدفعه كل شركة حتى تصدر فواتيرها.`
          : 'حدّد ما تدفعه الشركة وكل كم، حتى تصدر فواتيرها.',
        action: { label: 'حدّد الاشتراك', to: '/platform/billing?tab=plans' },
      };
    }
    case 'unprofitable':
      return {
        tone: 'danger',
        title: 'تكاليف التشغيل أكبر من المحصّل في هذه الفترة',
        sub: `التكاليف ${money(n(d.costs))} والمحصّل ${money(n(d.collected))}، أي خسارة ${money(n(d.loss))}.`,
        action: { label: 'افتح الأرباح', to: '/platform/billing?tab=pnl' },
      };
    case 'company_inactive':
      return {
        tone: 'warning',
        title: d.last_seen ? `مديرو ${name(d.name)} لم يدخلوا اللوحة منذ ${days(d.days)}` : `لم يدخل أحد من مديري ${name(d.name)} اللوحة بعد`,
        sub: 'الشركة التي لا تتابع لوحتها تتأخر في مراجعة الإيصالات والرد على الطلاب. تواصل معها.',
        action: companyLink(d.company_id),
      };
    case 'company_declining':
      return {
        tone: 'warning',
        title: `مشتركو ${name(d.name)} نقصوا ${percentText(n(d.pct))}`,
        sub: `${num(n(d.now))} مشتركاً الآن مقابل ${num(n(d.before))} في آخر يوم من الفترة السابقة.`,
        action: companyLink(d.company_id),
      };
    case 'slow_reviews':
      return {
        tone: 'warning',
        title: `${name(d.name)} تراجع الإيصالات في ${hoursText(n(d.median_hours))}`,
        sub: `في المتوسط، لـ${countText(n(d.reviewed), NOUN.receipt)}. الطالب لا يركب حتى يُقبل إيصاله.`,
        action: companyLink(d.company_id),
      };
    case 'old_app_versions': {
      const p = platformLabel[d.platform as 'ios' | 'android'] ?? String(d.platform ?? '');
      return {
        tone: 'warning',
        title: `${percentText(n(d.pct))} من أجهزة ${p} على إصدار أقدم من ⁦${d.latest}⁩`,
        sub: `${num(n(d.old))} من ${num(n(d.total))} جهازاً. ذكّرهم بالتحديث، وارفع أقل إصدار مسموح حين يكون الجديد متاحاً منذ أيام.`,
        action: { label: 'افتح الإصدارات', to: '/platform/app-versions' },
      };
    }
    case 'cost_per_student_rising':
      return {
        tone: 'warning',
        title: `تكلفة الطالب الواحد ارتفعت ${percentText(n(d.pct))}`,
        sub: `${money(n(d.now))} للمشترك مقابل ${money(n(d.before))} في الفترة السابقة. راجع تكاليف التشغيل.`,
        action: { label: 'افتح التكاليف', to: '/platform/billing?tab=expenses' },
      };
    case 'university_opportunity':
      return {
        tone: 'teal',
        title: `${countText(n(d.students), NOUN.student)} في ${d.name} ${n(d.lines) === 0 ? 'ولا خط يخدمها' : 'وخط واحد فقط'}`,
        sub: 'فرصة لشركة جديدة، أو لخطوط أكثر من شركة قائمة.',
        action: { label: 'افتح الجامعات', to: '/platform/universities' },
      };
    default:
      return { tone, title: 'ملاحظة على المنصة', sub: '' };
  }
}

const KNOWN = new Set([
  'company_overdue', 'no_plan', 'unprofitable', 'company_inactive', 'company_declining', 'slow_reviews', 'old_app_versions',
  'cost_per_student_rising', 'university_opportunity',
]);
const RANK = { act: 0, watch: 1, good: 2 } as const;

/** The recommendations this dashboard knows how to word, those that need action first (the server's order kept within). */
export function platformInsights(list: PlatformInsight[] | null | undefined): PlatformInsight[] {
  return (list ?? []).filter((i) => KNOWN.has(i.key))
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => (RANK[a.insight.severity] ?? 1) - (RANK[b.insight.severity] ?? 1) || a.index - b.index)
    .map((x) => x.insight);
}

export const SEVERITY_WORD: Record<InsightTone, string> = { danger: 'يحتاج تصرفاً', warning: 'للمتابعة', teal: 'فرصة', success: 'جيد' };
