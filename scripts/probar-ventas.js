// Prueba de las ventas y de varias cosas que se arreglaron en la revisión general:
//  - compras (tickets): cuántas ventas hubo y el ticket promedio cuentan compras, no productos sueltos
//  - un producto sin precio no se puede vender
//  - "Stock bajo" / "Sin stock" / "Para revisar": lo mismo en los filtros y en el Panel
//  - el asistente entiende "cobré", "entró", "facturé" y cuenta los pagos de cuentas; "el más vendido del mes"
//  - mensajes de error entendibles (no "Cannot read properties...")
//  - cada persona cambia su propia clave
//
//   npm run build:electron
//   node scripts/probar-ventas.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba "test_ventas", su
// carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4188;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_ventas';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-ventas-'));
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');

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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return r.json();
}
// Un pedido con el cuerpo tal cual (para mandar JSON roto).
async function crudo(metodo, ruta, texto, token) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: texto,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* no era JSON */
  }
  return { status: r.status, json };
}
const rechazo = (r, texto) => r.ok === false && new RegExp(texto, 'i').test(r.error || '');

async function vaciarBase() {
  const c = new MongoClient(MONGO);
  await c.connect();
  await c.db(DB).dropDatabase();
  await c.close();
}

let servidor = null;
async function levantar() {
  await vaciarBase();
  servidor = spawn(process.execPath, [SERVIDOR_JS], {
    cwd: RAIZ,
    env: { ...process.env, MONGODB_URI: MONGO, MONGODB_DB_NAME: DB, MIS_AMORES_PUERTO: String(PUERTO), MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(BASE + '/api/sistema/info')).ok) return;
    } catch {
      /* todavía no */
    }
    await esperar(300);
  }
  throw new Error('El servidor de prueba no arrancó');
}

