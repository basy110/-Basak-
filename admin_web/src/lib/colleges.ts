/**
 * The general college list. A student whose university has no colleges of its own
 * in the `colleges` table picks from this list at sign-up (the app ships it:
 * mobile_app/lib/features/auth/data/colleges.dart — keep the two identical).
 * Once a university has at least one college shown, its students see only those.
 */
export const GENERAL_COLLEGES = [
  'الهندسة', 'الطب', 'الصيدلة', 'طب الأسنان', 'الحاسبات والمعلومات', 'العلوم', 'التجارة',
  'الذكاء الاصطناعي', 'العلاج الطبيعي', 'التمريض', 'الطب البيطري', 'الحقوق', 'الآداب', 'الإعلام',
  'الألسن', 'التربية', 'رياض الأطفال', 'التربية الرياضية', 'الزراعة', 'الفنون', 'السياحة والفنادق',
  'الآثار', 'الخدمة الاجتماعية',
] as const;

/** Names a student typed that are not a college («غير محدد», «-»). */
export const isPlaceholderCollege = (name: string) => /^(غير محدد|لا يوجد|اخرى|أخرى|-+|\.+)$/.test(name.trim());
