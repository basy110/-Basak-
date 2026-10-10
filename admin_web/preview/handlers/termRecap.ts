/**
 * «ملخص الفصل» of the platform admin: answers the functions of
 * supabase/migrations/20261119000004_term_recap_release.sql from sample numbers
 * for the first term of 2026/2027 (and smaller ones for the terms before it).
 * Publishing is kept in memory for the tab; the notification goes out once.
 */
import { registerRpc } from '../registry';

type Row = Record<string, any>;
const params = new URLSearchParams(location.search);
const state = () => sessionStorage.getItem('preview.state') || params.get('state') || '';
const fail = (message: string): never => { throw new Error(message); };

const TERMS: Row[] = [
  { academic_year: 2026, period_code: 'first', name: 'الفصل الدراسي الأول', label: 'الفصل الدراسي الأول 2026/2027', start_date: '2026-09-20', end_date: '2027-01-14' },
  { academic_year: 2025, period_code: 'summer', name: 'الفصل الصيفي', label: 'الفصل الصيفي 2025/2026', start_date: '2026-07-01', end_date: '2026-09-01' },
  { academic_year: 2025, period_code: 'second', name: 'الفصل الدراسي الثاني', label: 'الفصل الدراسي الثاني 2025/2026', start_date: '2026-02-08', end_date: '2026-06-11' },
  { academic_year: 2025, period_code: 'first', name: 'الفصل الدراسي الأول', label: 'الفصل الدراسي الأول 2025/2026', start_date: '2025-09-20', end_date: '2026-01-15' },
];
const key = (y: number, p: string) => `${y}:${p}`;
const RELEASES = new Map<string, Row>([
  [key(2025, 'second'), { academic_year: 2025, period_code: 'second', published: true, published_at: '2026-06-01T09:12:00Z', published_by_name: 'محمد عادل',
    unpublished_at: null, message: null, notified_at: '2026-06-01T09:12:00Z', notified_companies: 21, notified_students: 4630 }],
]);

const today = () => new Date().toISOString().slice(0, 10);
const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The numbers of one term, scaled down for the older ones. */
function numbers(t: Row): Row {
  const k = t.period_code === 'first' && t.academic_year === 2026 ? 1 : t.period_code === 'summer' ? 0.18 : 0.9;
  const n = (x: number) => Math.round(x * k);
  return {
    totals: { students: n(4218), ride_days: n(118_604), return_days: n(71_930), boardings: n(102_377), companies: t.period_code === 'summer' ? 6 : 19,
      lines: n(64), stations: n(412), universities: 9, median_ride_days: Math.max(4, n(31)) },
    top_stations: [
      { id: 'st-1', name: 'كوبري السرو', line_name: 'خط الزرقا', company_name: 'النورس للنقل', students: n(286), ride_days: n(9_120) },
      { id: 'st-2', name: 'موقف المنصورة', line_name: 'خط المنصورة', company_name: 'باصات النيل', students: n(241), ride_days: n(7_684) },
      { id: 'st-3', name: 'ميدان الساعة', line_name: 'خط دمياط', company_name: 'النورس للنقل', students: n(198), ride_days: n(6_305) },
      { id: 'st-4', name: 'فارسكور', line_name: 'خط الزرقا', company_name: 'النورس للنقل', students: n(164), ride_days: n(5_011) },
      { id: 'st-5', name: 'شربين', line_name: 'خط شربين', company_name: 'خطوط الدلتا', students: n(139), ride_days: n(4_377) },
    ],
    top_lines: [
      { id: 'ln-1', name: 'خط الزرقا', company_name: 'النورس للنقل', students: n(612), ride_days: n(19_480) },
      { id: 'ln-2', name: 'خط المنصورة', company_name: 'باصات النيل', students: n(530), ride_days: n(16_212) },
      { id: 'ln-3', name: 'خط دمياط', company_name: 'النورس للنقل', students: n(488), ride_days: n(14_940) },
      { id: 'ln-4', name: 'خط شربين', company_name: 'خطوط الدلتا', students: n(311), ride_days: n(9_602) },
      { id: 'ln-5', name: 'خط السنبلاوين', company_name: 'الريان باص', students: n(244), ride_days: n(7_115) },
    ],
    top_universities: [
      { name: 'جامعة المنصورة الجديدة', students: n(1_620), ride_days: n(47_210) },
      { name: 'جامعة دمياط', students: n(1_104), ride_days: n(30_844) },
      { name: 'جامعة المنصورة', students: n(806), ride_days: n(21_570) },
      { name: 'جامعة الدلتا التكنولوجية', students: n(412), ride_days: n(11_046) },
      { name: 'جامعة حورس', students: n(276), ride_days: n(7_934) },
    ],
    companies: [
      { id: 'co-1', name: 'النورس للنقل', students: n(806), ride_days: n(24_870), boardings: n(21_402) },
      { id: 'co-2', name: 'باصات النيل', students: n(530), ride_days: n(16_212), boardings: n(14_118) },
      { id: 'co-3', name: 'الأمانة لنقل الطلاب', students: n(486), ride_days: n(13_390), boardings: n(11_640) },
      { id: 'co-4', name: 'خطوط الدلتا', students: n(402), ride_days: n(11_908), boardings: n(10_266) },
      { id: 'co-5', name: 'الريان باص', students: n(244), ride_days: n(7_115), boardings: n(6_034) },
    ],
  };
}

