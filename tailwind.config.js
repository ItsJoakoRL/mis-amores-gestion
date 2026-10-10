/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f7fd',
          100: '#e1ecfa',
          200: '#c3d9f5',
          300: '#95bced',
          400: '#5f97e1',
          500: '#3b76d1',
          600: '#2a5cb3',
          700: '#254a8f',
          800: '#233f75',
          900: '#213762',
        },
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.96) translateY(8px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0) translateX(0)' },
          '50%': { transform: 'translateY(-14px) translateX(8px)' },
        },
        wave: {
          '0%, 60%, 100%': { transform: 'rotate(0deg)' },
          '10%, 30%': { transform: 'rotate(14deg)' },
          '20%': { transform: 'rotate(-8deg)' },
          '40%': { transform: 'rotate(10deg)' },
          '50%': { transform: 'rotate(0deg)' },
        },
        blink: {
          '0%, 90%, 100%': { transform: 'scaleY(1)' },
          '95%': { transform: 'scaleY(0.1)' },
        },
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        bounceDot: {
          '0%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-3px)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'scale-in': 'scaleIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        'float-slow': 'floatSlow 9s ease-in-out infinite',
        wave: 'wave 1.8s ease-in-out 1',
        blink: 'blink 4.5s ease-in-out infinite',
        bob: 'bob 2.4s ease-in-out infinite',
        'bounce-dot': 'bounceDot 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
