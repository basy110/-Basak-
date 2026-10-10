import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { TONE, type Tone } from './Status';
import { Button } from './Button';
import { dismiss, useToasts } from '../lib/toasts';
import { errorText } from './format';

/** An inline message inside a page or a form. */
export const Note: React.FC<{ tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; icon?: IconName; className?: string }> = ({ tone = 'teal', title, children, action, icon, className = '' }) => (
  <div role={tone === 'danger' ? 'alert' : 'note'} className={`flex items-start gap-3 rounded-inner px-4 py-3 text-ink ${TONE[tone].split(' ')[0]} ${className}`}>
    <span className={`flex pt-0.5 ${TONE[tone].split(' ')[1]}`}><Icon name={icon ?? (tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info')} size={18} stroke={2} /></span>
    <div className="min-w-0 flex-1">{title && <div className="text-small font-semibold">{title}</div>}{children && <div className="text-label text-ink-2">{children}</div>}</div>
    {action}
  </div>
);

const StateBox: React.FC<{ icon: IconName; tone: Tone; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; card?: boolean }> = ({ icon, tone, title, text, action, card }) => (
  <div className={`flex flex-col items-center gap-1 px-4 py-8 text-center sm:px-6 sm:py-12 ${card ? 'rounded-card bg-surface shadow-card' : ''}`}>
    <span aria-hidden="true" className={`mb-2 flex h-14 w-14 items-center justify-center rounded-full ${TONE[tone]}`}><Icon name={icon} size={26} /></span>
    <div className="text-card">{title}</div>
    {text && <div className="max-w-[420px] text-small text-ink-2">{text}</div>}
    {action && <div className="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{action}</div>}
  </div>
);
/** One sentence saying what will appear here, and the button that fills it. */
export const EmptyState: React.FC<{ icon?: IconName; title: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; card?: boolean }> = ({ icon = 'info', ...rest }) => <StateBox icon={icon} tone="teal" {...rest} />;
/** Plain Arabic, never the server's text; always a retry. */
export const ErrorState: React.FC<{ title?: string; error?: unknown; text?: string; onRetry?: () => void; card?: boolean }> = ({ title = 'تعذّر تحميل الصفحة', error, text, onRetry, card }) => (
  <StateBox icon="alert" tone="danger" title={title} card={card}
    text={text ?? (error ? errorText(error) : 'حدث خطأ من جهتنا. حاول مرة أخرى، وإن تكرر فتواصل مع الدعم.')}
    action={onRetry && <Button kind="secondary" icon="refresh" onClick={onRetry} full>إعادة المحاولة</Button>} />
);

/* ── Skeletons: the shape of what is loading ─────────────────────────── */
const Sk: React.FC<{ w: number | string; h: number; r?: number; className?: string }> = ({ w, h, r = 6, className = '' }) => (
  <span aria-hidden="true" className={`skeleton block flex-none ${className}`} style={{ width: typeof w === 'number' ? `${w}px` : w, height: h, borderRadius: r }} />
);
export const SkeletonStat: React.FC = () => (
  <div aria-busy="true" className="flex flex-col gap-3 rounded-card bg-surface px-5 py-[18px] shadow-card"><Sk w={96} h={12} /><Sk w={72} h={28} r={8} /><Sk w={140} h={10} /></div>
);
export const SkeletonList: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div aria-busy="true" className="overflow-hidden rounded-card bg-surface shadow-card">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className={`flex h-[68px] items-center gap-3 px-5 ${i ? 'border-t border-hair' : ''}`}>
        <Sk w={40} h={40} r={10} />
        <div className="flex flex-1 flex-col gap-2"><Sk w={`${[46, 38, 52, 34, 44][i % 5]}%`} h={12} /><Sk w={`${[30, 24, 36, 22, 28][i % 5]}%`} h={10} /></div>
        <Sk w={96} h={32} r={10} className="hidden sm:block" />
      </div>
    ))}
  </div>
);
export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 6, cols = 5 }) => (
  <>
    <div aria-busy="true" className="hidden overflow-hidden rounded-card bg-surface shadow-card sm:block">
      <div className="flex h-[60px] items-center gap-3 border-b border-hair px-4"><Sk w={280} h={36} r={10} /><Sk w={72} h={28} r={14} /><Sk w={88} h={28} r={14} /><span className="flex-1" /><Sk w={80} h={12} /></div>
      <div className="h-11 bg-ground" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid h-14 items-center gap-6 border-t border-hair px-4" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>
          {Array.from({ length: cols }, (_, c) => <Sk key={c} w={`${[70, 50, 60, 40, 55, 45][(i + c) % 6]}%`} h={12} />)}
        </div>
      ))}
    </div>
    <div className="sm:hidden"><SkeletonCards rows={Math.min(rows, 4)} /></div>
  </>
);
export const SkeletonCards: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div aria-busy="true" className="flex flex-col gap-3">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex flex-col gap-3 rounded-inner bg-surface px-4 py-3.5 shadow-card">
        <div className="flex justify-between"><Sk w={`${[52, 44, 60][i % 3]}%`} h={14} /><Sk w={64} h={22} r={11} /></div><Sk w="80%" h={10} /><Sk w="56%" h={10} />
      </div>
    ))}
  </div>
);
export const SkeletonForm: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div aria-busy="true" className="grid grid-cols-1 gap-4 rounded-card bg-surface p-6 shadow-card lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-8">
    <div className="flex flex-col gap-2.5"><Sk w={120} h={14} /><Sk w="80%" h={10} /></div>
    <div className="flex flex-col gap-4">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex flex-col gap-2"><Sk w={80} h={10} /><Sk w="100%" h={44} r={10} /></div>)}</div>
  </div>
);
export const SkeletonText: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div aria-busy="true" className="flex flex-col gap-2.5">{Array.from({ length: rows }, (_, i) => <Sk key={i} w={`${[90, 76, 84, 52, 68][i % 5]}%`} h={12} />)}</div>
);
export const SkeletonBar: React.FC<{ w?: number; h?: number }> = ({ w = 120, h = 12 }) => <Sk w={w} h={h} />;

