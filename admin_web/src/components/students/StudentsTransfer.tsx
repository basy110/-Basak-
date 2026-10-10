import React, { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImportPanel, type ImportField } from '../../ui/Transfer';
import { STATUS } from '../../ui/Status';
import { cairo, clock, countText, NOUN } from '../../ui/format';
import { exportSheet, type ExportColumn } from '../../lib/excel';
import { invokeEdgeFunction } from '../../lib/edgeFunctions';
import { keys, usePageData, VARIANT_GC } from '../../lib/query';
import { activeStations, useLineOptions } from '../../lib/reference';
import { useGuard } from '../../lib/guard';
import { notifyDone } from '../../lib/toasts';
import { checkStudentRow, tripChoices, type CreateStudentBody, type ImportKey } from '../../lib/studentImport';
import {
  companiesText, fetchAllStudents, mainSubscription, openSubscriptions, studentShown, type PlatformStudent, type Shown, type StudentRow,
} from '../../lib/students';

const SHOWN_LABEL = (s: Shown) => (s === 'none' ? 'بلا اشتراك' : STATUS[s][0]);
const day = (iso: string | null | undefined) => (!iso ? '' : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : cairo(iso).day);

/** One row per student, its main subscription spelled out (the list's columns, and what the panel adds). */
const studentColumns = (today: string): ExportColumn<StudentRow>[] => {
  const m = (r: StudentRow) => mainSubscription(r, today);
  return [
    { label: 'الاسم', value: (r) => r.full_name, width: 30 },
    { label: 'رقم الهاتف', value: (r) => r.phone, width: 16 },
    { label: 'الجامعة', value: (r) => r.university, width: 26 },
    { label: 'الكلية', value: (r) => (r.college && r.college !== 'غير محدد' ? r.college : ''), width: 18 },
    { label: 'التخصص', value: (r) => r.specialisation ?? '', width: 16 },
    { label: 'الخط', value: (r) => m(r)?.line_name ?? '', width: 18 },
    { label: 'المحطة', value: (r) => m(r)?.station_name ?? '', width: 18 },
    { label: 'ميعاد الذهاب', value: (r) => (m(r)?.departure_time ? clock(m(r)!.departure_time) : ''), width: 13 },
    { label: 'ميعاد العودة', value: (r) => (m(r)?.return_time ? clock(m(r)!.return_time) : ''), width: 13 },
    { label: 'الاشتراك', value: (r) => m(r)?.period_label ?? '', width: 24 },
    { label: 'الحالة', value: (r) => SHOWN_LABEL(studentShown(r, today)), width: 14 },
    { label: 'يبدأ', value: (r) => day(m(r)?.start_date), width: 13 },
    { label: 'ينتهي', value: (r) => day(m(r)?.end_date), width: 13 },
    { label: 'المبلغ (ج.م)', value: (r) => (m(r) ? Number(m(r)!.price) : null), format: '#,##0', width: 13 },
    { label: 'تاريخ الدفع', value: (r) => day(m(r)?.paid_at), width: 13 },
    { label: 'اشتراكات مفتوحة', value: (r) => openSubscriptions(r, today).length, width: 15 },
    { label: 'سُجّل في', value: (r) => day(r.joined_at ?? r.created_at), width: 13 },
  ];
};

/** «طلاب النورس للنقل-2026-10-10.xlsx». */
export const exportStudents = (rows: StudentRow[], today: string, companyName: string, what = 'طلاب') =>
  exportSheet({ name: `${what} ${companyName}`, sheet: 'الطلاب', columns: studentColumns(today), rows });

/** «كل الطلاب-2026-10-10.xlsx»: every account with the companies it is in. */
export const exportPlatformStudents = (rows: PlatformStudent[], name = 'كل الطلاب') => exportSheet<PlatformStudent>({
  name, sheet: 'كل الطلاب', rows, columns: [
    { label: 'الاسم', value: (r) => r.full_name, width: 30 },
    { label: 'رقم الهاتف', value: (r) => r.phone, width: 16 },
    { label: 'الجامعة', value: (r) => r.university, width: 26 },
    { label: 'الشركات', value: (r) => r.memberships.filter((x) => x.status === 'active').map((x) => x.company).join('، '), width: 30 },
    { label: 'العضوية', value: (r) => companiesText(r.memberships.filter((x) => x.status === 'active').length), width: 16 },
    { label: 'أُزيل من', value: (r) => r.memberships.filter((x) => x.status !== 'active').map((x) => x.company).join('، '), width: 22 },
    { label: 'اشتراكات نشطة', value: (r) => r.active_subscriptions, width: 14 },
    { label: 'سُجّل في', value: (r) => day(r.created_at), width: 13 },
  ],
});

/**
 * «استيراد من Excel»: many students at once, each through the same edge function as
 * «إضافة طالب» (admin-create-student). A phone that already has an account gets an
 * invitation, as it does there.
 */
