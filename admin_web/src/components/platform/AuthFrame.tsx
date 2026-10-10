import React from 'react';
import { Icon, type IconName } from '../../ui/Icon';

/**
 * The frame of the signed-out pages (docs/canvas/AdmSignIn*): the form column on the
 * start side, and from 1024 up the ink panel that says what the dashboard is for.
 * Imports only the small parts of ui/ (the sign-in page has a bundle budget).
 */
const Brand: React.FC<{ light?: boolean }> = ({ light }) => (
  <div className="flex items-center gap-3">
    <span aria-hidden="true" className={`flex h-11 w-11 flex-none items-center justify-center rounded-[12px] ${light ? 'bg-white text-ink' : 'bg-ink text-white'}`}><Icon name="bus" size={20} /></span>
    <span className="flex flex-col">
      <span className={`text-[20px] font-semibold leading-7 ${light ? 'text-white' : 'text-ink'}`}>باصك</span>
      <span className={`text-label ${light ? 'text-[#C9D8E1]' : 'text-ink-2'}`}>لوحة شركات النقل</span>
    </span>
  </div>
);

const POINTS: [IconName, string][] = [
  ['receipt', 'راجع إيصالات الدفع واقبلها في دقيقة'],
  ['users', 'اعرف كم راكباً في كل رحلة غداً'],
  ['megaphone', 'أخبر طلابك بأي تغيير في لحظته'],
];

export const AuthFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div dir="rtl" className="flex min-h-screen bg-surface text-ink">
    <main className="flex min-h-screen w-full flex-col px-4 pb-6 pt-6 sm:px-10 lg:w-[560px] lg:flex-none lg:px-20 lg:pt-10">
      <Brand />
      <div className="flex flex-1 flex-col pt-10 sm:mx-auto sm:w-full sm:max-w-[400px] sm:justify-center sm:pt-0 lg:mx-0">{children}</div>
      <p className="m-0 hidden text-label text-ink-2 sm:block">© باصك {new Date().getFullYear()}</p>
    </main>
    <aside aria-hidden="true" className="hidden min-h-screen flex-1 flex-col bg-ink px-16 py-14 text-white lg:flex">
      <Brand light />
      <div className="flex flex-1 flex-col justify-center gap-8">
        <h2 className="m-0 max-w-[440px] text-[34px] font-semibold leading-[48px]">كل ما يخص باصات شركتك وطلابها، في مكان واحد.</h2>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {POINTS.map(([icon, text]) => (
            <li key={text} className="flex items-center gap-4 text-body">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-white/10"><Icon name={icon} size={18} /></span>{text}
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 text-label text-[#C9D8E1]">تعمل من الهاتف والكمبيوتر، من المتصفح مباشرة.</p>
    </aside>
  </div>
);

/** A message above the fields (never the server's own text). */
export const AuthNote: React.FC<{ tone: 'danger' | 'warning' | 'success'; title: string; children: React.ReactNode }> = ({ tone, title, children }) => (
  <div role={tone === 'success' ? 'status' : 'alert'} className={`flex items-start gap-3 rounded-inner px-4 py-3 ${tone === 'danger' ? 'bg-bad-bg' : tone === 'warning' ? 'bg-warn-bg' : 'bg-ok-bg'}`}>
    <span className={`flex pt-0.5 ${tone === 'danger' ? 'text-bad' : tone === 'warning' ? 'text-warn' : 'text-ok'}`}><Icon name={tone === 'success' ? 'check' : 'alert'} size={18} stroke={2} /></span>
    <div className="flex min-w-0 flex-col"><span className="text-small font-semibold">{title}</span><span className="text-label text-ink-2">{children}</span></div>
  </div>
);

export const AuthHead: React.FC<{ title: string; sub: string }> = ({ title, sub }) => (
  <div className="flex flex-col gap-1">
    <h1 className="m-0 text-page-phone sm:text-page">{title}</h1>
    <p className="m-0 text-small text-ink-2">{sub}</p>
  </div>
);
