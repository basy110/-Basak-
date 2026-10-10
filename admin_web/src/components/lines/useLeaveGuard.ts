import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * While `active`, leaving the page asks first (docs/canvas/AdmLineStepDialogs ·
 * «Close before saving»): a link anywhere in the dashboard, the phone top bar's
 * back arrow, the browser's back button, and closing or reloading the tab.
 * `onBlocked(go)` shows the question; `go()` leaves.
 *
 * The app uses <BrowserRouter> (no data router, so no useBlocker): links are
 * caught on their way down, before React Router sees the click, and the back
 * button meets one extra history entry for this same address.
 */
export function useLeaveGuard(active: boolean, backTo: string, onBlocked: (go: () => void) => void) {
  const navigate = useNavigate();
  const ref = useRef({ active, onBlocked, backTo });
  ref.current = { active, onBlocked, backTo };

  useEffect(() => {
    if (!active) return undefined;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [active]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const { active: on, onBlocked: ask } = ref.current;
      if (!on || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      if (!target || target.closest('[role="dialog"],[role="alertdialog"]')) return;
      const link = target.closest('a[href]') as HTMLAnchorElement | null;
      if (link) {
        if (link.target && link.target !== '_self') return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
        e.preventDefault(); e.stopPropagation();
        ask(() => navigate(`${url.pathname}${url.search}${url.hash}`));
        return;
      }
      const back = target.closest('header button[aria-label^="رجوع إلى"]');
      if (back) {
        e.preventDefault(); e.stopPropagation();
        ask(() => navigate(ref.current.backTo));
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  const pushed = useRef(false);
  useEffect(() => {
    if (!active || pushed.current) return;
    pushed.current = true;
    // The same address once more: «back» lands here first, and is asked about.
    window.history.pushState(window.history.state, '', window.location.href);
  }, [active]);
  useEffect(() => {
    const onPop = () => {
      if (!pushed.current || !ref.current.active) return;
      window.history.pushState(window.history.state, '', window.location.href);
      ref.current.onBlocked(() => navigate(ref.current.backTo, { replace: true }));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [navigate]);
}