export const StudentsImport: React.FC<{ open: boolean; onClose: () => void; companyId: string; today: string }> = ({ open, onClose, companyId, today }) => {
  const client = useQueryClient();
  const guard = useGuard();
  const invited = useRef(0);
  const options = useLineOptions(companyId, open);
  const lines = useMemo(() => (options.data?.lines ?? []).filter((l) => l.company_id === companyId), [options.data, companyId]);
  const universities = useMemo(() => options.data?.universities ?? [], [options.data]);
  // The company's phones, to say before sending which rows are already students here.
  const phonesKey = keys.company(companyId, 'studentPhones', { all: 1 });
  const members = usePageData(phonesKey, async () => (await fetchAllStudents({ companyId, search: '', status: '', lineId: '', universityId: '', sort: 'newest' }, today)).map((r) => r.phone),
    { enabled: open, gcTime: VARIANT_GC });
  const memberSet = useMemo(() => (members.data ? new Set(members.data) : null), [members.data]);

  const fields = useMemo<ImportField<ImportKey>[]>(() => {
    // The template's example row uses a real line, station and trip of the company.
    const line = lines.find((l) => activeStations(l).length) ?? lines[0];
    const station = activeStations(line)[0];
    const uni = universities.find((u) => line && tripChoices(line, 'departure', station?.id ?? '', u.id).length) ?? universities[0];
    const dep = line && station && uni ? tripChoices(line, 'departure', station.id, uni.id)[0] : undefined;
    return [
      { key: 'name', label: 'الاسم بالكامل', aliases: ['الاسم', 'اسم الطالب', 'name', 'full name'], required: true, example: 'محمد أحمد علي حسن' },
      { key: 'phone', label: 'رقم الهاتف', aliases: ['الهاتف', 'الموبايل', 'رقم الموبايل', 'التليفون', 'phone', 'mobile'], required: true, example: '01012345678' },
      { key: 'password', label: 'كلمة المرور', aliases: ['كلمة السر', 'الباسورد', 'password'], required: true, example: 'Basak2026' },
      { key: 'university', label: 'الجامعة', aliases: ['university'], required: true, example: uni?.name ?? 'جامعة المنصورة' },
      { key: 'college', label: 'الكلية', aliases: ['college', 'faculty'], example: 'الهندسة' },
      { key: 'line', label: 'الخط', aliases: ['اسم الخط', 'line'], required: true, example: line?.name ?? '' },
      { key: 'station', label: 'المحطة', aliases: ['محطة الركوب', 'station'], required: true, example: station?.name ?? '' },
      { key: 'departure', label: 'ميعاد الذهاب', aliases: ['رحلة الذهاب', 'departure'], example: dep ? clock(dep.time) : '' },
      { key: 'return', label: 'ميعاد العودة', aliases: ['رحلة العودة', 'return'] },
      { key: 'type', label: 'نوع الاشتراك', aliases: ['النوع', 'type'], example: 'فصل دراسي' },
    ];
  }, [lines, universities]);

  const ready = !!options.data;
  const importOne = async (body: CreateStudentBody) => {
    await guard(`import:${body.phone}`, async () => {
      const answer = await invokeEdgeFunction<{ id?: string; invited?: boolean }>('admin-create-student', { ...body });
      if (answer?.invited) invited.current += 1;
    });
  };
  const finished = (added: number) => {
    void client.invalidateQueries({ queryKey: keys.company(companyId, 'students') });
    void client.invalidateQueries({ queryKey: keys.company(companyId, 'studentPhones') });
    if (invited.current) {
      void client.invalidateQueries({ queryKey: keys.company(companyId, 'invites') });
      const invites = countText(invited.current, ['دعوة', 'دعوتان', 'دعوات', 'دعوة']);
      notifyDone(added > invited.current ? `سُجّل ${countText(added - invited.current, NOUN.student)} وأُرسلت ${invites}` : `أُرسلت ${invites}`, 'لأصحاب الأرقام التي لها حساب في باصك دعوة يقبلونها من التطبيق، وتتابعها في تبويب «الدعوات».');
    }
    invited.current = 0;
  };

  return (
    <ImportPanel<ImportKey, CreateStudentBody> open={open} onClose={onClose} title="استيراد طلاب من Excel" what="من الطلاب"
      fields={fields} templateName="قالب استيراد الطلاب"
      note={!ready
        ? (options.error ? 'تعذّر تحميل الجامعات والخطوط. أغلق النافذة وافتحها مرة أخرى.' : 'جارٍ تحميل الجامعات والخطوط… انتظر لحظة قبل اختيار الملف.')
        : <>يُسجَّل كل طالب كما في «إضافة طالب»: باشتراك «بانتظار الدفع» في الفترة الحالية. الرقم الذي له حساب في باصك تصله دعوة بدلاً من حساب جديد.
          اكتب الجامعة والخط والمحطة كما تظهر في الصفحة. ميعادا الذهاب والعودة ونوع الاشتراك اختيارية: إن تُركت فأول رحلة و«فصل دراسي».</>}
      check={(row, index, all) => (ready
        ? checkStudentRow(row, index, all, { universities, lines, members: memberSet })
        : { ok: false, label: row.name, error: 'لم تُحمَّل الخطوط بعد. اختر الملف مرة أخرى بعد لحظة.' })}
      importOne={importOne} onFinished={finished} />
  );
};
