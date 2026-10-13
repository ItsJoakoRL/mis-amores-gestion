// Prueba del flujo "Sumar esta PC a la red" tal como lo usa la pantalla:
// abre la app de PC-B con su ventana (oculta), y desde su pantalla (el puente
// window.escritorio, por el protocolo de depuración de Chromium) la suma a la
// red de PC-A, que ya tiene datos. Después comprueba que las dos terminan con
// lo mismo y que la pantalla de Configuración lo muestra.
//
//   npm run build        (arma la interfaz y el proceso principal)
//   node scripts/probar-union.js
//
// Usa las bases "test_union_a" y "test_union_b": no toca la base del negocio.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BSON, MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-union-'));
const CLAVE_A = crypto.randomBytes(24).toString('hex');

const A = { nombre: 'PC-UA', puerto: 4121, db: 'test_union_a', idPc: crypto.randomUUID(), proc: null, token: null, carpeta: path.join(TMP, 'PC-UA') };
const B = { nombre: 'PC-UB', puerto: 4122, db: 'test_union_b', idPc: crypto.randomUUID(), proc: null, token: null, carpeta: path.join(TMP, 'PC-UB'), cdp: 9322 };

let fallas = 0;
let pasaron = 0;
const log = (...a) => console.log(...a);
const ok = (c, m) => {
  if (c) {
    pasaron += 1;
    log('   ✓', m);
  } else {
    fallas += 1;
    log('   ✗ FALLÓ:', m);
  }
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(fn, msg, ms = 25000) {
  const limite = Date.now() + ms;
  let ultimo;
  while (Date.now() < limite) {
    try {
      ultimo = await fn();
      if (ultimo) return ultimo;
    } catch (e) {
      ultimo = e;
    }
    await esperar(250);
  }
  throw new Error(`Se esperó y no pasó: ${msg} (${ultimo instanceof Error ? ultimo.message : JSON.stringify(ultimo)})`);
}

function iniciar(pc, extraEnv = {}, args = []) {
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;
  delete entorno.NODE_ENV;
  pc.proc = spawn(ELECTRON, ['.', ...args], {
    cwd: RAIZ,
    env: {
      ...entorno,
      MIS_AMORES_CARPETA_DATOS: pc.carpeta,
      MIS_AMORES_CARPETA_RESPALDOS: path.join(TMP, 'respaldos'),
      MIS_AMORES_PUERTO: String(pc.puerto),
      MIS_AMORES_PUERTOS_BUSQUEDA: `${A.puerto},${B.puerto}`,
      MONGODB_DB_NAME: pc.db,
      ...extraEnv,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  return hasta(async () => {
    const r = await fetch(`http://127.0.0.1:${pc.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).ok;
  }, `que ${pc.nombre} arranque`, 60000);
}

function detener(pc) {
  if (!pc.proc) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pc.proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else pc.proc.kill('SIGKILL');
  pc.proc = null;
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

const entradaArticulo = (base) => ({
  codigoBarras: null, descripcion: 'X', marcaId: null, familiaId: null, proveedorId: null, precioCosto: 100, precioVenta: 150,
  precioLista2: 0, precioLista3: 0, utilidadPct: 50, stock: 10, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
});

// ---- Chrome DevTools Protocol: lo mínimo para evaluar código en la pantalla ----
async function conectarPantalla(puerto) {
  const objetivo = await hasta(async () => {
    const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    return lista.find((t) => t.type === 'page' && t.url.startsWith('file://'));
  }, 'que se abra la pantalla de PC-UB', 60000);
  const ws = new WebSocket(objetivo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let n = 0;
  const pendientes = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) {
      pendientes.get(d.id)(d);
      pendientes.delete(d.id);
    }
  };
  return {
    evaluar: (expresion) =>
      new Promise((resolve, reject) => {
        n += 1;
        pendientes.set(n, (d) => {
          if (d.error) return reject(new Error(d.error.message));
          if (d.result.exceptionDetails) {
            const e = d.result.exceptionDetails;
            return reject(new Error(e.exception?.description || e.text));
          }
          resolve(d.result.result.value);
        });
        ws.send(
          JSON.stringify({
            id: n,
            method: 'Runtime.evaluate',
            params: { expression: expresion, awaitPromise: true, returnByValue: true },
          })
        );
      }),
    // Una orden cualquiera del protocolo (ej. sacar una captura de la pantalla).
    orden: (method, params = {}) =>
      new Promise((resolve, reject) => {
        n += 1;
        pendientes.set(n, (d) => (d.error ? reject(new Error(d.error.message)) : resolve(d.result)));
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    cerrar: () => ws.close(),
  };
}

async function limpiarBases() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const pc of [A, B]) await c.db(pc.db).dropDatabase();
  await c.close();
}

async function principal() {
  log(`\nCarpeta temporal: ${TMP}`);
  if (!fs.existsSync(path.join(RAIZ, 'dist', 'index.html'))) throw new Error('Falta "npm run build" (no está dist/index.html)');
  await limpiarBases();

  // ---- PC-A: ya funciona, con datos ----
  log('\n[1] PC-UA ya tiene datos');
  fs.mkdirSync(A.carpeta, { recursive: true });
  fs.writeFileSync(path.join(A.carpeta, 'configuracion-pc.json'), JSON.stringify({ idPc: A.idPc, claveRed: CLAVE_A, pares: [], inicial: 'listo' }));
  await iniciar(A, { MIS_AMORES_SIN_VENTANA: '1' });
  const rubroA = await api(A, 'POST', '/api/familias', { nombre: 'GOLOSINAS' });
  const alf = await api(A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR', codigoBarras: '7790001', familiaId: rubroA.id, stock: 20 }));
  await api(A, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CHICLE', codigoBarras: '7790002', familiaId: rubroA.id, stock: 5 }));
  await api(A, 'POST', '/api/ventas', { articuloId: alf.id, cantidad: 4, metodoPago: 'efectivo' });
  const cliA = await api(A, 'POST', '/api/clientes', { nombre: 'JUAN PEREZ', nota: null, deudaInicial: 300 });
  ok(!!cliA.id, 'PC-UA con productos, una venta y un cliente');

  // ---- PC-B: una PC con sus propios datos (y un rubro repetido) ----
  log('\n[2] PC-UB trabajaba sola y tiene datos propios');
  fs.mkdirSync(B.carpeta, { recursive: true });
  fs.writeFileSync(path.join(B.carpeta, 'configuracion-pc.json'), JSON.stringify({ idPc: B.idPc, pares: [], inicial: 'listo' }));
  await iniciar(B, { MIS_AMORES_VENTANA_OCULTA: '1' }, [`--remote-debugging-port=${B.cdp}`]);
  const rubroB = await api(B, 'POST', '/api/familias', { nombre: 'GOLOSINAS' });
  await api(B, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'PROPIO DE B', codigoBarras: '7795555', familiaId: rubroB.id, stock: 12 }));
  const cliB = await api(B, 'POST', '/api/clientes', { nombre: 'ANA GOMEZ', nota: null, deudaInicial: 80 });
  ok(!!cliB.id && rubroA.id !== rubroB.id, 'PC-UB con su propio rubro GOLOSINAS (otro identificador), un producto y un cliente');

  // ---- Desde la pantalla de B ----
  log('\n[3] Desde la pantalla de PC-UB: sumarla a la red de PC-UA');
  const pantalla = await conectarPantalla(B.cdp);
  const sesion = await hasta(
    async () => pantalla.evaluar("window.api.auth.login('admin','admin123').then(s => s.rol)"),
    'entrar en la pantalla de B'
  );
  ok(sesion === 'admin', 'entra con la cuenta de administradora en PC-UB');
  const antes = await pantalla.evaluar('window.escritorio.red()');
  ok(antes.pcs.length === 0, 'antes de sumarse no tiene otras PCs');

  const encontradas = await pantalla.evaluar('window.escritorio.buscarPcs()');
  const aEnLista = encontradas.find((p) => p.direccion.endsWith(`:${A.puerto}`));
  ok(!!aEnLista && aEnLista.enMiRed === false && aEnLista.versionVieja === false, 'la búsqueda encuentra a PC-UA en la red');

  const sim = await pantalla.evaluar(
    `window.escritorio.sumarPc({ direccion: '127.0.0.1:${A.puerto}', usuario: 'admin', password: 'admin123', simular: true, soloTraer: false })`
  );
  ok(sim.resumen && sim.resumen.articulosNuevos === 1 && sim.resumen.clientesNuevos === 1, `la revisión previa dice qué se pasa (${sim.resumen && sim.resumen.articulosNuevos} producto, ${sim.resumen && sim.resumen.clientesNuevos} cliente)`);
  const yaTocada = await api(A, 'GET', '/api/clientes');
  ok(!yaTocada.some((c) => c.nombre === 'ANA GOMEZ'), 'la revisión previa no tocó nada en PC-UA');

  const mal = await pantalla
    .evaluar(`window.escritorio.sumarPc({ direccion: '127.0.0.1:${A.puerto}', usuario: 'admin', password: 'mal', simular: false, soloTraer: false })`)
    .then(() => null, (e) => e.message);
  ok(typeof mal === 'string' && /contraseña|incorrect/i.test(mal), `con la contraseña mal no hace nada (${mal && mal.slice(0, 60)})`);

  const hecho = await pantalla.evaluar(
    `window.escritorio.sumarPc({ direccion: '127.0.0.1:${A.puerto}', usuario: 'admin', password: 'admin123', simular: false, soloTraer: false })`
  );
  ok(hecho.nombrePc.length > 0, 'se sumó a la red');

  // ---- Resultado ----
  log('\n[4] Las dos PCs quedan iguales');
  const despues = await pantalla.evaluar('window.escritorio.red()');
  ok(despues.pcs.length === 1 && despues.pcs[0].idPc === A.idPc, 'PC-UB ahora conoce a PC-UA');
  const sinSesion = await pantalla.evaluar('window.api.auth.sesionActual()');
  ok(sinSesion === null, 'la sesión anterior se cerró (hay que volver a entrar)');

  B.token = null;
  const verProductos = async (pc) => (await api(pc, 'GET', '/api/articulos?incluirInactivos=true')).map((a) => `${a.descripcion}|${a.stock}`).sort().join(',');
  await hasta(async () => (await verProductos(A)) === (await verProductos(B)), 'que tengan los mismos productos y stock');
  const lista = await verProductos(A);
  ok(lista.includes('PROPIO DE B|12') && lista.includes('ALFAJOR|16'), `los dos tienen todo: ${lista}`);
  const rubrosA = (await api(A, 'GET', '/api/familias')).filter((f) => f.nombre === 'GOLOSINAS');
  const rubrosB = (await api(B, 'GET', '/api/familias')).filter((f) => f.nombre === 'GOLOSINAS');
  ok(rubrosA.length === 1 && rubrosB.length === 1 && rubrosA[0].id === rubrosB[0].id, 'el rubro repetido quedó unificado');
  const clientesB = await api(B, 'GET', '/api/clientes');
  ok(clientesB.find((c) => c.nombre === 'ANA GOMEZ')?.saldo === 80 && clientesB.find((c) => c.nombre === 'JUAN PEREZ')?.saldo === 300, 'los clientes y sus deudas están en las dos');

  // En vivo, en las dos direcciones.
  const chiclePropio = (await api(B, 'GET', '/api/articulos')).find((a) => a.descripcion === 'PROPIO DE B');
  await api(A, 'POST', '/api/ventas', { articuloId: chiclePropio.id, cantidad: 2, metodoPago: 'efectivo' });
  await hasta(async () => (await api(B, 'GET', `/api/articulos/${chiclePropio.id}`)).stock === 10, 'que B vea la venta hecha en A');
  ok(true, 'una venta en PC-UA descuenta el stock en PC-UB (en vivo)');

  // ---- La pantalla de Configuración ----
  log('\n[5] La pantalla de Configuración');
  await pantalla.evaluar("window.api.auth.login('admin','admin123').then(() => { location.hash = '#/configuracion'; location.reload(); return 1; })");
  await esperar(1500);
  const texto = await hasta(async () => {
    const t = await pantalla.evaluar('document.body.innerText');
    return t.includes('Todas las PCs son iguales') && t.includes('Las otras PCs del negocio') ? t : null;
  }, 'que se vea la pantalla de Configuración', 30000);
  ok(texto.includes('Todas las PCs son iguales'), 'se muestra "Todas las PCs son iguales"');
  ok(/En línea/.test(texto), 'muestra a la otra PC "En línea"');
  ok(!/Esta PC es la principal|Hacer que esta PC sea la principal/.test(texto), 'ya no habla de una PC "principal"');
  if (process.env.MIS_AMORES_CAPTURA) {
    await pantalla.evaluar('window.scrollTo(0, 0)');
    const captura = await pantalla.orden('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.MIS_AMORES_CAPTURA, Buffer.from(captura.data, 'base64'));
    log('   (captura guardada en ' + process.env.MIS_AMORES_CAPTURA + ')');
  }

  // ---- Olvidar una PC ----
  log('\n[6] Sacar una PC de la lista');
  await pantalla.evaluar(`window.escritorio.olvidarPc('${A.idPc}')`);
  const sinPares = await pantalla.evaluar('window.escritorio.red()');
  ok(sinPares.pcs.length === 0, 'la PC olvidada sale de la lista');
  pantalla.cerrar();
}

principal()
  .catch((err) => {
    fallas += 1;
    log('\n✗ ERROR:', err.message);
  })
  .finally(async () => {
    detener(A);
    detener(B);
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
