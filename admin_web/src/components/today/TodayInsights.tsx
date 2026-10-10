import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Section, SkeletonList, num } from '../../ui';
import { LineChart } from '../../ui/Chart';
import { useCompanyAnalytics } from '../../lib/analytics';
import { insightText, topInsights, type InsightTone } from '../../lib/analyticsInsights';

const DOT: Record<InsightTone, string> = { danger: 'bg-bad', warning: 'bg-warn', success: 'bg-ok', teal: 'bg-teal' };

/**
 * «أهم التوصيات» on «اليوم»: the three recommendations that matter most over the
 * last 30 days (from «التحليلات»), and how many confirmed riding on the last ride
 * days. Loaded after the page, so «اليوم» itself never waits for it.
 */
export const TodayInsights: React.FC<{ companyId: string; base: string }> = ({ companyId, base }) => {
  const { data, loading } = useCompanyAnalytics(companyId, '30d');
  const all = <Link to={`${base}/analytics`} className="text-label font-semibold text-teal hover:underline">كل التحليلات</Link>;
  if (loading && !data) return <Section title="أهم التوصيات" end={all}><SkeletonList rows={3} /></Section>;
  if (!data) return null;

  const items = topInsights(data, 3).map((i) => ({ key: `${i.key}-${JSON.stringify(i.data).length}`, ...insightText(i, base) }));
  const days = data.daily.slice(-7);
  const last = days[days.length - 1];
  return (
    <Section title="أهم التوصيات" end={all}>
      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        {items.length === 0 ? (
          <div className="px-4 py-4 sm:px-5">
            <div className="text-small font-semibold">لا توصيات الآن</div>
            <div className="text-label text-ink-2">الباصات والتأكيد والإيصالات تسير كما ينبغي في آخر 30 يوماً.</div>
          </div>
        ) : (
          <ul className="m-0 list-none divide-y divide-hair p-0">
            {items.map((it) => (
              <li key={it.key} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span aria-hidden="true" className={`mt-2 h-2 w-2 flex-none rounded-full ${DOT[it.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-small font-semibold">{it.title}</div>
                  <div className="text-label text-ink-2">{it.sub}</div>
                </div>
                {it.action && <Button kind="link" sm to={it.action.to} className="flex-none">{it.action.label}</Button>}
              </li>
            ))}
          </ul>
        )}
        {days.length >= 2 && (
          <div className="border-t border-hair px-4 pb-3 pt-3 sm:px-5">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-label text-ink-2">
              <span>تأكيد الركوب في آخر {num(days.length)} أيام تشغيل</span>
              {last && <span className="tabular text-ink">{num(last.confirmed)} من {num(last.subscribers)}</span>}
            </div>
            <LineChart compact label="تأكيد الركوب في آخر أيام التشغيل"
              series={[
                { name: 'أكّدوا', tone: 'teal', points: days.map((d) => ({ x: d.date, y: d.confirmed })) },
                { name: 'المشتركون', tone: 'muted', points: days.map((d) => ({ x: d.date, y: d.subscribers })) },
              ]} />
          </div>
        )}
      </div>
    </Section>
  );
};

export default TodayInsights;
