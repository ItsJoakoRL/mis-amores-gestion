// Prueba del cambio masivo de precios (con "deshacer") y de la carga de costos en
// planilla: el cálculo, lo que se aplica, lo que se rechaza y que sólo pueda la
// administradora.
//
//   npm run build:electron
//   node scripts/probar-precios.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_precios", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4187;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_precios';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-precios-'));
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
const { calcularPrecioNuevo, porcentajeDeCambio, nuevoIdLote } = require(path.join(RAIZ, 'dist-electron/shared/precios.js'));

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
    stock: 10, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}

(async () => {
  try {
    log('\n[1] El cálculo del precio nuevo');
    const pct = (valor, redondeo = 0) => ({ tipo: 'porcentaje', valor, redondeo });
    const monto = (valor, redondeo = 0) => ({ tipo: 'monto', valor, redondeo });
    ok(calcularPrecioNuevo(1000, pct(10)) === 1100, '$1000 con +10% queda $1100 (sin restos de decimales)');
    ok(calcularPrecioNuevo(1234, pct(10, 10)) === 1360, '$1234 +10% redondeado a $10: 1357,40 → $1360');
    ok(calcularPrecioNuevo(1234, pct(10, 100)) === 1400, 'redondeado a $100: $1400');
    ok(calcularPrecioNuevo(999, pct(-15, 5)) === 850, '$999 -15% redondeado a $5: 849,15 → $850');
    ok(calcularPrecioNuevo(1105, pct(0, 10)) === 1110, 'el redondeo va al más cercano: 1105 → 1110 (la mitad sube)');
    ok(calcularPrecioNuevo(1104, pct(0, 10)) === 1100, 'y 1104 → 1100');
    ok(calcularPrecioNuevo(100, monto(25.5)) === 125.5, 'sumar $25,50 a $100 da $125,50');
    ok(calcularPrecioNuevo(100, monto(-150)) === 0, 'restar de más nunca deja un precio negativo: queda en $0');
    ok(calcularPrecioNuevo(333.33, pct(0)) === 333.33, 'un 0% no cambia el precio');
    ok(calcularPrecioNuevo(1000, pct(33.333, 0)) === 1333.33, 'sin redondear queda con centavos (1333,33)');
    ok(Number.isNaN(calcularPrecioNuevo(NaN, pct(10))), 'un precio que no es número se deja como está');
    ok(calcularPrecioNuevo(1000, pct(Number.NaN)) === 1000, 'un porcentaje que no es número no cambia nada');
    ok(porcentajeDeCambio(1000, 1100) === 10 && porcentajeDeCambio(1000, 900) === -10 && porcentajeDeCambio(0, 100) === 0, 'el porcentaje de cambio: +10, -10 y (si no tenía precio) 0');
    const a = nuevoIdLote();
    const b = nuevoIdLote();
    ok(/^[A-Za-z0-9-]{8,64}$/.test(a) && a !== b, 'los identificadores de lote son válidos y distintos');

    log('\nLevantando un servidor de prueba...');
    await levantar();
    const token = (await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, token);
    const tLucia = (await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).data.token;
    const crear = async (base) => (await api('POST', '/api/articulos', entradaArticulo(base), token)).data;
    const leer = async (id) => (await api('GET', `/api/articulos/${id}`, undefined, token)).data;
    const historial = async (id) => (await api('GET', `/api/articulos/${id}/historial-precios`, undefined, token)).data;
    const rubro = (await api('POST', '/api/familias', { nombre: 'GOLOSINAS' }, token)).data;
    const A = await crear({ descripcion: 'ALFAJOR', precioVenta: 1000, precioCosto: 600, familiaId: rubro.id });
    const B = await crear({ descripcion: 'BOMBON', precioVenta: 500, precioCosto: 0, familiaId: rubro.id });
    const C = await crear({ descripcion: 'CARAMELO', precioVenta: 200, precioCosto: 100, familiaId: rubro.id });
    const D = await crear({ descripcion: 'DULCE', precioVenta: 300, precioCosto: 150 });
    const viejo = await crear({ descripcion: 'VIEJO', precioVenta: 50, precioCosto: 20 });
    await api('DELETE', `/api/articulos/${viejo.id}`, undefined, token);
    const aplicar = (items, desc = 'GOLOSINAS: subir 10%', lote = nuevoIdLote(), t = token) => api('POST', '/api/precios/aplicar', { items, descripcion: desc, loteId: lote }, t);
    const item = (art, precioNuevo, precioVisto) => ({ articuloId: art.id, precioNuevo, precioVisto: precioVisto ?? art.precioVenta });

    log('\n[2] Aplicar un cambio de precios');
    const lote1 = nuevoIdLote();
    let r = await aplicar([item(A, 1100), item(B, 550), item(C, 200)], 'GOLOSINAS: subir 10%', lote1);
    ok(r.ok && r.data.cambiados === 2 && r.data.sinCambios === 1 && r.data.omitidos.length === 0 && r.data.loteId === lote1, `se cambian 2, uno ya tenía ese precio, sin problemas (${JSON.stringify(r.data)})`);
    ok((await leer(A.id)).precioVenta === 1100 && (await leer(B.id)).precioVenta === 550 && (await leer(C.id)).precioVenta === 200, 'los precios quedaron: 1100, 550 y 200');
    ok((await leer(A.id)).utilidadPct === 83.3, `la utilidad se recalcula con el costo ($1100 sobre $600 = 83,3%) → ${(await leer(A.id)).utilidadPct}`);
    ok((await leer(B.id)).utilidadPct === 0, 'sin costo cargado, la utilidad queda en 0');
    ok((await leer(D.id)).precioVenta === 300, 'lo que no se incluyó no se tocó');
    let h = await historial(A.id);
    ok(h.some((x) => x.tipo === 'venta' && x.precioAnterior === 1000 && x.precioNuevo === 1100), 'queda en el historial de precios del producto: de $1000 a $1100');
    ok((await api('GET', `/api/articulos/${A.id}/historial-precios`, undefined, tLucia)).data.every((x) => x.tipo !== 'costo'), 'una empleada ve el historial de venta (nunca el de costo)');

    log('\n[3] Lo que no se cambia, sin frenar a los demás');
    const lote2 = nuevoIdLote();
    r = await aplicar(
      [
        item(D, 330),
        { articuloId: A.id, precioNuevo: 1200, precioVisto: 999 }, // alguien lo había cambiado
        { articuloId: B.id, precioNuevo: -5, precioVisto: 550 },
        { articuloId: C.id, precioNuevo: 'caro', precioVisto: 200 },
        { articuloId: C.id, precioNuevo: 1e10, precioVisto: 200 },
        { articuloId: viejo.id, precioNuevo: 70, precioVisto: 50 },
        { articuloId: '000000000000000000000000', precioNuevo: 10, precioVisto: 10 },
        { articuloId: 'no-es-un-id', precioNuevo: 10, precioVisto: 10 },
        item(D, 999),
      ],
      'prueba de rechazos',
      lote2
    );
    ok(r.ok && r.data.cambiados === 1 && r.data.omitidos.length === 8, `el producto bueno se cambia y los otros 8 renglones vuelven como omitidos (${r.data.cambiados} / ${r.data.omitidos.length})`);
    ok((await leer(D.id)).precioVenta === 330, 'DULCE quedó en $330 (el renglón repetido con $999 no lo pisó)');
    const motivos = r.data.omitidos.map((o) => o.motivo).join(' | ');
    ok(/mientras tanto/.test(motivos) && /no es válido/.test(motivos) && /papelera/.test(motivos) && /ya no existe/.test(motivos) && /repetido/.test(motivos), 'cada rechazo dice por qué (cambió mientras tanto / inválido / papelera / no existe / repetido)');
    ok((await leer(A.id)).precioVenta === 1100 && (await leer(B.id)).precioVenta === 550 && (await leer(C.id)).precioVenta === 200, 'ninguno de los omitidos cambió');
    ok(rechazo(await aplicar([], 'x'), 'nada para cambiar'), 'una lista vacía se rechaza');
    ok(rechazo(await aplicar(Array.from({ length: 1001 }, () => item(A, 1)), 'x'), 'hasta 1000'), 'más de 1000 por vez se rechaza');
    ok(rechazo(await aplicar([item(A, 1)], 'x', 'raro!'), 'identificador'), 'un identificador de lote raro se rechaza');
    ok(rechazo(await aplicar([item(A, 1)], 'x', 'corto'), 'identificador'), 'uno demasiado corto también');
    ok((await leer(A.id)).precioVenta === 1100, 'y los rechazos no tocaron nada');

    log('\n[4] Sólo la administradora');
    ok(rechazo(await aplicar([item(A, 1)], 'x', nuevoIdLote(), tLucia), 'administrador'), 'una empleada no puede cambiar precios');
    ok(rechazo(await api('GET', '/api/precios/lotes', undefined, tLucia), 'administrador'), 'ni ver los cambios hechos');
    ok(rechazo(await api('POST', `/api/precios/lotes/${lote1}/deshacer`, undefined, tLucia), 'administrador'), 'ni deshacerlos');
    ok(rechazo(await api('POST', '/api/precios/costos', { items: [{ articuloId: A.id, precioCosto: 1, costoVisto: 600 }] }, tLucia), 'administrador'), 'ni cargar costos');
    ok((await api('POST', '/api/precios/aplicar', { items: [item(A, 1)], descripcion: 'x', loteId: nuevoIdLote() })).ok === false, 'sin sesión tampoco');
    ok((await leer(A.id)).precioVenta === 1100, 'y no se cambió nada');

    log('\n[5] Los cambios hechos, y deshacerlos');
    let lotes = (await api('GET', '/api/precios/lotes', undefined, token)).data;
    const l1 = lotes.find((l) => l.loteId === lote1);
    ok(l1 && l1.cantidad === 2 && l1.descripcion === 'GOLOSINAS: subir 10%' && l1.usuarioNombre && l1.deshecho === false, 'la lista trae el cambio: 2 productos, su descripción, quién lo hizo, sin deshacer');
    ok(lotes[0].loteId === lote2, 'el más nuevo va primero');
    // Alguien cambia a mano un precio del lote 1 DESPUÉS: al deshacer, ése no se pisa.
    await api('PUT', `/api/articulos/${B.id}`, { input: { ...entradaArticulo({ descripcion: 'BOMBON', precioCosto: 0, familiaId: rubro.id }), precioVenta: 777 }, original: entradaArticulo({ descripcion: 'BOMBON', precioCosto: 0, familiaId: rubro.id, precioVenta: 550 }) }, token);
    ok((await leer(B.id)).precioVenta === 777, '(a mano, después, BOMBON pasó a $777)');
    r = await api('POST', `/api/precios/lotes/${lote1}/deshacer`, undefined, token);
    ok(r.ok && r.data.revertidos === 1 && r.data.omitidos === 1, `al deshacer vuelve 1 (ALFAJOR) y no se pisa el que se cambió a mano después (${JSON.stringify(r.data)})`);
    ok((await leer(A.id)).precioVenta === 1000 && (await leer(A.id)).utilidadPct === 66.7, 'ALFAJOR volvió a $1000 y su utilidad se recalculó (66,7%)');
    ok((await leer(B.id)).precioVenta === 777, 'BOMBON se quedó en $777 (lo último que se puso a mano)');
    h = await historial(A.id);
    ok(h.some((x) => x.precioAnterior === 1100 && x.precioNuevo === 1000), 'el deshacer también queda en el historial');
    lotes = (await api('GET', '/api/precios/lotes', undefined, token)).data;
    ok(lotes.find((l) => l.loteId === lote1).deshecho === true && lotes.find((l) => l.loteId === lote2).deshecho === false, 'la lista marca "deshecho" sólo el que se deshizo');
    ok(rechazo(await api('POST', `/api/precios/lotes/${lote1}/deshacer`, undefined, token), 'ya se deshizo'), 'un cambio no se puede deshacer dos veces');
    ok(rechazo(await api('POST', '/api/precios/lotes/loteQueNoExiste123/deshacer', undefined, token), 'No encontré'), 'uno que no existe se rechaza');
    ok(rechazo(await api('POST', '/api/precios/lotes/raro!/deshacer', undefined, token), 'identificador'), 'uno con un identificador raro también');
    r = await api('POST', `/api/precios/lotes/${lote2}/deshacer`, undefined, token);
    ok(r.ok && r.data.revertidos === 1 && (await leer(D.id)).precioVenta === 300, 'se deshace el otro cambio: DULCE vuelve a $300');

    log('\n[6] Costos en planilla');
    const costo = (art, precioCosto, costoVisto) => ({ articuloId: art.id, precioCosto, costoVisto: costoVisto ?? art.precioCosto });
    r = await api('POST', '/api/precios/costos', { items: [costo(A, 650), costo(B, 300), costo(C, 100), costo(D, 'barato')] }, token);
    ok(r.ok && r.data.cambiados === 2 && r.data.sinCambios === 1 && r.data.omitidos.length === 1, `se cargan 2 costos, uno ya estaba igual y uno es inválido (${JSON.stringify(r.data.omitidos.map((o) => o.motivo))})`);
    const A2 = await leer(A.id);
    const B2 = await leer(B.id);
    ok(A2.precioCosto === 650 && A2.utilidadPct === 53.8, `ALFAJOR: costo $650 y utilidad (1000 sobre 650 = 53,8%) → ${A2.utilidadPct}`);
    ok(B2.precioCosto === 300 && B2.utilidadPct === 159, `BOMBON: costo $300 y utilidad (777 sobre 300 = 159%) → ${B2.utilidadPct}`);
    h = await historial(A.id);
    ok(h.some((x) => x.tipo === 'costo' && x.precioAnterior === 600 && x.precioNuevo === 650), 'el cambio de costo queda en el historial (sólo lo ve la administradora)');
    r = await api('POST', '/api/precios/costos', { items: [{ articuloId: A.id, precioCosto: 700, costoVisto: 600 }, { articuloId: viejo.id, precioCosto: 5, costoVisto: 20 }, { articuloId: A.id, precioCosto: -1, costoVisto: 650 }, { articuloId: '0'.repeat(24), precioCosto: 5, costoVisto: 5 }] }, token);
    ok(r.ok && r.data.cambiados === 0 && r.data.omitidos.length === 4, 'si alguien le cambió el costo, está en la papelera, es negativo o no existe: no se cambia');
    ok((await leer(A.id)).precioCosto === 650, 'y el costo quedó como estaba');
    ok(rechazo(await api('POST', '/api/precios/costos', { items: [] }, token), 'nada para cambiar'), 'una lista vacía se rechaza');
    ok((await api('GET', `/api/articulos/${A.id}`, undefined, tLucia)).data.precioCosto === 0, 'una empleada sigue sin ver el costo (viene en 0)');
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
