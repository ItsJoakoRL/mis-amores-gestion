// Prueba "al azar" de la sincronización: dos PCs reciben cientos de operaciones
// mezcladas (productos, precios, ventas, anulaciones, clientes, pagos, rubros),
// con apagones y reinicios de cualquiera de las dos en el medio, incluyendo
// cargar a la vez, sin verse, cosas repetidas. Al final las dos tienen que
// tener EXACTAMENTE lo mismo y el stock tiene que cerrar con los movimientos.
//
//   npm run build:electron
//   node scripts/probar-azar.js [semilla] [operaciones] [cantidad de PCs]
//
// Con 3 PCs (o más) quedan "en fila" (A-B-C): A y C sólo se conocen por B, así
// que lo que cargue una le llega a la otra retransmitido.
//
// Usa las bases "test_azar_a", "test_azar_b"...: no toca la base del negocio.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BSON, MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-azar-'));
const CLAVE = crypto.randomBytes(24).toString('hex');
const SEMILLA = Number(process.argv[2]) || Math.floor(Math.random() * 1e9);
const OPERACIONES = Number(process.argv[3]) || 150;
const CANTIDAD_PCS = Math.min(5, Math.max(2, Number(process.argv[4]) || 2));

// Generador pseudoaleatorio con semilla: una falla se puede repetir.
let estadoAzar = SEMILLA >>> 0;
function azar() {
  estadoAzar = (estadoAzar + 0x6d2b79f5) >>> 0;
  let t = estadoAzar;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];

const pcs = {};
for (let i = 0; i < CANTIDAD_PCS; i++) {
  const letra = String.fromCharCode(65 + i);
  pcs[letra] = {
    nombre: `PC-Z${letra}`,
    puerto: 4131 + i,
    db: `test_azar_${letra.toLowerCase()}`,
    idPc: crypto.randomUUID(),
    proc: null,
    token: null,
    carpeta: path.join(TMP, `PC-Z${letra}`),
  };
}
const todas = Object.values(pcs);
const primera = todas[0];
const log = (...a) => console.log(...a);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function hasta(fn, msg, ms = 60000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) {
      ultimo = e;
    }
    await esperar(300);
  }
  throw new Error(`Se esperó y no pasó: ${msg} (${ultimo instanceof Error ? ultimo.message : JSON.stringify(ultimo)})`);
}

function escribirConfig(pc) {
  fs.mkdirSync(pc.carpeta, { recursive: true });
  // Con 2 PCs se conocen entre sí; con más, en fila: cada una sólo conoce a sus vecinas.
  const i = todas.indexOf(pc);
  const vecinas = CANTIDAD_PCS === 2 ? [todas[1 - i]] : [todas[i - 1], todas[i + 1]].filter(Boolean);
  fs.writeFileSync(
    path.join(pc.carpeta, 'configuracion-pc.json'),
    JSON.stringify({
      idPc: pc.idPc,
      claveRed: CLAVE,
      pares: vecinas.map((o) => ({ idPc: o.idPc, nombre: o.nombre, direccion: `127.0.0.1:${o.puerto}` })),
      inicial: 'listo',
    })
  );
}

