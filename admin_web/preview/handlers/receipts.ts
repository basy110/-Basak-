/**
 * The receipts queue, the receipt's company details and password requests, as on the
 * boards AdmReceipts*, AdmReceiptInfo*, AdmPassword* and AdmPlatPassword*.
 *
 * Extra switches for the states boards, read from the page's address (`&pv=`):
 *   pv=decided   every decision is refused: another admin decided first
 *   pv=fail      every decision fails on the way (no connection)
 *   pv=broken    the second receipt's picture cannot be shown
 *   pv=used      issuing a code is refused: the student already changed the password
 *   pv=many      64 receipts waiting (the long queue)
 *   pv=quiet     no open password request (history only)
 *   pv=err       this page's own list fails to load (the rest of the dashboard works)
 *   pv=slow      this page's own list never answers (its loading state)
 */
import { registerFunctions, registerRpc, rpcs } from '../registry';
import { COMPANY_ID, RECEIPTS, tables } from '../data';

type Row = Record<string, any>;
const flag = (name: string) => new URLSearchParams(location.search).get('pv') === name;
/** The page's own list: fails or hangs on request, so the page's error and loading states can be seen inside a working frame. */
const own = async <T,>(answer: () => T): Promise<T> => {
  if (flag('err')) throw new Error('Failed to fetch');
  if (flag('slow')) await new Promise(() => undefined);
  return answer();
};
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgoAt = (days: number, h: number, m: number) => {
  // A Cairo wall-clock time (UTC+3 in October) `days` days ago.
  const d = new Date(Date.now() - days * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 3, m)).toISOString();
};
const uid = (prefix: string, n: number) => `${prefix}${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`.slice(0, 36);

// ── Receipts ─────────────────────────────────────────────────────────────
const RECEIPT_DEFS: [string, string, string, string, number, number, string, string, string, string, number, string][] = [
  // name, phone, university, college|specialisation, amount, attempt, line, station, departure, return, minutes ago, period
  ['منة الله إبراهيم عبد الرازق', '01023456780', 'جامعة دمياط', 'التجارة|محاسبة', 4500, 2, 'الزرقا', 'كوبري الزرقا', '07:00', '15:00', 180, 'first'],
  ['عمر خالد إسماعيل البنا', '01067890124', 'جامعة حورس', 'طب الأسنان|', 4500, 5, 'دمياط الجديدة', 'موقف الحي الثالث', '07:30', '15:30', 120, 'first'],
  ['نورهان محمود عبد العزيز شلبي', '01501234567', 'جامعة دمياط', 'التربية|رياض أطفال', 9000, 1, 'شربين', 'ميدان المحطة', '06:45', '14:30', 90, 'both'],
  ['زياد عمرو حسن البدراوي', '01556789013', 'جامعة دمياط', 'الآداب|لغة إنجليزية', 4500, 1, 'دمياط الجديدة', 'موقف الحي الثالث', '07:30', '15:30', 60, 'second'],
  ['هاجر أشرف محمد عبد الغني', '01023456781', 'جامعة حورس', 'الصيدلة|', 4500, 3, 'الزرقا', 'كوبري الزرقا', '07:00', '15:00', 40, 'first'],
  ['مصطفى ياسر عبد الهادي زهران', '01178901235', 'المعهد العالي بدمياط الجديدة', 'نظم المعلومات|', 4200, 1, 'فارسكور', 'موقف فارسكور القديم', '07:15', '15:00', 12, 'first'],
  ['شهد تامر إبراهيم الشناوي', '01289012346', 'جامعة دمياط', 'التربية|رياض أطفال', 4500, 1, 'دمياط الجديدة', 'موقف الحي الثالث', '06:50', '14:30', 4, 'first'],
];
const PERIODS: Record<string, [string, string, string, string, string]> = {
  first: ['termly', 'الفصل الأول 2026/2027', '2026-09-19', '2027-01-14', 'current'],
  second: ['termly', 'الفصل الثاني 2026/2027', '2027-02-07', '2027-06-10', 'upcoming'],
  both: ['yearly', 'الفصلان معاً 2026/2027', '2026-09-19', '2027-06-10', 'current'],
};
const receipt = (i: number, d = RECEIPT_DEFS[i % RECEIPT_DEFS.length], minutes = d[10]): Row => {
  const [type, label, start, end, phase] = PERIODS[d[11]];
  const [college, spec] = d[3].split('|');
  return {
    id: uid('4ec0', i + 1), image_url: `${COMPANY_ID}/${uid('57d0', i + 1)}/receipt-${i + 1}.jpg`, attempt_number: d[5], created_at: ago(minutes), amount: d[4],
    subscription_id: uid('5b00', i + 1), student_id: uid('57d0', i + 1), student_name: d[0], student_phone: d[1], university: d[2], college, specialisation: spec || null,
    company_id: COMPANY_ID, company_name: 'النورس للنقل', line_name: d[6], station_name: d[7], departure_time: `${d[8]}:00`, return_time: `${d[9]}:00`,
    subscription_type: type, period_label: label, period_start: start, period_end: end, period_phase: phase, price: d[4],
  };
};
// The shared list (the overview counts it) holds the board's seven, oldest first.
RECEIPTS.splice(0, RECEIPTS.length, ...RECEIPT_DEFS.map((_, i) => receipt(i)));
const MANY = Array.from({ length: 64 }, (_, i) => receipt(i, RECEIPT_DEFS[i % 7], 600 - i * 9));

