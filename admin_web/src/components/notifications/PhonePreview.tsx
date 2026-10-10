import React from 'react';
import { Icon } from '../../ui';

/**
 * How the notification reads on a phone's lock screen. A sketch of the wording
 * only: each phone draws its own notifications, and this says nothing about arrival.
 */
export const PhonePreview: React.FC<{ title: string; body: string; high?: boolean; className?: string }> = ({ title, body, high, className = '' }) => (
  <div aria-label="معاينة الإشعار على الهاتف" className={`mx-auto w-full max-w-[312px] rounded-[28px] bg-gradient-to-b from-[#2B4A5C] to-[#17384A] px-3 pb-3 pt-3 ${className}`}>
    <div aria-hidden="true" className="mx-auto h-1 w-14 rounded-full bg-white/25" />
    <div aria-hidden="true" className="mt-2 text-center text-[30px] font-light leading-10 text-white" dir="ltr">9:41</div>
    <div className="mt-2 rounded-[14px] bg-white/95 px-3 py-2.5 text-start">
      <div className="flex items-center gap-1.5 text-cap text-ink-3">
        <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded bg-ink text-white"><Icon name="bus" size={10} /></span>
        <span className="font-semibold text-ink-2">باصك</span>
        {high && <span className="rounded bg-bad-bg px-1.5 text-[10px] font-semibold text-bad">عاجل</span>}
        <span className="ms-auto">الآن</span>
      </div>
      <p className={`m-0 mt-1 break-words text-label font-semibold ${title.trim() ? 'text-ink' : 'text-ink-3'}`}>{title.trim() || 'عنوان الإشعار'}</p>
      <p className={`m-0 line-clamp-4 whitespace-pre-line break-words text-cap ${body.trim() ? 'text-ink-2' : 'text-ink-3'}`}>{body.trim() || 'نص الإشعار يظهر هنا كما يقرؤه الطالب.'}</p>
    </div>
    <p className="m-0 mt-2.5 text-center text-[10px] leading-4 text-white/70">شكل تقريبي، ويختلف من هاتف لآخر</p>
  </div>
);
