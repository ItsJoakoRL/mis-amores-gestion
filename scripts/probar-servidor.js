// Prueba del modo SERVIDOR (electron/servidor.ts): la app corriendo sin
// Electron, sin ventana, como la que se deja prendida en un servidor de
// internet para que los celulares anden con todas las PCs apagadas.
//
//   npm run build:electron
//   node scripts/probar-servidor.js
//
// Levanta una PC de verdad (Electron) y un servidor (Node común), cada uno con
// su base de prueba, su carpeta y su puerto: no toca la base real del negocio.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BSON, MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-servidor-'));
const CLAVE = crypto.randomBytes(24).toString('hex');
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
const { firmarPedido } = require(path.join(RAIZ, 'dist-electron/electron/sync/seguridad.js'));

const pc = { nombre: 'PC-A', tipo: 'electron', puerto: 4151, db: 'test_srv_a', idPc: crypto.randomUUID(), token: null, proc: null };
const srv = { nombre: 'SERVIDOR', tipo: 'servidor', puerto: 4152, db: 'test_srv_s', idPc: crypto.randomUUID(), token: null, proc: null };
// Un segundo servidor, para probar qué pasa si la PC no está la primera vez.
const srv2 = { nombre: 'SERVIDOR-2', tipo: 'servidor', puerto: 4153, db: 'test_srv_s2', idPc: crypto.randomUUID(), token: null, proc: null };
for (const p of [pc, srv, srv2]) p.carpeta = path.join(TMP, p.nombre);

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