function entradaArticulo(base) {
  return {
    codigoBarras: null, descripcion: 'X', marcaId: null, familiaId: null, proveedorId: null,
    precioCosto: 60, precioVenta: 100, precioLista2: 0, precioLista3: 0, utilidadPct: 0,
    stock: 100, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}
const ticket = (letra) => letra.repeat(24);

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();
    const token = (await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const idAdmin = (await api('GET', '/api/auth/sesion', undefined, token)).data.id;
    await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, token);
    const tLucia = (await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).data.token;
    const crear = async (descripcion, precioVenta, extra = {}) => (await api('POST', '/api/articulos', entradaArticulo({ descripcion, precioVenta, ...extra }), token)).data;
    const vender = (articulo, cantidad, metodoPago, extra = {}) => api('POST', '/api/ventas', { articuloId: articulo.id, cantidad, metodoPago, ...extra }, token);

    // ------------------------------------------------------------------ compras (tickets)
    log('\n[1] Compras: una cuenta con varios productos cuenta como UNA venta');
    const aA = await crear('PRODUCTO A', 500);
    const aB = await crear('PRODUCTO B', 300);
    const aC = await crear('PRODUCTO C', 200);
    const marta = (await api('POST', '/api/clientes', { nombre: 'Marta Gómez', nota: null, telefono: null, deudaInicial: 0 }, token)).data;
    // Compra 1: A x2 + B x1, en efectivo.
    let r1 = await vender(aA, 2, 'efectivo', { ticketId: ticket('a') });
    await vender(aB, 1, 'efectivo', { ticketId: ticket('a') });
    ok(r1.ok && r1.data.ticketId === ticket('a'), 'la venta guarda el número de su compra (ticketId)');
    // Compra 2: C x1, con tarjeta.
    await vender(aC, 1, 'tarjeta', { ticketId: ticket('b') });
    // Compra 3: A fiado + B en efectivo (una compra con dos formas de pago).
    await vender(aA, 1, 'fiado', { ticketId: ticket('c'), clienteId: marta.id });
    await vender(aB, 1, 'efectivo', { ticketId: ticket('c') });
    let hoy = (await api('GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    ok(hoy.cantidadVentas === 3, `hoy hubo 3 compras (eran 5 productos): ${hoy.cantidadVentas}`);
    ok(hoy.total === 1000 + 300 + 200 + 500 + 300, 'y el total de plata es el mismo de siempre ($2.300)');
    let rep = (await api('GET', `/api/reportes/ventas?desde=${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&hasta=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`, undefined, token)).data;
    ok(rep.cantidadVentas === 3, `el reporte también dice 3 compras (${rep.cantidadVentas})`);
    ok(Math.abs(rep.ticketPromedio - 2300 / 3) < 0.01, `el ticket promedio es lo que se gastó por compra: $${rep.ticketPromedio.toFixed(2)} (2300 / 3), no por producto`);
    const porMetodo = Object.fromEntries(rep.porMetodoPago.map((m) => [m.metodoPago, m.cantidad]));
    ok(porMetodo.efectivo === 2 && porMetodo.tarjeta === 1 && porMetodo.fiado === 1, `por forma de pago: 2 compras con efectivo, 1 con tarjeta y 1 con fiado (${JSON.stringify(porMetodo)})`);
    const mes = (await api('GET', `/api/ventas/resumen-mes?anio=${new Date().getFullYear()}&mes=${new Date().getMonth()}`, undefined, token)).data;
    const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    ok(mes.find((d) => d.fecha === ymd)?.cantidadVentas === 3, 'el casillero de hoy del Calendario también dice 3');

    // Un ticketId mal armado se ignora (la venta se hace igual y cuenta sola).
    for (const malo of ['xyz', 123, 'g'.repeat(24), null, '']) {
      const r = await vender(aC, 1, 'efectivo', { ticketId: malo });
      if (!(r.ok && r.data.ticketId === null)) ok(false, `un ticketId inválido (${JSON.stringify(malo)}) se ignora`);
    }
    ok(true, 'un ticketId mal armado (texto corto, número, letras que no son hex, vacío) se ignora: la venta se hace igual');
    hoy = (await api('GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    // (Las ventas sin número de compra hechas en el mismo minuto por la misma persona se agrupan, como las de antes:
    // por eso se miran límites y no un número exacto, que depende de si se cruzó un minuto.)
    ok(hoy.cantidadVentas >= 4 && hoy.cantidadVentas <= 8, `esas 5 ventas sin número cuentan como mucho una por una (entre 4 y 8 en total): ${hoy.cantidadVentas}`);
    // Mayúsculas y minúsculas del mismo número son la misma compra.
    const antesMay = hoy.cantidadVentas;
    await vender(aB, 1, 'efectivo', { ticketId: 'ABCDEF'.repeat(4) });
    await vender(aC, 1, 'efectivo', { ticketId: 'abcdef'.repeat(4) });
    hoy = (await api('GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    ok(hoy.cantidadVentas === antesMay + 1, `el mismo número en mayúsculas y en minúsculas es una sola compra (${antesMay} + 1): ${hoy.cantidadVentas}`);

    // Ventas de antes (sin número de compra): las del mismo minuto, de la misma persona, son una compra.
    const c0 = new MongoClient(MONGO);
    await c0.connect();
    const ventasDb = c0.db(DB).collection('ventas');
    const vieja = (fecha, art) => ({ _id: new ObjectId(), articuloId: new ObjectId(art.id), articuloDescripcion: art.descripcion, cantidad: 1, precioUnitario: art.precioVenta, total: art.precioVenta, metodoPago: 'efectivo', clienteId: null, usuarioId: new ObjectId(idAdmin), fecha });
    await ventasDb.insertMany([
      vieja('2026-03-10T15:30:05.000Z', aA),
      vieja('2026-03-10T15:30:40.000Z', aB), // mismo minuto: misma compra
      vieja('2026-03-10T15:31:10.000Z', aC), // otro minuto: otra compra
    ]);
    await c0.close();
    rep = (await api('GET', `/api/reportes/ventas?desde=${encodeURIComponent('2026-03-10T03:00:00.000Z')}&hasta=${encodeURIComponent('2026-03-11T03:00:00.000Z')}`, undefined, token)).data;
    ok(rep.cantidadVentas === 2 && rep.totalVendido === 1000, `las ventas de antes se agrupan por persona y minuto: 3 productos = 2 compras (${rep.cantidadVentas})`);
    const dia = (await api('GET', '/api/ventas/dia/2026-03-10', undefined, token)).data;
    ok(dia.length === 3 && dia.every((v) => v.ticketId === null), 'y en el detalle del día siguen apareciendo los 3 productos, sin número de compra');

    // ------------------------------------------------------------------ sin precio
    log('\n[2] Un producto sin precio no se puede vender');
    const sinPrecio = await crear('REGALO SIN PRECIO', 0);
    const antes = (await api('GET', `/api/articulos/${sinPrecio.id}`, undefined, token)).data.stock;
    const rs = await vender(sinPrecio, 1, 'efectivo');
    ok(rechazo(rs, 'no tiene precio cargado'), `se rechaza con un mensaje claro ("${rs.error}")`);
    ok((await api('GET', `/api/articulos/${sinPrecio.id}`, undefined, token)).data.stock === antes, 'y no se toca el stock');
    const dehoy = (await api('GET', `/api/ventas/dia/${ymd}`, undefined, token)).data;
    ok(!dehoy.some((v) => v.articuloId === sinPrecio.id), 'ni queda una venta de $0 anotada');
    await api('PUT', `/api/articulos/${sinPrecio.id}`, { input: { ...entradaArticulo({ descripcion: 'REGALO SIN PRECIO', precioVenta: 250 }) }, original: undefined }, token);
    ok((await vender(sinPrecio, 1, 'efectivo')).ok === true, 'cargándole el precio ($250), se vende normal');
    ok(rechazo(await vender(sinPrecio, 1, 'fiado'), 'cliente'), 'una venta fiada sin cliente sigue pidiendo el cliente');

    // ------------------------------------------------------------------ stock bajo / sin stock / para revisar
    log('\n[3] "Stock bajo", "Sin stock" y "Para revisar": lo mismo en los filtros y en el Panel');
    await crear('STOCK OK', 100, { stock: 10, stockMinimo: 2 });
    await crear('STOCK BAJO UNO', 100, { stock: 2, stockMinimo: 2 });
    await crear('STOCK BAJO DOS', 100, { stock: 1, stockMinimo: 5 });
    await crear('STOCK AGOTADO', 100, { stock: 0, stockMinimo: 2 });
    const neg = await crear('STOCK NEGATIVO', 100, { stock: 1, stockMinimo: 2 });
    await vender(neg, 4, 'efectivo'); // queda en -3
    const nombres = (lista) => lista.map((a) => a.descripcion).filter((d) => d.startsWith('STOCK ')).sort();
    const lista = async (q) => nombres((await api('GET', '/api/articulos' + q, undefined, token)).data);
    const bajo = await lista('?soloStockBajo=true');
    ok(JSON.stringify(bajo) === JSON.stringify(['STOCK BAJO DOS', 'STOCK BAJO UNO']), `"Stock bajo": quedan pocos pero hay (${bajo.join(', ')})`);
    const sin = await lista('?soloSinStock=true');
    ok(JSON.stringify(sin) === JSON.stringify(['STOCK AGOTADO', 'STOCK NEGATIVO']), `"Sin stock": ya no quedan (${sin.join(', ')})`);
    const revisar = await lista('?soloParaRevisar=true');
    ok(JSON.stringify(revisar) === JSON.stringify(['STOCK NEGATIVO']), `"Para revisar": los que se vendieron sin stock (${revisar.join(', ')})`);
    ok((await lista('?soloStockBajo=true&soloSinStock=true')).length === 0, 'pedir "bajo" y "sin" a la vez no trae nada (no pueden ser las dos cosas)');
    ok(JSON.stringify(await lista('?soloStockBajo=true&busqueda=dos')) === JSON.stringify(['STOCK BAJO DOS']), 'y los filtros se combinan con la búsqueda');
    const todos = (await api('GET', '/api/articulos', undefined, token)).data;
    const stats = (await api('GET', '/api/dashboard/stats', undefined, token)).data;
    ok(stats.stockBajoCount === (await api('GET', '/api/articulos?soloStockBajo=true', undefined, token)).data.length, `el Panel dice lo mismo que el filtro de "Stock bajo" (${stats.stockBajoCount})`);
    ok(stats.sinStockCount === (await api('GET', '/api/articulos?soloSinStock=true', undefined, token)).data.length, `y lo mismo que el filtro de "Sin stock" (${stats.sinStockCount})`);
    ok(stats.paraRevisarCount === todos.filter((a) => a.stock < 0).length, `y lo mismo con "Para revisar" (${stats.paraRevisarCount})`);

    // ------------------------------------------------------------------ asistente
    log('\n[4] El asistente');
    await api('POST', `/api/clientes/${marta.id}/pago`, { monto: 400, nota: null, metodoPago: 'efectivo' }, token);
    const pregunta = async (t) => (await api('POST', '/api/asistente/preguntar', { pregunta: t }, token)).data;
    for (const t of ['¿Cuánto cobré hoy?', '¿Cuánto entró hoy?', '¿Cuánto facturé hoy?', '¿Cuánto vendí hoy?', '¿Cuánto hice hoy?', 'la caja de hoy']) {
      const r = await pregunta(t);
      ok(r.reconocida && /cobrado/.test(r.texto), `entiende "${t}" → "${r.texto.slice(0, 80)}..."`);
    }
    const rh = await pregunta('¿Cuánto vendí hoy?');
    ok(/recibiste .*400.* de pagos de cuentas/.test(rh.texto.replace(/ /g, ' ')), 'y aclara los pagos de cuentas que recibió hoy ($400), que el Panel también cuenta');
    const rm = await pregunta('¿Cuál es el producto más vendido del mes?');
    ok(rm.reconocida && /lo más vendido fue/.test(rm.texto) && !/cobrado/.test(rm.texto), `"el producto más vendido del mes" contesta el producto, no el total del mes ("${rm.texto.slice(0, 70)}...")`);
    const rr = await pregunta('¿Qué rubro vendió más este mes?');
    ok(rr.reconocida && /rubro que más vendió/.test(rr.texto), 'y "qué rubro vendió más este mes" contesta el rubro');
    const rs2 = await pregunta('¿Cuánto vendí esta semana?');
    ok(/en promedio/.test(rs2.texto), 'en la semana habla de "cada compra salió en promedio" (el ticket promedio)');
    const rb = await pregunta('¿Qué tiene poco stock?');
    ok(/stock bajo \(quedan pocos\)/.test(rb.texto) && /botón "Stock bajo"/.test(rb.texto), 'lo de poco stock lleva al botón "Stock bajo"');
    const rsin = await pregunta('¿Qué está sin stock?');
    ok(/botón "Sin stock"/.test(rsin.texto), 'y lo de sin stock, al botón "Sin stock"');

    // ------------------------------------------------------------------ mensajes de error
    log('\n[5] Los mensajes de error se entienden');
    const tecnico = /Cannot read|Cannot destructure|BSON|ObjectId|input must be|undefined|TypeError/;
    for (const [metodo, ruta] of [['POST', '/api/ventas'], ['POST', '/api/clientes'], ['POST', '/api/familias'], ['POST', `/api/clientes/${marta.id}/pago`], ['POST', '/api/articulos/aplicar-conteo'], ['POST', `/api/articulos/${aA.id}/ajustar-stock`]]) {
      const r = await api(metodo, ruta, undefined, token);
      if (r.ok !== false || tecnico.test(String(r.error))) ok(false, `${metodo} ${ruta} sin datos: "${r.error}"`);
    }
    ok(true, 'pedidos sin datos a 6 rutas distintas: ninguno muestra "Cannot read properties..." (dicen que faltan datos)');
    const rId = await api('GET', '/api/articulos/abc/historial-precios', undefined, token);
    ok(rId.ok === false && /no es válido/.test(rId.error) && !tecnico.test(rId.error), `un id inventado dice "${rId.error}" (antes: "input must be a 24 character hex string...")`);
    const roto = await crudo('POST', '/api/clientes', '{esto no es json', token);
    ok(roto.status === 400 && roto.json?.ok === false && /no se entendió/.test(roto.json.error), 'un pedido con el JSON roto se contesta con un mensaje claro (y no con una página de error)');
    const nulo = await crudo('POST', '/api/clientes', 'null', token);
    ok(nulo.json?.ok === false && !tecnico.test(String(nulo.json.error)), 'un pedido con "null" también');
    const vacia = await crudo('GET', '/api/ventas/dia/', undefined, token);
    ok(vacia.status === 404 && vacia.json?.ok === false && /no existe/.test(vacia.json.error), 'una dirección de la API que no existe (con un dato vacío) contesta un mensaje, no la página de la aplicación');
    const { mensajeParaLaPersona } = require(path.join(RAIZ, 'dist-electron/electron/mensajesError.js'));
    ok(mensajeParaLaPersona(new Error('No hay stock suficiente (quedan 3)')) === 'No hay stock suficiente (quedan 3)', 'los mensajes que ya estaban bien escritos no se tocan');
    ok(!tecnico.test(mensajeParaLaPersona(new TypeError("Cannot read properties of undefined (reading 'x')"))), 'y los técnicos se reemplazan por una frase clara');

    // ------------------------------------------------------------------ cambiar la propia clave
    log('\n[6] Cada persona cambia su propia clave');
    let rc = await api('POST', '/api/usuarios/mi-password', { actual: 'incorrecta', nueva: 'otraclave99' }, tLucia);
    ok(rechazo(rc, 'actual no es correcta'), 'con la clave actual mal escrita, se rechaza');
    rc = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'abc' }, tLucia);
    ok(rechazo(rc, 'al menos'), 'una clave nueva demasiado corta, se rechaza');
    rc = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'clave1234' }, tLucia);
    ok(rechazo(rc, 'distinta'), 'una clave nueva igual a la de ahora, se rechaza');
    rc = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'claveNueva77' }, tLucia);
    ok(rc.ok === true, 'con todo bien, se cambia');
    ok((await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).ok === false, 'la clave vieja ya no sirve');
    ok((await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'claveNueva77' })).ok === true, 'la nueva sí');
  } catch (e) {
    fallas += 1;
    log('\n✗ ERROR EN LA PRUEBA:', e.message);
  } finally {
    try {
      servidor?.kill();
    } catch {
      /* ya terminó */
    }
    await esperar(500);
    try {
      await vaciarBase();
    } catch {
      /* nada */
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* nada */
    }
  }
  log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
