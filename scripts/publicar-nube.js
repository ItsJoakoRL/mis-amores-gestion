// Arma y publica el servidor para Render (ver SERVIDOR_RENDER.md):
//
//   npm run publicar:nube              compila, arma la carpeta y la sube
//   npm run publicar:nube -- --sin-subir   sólo arma la carpeta (para mirarla)
//
// Render no compila la app (el plan gratuito es muy justo de memoria y de
// procesador): lee ya compilada la rama "servidor-nube" del repositorio. Esa
// rama NO es el código fuente: es sólo la app compilada, el package.json y la
// configuración de Render. Cada vez que se publica, la rama se reemplaza entera.
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
    'No se edita a mano: se reemplaza entera en cada publicación.\n'
);

console.log(`\n✓ Carpeta armada: ${path.relative(RAIZ, carpeta)} (versión ${version})`);
if (sinSubir) {
  console.log('  (no se subió nada: usaste --sin-subir)\n');
  process.exit(0);
}

const remoto = git(['-C', RAIZ, 'remote', 'get-url', 'origin']);
const nombre = git(['-C', RAIZ, 'config', 'user.name']);
const correo = git(['-C', RAIZ, 'config', 'user.email']);

// Un repositorio aparte, de un solo commit, sólo para esta rama.
git(['init', '-q', '-b', RAMA], { cwd: carpeta });
git(['config', 'user.name', nombre], { cwd: carpeta });
git(['config', 'user.email', correo], { cwd: carpeta });
git(['add', '-A'], { cwd: carpeta });
git(['commit', '-q', '-m', `Servidor de internet ${version}`], { cwd: carpeta });
console.log(`  Subiendo a la rama "${RAMA}" de ${remoto} ...`);
git(['push', '--force', remoto, `${RAMA}:${RAMA}`], { cwd: carpeta });
console.log(`\n✓ Publicado en la rama "${RAMA}". Render la toma sola (si ya lo tenés armado) o seguí la guía.\n`);
