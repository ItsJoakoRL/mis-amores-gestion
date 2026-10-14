// Arma el paquete para instalar en el servidor (ver SERVIDOR.md):
//
//   npm run armar:servidor
//
// Deja release/mis-amores-servidor-<versión>.tar.gz con la app ya compilada
// (sin Electron ni los programas para desarrollar). En el servidor se
// descomprime y se corre "npm ci --omit=dev".
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf-8'));

const incluir = ['dist', 'dist-electron', 'package.json', 'package-lock.json', 'SERVIDOR.md'];
for (const p of incluir) {
  if (!fs.existsSync(path.join(RAIZ, p))) {
    console.error(`\n✗ Falta "${p}". Corré "npm run build" primero (o usá "npm run armar:servidor").\n`);
    process.exit(1);
  }
}

fs.mkdirSync(path.join(RAIZ, 'release'), { recursive: true });
const salida = path.join('release', `mis-amores-servidor-${version}.tar.gz`);
// "tar" viene con Windows 10 y 11 (y con Linux y Mac).
const r = spawnSync('tar', ['-czf', salida, ...incluir], { cwd: RAIZ, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\n✗ No se pudo armar el paquete (¿está disponible el comando "tar"?).\n');
  process.exit(1);
}
const mb = (fs.statSync(path.join(RAIZ, salida)).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Paquete listo: ${salida} (${mb} MB)\n`);
