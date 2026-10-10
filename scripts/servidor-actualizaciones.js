// Reparte las actualizaciones de la app por la red local: sirve la carpeta
// "release/" (donde queda "latest.yml" + el instalador después de correr
// "npm run build:win") para que las PCs con la app instalada la encuentren
// solas, sin tener que copiarles el archivo a mano con un pendrive.
//
// Uso:  node scripts/servidor-actualizaciones.js
// Dejalo corriendo en esta PC (la que arma las actualizaciones) — las otras
// PCs la van a buscar automáticamente en http://misamores-actualizaciones.local:4321
//
// Antes de dejarlo corriendo la primera vez, en el router de la red conviene
// reservarle a esta PC siempre la misma IP (DHCP reservation) — así, aunque
// se caiga el WiFi o se reinicie el router, esta PC no cambia de dirección y
// las otras la siguen encontrando por nombre igual.
const express = require('express');
const os = require('os');
const path = require('path');
const mdns = require('multicast-dns');

const PUERTO = 4321;
const NOMBRE_HOST = 'misamores-actualizaciones.local';
const CARPETA_RELEASE = path.join(__dirname, '..', 'release');

function obtenerIpsLan() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const nombre of Object.keys(interfaces)) {
    for (const info of interfaces[nombre] ?? []) {
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    }
  }
  return ips;
}

function iniciarMdns(ip) {
  const respondedor = mdns();
  respondedor.on('query', (consulta) => {
    const preguntan = consulta.questions.some((q) => q.name.toLowerCase() === NOMBRE_HOST && q.type === 'A');
    if (!preguntan) return;
    respondedor.respond({ answers: [{ name: NOMBRE_HOST, type: 'A', ttl: 120, data: ip }] });
  });
  respondedor.on('error', () => {
    console.warn('mDNS no pudo arrancar — las otras PCs van a tener que usar la IP en vez del nombre.');
  });
}

const app = express();
app.use(express.static(CARPETA_RELEASE));

app.listen(PUERTO, '0.0.0.0', () => {
  const ips = obtenerIpsLan();
  const [primeraIp] = ips;
  if (primeraIp) iniciarMdns(primeraIp);

  console.log(`Sirviendo actualizaciones desde: ${CARPETA_RELEASE}`);
  console.log('\nLas otras PCs pueden buscar acá:');
  console.log(`  http://${NOMBRE_HOST}:${PUERTO}/`);
  for (const ip of ips) console.log(`  http://${ip}:${PUERTO}/`);
  console.log('\n(Ctrl+C para parar. Si no corriste "npm run build:win" todavía, esta carpeta va a estar vacía.)');
});
