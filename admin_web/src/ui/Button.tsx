import React from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export type ButtonKind = 'primary' | 'secondary' | 'outline' | 'tonal' | 'danger' | 'dangerQuiet' | 'link';

const KIND: Record<ButtonKind, string> = {
  primary: 'bg-teal text-white font-semibold hover:bg-teal-hover active:bg-teal-pressed',
  secondary: 'bg-sunken text-ink font-medium hover:bg-hair active:bg-[#D2DEE5]',
  outline: 'bg-surface text-ink font-medium shadow-ring hover:bg-ground active:bg-sunken',
  tonal: 'bg-teal-tint text-teal font-semibold hover:bg-teal-tint2 active:bg-[#C6E2F0]',
  danger: 'bg-bad text-white font-semibold hover:bg-bad-hover active:bg-bad-pressed',
  dangerQuiet: 'bg-bad-bg text-bad font-semibold hover:bg-bad-quiet active:bg-[#F3CCC8]',
  link: 'bg-transparent text-teal font-medium hover:underline !px-1',
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  kind?: ButtonKind;
  icon?: IconName;
  iconEnd?: IconName;
  /** 36 high: only inside table rows and toolbars. */
  sm?: boolean;
  /** Full width (phone bottom bars, dialogs on a phone). */
  full?: boolean;
  loading?: boolean;
  /** Renders a router link instead of a button. */
  to?: string;
  children: React.ReactNode;
}

/** 44 high on desktop and tablet, 48 on a phone, 36 with `sm`. A button names what it does. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = 'primary', icon, iconEnd, sm, full, loading, to, className = '', children, disabled, type = 'button', ...rest }, ref,
) {
  const size = sm ? 'h-9 px-3 text-label gap-1.5' : 'h-12 sm:h-11 px-4 text-small gap-2';
  const dis = disabled || loading;
  const cls = `${full ? 'flex w-full' : 'inline-flex'} items-center justify-center whitespace-nowrap rounded-control transition-colors flex-none ${size} ${
    dis && kind !== 'link' ? 'bg-sunken text-disabled font-medium shadow-none cursor-default' : KIND[kind]} ${className}`;
  const inner = (
    <>
      {loading
        ? <span aria-hidden="true" className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-current border-t-transparent" />
        : icon && <Icon name={icon} size={sm ? 16 : 18} />}
      <span>{children}</span>
      {iconEnd && <Icon name={iconEnd} size={sm ? 16 : 18} />}
    </>
  );
  if (to && !dis) return <Link to={to} className={cls}>{inner}</Link>;
  return <button ref={ref} type={type} disabled={dis} aria-busy={loading || undefined} className={cls} {...rest}>{inner}</button>;
});

/** A square icon button with an accessible name. 40 desktop, 48 phone, 36 with `sm`. */
export const IconButton = React.forwardRef<HTMLButtonElement, {
  icon: IconName; label: string; sm?: boolean; dot?: boolean; tone?: 'ink' | 'danger' | 'muted'; size?: number;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>>(function IconButton({ icon, label, sm, dot, tone = 'muted', size, className = '', type = 'button', ...rest }, ref) {
  const color = tone === 'danger' ? 'text-bad' : tone === 'ink' ? 'text-ink' : 'text-ink-2';
  return (
    <button ref={ref} type={type} aria-label={label} title={label}
      className={`relative inline-flex flex-none items-center justify-center rounded-control hover:bg-sunken disabled:text-disabled disabled:hover:bg-transparent ${sm ? 'h-9 w-9' : 'h-12 w-12 sm:h-10 sm:w-10'} ${color} ${className}`} {...rest}>
      <Icon name={icon} size={size ?? 20} />
      {dot && <span className="absolute end-2 top-2 h-[9px] w-[9px] rounded-full bg-badge shadow-[0_0_0_2px_#fff]" />}
    </button>
  );
});
