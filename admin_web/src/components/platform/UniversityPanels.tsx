import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Dialog, FieldRow, Note, SidePanel, StatePill, TextField, countText, num, NOUN } from '../../ui';
import { collegeProblem, collegeStudents, universityProblem, type CollegeRow, type UniversityCounts, type UniversityRow } from '../../lib/platform';

export const studentsText = (n: number | null | undefined) => (n == null ? '—' : n === 0 ? 'لا طلاب' : `${num(n)} ${n === 1 ? 'طالب' : n === 2 ? 'طالبان' : 'طالباً'}`);
export const UniState: React.FC<{ on: boolean }> = ({ on }) => <StatePill state={on ? 'on' : 'off'} label={on ? 'تظهر' : 'مخفية'} />;

/** «إضافة جامعة» (AdmPlatUniversitiesAdd): a name as students know it and its city; nothing pre-filled. */
export const UniversityAddPanel: React.FC<{
  open: boolean; initialName?: string; all: UniversityRow[]; busy: boolean; online: boolean; serverError?: string;
  onClose: () => void; onAdd: (name: string, city: string) => void;
}> = ({ open, initialName = '', all, busy, online, serverError, onClose, onAdd }) => {
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setName(initialName); setCity(''); setTried(false); } }, [open, initialName]);
  const problem = universityProblem(name, city, all);
  const submit = () => { setTried(true); if (!problem.name && !problem.city) onAdd(name.trim().replace(/\s+/g, ' '), city.trim()); };
  return (
    <SidePanel open={open} onClose={onClose} title="إضافة جامعة" sub="وجهة جديدة يختارها الطلاب والشركات" backLabel="الجامعات والكليات"
      footer={<><Button kind="secondary" onClick={onClose}>إلغاء</Button><span className="hidden flex-1 sm:block" /><Button icon="plus" loading={busy} disabled={!online} onClick={submit}>أضف الجامعة</Button></>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <TextField label="اسم الجامعة" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus
          error={(tried || (problem.name ?? '').startsWith('توجد')) ? problem.name ?? serverError : serverError} help="اكتبه كما يعرفه الطلاب. يظهر في التسجيل وعلى بطاقة الطالب." />
        <TextField label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} error={tried ? problem.city : undefined} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      <Note tone="teal" title="بعد الإضافة">أضف كلياتها من صفحتها: الطالب لا يستطيع اختيار جامعة بلا كليات. تظهر فوراً للشركات في إنشاء الخطوط.</Note>
    </SidePanel>
  );
};

/**
 * One university (AdmPlatUniversitiesPanel, AdmPlatUniversityPhone): its name and city,
 * edited and saved by their own button; its colleges, each shown or hidden by one
 * named button; and the companies whose lines go there.
 */
