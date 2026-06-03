/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'g-green': '#00ff41',
        'g-green-dim': '#00cc33',
        'g-green-dark': '#003a0f',
        'g-bg': '#050505',
        'g-card': '#0d1117',
        'g-card-hover': '#111820',
        'g-sidebar': '#080c08',
        'g-border': '#1a2f1a',
        'g-text': '#c8f5c8',
        'g-muted': '#4a6a4a',
      },
      boxShadow: {
        'green-sm': '0 0 8px rgba(0, 255, 65, 0.12)',
        'green-md': '0 0 16px rgba(0, 255, 65, 0.18)',
        'green-lg': '0 0 32px rgba(0, 255, 65, 0.12)',
        'green-glow': '0 0 20px rgba(0, 255, 65, 0.25), 0 0 40px rgba(0, 255, 65, 0.1)',
        'red-sm': '0 0 8px rgba(255, 0, 51, 0.2)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-green': 'pulseGreen 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1.5s step-end infinite',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
