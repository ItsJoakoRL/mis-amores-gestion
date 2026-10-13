// Prueba de punta a punta de la sincronización entre PCs.
//
// Levanta DOS copias reales de la app (cada una con su base de prueba, su
// carpeta de datos y su puerto, sin ventana) y comprueba, hablándoles por la
// misma API que usan los celulares, que lo que se carga en una aparece en la
// otra, también cuando estuvieron un rato sin verse.
//
//   npm run build:electron
//   node scripts/probar-sync.js
//
// Usa las bases "test_sync_a" y "test_sync_b" del Mongo local: no toca la base
// real del negocio.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BSON, MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-sync-'));
const CLAVE = crypto.randomBytes(24).toString('hex');
// La pareja de la prueba de migración es otra red: otra clave.
const CLAVE_MIG = crypto.randomBytes(24).toString('hex');

const pcs = {
  A: { nombre: 'PC-A', puerto: 4101, db: 'test_sync_a', idPc: crypto.randomUUID(), token: null, proc: null },
  B: { nombre: 'PC-B', puerto: 4102, db: 'test_sync_b', idPc: crypto.randomUUID(), token: null, proc: null },
};
for (const pc of Object.values(pcs)) pc.carpeta = path.join(TMP, pc.nombre);

// Para la segunda parte (migración desde la versión 0.5.0): otras dos PCs.
const mig = {
  A: { nombre: 'PC-MA', puerto: 4111, db: 'test_sync_ma', idPc: crypto.randomUUID(), token: null, proc: null },
  B: { nombre: 'PC-MB', puerto: 4112, db: 'test_sync_mb', idPc: crypto.randomUUID(), token: null, proc: null },
};
for (const pc of Object.values(mig)) pc.carpeta = path.join(TMP, pc.nombre);

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

async function hasta(predicado, mensaje, ms = 20000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    try {
      ultimo = await predicado();
      if (ultimo) return ultimo;
    } catch (e) {
      ultimo = e;
    }
    await esperar(250);
  }
  throw new Error(`Se esperó y no pasó: ${mensaje} (${ultimo instanceof Error ? ultimo.message : JSON.stringify(ultimo)})`);
}

// ---------- vida de cada PC ----------

function escribirConfig(pc, extra = {}) {
  fs.mkdirSync(pc.carpeta, { recursive: true });
  const otro = pc === pcs.A ? pcs.B : pc === pcs.B ? pcs.A : pc === mig.A ? mig.B : mig.A;
  const config = {
    idPc: pc.idPc,
    claveRed: pc === mig.A || pc === mig.B ? CLAVE_MIG : CLAVE,
    pares: [{ idPc: otro.idPc, nombre: otro.nombre, direccion: `127.0.0.1:${otro.puerto}` }],
    inicial: 'listo',
    direccionAnterior: null,
    nombreAnterior: null,
    ...extra,
  };
  fs.writeFileSync(path.join(pc.carpeta, 'configuracion-pc.json'), JSON.stringify(config, null, 2));
}

