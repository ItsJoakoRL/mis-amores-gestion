// Prueba del modo NUBE (electron/nube.ts): el servidor de internet (Render) que
// NO puede llamar a las PCs del negocio (están detrás de su router) y cuyo
// disco no guarda nada de un reinicio al otro. Las PCs lo llaman y le empujan
// sus cambios.
//
//   npm run build:electron
//   node scripts/probar-nube.js
//
// Levanta una PC de verdad (Electron) y un servidor (Node común), cada uno con
// su base de prueba, su carpeta y su puerto: no toca la base real del negocio.
// El servidor NO conoce la dirección de la PC (como en internet): todo lo que
// llega de la PC tiene que llegar porque ella se lo empuja.
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BSON, MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-nube-'));
const CLAVE = crypto.randomBytes(24).toString('hex');
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
const { firmarPedido } = require(path.join(RAIZ, 'dist-electron/electron/sync/seguridad.js'));

// El identificador del servidor sale de la clave (ver nube.ts).
process.env.MIS_AMORES_CLAVE_RED = CLAVE;
process.env.MIS_AMORES_MODO_SERVIDOR = '1';
const { idPcNube } = require(path.join(RAIZ, 'dist-electron/electron/nube.js'));
const ID_SERVIDOR = idPcNube();
delete process.env.MIS_AMORES_CLAVE_RED;
delete process.env.MIS_AMORES_MODO_SERVIDOR;

const pc = { nombre: 'PC-A', tipo: 'electron', puerto: 4161, db: 'test_nube_pc', idPc: crypto.randomUUID(), token: null, proc: null };
const srv = { nombre: 'NUBE', tipo: 'servidor', puerto: 4162, db: 'test_nube_srv', idPc: ID_SERVIDOR, token: null, proc: null };
for (const p of [pc, srv]) p.carpeta = path.join(TMP, p.nombre);

// Hace de "dirección pública" del servidor (en Render sería RENDER_EXTERNAL_URL):
// cuenta las visitas que el servidor se hace a sí mismo para no dormirse.
const PUERTO_PUBLICA = 4163;
const visitas = { cantidad: 0, rutas: new Set(), agentes: new Set() };
const publica = http.createServer((req, res) => {
  visitas.cantidad += 1;
  visitas.rutas.add(req.url);
  visitas.agentes.add(req.headers['user-agent']);
  res.setHeader('Content-Type', 'application/json');
  res.end('{"ok":true}');
});

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

function escribirConfigPc() {
  fs.mkdirSync(pc.carpeta, { recursive: true });
  fs.writeFileSync(
    path.join(pc.carpeta, 'configuracion-pc.json'),
    JSON.stringify(
      {
        idPc: pc.idPc,
        claveRed: CLAVE,
        // Una dirección con "http://" explícito es una PC "de internet": a esa no
        // se la puede llamar desde afuera, se le empuja (ver nube.ts).
        pares: [{ idPc: srv.idPc, nombre: 'Servidor de internet', direccion: `http://127.0.0.1:${srv.puerto}` }],
        inicial: 'listo',
        direccionAnterior: null,
        nombreAnterior: null,
      },
      null,
      2
    )
  );
}

function entornoDe(p) {
  const entorno = { ...process.env };
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
    // Node común, en modo nube: la identidad sale de las variables de entorno.
    p.proc = spawn(process.execPath, [SERVIDOR_JS], {
      cwd: RAIZ,
      env: {
        ...entornoDe(p),
        MIS_AMORES_CLAVE_RED: CLAVE,
        // Con barra al final a propósito: tiene que quedar bien igual.
        MIS_AMORES_URL_PUBLICA: `http://127.0.0.1:${PUERTO_PUBLICA}/`,
        MIS_AMORES_DESPERTADOR_MS: '600',
      },
      stdio: 'ignore',
      windowsHide: true,
    });
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

// Para ver el resultado crudo (sin que tire error si ok es false).
async function apiCruda(p, metodo, ruta, cuerpo) {
  const res = await fetch(`http://127.0.0.1:${p.puerto}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return res.json();
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

// Un pedido de sincronización firmado con la clave de la red.
async function pedidoSync(p, metodo, ruta, cuerpo, firmarCon = cuerpo) {
  const f = firmarPedido(CLAVE, metodo, ruta, firmarCon);
  const res = await fetch(`http://127.0.0.1:${p.puerto}${ruta}`, {
    method: metodo,
    headers: { ...f.cabeceras, ...(cuerpo !== undefined ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}) },
    body: cuerpo,
  });
  return { estado: res.status, json: BSON.EJSON.parse(await res.text()) };
}