registerRpc({
  get_pending_receipts_page: ({ p_limit = 50 }) => own(() => {
    const all = (flag('many') ? MANY : RECEIPTS).map((r, i) => (flag('broken') && i === 1 ? { ...r, image_url: null } : r));
    return { rows: all.slice(0, p_limit), has_more: all.length > p_limit, total: all.length };
  }),
  review_receipt: ({ p_receipt_id, p_decision }) => {
    if (flag('decided')) throw new Error('هذا الإيصال لم يعد قيد المراجعة.');
    if (flag('fail')) throw new Error('Failed to fetch');
    const i = RECEIPTS.findIndex((r) => r.id === p_receipt_id);
    if (i < 0) throw new Error('هذا الإيصال لم يعد قيد المراجعة.');
    RECEIPTS.splice(i, 1);
    return { id: p_receipt_id, status: p_decision, company_id: COMPANY_ID, reviewed_at: new Date().toISOString(), overview: null };
  },
});

// ── Password requests ────────────────────────────────────────────────────
const COMPANY_REQUESTS: [string, string, string, string | null, number][] = [
  // name, phone, status, requested (minutes ago or "d:h:m"), failed tries
  ['عبد الرحمن محمد السيد الشربيني', '01134567891', 'pending', '10', 0],
  ['سلمى طارق عبد الحميد سالم', '01178901235', 'code_issued', '32', 2],
  ['كريم وائل السعيد أبو النجا', '01112345679', 'completed', '1:18:15', 0],
  ['آية مصطفى كامل النحاس', '01067890124', 'expired', '1:13:30', 0],
  ['محمد إيهاب رمضان الجمل', '01134567891', 'completed', '2:10:05', 0],
  ['روان هشام عبد الله الطنطاوي', '01245678902', 'cancelled', '3:19:48', 0],
  ['حازم مدحت السيد الصياد', '01134567891', 'completed', '5:8:12', 0],
  ['ندى علاء الدين محمد البسيوني', '01245678902', 'completed', '8:15:20', 0],
  ['فارس جمال عبد الناصر قنديل', '01556789013', 'expired', '11:9:55', 0],
  ['يوسف أحمد عبد الفتاح البنا', '01245678902', 'completed', '12:9:10', 0],
  ['مريم عادل فتحي الدسوقي', '01289012346', 'completed', '14:11:40', 0],
  ['أحمد سامي عبد المقصود حجازي', '01090123457', 'cancelled', '16:7:30', 0],
  ['ملك حسام الدين مصطفى الغنام', '01556789013', 'completed', '18:20:15', 0],
  ['جنى أيمن فؤاد المرسي', '01501234568', 'completed', '21:8:05', 0],
  ['إسلام حمدي عبد الباسط خليل', '01112345679', 'expired', '24:13:25', 0],
  ['بسملة شريف عبد المنعم عوض', '01023456780', 'completed', '27:10:50', 0],
];
const PLATFORM_REQUESTS: [string, string, string, string, string[]][] = [
  ['سلمى طارق عبد الحميد', '01178901234', 'pending', '0:9:05', []],
  ['عمر خالد إسماعيل البنا', '01067890123', 'pending', '0:8:40', ['النورس للنقل']],
  ['مريم عبد الله الدسوقي', '01222104478', 'code_issued', '0:10:12', ['باصات النيل']],
  ['منة الله أحمد عبد الحميد', '01036404328', 'cancelled', '4:7:05', []],
  ['منة الله وليد عبد الحميد', '01099845840', 'completed', '3:17:05', ['الريان باص']],
  ['بسملة عبد الله عبد المقصود', '01034166384', 'expired', '6:5:05', ['أبناء الدقهلية للنقل الجماعي']],
  ['ندى مجدي غنيم', '01086729184', 'expired', '7:7:05', ['أبناء الدقهلية للنقل الجماعي']],
  ['منة الله حسام الدين عبد الرازق', '01070005432', 'completed', '6:11:05', []],
  ['ندى وليد المرسي', '01043523128', 'completed', '5:1:05', ['الريان باص']],
  ['بسملة إبراهيم عبد الرازق', '01071042040', 'cancelled', '1:4:05', ['الريان باص']],
  ['منة الله عبد الله المرسي', '01049843384', 'completed', '2:11:05', ['المدينة للرحلات الجامعية']],
  ['عمر وليد منصور', '01088569968', 'completed', '3:10:05', []],
  ['ندى وليد أبو زيد', '01070404040', 'cancelled', '6:7:05', ['باصات النيل']],
  ['عمر إبراهيم غنيم', '01019205008', 'completed', '3:7:05', ['دمياط الجديدة للنقل الجماعي']],
];
const when = (spec: string) => {
  const parts = spec.split(':').map(Number);
  return parts.length === 1 ? ago(parts[0]) : daysAgoAt(parts[0], parts[1], parts[2]);
};
const resetRow = (i: number, name: string, phone: string, status: string, requested: string, failed: number, companies: string[] | null): Row => {
  const requested_at = when(requested);
  const issued = status === 'code_issued';
  const issuedAt = issued ? new Date(Math.max(Date.parse(requested_at) + 60_000, Date.now() - 21 * 60_000)).toISOString() : status === 'pending' ? null : requested_at;
  return {
    id: uid(companies ? '7e6f' : '7e5c', i + 1), student_id: uid('57e0', i + 1), student_name: name, student_phone: phone, status, requested_at,
    code_issued_at: issuedAt, code_expires_at: issued ? new Date(Date.parse(issuedAt!) + 30 * 60_000).toISOString() : null,
    failed_attempts: failed, closed_at: ['completed', 'cancelled', 'expired'].includes(status) ? requested_at : null, companies,
  };
};
const companyList = COMPANY_REQUESTS.map(([n, p, s, r, f], i) => resetRow(i, n, p, s, r ?? '0', f, null));
const platformList = PLATFORM_REQUESTS.map(([n, p, s, r, c], i) => resetRow(i, n, p, s, r, 0, c));
const listFor = (companyId: string | null, platform: boolean) => {
  const rows = platform && !companyId ? platformList : companyList;
  const shown = flag('quiet') ? rows.filter((r) => !['pending', 'code_issued'].includes(r.status)) : rows;
  return shown.map((r) => (platform && !companyId ? r : { ...r, companies: null }));
};
const findRequest = (id: string) => companyList.find((r) => r.id === id) ?? platformList.find((r) => r.id === id);
const open = (r: Row) => r.status === 'pending' || r.status === 'code_issued';
const sorted = (rows: Row[]) => [...rows].sort((a, b) => Number(open(b)) - Number(open(a)) || b.requested_at.localeCompare(a.requested_at));

