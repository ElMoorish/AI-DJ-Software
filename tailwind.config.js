/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        bg: {
          base: '#080810',
          surface: '#0f0f1a',
          'surface-2': '#13131f',
          'surface-3': '#1a1a2e',
        },
        accent: {
          DEFAULT: '#7c6dff',
          hover: '#9b8eff',
          secondary: '#00d4ff',
          dim: 'rgba(124, 109, 255, 0.15)',
        },
        'deck-b': {
          DEFAULT: '#00d4ff',
          dim: 'rgba(0, 212, 255, 0.12)',
        },
        wave: {
          bass: '#ff4b6e',
          mid: '#00e5a0',
          high: '#4b9fff',
        },
        success: '#00e676',
        warning: '#ffd740',
        danger: '#ff4f6a',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(135deg, #7c6dff 0%, #5f52e8 100%)',
        'gradient-deck': 'linear-gradient(135deg, #7c6dff 0%, #00d4ff 100%)',
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(124, 109, 255, 0.4)',
        'glow-b': '0 0 20px rgba(0, 212, 255, 0.35)',
        'glow-sm': '0 0 8px rgba(124, 109, 255, 0.25)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