export const UniversityPanel: React.FC<{
  u: UniversityRow | null; all: UniversityRow[]; colleges: CollegeRow[]; counts: UniversityCounts | null | undefined; online: boolean; busy: string | null;
  onClose: () => void; onSave: (name: string, city: string) => void; onAddCollege: (name: string) => Promise<boolean>;
  onCollege: (c: CollegeRow, show: boolean) => void; onUniversity: (show: boolean) => void; saveError?: string;
}> = ({ u, all, colleges, counts, online, busy, onClose, onSave, onAddCollege, onCollege, onUniversity, saveError }) => {
  const [name, setName] = useState(u?.name ?? '');
  const [city, setCity] = useState(u?.city ?? '');
  const [college, setCollege] = useState('');
  const [collegeError, setCollegeError] = useState('');
  useEffect(() => { setName(u?.name ?? ''); setCity(u?.city ?? ''); setCollege(''); setCollegeError(''); }, [u?.id, u?.name, u?.city]);
  if (!u) return null;
  const mine = colleges.filter((c) => c.university_id === u.id).sort((a, b) => Number(b.is_active) - Number(a.is_active) || (collegeStudents(counts ?? undefined, u.id, b.name) ?? 0) - (collegeStudents(counts ?? undefined, u.id, a.name) ?? 0) || a.name.localeCompare(b.name, 'ar'));
  const shownCount = mine.filter((c) => c.is_active).length;
  const n = counts?.universities.find((x) => x.id === u.id);
  const changed = name.trim() !== u.name || city.trim() !== u.city;
  const problem = changed ? universityProblem(name, city, all, u.id) : {};
  const addCollege = async () => {
    const p = collegeProblem(college, colleges, u.id);
    setCollegeError(p ?? '');
    if (p) return;
    if (await onAddCollege(college.trim().replace(/\s+/g, ' '))) setCollege('');
  };
  return (
    <SidePanel open onClose={onClose} title={u.name} meta={<UniState on={u.is_active} />} w={560} backLabel="الجامعات والكليات"
      sub={`${u.city}${n ? ` · ${studentsText(n.students)}` : ''}`}
      footer={<>
        {u.is_active
          ? <Button kind="dangerQuiet" icon="eyeOff" disabled={!online || busy === 'uni'} onClick={() => onUniversity(false)}>أخفِ الجامعة</Button>
          : <Button icon="eye" loading={busy === 'uni'} disabled={!online} onClick={() => onUniversity(true)}>أظهر الجامعة</Button>}
        <span className="hidden flex-1 sm:block" />
        <Button kind="secondary" onClick={onClose} className="hidden sm:inline-flex">إغلاق</Button>
      </>}>
      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-card">بيانات الجامعة</h3>
        <FieldRow cols="minmax(0,3fr) minmax(0,2fr)">
          <TextField label="الاسم كما يراه الطالب" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} error={problem.name ?? saveError} />
          <TextField label="المدينة" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} error={problem.city} />
        </FieldRow>
        {changed && n && n.students > 0 && name.trim() !== u.name && (
          <p className="m-0 text-label text-ink-2">يتغيّر الاسم أيضاً عند {countText(n.students, NOUN.student)} مسجّلين بها، وعلى بطاقاتهم.</p>
        )}
        <div className="flex">
          <Button kind="tonal" className="w-full sm:w-auto" disabled={!changed || !online || !!problem.name || !!problem.city} loading={busy === 'save'}
            onClick={() => onSave(name.trim().replace(/\s+/g, ' '), city.trim())}>حفظ بيانات الجامعة</Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2"><h3 className="m-0 flex-1 text-card">الكليات</h3><Badge>{num(mine.length)} · {num(shownCount)} تظهر</Badge></div>
        <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); void addCollege(); }}>
          <TextField aria-label="اسم الكلية" placeholder="اسم الكلية كما يظهر للطالب" value={college} onChange={(e) => { setCollege(e.target.value); setCollegeError(''); }} maxLength={80} error={collegeError || undefined} className="flex-1" />
          <Button type="submit" kind="tonal" icon="plus" loading={busy === 'college'} disabled={!online}>أضف كلية</Button>
        </form>
        {mine.length === 0 ? (
          <Note tone="warning" title="لا كليات بعد">لا يستطيع طالب أن يختار هذه الجامعة عند التسجيل حتى تضيف كلية واحدة على الأقل.</Note>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {mine.map((c, i) => {
              const s = collegeStudents(counts ?? undefined, u.id, c.name);
              return (
                <li key={c.id} className={`flex min-h-12 items-center gap-3 py-1.5 ${i ? 'border-t border-hair' : ''}`}>
                  <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                    <span className={`min-w-0 flex-1 truncate text-small ${c.is_active ? 'font-medium' : 'text-ink-3'}`}>{c.name}</span>
                    <span className="text-label text-ink-3 sm:w-24 sm:text-start">{studentsText(s)}{!c.is_active && <span className="sm:hidden"> · مخفية</span>}</span>
                  </span>
                  {!c.is_active && <span className="hidden sm:inline-flex"><Badge>مخفية</Badge></span>}
                  <Button sm kind="outline" className="!h-11 sm:!h-9" disabled={!online || busy === `college:${c.id}`} onClick={() => onCollege(c, !c.is_active)}
                    aria-label={`${c.is_active ? 'أخفِ' : 'أظهر'} كلية ${c.name}`}>{c.is_active ? 'أخفِ' : 'أظهر'}</Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2"><h3 className="m-0 flex-1 text-card">شركات لها خطوط إليها</h3>{n && <Badge>{num(n.companies.length)}</Badge>}</div>
        {!n ? <p className="m-0 text-label text-ink-3">—</p> : n.companies.length === 0 ? (
          <p className="m-0 text-label text-ink-2">لا خط يذهب إليها الآن.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {n.companies.map((c) => <Link key={c.id} to={`/c/${c.id}/lines`} className="inline-flex h-7 items-center rounded-control bg-teal-tint px-2.5 text-cap font-medium text-teal hover:bg-teal-tint2">{c.name}</Link>)}
          </div>
        )}
      </section>
    </SidePanel>
  );
};

/** «إخفاء جامعة حورس؟»: who stops seeing it, and who keeps it. */
export const HideUniversityDialog: React.FC<{ u: UniversityRow | null; counts: UniversityCounts | null | undefined; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ u, counts, busy, onClose, onConfirm }) => {
  if (!u) return null;
  const n = counts?.universities.find((x) => x.id === u.id);
  const keep = n
    ? `لا يتغيّر شيء عند ${n.students > 2 ? `الـ${num(n.students)} طالباً` : n.students === 0 ? 'أي طالب' : countText(n.students, NOUN.student)} المسجّلين بها، ولا في ${n.lines === 0 ? 'أي خط' : `خطوط الشركات ${n.lines > 2 ? `الـ${num(n.lines)} ` : ''}`}التي تذهب إليها. بياناتها تبقى، وتستطيع إظهارها في أي وقت.`
    : 'لا يتغيّر شيء عند الطلاب المسجّلين بها، ولا في خطوط الشركات التي تذهب إليها. بياناتها تبقى، وتستطيع إظهارها في أي وقت.';
  return (
    <Dialog open onClose={onClose} title={`إخفاء ${u.name}؟`} icon="eye" tone="danger"
      actions={[<Button key="b" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="g" kind="danger" loading={busy} onClick={onConfirm}>أخفِ الجامعة</Button>]}>
      <p className="m-0">لن تظهر لطالب جديد عند إنشاء حسابه، ولا لشركة عند اختيار وجهات خط جديد.</p>
      <p className="m-0">{keep}</p>
    </Dialog>
  );
};

/** «إخفاء كلية الصيدلة؟» — asked only when students are registered in it. */
export const HideCollegeDialog: React.FC<{ c: CollegeRow | null; uni: string; students: number; busy: boolean; onClose: () => void; onConfirm: () => void }> = ({ c, uni, students, busy, onClose, onConfirm }) => {
  if (!c) return null;
  return (
    <Dialog open onClose={onClose} title={`إخفاء كلية ${c.name.replace(/^كلية\s+/, '')}؟`} icon="eye" tone="danger"
      actions={[<Button key="b" kind="secondary" onClick={onClose}>رجوع</Button>, <Button key="g" kind="danger" loading={busy} onClick={onConfirm}>أخفِ الكلية</Button>]}>
      <p className="m-0">لن تظهر لطالب جديد يسجّل في {uni}. {students > 2 ? `الـ${num(students)} طالباً المسجّلون` : students === 2 ? 'الطالبان المسجّلان' : 'الطالب المسجّل'} بها {students === 2 ? 'يبقيان' : students === 1 ? 'يبقى' : 'يبقون'} كما {students === 1 ? 'هو' : students === 2 ? 'هما' : 'هم'}.</p>
    </Dialog>
  );
};