async function iniciar(pc, { soloSiNoEsta = false } = {}) {
  if (pc.proc && soloSiNoEsta) return;
  // Si esta prueba corre desde un terminal de VS Code, hereda
  // ELECTRON_RUN_AS_NODE y Electron arrancaría como un Node común.
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;
  pc.proc = spawn(ELECTRON, ['.'], {
    cwd: RAIZ,
    env: {
      ...entorno,
      NODE_ENV: 'development',
      MIS_AMORES_SIN_VENTANA: '1',
      MIS_AMORES_CARPETA_DATOS: pc.carpeta,
      // Que los respaldos de las pruebas no vayan a "Documentos".
      MIS_AMORES_CARPETA_RESPALDOS: path.join(TMP, 'respaldos'),
      MIS_AMORES_PUERTO: String(pc.puerto),
      MIS_AMORES_PUERTOS_BUSQUEDA: [...Object.values(pcs), ...Object.values(mig)].map((p) => p.puerto).join(','),
      MONGODB_DB_NAME: pc.db,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  pc.proc.on('exit', () => {
    pc.proc = null;
  });
  await hasta(async () => {
    const r = await fetch(`http://127.0.0.1:${pc.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).ok;
  }, `que ${pc.nombre} arranque`, 60000);
  pc.token = null;
}

async function detener(pc) {
  if (!pc.proc) return;
  const pid = pc.proc.pid;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else pc.proc.kill('SIGKILL');
  pc.proc = null;
  // Se espera a que el puerto deje de contestar: si no, la PC todavía estaría
  // viva cuando la prueba cree que ya está apagada.
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    try {
      await fetch(`http://127.0.0.1:${pc.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(500) });
    } catch {
      await esperar(300);
      return;
    }
    await esperar(200);
  }
}

// ---------- la API de cada PC (la misma de los celulares) ----------

async function api(pc, metodo, ruta, cuerpo) {
  if (!pc.token && ruta !== '/api/auth/login') {
    const r = await api(pc, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
    pc.token = r.token;
  }
  const res = await fetch(`http://127.0.0.1:${pc.puerto}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(pc.token ? { Authorization: `Bearer ${pc.token}` } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${metodo} ${ruta}: ${json.error}`);
  return json.data;
}

const articulos = (pc, extra = '') => api(pc, 'GET', `/api/articulos?incluirInactivos=true${extra}`);
const porDescripcion = async (pc, d) => (await articulos(pc)).find((a) => a.descripcion === d);

function entradaArticulo(base) {
  return {
    codigoBarras: null,
    descripcion: 'X',
    marcaId: null,
    familiaId: null,
    proveedorId: null,
    precioCosto: 100,
    precioVenta: 150,
    precioLista2: 0,
    precioLista3: 0,
    utilidadPct: 50,
    stock: 10,
    stockMinimo: 1,
    stockIdeal: 5,
    unidad: 'unidad',
    imagenPath: null,
    nota: null,
    ...base,
  };
}

function aEntrada(a) {
  const { id, marcaNombre, familiaNombre, proveedorNombre, activo, creadoEn, actualizadoEn, ...resto } = a;
  return resto;
}

async function ventasDelDia(pc) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return api(pc, 'GET', `/api/ventas/dia/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

const { firmarPedido } = require(path.join(RAIZ, 'dist-electron/electron/sync/seguridad.js'));

// Pide a una PC su "resumen" firmando el pedido con la clave de la red (la
// clave misma no se manda).
async function resumenFirmado(puerto, clave, ruta = '/api/sync/resumen') {
  const f = firmarPedido(clave, 'GET', ruta);
  const res = await fetch(`http://127.0.0.1:${puerto}${ruta}`, { headers: f.cabeceras });
  return { res, texto: await res.text(), nonce: f.nonce, cabeceras: f.cabeceras };
}

async function resumen(pc) {
  // Las rutas de sincronización contestan en EJSON (conserva los tipos exactos).
  return BSON.EJSON.parse((await resumenFirmado(pc.puerto, CLAVE)).texto).data;
}

let ultimaDiferencia = '';
async function coinciden() {
  const [a, b] = await Promise.all([resumen(pcs.A), resumen(pcs.B)]);
  const distintas = Object.keys(a).filter((c) => a[c].huella !== b[c].huella || a[c].vivos !== b[c].vivos);
  ultimaDiferencia = distintas
    .map((c) => `${c}: A=${a[c].vivos}v/${a[c].borrados}b ${a[c].huella} | B=${b[c].vivos}v/${b[c].borrados}b ${b[c].huella}`)
    .join('; ');
  return distintas.length === 0;
}

// ---------- pruebas ----------

// Para entender una diferencia: muestra, de lo que no coincide, cómo está
// anotado en cada PC.
async function volcarDiferencias(pa = pcs.A, pb = pcs.B) {
  const c = new MongoClient(MONGO);
  await c.connect();
  try {
    const leer = async (pc) => {
      const mapa = new Map();
      for (const m of await c.db(pc.db).collection('_sync_meta').find().toArray()) mapa.set(m._id, m);
      return mapa;
    };
    const [a, b] = await Promise.all([leer(pa), leer(pb)]);
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(k);
      const y = b.get(k);
      const fa = x && { inc: x.inc, del: x.del, clocks: x.clocks, de: x.de };
      const fb = y && { inc: y.inc, del: y.del, clocks: y.clocks, de: y.de };
      const sx = JSON.stringify({ ...fa, de: undefined });
      const sy = JSON.stringify({ ...fb, de: undefined });
      if (sx !== sy) {
        log('   ≠', k);
        log('      A:', JSON.stringify(fa));
        log('      B:', JSON.stringify(fb));
      }
    }
  } finally {
    await c.close();
  }
}

async function limpiarBases() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const pc of [...Object.values(pcs), ...Object.values(mig)]) await c.db(pc.db).dropDatabase();
  await c.close();
}

async function main() {
  log(`\nCarpeta temporal: ${TMP}`);
  await limpiarBases();

  // ---- 0. Piezas sueltas ----
  log('\n[0] Reloj y reglas de combinación');
  const { Reloj, formatearMarca } = require(path.join(RAIZ, 'dist-electron/electron/sync/reloj.js'));
  const { decidir } = require(path.join(RAIZ, 'dist-electron/electron/sync/aplicar.js'));
  const r1 = new Reloj('a', () => 1000);
  const m1 = r1.nueva();
  const m2 = r1.nueva();
  ok(m2 > m1, 'el reloj nunca repite ni retrocede dentro de un mismo milisegundo');
  const r2 = new Reloj('b', () => 500); // reloj atrasado
  r2.ver(formatearMarca(5000, 0, 'a'));
  ok(r2.nueva() > formatearMarca(5000, 0, 'a'), 'una edición hecha después de ver un cambio ajeno queda por encima, aunque el reloj vaya atrasado');
  ok(decidir(null, false, { inc: 0, del: null, clocks: { x: '1' }, doc: { x: 1 } }).accion === 'reemplazar', 'documento nuevo: se agrega');
  const dec = decidir({ inc: 0, del: null, clocks: { a: '5', b: '2' } }, true, { inc: 0, del: null, clocks: { a: '3', b: '9' }, doc: { a: 'viejo', b: 'nuevo' } });
  ok(dec.accion === 'combinar' && dec.set.b === 'nuevo' && !('a' in dec.set), 'dos cambios al mismo documento se combinan campo por campo');
  ok(decidir({ inc: 0, del: '9', clocks: {} }, false, { inc: 0, del: null, clocks: { a: '99' }, doc: { a: 1 } }).accion === 'nada', 'un documento borrado no resucita con una edición');
  ok(decidir({ inc: 0, del: '9', clocks: {} }, false, { inc: 1, del: null, clocks: { a: '99' }, doc: { a: 1 } }).accion === 'reemplazar', 'salvo que se haya vuelto a crear (otra "vida")');

  // ---- 1. Una PC sola con datos de antes ----
  log('\n[1] PC-A arranca con datos propios');
  escribirConfig(pcs.A, { pares: [] });
  await iniciar(pcs.A);
  const rubro = await api(pcs.A, 'POST', '/api/familias', { nombre: 'GOLOSINAS' });
  const marca = await api(pcs.A, 'POST', '/api/marcas', { nombre: 'ARCOR' });
  const alfajor = await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR', codigoBarras: '7790001', familiaId: rubro.id, marcaId: marca.id, stock: 20 }));
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CHICLE', codigoBarras: '7790002', familiaId: rubro.id, stock: 5 }));
  const cliente = await api(pcs.A, 'POST', '/api/clientes', { nombre: 'JUAN PEREZ', nota: null, deudaInicial: 500 });
  await api(pcs.A, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'efectivo' });
  await api(pcs.A, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 1, metodoPago: 'fiado', clienteId: cliente.id });
  ok((await porDescripcion(pcs.A, 'ALFAJOR')).stock === 17, 'PC-A: el stock del alfajor es 17 (20 - 2 - 1)');

  // ---- 2. PC-B es nueva y trae todo ----
  log('\n[2] PC-B arranca vacía y trae los datos de PC-A');
  escribirConfig(pcs.B, { inicial: 'traer' });
  await iniciar(pcs.B);
  const alfB = await hasta(async () => porDescripcion(pcs.B, 'ALFAJOR'), 'que PC-B tenga el alfajor');
  ok(alfB.stock === 17, 'PC-B: mismo stock (17), calculado desde los movimientos');
  ok((await articulos(pcs.B)).length === (await articulos(pcs.A)).length, 'PC-B: misma cantidad de productos');
  ok((await ventasDelDia(pcs.B)).length === 2, 'PC-B: las 2 ventas');
  const clB = (await api(pcs.B, 'GET', '/api/clientes')).find((c) => c.nombre === 'JUAN PEREZ');
  ok(clB && clB.saldo === alfajor.precioVenta + 500, `PC-B: el cliente debe lo mismo (${clB && clB.saldo})`);
  ok((await api(pcs.B, 'GET', '/api/familias')).filter((f) => f.nombre === 'GOLOSINAS').length === 1, 'PC-B: un solo rubro GOLOSINAS');
  await hasta(coinciden, 'que las dos PCs coincidan');
  ok(true, 'las dos PCs tienen el mismo "resumen" de datos');

  // ---- 3. En vivo ----
  log('\n[3] Cambios en vivo');
  const t0 = Date.now();
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'GALLETITAS', stock: 8 }));
  await hasta(async () => porDescripcion(pcs.B, 'GALLETITAS'), 'que PC-B vea las galletitas');
  const ms = Date.now() - t0;
  ok(ms < 5000, `un producto nuevo en A aparece en B (${ms} ms)`);

  const galB = await porDescripcion(pcs.B, 'GALLETITAS');
  await api(pcs.B, 'PUT', `/api/articulos/${galB.id}`, { input: { ...aEntrada(galB), precioVenta: 999 }, original: aEntrada(galB) });
  await hasta(async () => (await porDescripcion(pcs.A, 'GALLETITAS')).precioVenta === 999, 'que A vea el precio nuevo');
  ok(true, 'un cambio de precio en B llega a A');

  // Dos PCs venden lo mismo a la vez: las dos tienen que descontar.
  const alf = await porDescripcion(pcs.A, 'ALFAJOR');
  await Promise.all([
    api(pcs.A, 'POST', '/api/ventas', { articuloId: alf.id, cantidad: 3, metodoPago: 'efectivo' }),
    api(pcs.B, 'POST', '/api/ventas', { articuloId: alf.id, cantidad: 4, metodoPago: 'efectivo' }),
  ]);
  await hasta(async () => {
    const [a, b] = await Promise.all([porDescripcion(pcs.A, 'ALFAJOR'), porDescripcion(pcs.B, 'ALFAJOR')]);
    return a.stock === 10 && b.stock === 10;
  }, 'que el stock quede en 10 en las dos (17 - 3 - 4)');
  ok(true, 'ventas simultáneas en las dos PCs: el stock queda en 10 en ambas');

  // ---- 4. Una PC apagada se pone al día ----
  log('\n[4] PC-B apagada un rato, y vuelve');
  await detener(pcs.B);
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CARAMELOS', stock: 50 }));
  const chicleA = await porDescripcion(pcs.A, 'CHICLE');
  await api(pcs.A, 'POST', '/api/ventas', { articuloId: chicleA.id, cantidad: 2, metodoPago: 'tarjeta' });
  await iniciar(pcs.B);
  await hasta(async () => (await porDescripcion(pcs.B, 'CARAMELOS')) && (await porDescripcion(pcs.B, 'CHICLE')).stock === 3, 'que B se ponga al día');
  ok(true, 'al volver, PC-B recibe lo que se cargó mientras estaba apagada');

  // ---- 5. Editar campos distintos del mismo producto sin verse ----
  log('\n[5] Mismo producto, campos distintos, sin verse');
  await detener(pcs.B);
  const galA = await porDescripcion(pcs.A, 'GALLETITAS');
  await api(pcs.A, 'PUT', `/api/articulos/${galA.id}`, { input: { ...aEntrada(galA), nota: 'nota desde A' }, original: aEntrada(galA) });
  await detener(pcs.A);
  await iniciar(pcs.B);
  const galB2 = await porDescripcion(pcs.B, 'GALLETITAS');
  await api(pcs.B, 'PUT', `/api/articulos/${galB2.id}`, { input: { ...aEntrada(galB2), precioVenta: 1234 }, original: aEntrada(galB2) });
  await iniciar(pcs.A);
  await hasta(async () => {
    const [a, b] = await Promise.all([porDescripcion(pcs.A, 'GALLETITAS'), porDescripcion(pcs.B, 'GALLETITAS')]);
    return a.nota === 'nota desde A' && a.precioVenta === 1234 && b.nota === 'nota desde A' && b.precioVenta === 1234;
  }, 'que se combinen los dos cambios');
  ok(true, 'la nota (hecha en A) y el precio (hecho en B) quedaron los dos, en las dos PCs');

  // ---- 6. Borrado ----
  log('\n[6] Una venta anulada no resucita');
  const ventas = await ventasDelDia(pcs.A);
  const aAnular = ventas.find((v) => v.metodoPago === 'tarjeta');
  await detener(pcs.B);
  await api(pcs.A, 'DELETE', `/api/ventas/${aAnular.id}`);
  await iniciar(pcs.B);
  await hasta(async () => !(await ventasDelDia(pcs.B)).some((v) => v.id === aAnular.id), 'que B también la anule');
  await hasta(async () => (await porDescripcion(pcs.B, 'CHICLE')).stock === 5, 'que el stock vuelva a 5 en B');
  ok(true, 'la venta anulada en A desaparece de B y el stock se repone');

  // ---- 7. Lo mismo cargado en las dos PCs sin verse ----
  log('\n[7] El mismo rubro, cliente y código cargados a la vez en las dos PCs');
  await detener(pcs.B);
  const rubroA = await api(pcs.A, 'POST', '/api/familias', { nombre: 'BEBIDAS FRIAS' });
  const maria = await api(pcs.A, 'POST', '/api/clientes', { nombre: 'MARIA LOPEZ', nota: null, deudaInicial: 100 });
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'AGUA A', codigoBarras: '7799999', familiaId: rubroA.id, stock: 10 }));
  await detener(pcs.A);
  await iniciar(pcs.B);
  const rubroB = await api(pcs.B, 'POST', '/api/familias', { nombre: 'BEBIDAS FRIAS' });
  const mariaB = await api(pcs.B, 'POST', '/api/clientes', { nombre: 'MARIA LOPEZ', nota: null, deudaInicial: 40 });
  await api(pcs.B, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'AGUA B', codigoBarras: '7799999', familiaId: rubroB.id, stock: 7 }));
  ok(rubroA.id !== rubroB.id && maria.id !== mariaB.id, '(cada PC los creó con identificadores distintos)');
  await iniciar(pcs.A);
  await hasta(async () => {
    const fa = (await api(pcs.A, 'GET', '/api/familias')).filter((f) => f.nombre === 'BEBIDAS FRIAS');
    const fb = (await api(pcs.B, 'GET', '/api/familias')).filter((f) => f.nombre === 'BEBIDAS FRIAS');
    return fa.length === 1 && fb.length === 1 && fa[0].id === fb[0].id;
  }, 'que el rubro quede unificado');
  ok(true, 'el rubro repetido quedó unificado en las dos PCs');
  await hasta(async () => {
    const ca = (await api(pcs.A, 'GET', '/api/clientes')).filter((c) => c.nombre === 'MARIA LOPEZ');
    const cb = (await api(pcs.B, 'GET', '/api/clientes')).filter((c) => c.nombre === 'MARIA LOPEZ');
    return ca.length === 1 && cb.length === 1 && ca[0].id === cb[0].id && ca[0].saldo === 140 && cb[0].saldo === 140;
  }, 'que el cliente quede unificado con las deudas sumadas');
  ok(true, 'el cliente repetido quedó en uno solo con las dos deudas sumadas (140)');
  await hasta(async () => {
    const aa = (await articulos(pcs.A)).filter((a) => a.descripcion.startsWith('AGUA'));
    const ab = (await articulos(pcs.B)).filter((a) => a.descripcion.startsWith('AGUA'));
    const conCodigo = (l) => l.filter((a) => a.codigoBarras === '7799999').length;
    return aa.length === 2 && ab.length === 2 && conCodigo(aa) === 1 && conCodigo(ab) === 1;
  }, 'que un solo producto se quede con el código de barras');
  ok(true, 'con el mismo código de barras: los dos productos siguen, y uno solo conserva el código');
  const aguaA = (await articulos(pcs.A)).filter((a) => a.descripcion.startsWith('AGUA'));
  ok(aguaA.every((a) => a.familiaId === aguaA[0].familiaId), 'los dos productos apuntan al mismo rubro unificado');
  await hasta(async () => (await api(pcs.A, 'GET', '/api/familias')).length === (await api(pcs.B, 'GET', '/api/familias')).length, 'mismos rubros');

  // ---- 8. Resultado final ----
  log('\n[8] Las dos PCs terminan con exactamente lo mismo');
  await hasta(coinciden, 'que el resumen coincida', 30000);
  ok(true, 'el "resumen" de datos de las dos PCs es idéntico');
  const [la, lb] = await Promise.all([articulos(pcs.A), articulos(pcs.B)]);
  const firma = (l) => l.map((a) => `${a.descripcion}|${a.stock}|${a.precioVenta}|${a.codigoBarras}|${a.activo}`).sort().join('\n');
  ok(firma(la) === firma(lb), `los ${la.length} productos son idénticos (descripción, stock, precio, código)`);

  // ---- 9. Fotos ----
  log('\n[9] Las fotos de los productos viajan');
  const carpetaFotosA = path.join(pcs.A.carpeta, 'data', 'imagenes');
  fs.mkdirSync(carpetaFotosA, { recursive: true });
  const fotoA = path.join(carpetaFotosA, 'foto-prueba.png');
  fs.writeFileSync(fotoA, Buffer.from('imagen-de-prueba-' + 'x'.repeat(2000)));
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CON FOTO', imagenPath: fotoA }));
  const conFotoB = await hasta(async () => porDescripcion(pcs.B, 'CON FOTO'), 'que B tenga el producto con foto');
  const fotoB = path.join(pcs.B.carpeta, 'data', 'imagenes', 'foto-prueba.png');
  ok(conFotoB.imagenPath === fotoB, `en B la ruta apunta a la carpeta de B (${conFotoB.imagenPath})`);
  await hasta(async () => fs.existsSync(fotoB) && fs.statSync(fotoB).size === fs.statSync(fotoA).size, 'que la foto se copie a B');
  ok(true, 'el archivo de la foto se copió al disco de B');

  // ---- 10. Entrar a la red con la cuenta de administradora ----
  log('\n[10] Sumarse a la red con cuenta de administradora');
  const sinSesion = await fetch(`http://127.0.0.1:${pcs.A.puerto}/api/sync/unirse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idPc: crypto.randomUUID(), nombrePc: 'INTRUSA', puerto: 4999 }),
  }).then((r) => r.json());
  ok(sinSesion.ok === false, 'sin sesión de administradora no deja sumarse');
  const sinClave = await fetch(`http://127.0.0.1:${pcs.A.puerto}/api/sync/cambios?desde=0`).then((r) => r.status);
  ok(sinClave === 401, 'sin la clave de la red no entrega ningún dato (401)');
  const idNueva = crypto.randomUUID();
  const union = await api(pcs.A, 'POST', '/api/sync/unirse', { idPc: idNueva, nombrePc: 'PC-NUEVA', puerto: 4999 });
  ok(union.claveRed === CLAVE && union.idPc === pcs.A.idPc, 'la administradora recibe la clave y los datos de la red');

  // ---- 11. Unir datos de una PC vieja (sin "stock inicial") ----
  log('\n[11] Juntar datos de una PC vieja: el stock sigue cerrando');
  const { ObjectId } = require('mongodb');
  const viejoId = new ObjectId();
  const movId = new ObjectId();
  const datos = {
    nombrePc: 'PC-VIEJA',
    imagenes: [],
    colecciones: {
      articulos: BSON.EJSON.stringify([
        { _id: viejoId, descripcion: 'PRODUCTO VIEJO', codigoBarras: '7700000', precioCosto: 10, precioVenta: 20, precioLista2: 0, precioLista3: 0,
          utilidadPct: 100, stock: 7, stockMinimo: 0, stockIdeal: 0, unidad: 'unidad', imagenPath: null, nota: null,
          activo: true, creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString(), familiaId: null, marcaId: null, proveedorId: null },
      ]),
      movimientos_stock: BSON.EJSON.stringify([
        { _id: movId, articuloId: viejoId, tipo: 'ingreso', cantidad: 2, stockResultante: 7, motivo: 'x', usuarioId: new ObjectId(), fecha: new Date().toISOString() },
      ]),
    },
  };
  await api(pcs.A, 'POST', '/api/sistema/juntar-datos', { datos, simular: false });
  const viejoA = await hasta(async () => porDescripcion(pcs.A, 'PRODUCTO VIEJO'), 'que A tenga el producto viejo');
  ok(viejoA.stock === 7, 'el producto de la PC vieja entra con su stock (7)');
  const viejoB = await hasta(async () => {
    const x = await porDescripcion(pcs.B, 'PRODUCTO VIEJO');
    return x && x.stock === 7 ? x : null;
  }, 'que B tenga el producto viejo con stock 7');
  ok(!!viejoB, 'y llega a la otra PC con el mismo stock');
  await api(pcs.B, 'POST', '/api/ventas', { articuloId: viejoB.id, cantidad: 3, metodoPago: 'efectivo' });
  await hasta(async () => (await porDescripcion(pcs.A, 'PRODUCTO VIEJO')).stock === 4, 'que A baje a 4');
  ok(true, 'una venta de ese producto en B baja el stock a 4 en las dos (7 - 3)');
}

