import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../ui/Button';
import { useOnline } from '../ui/Feedback';
import { Page, PageHeader, PhoneBar } from '../ui/Layout';
import { useAdminScope, useCompany } from '../lib/adminScope';
import { keys, usePageData } from '../lib/query';
import { cairoToday } from '../lib/time';
import { useLineNames, useUniversities } from '../lib/reference';
import { blockedLookup, useBlockedPhones } from '../lib/blockedPhones';
import { useSignedUrls } from '../lib/signedUrls';
import { loadCompanyCorrections } from '../lib/corrections';
import { fetchStudentsList, inviteState, loadInvites, type StudentRow, type StudentsListAnswer } from '../lib/students';
import { Tabs } from '../components/students/parts';
import { NO_FILTER, StudentsList, type ListFilter } from '../components/students/StudentsList';
import { StudentPanel } from '../components/students/StudentPanel';
import { CorrectionsTab, InvitesTab } from '../components/students/RequestTabs';
import { AddStudentFlow } from '../components/students/AddStudentFlow';
import { StudentsImport } from '../components/students/StudentsTransfer';

type Tab = 'students' | 'invites' | 'corrections';

/**
 * «الطلاب» (docs/canvas/AdmStudents*, AdmStudent*): the company's students with their
 * subscriptions, the invitations it sent and the name corrections it asked for, each
 * in its own tab; a student opens in a side panel; «إضافة طالب» is three steps.
 * The URL carries ?q= (search), ?student=<id> (the open student, from the top bar),
 * ?tab=invites|corrections and ?add=1.
 */
