import React from 'react';
import { Icon } from '../../ui';

const Frame: React.FC<{ children: React.ReactNode; dim?: boolean }> = ({ children, dim }) => (
  <div aria-hidden="true" className="mx-auto flex h-[390px] w-[188px] flex-none flex-col overflow-hidden rounded-[26px] border-[5px] border-ink bg-ground">
    {dim && <div className="h-[72px] flex-none bg-[#8FA2AD]" />}
    <div className={`flex flex-1 flex-col gap-2 p-3 ${dim ? 'rounded-t-[14px] bg-surface' : ''}`}>{children}</div>
  </div>
);
const Lines: React.FC<{ lines: string[] }> = ({ lines }) => (
  <ul className="m-0 flex list-none flex-col gap-1 p-0">
    {lines.map((l, i) => <li key={i} className="flex items-start gap-1.5 text-[10px] leading-[14px] text-ink-2"><Icon name="check" size={11} stroke={2.5} className="mt-0.5 text-ok" /><span>{l}</span></li>)}
  </ul>
);
const Btn: React.FC<{ children: string }> = ({ children }) => <span className="flex h-8 items-center justify-center rounded-[8px] bg-teal text-[11px] font-semibold text-white">{children}</span>;

/**
 * What the app shows a student with an older version (AdmPlatVersions · «كما يراه المستخدم»):
 * «تحديث جديد متاح» (can wait) and «حدّث التطبيق للمتابعة» (cannot), drawn from what is typed.
 */
export const AppPreview: React.FC<{ latest: string; lines: string[] }> = ({ latest, lines }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <figure className="m-0 flex flex-col items-center gap-2">
      <Frame dim>
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-teal-tint text-teal"><Icon name="refresh" size={16} /></span>
        <span className="text-[13px] font-semibold">تحديث جديد متاح</span>
        <span className="-mt-1.5 text-[10px] text-ink-3">الإصدار <span dir="ltr">{latest}</span></span>
        <Lines lines={lines} />
        <span className="flex-1" />
        <Btn>تحديث الآن</Btn>
        <span className="text-center text-[11px] font-medium">لاحقاً</span>
      </Frame>
      <figcaption className="text-center text-label text-ink-2">من عنده أقدم من آخر إصدار · مرة واحدة، ويستطيع التأجيل</figcaption>
    </figure>
    <figure className="m-0 flex flex-col items-center gap-2">
      <Frame>
        <span className="mx-auto mt-2 flex h-11 w-11 items-center justify-center rounded-[12px] bg-ink text-white"><Icon name="bus" size={20} /></span>
        <span className="text-center text-[13px] font-semibold">حدّث التطبيق للمتابعة</span>
        <span className="text-center text-[10px] leading-[14px] text-ink-2">هذا الإصدار لم يعد يعمل. حدّث لتؤكد ركوبك وتدير اشتراكك.</span>
        {lines.length > 0 && <div className="rounded-[8px] bg-surface p-2"><Lines lines={lines} /></div>}
        <span className="flex-1" />
        <Btn>تحديث الآن</Btn>
        <span className="text-center text-[11px] font-medium">افتح بطاقتي</span>
      </Frame>
      <figcaption className="text-center text-label text-ink-2">من عنده أقدم من أقل إصدار مسموح · لا يستطيع المتابعة</figcaption>
    </figure>
  </div>
);
