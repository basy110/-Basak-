import 'package:flutter/material.dart';

import 'package:basak_mobile/core/ui/ui.dart';

/// The legal pages shown in-app from signup and both account screens.
class LegalLinks {
  LegalLinks._();

  static const String terms = 'terms';
  static const String privacy = 'privacy';

  static Future<void> open(BuildContext context, String page) async {
    if (page != terms && page != privacy) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _LegalCard(terms: page == terms),
    );
  }
}

class _LegalCard extends StatelessWidget {
  final bool terms;
  const _LegalCard({required this.terms});

  static const _termsSections = <(String, String)>[
    (
      'الخدمة',
      '«باصك» منصة تربط طلاب الجامعات بشركات نقل تدير خطوط باصات. الاشتراك خدمة نقل فعلية تقدّمها شركة النقل التي تختارها، وهي المسؤولة عن الرحلات ومواعيدها وأسعارها.'
    ),
    (
      'حسابك',
      'سجّل ببيانات صحيحة وبرقم هاتف يخصّك. حافظ على سرية كلمة المرور، فأنت مسؤول عما يحدث بحسابك. بطاقة الاشتراك ورمزها لك وحدك، ولا يجوز إعطاؤها لغيرك.'
    ),
    (
      'الدفع',
      'يتم الدفع لشركة النقل مباشرة بالتحويل (مثل InstaPay أو المحافظ الإلكترونية أو التحويل البنكي) مع رفع صورة الإيصال، أو نقداً في الباص للاشتراك اليومي. لا يتم أي دفع داخل التطبيق. تراجع الشركة الإيصال وتفعّل الاشتراك أو ترفضه مع ذكر السبب. سياسة الاسترداد تخص شركة النقل.'
    ),
    (
      'الاستخدام المقبول',
      'لا يجوز رفع إيصالات غير صحيحة، أو انتحال شخصية غيرك، أو محاولة الوصول إلى بيانات الآخرين أو تعطيل الخدمة. يحق للشركة أو لإدارة باصك إيقاف الحساب المخالف.'
    ),
    (
      'المسؤولية',
      'نبذل جهدنا لتعمل الخدمة دون انقطاع، لكنها تُقدَّم كما هي. شركة النقل مسؤولة عن الرحلات نفسها. لا تتحمّل باصك مسؤولية التأخير أو الإلغاء من جانب الشركة.'
    ),
    (
      'إنهاء الحساب',
      'يمكنك حذف حسابك في أي وقت من التطبيق من حسابي ← حذف الحساب. وتجد سياسة الخصوصية في التطبيق.'
    ),
    ('التواصل', 'للتواصل: basy1102000@gmail.com'),
  ];
  static const _privacySections = <(String, String)>[
    (
      'مقدمة',
      '«باصك» تطبيق لاشتراكات باصات الجامعة في مصر. يشترك فيه الطالب في خط باص تديره شركة نقل، ويستخدمه مشرف الباص لتسجيل صعود الطلاب. تشرح هذه السياسة البيانات التي نجمعها ولماذا نجمعها ومن يراها وكيف تحذفها.'
    ),
    (
      'البيانات التي نجمعها',
      'بيانات الحساب: الاسم ورقم الهاتف (وهو اسم الدخول) والبريد الإلكتروني إن أضفته وكلمة المرور (تُحفظ مشفّرة ولا يراها أحد). بيانات الدراسة: الجامعة والكلية والتخصص وتاريخ الميلاد إن أضفته. الصور: صورتك الشخصية إن أضفتها وصور إيصالات الدفع التي ترفعها. الاشتراكات والمدفوعات: الخط والمحطة والمواعيد والفترة والسعر وحالة الإيصال والإيصال الرسمي الذي تصدره الشركة. لا يجمع التطبيق بيانات بطاقات بنكية ولا يتم أي دفع داخله؛ الدفع تحويل أو نقداً للشركة مباشرة. كما نجمع تأكيد ركوب رحلة اليوم وتسجيل الصعود عند مسح البطاقة وقراءة الإشعارات ورمز إشعارات الجهاز ومعرّف تثبيت التطبيق لإرسال إشعارات الخدمة.'
    ),
    (
      'ما لا نجمعه',
      'لا نجمع موقعك الجغرافي، ولا نتتبعك عبر تطبيقات أو مواقع أخرى، ولا نستخدم إعلانات، ولا نبيع بياناتك.'
    ),
    (
      'لماذا نستخدمها',
      'لتشغيل الخدمة فقط: إنشاء حسابك، وإصدار بطاقة اشتراكك ورمزها، ومراجعة إيصالك وتفعيل اشتراكك، ومعرفة عدد الركاب في كل رحلة، وإرسال إشعارات الخدمة (قبول الإيصال وتذكير التصويت وانتهاء الاشتراك)، ومساعدتك عند نسيان كلمة المرور.'
    ),
    (
      'من يرى بياناتك',
      'شركة النقل التي تشترك في خطوطها ترى بيانات حسابك واشتراكك وإيصالاتك وركوبك لتدير اشتراكك. مشرف الباص على خطك يرى اسمك وصورتك وحالة اشتراكك عند مسح بطاقتك وأرقام التواصل اللازمة للرحلة. يطّلع فريق باصك على البيانات لإدارة المنصة والرد على طلبات الدعم. ويعالج مزوّدو الخدمة التقنية البيانات لهذا الغرض: Supabase (قاعدة البيانات وتخزين الملفات، في الاتحاد الأوروبي)، وGoogle Firebase وApple (توصيل الإشعارات وبطاقة Apple Wallet إن أضفتها). لا نشارك بياناتك مع أي طرف آخر إلا إذا طلب القانون ذلك.'
    ),
    (
      'الحماية والتخزين',
      'تنتقل البيانات مشفّرة (HTTPS)، وتُحفظ صور الإيصالات والصور الشخصية في مساحة خاصة لا تُفتح إلا لمن له صلاحية. تُحفظ جلسة الدخول على هاتفك في المخزن الآمن للجهاز.'
    ),
    (
      'مدة الاحتفاظ',
      'نحتفظ ببياناتك ما دام حسابك قائماً. الإشعارات القديمة تُحذف تلقائياً. الإيصالات الرسمية التي أصدرتها الشركة سجلات مالية تبقى لديها المدة التي يتطلبها القانون، حتى بعد حذف حسابك.'
    ),
    (
      'حذف حسابك وحقوقك',
      'الطالب يحذف حسابه من التطبيق: حسابي ← حذف الحساب. يُحذف الحساب وبياناته وصوره وصور إيصالاته فوراً وتتوقف بطاقته. حسابات المشرفين تنشئها الشركة، ويُطلب حذفها من إدارة الشركة. يمكنك الاطلاع على بياناتك وتعديلها من صفحة حسابك، وطلب تصحيح ما لا تستطيع تعديله، وحذف حسابك في أي وقت.'
    ),
    (
      'الأطفال والتواصل',
      'التطبيق موجّه لطلاب الجامعات وليس موجّهاً للأطفال. لأي سؤال عن الخصوصية: basy1102000@gmail.com. قد نحدّث هذه السياسة ونذكر تاريخ آخر تحديث أعلى الصفحة.'
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final sections = terms ? _termsSections : _privacySections;
    return FractionallySizedBox(
      heightFactor: .88,
      child: Container(
        decoration: BoxDecoration(
          color: colors.ground,
          borderRadius: const BorderRadius.vertical(
              top: Radius.circular(BasakRadius.sheet)),
        ),
        child: Column(children: [
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(BasakSpace.gutter,
                BasakSpace.s12, BasakSpace.gutter, BasakSpace.s8),
            child: Row(children: [
              const SizedBox(width: 48),
              Expanded(
                  child: Text(terms ? 'شروط الاستخدام' : 'سياسة الخصوصية',
                      textAlign: TextAlign.center,
                      style: context.text.sheetTitle)),
              IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                  tooltip: 'إغلاق'),
            ]),
          ),
          Text('باصك · آخر تحديث: 19 أكتوبر 2026',
              style: context.text.label.copyWith(color: colors.ink2)),
          const SizedBox(height: BasakSpace.s12),
          Expanded(
              child: ListView(
                  padding: const EdgeInsetsDirectional.fromSTEB(
                      BasakSpace.gutter, 0, BasakSpace.gutter, BasakSpace.s24),
                  children: [
                BasakCard(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                      for (var i = 0; i < sections.length; i++) ...[
                        if (i > 0) const SizedBox(height: BasakSpace.s18),
                        Text(sections[i].$1, style: context.text.headline),
                        const SizedBox(height: BasakSpace.s4),
                        Text(sections[i].$2,
                            textAlign: TextAlign.start,
                            style: context.text.body
                                .copyWith(color: colors.ink2, height: 1.7)),
                      ],
                    ])),
              ])),
        ]),
      ),
    );
  }
}
