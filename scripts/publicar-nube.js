// Arma y publica el servidor para Render (ver SERVIDOR_RENDER.md):
//
//   npm run publicar:nube              compila, arma la carpeta y la sube
//   npm run publicar:nube -- --sin-subir   sólo arma la carpeta (para mirarla)
//
// Render no compila la app (el plan gratuito es muy justo de memoria y de
// procesador): lee ya compilada la rama "servidor-nube" del repositorio. Esa
// rama NO es el código fuente: es sólo la app compilada, el package.json y la
// configuración de Render. Cada publicación agrega un commit encima de lo que
// ya está en GitHub (push normal, nunca --force).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const RAMA = 'servidor-nube';
const sinSubir = process.argv.includes('--sin-subir');
const { version } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf-8'));

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

function git(args, opciones = {}) {
  const r = spawnSync('git', args, { encoding: 'utf-8', ...opciones });
  if (r.status !== 0) {
    salir(`Falló "git ${args.join(' ')}":\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

for (const p of ['dist', 'dist-electron', 'package.json', 'package-lock.json', 'nube/render.yaml']) {
  if (!fs.existsSync(path.join(RAIZ, p))) salir(`Falta "${p}". Usá "npm run publicar:nube" (compila primero).`);
}

// ---- La carpeta con lo que va a la rama ----
const carpeta = path.join(RAIZ, 'release', 'nube');
fs.rmSync(carpeta, { recursive: true, force: true });
fs.mkdirSync(carpeta, { recursive: true });

for (const dir of ['dist', 'dist-electron']) fs.cpSync(path.join(RAIZ, dir), path.join(carpeta, dir), { recursive: true });
for (const archivo of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(RAIZ, archivo), path.join(carpeta, archivo));
fs.copyFileSync(path.join(RAIZ, 'nube', 'render.yaml'), path.join(carpeta, 'render.yaml'));
fs.writeFileSync(path.join(carpeta, '.node-version'), '22\n');
fs.writeFileSync(
  path.join(carpeta, 'LEEME.txt'),
  `Mis Amores - servidor para Render (versión ${version}).\n` +
    'Esta rama la genera "npm run publicar:nube": es la app ya compilada, no el código fuente.\n' +
    'No se edita a mano: cada publicación la reemplaza con la versión nueva.\n'
);

console.log(`\n✓ Carpeta armada: ${path.relative(RAIZ, carpeta)} (versión ${version})`);
if (sinSubir) {
  console.log('  (no se subió nada: usaste --sin-subir)\n');
  process.exit(0);
}

// ---- Subirla a la rama ----
const remoto = git(['-C', RAIZ, 'remote', 'get-url', 'origin']);
const nombre = git(['-C', RAIZ, 'config', 'user.name']);
const correo = git(['-C', RAIZ, 'config', 'user.email']);

// Un repositorio aparte, sólo para esta rama: se parte de lo que ya está en
// GitHub (si existe) y se le agrega un commit con la app nueva.
const trabajo = path.join(RAIZ, 'release', 'nube-git');
fs.rmSync(trabajo, { recursive: true, force: true });
fs.mkdirSync(trabajo, { recursive: true });
git(['init', '-q', '-b', RAMA], { cwd: trabajo });
git(['config', 'user.name', nombre], { cwd: trabajo });
git(['config', 'user.email', correo], { cwd: trabajo });
git(['remote', 'add', 'origin', remoto], { cwd: trabajo });
const yaExiste = git(['ls-remote', '--heads', 'origin', RAMA], { cwd: trabajo }) !== '';
if (yaExiste) {
  git(['fetch', '-q', '--depth', '1', 'origin', RAMA], { cwd: trabajo });
  git(['checkout', '-q', '-B', RAMA, 'FETCH_HEAD'], { cwd: trabajo });
}

// Lo de la rama se reemplaza por la carpeta recién armada.
for (const entrada of fs.readdirSync(trabajo)) {
  if (entrada !== '.git') fs.rmSync(path.join(trabajo, entrada), { recursive: true, force: true });
}
fs.cpSync(carpeta, trabajo, { recursive: true });
git(['add', '-A'], { cwd: trabajo });
if (yaExiste && spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: trabajo }).status === 0) {
  console.log(`\n✓ La rama "${RAMA}" ya tiene exactamente esta versión: no hay nada nuevo que subir.\n`);
  process.exit(0);
}
git(['commit', '-q', '-m', `Servidor de internet ${version}`], { cwd: trabajo });
console.log(`  Subiendo a la rama "${RAMA}" de ${remoto} ...`);
git(['push', 'origin', `${RAMA}:${RAMA}`], { cwd: trabajo });
console.log(`\n✓ Publicado en la rama "${RAMA}". Render la toma sola (si ya lo tenés armado) o seguí la guía.\n`);
