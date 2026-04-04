import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        aoe: {
          // Gold — le seul accent chaud, doit frapper fort
          gold:        '#d4a017',
          'gold-bright':'#f5c842',
          'gold-dark': '#8b6410',
          'gold-dim':  '#3d2e08',
          'gold-glow': 'rgba(212,160,23,0.25)',

          // Backgrounds — near-black with deep indigo tint
          bg:          '#07060f',
          'bg-card':   '#0d0b1a',
          'bg-elevated':'#141226',
          'bg-hover':  '#1a1830',

          // Borders
          border:      '#1e1a30',
          'border-mid':'#2d2850',
          'border-gold':'#5a4010',

          // Text
          parchment:       '#e8e2f5',
          'parchment-dim': '#9890b8',
          'parchment-muted':'#4a4468',

          // Accents
          crimson:       '#c0392b',
          'crimson-bright':'#e74c3c',
          'crimson-dim': '#5a1a14',
          emerald:       '#1a7a4a',
          'emerald-bright':'#27ae60',
          blue:          '#2980b9',
          'blue-bright': '#3498db',
          purple:        '#8e44ad',
          'purple-bright':'#9b59b6',

          // Stone
          stone:       '#12101e',
          'stone-light':'#1e1c30',
        },
      },
      fontFamily: {
        cinzel: ['var(--font-cinzel)', 'Georgia', 'serif'],
        sans:   ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 6px rgba(212,160,23,0.3)' },
          '50%':      { boxShadow: '0 0 24px rgba(212,160,23,0.7), 0 0 48px rgba(212,160,23,0.2)' },
        },
        'pulse-live': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.3' },
        },
        ticker: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
        'border-glow': {
          '0%, 100%': { borderColor: 'rgba(212,160,23,0.3)' },
          '50%':      { borderColor: 'rgba(212,160,23,0.8)' },
        },
        meteor: {
          '0%':   { transform: 'rotate(215deg) translateX(0)', opacity: '1' },
          '70%':  { opacity: '1' },
          '100%': { transform: 'rotate(215deg) translateX(-600px)', opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
        shimmer:          'shimmer 2s linear infinite',
        'pulse-gold':     'pulse-gold 2.5s ease-in-out infinite',
        'pulse-live':     'pulse-live 1.2s ease-in-out infinite',
        ticker:           'ticker 40s linear infinite',
        fadeIn:           'fadeIn 0.25s ease-out',
        float:            'float 4s ease-in-out infinite',
        'spin-slow':      'spin-slow 8s linear infinite',
        'border-glow':    'border-glow 2s ease-in-out infinite',
        meteor:           'meteor 5s linear infinite',
      },
      backgroundImage: {
        'gold-gradient':  'linear-gradient(135deg, #8b6410 0%, #d4a017 40%, #f5c842 60%, #d4a017 80%, #8b6410 100%)',
        'hero-gradient':  'linear-gradient(180deg, #07060f 0%, #0d0b1a 50%, #07060f 100%)',
        'card-gradient':  'linear-gradient(145deg, #0d0b1a 0%, #100e20 100%)',
      },
      boxShadow: {
        'gold-sm':  '0 0 12px rgba(212,160,23,0.2)',
        'gold-md':  '0 0 24px rgba(212,160,23,0.35)',
        'gold-lg':  '0 0 40px rgba(212,160,23,0.45)',
        'live':     '0 0 20px rgba(192,57,43,0.35)',
        'card':     '0 4px 24px rgba(0,0,0,0.6)',
        'elevated': '0 8px 32px rgba(0,0,0,0.8)',
      },
    },
  },
  plugins: [],
};

export default config;