async function iniciar(pc) {
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;
  pc.proc = spawn(ELECTRON, ['.'], {
    cwd: RAIZ,
    env: {
      ...entorno,
      NODE_ENV: 'development',
      MIS_AMORES_SIN_VENTANA: '1',
      MIS_AMORES_CARPETA_DATOS: pc.carpeta,
      MIS_AMORES_CARPETA_RESPALDOS: path.join(TMP, 'respaldos'),
      MIS_AMORES_PUERTO: String(pc.puerto),
      // Con 3 o más no se las busca por puerto: sólo se conocen por sus vecinas.
      MIS_AMORES_PUERTOS_BUSQUEDA: CANTIDAD_PCS === 2 ? todas.map((p) => p.puerto).join(',') : '',
      MONGODB_DB_NAME: pc.db,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  pc.token = null;
  await hasta(async () => {
    const r = await fetch(`http://127.0.0.1:${pc.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).ok;
  }, `que ${pc.nombre} arranque`, 60000);
}

async function detener(pc) {
  if (!pc.proc) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pc.proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else pc.proc.kill('SIGKILL');
  pc.proc = null;
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

async function api(pc, metodo, ruta, cuerpo) {
  if (!pc.token && ruta !== '/api/auth/login') {
    pc.token = (await api(pc, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).token;
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

const entrada = (a) => {
  const { id, marcaNombre, familiaNombre, proveedorNombre, activo, creadoEn, actualizadoEn, ...resto } = a;
  return resto;
};

async function limpiar() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const pc of todas) await c.db(pc.db).dropDatabase();
  await c.close();
}

// ---------- operaciones al azar ----------
let contador = 0;
const NOMBRES_RUBRO = ['LACTEOS', 'FIAMBRES', 'PANADERIA', 'LIMPIEZA', 'BEBIDAS', 'KIOSCO'];
const NOMBRES_CLIENTE = ['JUAN', 'MARIA', 'PEDRO', 'ANA', 'LUCIA', 'CARLOS'];
const bitacora = [];

async function operacion(pc) {
  const articulos = await api(pc, 'GET', '/api/articulos?incluirInactivos=true');
  const activos = articulos.filter((a) => a.activo);
  const clientes = await api(pc, 'GET', '/api/clientes');
  const r = azar();
  contador += 1;
  const n = contador;

  if (r < 0.2 || activos.length < 3) {
    // Producto nuevo (a veces con un código que otro PC también podría estar cargando)
    const codigo = azar() < 0.3 ? `COD-${entre(1, 8)}` : null;
    const rubros = await api(pc, 'GET', '/api/familias');
    await api(pc, 'POST', '/api/articulos', {
      codigoBarras: codigo, descripcion: `PROD ${n} ${pc.nombre}`, marcaId: null, familiaId: rubros.length ? elegir(rubros).id : null,
      proveedorId: null, precioCosto: 10, precioVenta: entre(20, 90), precioLista2: 0, precioLista3: 0, utilidadPct: 0,
      stock: entre(5, 40), stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null,
    }).catch(() => {});
    return `${pc.nombre}: producto nuevo${codigo ? ' (código ' + codigo + ')' : ''}`;
  }
  if (r < 0.4) {
    const a = elegir(activos);
    const campo = elegir(['precioVenta', 'nota', 'stockMinimo', 'descripcion']);
    const nuevo = { ...entrada(a) };
    if (campo === 'precioVenta') nuevo.precioVenta = entre(20, 200);
    else if (campo === 'nota') nuevo.nota = `nota ${n}`;
    else if (campo === 'stockMinimo') nuevo.stockMinimo = entre(0, 9);
    else nuevo.descripcion = `${a.descripcion.split(' *')[0]} *${n}`;
    await api(pc, 'PUT', `/api/articulos/${a.id}`, { input: nuevo, original: entrada(a) }).catch(() => {});
    return `${pc.nombre}: cambia ${campo} de ${a.descripcion}`;
  }
  if (r < 0.65) {
    const a = elegir(activos.filter((x) => x.stock > 0).length ? activos.filter((x) => x.stock > 0) : activos);
    const metodo = azar() < 0.3 && clientes.length ? 'fiado' : elegir(['efectivo', 'tarjeta', 'transferencia']);
    await api(pc, 'POST', '/api/ventas', {
      articuloId: a.id, cantidad: 1, metodoPago: metodo, clienteId: metodo === 'fiado' ? elegir(clientes).id : null,
    }).catch(() => {});
    return `${pc.nombre}: vende 1 ${a.descripcion} (${metodo})`;
  }
  if (r < 0.72) {
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const ventas = await api(pc, 'GET', `/api/ventas/dia/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    if (ventas.length) {
      const v = elegir(ventas);
      await api(pc, 'DELETE', `/api/ventas/${v.id}`).catch(() => {});
      return `${pc.nombre}: anula una venta`;
    }
    return `${pc.nombre}: (nada para anular)`;
  }
  if (r < 0.8) {
    const nombre = azar() < 0.5 ? elegir(NOMBRES_CLIENTE) : `CLIENTE ${n}`;
    await api(pc, 'POST', '/api/clientes', { nombre, nota: null, deudaInicial: entre(0, 3) * 100 }).catch(() => {});
    return `${pc.nombre}: cliente ${nombre}`;
  }
  if (r < 0.88 && clientes.length) {
    const c = elegir(clientes);
    await api(pc, 'POST', `/api/clientes/${c.id}/pago`, { monto: entre(1, 5) * 10, nota: null, metodoPago: 'efectivo' }).catch(() => {});
    return `${pc.nombre}: pago de ${c.nombre}`;
  }
  if (r < 0.94) {
    const nombre = elegir(NOMBRES_RUBRO);
    await api(pc, 'POST', '/api/familias', { nombre }).catch(() => {});
    return `${pc.nombre}: rubro ${nombre}`;
  }
  const a = elegir(activos);
  const tipo = elegir(['ingreso', 'ajuste']);
  await api(pc, 'POST', `/api/articulos/${a.id}/ajustar-stock`, {
    cantidad: tipo === 'ajuste' ? entre(0, 50) : entre(1, 10), tipo, motivo: 'azar',
  }).catch(() => {});
  return `${pc.nombre}: ${tipo} de stock en ${a.descripcion}`;
}

async function resumen(pc) {
  const res = await fetch(`http://127.0.0.1:${pc.puerto}/api/sync/resumen`, { headers: { 'X-Clave-Red': CLAVE } });
  return BSON.EJSON.parse(await res.text()).data;
}

async function foto(pc) {
  const [articulos, clientes, familias] = await Promise.all([
    api(pc, 'GET', '/api/articulos?incluirInactivos=true'),
    api(pc, 'GET', '/api/clientes'),
    api(pc, 'GET', '/api/familias'),
  ]);
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  const ventas = await api(pc, 'GET', `/api/ventas/dia/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  return {
    articulos: articulos
      .map((a) => `${a.id}|${a.descripcion}|${a.stock}|${a.precioVenta}|${a.nota}|${a.stockMinimo}|${a.codigoBarras}|${a.activo}`)
      .sort(),
    clientes: clientes.map((c) => `${c.id}|${c.nombre}|${c.saldo}`).sort(),
    familias: familias.map((f) => `${f.id}|${f.nombre}`).sort(),
    ventas: ventas.map((v) => `${v.id}|${v.articuloId}|${v.cantidad}|${v.total}|${v.metodoPago}|${v.clienteId}`).sort(),
  };
}

async function principal() {
  log(`Semilla ${SEMILLA}, ${OPERACIONES} operaciones. Carpeta: ${TMP}`);
  await limpiar();
  for (const pc of todas) escribirConfig(pc);
  for (const pc of todas) await iniciar(pc);

  // Una base común para arrancar.
  for (let i = 0; i < 6; i++) await operacion(primera);
  await hasta(async () => {
    const n = (await foto(primera)).articulos.length;
    for (const pc of todas) if ((await foto(pc)).articulos.length !== n) return false;
    return true;
  }, 'base inicial');

  let apagadas = 0;
  for (let i = 0; i < OPERACIONES; i++) {
    // De vez en cuando se apaga una PC (o se la vuelve a prender).
    const apagadasAhora = todas.filter((p) => !p.proc);
    if (azar() < 0.06) {
      // Se prende una apagada, o se apaga una (siempre queda alguna prendida).
      if (apagadasAhora.length > 0 && (apagadasAhora.length === todas.length - 1 || azar() < 0.6)) {
        const apagada = elegir(apagadasAhora);
        await iniciar(apagada);
        bitacora.push(`  >> se vuelve a prender ${apagada.nombre}`);
      } else {
        const v = elegir(todas.filter((p) => p.proc));
        await detener(v);
        apagadas += 1;
        bitacora.push(`  >> se apaga ${v.nombre}`);
      }
    }
    const vivas = todas.filter((p) => p.proc);
    if (vivas.length === 0) continue;
    const pc = elegir(vivas);
    try {
      bitacora.push(await operacion(pc));
    } catch (err) {
      bitacora.push(`${pc.nombre}: (falló: ${err.message.slice(0, 80)})`);
    }
    if (azar() < 0.3) await esperar(entre(50, 400));
  }

  // Que las dos estén prendidas y se pongan al día.
  for (const pc of todas) if (!pc.proc) await iniciar(pc);
  log(`Operaciones hechas con ${CANTIDAD_PCS} PCs (se apagó una PC ${apagadas} veces). Esperando a que converjan...`);
  const iguales = async () => {
    const [a, ...otras] = await Promise.all(todas.map((p) => resumen(p)));
    return otras.every((b) => Object.keys(a).every((k) => a[k].huella === b[k].huella && a[k].vivos === b[k].vivos));
  };
  let converge = true;
  try {
    await hasta(iguales, 'que las dos PCs coincidan', 90000);
  } catch (err) {
    converge = false;
    log('✗ NO CONVERGEN:', err.message);
  }

  // Las dos tienen que mostrar exactamente lo mismo, y el stock tiene que cerrar.
  const fotos = await Promise.all(todas.map((p) => foto(p)));
  const fa = fotos[0];
  let problemas = 0;
  for (let n = 1; n < fotos.length; n++) {
    const fb = fotos[n];
    for (const k of Object.keys(fa)) {
      if (fa[k].join('\n') !== fb[k].join('\n')) {
        problemas += 1;
        log(`✗ ${k} distintos entre ${todas[0].nombre} y ${todas[n].nombre}:`);
        const sa = new Set(fa[k]);
        const sb = new Set(fb[k]);
        for (const x of fa[k]) if (!sb.has(x)) log(`    sólo en ${todas[0].nombre}:`, x);
        for (const x of fb[k]) if (!sa.has(x)) log(`    sólo en ${todas[n].nombre}:`, x);
      }
    }
  }
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const pc of todas) {
    const db = c.db(pc.db);
    const sumas = new Map();
    for (const m of await db.collection('movimientos_stock').aggregate([{ $group: { _id: '$articuloId', t: { $sum: '$cantidad' } } }]).toArray()) {
      sumas.set(String(m._id), m.t);
    }
    let malos = 0;
    for (const a of await db.collection('articulos').find().toArray()) {
      const esperado = Math.round((a.stockBase + (sumas.get(String(a._id)) ?? 0)) * 1000) / 1000;
      if (a.stock !== esperado) malos += 1;
    }
    if (malos > 0) {
      problemas += 1;
      log(`✗ ${pc.nombre}: ${malos} productos con el stock que no cierra con sus movimientos`);
    }
    // Dos productos activos con el mismo código, o dos clientes activos con el mismo nombre, no pueden existir.
    const dup = await db.collection('articulos').aggregate([{ $match: { codigoBarras: { $type: 'string' } } }, { $group: { _id: '$codigoBarras', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
    if (dup.length) {
      problemas += 1;
      log(`✗ ${pc.nombre}: códigos de barras repetidos: ${dup.map((d) => d._id).join(', ')}`);
    }
  }
  await c.close();

  log(`\nProductos: ${fa.articulos.length}, clientes: ${fa.clientes.length}, rubros: ${fa.familias.length}, ventas de hoy: ${fa.ventas.length}`);
  if (!converge || problemas > 0) {
    log(`\n✗ FALLÓ (semilla ${SEMILLA}). Últimas operaciones:`);
    log(bitacora.slice(-25).join('\n'));
    return false;
  }
  log(`\n✓ Las dos PCs terminaron con exactamente lo mismo (semilla ${SEMILLA}).`);
  return true;
}

principal()
  .then((bien) => (process.exitCode = bien ? 0 : 1))
  .catch((err) => {
    log('\n✗ ERROR:', err.message);
    log(bitacora.slice(-15).join('\n'));
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const pc of todas) await detener(pc);
    await esperar(500);
    try {
      await limpiar();
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* da igual */
    }
    process.exit(process.exitCode ?? 1);
  });