async function resumen(p) {
  return (await pedidoSync(p, 'GET', '/api/sync/resumen')).json.data;
}

async function coinciden() {
  const [a, b] = await Promise.all([resumen(pc), resumen(srv)]);
  return Object.keys(a).every((c) => !b[c] || (a[c].huella === b[c].huella && a[c].vivos === b[c].vivos));
}

async function limpiarBases() {
  const c = new MongoClient(MONGO);
  await c.connect();
  for (const p of [pc, srv]) await c.db(p.db).dropDatabase();
  await c.close();
}

// ---------- pruebas ----------

async function todo() {
  log(`\nCarpeta temporal: ${TMP}`);
  await limpiarBases();
  await new Promise((r) => publica.listen(PUERTO_PUBLICA, '127.0.0.1', r));

  // ---- 1. El servidor de internet, solo y vacío ----
  log('\n[1] El servidor arranca vacío y cerrado a lo que no hace falta en internet');
  await iniciar(srv);
  ok(!!srv.proc, 'arrancó sin Electron y sin ningún archivo de configuración');
  const info = (await apiCruda(srv, 'GET', '/api/sistema/info')).data;
  ok(info.idPc === ID_SERVIDOR, 'su identificador sale de la clave (no del disco)');
  ok(typeof info.segundosEncendido === 'number' && info.segundosEncendido >= 0, 'informa cuánto lleva prendido (así se ve que no se durmió)');

  log('\n[1b] Se visita solo por su dirección pública para que Render no lo duerma');
  await hasta(() => visitas.cantidad >= 2, 'que el servidor se visite solo', 15000);
  ok(true, `se visitó solo ${visitas.cantidad} veces sin que nadie se lo pida`);
  ok([...visitas.rutas].every((r) => r === '/api/sistema/info'), 'siempre pide la misma página liviana (sin duplicar la barra final)');
  ok([...visitas.agentes].every((a) => a === 'mis-amores-despertador'), 'se identifica como el despertador');
  const { direccionPublica } = require(path.join(RAIZ, 'dist-electron/electron/despertador.js'));
  const entornoAntes = { u: process.env.MIS_AMORES_URL_PUBLICA, r: process.env.RENDER_EXTERNAL_URL };
  delete process.env.MIS_AMORES_URL_PUBLICA;
  delete process.env.RENDER_EXTERNAL_URL;
  ok(direccionPublica() === null, 'sin dirección pública conocida, no hace nada');
  process.env.RENDER_EXTERNAL_URL = 'https://mis-amores.onrender.com/';
  ok(direccionPublica() === 'https://mis-amores.onrender.com', 'usa la dirección que Render le da sola (sin barra al final)');
  process.env.MIS_AMORES_URL_PUBLICA = 'https://otra.example.com';
  ok(direccionPublica() === 'https://otra.example.com', 'y se la puede fijar a mano');
  process.env.MIS_AMORES_URL_PUBLICA = 'mis-amores.onrender.com';
  process.env.RENDER_EXTERNAL_URL = '';
  ok(direccionPublica() === null, 'una dirección sin "https://" no se toma (no se adivina)');
  for (const [k, v] of [['MIS_AMORES_URL_PUBLICA', entornoAntes.u], ['RENDER_EXTERNAL_URL', entornoAntes.r]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  log('\n[1c] Cerrado a lo que no corresponde en internet');
  const entradaDeFabrica = await apiCruda(srv, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
  ok(entradaDeFabrica.ok === false, 'NO existe el usuario "admin" con la contraseña de fábrica');
  ok((await apiCruda(srv, 'GET', '/api/auth/cuentas')).ok === false, 'no regala la lista de cuentas');
  ok((await apiCruda(srv, 'GET', '/api/copia/manifiesto')).ok === false, 'no ofrece la copia de la versión anterior');
  ok((await apiCruda(srv, 'POST', '/api/sistema/juntar-datos', { datos: {} })).ok === false, 'no acepta juntar datos');
  const sinFirma = await fetch(`http://127.0.0.1:${srv.puerto}/api/sync/cambios?desde=0`);
  ok(sinFirma.status === 401, 'la sincronización pide la firma de la red');
  const hola = (await pedidoSync(srv, 'GET', '/api/sync/hola')).json.data;
  ok(Array.isArray(hola.pares) && hola.pares.length === 0, 'no anda contando dónde están las PCs del negocio');

  // ---- 2. La PC con datos, que lo llama ----
  log('\n[2] Una PC con sus datos: ella le empuja todo al servidor');
  escribirConfigPc();
  await iniciar(pc);
  const infoPc = (await apiCruda(pc, 'GET', '/api/sistema/info')).data;
  ok(infoPc.segundosEncendido === undefined, 'una PC común no informa "segundos encendido" (eso es sólo del servidor)');
  const rubro = await api(pc, 'POST', '/api/familias', { nombre: 'GOLOSINAS' });
  const alfajor = await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR', codigoBarras: '7790001', familiaId: rubro.id, stock: 20 }));
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CHICLE', codigoBarras: '7790002', familiaId: rubro.id, stock: 5 }));
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'GALLETITAS', stock: 8 }));
  const cliente = await api(pc, 'POST', '/api/clientes', { nombre: 'JUAN PEREZ', nota: null, deudaInicial: 500 });
  await api(pc, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'efectivo' });
  await api(pc, 'POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 1, metodoPago: 'fiado', clienteId: cliente.id });
  const t0 = Date.now();
  await hasta(async () => (await articulos(srv)).length === 3, 'que el servidor reciba los 3 productos', 60000);
  log(`   (llegaron en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  // Los productos llegan primero; las ventas y los movimientos, en los envíos siguientes.
  await hasta(async () => (await porDescripcion(srv, 'ALFAJOR')).stock === 17, 'que el stock del alfajor cierre en 17', 30000);
  ok(true, 'mismo stock (17), calculado desde los movimientos');
  await hasta(
    async () => ((await api(srv, 'GET', '/api/clientes')).find((c) => c.nombre === 'JUAN PEREZ') || {}).saldo === alfajor.precioVenta + 500,
    'que el cliente deba lo mismo',
    30000
  );
  ok(true, 'el cliente debe lo mismo (500 + el fiado)');
  const entrada = await apiCruda(srv, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
  ok(entrada.ok === true, 'el usuario de la PC entra al servidor con su contraseña de siempre');
  await hasta(coinciden, 'que la PC y el servidor coincidan', 40000);
  ok(true, 'la PC y el servidor tienen el mismo "resumen" de datos');

  // ---- 3. En vivo, en los dos sentidos ----
  log('\n[3] Los cambios pasan en vivo, de la PC al servidor y del celular a la PC');
  const t1 = Date.now();
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'DESDE LA PC', stock: 4 }));
  await hasta(async () => porDescripcion(srv, 'DESDE LA PC'), 'que el servidor vea el producto de la PC', 20000);
  ok(Date.now() - t1 < 8000, `lo de la PC aparece en el servidor (${Date.now() - t1} ms)`);
  const galletitas = await porDescripcion(srv, 'GALLETITAS');
  await api(srv, 'PUT', `/api/articulos/${galletitas.id}`, { input: { ...aEntrada(galletitas), precioVenta: 999 }, original: aEntrada(galletitas) });
  await hasta(async () => (await porDescripcion(pc, 'GALLETITAS')).precioVenta === 999, 'que la PC vea el precio del celular', 20000);
  ok(true, 'un precio cambiado desde el celular llega a la PC');
  const desdeLaPc = await porDescripcion(srv, 'DESDE LA PC');
  await api(srv, 'POST', '/api/ventas', { articuloId: desdeLaPc.id, cantidad: 1, metodoPago: 'efectivo' });
  await hasta(async () => (await porDescripcion(pc, 'DESDE LA PC')).stock === 3, 'que la PC vea la venta del celular', 20000);
  ok(true, 'una venta hecha desde el celular descuenta el stock en la PC');

  // ---- 3b. Carga grande ----
  log('\n[3b] Una carga grande: la PC junta 80 productos con el servidor caído y se los manda de una vez');
  const cantidadAntes = (await articulos(srv)).length;
  await detener(srv);
  for (let i = 0; i < 80; i++) {
    await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: `CARGA ${i}`, stock: 10 + i }));
  }
  await iniciar(srv);
  await hasta(async () => (await articulos(srv)).length === cantidadAntes + 80, 'que lleguen los 80 productos', 120000);
  ok(true, 'los 80 productos llegaron al servidor');
  const ultimoBulk = await porDescripcion(srv, 'CARGA 79');
  const primeroBulk = await porDescripcion(srv, 'CARGA 0');
  ok(ultimoBulk && ultimoBulk.stock === 89 && primeroBulk && primeroBulk.stock === 10, 'el stock de cada uno cierra (recalculado al final del lote)');
  await hasta(coinciden, 'que coincidan después de la carga grande', 60000);
  ok(true, 'la PC y el servidor coinciden');

  // ---- 4. Servidor sin disco ----
  log('\n[4] El servidor se reinicia con el disco vacío (como en Render)');
  await detener(srv);
  fs.rmSync(srv.carpeta, { recursive: true, force: true });
  await iniciar(srv);
  const info2 = (await apiCruda(srv, 'GET', '/api/sistema/info')).data;
  ok(info2.idPc === ID_SERVIDOR, 'sigue siendo el mismo servidor de la red');
  ok((await articulos(srv)).length === cantidadAntes + 80, 'conserva todos los datos (están en la base)');
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'DESPUES DEL REINICIO', stock: 2 }));
  await hasta(async () => porDescripcion(srv, 'DESPUES DEL REINICIO'), 'que el servidor siga recibiendo de la PC', 30000);
  ok(true, 'la PC sigue empujando sin repetir ni perder nada');
  const chicle = await porDescripcion(srv, 'CHICLE');
  await api(srv, 'POST', `/api/articulos/${chicle.id}/ajustar-stock`, { cantidad: 5, tipo: 'ingreso', motivo: 'Llegó mercadería' });
  await hasta(async () => (await porDescripcion(pc, 'CHICLE')).stock === 10, 'que la PC reciba el ajuste', 30000);
  ok(true, 'y sigue recibiendo lo del celular');

  // ---- 5. PC apagada / servidor apagado ----
  log('\n[5] La PC se apaga y se cargan cosas en el celular; después el servidor se cae y la PC carga');
  await detener(pc);
  await api(srv, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CARGADO CON LA PC APAGADA', stock: 7 }));
  await iniciar(pc);
  await hasta(async () => porDescripcion(pc, 'CARGADO CON LA PC APAGADA'), 'que la PC reciba lo del celular al prenderse', 60000);
  ok(true, 'al prenderse, la PC recibe lo que se cargó en el celular');
  await detener(srv);
  await api(pc, 'POST', '/api/articulos', entradaArticulo({ descripcion: 'CON EL SERVIDOR CAIDO', stock: 3 }));
  await esperar(3000);
  await iniciar(srv);
  await hasta(async () => porDescripcion(srv, 'CON EL SERVIDOR CAIDO'), 'que el servidor reciba lo que la PC cargó mientras estaba caído', 90000);
  ok(true, 'cuando el servidor vuelve, recibe lo que la PC cargó mientras estaba caído');
  await hasta(coinciden, 'que coincidan al final', 60000);
  ok(true, 'la PC y el servidor terminan idénticos');

  // ---- 6. Servidor con la base vacía ----
  log('\n[6] El servidor pierde su base (Atlas vacío): la PC le vuelve a mandar todo');
  const antes = (await articulos(pc)).length;
  await detener(srv);
  const c = new MongoClient(MONGO);
  await c.connect();
  await c.db(srv.db).dropDatabase();
  await c.close();
  await iniciar(srv);
  // Sin loguearse (todavía no hay usuarios): se mira el "resumen" firmado de la red.
  await hasta(
    async () => ((await resumen(srv)).articulos || {}).vivos === antes,
    `que el servidor vuelva a tener los ${antes} productos`,
    90000
  );
  ok(true, `el servidor recuperó los ${antes} productos desde la PC`);
  ok((await ventasDelDia(srv)).length >= 2, 'y las ventas');
  await hasta(coinciden, 'que coincidan tras la recuperación', 60000);
  ok(true, 'la PC y el servidor siguen idénticos');

  // ---- 7. Seguridad ----
  log('\n[7] Seguridad del servidor en internet');
  const items = BSON.EJSON.stringify({ idPc: pc.idPc, items: [] }, { relaxed: false });
  const bien = await pedidoSync(srv, 'POST', '/api/sync/empujar', items);
  ok(bien.estado === 200 && bien.json.ok === true, 'un "empujar" bien firmado se acepta');
  const cambiado = await pedidoSync(srv, 'POST', '/api/sync/empujar', items, items + ' ');
  ok(cambiado.estado === 401, 'si cambian el contenido del pedido por el camino, se rechaza');
  const sinClave = await fetch(`http://127.0.0.1:${srv.puerto}/api/sync/empujar`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: items,
  });
  ok(sinClave.status === 401, 'sin la firma de la red no entra nada');
  // Sumar una PC a la red entrega la clave de la red: en internet no se ofrece.
  const unirse = await apiCruda(srv, 'POST', '/api/sync/unirse', { idPc: 'otra', nombrePc: 'otra', puerto: 4000 });
  ok(/no está disponible/i.test(unirse.error || ''), 'sumar una PC a la red no está disponible en internet');
  const primero = await apiCruda(srv, 'POST', '/api/auth/login', { usuario: 'intruso', password: 'prueba0' });
  ok(primero.error === 'Usuario o contraseña incorrectos', 'los primeros intentos dicen "incorrectos"');
  let corte = '';
  for (let i = 1; i < 8; i++) {
    corte = (await apiCruda(srv, 'POST', '/api/auth/login', { usuario: 'intruso', password: `prueba${i}` })).error;
  }
  ok(/Demasiados intentos/.test(corte || ''), `después de unos fallos corta los intentos (${corte})`);
  // El límite largo (por hora) del servidor de internet, probado directo.
  const lim = require(path.join(RAIZ, 'dist-electron/electron/server/limiteIntentos.js'));
  const t = Date.now();
  for (let i = 0; i < 10; i++) lim.anotarFallo('10.0.0.9', 'victima', t);
  ok(lim.intentoBloqueado('10.0.0.8', 'victima', t + 1000), 'con 10 fallos en una cuenta se bloquea aunque venga de otra dirección');
  ok(!lim.intentoBloqueado('10.0.0.8', 'victima', t + 61 * 60_000), 'y pasada la hora vuelve a dejar probar');
  lim.limpiarFallos('victima');
  const adminOk = await apiCruda(srv, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
  ok(adminOk.ok === true, 'el límite es por cuenta: la verdadera sigue entrando');
}

async function ventasDelDia(p) {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return api(p, 'GET', `/api/ventas/dia/${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`);
}

todo()
  .catch((err) => {
    fallas += 1;
    log('\n✗ ERROR:', err.message);
  })
  .finally(async () => {
    for (const p of [pc, srv]) await detener(p);
    publica.close();
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
