// Prueba de qué pasa cuando el reloj de una PC está corrido (fecha u hora mal
// puestas, o la pila del reloj gastada): antes quedaba "afuera de la red"; ahora
// el pedido se corrige solo con la hora de la otra PC.
//
//   npm run build:electron
//   node scripts/probar-reloj.js
//
// No necesita base de datos ni Electron: levanta un servidor mínimo en el puerto
// 4183 que verifica las firmas con el mismo código que las PCs.
const http = require('http');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const { pedirFirmado, olvidarDesfases } = require(path.join(RAIZ, 'dist-electron/electron/sync/pedidoFirmado.js'));
const { verificarPedido, pruebaDeRespuesta, respuestaEsDeLaRed, motivoDeRechazo, firmarPedido } = require(
  path.join(RAIZ, 'dist-electron/electron/sync/seguridad.js')
);

const CLAVE = 'clave-de-prueba-del-reloj-' + Date.now();
const PUERTO = 4183;
const DIA = 24 * 60 * 60 * 1000;

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

// Una "PC" mínima: acepta pedidos firmados con CLAVE y cuenta cuántos le llegan.
let pedidos = 0;
const servidor = http.createServer((req, res) => {
  const trozos = [];
  req.on('data', (t) => trozos.push(t));
  req.on('end', () => {
    pedidos += 1;
    const cuerpo = req.method === 'POST' ? Buffer.concat(trozos).toString('utf8') : undefined;
    const nonce = verificarPedido(CLAVE, req.headers, req.method, req.url, cuerpo);
    if (!nonce) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'X-Red-Hora': String(Date.now()) });
      res.end(JSON.stringify({ ok: false, error: 'rechazado' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Red-Prueba': pruebaDeRespuesta(CLAVE, nonce) });
    res.end(JSON.stringify({ ok: true, data: { recibido: cuerpo ?? null } }));
  });
});

async function pedir(opciones) {
  const antes = pedidos;
  const r = await pedirFirmado({ url: `http://127.0.0.1:${PUERTO}/api/sync/hola?x=1`, esperaMs: 5000, clave: CLAVE, ...opciones });
  return { ...r, intentos: pedidos - antes };
}

(async () => {
  await new Promise((resolve) => servidor.listen(PUERTO, '127.0.0.1', resolve));
  try {
    log('[1] Con el reloj bien');
    olvidarDesfases();
    let r = await pedir({});
    ok(r.respuesta.status === 200 && r.intentos === 1, 'se acepta de una, en un solo pedido');
    ok(respuestaEsDeLaRed(CLAVE, r.nonce, r.respuesta.headers.get('x-red-prueba')), 'y la respuesta trae la prueba de la red');

    log('\n[2] Reloj de esta PC atrasado 3 días');
    olvidarDesfases();
    const atrasado = () => Date.now() - 3 * DIA;
    r = await pedir({ ahora: atrasado });
    ok(r.respuesta.status === 200, 'el pedido se acepta igual');
    ok(r.intentos === 2, 'con un solo reintento (el primero fue rechazado y trajo la hora de la otra PC)');
    ok(respuestaEsDeLaRed(CLAVE, r.nonce, r.respuesta.headers.get('x-red-prueba')), 'la prueba de la respuesta coincide con el pedido reintentado');
    r = await pedir({ ahora: atrasado });
    ok(r.respuesta.status === 200 && r.intentos === 1, 'el siguiente pedido ya sale con la hora corregida (un solo pedido)');

    log('\n[3] Reloj adelantado 40 horas, y un pedido con contenido (POST)');
    olvidarDesfases();
    const adelantado = () => Date.now() + 40 * 60 * 60 * 1000;
    const cuerpo = JSON.stringify({ idPc: 'x', items: [1, 2, 3] });
    r = await pedir({ ahora: adelantado, cuerpo });
    ok(r.respuesta.status === 200 && r.intentos === 2, 'se acepta también');
    ok(JSON.parse(r.texto).data.recibido === cuerpo, 'y el contenido llegó completo');

    log('\n[4] Clave equivocada: no queda dando vueltas');
    olvidarDesfases();
    r = await pedir({ clave: 'otra-clave' });
    ok(r.respuesta.status === 401, 'sigue rechazado');
    ok(r.intentos <= 2, `como mucho un reintento (fueron ${r.intentos})`);

    log('\n[5] El mensaje del rechazo distingue la hora de la clave');
    const firmaVieja = firmarPedido(CLAVE, 'GET', '/api/sync/hola', undefined, Date.now() - 3 * DIA);
    const cab = {};
    for (const [k, v] of Object.entries(firmaVieja.cabeceras)) cab[k.toLowerCase()] = v;
    ok(motivoDeRechazo(CLAVE, cab, 'GET', '/api/sync/hola') === 'hora', 'con la clave bien y la hora corrida: "hora"');
    ok(motivoDeRechazo('otra-clave', cab, 'GET', '/api/sync/hola') === 'clave', 'con otra clave: "clave"');
    ok(motivoDeRechazo(CLAVE, {}, 'GET', '/api/sync/hola') === 'clave', 'sin firma: "clave"');
  } catch (e) {
    fallas += 1;
    log('\n✗ ERROR EN LA PRUEBA:', e.message);
  } finally {
    servidor.close();
  }
  log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