async function hasta(predicado, mensaje, ms = 30000) {
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

// ---------- vida de cada instancia ----------

function escribirConfig(p, extra = {}) {
  fs.mkdirSync(p.carpeta, { recursive: true });
  fs.writeFileSync(
    path.join(p.carpeta, 'configuracion-pc.json'),
    JSON.stringify(
      { idPc: p.idPc, claveRed: CLAVE, pares: [], inicial: 'listo', direccionAnterior: null, nombreAnterior: null, ...extra },
      null,
      2
    )
  );
}

function entornoDe(p) {
  const entorno = { ...process.env };
  // Si esta prueba corre desde un terminal de VS Code, hereda ELECTRON_RUN_AS_NODE.
  delete entorno.ELECTRON_RUN_AS_NODE;
  return {
    ...entorno,
    MIS_AMORES_CARPETA_DATOS: p.carpeta,
    MIS_AMORES_CARPETA_RESPALDOS: path.join(TMP, 'respaldos'),
    MIS_AMORES_PUERTO: String(p.puerto),
    MONGODB_DB_NAME: p.db,
  };
}

function lanzar(p) {
  if (p.tipo === 'electron') {
    p.proc = spawn(ELECTRON, ['.'], {
      cwd: RAIZ,
      env: { ...entornoDe(p), NODE_ENV: 'development', MIS_AMORES_SIN_VENTANA: '1', MIS_AMORES_PUERTOS_BUSQUEDA: String(p.puerto) },
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    // Node común: si arranca, es porque no necesita Electron.
    p.proc = spawn(process.execPath, [SERVIDOR_JS], { cwd: RAIZ, env: entornoDe(p), stdio: 'ignore', windowsHide: true });
  }
  p.codigoDeSalida = undefined;
  p.proc.on('exit', (codigo) => {
    p.codigoDeSalida = codigo;
    p.proc = null;
  });
}

async function responde(p) {
  const r = await fetch(`http://127.0.0.1:${p.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(1500) });
  return (await r.json()).ok === true;
}

async function iniciar(p) {
  lanzar(p);
  await hasta(() => responde(p), `que ${p.nombre} arranque`, 60000);
  p.token = null;
}

async function detener(p) {
  if (!p.proc) return;
  const pid = p.proc.pid;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else p.proc.kill('SIGKILL');
  p.proc = null;
  const limite = Date.now() + 15000;
  while (Date.now() < limite) {
    try {
      await fetch(`http://127.0.0.1:${p.puerto}/api/sistema/info`, { signal: AbortSignal.timeout(500) });
    } catch {
      await esperar(300);
      return;
    }
    await esperar(200);
  }
}

// ---------- la API (la misma de los celulares) ----------

async function api(p, metodo, ruta, cuerpo) {
  if (!p.token && ruta !== '/api/auth/login') {
    const r = await api(p, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
    p.token = r.token;
  }
  const res = await fetch(`http://127.0.0.1:${p.puerto}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(p.token ? { Authorization: `Bearer ${p.token}` } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${metodo} ${ruta}: ${json.error}`);
  return json.data;
}

const articulos = (p) => api(p, 'GET', '/api/articulos?incluirInactivos=true');
const porDescripcion = async (p, d) => (await articulos(p)).find((a) => a.descripcion === d);

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

async function ventasDelDia(p) {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return api(p, 'GET', `/api/ventas/dia/${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`);
}

// El "resumen" que cada instancia ofrece a las demás (firmado con la clave de la red).
async function resumen(p) {
  const ruta = '/api/sync/resumen';
  const f = firmarPedido(CLAVE, 'GET', ruta);
  const res = await fetch(`http://127.0.0.1:${p.puerto}${ruta}`, { headers: f.cabeceras });
  return BSON.EJSON.parse(await res.text()).data;
}

async function coinciden() {
  const [a, b] = await Promise.all([resumen(pc), resumen(srv)]);
  return Object.keys(a).every((c) => !b[c] || (a[c].huella === b[c].huella && a[c].vivos === b[c].vivos));
}

async function limpiarBases() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const p of [pc, srv, srv2]) await c.db(p.db).dropDatabase();
  await c.close();
}

// ---------- pruebas ----------

async function todo() {
  log(`\nCarpeta temporal: ${TMP}`);
  await limpiarBases();

  // ---- 1. Una PC con datos ----
  log('\n[1] Una PC del negocio con sus datos');
  escribirConfig(pc);
  await iniciar(pc);
  const rubro = await api(pc, 'POST', '/api/familias', { nombre: 'GOLOSINAS' });
  const alfajor = await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR', codigoBarras: '7790001', familiaId: rubro.id, stock: 20 }));
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CHICLE', codigoBarras: '7790002', familiaId: rubro.id, stock: 5 }));
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'GALLETITAS', stock: 8 }));
  const cliente = await api(pc, 'POST', '/api/clientes', { nombre: 'JUAN PEREZ', nota: null, deudaInicial: 500 });
  await api(pc, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'efectivo' });
  await api(pc, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 1, metodoPago: 'fiado', clienteId: cliente.id });
  ok((await porDescripcion(pc, 'ALFAJOR')).stock === 17, 'la PC tiene el alfajor con stock 17');

  // ---- 2. El servidor trae todo (sin Electron) ----
  log('\n[2] El servidor arranca con Node común y trae los datos de la PC');
  escribirConfig(srv, { inicial: 'traer', pares: [{ idPc: pc.idPc, nombre: 'PC-A', direccion: `127.0.0.1:${pc.puerto}` }] });
  const t0 = Date.now();
  await iniciar(srv);
  ok(!!srv.proc, 'el servidor arrancó y sigue andando (sin Electron)');
  await hasta(async () => (await porDescripcion(srv, 'ALFAJOR')) && (await articulos(srv)).length === 3, 'que el servidor tenga los 3 productos', 60000);
  log(`   (arrancó y trajo los datos en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  ok((await porDescripcion(srv, 'ALFAJOR')).stock === 17, 'mismo stock (17), calculado desde los movimientos');
  ok((await ventasDelDia(srv)).length === 2, 'las 2 ventas');
  const cliSrv = (await api(srv, 'GET', '/api/clientes')).find((c) => c.nombre === 'JUAN PEREZ');
  ok(cliSrv && cliSrv.saldo === alfajor.precioVenta + 500, `el cliente debe lo mismo (${cliSrv && cliSrv.saldo})`);
  const pagina = await fetch(`http://127.0.0.1:${srv.puerto}/`);
  ok(pagina.status === 200 && (await pagina.text()).includes('<div id="root">'), 'sirve la página de la app para abrir desde el celular');
  const info = await (await fetch(`http://127.0.0.1:${srv.puerto}/api/sistema/info`)).json();
  ok(info.data.idPc === srv.idPc, 'tiene su propio identificador en la red');
  await hasta(coinciden, 'que la PC y el servidor coincidan', 40000);
  ok(true, 'la PC y el servidor tienen el mismo "resumen" de datos');

  // ---- 3. Celular con la PC apagada ----
  log('\n[3] La PC se apaga: se trabaja desde el celular, contra el servidor');
  await detener(pc);
  const galletitas = await porDescripcion(srv, 'GALLETITAS');
  await api(srv, 'PUT', `/api/articulos/${galletitas.id}`, { input: { ...aEntrada(galletitas), precioVenta: 999 }, original: aEntrada(galletitas) });
  ok((await porDescripcion(srv, 'GALLETITAS')).precioVenta === 999, 'se modifica un artículo');
  await api(srv, 'POST', `/api/articulos/${galletitas.id}/ajustar-stock`, { cantidad: 5, tipo: 'ingreso', motivo: 'Llegó mercadería' });
  ok((await porDescripcion(srv, 'GALLETITAS')).stock === 13, 'se ajusta el stock (8 + 5)');
  const chicle = await porDescripcion(srv, 'CHICLE');
  await api(srv, 'POST', '/api/ventas', { articuloId: chicle.id, cantidad: 2, metodoPago: 'efectivo' });
  ok((await ventasDelDia(srv)).length === 3, 'se registra una venta y se ve cuánto se vendió');
  const rec = await api(srv, 'POST', '/api/recordatorios', { texto: 'Pedir más chicles', tipo: 'reponer', urgente: false, paraFecha: null, articuloId: chicle.id });
  ok(rec.vinculoNombre === 'CHICLE', 'se anota un recordatorio atado al producto');
  await api(srv, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CARAMELOS', stock: 50 }));
  ok(!!(await porDescripcion(srv, 'CARAMELOS')), 'se carga un producto nuevo');

  // ---- 4. La PC vuelve ----
  log('\n[4] La PC vuelve a prenderse y recibe todo lo del celular');
  await iniciar(pc);
  await hasta(
    async () => {
      const [g, c, ca] = await Promise.all([porDescripcion(pc, 'GALLETITAS'), porDescripcion(pc, 'CHICLE'), porDescripcion(pc, 'CARAMELOS')]);
      return g && g.precioVenta === 999 && g.stock === 13 && c && c.stock === 3 && ca;
    },
    'que la PC reciba lo cargado en el servidor',
    90000
  );
  ok(true, 'precio, stock, venta y producto nuevo llegaron a la PC');
  ok((await ventasDelDia(pc)).length === 3, 'la PC ve las 3 ventas');
  await hasta(async () => (await api(pc, 'GET', '/api/recordatorios')).some((r) => r.id === rec.id), 'que la PC vea el recordatorio');
  ok(true, 'y el recordatorio');
  await hasta(coinciden, 'que coincidan al final', 40000);
  ok(true, 'la PC y el servidor terminan idénticos');

  // ---- 5. En vivo, con las dos prendidas ----
  log('\n[5] Con las dos prendidas, los cambios pasan en vivo');
  const t1 = Date.now();
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'DESDE LA PC', stock: 4 }));
  await hasta(async () => porDescripcion(srv, 'DESDE LA PC'), 'que el servidor vea el producto de la PC', 20000);
  ok(Date.now() - t1 < 8000, `un producto de la PC aparece en el servidor (${Date.now() - t1} ms)`);
  const desdeLaPc = await porDescripcion(srv, 'DESDE LA PC');
  await api(srv, 'POST', '/api/ventas', { articuloId: desdeLaPc.id, cantidad: 1, metodoPago: 'efectivo' });
  await hasta(async () => (await porDescripcion(pc, 'DESDE LA PC')).stock === 3, 'que la PC vea la venta del servidor', 20000);
  ok(true, 'una venta hecha desde el celular descuenta el stock en la PC');

  // ---- 6. Reinicio del servidor ----
  log('\n[6] El servidor se reinicia (corte de luz, actualización)');
  await detener(srv);
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CON EL SERVIDOR APAGADO', stock: 2 }));
  await iniciar(srv);
  // Tenía 5 productos al apagarse (el sexto se cargó en la PC mientras estaba
  // apagado y llega recién después).
  const alVolver = await articulos(srv);
  ok(alVolver.length >= 5 && alVolver.some((a) => a.descripcion === 'DESDE LA PC'), 'conserva sus datos al volver');
  await hasta(async () => porDescripcion(srv, 'CON EL SERVIDOR APAGADO'), 'que se ponga al día al volver', 60000);
  ok(true, 'al volver, se pone al día con lo que pasó mientras estaba apagado');
  await hasta(coinciden, 'que coincidan tras el reinicio', 40000);
  ok(true, 'las dos siguen idénticas');

  // ---- 7. Primera vez con la PC apagada ----
  log('\n[7] Un servidor nuevo cuando la PC está apagada: no arranca vacío, reintenta');
  await detener(pc);
  escribirConfig(srv2, { inicial: 'traer', pares: [{ idPc: pc.idPc, nombre: 'PC-A', direccion: `127.0.0.1:${pc.puerto}` }] });
  lanzar(srv2);
  await hasta(() => srv2.codigoDeSalida !== undefined, 'que el servidor termine solo (para que el servicio lo reintente)', 90000);
  ok(srv2.codigoDeSalida === 3, `termina con el código 3 (fue ${srv2.codigoDeSalida}) y no queda andando con datos vacíos`);
}

todo()
  .catch((err) => {
    fallas += 1;
    log('\n✗ ERROR:', err.message);
  })
  .finally(async () => {
    for (const p of [pc, srv, srv2]) await detener(p);
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
