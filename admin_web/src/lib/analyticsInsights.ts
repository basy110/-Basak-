/**
 * The words of a recommendation (company_analytics → insights). The database
 * decides which rules fired and with which numbers; this turns each into a
 * title, a line of numbers and where to act, in the dashboard's register.
 * Pure: no React, no network (unit-tested in analyticsInsights.test.ts), so
 * «اليوم» can show the first few without loading the analytics page.
 */
import { clock, countText, num, NOUN } from '../ui/format';
import type { CompanyAnalytics, Insight } from './analytics';

export type InsightTone = 'danger' | 'warning' | 'success' | 'teal';
export interface InsightText { tone: InsightTone; title: string; sub: string; action?: { label: string; to: string } }

const n = (v: unknown) => Number(v ?? 0);
/**
 * «43%» that stays «43%» inside an Arabic sentence: after Arabic letters the
 * digits would otherwise turn Arabic-number and the sign jump before them; a
 * left-to-right mark in front keeps them together.
 */
export const percentText = (whole: number) => `\u200E${num(whole)}%`;
const pctOf = (share: unknown) => Math.round(n(share) * 100);
const dir = (d: unknown) => (d === 'return' ? 'العودة' : 'الذهاب');
/** «رحلة الذهاب 7:00 ص» (the trip's own label when it has one: «رحلة الذهاب الأولى 7:00 ص»). */
const tripName = (d: Record<string, any>) => `رحلة ${dir(d.direction)}${d.label ? ` «${d.label}»` : ''}${d.start_time ? ` ${clock(d.start_time)}` : ''}`;
const days = (v: unknown) => countText(n(v), NOUN.day);
const students = (v: unknown) => countText(n(v), NOUN.student);
const receipts = (v: unknown) => countText(n(v), NOUN.receipt);
const seats = (v: unknown) => countText(n(v), NOUN.seat);
const riders = (v: number) => (Number.isInteger(v) ? countText(v, NOUN.rider) : `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} راكباً`);

/** A review time: «أقل من ساعة», «5 ساعات», «30 ساعة», «3 أيام». */
export function hoursText(hours: number): string {
  if (hours < 1) return 'أقل من ساعة';
  if (hours < 48) return countText(Math.round(hours), ['ساعة', 'ساعتين', 'ساعات', 'ساعة']);
  return countText(Math.round(hours / 24), ['يوم', 'يومين', 'أيام', 'يوماً']);
}

const TONE_OF = { act: 'danger', watch: 'warning', good: 'success' } as const;

