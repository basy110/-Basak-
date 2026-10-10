import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog } from '../../ui';

/**
 * While a page holds unsaved changes, a click on any link inside the dashboard
 * asks first («الخروج دون حفظ؟»), and closing or reloading the tab gets the
 * browser's own warning. The app uses a plain BrowserRouter (no route blockers),
 * so links are caught before the router sees them.
 */
export function useLeaveGuard(dirty: boolean) {
  const [pending, setPending] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!dirty) return undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('beforeunload', onUnload); };
  }, [dirty]);
  return {
    pending,
    stay: () => setPending(null),
    leave: () => { const to = pending; setPending(null); if (to) navigate(to); },
    /** Ask before a page's own way out (a «رجوع» button, a tab of the same page). */
    ask: (to: string) => setPending(to),
  };
}

/** «الخروج دون حفظ؟» — what was changed, and that nothing of it stays. */
export const LeaveDialog: React.FC<{ guard: ReturnType<typeof useLeaveGuard>; what: string }> = ({ guard, what }) => (
  <Dialog open={!!guard.pending} onClose={guard.stay} title="الخروج دون حفظ؟" icon="alert" tone="warning"
    actions={[
      <Button key="stay" kind="secondary" onClick={guard.stay}>رجوع إلى الصفحة</Button>,
      <Button key="leave" kind="dangerQuiet" onClick={guard.leave}>الخروج دون حفظ</Button>,
    ]}>
    <p className="m-0">{what} ولم تحفظ. إن خرجت الآن يبقى كل شيء كما كان.</p>
  </Dialog>
);
