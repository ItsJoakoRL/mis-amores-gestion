// Prepara el archivo de configuración del SERVIDOR (ver SERVIDOR.md) a partir de
// la configuración de esta PC: la clave de la red y cómo encontrarla.
//
// Se corre en la PC del negocio (la que ya tiene los datos y Tailscale):
//
//   node scripts/preparar-servidor.js --direccion 100.64.1.2
//
// Deja el archivo "configuracion-pc.json" dentro de la carpeta "servidor-config"
// del proyecto. Ese archivo tiene la CLAVE de la red: hay que llevarlo al
// servidor y no compartirlo con nadie más (ver SERVIDOR.md).
const crypto = require('crypto');
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

const direccionPedida = (argumento('direccion') || '').trim();
if (!direccionPedida) {
  salir(
    'Falta la dirección de esta PC en Tailscale (la que empieza con 100.).\n' +
      '  Ejemplo: node scripts/preparar-servidor.js --direccion 100.64.1.2'
  );
}
const direccion = /:\d+$/.test(direccionPedida) ? direccionPedida : `${direccionPedida}:4000`;

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
if (typeof pc.idPc !== 'string' || !pc.idPc || typeof pc.claveRed !== 'string' || !pc.claveRed) {
  salir('Esta PC todavía no tiene su clave de red. Abrí Mis Amores, dejala andando un momento y probá de nuevo.');
}

const carpetaSalida = path.resolve(argumento('salida') || path.join(__dirname, '..', 'servidor-config'));
fs.mkdirSync(carpetaSalida, { recursive: true });
const destino = path.join(carpetaSalida, 'configuracion-pc.json');

const configuracion = {
  // El servidor es una "PC" más, con su propio identificador.
  idPc: crypto.randomUUID(),
  claveRed: pc.claveRed,
  // De acá trae todos los datos la primera vez.
  pares: [{ idPc: pc.idPc, nombre: os.hostname(), direccion }],
  inicial: 'traer',
  direccionAnterior: null,
  nombreAnterior: null,
};
fs.writeFileSync(destino, JSON.stringify(configuracion, null, 2));

console.log(`
✓ Listo. Dejé el archivo para el servidor en:
  ${destino}

  Trae los datos de: ${os.hostname()} (${direccion})

Ese archivo tiene la CLAVE de tu red: llevalo al servidor siguiendo SERVIDOR.md
y después borralo de acá. No lo mandes por WhatsApp ni lo subas a ningún lado.
`);