/** Title, numbers and action for one recommendation; `base` is `/c/<companyId>`. */
export function insightText(insight: Insight, base: string): InsightText {
  const d = insight.data ?? {};
  const line = (id: unknown) => (id ? `${base}/lines/${id}` : `${base}/lines`);
  const openLine = (id: unknown) => ({ label: 'افتح الخط', to: line(id) });
  const tone: InsightTone = TONE_OF[insight.severity] ?? 'warning';
  switch (insight.key) {
    case 'over_capacity':
      return {
        tone: 'danger',
        title: `${tripName(d)} على خط ${d.line_name} تمتلئ فوق المقاعد`,
        sub: `زاد الركاب على ${seats(d.capacity)} في ${days(d.days_over)} من ${days(d.ride_days)}، وأعلى عدد ${num(n(d.peak_riders))}. أضف رحلة أو باصاً أكبر.`,
        action: openLine(d.line_id),
      };
    case 'low_utilisation':
      return {
        tone: 'warning',
        title: `${tripName(d)} على خط ${d.line_name} شبه فارغة`,
        sub: `متوسط ${riders(n(d.avg_riders))} من ${seats(d.capacity)} (${percentText(n(d.pct))}). يمكن دمجها مع رحلة قريبة أو تشغيل باص أصغر.`,
        action: openLine(d.line_id),
      };
    case 'empty_trip':
      return {
        tone: 'warning',
        title: `لم يؤكد أحد ${tripName(d)} على خط ${d.line_name}`,
        sub: `لا تأكيد واحد في ${days(d.ride_days)} تشغيل. أوقفها أو غيّر موعدها.`,
        action: openLine(d.line_id),
      };
    case 'unserved_university':
      return {
        tone: 'danger',
        title: `${students(d.members)} من ${d.university_name} بلا خط يوصلهم`,
        sub: 'لا خط يعمل عندك إلى هذه الجامعة، فلا يرون خطاً يشتركون فيه. أضفها إلى خط أو أنشئ خطاً لها.',
        action: { label: 'افتح الخطوط', to: `${base}/lines` },
      };
    case 'station_concentration':
      return {
        tone: 'teal',
        title: `${percentText(n(d.pct))} من مشتركي خط ${d.line_name} يركبون من «${d.station_name}»`,
        sub: `${num(n(d.count))} من ${num(n(d.line_total))} مشتركاً. رحلة تبدأ من هذه المحطة قد تخفف الزحام وتختصر الطريق.`,
        action: openLine(d.line_id),
      };
    case 'never_subscribed':
      return {
        tone: 'teal',
        title: `${students(d.count)} انضموا ولم يشتركوا بعد`,
        sub: `من ${students(d.members)} في شركتك. أرسل لهم إشعاراً بمواعيد الاشتراك وأسعاره.`,
        action: { label: 'أرسل إشعاراً', to: `${base}/notifications` },
      };
    case 'ending_soon':
      return {
        tone: 'danger',
        title: `اشتراك ${students(d.count)} ينتهي خلال ${days(d.days ?? 14)}`,
        sub: 'ولم يجددوا بعد. ذكّرهم بإشعار قبل أن ينقطعوا عن الركوب.',
        action: { label: 'أرسل تذكيراً', to: `${base}/notifications` },
      };
    case 'low_confirmation_line':
      return {
        tone: 'warning',
        title: `طلاب خط ${d.line_name} يؤكدون الركوب أقل من غيرهم`,
        sub: `يؤكد ${percentText(pctOf(d.rate))} منهم مقابل ${percentText(pctOf(d.company_rate))} في الشركة كلها. ذكّرهم بتأكيد الركوب كل يوم.`,
        action: { label: 'أرسل إشعاراً', to: `${base}/notifications` },
      };
    case 'method_rejections':
      return {
        tone: 'warning',
        title: `${percentText(n(d.pct))} من إيصالات «${d.name ?? 'وسيلة محذوفة'}» تُرفض`,
        sub: `رُفض ${receipts(d.rejected)} من ${num(n(d.total))}. وضّح تعليمات الدفع لهذه الوسيلة حتى يرسل الطلاب الإيصال الصحيح.`,
        action: { label: 'افتح وسائل الدفع', to: `${base}/payment-methods` },
      };
    case 'slow_review':
      return {
        tone: 'danger',
        title: `مراجعة الإيصال تأخذ ${hoursText(n(d.median_hours))}`,
        sub: `في المتوسط، لـ${receipts(d.reviewed)}. الطالب لا يركب حتى تقبل إيصاله؛ راجع الإيصالات مرة كل يوم على الأقل.`,
        action: { label: 'افتح الإيصالات', to: `${base}/receipts` },
      };
    case 'no_capacity': {
      const lines: { id: string; name: string }[] = Array.isArray(d.lines) ? d.lines : [];
      const count = n(d.count) || lines.length;
      return {
        tone: 'warning',
        title: count === 1 && lines[0] ? `خط ${lines[0].name} بلا عدد مقاعد` : `${countText(count, NOUN.line)} بلا عدد مقاعد`,
        sub: 'بدون عدد المقاعد لا نعرف متى تمتلئ الرحلات أو تبقى فارغة. اكتبه في صفحة الخط.',
        action: openLine(lines[0]?.id),
      };
    }
    case 'high_confirmation':
      return {
        tone: 'success',
        title: `${percentText(pctOf(d.rate))} من المشتركين يؤكدون ركوبهم`,
        sub: `على مدى ${days(d.ride_days)} تشغيل، فأعداد الرحلات التي تراها قريبة من الواقع.`,
      };
    case 'fast_review':
      return {
        tone: 'success',
        title: `تراجع الإيصالات خلال ${hoursText(n(d.median_hours))}`,
        sub: `في المتوسط، لـ${receipts(d.reviewed)}. سرعة المراجعة تجعل الطلاب يركبون من أول يوم.`,
      };
    default:
      return { tone, title: 'ملاحظة على الخدمة', sub: '' };
  }
}

const KNOWN = new Set([
  'over_capacity', 'low_utilisation', 'empty_trip', 'unserved_university', 'station_concentration', 'never_subscribed',
  'ending_soon', 'low_confirmation_line', 'method_rejections', 'slow_review', 'no_capacity', 'high_confirmation', 'fast_review',
]);
const RANK = { act: 0, watch: 1, good: 2 } as const;

/**
 * The first `n` recommendations worth showing: rules this dashboard knows how to
 * word, those that need action first (the server's order within a severity is kept).
 */
export function topInsights(data: Pick<CompanyAnalytics, 'insights'> | null | undefined, count: number): Insight[] {
  const list = (data?.insights ?? []).filter((i) => KNOWN.has(i.key));
  return list
    .map((insight, index) => ({ insight, index }))
    .sort((a, b) => (RANK[a.insight.severity] ?? 1) - (RANK[b.insight.severity] ?? 1) || a.index - b.index)
    .slice(0, Math.max(0, count))
    .map((x) => x.insight);
}
