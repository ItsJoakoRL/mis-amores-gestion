// Prueba de cómo se comparan las versiones de la app (para avisar cuando una PC
// de la red quedó desactualizada): shared/versiones.ts.
//
//   node scripts/probar-versiones.js
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const RAIZ = path.resolve(__dirname, '..');
const fuente = fs.readFileSync(path.join(RAIZ, 'shared/versiones.ts'), 'utf8');
const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const modulo = { exports: {} };
new Function('module', 'exports', js)(modulo, modulo.exports);
const { compararVersiones } = modulo.exports;

let fallas = 0;
let pasaron = 0;
function ok(condicion, mensaje) {
  if (condicion) {
    pasaron += 1;
    console.log('   ✓', mensaje);
  } else {
    fallas += 1;
    console.log('   ✗ FALLÓ:', mensaje);
  }
}

console.log('Comparar versiones');
ok(compararVersiones('0.8.4', '0.8.10') < 0, '0.8.4 es más vieja que 0.8.10');
ok(compararVersiones('0.8.10', '0.8.9') > 0, '0.8.10 es más nueva que 0.8.9 (aunque como texto "0.8.10" < "0.8.9")');
ok(compararVersiones('0.8.10', '0.8.10') === 0, 'iguales dan 0');
ok(compararVersiones('0.9.0', '0.8.99') > 0, 'el número del medio manda sobre el último');
ok(compararVersiones('1.0.0', '0.99.99') > 0, 'el primero manda sobre todo');
ok(compararVersiones('0.8', '0.8.0') === 0, 'una versión más corta se completa con ceros');
ok(compararVersiones('basura', '0.8.0') < 0, 'un texto raro no rompe nada');

console.log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
process.exit(fallas === 0 ? 0 : 1);
