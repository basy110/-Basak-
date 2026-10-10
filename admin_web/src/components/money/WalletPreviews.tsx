import React from 'react';
import { Icon } from '../../ui';
import { TEXT_DARK, TEXT_LIGHT, textToneFor } from '../../lib/money';

export interface CardLook { title: string; background: string; foreground: string; label: string; logo: string | null; banner: string | null }

/** A stand-in pattern: the real card shows each student's own permanent code. */
const SampleQr: React.FC = () => (
  <svg viewBox="0 0 9 9" className="h-[72px] w-[72px]" shapeRendering="crispEdges" aria-hidden="true">
    <rect width="9" height="9" fill="#fff" />
    {['0,0', '6,0', '0,6'].map((c) => { const [x, y] = c.split(',').map(Number); return <g key={c}><rect x={x} y={y} width="3" height="3" fill="#111" /><rect x={x + 1} y={y + 1} width="1" height="1" fill="#fff" /></g>; })}
    {['4,0', '4,2', '3,4', '5,4', '7,4', '4,6', '6,6', '8,6', '5,7', '7,8', '4,8', '1,4', '8,3'].map((c) => { const [x, y] = c.split(',').map(Number); return <rect key={c} x={x} y={y} width="1" height="1" fill="#111" />; })}
  </svg>
);

const FIELDS: [string, string][] = [['محطة الركوب', 'موقف الحي الثالث'], ['الخط', 'دمياط الجديدة'], ['الجامعة', 'جامعة دمياط'], ['الاشتراك', 'الفصل الأول']];

const Logo: React.FC<{ logo: string | null; round?: boolean; title: string }> = ({ logo, round, title }) => (
  logo ? <img src={logo} alt="" className={`h-7 w-7 flex-none bg-white object-contain p-0.5 ${round ? 'rounded-full' : 'rounded-md'}`} />
    : round ? <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-white text-cap font-semibold text-ink-2">{title.trim().slice(0, 1)}</span> : null
);

/** Apple's ID-style pass: logo and name on top, photo beside the student's name, four small fields, the code. */
export const ApplePreview: React.FC<{ look: CardLook }> = ({ look }) => (
  <div dir="rtl" className="mx-auto flex w-full max-w-[300px] flex-col gap-3 rounded-[18px] p-4 shadow-[0_8px_24px_-12px_rgba(23,56,74,.5)]" style={{ background: look.background }}>
    <div className="flex items-start gap-2">
      <Logo logo={look.logo} title={look.title} />
      <span className="min-w-0 flex-1 truncate pt-1 text-small font-semibold" style={{ color: look.foreground }}>{look.title}</span>
      <span className="flex-none text-start"><span className="block text-[9px] font-semibold" style={{ color: look.label }}>بطاقة</span><span className="block text-cap font-semibold" style={{ color: look.foreground }}>نقل طلاب</span></span>
    </div>
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1"><div className="text-[9px] font-semibold" style={{ color: look.label }}>الطالب</div><div className="text-[19px] font-semibold leading-tight" style={{ color: look.foreground }}>منة الله إبراهيم</div></div>
      <span className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-white/25"><Icon name="user" size={34} className="text-white/80" /></span>
    </div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {FIELDS.map(([k, v]) => <div key={k}><div className="text-[9px] font-semibold" style={{ color: look.label }}>{k}</div><div className="text-cap font-semibold" style={{ color: look.foreground }}>{v}</div></div>)}
    </div>
    <div className="flex justify-center"><span className="rounded-xl bg-white p-2"><SampleQr /></span></div>
  </div>
);

/** Google picks its own writing colour: light on dark cards, dark on light ones. */
export const GooglePreview: React.FC<{ look: CardLook }> = ({ look }) => {
  const text = textToneFor(look.background) === 'light' ? TEXT_LIGHT : TEXT_DARK;
  return (
    <div dir="rtl" className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[24px] shadow-[0_8px_24px_-12px_rgba(23,56,74,.5)]" style={{ background: look.background, color: text }}>
      <div className="flex items-center gap-2 px-4 pt-4"><Logo logo={look.logo} round title={look.title} /><span className="truncate text-cap font-semibold">{look.title}</span></div>
      <div className="px-4 pt-3"><div className="text-[10px] opacity-80">بطاقة نقل طلاب</div><div className="text-[21px] font-semibold leading-tight">منة الله إبراهيم</div></div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3">
        {FIELDS.map(([k, v]) => <div key={k}><div className="text-[9px] opacity-80">{k}</div><div className="text-cap font-semibold">{v}</div></div>)}
      </div>
      <div className="flex justify-center pb-4"><span className="rounded-xl bg-white p-2"><SampleQr /></span></div>
      {look.banner ? <img src={look.banner} alt="" className="h-[84px] w-full object-cover" />
        : <div className="flex h-12 items-center justify-center gap-1.5 bg-white/15 text-cap opacity-90"><Icon name="image" size={14} />الصورة العرضية</div>}
    </div>
  );
};
