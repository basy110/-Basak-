import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCompany, useAdminScope } from '../lib/adminScope';
import type { HistoryPage, HistoryRow, StatusFilter } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/query';
import { allPages } from '../lib/excelCells';
import { useNotificationActions, useNotificationHistory } from '../lib/notificationsData';
import { Button, Note, Page, PageHeader, PhoneBar, useOnline } from '../ui';
import { Composer } from '../components/notifications/Composer';
import { History } from '../components/notifications/History';

/**
 * «الإشعارات»: the company's messages to its students — written here, sent by
 * supervisors from the app, or sent by the system — with who received and who
 * read each. «إشعار جديد» is a page of its own (`?view=new`).
 */
export const NotificationsPage: React.FC = () => {
  const companyId = useCompany().id;
  const me = useAdminScope().full_name;
  const online = useOnline();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<StatusFilter>('all');
  // One query feeds the list and tells whether phone alerts are connected.
  const history = useNotificationHistory(companyId, filter);
  const actions = useNotificationActions(companyId);
  const listPath = `/c/${companyId}/notifications`;
  const newPath = `${listPath}?view=new`;

  // «تصدير Excel»: the whole history of the chosen status, 100 at a time (the most the server sends).
  const loadAll = () => allPages<HistoryRow>((before) => unwrap<HistoryPage>(supabase.rpc('get_company_notifications_page', {
    p_company_id: companyId, p_before: before, p_limit: 100, p_status: filter === 'all' ? null : filter,
  })));

  if (params.get('view') === 'new') {
    return <Page><Composer companyId={companyId} backTo={listPath} onBack={() => navigate(listPath)} onDone={() => navigate(listPath)} /></Page>;
  }
  return (
    <Page>
      <PageHeader title="الإشعارات" phoneActions={false}
        sub="رسائلك إلى الطلاب: تصلهم داخل التطبيق وتنبيهاً على الهاتف. يظهر هنا أيضاً ما أرسله المشرفون وما يرسله النظام وحده."
        actions={<Button icon="plus" to={newPath} disabled={!online}>إشعار جديد</Button>} />
      {history.pushConfigured === false && (
        <Note tone="teal" title="التنبيه على الهواتف لم يُفعَّل بعد">إشعاراتك تصل إلى الطلاب داخل التطبيق في صفحة الإشعارات، ولا تظهر تنبيهاً على الهاتف حتى تفعّله إدارة المنصة.</Note>
      )}
      <History companyId={companyId} filter={filter} onFilter={setFilter} history={history} actions={actions} me={me} onNew={() => navigate(newPath)} loadAll={loadAll} />
      <PhoneBar><Button full icon="plus" to={newPath} disabled={!online}>إشعار جديد</Button></PhoneBar>
    </Page>
  );
};
