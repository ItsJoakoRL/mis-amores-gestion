// Genera src/temas.css (variables de color del tema claro y del oscuro) a partir de las paletas de Tailwind.
// Regla: los tonos claros (50-300) son "fondos tenues" y se vuelven oscuros en el tema oscuro; los tonos
// 400-600 (rellenos, íconos) quedan igual; los tonos 700-900 son "texto" y se vuelven claros.
const path = require('path');
const RAIZ = process.argv[2] || path.join(__dirname, '..');
const fs = require('fs');
const colors = require(path.join(RAIZ, 'node_modules/tailwindcss/colors'));

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const canales = (rgb) => rgb.join(' ');

const SUPERFICIE_OSCURA = [20, 27, 43]; // tarjetas
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

// En el modo claro los grises de texto (400-600) son un poco más oscuros que los de Tailwind: así los
// textos chicos (aclaraciones, encabezados de tablas) se leen bien aunque haya sol en la pantalla.
const SLATE_CLARO = { 400: '#5f6e84', 500: '#4e5d73', 600: '#3d4b5f' };

// slate: se invierte entero (es el gris de textos, bordes y fondos).
const SLATE_OSCURO = {
  50: '#1a2234', 100: '#222c42', 200: '#2e3a52', 300: '#3d4b66', 400: '#7f8da8',
  500: '#9aa7bf', 600: '#b4bfd3', 700: '#cdd5e3', 800: '#e3e8f1', 900: '#f1f4f9',
};

const FAMILIAS = {
  brand: colors.indigo,
  red: colors.red,
  amber: colors.amber,
  emerald: colors.emerald,
  violet: colors.violet,
  sky: colors.sky,
  teal: colors.teal,
  cyan: colors.cyan,
  pink: colors.pink,
  rose: colors.rose,
  orange: colors.orange,
};

let claro = '';
let oscuro = '';

for (const s of SHADES) {
  claro += `  --c-slate-${s}: ${canales(hex(SLATE_CLARO[s] ?? colors.slate[s]))};\n`;
  oscuro += `  --c-slate-${s}: ${canales(hex(SLATE_OSCURO[s]))};\n`;
}

for (const [nombre, escala] of Object.entries(FAMILIAS)) {
  const base = hex(escala[500]);
  const tintes = { 50: 0.13, 100: 0.2, 200: 0.3, 300: 0.42 };
  for (const s of SHADES) {
    claro += `  --c-${nombre}-${s}: ${canales(hex(escala[s]))};\n`;
    let o;
    if (tintes[s] !== undefined) o = mix(SUPERFICIE_OSCURA, base, tintes[s]);
    else if (s === 700) o = hex(escala[300]);
    else if (s === 800) o = hex(escala[200]);
    else if (s === 900) o = hex(escala[100]);
    else o = hex(escala[s]);
    oscuro += `  --c-${nombre}-${s}: ${canales(o)};\n`;
  }
}

const css = `/* ARCHIVO GENERADO por scripts/generar-temas.js (npm run generar:temas) — los colores del tema claro y del oscuro.
   Se usan desde tailwind.config.js (rgb(var(--c-...) / <alpha-value>)), así toda la app cambia
   de tema sin tocar las pantallas. */
@import '@fontsource-variable/plus-jakarta-sans/wght.css';

:root {
  color-scheme: light;
  --c-page: 244 246 253;
  --c-surface: 255 255 255;
  --c-sombra: 49 46 129;
  --c-brillo: 79 70 229;
${claro}}

.dark {
  color-scheme: dark;
  --c-page: 11 16 29;
  --c-surface: ${canales(SUPERFICIE_OSCURA)};
  --c-sombra: 0 0 0;
  --c-brillo: 0 0 0;
${oscuro}}
`;

fs.writeFileSync(path.join(RAIZ, 'src/temas.css'), css);
console.log('listo', css.split('\n').length, 'líneas');