async function migracion() {
  // Una PC "principal" de la versión 0.5.0 (con datos, sin diario) y una "conectada".
  log('\n[12] Migración desde la versión anterior (principal con datos + PC conectada)');
  const { ObjectId } = require('mongodb');
  const c = new MongoClient(MONGO);
  await c.connect();
  const db = c.db(mig.A.db);
  const ahora = new Date().toISOString();
  const rubros = Array.from({ length: 5 }, (_, i) => ({ _id: new ObjectId(), nombre: `RUBRO ${i}` }));
  await db.collection('familias').insertMany(rubros);
  const usuarioId = new ObjectId();
  await db.collection('usuarios').insertOne({
    _id: usuarioId, nombre: 'Daniela', usuario: 'admin', passwordHash: require('bcryptjs').hashSync('admin123', 4),
    rol: 'admin', genero: 'F', activo: true, creadoEn: ahora,
  });
  const NUM = 3000;
  const lote = [];
  const movs = [];
  for (let i = 0; i < NUM; i++) {
    const id = new ObjectId();
    // El stock de antes NO es "inicial + movimientos": hay que reconstruirlo.
    lote.push({
      _id: id, codigoBarras: `78${String(i).padStart(10, '0')}`, descripcion: `PRODUCTO ${String(i).padStart(4, '0')}`,
      marcaId: null, familiaId: rubros[i % 5]._id, proveedorId: null, precioCosto: 100 + i, precioVenta: 150 + i, precioLista2: 0, precioLista3: 0,
      utilidadPct: 50, stock: i % 20, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null,
      activo: true, creadoEn: ahora, actualizadoEn: ahora,
    });
    if (i % 100 === 0) movs.push({ _id: new ObjectId(), articuloId: id, tipo: 'ingreso', cantidad: 3, stockResultante: i % 20, motivo: 'x', usuarioId, fecha: ahora });
  }
  await db.collection('articulos').insertMany(lote);
  await db.collection('movimientos_stock').insertMany(movs);
  await db.collection('ajustes_sistema').insertOne({ _id: 'copia', clave: CLAVE_MIG });
  await c.close();

  // PC-MA arranca sin configuración de red (como la principal de antes).
  fs.mkdirSync(mig.A.carpeta, { recursive: true });
  fs.writeFileSync(path.join(mig.A.carpeta, 'configuracion-pc.json'), JSON.stringify({ idPc: mig.A.idPc, modo: 'principal', direccionPrincipal: null, generacion: 0 }));
  // PC-MB tiene el formato de la "conectada" de la versión 0.5.0.
  fs.mkdirSync(mig.B.carpeta, { recursive: true });
  fs.writeFileSync(
    path.join(mig.B.carpeta, 'configuracion-pc.json'),
    JSON.stringify({ idPc: mig.B.idPc, modo: 'conectada', direccionPrincipal: `127.0.0.1:${mig.A.puerto}`, idPrincipal: mig.A.idPc,
      nombrePrincipal: 'PC-MA', claveCopia: CLAVE_MIG, generacion: 0 })
  );
  const t0 = Date.now();
  await iniciar(mig.A);
  log(`   (PC-MA arrancó y anotó ${NUM} productos en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const listaA = await api(mig.A, 'GET', '/api/articulos?incluirInactivos=true');
  const p0 = listaA.find((a) => a.descripcion === 'PRODUCTO 0000');
  const p7 = listaA.find((a) => a.descripcion === 'PRODUCTO 0007');
  ok(listaA.length === NUM, `PC-MA conserva sus ${NUM} productos`);
  ok(p0.stock === 0 && p7.stock === 7, 'el stock de antes quedó igual (el "stock inicial" se reconstruye sin moverlo)');

  const t1 = Date.now();
  await iniciar(mig.B);
  const listaB = await hasta(async () => {
    const l = await api(mig.B, 'GET', '/api/articulos?incluirInactivos=true');
    return l.length === NUM ? l : null;
  }, `que PC-MB traiga los ${NUM} productos`, 90000);
  log(`   (PC-MB trajo todo en ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  ok(listaB.length === NUM, `PC-MB (la que estaba "conectada") trae los ${NUM} productos`);
  const b7 = listaB.find((a) => a.descripcion === 'PRODUCTO 0007');
  const stockEnA = new Map(listaA.map((a) => [a.id, a.stock]));
  ok(listaB.every((a) => stockEnA.get(a.id) === a.stock), `los ${NUM} productos tienen el mismo stock en las dos PCs`);
  ok((await api(mig.B, 'GET', '/api/familias')).length === 5, 'los 5 rubros');
  const sesionB = await api(mig.B, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
  ok(sesionB.nombre === 'Daniela', 'se puede entrar a PC-MB con la cuenta de la principal');
  await hasta(async () => {
    const [a, b] = await Promise.all([resumenDe(mig.A), resumenDe(mig.B)]);
    return Object.keys(a).every((k) => a[k].huella === b[k].huella);
  }, 'que el resumen de las dos coincida', 60000);
  ok(true, 'las dos PCs migradas coinciden en todo');

  // Y ahora funcionan en vivo.
  await api(mig.B, 'POST', '/api/ventas', { articuloId: b7.id, cantidad: 2, metodoPago: 'efectivo' });
  await hasta(async () => (await api(mig.A, 'GET', `/api/articulos/${b7.id}`)).stock === 5, 'que A vea la venta de B');
  ok(true, 'una venta hecha en la PC que antes era "conectada" aparece en la que era la principal (stock 7 -> 5)');
}

async function resumenDe(pc) {
  return BSON.EJSON.parse((await resumenFirmado(pc.puerto, CLAVE_MIG)).texto).data;
}

async function copiaGuardada() {
  // La PC conectada arranca con la otra PC apagada y una copia guardada de la
  // versión 0.5.0. La copia está VIEJA (un producto con el precio de antes):
  // cuando la otra PC vuelve, tiene que ganar lo de la otra PC, no la copia.
  log('\n[13] La otra PC está apagada: se usa la última copia guardada (y después gana lo de la otra PC)');
  const { ObjectId } = require('mongodb');
  const real = (await api(mig.A, 'GET', '/api/articulos?incluirInactivos=true')).find((a) => a.descripcion === 'PRODUCTO 0010');
  await detener(mig.B);
  await detener(mig.A);
  const carpeta = path.join(mig.B.carpeta, 'copia-principal');
  fs.rmSync(carpeta, { recursive: true, force: true });
  fs.mkdirSync(path.join(carpeta, 'imagenes'), { recursive: true });
  const base = {
    activo: true, precioCosto: 5, unidad: 'unidad', precioLista2: 0, precioLista3: 0, utilidadPct: 100, stockMinimo: 0, stockIdeal: 0,
    imagenPath: null, nota: null, marcaId: null, familiaId: null, proveedorId: null,
    creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString(),
  };
  const propio = { _id: new ObjectId(), descripcion: 'DE LA COPIA', codigoBarras: '7811111', stock: 9, precioVenta: 10, ...base };
  // Mismo producto que tiene la otra PC, pero con el precio de cuando se hizo la copia.
  const viejo = { _id: new ObjectId(real.id), descripcion: 'PRODUCTO 0010', codigoBarras: real.codigoBarras, stock: real.stock, precioVenta: 1, ...base };
  fs.writeFileSync(path.join(carpeta, 'articulos.json'), BSON.EJSON.stringify([propio, viejo], { relaxed: false }));
  fs.writeFileSync(path.join(carpeta, 'usuarios.json'), BSON.EJSON.stringify([
    { _id: new ObjectId(), nombre: 'Daniela', usuario: 'admin', passwordHash: require('bcryptjs').hashSync('admin123', 4), rol: 'admin', genero: 'F', activo: true },
  ], { relaxed: false }));
  fs.writeFileSync(path.join(carpeta, 'meta.json'), JSON.stringify({
    version: 'x', fecha: new Date().toISOString(), idPrincipal: mig.A.idPc, nombrePrincipal: 'PC-MA', generacion: 0,
    direccion: `127.0.0.1:${mig.A.puerto}`, resumen: { articulos: 2, clientes: 0, ventas: 0 },
  }));
  // Formato de la "conectada" de antes, apuntando a la PC que está apagada.
  fs.writeFileSync(path.join(mig.B.carpeta, 'configuracion-pc.json'), JSON.stringify({
    idPc: mig.B.idPc, modo: 'conectada', direccionPrincipal: `127.0.0.1:${mig.A.puerto}`, idPrincipal: mig.A.idPc,
    nombrePrincipal: 'PC-MA', claveCopia: CLAVE_MIG, generacion: 0 }));
  const t = Date.now();
  await iniciar(mig.B);
  log(`   (arrancó en ${((Date.now() - t) / 1000).toFixed(1)} s, esperando a la otra PC)`);
  const lista = await api(mig.B, 'GET', '/api/articulos?incluirInactivos=true');
  ok(lista.length === 2 && lista.some((a) => a.descripcion === 'DE LA COPIA' && a.stock === 9), 'se cargó la copia guardada (2 productos)');
  ok(lista.find((a) => a.descripcion === 'PRODUCTO 0010').precioVenta === 1, 'y trae el precio viejo del producto (1)');

  // La otra PC vuelve a prenderse.
  await iniciar(mig.A);
  await hasta(async () => {
    const x = (await api(mig.B, 'GET', '/api/articulos?incluirInactivos=true')).find((a) => a.descripcion === 'PRODUCTO 0010');
    return x && x.precioVenta === real.precioVenta;
  }, 'que el precio real le gane al de la copia', 120000);
  ok(true, `el precio real (${real.precioVenta}) le gana al de la copia (1) en PC-MB`);
  const enA = (await api(mig.A, 'GET', '/api/articulos?incluirInactivos=true')).find((a) => a.descripcion === 'PRODUCTO 0010');
  ok(enA.precioVenta === real.precioVenta, 'y PC-MA no se contaminó con el precio viejo de la copia');
  await hasta(async () => (await api(mig.A, 'GET', '/api/articulos?incluirInactivos=true')).some((a) => a.descripcion === 'DE LA COPIA'), 'que A reciba lo nuevo de B');
  ok(true, 'lo que sólo estaba en la copia llega a la otra PC');
  try {
    await hasta(async () => {
      const [a, b] = await Promise.all([resumenDe(mig.A), resumenDe(mig.B)]);
      return Object.keys(a).every((k) => a[k].huella === b[k].huella);
    }, 'que el resumen coincida', 40000);
    ok(true, 'y las dos terminan iguales');
  } catch (err) {
    ok(false, `las dos terminan iguales (${err.message})`);
    await volcarDiferencias(mig.A, mig.B);
  }
}

async function extras() {
  // Los escenarios que no entraron en la primera tanda: las dos PCs (A y B)
  // vienen andando de antes.
  const login = async (pc, usuario, password) => {
    const r = await fetch(`http://127.0.0.1:${pc.puerto}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    return (await r.json()).ok === true;
  };
  const stockDe = async (pc, d) => (await porDescripcion(pc, d))?.stock;

  // ---- 14. La misma venta anulada en las dos PCs sin verse ----
  log('\n[14] La misma venta anulada en las dos PCs a la vez, sin verse');
  const p1 = await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'PARA ANULAR', stock: 10 }));
  await hasta(async () => porDescripcion(pcs.B, 'PARA ANULAR'), 'que B tenga el producto');
  const venta = await api(pcs.A, 'POST', '/api/ventas', { articuloId: p1.id, cantidad: 2, metodoPago: 'efectivo' });
  await hasta(async () => (await stockDe(pcs.B, 'PARA ANULAR')) === 8, 'que B vea la venta (stock 8)');
  await detener(pcs.B);
  await api(pcs.A, 'DELETE', `/api/ventas/${venta.id}`); // A: stock 10
  await detener(pcs.A);
  await iniciar(pcs.B);
  await api(pcs.B, 'DELETE', `/api/ventas/${venta.id}`); // B: stock 10, sin enterarse de lo de A
  ok((await stockDe(pcs.B, 'PARA ANULAR')) === 10, '(cada PC repuso el stock por su lado: 10)');
  await iniciar(pcs.A);
  await hasta(coinciden, 'que las dos coincidan', 40000);
  await esperar(1500);
  const [sa, sb] = [await stockDe(pcs.A, 'PARA ANULAR'), await stockDe(pcs.B, 'PARA ANULAR')];
  ok(sa === 10 && sb === 10, `al juntarse, el stock se repone UNA sola vez (A=${sa}, B=${sb})`);
  const movs = await api(pcs.A, 'GET', `/api/articulos/${p1.id}/movimientos-stock`);
  ok(movs.filter((m) => m.motivo === 'Venta anulada').length === 1, 'y queda un solo movimiento de "Venta anulada"');

  // ---- 15. Borrado definitivo ----
  log('\n[15] Borrado definitivo de un producto');
  const p2 = await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'PARA BORRAR', stock: 4 }));
  await hasta(async () => porDescripcion(pcs.B, 'PARA BORRAR'), 'que B lo tenga');
  await api(pcs.A, 'POST', '/api/ventas', { articuloId: p2.id, cantidad: 1, metodoPago: 'efectivo' });
  await hasta(async () => (await stockDe(pcs.B, 'PARA BORRAR')) === 3, 'que B vea el stock 3');
  await api(pcs.A, 'DELETE', `/api/articulos/${p2.id}`);
  await hasta(async () => (await porDescripcion(pcs.B, 'PARA BORRAR'))?.activo === false, 'que B lo vea en la papelera');
  ok(true, 'dar de baja un producto en A lo manda a la papelera de B');
  await api(pcs.A, 'POST', '/api/articulos/eliminar-definitivo', { ids: [p2.id] });
  await hasta(async () => !(await porDescripcion(pcs.B, 'PARA BORRAR')), 'que B ya no lo tenga');
  ok((await api(pcs.B, 'GET', `/api/articulos/${p2.id}/movimientos-stock`)).length === 0, 'el borrado definitivo también se lleva sus movimientos en B');
  await hasta(coinciden, 'que coincidan tras el borrado', 30000);
  ok(true, 'las dos PCs siguen idénticas');

  // ---- 16. Usuarios ----
  log('\n[16] Usuarios y contraseñas');
  await api(pcs.A, 'POST', '/api/usuarios', { nombre: 'Maria', usuario: 'maria', password: 'clave123', rol: 'empleado', genero: 'F' });
  await hasta(async () => login(pcs.B, 'maria', 'clave123'), 'que maria pueda entrar en B');
  ok(true, 'una cuenta creada en A sirve para entrar en B');
  const mariaB = (await api(pcs.B, 'GET', '/api/usuarios')).find((u) => u.usuario === 'maria');
  await api(pcs.B, 'POST', `/api/usuarios/${mariaB.id}/reset-password`, { password: 'nueva456' });
  await hasta(async () => login(pcs.A, 'maria', 'nueva456'), 'que la clave nueva valga en A');
  ok(!(await login(pcs.A, 'maria', 'clave123')), 'cambiar la contraseña en B la cambia en A (la vieja ya no entra)');
  await api(pcs.A, 'POST', `/api/usuarios/${mariaB.id}/activo`, { activo: false });
  await hasta(async () => !(await login(pcs.B, 'maria', 'nueva456')), 'que B también la bloquee');
  ok(true, 'dar de baja una cuenta en A la bloquea en B');

  // ---- 17. Una PC cambia de dirección ----
  log('\n[17] Una PC cambia de dirección en la red');
  await detener(pcs.B);
  escribirConfig(pcs.B, { pares: [{ idPc: pcs.A.idPc, nombre: 'PC-A', direccion: '127.0.0.1:9' }] });
  await iniciar(pcs.B);
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'DESPUES DEL CAMBIO', stock: 3 }));
  await hasta(async () => porDescripcion(pcs.B, 'DESPUES DEL CAMBIO'), 'que B encuentre a A en su nueva dirección', 90000);
  ok(true, 'B encontró a A por su identificador aunque la dirección guardada ya no servía');
  await hasta(coinciden, 'que coincidan al final', 30000);
  ok(true, 'y las dos terminan iguales');

  // ---- 18. Seguridad ----
  log('\n[18] La clave de la red no viaja y no se le cree a cualquiera');
  const bueno = await resumenFirmado(pcs.A.puerto, CLAVE);
  ok(bueno.res.status === 200 && !!bueno.res.headers.get('x-red-prueba'), 'un pedido firmado con la clave correcta se contesta, y la respuesta trae la prueba');
  ok(!JSON.stringify(bueno.cabeceras).includes(CLAVE), 'la clave no va en el pedido (sólo la firma)');
  // El mismo pedido repetido (alguien lo capturó) no vale.
  const repetido = await fetch(`http://127.0.0.1:${pcs.A.puerto}/api/sync/resumen`, { headers: bueno.cabeceras });
  ok(repetido.status === 401, 'repetir un pedido ya hecho no funciona (401)');
  const otraClave = await resumenFirmado(pcs.A.puerto, 'x'.repeat(48));
  ok(otraClave.res.status === 401, 'firmar con otra clave no funciona (401)');
  const otraRuta = await fetch(`http://127.0.0.1:${pcs.A.puerto}/api/sync/cambios?desde=0`, { headers: bueno.cabeceras });
  ok(otraRuta.status === 401, 'una firma no sirve para pedir otra cosa (401)');

  // Un aparato cualquiera en la red que se hace pasar por una PC del negocio.
  const visto = { cabeceras: [], pedidos: 0 };
  const falso = require('http').createServer((req, res) => {
    visto.pedidos += 1;
    visto.cabeceras.push(JSON.stringify(req.headers) + req.url);
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        data: {
          idPc: 'impostor-id', epoca: 'x', hasta: 1, maxSeq: 1, idRed: 'x', nombrePc: 'IMPOSTOR', pares: [],
          items: [
            { c: 'articulos', id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, seq: 1, inc: 0, del: null,
              clocks: { descripcion: '999999999999999-0000-z' }, doc: { descripcion: 'HACKEADO', activo: true, stockBase: 5 } },
          ],
        },
      })
    );
  });
  await new Promise((r) => falso.listen(4998, '127.0.0.1', r));
  await detener(pcs.B);
  escribirConfig(pcs.B, {
    pares: [
      { idPc: pcs.A.idPc, nombre: 'PC-A', direccion: `127.0.0.1:${pcs.A.puerto}` },
      { idPc: 'impostor-id', nombre: 'IMPOSTOR', direccion: '127.0.0.1:4998' },
    ],
  });
  await iniciar(pcs.B);
  await hasta(async () => visto.pedidos > 0, 'que B le pregunte al impostor', 30000);
  await esperar(4000);
  ok(!visto.cabeceras.join('\n').includes(CLAVE), 'el impostor recibió pedidos pero nunca vio la clave');
  ok(!(await porDescripcion(pcs.B, 'HACKEADO')), 'y nada de lo que contestó se aplicó (no trae la prueba de la red)');
  await new Promise((r) => falso.close(r));

  // ---- 19. Se pierde o se rompe el archivo de configuración ----
  log('\n[19] Se pierde o se rompe el archivo de configuración de una PC');
  const archivoConfig = path.join(pcs.B.carpeta, 'configuracion-pc.json');
  const idDe = async (pc) => (await (await fetch(`http://127.0.0.1:${pc.puerto}/api/sistema/info`)).json()).data.idPc;
  await detener(pcs.B);
  escribirConfig(pcs.B);
  await iniciar(pcs.B); // arranca normal: la base guarda su identidad
  await esperar(1500);
  await detener(pcs.B);
  for (const extra of ['', '.bak', '.tmp']) fs.rmSync(archivoConfig + extra, { force: true });
  await iniciar(pcs.B);
  ok((await idDe(pcs.B)) === pcs.B.idPc, 'sin el archivo, la PC recupera su identificador desde la base (no se hace pasar por otra)');
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'TRAS PERDER LA CONFIG', stock: 2 }));
  await hasta(async () => porDescripcion(pcs.B, 'TRAS PERDER LA CONFIG'), 'que B siga sincronizando sin su archivo', 90000);
  ok(true, 'y sigue sincronizando con la otra PC como si nada');

  await detener(pcs.B);
  fs.writeFileSync(archivoConfig, '{ "idPc": "se cortó la luz');
  fs.rmSync(archivoConfig + '.bak', { force: true });
  await iniciar(pcs.B);
  ok((await idDe(pcs.B)) === pcs.B.idPc, 'con el archivo roto a medio escribir, también recupera su identificador');
  await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'TRAS ARCHIVO ROTO', stock: 2 }));
  await hasta(async () => porDescripcion(pcs.B, 'TRAS ARCHIVO ROTO'), 'que B siga sincronizando con el archivo roto', 90000);
  ok(true, 'y sigue sincronizando');
  await hasta(coinciden, 'que coincidan al final', 40000);
  ok(true, 'las dos terminan iguales');

  // ---- 20. Recordatorios compartidos ----
  log('\n[20] Recordatorios: lo que se anota en una PC lo ven todas');
  const rec = await api(pcs.A, 'POST', '/api/recordatorios', {
    texto: 'Cambiar el precio de las gaseosas',
    tipo: 'cambiar',
    urgente: true,
    paraFecha: null,
  });
  ok(rec.texto === 'Cambiar el precio de las gaseosas' && rec.urgente === true && !!rec.creadoPorNombre, 'se anota con quién lo anotó');
  await hasta(async () => (await api(pcs.B, 'GET', '/api/recordatorios')).some((r) => r.id === rec.id), 'que B lo vea');
  const resB = await api(pcs.B, 'GET', '/api/recordatorios/resumen');
  ok(resB.pendientes >= 1 && resB.urgentes >= 1, `en B figura como pendiente y urgente (${resB.pendientes} pendientes, ${resB.urgentes} urgentes)`);
  await api(pcs.B, 'POST', `/api/recordatorios/${rec.id}/hecho`, { hecho: true });
  await hasta(
    async () => (await api(pcs.A, 'GET', '/api/recordatorios?estado=hechos')).some((r) => r.id === rec.id && r.hecho && r.hechoPorNombre),
    'que A lo vea hecho'
  );
  ok(!(await api(pcs.A, 'GET', '/api/recordatorios')).some((r) => r.id === rec.id), 'marcado como hecho en B, sale de los pendientes de A (y queda quién lo hizo)');
  await api(pcs.A, 'POST', `/api/recordatorios/${rec.id}/hecho`, { hecho: false });
  await hasta(async () => (await api(pcs.B, 'GET', '/api/recordatorios')).some((r) => r.id === rec.id), 'que vuelva a pendiente en B');
  ok(true, 'se puede volver a poner como pendiente');

  // Una empleada no puede borrar lo que anotó otra persona, pero sí lo suyo.
  await api(pcs.A, 'POST', '/api/usuarios', { nombre: 'Ana', usuario: 'ana', password: 'clave123', rol: 'empleado', genero: 'F' });
  await hasta(async () => login(pcs.B, 'ana', 'clave123'), 'que ana pueda entrar en B');
  const tokenAna = (
    await (
      await fetch(`http://127.0.0.1:${pcs.B.puerto}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'ana', password: 'clave123' }),
      })
    ).json()
  ).data.token;
  const comoAna = async (metodo, ruta, cuerpo) =>
    (
      await fetch(`http://127.0.0.1:${pcs.B.puerto}${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAna}` },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      })
    ).json();
  const ajeno = await comoAna('DELETE', `/api/recordatorios/${rec.id}`);
  ok(ajeno.ok === false && /anotó|administradora/i.test(ajeno.error), 'una empleada no puede borrar el recordatorio de otra persona');
  const propio = await comoAna('POST', '/api/recordatorios', { texto: 'Avisar a Pedro', tipo: 'hacer', urgente: false, paraFecha: '2030-01-05' });
  ok(propio.ok === true && propio.data.paraFecha === '2030-01-05', 'pero sí anotar los suyos (con fecha)');
  ok((await comoAna('DELETE', `/api/recordatorios/${propio.data.id}`)).ok === true, 'y borrarlos');
  const vacio = await comoAna('POST', '/api/recordatorios', { texto: '   ', tipo: 'hacer', urgente: false, paraFecha: null });
  ok(vacio.ok === false, 'un recordatorio vacío no se guarda');
  await hasta(coinciden, 'que las dos coincidan con los recordatorios', 40000);
  ok(true, 'las dos PCs siguen idénticas');

  // ---- 21. Recordatorios atados a un producto o a un cliente ----
  log('\n[21] Recordatorios con atajo a un producto o a un cliente');
  const prod = await api(pcs.A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'PARA EL ATAJO', stock: 3 }));
  const cli = await api(pcs.A, 'POST', '/api/clientes', { nombre: 'CLIENTE DEL ATAJO', nota: null, deudaInicial: 250 });
  const rp = await api(pcs.A, 'POST', '/api/recordatorios', {
    texto: 'Ajustar el stock, contar de nuevo',
    tipo: 'reponer',
    urgente: false,
    paraFecha: null,
    articuloId: prod.id,
  });
  ok(rp.articuloId === prod.id && rp.vinculoNombre === 'PARA EL ATAJO' && rp.vinculoExiste === true, 'queda atado al producto, con su nombre');
  const rc = await api(pcs.A, 'POST', '/api/recordatorios', {
    texto: 'Cobrarle lo del fiado',
    tipo: 'cobrar',
    urgente: false,
    paraFecha: null,
    clienteId: cli.id,
    articuloId: null,
  });
  ok(rc.clienteId === cli.id && rc.vinculoNombre === 'CLIENTE DEL ATAJO', 'o a un cliente');
  const dosA = await api(pcs.A, 'POST', '/api/recordatorios', {
    texto: 'Con las dos cosas',
    tipo: 'otro',
    urgente: false,
    paraFecha: null,
    articuloId: prod.id,
    clienteId: cli.id,
  });
  ok(!!dosA.articuloId && !dosA.clienteId, 'si se manda un producto y un cliente, queda sólo uno (el producto)');
  const inexistente = await api(pcs.A, 'POST', '/api/recordatorios', {
    texto: 'Atado a algo que no existe',
    tipo: 'otro',
    urgente: false,
    paraFecha: null,
    articuloId: 'a'.repeat(24),
  });
  ok(inexistente.articuloId === null && inexistente.vinculoExiste === false, 'un producto que no existe no se ata');
  await hasta(async () => {
    const lista = await api(pcs.B, 'GET', '/api/recordatorios');
    return lista.find((r) => r.id === rp.id)?.vinculoNombre === 'PARA EL ATAJO' && lista.find((r) => r.id === rc.id)?.clienteId === cli.id;
  }, 'que B vea los atajos');
  ok(true, 'las dos PCs ven a qué producto o cliente se refiere cada uno');
  await api(pcs.A, 'DELETE', `/api/articulos/${prod.id}`);
  await api(pcs.A, 'POST', '/api/articulos/eliminar-definitivo', { ids: [prod.id] });
  await hasta(async () => {
    const r = (await api(pcs.B, 'GET', '/api/recordatorios')).find((x) => x.id === rp.id);
    return r && r.vinculoExiste === false && r.vinculoNombre === 'PARA EL ATAJO';
  }, 'que B vea que el producto ya no existe');
  ok(true, 'si el producto se borra, el recordatorio sigue (con su nombre) y avisa que "ya no está"');
  await hasta(coinciden, 'que coincidan con los atajos', 40000);
  ok(true, 'las dos PCs siguen idénticas');
}

async function todo() {
  await main();
  await extras();
  await migracion();
  await copiaGuardada();
}


todo()
  .catch(async (err) => {
    fallas += 1;
    log('\n✗ ERROR:', err.message);
    if (ultimaDiferencia) {
      log('   última diferencia:', ultimaDiferencia);
      await volcarDiferencias().catch((e) => log('   (no se pudo volcar)', e.message));
    }
  })
  .finally(async () => {
    for (const pc of [...Object.values(pcs), ...Object.values(mig)]) await detener(pc);
    await esperar(500);
    try {
      await limpiarBases();
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* da igual */
    }
    log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
    process.exit(fallas === 0 ? 0 : 1);
  });