/* ── Connection ──────────────────────────────────────────────────────── */
const subscribeOnline = (cb: () => void) => { window.addEventListener('online', cb); window.addEventListener('offline', cb); return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); }; };
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** Under the top bar, on every page, while there is no connection. */
export const OfflineBar: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex min-h-11 flex-none items-center gap-2.5 bg-warn-bg px-4 py-2 text-label font-medium text-warn sm:px-8">
      <Icon name="wifiOff" size={18} stroke={2} />
      <span className="min-w-0 flex-1"><span className="sm:hidden">لا يوجد اتصال بالإنترنت. لن يُحفظ أي تغيير حتى يعود.</span><span className="hidden sm:inline">لا يوجد اتصال بالإنترنت. ما تراه هو آخر ما حُمّل، ولن يُحفظ أي تغيير حتى يعود الاتصال.</span></span>
      {onRetry && <button type="button" onClick={onRetry} className="hidden h-8 items-center gap-1.5 rounded-control px-2.5 text-label font-semibold text-warn shadow-[inset_0_0_0_1px_#8A5300] sm:inline-flex"><Icon name="refresh" size={14} stroke={2} /><span>حاول الآن</span></button>}
    </div>
  );
};

/* ── Toasts: ink, bottom start corner on desktop, full width at the bottom on a phone ── */
export const Toaster: React.FC = () => {
  const toasts = useToasts();
  const navigate = useNavigate();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[88px] z-[70] flex flex-col gap-2 sm:inset-x-auto sm:start-6 sm:bottom-6 sm:w-[400px]" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="enter pointer-events-auto flex min-h-14 items-center gap-3 rounded-inner bg-ink px-4 py-2 pe-2 text-white shadow-floating sm:min-h-[52px]">
          <span className={`flex ${t.tone === 'success' ? 'text-[#5BD4A0]' : t.tone === 'error' ? 'text-[#FF9C94]' : 'text-[#A8D8F0]'}`}>
            <Icon name={t.tone === 'success' ? 'check' : t.tone === 'error' ? 'alert' : 'info'} size={18} stroke={2.25} />
          </span>
          <button type="button" className="min-w-0 flex-1 py-1 text-start" disabled={!t.to} onClick={() => { if (t.to) { navigate(t.to); dismiss(t.id); } }}>
            <span className="block text-small">{t.title}</span>
            {t.body && <span className="block text-label text-[#C9D8E1]">{t.body}</span>}
          </button>
          {t.action ? (
            <button type="button" onClick={t.action.run} className="inline-flex h-11 flex-none items-center gap-1.5 rounded-control bg-white/15 px-3 text-label font-semibold sm:h-9">
              {t.action.label === 'تراجع' && <Icon name="undo" size={14} stroke={2} />}<span>{t.action.label}</span>
            </button>
          ) : t.to ? (
            <button type="button" onClick={() => { navigate(t.to!); dismiss(t.id); }} className="inline-flex h-11 flex-none items-center rounded-control bg-white/15 px-3 text-label font-semibold sm:h-9">عرض الآن</button>
          ) : (
            <button type="button" aria-label="إغلاق" onClick={() => dismiss(t.id)} className="flex h-9 w-9 flex-none items-center justify-center text-[#C9D8E1]"><Icon name="x" size={16} /></button>
          )}
        </div>
      ))}
    </div>
  );
};

/** A countdown in seconds that re-renders once a second while above zero. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
