// Prueba de la búsqueda de PCs "dirección por dirección" (electron/escaneoRed.ts),
// que es lo que encuentra a las otras PCs cuando el aviso "misamores.local" no
// llega (routers que no dejan pasar la multidifusión, placas de red virtuales).
//
//   npm run build:electron
//   node scripts/probar-escaneo.js
//
// No necesita base de datos: usa direcciones de la propia máquina (127.0.0.x).
const http = require('http');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const { escanearRedLocal, redesDe } = require(path.join(RAIZ, 'dist-electron/electron/escaneoRed.js'));

const PUERTO = 4184;
let fallas = 0;
let pasaron = 0;
const log = (...a) => console.log(...a);
function ok(condicion, mensaje) {
  if (condicion) {
    pasaron += 1;
    log('   ✓', mensaje);
  } else {
    fallas += 1;
    log('   ✗ FALLÓ:', mensaje);
  }
}

function servidor(ip, cuerpo) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cuerpo));
    });
    s.once('error', reject);
    s.listen(PUERTO, ip, () => resolve(s));
  });
}

(async () => {
  const abiertos = [];
  try {
    log('[1] Qué redes se barren');
    const redes = redesDe(['192.168.1.77', '10.0.0.5', '172.20.3.4', '100.76.79.65', '169.254.3.3', '8.8.8.8', '172.40.0.1', 'no-es-ip']);
    ok(
      JSON.stringify(redes.sort()) === JSON.stringify(['10.0.0.', '172.20.3.', '192.168.1.']),
      `sólo redes privadas (salen: ${redes.join(' ')})`
    );
    ok(redesDe(['192.168.1.77', '192.168.1.80']).length === 1, 'dos IPs de la misma red cuentan una sola vez');

    log('\n[2] Encuentra a las PCs con Mis Amores');
    abiertos.push(await servidor('127.0.0.1', { ok: true, data: { app: 'mis-amores-gestion', idPc: 'abc', nombrePc: 'PC-1' } }));
    abiertos.push(await servidor('127.0.0.3', { ok: true, data: { app: 'otra-aplicacion' } }));
    const t0 = Date.now();
    const halladas = await escanearRedLocal(['127.0.0.77'], PUERTO, { sinCache: true });
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    ok(halladas.length === 1 && halladas[0] === `127.0.0.1:${PUERTO}`, `encuentra la que tiene Mis Amores (${halladas.join(', ') || 'ninguna'})`);
    ok(!halladas.some((d) => d.startsWith('127.0.0.3')), 'ignora a la que contesta pero es otra aplicación');
    ok(!halladas.some((d) => d.startsWith('127.0.0.77')), 'no se incluye a sí misma');
    ok(Number(seg) < 15, `barre la red entera en pocos segundos (${seg} s)`);

    log('\n[3] Se acuerda un rato (para no barrer a cada búsqueda)');
    const t1 = Date.now();
    const otra = await escanearRedLocal(['127.0.0.77'], PUERTO);
    ok(otra.length === 1 && Date.now() - t1 < 200, 'la segunda búsqueda seguida contesta al instante');

    log('\n[4] Si la PC se apaga, ya no aparece');
    await new Promise((r) => abiertos[0].close(r));
    const sin = await escanearRedLocal(['127.0.0.77'], PUERTO, { sinCache: true });
    ok(sin.length === 0, 'sin ninguna PC con Mis Amores, la lista queda vacía');
  } catch (e) {
    fallas += 1;
    log('\n✗ ERROR EN LA PRUEBA:', e.message);
  } finally {
    for (const s of abiertos) {
      try {
        s.close();
      } catch {
        /* ya cerrado */
      }
    }
  }
  log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
