import type { Config } from 'tailwindcss';

/**
 * tft.money — sister site to AgeOfMoney, themed around Teamfight Tactics.
 *
 * Palette philosophy : deep arcane indigo base + Riot's TFT-leaning purple,
 * teal/cyan magic accents, and gold for rarity/jackpot moments. Rose CTA
 * keeps the action button distinct from every "live" badge or odds chip.
 *
 * Naming uses the `tft-` prefix so this file can be merged with the
 * AgeOfMoney tailwind without colour collisions later if the two frontends
 * are ever consolidated.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
  ],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        tft: {
          // ── Backgrounds — deep void indigo, just blue enough to feel arcane
          bg:           '#08081a',
          'bg-card':    '#101028',
          'bg-elevated':'#181838',
          'bg-hover':   '#1f1f44',

          // ── Borders
          border:       '#1f1d4a',
          'border-mid': '#2e2b6b',
          'border-glow':'#7c3aed',

          // ── Arcane purple (primary brand)
          purple:        '#7c3aed',
          'purple-bright':'#a78bfa',
          'purple-dark': '#5b21b6',
          'purple-deep': '#4c1d95',
          'purple-glow': 'rgba(124,58,237,0.45)',

          // ── Arcane cyan (secondary accent — magic orbs, hex highlights)
          cyan:          '#22d3ee',
          'cyan-bright': '#67e8f9',
          'cyan-dim':    'rgba(34,211,238,0.18)',
          'cyan-glow':   'rgba(34,211,238,0.5)',

          // ── Gold (rarity highlights, prize pool, balance)
          gold:          '#fbbf24',
          'gold-bright': '#fcd34d',
          'gold-dim':    'rgba(251,191,36,0.18)',
          'gold-glow':   'rgba(251,191,36,0.4)',

          // ── Rose (CTA — bet now / connect)
          rose:          '#f43f5e',
          'rose-bright': '#fb7185',
          'rose-dark':   '#be123c',
          'rose-glow':   'rgba(244,63,94,0.45)',

          // ── Feedback (wins / losses)
          mint:          '#34d399',
          'mint-dim':    'rgba(52,211,153,0.18)',
          'mint-glow':   'rgba(52,211,153,0.5)',
          danger:        '#ef4444',
          'danger-dim':  'rgba(239,68,68,0.18)',

          // ── Text — readable on the void
          text:          '#e2e8f0',
          'text-dim':    '#94a3b8',
          'text-muted':  '#64748b',
          'text-faint':  '#475569',
        },
      },
      fontFamily: {
        // Display — arcane fantasy. Cormorant Garamond gives the "tactician's
        // grimoire" feel without falling into the medieval rut that Cinzel
        // owns over at AgeOfMoney.
        display: ['var(--font-cormorant)', 'Georgia', 'serif'],
        // UI — gaming/esports identity. Chakra Petch is the closest free
        // analogue to Riot's Beaufort family used inside TFT itself.
        ui:      ['var(--font-chakra)', 'system-ui', 'sans-serif'],
        // Body — Inter, neutral and legible for long reads (FAQ, ToS).
        sans:    ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'hex-pulse': {
          '0%, 100%': { opacity: '0.12' },
          '50%':      { opacity: '0.28' },
        },
        'pulse-purple': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(124,58,237,0.35)' },
          '50%':      { boxShadow: '0 0 28px rgba(124,58,237,0.65), 0 0 56px rgba(124,58,237,0.18)' },
        },
        'odds-flash-up': {
          '0%':   { backgroundColor: 'rgba(52,211,153,0)' },
          '25%':  { backgroundColor: 'rgba(52,211,153,0.3)' },
          '100%': { backgroundColor: 'rgba(52,211,153,0)' },
        },
        'odds-flash-down': {
          '0%':   { backgroundColor: 'rgba(239,68,68,0)' },
          '25%':  { backgroundColor: 'rgba(239,68,68,0.3)' },
          '100%': { backgroundColor: 'rgba(239,68,68,0)' },
        },
        'pulse-live': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.35' },
        },
        ticker: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        'border-arcane': {
          '0%, 100%': { borderColor: 'rgba(124,58,237,0.35)' },
          '50%':      { borderColor: 'rgba(34,211,238,0.6)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to:   { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'hex-pulse':      'hex-pulse 6s ease-in-out infinite',
        'pulse-purple':   'pulse-purple 2.6s ease-in-out infinite',
        'odds-flash-up':  'odds-flash-up 0.6s ease-out',
        'odds-flash-down':'odds-flash-down 0.6s ease-out',
        'pulse-live':     'pulse-live 1.4s ease-in-out infinite',
        ticker:           'ticker 40s linear infinite',
        fadeIn:           'fadeIn 0.25s ease-out',
        float:            'float 5s ease-in-out infinite',
        shimmer:          'shimmer 2.4s linear infinite',
        'border-arcane':  'border-arcane 3s ease-in-out infinite',
        'spin-slow':      'spin-slow 12s linear infinite',
      },
      backgroundImage: {
        // Hero gradient — the void deepening into purple toward the centre
        'hero-arcane':   'radial-gradient(ellipse at 50% 40%, #1a1644 0%, #0a0820 45%, #08081a 100%)',
        // Card gradient — subtle elevation
        'card-arcane':   'linear-gradient(145deg, #101028 0%, #161640 100%)',
        // Brand title gradient
        'gradient-arcane':'linear-gradient(135deg, #a78bfa 0%, #67e8f9 50%, #fcd34d 100%)',
        // CTA shimmer
        'gradient-rose': 'linear-gradient(135deg, #f43f5e 0%, #fb7185 50%, #f43f5e 100%)',
      },
      boxShadow: {
        'arcane-sm':  '0 0 14px rgba(124,58,237,0.25)',
        'arcane-md':  '0 0 28px rgba(124,58,237,0.45)',
        'arcane-lg':  '0 0 48px rgba(124,58,237,0.55)',
        'cyan-md':    '0 0 24px rgba(34,211,238,0.4)',
        'gold-md':    '0 0 24px rgba(251,191,36,0.4)',
        'rose-md':    '0 0 24px rgba(244,63,94,0.45)',
        'live':       '0 0 24px rgba(239,68,68,0.35)',
        'card':       '0 6px 28px rgba(0,0,0,0.65)',
        'elevated':   '0 12px 48px rgba(0,0,0,0.85)',
      },
    },
  },
  plugins: [],
};

export default config;
