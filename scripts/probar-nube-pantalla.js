// Prueba, desde la pantalla de una PC, de "Conectar con el servidor de internet"
// (Configuración): el puente window.escritorio.conectarNube y la tarjeta de la
// pantalla, contra un servidor en modo nube (ver electron/nube.ts).
//
//   npm run build        (arma la interfaz y el proceso principal)
//   node scripts/probar-nube-pantalla.js
//
// Usa las bases "test_nubep_*": no toca la base del negocio.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-nubep-'));
const CLAVE = crypto.randomBytes(24).toString('hex');
const OTRA_CLAVE = crypto.randomBytes(24).toString('hex');
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');

const pc = { nombre: 'PC', puerto: 4171, db: 'test_nubep_pc', cdp: 9323, idPc: crypto.randomUUID(), proc: null, token: null };
const srv = { nombre: 'NUBE', puerto: 4172, db: 'test_nubep_srv', clave: CLAVE, proc: null };
const srvOtra = { nombre: 'NUBE-OTRA-CLAVE', puerto: 4173, db: 'test_nubep_otra', clave: OTRA_CLAVE, proc: null };
for (const p of [pc, srv, srvOtra]) p.carpeta = path.join(TMP, p.nombre);

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
async function hasta(fn, msg, ms = 30000) {
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

const entornoBase = () => {
  const e = { ...process.env };
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.NODE_ENV;
  return e;
};

function responde(puerto) {
  return async () => {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/sistema/info`, { signal: AbortSignal.timeout(1500) });
    return (await r.json()).ok;
  };
}

async function iniciarServidor(s) {
  s.proc = spawn(process.execPath, [SERVIDOR_JS], {
    cwd: RAIZ,
    env: {
      ...entornoBase(),
      MIS_AMORES_CARPETA_DATOS: s.carpeta,
      MIS_AMORES_PUERTO: String(s.puerto),
      MONGODB_DB_NAME: s.db,
      MIS_AMORES_CLAVE_RED: s.clave,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await hasta(responde(s.puerto), `que ${s.nombre} arranque`, 60000);
}

async function iniciarPc() {
  fs.mkdirSync(pc.carpeta, { recursive: true });
  fs.writeFileSync(
    path.join(pc.carpeta, 'configuracion-pc.json'),
    JSON.stringify({ idPc: pc.idPc, claveRed: CLAVE, pares: [], inicial: 'listo' })
  );
  pc.proc = spawn(ELECTRON, ['.', `--remote-debugging-port=${pc.cdp}`], {
    cwd: RAIZ,
    env: {
      ...entornoBase(),
      MIS_AMORES_CARPETA_DATOS: pc.carpeta,
      MIS_AMORES_CARPETA_RESPALDOS: path.join(TMP, 'respaldos'),
      MIS_AMORES_PUERTO: String(pc.puerto),
      MIS_AMORES_PUERTOS_BUSQUEDA: String(pc.puerto),
      MONGODB_DB_NAME: pc.db,
      MIS_AMORES_VENTANA_OCULTA: '1',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await hasta(responde(pc.puerto), 'que la PC arranque', 60000);
}

function matar(p) {
  if (!p.proc) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.proc.kill('SIGKILL');
  p.proc = null;
}

async function api(p, metodo, ruta, cuerpo, token) {
  const res = await fetch(`http://127.0.0.1:${p.puerto}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${metodo} ${ruta}: ${json.error}`);
  return json.data;
}

// ---- Chrome DevTools Protocol: lo mínimo para evaluar código en la pantalla ----
async function conectarPantalla(puerto) {
  const objetivo = await hasta(async () => {
    const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
    return lista.find((t) => t.type === 'page' && t.url.startsWith('file://'));
  }, 'que se abra la pantalla de la PC', 60000);
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
    cerrar: () => ws.close(),
  };
}

async function limpiarBases() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const p of [pc, srv, srvOtra]) await c.db(p.db).dropDatabase();
  await c.close();
}

