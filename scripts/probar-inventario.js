// Prueba de vender sin stock registrado y del conteo de inventario:
//
//   npm run build:electron
//   node scripts/probar-inventario.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_inventario", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4183;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_inventario';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-inventario-'));
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
const { pareceCodigoDeBarras } = require(path.join(RAIZ, 'dist-electron/shared/formato.js'));

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

// Devuelve { ok, data, error } sin tirar: así se prueban también los rechazos.
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
    env: {
      ...process.env,
      MONGODB_URI: MONGO,
      MONGODB_DB_NAME: DB,
      MIS_AMORES_PUERTO: String(PUERTO),
      MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos'),
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(BASE + '/api/sistema/info');
      if (r.ok) return;
    } catch {
      /* todavía no */
    }
    await esperar(300);
  }
  throw new Error('El servidor de prueba no arrancó');
}

function entradaArticulo(base) {
  return {
    codigoBarras: null,
    descripcion: 'X',
    marcaId: null,
    familiaId: null,
    proveedorId: null,
    precioCosto: 60,
    precioVenta: 100,
    precioLista2: 0,
    precioLista3: 0,
    utilidadPct: 0,
    stock: 10,
    stockMinimo: 1,
    stockIdeal: 5,
    unidad: 'unidad',
    imagenPath: null,
    nota: null,
    ...base,
  };
}

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();
    let r = await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
    const tokenAdmin = r.data.token;

    const crear = async (base) => (await api('POST', '/api/articulos', entradaArticulo(base), tokenAdmin)).data;
    const leer = async (id) => (await api('GET', `/api/articulos/${id}`, undefined, tokenAdmin)).data;
    const movimientos = async (id) => (await api('GET', `/api/articulos/${id}/movimientos-stock`, undefined, tokenAdmin)).data;

    const rubro = (await api('POST', '/api/familias', { nombre: 'GOLOSINAS' }, tokenAdmin)).data;
    const A = await crear({ descripcion: 'ALFAJOR', stock: 0, familiaId: rubro.id });
    const B = await crear({ descripcion: 'BOMBON', stock: 3, familiaId: rubro.id });
    const C = await crear({ descripcion: 'QUESO', stock: 1, unidad: 'peso', precioVenta: 1000, familiaId: rubro.id });
    const D = await crear({ descripcion: 'DULCE', stock: 10, familiaId: rubro.id });
    const E = await crear({ descripcion: 'ENVASE', stock: 4, familiaId: rubro.id });

    log('\n[1] Se vende aunque el sistema diga que no queda stock');
    r = await api('POST', '/api/ventas', { articuloId: A.id, cantidad: 2, metodoPago: 'efectivo' }, tokenAdmin);
    ok(r.ok && r.data.total === 200, 'se vende 2 de un producto con stock 0 (y cobra $200)');
    ok((await leer(A.id)).stock === -2, 'el stock queda en -2 (se vendió de más lo que figuraba)');
    let movs = await movimientos(A.id);
    ok(movs.some((m) => m.tipo === 'egreso' && m.cantidad === -2 && m.motivo === 'Venta'), 'queda el movimiento de la venta en su historial');
    r = await api('POST', '/api/ventas', { articuloId: B.id, cantidad: 5, metodoPago: 'efectivo' }, tokenAdmin);
    ok(r.ok, 'se vende 5 de un producto con stock 3');
    ok((await leer(B.id)).stock === -2, 'queda en -2');
    r = await api('POST', '/api/ventas', { articuloId: C.id, cantidad: 2.5, metodoPago: 'efectivo' }, tokenAdmin);
    ok(r.ok && (await leer(C.id)).stock === -1.5, 'un producto por peso también (2,5 kg con 1 kg registrado → -1,5)');
    r = await api('POST', '/api/ventas', { articuloId: D.id, cantidad: 4, metodoPago: 'efectivo' }, tokenAdmin);
    ok(r.ok && (await leer(D.id)).stock === 6, 'una venta con stock de sobra sigue descontando normal (10 → 6)');

    log('\n[2] Lo que sigue frenando');
    r = await api('POST', `/api/articulos/${A.id}/ajustar-stock`, { cantidad: 1, tipo: 'egreso', motivo: null }, tokenAdmin);
    ok(rechazo(r, 'No hay stock suficiente'), 'un egreso manual sin stock se rechaza (sólo las VENTAS pasan en negativo)');
    r = await api('POST', `/api/articulos/${E.id}/ajustar-stock`, { cantidad: 9, tipo: 'egreso', motivo: 'rotura' }, tokenAdmin);
    ok(rechazo(r, 'No hay stock suficiente'), 'tampoco un egreso manual mayor al stock');
    r = await api('POST', `/api/articulos/${E.id}/ajustar-stock`, { cantidad: -3, tipo: 'ajuste', motivo: null }, tokenAdmin);
    ok(rechazo(r, 'negativo'), 'un ajuste manual no puede dejar el stock en negativo');
    r = await api('POST', '/api/ventas', { articuloId: A.id, cantidad: 0, metodoPago: 'efectivo' }, tokenAdmin);
    ok(rechazo(r, 'mayor a cero'), 'cantidad cero se rechaza');
    r = await api('POST', '/api/ventas', { articuloId: A.id, cantidad: 1.5, metodoPago: 'efectivo' }, tokenAdmin);
    ok(rechazo(r, 'número entero'), 'media unidad de algo que se vende por unidad se rechaza');
    ok((await leer(A.id)).stock === -2, 'y los rechazos no tocaron el stock');

    log('\n[3] La lista "Para revisar" y el Panel');
    r = await api('GET', '/api/articulos?soloParaRevisar=true', undefined, tokenAdmin);
    const nombres = (r.data || []).map((a) => a.descripcion).sort();
    ok(JSON.stringify(nombres) === JSON.stringify(['ALFAJOR', 'BOMBON', 'QUESO']), `muestra sólo los vendidos sin stock (${nombres.join(', ')})`);
    r = await api('GET', '/api/articulos', undefined, tokenAdmin);
    ok(r.data.length === 5, 'la lista normal sigue mostrando todos');
    r = await api('GET', '/api/dashboard/stats', undefined, tokenAdmin);
    ok(r.data.paraRevisarCount === 3, 'el Panel cuenta 3 para revisar');
    ok(r.data.valorInventarioVenta === 6 * 100 + 4 * 100, 'el inventario no resta los negativos (sólo suma lo que sí hay: 6 + 4 unidades a $100)');

    log('\n[4] Anular una venta devuelve el stock');
    // El servidor corta los días en hora de Argentina (servidor.ts).
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    r = await api('GET', `/api/ventas/dia/${hoy}`, undefined, tokenAdmin);
    const ventaA = (r.data || []).find((v) => v.articuloId === A.id);
    r = await api('DELETE', `/api/ventas/${ventaA.id}`, undefined, tokenAdmin);
    ok(r.ok && (await leer(A.id)).stock === 0, 'al anular la venta del alfajor vuelve de -2 a 0');

    log('\n[5] El conteo de inventario');
    // A: 0 → 7, B: -2 → 0, C: -1.5 → 4.25, D: 6 (contado igual), E: 4 → 9
    r = await api(
      'POST',
      '/api/articulos/aplicar-conteo',
      { items: [{ articuloId: A.id, contado: 7 }, { articuloId: B.id, contado: 0 }, { articuloId: C.id, contado: 4.25 }, { articuloId: D.id, contado: 6 }, { articuloId: E.id, contado: 9 }] },
      tokenAdmin
    );
    ok(r.ok && r.data.corregidos === 4 && r.data.sinCambios === 1 && r.data.errores.length === 0, `corrige 4, uno ya estaba bien, sin errores (${JSON.stringify(r.data)})`);
    ok((await leer(A.id)).stock === 7 && (await leer(B.id)).stock === 0 && (await leer(C.id)).stock === 4.25 && (await leer(E.id)).stock === 9, 'cada producto quedó con lo que se contó');
    ok((await leer(D.id)).stock === 6, 'el que ya coincidía no se tocó');
    movs = await movimientos(B.id);
    ok(movs.some((m) => m.tipo === 'ajuste' && m.cantidad === 2 && /Conteo de inventario \(figuraba -2\)/.test(m.motivo || '')), 'queda anotado en su historial: ajuste de +2, "Conteo de inventario (figuraba -2)"');
    movs = await movimientos(D.id);
    ok(!movs.some((m) => m.tipo === 'ajuste'), 'al que no cambió no se le inventa un movimiento');
    r = await api('GET', '/api/articulos?soloParaRevisar=true', undefined, tokenAdmin);
    ok(r.data.length === 0, 'después de contar, ya no queda nada para revisar');
    r = await api('GET', '/api/dashboard/stats', undefined, tokenAdmin);
    ok(r.data.paraRevisarCount === 0, 'y el Panel marca 0');

    log('\n[6] El conteo rechaza lo que no corresponde, sin frenar lo demás');
    const F = await crear({ descripcion: 'FIDEOS', stock: 5, familiaId: rubro.id });
    const G = await crear({ descripcion: 'GALLETA', stock: 5, familiaId: rubro.id });
    const borrado = await crear({ descripcion: 'VIEJO', stock: 5 });
    await api('DELETE', `/api/articulos/${borrado.id}`, undefined, tokenAdmin);
    r = await api(
      'POST',
      '/api/articulos/aplicar-conteo',
      {
        items: [
          { articuloId: F.id, contado: 8 },
          { articuloId: G.id, contado: -1 },
          { articuloId: D.id, contado: 1.5 },
          { articuloId: E.id, contado: 'mucho' },
          { articuloId: borrado.id, contado: 3 },
          { articuloId: '000000000000000000000000', contado: 3 },
          { articuloId: 'esto-no-es-un-id', contado: 3 },
          { articuloId: F.id, contado: 99 },
        ],
      },
      tokenAdmin
    );
    ok(r.ok && r.data.corregidos === 1, 'el producto bueno se corrige igual');
    ok((await leer(F.id)).stock === 8, 'FIDEOS quedó en 8 (el segundo renglón repetido con 99 no lo pisó)');
    ok(r.data.errores.length === 7, `y los otros 7 renglones vuelven como error (${r.data.errores.length})`);
    const msj = (r.data.errores || []).map((e) => e.mensaje).join(' | ');
    ok(/igual o mayor a cero/.test(msj), 'avisa del número negativo o inválido');
    ok(/número entero/.test(msj), 'avisa que no se cuenta 1,5 de algo por unidad');
    ok(/papelera/.test(msj), 'avisa del producto que está en la papelera');
    ok(/ya no existe/.test(msj), 'avisa del producto que no existe');
    ok(/no es válido/.test(msj), 'avisa del código roto');
    ok(/repetido/.test(msj), 'avisa del producto repetido');
    ok((await leer(G.id)).stock === 5 && (await leer(D.id)).stock === 6 && (await leer(E.id)).stock === 9, 'ninguno de los rechazados cambió su stock');
    r = await api('POST', '/api/articulos/aplicar-conteo', { items: [] }, tokenAdmin);
    ok(rechazo(r, 'nada contado'), 'un conteo vacío se rechaza');
    r = await api('POST', '/api/articulos/aplicar-conteo', { items: Array.from({ length: 1001 }, () => ({ articuloId: F.id, contado: 1 })) }, tokenAdmin);
    ok(rechazo(r, 'hasta 1000'), 'más de 1000 productos por vez se rechaza');
    r = await api('POST', '/api/articulos/aplicar-conteo', {}, tokenAdmin);
    ok(r.ok === false, 'sin lista de productos se rechaza');
    r = await api('POST', '/api/articulos/aplicar-conteo', { items: [{ articuloId: F.id, contado: 1 }] });
    ok(r.ok === false, 'sin sesión no se puede contar');

    log('\n[7] Una empleada también cuenta y vende sin stock');
    r = await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, tokenAdmin);
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' });
    const tLucia = r.data.token;
    r = await api('POST', '/api/ventas', { articuloId: G.id, cantidad: 9, metodoPago: 'efectivo' }, tLucia);
    ok(r.ok && (await leer(G.id)).stock === -4, 'la empleada vende 9 con 5 registrados (queda en -4)');
    r = await api('POST', '/api/articulos/aplicar-conteo', { items: [{ articuloId: G.id, contado: 12 }] }, tLucia);
    ok(r.ok && r.data.corregidos === 1 && (await leer(G.id)).stock === 12, 'la empleada cuenta y corrige el stock');
    r = await api('GET', '/api/articulos?soloParaRevisar=true', undefined, tLucia);
    ok(r.ok && r.data.length === 0, 'y ya no queda nada para revisar');
    r = await api('GET', '/api/articulos', undefined, tLucia);
    ok(r.ok && r.data.length > 0 && r.data.every((a) => a.precioCosto === 0), 'ella ve los productos sin el costo (eso es sólo de la administradora)');

    log('\n[8] ¿Es un código de barras o una búsqueda por nombre?');
    ok(pareceCodigoDeBarras('7790001234567'), 'EAN-13');
    ok(pareceCodigoDeBarras('77900012'), 'EAN-8');
    ok(pareceCodigoDeBarras(' 7790001234567 '), 'con espacios alrededor');
    ok(!pareceCodigoDeBarras('alfajor'), '"alfajor" es una búsqueda');
    ok(!pareceCodigoDeBarras('1234'), 'un número corto es una búsqueda');
    ok(!pareceCodigoDeBarras('779000123456a'), 'con una letra no es un código');
    ok(!pareceCodigoDeBarras(''), 'vacío no');
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
