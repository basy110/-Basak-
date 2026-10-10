/** @type {import('tailwindcss').Config} */
// The mobile app's tokens, exactly (docs/canvas/AdmSystem). Colour means something:
// teal = act, warning = waiting on you, danger = broken or destructive, ok = done.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      // Two breakpoints only: phone web < 640, tablet 640–1023, desktop ≥ 1024.
      sm: '640px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      colors: {
        ink: { DEFAULT: '#17384A', 2: '#476273', 3: '#58707F' },
        teal: { DEFAULT: '#00658D', hover: '#005A7E', pressed: '#004F6E', tint: '#E5F3FA', tint2: '#D6EBF5' },
        ground: '#F0F5F8',
        surface: '#FFFFFF',
        sunken: '#E4ECF1',
        hair: '#DCE6EC',
        disabled: '#9DB0BB',
        ok: { DEFAULT: '#0A6B4A', bg: '#E3F4EC' },
        warn: { DEFAULT: '#8A5300', bg: '#FCF1DC' },
        bad: { DEFAULT: '#B3261E', bg: '#FCEBE9', hover: '#9F2019', pressed: '#8C1B15', quiet: '#F8DBD8' },
        badge: '#C8372D',
        // Accents: one per kind of thing, so the dashboard reads at a glance (navigation groups, number cards).
        violet: { DEFAULT: '#6B4FD3', bg: '#EFEBFC' },
        amber: { DEFAULT: '#B86A00', bg: '#FDF1DE' },
        green: { DEFAULT: '#0F7A55', bg: '#E2F5EC' },
        pink: { DEFAULT: '#C02F72', bg: '#FBE8F1' },
        blue: { DEFAULT: '#1F5FCC', bg: '#E6EEFC' },
        orange: { DEFAULT: '#C4521F', bg: '#FCECE4' },
      },
      fontFamily: {
        // The dashboard's own pair, as before the redesign: Inter for Latin letters and digits, Cairo for Arabic.
        sans: ['Inter', 'Cairo', '"Segoe UI"', 'Tahoma', 'sans-serif'],
      },
      fontSize: {
        // A size up from the boards and heavier, as the dashboard read before the redesign.
        page: ['30px', { lineHeight: '40px', fontWeight: '800' }],
        'page-phone': ['22px', { lineHeight: '32px', fontWeight: '800' }],
        section: ['20px', { lineHeight: '30px', fontWeight: '700' }],
        card: ['17px', { lineHeight: '26px', fontWeight: '700' }],
        body: ['16px', { lineHeight: '26px' }],
        small: ['15px', { lineHeight: '24px' }],
        label: ['14px', { lineHeight: '22px' }],
        cap: ['13px', { lineHeight: '20px' }],
        num: ['34px', { lineHeight: '42px', fontWeight: '800' }],
        'num-phone': ['28px', { lineHeight: '36px', fontWeight: '800' }],
      },
      borderRadius: { control: '10px', inner: '14px', card: '16px', dialog: '20px' },
      boxShadow: {
        card: '0 1px 2px rgba(23,56,74,.05)',
        floating: '0 16px 40px -12px rgba(23,56,74,.28)',
        focus: '0 0 0 2px #FFFFFF, 0 0 0 4px #00658D',
        ring: 'inset 0 0 0 1px #DCE6EC',
        field: 'inset 0 0 0 1px #9DB0BB',
        'field-hover': 'inset 0 0 0 1px #58707F',
        'field-focus': 'inset 0 0 0 2px #00658D, 0 0 0 3px #E5F3FA',
        'field-error': 'inset 0 0 0 2px #B3261E',
      },
    },
  },
  plugins: [],
};
