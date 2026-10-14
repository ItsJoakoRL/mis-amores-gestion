// Prepara lo que hay que cargar en Render (ver SERVIDOR_RENDER.md): la clave de
// la red de esta PC, para que el servidor de internet sea parte de la misma red.
//
//   npm run preparar:nube
//
// Se corre en la PC del negocio (la que tiene Mis Amores instalado). Deja el
// archivo "servidor-config/variables-render.txt". Tiene la CLAVE de la red: no
// lo compartas con nadie ni lo subas a ningún lado (la carpeta ya está fuera de git).
const fs = require('fs');
const os = require('os');
const path = require('path');

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

// Dónde guarda la app instalada su configuración.
const archivoPc =
  argumento('config') ||
  path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'mis-amores-gestion', 'configuracion-pc.json');

let pc;
try {
  pc = JSON.parse(fs.readFileSync(archivoPc, 'utf-8'));
} catch {
  salir(
    `No pude leer la configuración de esta PC en:\n  ${archivoPc}\n` +
      '  ¿Está instalada y abierta Mis Amores en esta PC? (Si la guarda en otro lado, pasame la ruta con --config).'
  );
}
if (typeof pc.claveRed !== 'string' || !pc.claveRed) {
  salir('Esta PC todavía no tiene su clave de red. Abrí Mis Amores, dejala andando un momento y probá de nuevo.');
}

const carpeta = path.resolve(argumento('salida') || path.join(__dirname, '..', 'servidor-config'));
fs.mkdirSync(carpeta, { recursive: true });
const destino = path.join(carpeta, 'variables-render.txt');

const texto = `# Variables de entorno para Render (ver SERVIDOR_RENDER.md).
# Este archivo tiene la CLAVE de tu red: no lo compartas ni lo subas a ningún lado.

MIS_AMORES_CLAVE_RED=${pc.claveRed}
`;
fs.writeFileSync(destino, texto);

console.log(`
✓ Listo. Dejé las variables para Render en:
  ${destino}

Abrí ese archivo y copiá el valor de MIS_AMORES_CLAVE_RED cuando la guía te lo pida.
(La clave no se muestra acá a propósito.)
`);