export const StudentsPage: React.FC = () => {
  const admin = useAdminScope();
  const company = useCompany();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const base = `/c/${company.id}`;
  const today = cairoToday();
  const isSuper = admin.role === 'super_admin';

  const tab = (['invites', 'corrections'].includes(params.get('tab') ?? '') ? params.get('tab') : 'students') as Tab;
  const q = params.get('q') ?? '';
  const studentId = params.get('student');
  const adding = params.get('add') === '1';
  const setParam = useCallback((patch: Record<string, string | null>, replace = false) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      return n;
    }, { replace });
  }, [setParams]);

  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [onPage, setOnPage] = useState<StudentRow[]>([]);
  const onAnswer = useCallback((answer: StudentsListAnswer | undefined, filtered: boolean) => {
    setOnPage(answer?.rows ?? []);
    if (answer && !filtered) setAllCount(answer.counts?.all ?? answer.total);
  }, []);

  const lineNames = useLineNames(company.id);
  const universities = useUniversities();
  const activeUniversities = useMemo(() => (universities.data ?? []).filter((u) => u.is_active), [universities.data]);
  const invites = usePageData(keys.company(company.id, 'invites'), () => loadInvites(company.id));
  const corrections = usePageData(keys.company(company.id, 'corrections'), () => loadCompanyCorrections(company.id));
  // Blocks of the company's students. The platform admin blocks as the platform, a company admin as the company.
  const blockOf = blockedLookup(useBlockedPhones(company.id).data);
  const blockAs = isSuper ? null : company.id;

  // The open student: from the page on screen, or read alone (a link from the top bar's search).
  const fromPage = studentId ? onPage.find((r) => r.id === studentId) : undefined;
  const alone = usePageData(keys.company(company.id, 'students', 'one', { id: studentId ?? '' }), () => fetchStudentsList({
    companyId: company.id, search: '', status: '', lineId: '', universityId: '', sort: 'newest', limit: 1, offset: 0, studentId: studentId ?? undefined,
  }, today), { enabled: !!studentId && !fromPage && !adding });
  const open = fromPage ?? alone.data?.rows[0];
  const openAvatar = useSignedUrls('student-avatars', [open?.profile_image_url]);

  // The total of the tab: the unfiltered list's, or what was last seen of it.
  // On another tab the default list is read once for its number (the same key the list uses, so it is reused there).
  const defaultList = usePageData(keys.company(company.id, 'students', 'list', { search: '', status: '', line: '', uni: '', sort: '', page: 0 }), () => fetchStudentsList({
    companyId: company.id, search: '', status: '', lineId: '', universityId: '', sort: 'newest', limit: 25, offset: 0,
  }, today), { enabled: tab !== 'students' && allCount === null });
  const defaultAnswer = defaultList.data;
  const studentsTotal = allCount ?? defaultAnswer?.counts?.all ?? defaultAnswer?.total ?? null;
  const pendingInvites = invites.data ? invites.data.filter((i) => inviteState(i) === 'pending').length : null;
  const pendingCorrections = corrections.data ? corrections.data.filter((c) => c.status === 'pending').length : null;

  const startAdd = () => setParam({ add: '1', student: null });
  if (adding) {
    return (
      <AddStudentFlow companyId={company.id} companyName={company.name} back={`${base}/students`}
        onLeave={() => setParam({ add: null })}
        onOpenStudent={(id) => setParam({ add: null, tab: null, student: id || null })}
        onShowInvites={() => setParam({ add: null, tab: 'invites' })} />
    );
  }

  return (
    <Page>
      <PageHeader title="الطلاب" sub={<span className="hidden sm:inline">كل من يركب مع شركتك: بياناته، اشتراكه وحالته.</span>} phoneActions={false}
        actions={<>
          <Button kind="outline" icon="upload" disabled={!online} onClick={() => setImporting(true)}>استيراد من Excel</Button>
          <Button icon="plus" disabled={!online} onClick={startAdd}>إضافة طالب</Button>
        </>} />
      <div className="max-sm:-mt-5"><Tabs<Tab> label="أقسام الطلاب" value={tab} onChange={(t) => setParam({ tab: t === 'students' ? null : t })}
        tabs={[
          { value: 'students', label: 'الطلاب', count: studentsTotal },
          { value: 'invites', label: 'الدعوات', count: pendingInvites },
          { value: 'corrections', label: 'طلبات تصحيح الاسم', short: 'تصحيح الاسم', count: pendingCorrections },
        ]} /></div>

      {tab === 'students' && (
        <StudentsList companyId={company.id} companyName={company.name} today={today} q={q} onSearch={(v) => setParam({ q: v || null }, true)}
          filter={filter} onFilter={setFilter} lines={lineNames.data ?? []} universities={activeUniversities}
          openId={studentId} onOpen={(row) => setParam({ student: row.id })} onAdd={startAdd} online={online} onImport={() => setImporting(true)} onAnswer={onAnswer} />
      )}
      {tab === 'invites' && (
        <InvitesTab companyId={company.id} data={invites.data} loading={invites.loading} error={invites.error} reload={() => void invites.reload()} onAdd={startAdd} online={online} />
      )}
      {tab === 'corrections' && (
        <CorrectionsTab data={corrections.data} loading={corrections.loading} error={corrections.error} reload={() => void corrections.reload()} />
      )}

      {tab === 'students' && studentsTotal !== 0 && <PhoneBar><Button full icon="plus" disabled={!online} onClick={startAdd}>إضافة طالب</Button></PhoneBar>}

      {open && (
        <StudentPanel key={open.id} student={open} company={company} base={base} isSuper={isSuper} today={today} online={online}
          avatarUrl={open.profile_image_url ? openAvatar[open.profile_image_url] : undefined} universities={activeUniversities}
          block={blockOf(open)} blockAs={blockAs} onClose={() => setParam({ student: null })} />
      )}
      <StudentsImport open={importing} onClose={() => setImporting(false)} companyId={company.id} today={today} />
      {studentId && !open && alone.data && alone.data.rows.length === 0 && (
        <MissingStudent onClose={() => setParam({ student: null }, true)} />
      )}
    </Page>
  );
};

/** A link to a student who is not (or no longer) in the company. */
const MissingStudent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  React.useEffect(() => {
    void import('../lib/toasts').then(({ notifyError }) => notifyError('هذا الطالب ليس في قائمة شركتك', 'ربما أُزيل من الشركة أو حُذف حسابه.'));
    onClose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