const EMPTY = { totals: { students: 0, ride_days: 0, return_days: 0, boardings: 0, companies: 0, lines: 0, stations: 0, universities: 0, median_ride_days: null },
  top_stations: [], top_lines: [], top_universities: [], companies: [] };

function overview({ p_year, p_period }: Row): Row {
  if (state() === 'error' || state() === 'recaperror') fail('Failed to fetch');
  const t = TERMS.find((x) => x.academic_year === p_year && x.period_code === p_period) ?? TERMS[0];
  return {
    today: today(),
    term: { ...t, until: t.end_date < today() ? t.end_date : today(), window_opens: plus(t.end_date, -14), window_closes: plus(t.end_date, 28) },
    options: TERMS.map((x) => ({ ...x, published: !!RELEASES.get(key(x.academic_year, x.period_code))?.published })),
    release: RELEASES.get(key(t.academic_year, t.period_code)) ?? null,
    reach: state() === 'empty' ? { companies: 0, students: 0 } : { companies: 21, students: 4_812 },
    ...(state() === 'empty' ? EMPTY : numbers(t)),
  };
}

registerRpc({
  platform_term_recap_overview: (args) => (state() === 'loading' || state() === 'recaploading' ? new Promise(() => undefined) : overview(args)),
  platform_publish_term_recap: ({ p_year, p_period, p_message }) => {
    const k = key(p_year, p_period);
    const was = RELEASES.get(k);
    const now = new Date().toISOString();
    const first = !was?.notified_at;
    const r: Row = {
      academic_year: p_year, period_code: p_period, published: true,
      published_at: was?.published && was.published_at ? was.published_at : now,
      published_by_name: was?.published ? was.published_by_name : 'محمد عادل',
      unpublished_at: null, message: p_message ?? null,
      notified_at: first ? now : was!.notified_at, notified_companies: first ? 21 : was!.notified_companies,
      notified_students: first ? 4_812 : was!.notified_students, notified_now: first,
    };
    RELEASES.set(k, r);
    return r;
  },
  platform_unpublish_term_recap: ({ p_year, p_period }) => {
    const was = RELEASES.get(key(p_year, p_period));
    if (!was?.published_at) fail('ملخص هذا الفصل غير منشور.');
    const r = { ...was, published: false, unpublished_at: was!.unpublished_at ?? new Date().toISOString(), notified_now: false };
    RELEASES.set(key(p_year, p_period), r);
    return r;
  },
});