async function principal() {
  log(`\nCarpeta temporal: ${TMP}`);
  if (!fs.existsSync(path.join(RAIZ, 'dist', 'index.html'))) throw new Error('Falta "npm run build" (no está dist/index.html)');
  await limpiarBases();

  log('\n[1] Una PC con datos y dos servidores de internet (uno con otra clave)');
  await iniciarServidor(srv);
  await iniciarServidor(srvOtra);
  await iniciarPc();
  const pantalla = await conectarPantalla(pc.cdp);
  await hasta(
    async () => pantalla.evaluar("window.api.auth.login('admin','admin123').then(s => s.rol === 'admin')"),
    'entrar en la pantalla de la PC'
  );
  await pantalla.evaluar(
    "window.api.articulos.crear({ codigoBarras: null, descripcion: 'ALFAJOR', marcaId: null, familiaId: null, proveedorId: null, precioCosto: 100, precioVenta: 150, precioLista2: 0, precioLista3: 0, utilidadPct: 50, stock: 20, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null }).then(a => a.id)"
  );
  ok(true, 'la PC tiene un producto cargado');

  log('\n[2] Con una contraseña obvia (admin123) no deja conectar con internet');
  const debil = await pantalla
    .evaluar(`window.escritorio.conectarNube('http://127.0.0.1:${srv.puerto}')`)
    .then(() => null, (e) => e.message);
  ok(typeof debil === 'string' && /cambiá la contraseña de: admin/.test(debil), `lo rechaza y dice cuál (${debil && debil.slice(0, 70)})`);
  const aunSinPares = await pantalla.evaluar('window.escritorio.red()');
  ok(aunSinPares.pcs.length === 0, 'no quedó anotado ningún servidor');

  log('\n[3] Cambia la contraseña y vuelve a probar');
  const sesionApi = (await api(pc, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).token;
  const usuarios = await api(pc, 'GET', '/api/usuarios', undefined, sesionApi);
  const admin = usuarios.find((u) => u.usuario === 'admin');
  await api(pc, 'POST', `/api/usuarios/${admin.id}/reset-password`, { password: 'UnaClaveLarga2026Segura' }, sesionApi);
  await pantalla.evaluar("window.api.auth.login('admin','UnaClaveLarga2026Segura').then(s => s.rol)");

  const equivocada = await pantalla
    .evaluar(`window.escritorio.conectarNube('http://127.0.0.1:${srvOtra.puerto}')`)
    .then(() => null, (e) => e.message);
  ok(typeof equivocada === 'string' && /misma clave/.test(equivocada), `un servidor con otra clave se rechaza (${equivocada && equivocada.slice(0, 70)})`);
  const sinDireccion = await pantalla.evaluar("window.escritorio.conectarNube('   ')").then(() => null, (e) => e.message);
  ok(typeof sinDireccion === 'string' && /Escribí la dirección/.test(sinDireccion), 'sin dirección pide que la escriban');

  const hecho = await pantalla.evaluar(`window.escritorio.conectarNube('http://127.0.0.1:${srv.puerto}/')`);
  ok(hecho.direccion === `http://127.0.0.1:${srv.puerto}`, `se conecta y deja la dirección limpia (${hecho.direccion})`);

  log('\n[4] La PC le manda sus datos y la pantalla lo muestra');
  const red = await hasta(
    async () => {
      const r = await pantalla.evaluar('window.escritorio.red()');
      return r.pcs.length === 1 && r.pcs[0].enLinea ? r : null;
    },
    'que el servidor figure en línea'
  );
  ok(red.pcs[0].direccion === `http://127.0.0.1:${srv.puerto}`, 'figura en la lista de la red');
  // El usuario con su contraseña nueva entra al servidor: le llegó todo.
  const enSrv = await hasta(
    async () => api(srv, 'POST', '/api/auth/login', { usuario: 'admin', password: 'UnaClaveLarga2026Segura' }),
    'que el servidor tenga los usuarios de la PC',
    60000
  );
  const productos = await hasta(
    async () => {
      const l = await api(srv, 'GET', '/api/articulos', undefined, enSrv.token);
      return l.length === 1 ? l : null;
    },
    'que el servidor tenga el producto de la PC',
    60000
  );
  ok(productos[0].descripcion === 'ALFAJOR' && productos[0].stock === 20, 'el servidor recibió el producto con su stock');

  await pantalla.evaluar("location.hash = '#/configuracion'; location.reload(); 1");
  await esperar(1500);
  const texto = await hasta(async () => {
    const t = await pantalla.evaluar('document.body.innerText');
    const estado = await pantalla.evaluar(
      "document.querySelector('[data-estado-servidor]')?.getAttribute('data-estado-servidor') ?? null"
    );
    const conectada = estado === 'conectado' || estado === 'sincronizando';
    return t.includes('Servidor en internet (para el celular)') && conectada && t.includes('Funciona') ? t : null;
  }, 'que Configuración muestre la tarjeta del servidor conectada y funcionando', 30000);
  ok(texto.includes(`http://127.0.0.1:${srv.puerto}`), 'la tarjeta muestra la dirección y que está conectado');
  ok(/La página del celular \(el servidor\)/.test(texto) && /Esta PC con el servidor/.test(texto), 'y separa si el servidor anda de si esta PC está conectada');
  ok(/Dejar de usar este servidor/.test(texto), 'ofrece dejar de usarlo');

  log('\n[5] Dejar de usar el servidor');
  await pantalla.evaluar(`window.escritorio.olvidarPc('${red.pcs[0].idPc}')`);
  const despues = await hasta(async () => {
    const r = await pantalla.evaluar('window.escritorio.red()');
    return r.pcs.length === 0 ? r : null;
  }, 'que el servidor salga de la lista');
  ok(despues.pcs.length === 0, 'el servidor sale de la lista de la PC');
  pantalla.cerrar();
}

principal()
  .catch((err) => {
    fallas += 1;
    log('\n✗ ERROR:', err.message);
  })
  .finally(async () => {
    for (const p of [pc, srv, srvOtra]) matar(p);
    await esperar(1000);
    try {
      await limpiarBases();
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* da igual */
    }
    log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
    process.exit(fallas === 0 ? 0 : 1);
  });
