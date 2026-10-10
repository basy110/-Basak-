import React, { useEffect, useRef, useState } from 'react';
import { ZoomOut } from 'lucide-react';
import { Button, Icon } from '../../ui';
import { RECEIPTS_BUCKET, type PendingReceiptRow } from '../../lib/pendingReceipts';
import { resignPath } from '../../lib/signedUrls';

export type ImageState = 'loading' | 'shown' | 'broken';
const ZOOMS = [1, 1.5, 2, 3];

/**
 * The transfer picture, as large as the space allows, with zoom, turn and «الصورة
 * الأصلية». The link is the one the list's thumbnail already used (one signing, one
 * download). A link that fails is signed again once by itself; if that fails too the
 * box says so, and the page holds back accept and reject until the picture shows.
 */
export const ReceiptImage: React.FC<{
  row: PendingReceiptRow; url: string | null; onState: (state: ImageState) => void;
  /** Bumped by the page's «Z» shortcut. */ zoomSignal?: number; className?: string; phone?: boolean;
}> = ({ row, url, onState, zoomSignal = 0, className = '', phone }) => {
  const [src, setSrc] = useState<string | null>(url);
  const [state, setState] = useState<ImageState>(url ? 'loading' : row.imagePath ? 'loading' : 'broken');
  const [retried, setRetried] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [turn, setTurn] = useState(0);
  const report = useRef(onState);
  report.current = onState;

  // Another receipt: start again from its own link.
  useEffect(() => {
    setSrc(url); setRetried(false); setZoom(0); setTurn(0);
    setState(url || row.imagePath ? 'loading' : 'broken');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  // The list's signing answered after the receipt was opened.
  useEffect(() => { if (url && !src) setSrc(url); }, [url, src]);
  useEffect(() => { report.current(state); }, [state]);
  useEffect(() => { if (zoomSignal) setZoom((z) => (z + 1) % ZOOMS.length); }, [zoomSignal]);

  const resign = async () => {
    if (!row.imagePath) { setState('broken'); return; }
    setState('loading');
    try {
      const fresh = await resignPath(RECEIPTS_BUCKET, row.imagePath);
      if (fresh) { setSrc(`${fresh}${fresh === src ? (fresh.includes('?') ? '&' : '?') + 'r=' + Date.now() : ''}`); } else setState('broken');
    } catch { setState('broken'); }
  };
  // No link and a path: ask for this one now.
  useEffect(() => {
    if (!src && row.imagePath && !url) { const t = window.setTimeout(() => { if (!src) void resign(); }, 2500); return () => window.clearTimeout(t); }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, row.id]);

  const onError = () => {
    if (!retried) { setRetried(true); void resign(); } else setState('broken');
  };

  const scale = ZOOMS[zoom];
  const tool = 'inline-flex h-10 w-10 items-center justify-center rounded-control text-white hover:bg-white/15 disabled:text-white/40';
  return (
    <div className={`relative flex min-h-0 flex-col overflow-hidden bg-[#D5E0E7] ${phone ? '' : 'rounded-inner'} ${className}`}>
      {state === 'broken' ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
          <span aria-hidden="true" className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-bad-bg text-bad"><Icon name="image" size={26} /></span>
          <div className="text-section text-ink">تعذّر عرض صورة الإيصال</div>
          <p className="m-0 max-w-[260px] text-small text-ink-2">قد يكون الاتصال ضعيفاً أو الصورة لم تُحفظ. لا تقبل ولا ترفض قبل أن تراها.</p>
          <Button kind="secondary" icon="refresh" className="mt-4 !bg-surface/70" onClick={() => { setRetried(true); void resign(); }}>حمّل الصورة مرة أخرى</Button>
        </div>
      ) : (
        <>
          <div className={`relative flex-1 ${scale > 1 ? 'overflow-auto' : 'overflow-hidden'}`}>
            {state === 'loading' && (
              <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-label text-ink-2">
                <span aria-hidden="true" className="skeleton block h-3/4 w-1/2 max-w-[260px] rounded-inner" />
                <span>جارٍ تحميل صورة الإيصال…</span>
              </div>
            )}
            {src && (
              <div className="flex h-full min-h-full w-full items-center justify-center p-4 pb-20" style={scale > 1 ? { width: `${scale * 100}%`, height: `${scale * 100}%` } : undefined}>
                <img key={`${row.id}|${src}`} src={src} alt={`صورة التحويل من ${row.studentName}`} decoding="async" draggable={false}
                  onLoad={() => setState('shown')} onError={onError}
                  onClick={() => setZoom((z) => (z + 1) % ZOOMS.length)}
                  className={`max-h-full max-w-full select-none rounded-[6px] object-contain shadow-card transition-transform ${state === 'shown' ? '' : 'invisible'} ${zoom ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
                  style={{ transform: `rotate(${turn * 90}deg)` }} />
              </div>
            )}
          </div>
          {/* The tools float over the bottom of the picture. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="pointer-events-auto flex items-center gap-0.5 rounded-inner bg-ink px-1.5 py-1 text-white shadow-floating" role="toolbar" aria-label="أدوات الصورة">
              <button type="button" className={tool} aria-label="تكبير" title="تكبير" disabled={state !== 'shown' || zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}><Icon name="zoom" size={20} /></button>
              <button type="button" className={tool} aria-label="تصغير" title="تصغير" disabled={state !== 'shown' || zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}><ZoomOut width={20} height={20} strokeWidth={1.75} aria-hidden="true" /></button>
              <span className="min-w-12 px-1 text-center text-label font-medium tabular" dir="ltr" aria-live="polite">{Math.round(scale * 100)}%</span>
              <button type="button" className={tool} aria-label="تدوير الصورة" title="تدوير الصورة" disabled={state !== 'shown'} onClick={() => setTurn((t) => (t + 1) % 4)}><Icon name="refresh" size={20} /></button>
              <span aria-hidden="true" className="mx-1.5 h-6 w-px bg-white/25" />
              <a href={src ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!src}
                className={`inline-flex h-10 items-center gap-1.5 rounded-control px-2.5 text-small font-semibold hover:bg-white/15 ${src ? 'text-white' : 'pointer-events-none text-white/40'}`}>
                <Icon name="external" size={18} /><span>{phone ? 'الأصل' : 'الصورة الأصلية'}</span>
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