registerRpc({
  admin_password_reset_requests: ({ p_company_id }, ctx) => own(() => sorted(listFor(p_company_id ?? null, ctx.as === 'platform'))),
  // The older list (the navigation badge counts it): the same rows without companies.
  admin_list_password_reset_requests: ({ p_company_id }, ctx) => sorted(listFor(p_company_id ?? null, ctx.as === 'platform')).map(({ companies: _c, closed_at: _x, ...rest }) => rest),
  admin_issue_password_reset_code: ({ p_request_id }) => {
    const r = findRequest(p_request_id);
    if (flag('used') && r) { r.status = 'completed'; throw new Error('هذا الطلب مغلق. اطلب من الطالب إرسال طلب جديد.'); }
    if (!r || !open(r)) throw new Error('هذا الطلب مغلق. اطلب من الطالب إرسال طلب جديد.');
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();
    Object.assign(r, { status: 'code_issued', code_issued_at: new Date().toISOString(), code_expires_at: expires, failed_attempts: 0 });
    return { code: '482916', expires_at: expires };
  },
  admin_cancel_password_reset: ({ p_request_id }) => {
    const r = findRequest(p_request_id);
    if (r && open(r)) Object.assign(r, { status: 'cancelled', closed_at: new Date().toISOString() });
    return null;
  },
});

// The platform admin sets a temporary password (students page, «إعادة تعيين كلمة المرور»).
registerFunctions({
  'admin-reset-student-password': ({ password }) => (password ? { ok: true } : { ok: true, temporaryPassword: 'Tq7#mB2x9L' }),
});

// ── The company's details on its receipts ───────────────────────────────
const company = () => tables.companies.find((c) => c.id === COMPANY_ID)!;
const firstUse = () => new URLSearchParams(location.search).get('pv') === 'blank';
const receiptInfo = () => {
  const c = company();
  if (firstUse()) return { phone: '057 240 1188', address: null, commercial_register: null, tax_number: null };
  return { phone: c.receipt_phone ?? '057 240 1188', address: c.receipt_address ?? '12 شارع الجلاء، بجوار موقف الزرقا، دمياط', commercial_register: c.commercial_register ?? null, tax_number: c.tax_number ?? null };
};
registerRpc({
  set_company_receipt_info: ({ p_phone, p_address, p_commercial_register, p_tax_number }) => {
    const c = company();
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    Object.assign(c, { receipt_phone: clean(p_phone), receipt_address: clean(p_address), commercial_register: clean(p_commercial_register), tax_number: clean(p_tax_number) });
    return receiptInfo();
  },
});
// Another area may answer get_subscription_settings; whichever does, the receipt part is there.
const withReceiptInfo = () => {
  const given = rpcs.get_subscription_settings;
  registerRpc({
    get_subscription_settings: async (args, ctx) => {
      if (location.pathname.endsWith('/receipt-details')) await own(() => null);
      const base = given ? await given(args, ctx) : { company_id: args.p_company_id ?? null, terms: [] };
      return args.p_company_id && base && typeof base === 'object' && !(base as Row).receipt_info ? { ...base, receipt_info: receiptInfo() } : base;
    },
  });
};
// Handler files register in name order; wait until all of them have.
setTimeout(withReceiptInfo, 0);
