/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    'bg-card-red', 'bg-card-blue', 'bg-card-green', 'bg-card-yellow', 'bg-card-wild',
    'ring-card-red', 'ring-card-blue', 'ring-card-green', 'ring-card-yellow',
  ],
  theme: {
    extend: {
      colors: {
        card: {
          red: '#e53e3e',
          blue: '#3182ce',
          green: '#38a169',
          yellow: '#d69e2e',
          wild: '#553c9a',
        },
      },
      animation: {
        'card-play': 'cardPlay 0.3s ease-out',
        'card-draw': 'cardDraw 0.3s ease-out',
        'uno-flash': 'unoFlash 0.5s ease-in-out',
      },
      keyframes: {
        cardPlay: {
          '0%': { transform: 'translateY(0) scale(1.1)' },
          '100%': { transform: 'translateY(-60px) scale(1)' },
        },
        cardDraw: {
          '0%': { transform: 'translateX(-20px) opacity(0)' },
          '100%': { transform: 'translateX(0) opacity(1)' },
        },
        unoFlash: {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: '#ffd700' },
        },
      },
    },
  },
  plugins: [],
};
