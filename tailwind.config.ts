import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Backgrounds ─────────────────────────────
        'bg-base':     '#070410',
        'bg-elevated': '#0c0819',
        'bg-surface':  '#120e24',
        'bg-surface2': '#18132e',
        'bg-overlay':  '#201a3a',
        // ── Borders ─────────────────────────────────
        'border':        '#2a2050',
        'border-subtle': '#1c1638',
        'border-focus':  '#8b5cf6',
        // ── Brand ───────────────────────────────────
        'primary':       '#8b5cf6',   // violet-500
        'primary-dim':   '#7c3aed',   // violet-600
        'accent':        '#a855f7',   // purple-500
        // ── Semantic ────────────────────────────────
        'success':  '#34d399',
        'warning':  '#fbbf24',
        'danger':   '#f87171',
        'info':     '#60a5fa',
        // ── Text ────────────────────────────────────
        'text-primary':   '#f5f3ff',
        'text-secondary': '#c4b5fd',
        'text-muted':     '#7c6faa',
      },
      fontFamily: {
        display: ['Syne', 'sans-serif'],
        ui:      ['Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(139,92,246,0.25)',
        'glow-sm':     '0 0 8px rgba(139,92,246,0.15)',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
