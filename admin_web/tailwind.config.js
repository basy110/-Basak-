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
      },
      fontFamily: {
        // The dashboard's own pair, as before the redesign: Inter for Latin letters and digits, Cairo for Arabic.
        sans: ['Inter', 'Cairo', '"Segoe UI"', 'Tahoma', 'sans-serif'],
      },
      fontSize: {
        page: ['28px', { lineHeight: '36px', fontWeight: '600' }],
        'page-phone': ['22px', { lineHeight: '30px', fontWeight: '600' }],
        section: ['18px', { lineHeight: '26px', fontWeight: '600' }],
        card: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['15px', { lineHeight: '24px' }],
        small: ['14px', { lineHeight: '22px' }],
        label: ['13px', { lineHeight: '20px' }],
        cap: ['12px', { lineHeight: '18px' }],
        num: ['32px', { lineHeight: '40px', fontWeight: '600' }],
        'num-phone': ['26px', { lineHeight: '34px', fontWeight: '600' }],
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
