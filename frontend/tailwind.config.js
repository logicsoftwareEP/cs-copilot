/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        obs: {
          // Surfaces
          void:      '#0B0D11',
          base:      '#111318',
          raised:    '#1A1D25',
          card:      '#22252E',
          elevated:  '#2A2E38',

          // Borders
          edge:      '#2E3340',
          rule:      '#363B4A',

          // Text
          bright:    '#E4E8EF',
          text:      '#C1C7D2',
          dim:       '#8891A0',
          ghost:     '#5A6170',
          invisible: '#3A3F4E',

          // Accent (luminous purple)
          accent:    '#7C6AFF',
          glow:      '#9585FF',
          fade:      '#7C6AFF1A',
          ring:      '#7C6AFF33',

          // Secondary accent (warm amber)
          amber:     '#FBBF24',
          'amber-dim': '#FBBF2433',
        },
        // Health tier colours — vivid against dark
        tier: {
          healthy:   '#34D399',
          'healthy-bg': '#34D39915',
          watch:     '#FBBF24',
          'watch-bg': '#FBBF2415',
          risk:      '#FB923C',
          'risk-bg': '#FB923C15',
          critical:  '#F87171',
          'critical-bg': '#F8717115',
          unmapped:  '#5A6170',
          'unmapped-bg': '#5A617015',
        },
      },
      boxShadow: {
        'glow-sm': '0 0 12px -3px rgba(124, 106, 255, 0.25)',
        'glow':    '0 0 24px -4px rgba(124, 106, 255, 0.3)',
        'card':    '0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)',
        'panel':   '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(46, 51, 64, 0.5)',
      },
      animation: {
        'slide-in': 'slideIn 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        slideIn: {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        fadeUp: {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to:   { transform: 'translateY(0)',   opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};
