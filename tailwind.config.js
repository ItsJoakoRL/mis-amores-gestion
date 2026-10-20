// Los colores no son valores fijos: apuntan a variables (src/temas.css) que cambian con el
// modo claro / oscuro. Así las pantallas siguen usando bg-slate-50, text-brand-700, etc. y
// el tema oscuro se aplica solo. Con `<alpha-value>` siguen andando cosas como bg-brand-200/25.
const TONOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const familia = (nombre) =>
  Object.fromEntries(TONOS.map((t) => [t, `rgb(var(--c-${nombre}-${t}) / <alpha-value>)`]));
const FAMILIAS = ['slate', 'brand', 'red', 'amber', 'emerald', 'violet', 'sky', 'teal', 'cyan', 'pink', 'rose', 'orange'];

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        ...Object.fromEntries(FAMILIAS.map((f) => [f, familia(f)])),
        // Fondo de la página y de las tarjetas / cuadros (en el oscuro no es blanco).
        page: 'rgb(var(--c-page) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
      },
      boxShadow: {
        // Sombras suaves con un toque de color de la marca: las tarjetas "flotan" sin verse pesadas.
        card: '0 1px 2px rgb(var(--c-sombra) / 0.05), 0 4px 14px -4px rgb(var(--c-brillo) / 0.10)',
        'card-hover': '0 2px 4px rgb(var(--c-sombra) / 0.06), 0 10px 26px -6px rgb(var(--c-brillo) / 0.20)',
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
        // Habla en silencio: la boca se abre y se cierra a distintos ritmos, como diciendo una frase.
        habla: {
          '0%, 100%': { height: 'var(--boca-h)', borderRadius: '0 0 999px 999px', backgroundColor: 'transparent' },
          '10%': { height: 'calc(var(--boca-abierta) * 1)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '22%': { height: 'calc(var(--boca-abierta) * 0.5)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '34%': { height: 'calc(var(--boca-abierta) * 1)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '44%': { height: 'var(--boca-h)', borderRadius: '0 0 999px 999px', backgroundColor: 'transparent' },
          '55%': { height: 'calc(var(--boca-abierta) * 0.8)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '66%': { height: 'calc(var(--boca-abierta) * 0.4)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '78%': { height: 'calc(var(--boca-abierta) * 1)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '88%': { height: 'calc(var(--boca-abierta) * 0.5)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
        },
        cabeceo: {
          from: { transform: 'rotate(-3deg) translateY(0)' },
          to: { transform: 'rotate(3deg) translateY(-1px)' },
        },
        // Lo mismo, pero sólo un ratito cada tanto (el resto del tiempo sonríe quieta).
        murmura: {
          '0%, 66%, 100%': { height: 'var(--boca-h)', borderRadius: '0 0 999px 999px', backgroundColor: 'transparent' },
          '69%': { height: 'calc(var(--boca-abierta) * 1)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '73%': { height: 'calc(var(--boca-abierta) * 0.5)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '77%': { height: 'calc(var(--boca-abierta) * 1)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '81%': { height: 'calc(var(--boca-abierta) * 0.4)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '85%': { height: 'calc(var(--boca-abierta) * 0.8)', borderRadius: '0 0 999px 999px', backgroundColor: 'rgb(var(--c-brand-600))' },
          '89%': { height: 'var(--boca-h)', borderRadius: '0 0 999px 999px', backgroundColor: 'transparent' },
        },
        murmuraCabeza: {
          '0%, 66%, 91%, 100%': { transform: 'rotate(0deg)' },
          '70%': { transform: 'rotate(-3deg)' },
          '78%': { transform: 'rotate(3deg)' },
          '86%': { transform: 'rotate(-2deg)' },
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
        habla: 'habla 1.05s ease-in-out infinite',
        cabeceo: 'cabeceo 0.55s ease-in-out infinite alternate',
        murmura: 'murmura 11s ease-in-out infinite',
        'cabeza-murmura': 'murmuraCabeza 11s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
