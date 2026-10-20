// Prueba del asistente con IA (Claude) SIN gastar un centavo: en lugar de la API de Anthropic
// habla con un servidor de mentira que contesta lo que le indica cada pregunta (pedir datos,
// fallar, negarse...). Se comprueba:
//  - la clave: se guarda, se reconoce, se saca, y la variable del sistema funciona
//  - la charla: la IA pide datos, la app los busca de verdad en la base y se los devuelve bien
//  - cada rol ve lo suyo: la empleada nunca recibe costos ni ganancias
//  - los datos de cada herramienta (ventas, productos, stock, clientes, deudas, recordatorios)
//  - que se acuerde de lo hablado, y que la basura que llegue no la rompa
//  - cuando la IA falla (clave mala, sin saldo, sin internet, se niega...) contesta el asistente simple
//  - sin clave, el asistente simple de siempre, sin tocar internet
//
//   npm run build:electron
//   node scripts/probar-asistente-ia.js
//
// Levanta servidores (Node común, sin Electron) con sus propias bases "test_asistente_ia*", su
// carpeta y sus puertos: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO_FALSA = 4291;
const PUERTO_CERRADO = 4299; // nadie escucha: "sin internet"
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-asistente-ia-'));
const CLAVE_PRUEBA = 'sk-ant-api03-' + 'prueba'.repeat(8);

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
const cerca2 = (a, b) => Math.abs(a - b) < 0.01;
const ymdHoy = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const HOY = ymdHoy();

// ---------------------------------------------------------------------------------------------
// La "API de Anthropic" de mentira
// ---------------------------------------------------------------------------------------------
const pedidos = []; // todo lo que la app le mandó: { clave, cuerpo }

const mensaje = (content, stop = 'end_turn') => ({
  id: `msg_prueba_${pedidos.length}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20 },
});
const texto = (t) => ({ type: 'text', text: t });
const uso = (id, name, input) => ({ type: 'tool_use', id, name, input });
const error = (status, tipo, msg) => ({ status, json: { type: 'error', error: { type: tipo, message: msg } } });

// La última pregunta de verdad (un mensaje de la persona que es texto, no resultados de herramientas).
function ultimaPregunta(mensajes) {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    if (mensajes[i].role === 'user' && typeof mensajes[i].content === 'string') return mensajes[i].content;
  }
  return '';
}
// Los resultados de herramientas que la app devolvió desde la última pregunta, en orden.
function resultados(mensajes) {
  return mensajes
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'));
}
const vueltas = (mensajes) => mensajes.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')).length;

function contestar(cuerpo) {
  const q = ultimaPregunta(cuerpo.messages);
  const res = resultados(cuerpo.messages);
  const v = vueltas(cuerpo.messages);
  const bien = (json) => ({ status: 200, json });

  // Respuestas que "gastan" muchos tokens (un millón de entrada y cien mil de salida = US$ 3 con Sonnet 5.5).
  if (q.includes('Q_CARO_FALLA')) {
    if (v === 0) return bien({ ...mensaje([uso('toolu_cf', 'estado_del_catalogo', {})], 'tool_use'), usage: { input_tokens: 1000000, output_tokens: 0 } });
    return error(500, 'api_error', 'Internal server error'); // la 2.ª vuelta falla: lo gastado en la 1.ª igual se anota
  }
  if (q.includes('Q_CARO')) return bien({ ...mensaje([texto('Respuesta cara')]), usage: { input_tokens: 1000000, output_tokens: 100000 } });
  if (q.includes('Q_401')) return error(401, 'authentication_error', 'invalid x-api-key');
  if (q.includes('Q_429')) return error(429, 'rate_limit_error', 'rate limited');
  if (q.includes('Q_500')) return error(500, 'api_error', 'Internal server error');
  if (q.includes('Q_400')) return error(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API');
  if (q.includes('Q_REFUSAL')) return bien(mensaje([texto('no')], 'refusal'));
  if (q.includes('Q_VACIO')) return bien(mensaje([]));
  if (q.includes('Q_BUCLE')) return bien(mensaje([uso(`toolu_bucle_${pedidos.length}`, 'estado_del_catalogo', {})], 'tool_use'));

  if (q.includes('Q_HOY_CRUDO') || q.includes('Q_HOY')) {
    if (v === 0) {
      // Con un bloque "thinking": la app tiene que devolverlo tal cual en la vuelta siguiente.
      return bien(
        mensaje([{ type: 'thinking', thinking: '', signature: 'firma-de-prueba' }, uso('toolu_hoy', 'ventas_por_periodo', { desde: HOY, hasta: HOY })], 'tool_use')
      );
    }
    if (q.includes('Q_HOY_CRUDO')) return bien(mensaje([texto(res[0].content)]));
    const d = JSON.parse(res[0].content);
    return bien(mensaje([texto(`Hoy cobraste ${d.cobrado} en ${d.cantidadDeCompras} compras y fiaste ${d.fiadoSinCobrar}`)]));
  }
  if (q.includes('Q_PRODUCTO')) {
    if (v === 0) return bien(mensaje([uso('toolu_prod', 'buscar_productos', { texto: 'PRODUCTO A', limite: 5 })], 'tool_use'));
    return bien(mensaje([texto(res[0].content)]));
  }
  if (q.includes('Q_ESTADO')) {
    if (v === 0) return bien(mensaje([uso('toolu_estado', 'estado_del_catalogo', {})], 'tool_use'));
    return bien(mensaje([texto(res[0].content)]));
  }
  if (q.includes('Q_STOCK')) {
    if (v === 0) {
      return bien(
        mensaje(
          [
            uso('toolu_s1', 'buscar_productos', { filtro: 'stock_bajo', texto: 'STOCK' }),
            uso('toolu_s2', 'buscar_productos', { filtro: 'sin_stock', texto: 'STOCK' }),
            uso('toolu_s3', 'buscar_productos', { filtro: 'para_revisar', texto: 'STOCK' }),
          ],
          'tool_use'
        )
      );
    }
    return bien(mensaje([texto(JSON.stringify(res.map((r) => JSON.parse(r.content))))]));
  }
  if (q.includes('Q_PARALELO')) {
    if (v === 0) {
      return bien(mensaje([uso('toolu_p1', 'estado_del_catalogo', {}), uso('toolu_p2', 'recordatorios_pendientes', {})], 'tool_use'));
    }
    return bien(mensaje([texto(JSON.stringify(res.map((r) => JSON.parse(r.content))))]));
  }
  if (q.includes('Q_CLIENTES')) {
    if (v === 0) return bien(mensaje([uso('toolu_c1', 'clientes_y_deudas', {})], 'tool_use'));
    if (v === 1) {
      const id = JSON.parse(res[0].content).clientes[0].id;
      return bien(mensaje([uso('toolu_c2', 'movimientos_de_un_cliente', { id })], 'tool_use'));
    }
    return bien(mensaje([texto(JSON.stringify({ clientes: JSON.parse(res[0].content), movimientos: JSON.parse(res[1].content) }))]));
  }
  if (q.includes('Q_BUSCAR_CLIENTE')) {
    if (v === 0) {
      return bien(
        mensaje(
          [
            uso('toolu_b1', 'clientes_y_deudas', { nombre: 'gomez' }),
            uso('toolu_b2', 'clientes_y_deudas', { nombre: 'sin deuda', solo_con_deuda: false }),
            uso('toolu_b3', 'clientes_y_deudas', { nombre: 'nadie existe así' }),
            uso('toolu_b4', 'movimientos_de_un_cliente', { id: 'no-es-un-id' }),
          ],
          'tool_use'
        )
      );
    }
    return bien(mensaje([texto(JSON.stringify(res.map((r) => ({ error: r.is_error === true, contenido: r.content }))))]));
  }
  if (q.includes('Q_FECHAS_MAL')) {
    if (v === 0) {
      return bien(
        mensaje(
          [
            uso('toolu_f1', 'ventas_por_periodo', { desde: 'ayer' }),
            uso('toolu_f2', 'ventas_por_periodo', { desde: '2026-02-30' }),
            uso('toolu_f3', 'ventas_por_periodo', { desde: '2026-05-10', hasta: '2026-05-01' }),
            uso('toolu_f4', 'ventas_por_periodo', { desde: '2020-01-01', hasta: '2026-01-01' }),
            uso('toolu_f5', 'borrar_todo', {}),
            uso('toolu_f6', 'ventas_por_periodo', 'esto no es un objeto'),
          ],
          'tool_use'
        )
      );
    }
    return bien(mensaje([texto(JSON.stringify(res.map((r) => ({ error: r.is_error === true, contenido: r.content, id: r.tool_use_id }))))]));
  }
  return bien(mensaje([texto('Respuesta de prueba')]));
}

const falsa = http.createServer((req, res) => {
  let datos = '';
  req.on('data', (c) => (datos += c));
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    const cuerpo = JSON.parse(datos);
    pedidos.push({ clave: req.headers['x-api-key'], cuerpo });
    const { status, json } = contestar(cuerpo);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
});

// ---------------------------------------------------------------------------------------------
// Los servidores de Mis Amores de prueba
// ---------------------------------------------------------------------------------------------
const servidores = [];
async function vaciarBase(db) {
  const c = new MongoClient(MONGO);
  await c.connect();
  await c.db(db).dropDatabase();
  await c.close();
}
async function levantar({ puerto, db, clave, urlIa, extraEnv = {} }) {
  await vaciarBase(db);
  const entorno = { ...process.env, MONGODB_URI: MONGO, MONGODB_DB_NAME: db, MIS_AMORES_PUERTO: String(puerto), MIS_AMORES_CARPETA_DATOS: path.join(TMP, db) };
  delete entorno.ANTHROPIC_API_KEY;
  delete entorno.MIS_AMORES_CLAVE_IA;
  delete entorno.ANTHROPIC_BASE_URL;
  if (clave) entorno.MIS_AMORES_CLAVE_IA = clave;
  if (urlIa) entorno.ANTHROPIC_BASE_URL = urlIa;
  delete entorno.MIS_AMORES_TOPE_IA_USD;
  Object.assign(entorno, extraEnv);
  const proceso = spawn(process.execPath, [SERVIDOR_JS], { cwd: RAIZ, env: entorno, stdio: ['ignore', 'ignore', 'ignore'] });
  servidores.push({ proceso, db });
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(`http://127.0.0.1:${puerto}/api/sistema/info`)).ok) return `http://127.0.0.1:${puerto}`;
    } catch {
      /* todavía no */
    }
    await esperar(300);
  }
  throw new Error('El servidor de prueba no arrancó');
}
async function detener(db) {
  const s = servidores.find((x) => x.db === db);
  if (!s) return;
  s.proceso.kill();
  await esperar(1500);
}
async function api(base, metodo, ruta, cuerpo, token) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return r.json();
}
function entradaArticulo(base) {
  return {
    codigoBarras: null, descripcion: 'X', marcaId: null, familiaId: null, proveedorId: null,
    precioCosto: 60, precioVenta: 100, precioLista2: 0, precioLista3: 0, utilidadPct: 0,
    stock: 100, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}

// Un modelo "preguntar" para un servidor y una persona.
const preguntador = (base, token) => async (pregunta, historial) =>
  api(base, 'POST', '/api/asistente/preguntar', { pregunta, ...(historial !== undefined ? { historial } : {}) }, token);

// Los pedidos que la app mandó a la API falsa por una pregunta (por la marca que lleva el texto).
const pedidosDe = (marca) => pedidos.filter((p) => ultimaPregunta(p.cuerpo.messages).includes(marca));

(async () => {
  try {
    // ------------------------------------------------------------------ [1] la clave
    log('\n[1] La clave de la IA: se guarda, se reconoce y se saca');
    const carpetaClave = path.join(TMP, 'datos-clave');
    process.env.MIS_AMORES_CARPETA_DATOS = carpetaClave;
    delete process.env.MIS_AMORES_CLAVE_IA;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MIS_AMORES_MODO_SERVIDOR;
    const cargarOriginal = Module._load;
    Module._load = function (pedido, ...resto) {
      if (pedido === 'electron') return require(path.join(RAIZ, 'dist-electron/electron/electronFalso.js'));
      return cargarOriginal.call(this, pedido, ...resto);
    };
    const claves = require(path.join(RAIZ, 'dist-electron/electron/claveIa.js'));
    const archivoClave = path.join(carpetaClave, 'clave-ia.json');

    ok(claves.leerClaveIa() === null, 'al principio no hay clave');
    for (const [malo, que] of [['', 'vacía'], ['   ', 'sólo espacios'], ['hola', 'cualquier texto'], ['sk-ant-corta', 'muy corta'], ['sk-ant-' + 'a'.repeat(15) + ' ' + 'b'.repeat(15), 'con un espacio adentro'], ['sk-openai-' + 'a'.repeat(40), 'de otra empresa']]) {
      let fallo = null;
      try {
        claves.guardarClaveIa(malo);
      } catch (e) {
        fallo = e.message;
      }
      ok(fallo !== null && /sk-ant-|Pegá la clave/.test(fallo), `no acepta una clave ${que}${fallo ? ` ("${fallo.slice(0, 50)}…")` : ''}`);
    }
    ok(!fs.existsSync(archivoClave), 'y con una clave mala no queda ningún archivo');
    claves.guardarClaveIa(`  ${CLAVE_PRUEBA}\n`);
    let leida = claves.leerClaveIa();
    ok(leida && leida.clave === CLAVE_PRUEBA && leida.origen === 'archivo', 'una clave buena se guarda (sacándole los espacios y saltos de línea de los costados)');
    ok(fs.existsSync(archivoClave) && JSON.parse(fs.readFileSync(archivoClave, 'utf-8')).clave === CLAVE_PRUEBA, 'queda en el archivo de esta PC');
    ok(!fs.existsSync(`${archivoClave}.tmp`), 'sin archivos temporales sobrando');
    const pista = claves.pistaDeClave(CLAVE_PRUEBA);
    ok(pista.startsWith('sk-ant-') && pista.endsWith(CLAVE_PRUEBA.slice(-4)) && !pista.includes('prueba' + 'prueba'), `la pista no deja ver la clave entera: ${pista}`);
    process.env.MIS_AMORES_CLAVE_IA = 'sk-ant-' + 'entorno'.repeat(5);
    ok(claves.leerClaveIa().origen === 'archivo', 'si hay las dos, manda la que se cargó en Configuración');
    claves.guardarClaveIa(null);
    ok(!fs.existsSync(archivoClave), 'sacar la clave borra el archivo');
    leida = claves.leerClaveIa();
    ok(leida && leida.origen === 'entorno' && leida.clave.startsWith('sk-ant-entorno'), 'sin archivo, se usa la variable del sistema (así anda en Render)');
    delete process.env.MIS_AMORES_CLAVE_IA;
    ok(claves.leerClaveIa() === null, 'sin archivo ni variable, no hay clave');
    claves.guardarClaveIa(null);
    ok(true, 'sacar la clave cuando no hay ninguna no da error');
    fs.mkdirSync(carpetaClave, { recursive: true });
    fs.writeFileSync(archivoClave, '{esto no es json');
    Module._load = cargarOriginal;
    const claves2 = (() => {
      // Un módulo nuevo (sin lo que el otro ya leyó) frente a un archivo roto.
      delete require.cache[require.resolve(path.join(RAIZ, 'dist-electron/electron/claveIa.js'))];
      Module._load = function (pedido, ...resto) {
        if (pedido === 'electron') return require(path.join(RAIZ, 'dist-electron/electron/electronFalso.js'));
        return cargarOriginal.call(this, pedido, ...resto);
      };
      return require(path.join(RAIZ, 'dist-electron/electron/claveIa.js'));
    })();
    ok(claves2.leerClaveIa() === null, 'un archivo roto (se cortó la luz) se toma como "sin clave", sin romper nada');
    Module._load = cargarOriginal;

    // ------------------------------------------------------------------ [1b] el gasto y el tope, por dentro
    log('\n[1b] El tope de gasto: precios, cuenta del mes, archivo roto y mes nuevo');
    const cargarConElectronFalso = (ruta) => {
      const original = Module._load;
      Module._load = function (pedido, ...resto) {
        if (pedido === 'electron') return require(path.join(RAIZ, 'dist-electron/electron/electronFalso.js'));
        return original.call(this, pedido, ...resto);
      };
      try {
        return require(ruta);
      } finally {
        Module._load = original;
      }
    };
    const rutaUso = path.join(RAIZ, 'dist-electron/electron/usoIa.js');
    const archivoUso = path.join(carpetaClave, 'uso-ia.json');
    const usoNuevo = () => {
      delete require.cache[require.resolve(rutaUso)];
      return cargarConElectronFalso(rutaUso);
    };
    fs.rmSync(archivoUso, { force: true });
    delete process.env.MIS_AMORES_TOPE_IA_USD;
    let uso = usoNuevo();
    const cerca = (a, b) => Math.abs(a - b) < 1e-9;
    ok(cerca(uso.costoEnDolares('claude-sonnet-5-5', 1e6, 1e5), 3), 'Sonnet 5.5: un millón de tokens de entrada + 100 mil de salida = US$ 3 ($2 y $10 por millón)');
    ok(cerca(uso.costoEnDolares('claude-haiku-5-5', 1e6, 1e5), 0.15), 'Haiku 5.5: US$ 0,15 ($0,10 y $0,50 por millón)');
    ok(cerca(uso.costoEnDolares('claude-opus-5-5', 1e6, 1e5), 6) && cerca(uso.costoEnDolares('claude-opus-5', 1e6, 1e5), 7.5), 'Opus 5.5: US$ 6; Opus 5: US$ 7,50');
    ok(cerca(uso.costoEnDolares('claude-haiku-4-5', 1e6, 1e5), 1.5) && cerca(uso.costoEnDolares('claude-sonnet-4-6', 1e6, 1e5), 4.5), 'los modelos viejos tienen su propio precio (Haiku 4.5, Sonnet 4.6)');
    ok(cerca(uso.costoEnDolares('un-modelo-raro', 1e6, 1e5), 15), 'un modelo que no se conoce se calcula como el más caro (US$ 15): se frena de más, no de menos');
    ok(uso.topeMensualUsd() === 10, 'sin elegir nada, el tope es de US$ 10 por mes');
    let g = uso.gastoDelMes();
    ok(g.costoUsd === 0 && g.preguntas === 0 && /^\d{4}-\d{2}$/.test(g.mes) && uso.topeAlcanzado() === false, `el mes arranca en cero (${g.mes})`);
    for (const [texto, esperado, que] of [['25', 25, '"25"'], ['7,5', 7.5, '"7,5" (con coma)'], ['abc', 10, 'un texto'], ['0.5', 10, 'menos del mínimo'], ['5000', 10, 'más del máximo'], ['', 10, 'vacía']]) {
      process.env.MIS_AMORES_TOPE_IA_USD = texto;
      ok(uso.topeMensualUsd() === esperado, `la variable MIS_AMORES_TOPE_IA_USD = ${que} da un tope de US$ ${esperado}`);
    }
    delete process.env.MIS_AMORES_TOPE_IA_USD;
    uso.registrarUso('claude-sonnet-5-5', 1e6, 1e5, true);
    g = uso.gastoDelMes();
    ok(cerca(g.costoUsd, 3) && g.preguntas === 1, `una pregunta cara se suma: US$ ${g.costoUsd}, ${g.preguntas} pregunta`);
    uso.registrarUso('claude-sonnet-5-5', 1e6, 0, false);
    g = uso.gastoDelMes();
    ok(cerca(g.costoUsd, 5) && g.preguntas === 1, 'un gasto que no es una pregunta (la prueba de la clave) suma plata pero no cuenta como pregunta');
    const guardado = JSON.parse(fs.readFileSync(archivoUso, 'utf-8'));
    ok(cerca(guardado.costoUsd, 5) && guardado.preguntas === 1 && guardado.mes === g.mes, 'la cuenta queda guardada en el archivo de la PC');
    ok(!fs.existsSync(`${archivoUso}.tmp`), 'sin archivos temporales sobrando');
    ok(uso.topeAlcanzado() === false, 'con US$ 5 gastados de 10, todavía se puede');
    for (const [valor, que] of [['abc', 'un texto'], [0, 'cero'], [0.5, 'medio dólar'], [1001, 'más de mil'], [NaN, 'NaN'], [null, 'nulo'], [{}, 'un objeto'], [undefined, 'nada'], [-5, 'un negativo']]) {
      let fallo = null;
      try {
        uso.fijarTopeMensualUsd(valor);
      } catch (e) {
        fallo = e.message;
      }
      ok(fallo !== null && /entre 1 y 1\.000/.test(fallo), `no acepta un tope de ${que}`);
    }
    ok(uso.topeMensualUsd() === 10, 'y con los rechazos el tope sigue en 10');
    uso.fijarTopeMensualUsd('7,5');
    ok(uso.topeMensualUsd() === 7.5 && JSON.parse(fs.readFileSync(archivoUso, 'utf-8')).topeUsd === 7.5, 'un tope válido ("7,5") se guarda en el archivo');
    process.env.MIS_AMORES_TOPE_IA_USD = '99';
    ok(uso.topeMensualUsd() === 7.5, 'y manda sobre la variable del sistema');
    delete process.env.MIS_AMORES_TOPE_IA_USD;
    uso.fijarTopeMensualUsd(5);
    ok(uso.topeAlcanzado() === true, 'gastado US$ 5 con tope 5: se llegó (el tope es "hasta acá")');
    uso.fijarTopeMensualUsd(5.01);
    ok(uso.topeAlcanzado() === false, 'con tope 5,01 todavía queda un poquito');
    uso = usoNuevo();
    ok(uso.topeMensualUsd() === 5.01 && cerca(uso.gastoDelMes().costoUsd, 5) && uso.gastoDelMes().preguntas === 1, 'al reabrir la app (módulo nuevo) la cuenta y el tope siguen ahí');
    fs.writeFileSync(archivoUso, JSON.stringify({ topeUsd: 20, mes: '2020-01', costoUsd: 99, preguntas: 40 }));
    uso = usoNuevo();
    g = uso.gastoDelMes();
    ok(g.mes !== '2020-01' && g.costoUsd === 0 && g.preguntas === 0 && uso.topeAlcanzado() === false, 'cuando empieza un mes nuevo la cuenta vuelve a cero (aunque el mes pasado se hubiera pasado)');
    ok(uso.topeMensualUsd() === 20, 'pero el tope elegido se mantiene');
    fs.writeFileSync(archivoUso, '{esto no es json');
    uso = usoNuevo();
    ok(uso.gastoDelMes().costoUsd === 0 && uso.topeMensualUsd() === 10, 'un archivo roto (se cortó la luz) se toma como "sin gasto y tope de siempre"');
    fs.writeFileSync(archivoUso, JSON.stringify({ topeUsd: 0.1, costoUsd: -50, preguntas: 'muchas', mes: 'enero' }));
    uso = usoNuevo();
    g = uso.gastoDelMes();
    ok(uso.topeMensualUsd() === 10 && g.costoUsd === 0 && g.preguntas === 0 && /^\d{4}-\d{2}$/.test(g.mes), 'un archivo con valores absurdos (tope 0,10, gasto negativo, mes "enero") se corrige solo');
    const iaDentro = cargarConElectronFalso(path.join(RAIZ, 'dist-electron/electron/asistenteIa.js'));
    const est = iaDentro.estadoIa();
    ok(est.modelo === 'claude-sonnet-5-5' && typeof est.topeMensualUsd === 'number' && typeof est.gastoMes.costoUsd === 'number' && typeof est.topeAlcanzado === 'boolean', `el estado que ve Configuración trae modelo, gasto y tope (${JSON.stringify({ modelo: est.modelo, tope: est.topeMensualUsd, alcanzado: est.topeAlcanzado })})`);
    fs.rmSync(archivoUso, { force: true });

    // ------------------------------------------------------------------ servidores
    log('\nLevantando la API de mentira y los servidores de prueba...');
    await new Promise((r) => falsa.listen(PUERTO_FALSA, '127.0.0.1', r));
    const URL_FALSA = `http://127.0.0.1:${PUERTO_FALSA}`;
    const base = await levantar({ puerto: 4192, db: 'test_asistente_ia', clave: CLAVE_PRUEBA, urlIa: URL_FALSA });
    const token = (await api(base, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const sesionAdmin = (await api(base, 'GET', '/api/auth/sesion', undefined, token)).data;
    await api(base, 'POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, token);
    const tLucia = (await api(base, 'POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).data.token;
    const preguntar = preguntador(base, token);
    const preguntarLucia = preguntador(base, tLucia);

    // Datos de verdad para que las herramientas tengan qué devolver.
    const crear = async (descripcion, precioVenta, extra = {}) => (await api(base, 'POST', '/api/articulos', entradaArticulo({ descripcion, precioVenta, ...extra }), token)).data;
    const vender = (articulo, cantidad, metodoPago, extra = {}) => api(base, 'POST', '/api/ventas', { articuloId: articulo.id, cantidad, metodoPago, ...extra }, token);
    const aA = await crear('PRODUCTO A', 500, { precioCosto: 300, stock: 50 });
    const aB = await crear('PRODUCTO B', 300);
    await crear('STOCK OK', 100, { stock: 10, stockMinimo: 2 });
    await crear('STOCK BAJO UNO', 100, { stock: 2, stockMinimo: 2 });
    await crear('STOCK BAJO DOS', 100, { stock: 1, stockMinimo: 5 });
    await crear('STOCK AGOTADO', 100, { stock: 0, stockMinimo: 2 });
    const neg = await crear('STOCK NEGATIVO', 100, { stock: 1, stockMinimo: 2 });
    await vender(neg, 4, 'efectivo'); // queda en -3
    const marta = (await api(base, 'POST', '/api/clientes', { nombre: 'Marta Gómez', nota: 'Llamar el viernes', telefono: '11-5555-1234', deudaInicial: 0 }, token)).data;
    await api(base, 'POST', '/api/clientes', { nombre: 'Pedro Sin Deuda', nota: null, telefono: null, deudaInicial: 0 }, token);
    await vender(aA, 2, 'efectivo', { ticketId: 'a'.repeat(24) });
    await vender(aB, 1, 'tarjeta', { ticketId: 'b'.repeat(24) });
    await vender(aA, 1, 'fiado', { ticketId: 'c'.repeat(24), clienteId: marta.id });
    await api(base, 'POST', `/api/clientes/${marta.id}/pago`, { monto: 100, nota: null, metodoPago: 'efectivo' }, token);
    await api(base, 'POST', '/api/recordatorios', { texto: 'Pedir más cajas al proveedor', tipo: 'reponer', urgente: true, paraFecha: HOY }, token);
    const resumenHoy = (await api(base, 'GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    const clienteMarta = (await api(base, 'GET', '/api/clientes', undefined, token)).data.find((c) => c.id === marta.id);

    // ------------------------------------------------------------------ [2] la charla, de punta a punta
    log('\n[2] La IA pide datos, la app los busca en la base y se los devuelve');
    pedidos.length = 0;
    const r1 = await preguntar('¿Cuánto vendí hoy? Q_HOY');
    ok(r1.ok && r1.data.modo === 'ia' && r1.data.reconocida === true, `contesta la IA (modo "${r1.data?.modo}")`);
    ok(!r1.data.aviso, 'y sin ningún aviso');
    ok(
      r1.data.texto === `Hoy cobraste ${resumenHoy.totalCobrado} en ${resumenHoy.cantidadVentas} compras y fiaste ${resumenHoy.totalFiado}`,
      `los números que usa salen de la base (cobrado ${resumenHoy.totalCobrado}, ${resumenHoy.cantidadVentas} compras, fiado ${resumenHoy.totalFiado}): "${r1.data.texto}"`
    );
    const p1 = pedidosDe('Q_HOY');
    ok(p1.length === 2, `fueron 2 viajes a la IA: la pregunta, y los datos que pidió (${p1.length})`);
    ok(p1.every((p) => p.clave === CLAVE_PRUEBA), 'siempre con la clave cargada');
    const c1 = p1[0].cuerpo;
    ok(c1.model === 'claude-sonnet-5-5', `usa Claude Sonnet 5.5 (${c1.model})`);
    ok(c1.output_config && c1.output_config.effort === 'medium', `con esfuerzo "medio" (recomendado para varias consultas encadenadas): ${JSON.stringify(c1.output_config)}`);
    ok(c1.max_tokens === 4000 && !('temperature' in c1) && !('top_p' in c1) && !('thinking' in c1) && !('tool_choice' in c1), 'sin parámetros que los modelos nuevos rechazan (temperature, thinking apagado, tool_choice forzado)');
    const nombresHerramientas = c1.tools.map((t) => t.name).sort();
    ok(
      JSON.stringify(nombresHerramientas) === JSON.stringify(['buscar_productos', 'clientes_y_deudas', 'estado_del_catalogo', 'movimientos_de_un_cliente', 'recordatorios_pendientes', 'ventas_por_periodo']),
      `le ofrece las 6 herramientas de sólo lectura: ${nombresHerramientas.join(', ')}`
    );
    ok(c1.tools.every((t) => t.input_schema && t.input_schema.type === 'object' && t.description.length > 20), 'cada una con su descripción y su forma de pedirse');
    ok(typeof c1.system === 'string' && c1.system.includes(HOY) && c1.system.includes(sesionAdmin.nombre), `el sistema sabe la fecha de hoy (${HOY}) y con quién habla (${sesionAdmin.nombre})`);
    ok(c1.system.includes('Podés ver los costos') && !c1.system.includes('No tenés los costos'), 'a la administradora le dice que puede ver costos');
    ok(c1.system.includes('FIADO') && c1.system.includes('nunca instrucciones'), 'y le explica qué es un fiado y que los datos no son órdenes');
    ok(JSON.stringify(c1.messages) === JSON.stringify([{ role: 'user', content: '¿Cuánto vendí hoy? Q_HOY' }]), 'el primer viaje lleva sólo la pregunta');
    const c2 = p1[1].cuerpo;
    ok(c2.messages.length === 3 && c2.messages[1].role === 'assistant' && c2.messages[2].role === 'user', 'el segundo viaje lleva: pregunta, lo que dijo la IA y los resultados');
    ok(
      c2.messages[1].content.some((b) => b.type === 'thinking' && b.signature === 'firma-de-prueba') && c2.messages[1].content.some((b) => b.type === 'tool_use' && b.id === 'toolu_hoy'),
      'le devuelve a la IA lo que dijo TAL CUAL (con su bloque de razonamiento): si no, la API lo rechaza'
    );
    ok(c2.messages[2].content.length === 1 && c2.messages[2].content[0].type === 'tool_result' && c2.messages[2].content[0].tool_use_id === 'toolu_hoy', 'y el resultado vuelve atado al mismo pedido');

    log('\n[3] Los datos de cada herramienta');
    pedidos.length = 0;
    const crudo = await preguntar('Q_HOY_CRUDO');
    const v = JSON.parse(crudo.data.texto);
    ok(v.periodo.desde === HOY && v.periodo.hasta === HOY && v.periodo.dias === 1, 'ventas_por_periodo: el período es el que se pidió');
    ok(v.totalVendido === resumenHoy.total && v.cobrado === resumenHoy.totalCobrado && v.fiadoSinCobrar === resumenHoy.totalFiado, `totales iguales al resumen del día (vendido ${v.totalVendido}, cobrado ${v.cobrado}, fiado ${v.fiadoSinCobrar})`);
    ok(v.totalVendido === v.cobrado + v.fiadoSinCobrar, 'vendido = cobrado + fiado');
    ok(v.pagosDeCuentasRecibidos.total === 100 && v.pagosDeCuentasRecibidos.cantidad === 1, 'los pagos de cuentas corrientes van aparte ($100)');
    ok(v.cantidadDeCompras === resumenHoy.cantidadVentas, `las compras son tickets, no productos sueltos (${v.cantidadDeCompras})`);
    const porForma = Object.fromEntries(v.porFormaDePago.map((f) => [f.formaDePago, f.total]));
    ok(porForma.efectivo === 1000 + 400 && porForma.tarjeta === 300 && porForma.fiado === 500, `por forma de pago: ${JSON.stringify(porForma)}`);
    ok(v.productosMasVendidosPorUnidades[0].producto === 'STOCK NEGATIVO' && v.productosMasVendidosPorUnidades[0].unidades === 4 && v.productosMasVendidosPorUnidades[1].producto === 'PRODUCTO A', 'más vendido por unidades: STOCK NEGATIVO (4), después PRODUCTO A (3)');
    ok(Array.isArray(v.productosQueMasPlataDejaron) && v.productosQueMasPlataDejaron[0].producto === 'PRODUCTO A' && v.productosQueMasPlataDejaron[0].total === 1500, 'pero el que más plata dejó es PRODUCTO A ($1.500): son listas distintas');
    ok(Array.isArray(v.porDia) && v.porDia.length === 1 && v.porDia[0].fecha === HOY && v.porDia[0].pagosDeCuentas === 100, 'el detalle día por día trae hoy');
    ok(Array.isArray(v.porRubro), 'y el reparto por rubro');

    pedidos.length = 0;
    const prod = JSON.parse((await preguntar('Q_PRODUCTO')).data.texto);
    ok(prod.totalQueCoinciden === 1 && prod.productos[0].producto === 'PRODUCTO A' && prod.productos[0].precioVenta === 500 && prod.productos[0].stock === 47, `buscar_productos: precio y stock reales (${JSON.stringify(prod.productos[0]).slice(0, 110)}…)`);
    ok(prod.productos[0].precioCosto === 300 && prod.productos[0].gananciaPorcentaje !== undefined, 'a la administradora le trae el costo y la ganancia');
    const sistemaAdmin = pedidosDe('Q_PRODUCTO')[0].cuerpo.system;

    pedidos.length = 0;
    const prodLucia = JSON.parse((await preguntarLucia('Q_PRODUCTO')).data.texto);
    ok(prodLucia.productos[0].precioVenta === 500, 'a la empleada le trae el precio de venta');
    ok(!('precioCosto' in prodLucia.productos[0]) && !('gananciaPorcentaje' in prodLucia.productos[0]), 'pero NUNCA el costo ni la ganancia');
    const rawLucia = pedidosDe('Q_PRODUCTO')[1].cuerpo.messages[2].content[0].content;
    ok(!rawLucia.includes('precioCosto') && !rawLucia.includes('gananciaPorcentaje'), 'ni siquiera viaja a la IA el campo del costo (se mira lo que recibió la API)');
    const sistemaLucia = pedidosDe('Q_PRODUCTO')[0].cuerpo.system;
    ok(sistemaLucia.includes('No tenés los costos') && sistemaLucia.includes('Lucía') && sistemaLucia !== sistemaAdmin, 'y a la IA se le dice que con ella no hay costos (y con quién habla)');

    const estAdmin = JSON.parse((await preguntar('Q_ESTADO')).data.texto);
    const estLucia = JSON.parse((await preguntarLucia('Q_ESTADO')).data.texto);
    ok(estAdmin.productosActivos === 7 && estAdmin.conStockBajo === 2 && estAdmin.sinStock === 2 && estAdmin.paraContar === 1, `estado_del_catalogo: 7 productos, 2 con poco stock, 2 sin stock, 1 para contar (${JSON.stringify(estAdmin).slice(0, 120)})`);
    ok('valorDelInventarioAPrecioDeCosto' in estAdmin && !('valorDelInventarioAPrecioDeCosto' in estLucia), 'el valor del inventario a costo es sólo de la administradora');
    ok(estLucia.productosActivos === 7 && estLucia.valorDelInventarioAPrecioDeVenta === estAdmin.valorDelInventarioAPrecioDeVenta, 'lo demás lo ven las dos igual');

    pedidos.length = 0;
    const stock = JSON.parse((await preguntar('Q_STOCK')).data.texto);
    const nombresDe = (lista) => lista.productos.map((p) => p.producto).sort();
    ok(JSON.stringify(nombresDe(stock[0])) === JSON.stringify(['STOCK BAJO DOS', 'STOCK BAJO UNO']), `filtro "stock_bajo": quedan pocos pero hay (${nombresDe(stock[0]).join(', ')})`);
    ok(JSON.stringify(nombresDe(stock[1])) === JSON.stringify(['STOCK AGOTADO', 'STOCK NEGATIVO']), `filtro "sin_stock": ya no quedan (${nombresDe(stock[1]).join(', ')})`);
    ok(JSON.stringify(nombresDe(stock[2])) === JSON.stringify(['STOCK NEGATIVO']) && stock[2].productos[0].stock === -3, 'filtro "para_revisar": el que se vendió sin stock (-3)');
    const pStock = pedidosDe('Q_STOCK');
    const ultimoUser = pStock[1].cuerpo.messages[pStock[1].cuerpo.messages.length - 1];
    ok(pStock.length === 2 && ultimoUser.role === 'user' && ultimoUser.content.length === 3 && ultimoUser.content.every((b) => b.type === 'tool_result'), 'tres pedidos a la vez vuelven juntos, en UN solo mensaje (si no, la IA deja de pedir en paralelo)');
    ok(JSON.stringify(ultimoUser.content.map((b) => b.tool_use_id)) === JSON.stringify(['toolu_s1', 'toolu_s2', 'toolu_s3']), 'y cada resultado con el id de su pedido');

    pedidos.length = 0;
    const par = JSON.parse((await preguntar('Q_PARALELO')).data.texto);
    ok(par[0].productosActivos === 7, 'dos herramientas distintas en un mismo viaje: el estado del catálogo');
    ok(par[1].total === 1 && par[1].recordatorios[0].texto === 'Pedir más cajas al proveedor' && par[1].recordatorios[0].urgente === true, 'y el recordatorio pendiente (urgente)');

    pedidos.length = 0;
    const cli = JSON.parse((await preguntar('Q_CLIENTES')).data.texto);
    ok(pedidosDe('Q_CLIENTES').length === 3, 'una pregunta puede encadenar varias vueltas: primero los clientes, después los movimientos de uno (3 viajes)');
    ok(cli.clientes.clientesQueDebenEnTotal === 1 && cli.clientes.deudaTotalDeTodos === clienteMarta.saldo && clienteMarta.saldo === 400, `clientes_y_deudas: debe $${clienteMarta.saldo} (500 de fiado menos 100 que pagó)`);
    ok(cli.clientes.clientes.length === 1 && cli.clientes.clientes[0].nombre === 'Marta Gómez' && cli.clientes.clientes[0].debe === 400, 'sin nombre trae sólo a quienes deben');
    ok(cli.clientes.clientes[0].debeDesde === HOY && cli.clientes.clientes[0].ultimoFiado === HOY, 'con las fechas como día (AAAA-MM-DD)');
    ok(!JSON.stringify(cli).includes('5555'), 'el teléfono de los clientes NO se manda a la IA');
    ok(cli.movimientos.totalDeMovimientos === 2, 'movimientos_de_un_cliente: 2 movimientos (el fiado y el pago)');
    const tipos = cli.movimientos.movimientos.map((m) => m.tipo).sort();
    ok(JSON.stringify(tipos) === JSON.stringify(['fiado', 'pago']), `con su tipo en palabras (${tipos.join(', ')})`);
    ok(cli.movimientos.movimientos.find((m) => m.tipo === 'fiado').faltaPagar === 400, 'y cuánto falta pagar del fiado (los pagos se descuentan de lo más viejo)');

    pedidos.length = 0;
    const bus = JSON.parse((await preguntar('Q_BUSCAR_CLIENTE')).data.texto);
    ok(!bus[0].error && JSON.parse(bus[0].contenido).clientes[0].nombre === 'Marta Gómez', 'buscar por nombre, sin tildes ni mayúsculas ("gomez" encuentra a Gómez)');
    const sinDeuda = JSON.parse(bus[1].contenido);
    ok(sinDeuda.totalQueCoinciden === 1 && sinDeuda.clientes[0].nombre === 'Pedro Sin Deuda' && sinDeuda.clientes[0].debe === 0, 'con solo_con_deuda=false también trae a quien no debe nada');
    const nadie = JSON.parse(bus[2].contenido);
    ok(nadie.totalQueCoinciden === 0 && nadie.clientes.length === 0, 'un nombre que no existe devuelve vacío (no un error)');
    ok(bus[3].error === true && /id de cliente no es válido/.test(bus[3].contenido), `un id de cliente inventado: error claro para la IA ("${bus[3].contenido.slice(0, 60)}…")`);

    pedidos.length = 0;
    const mal = JSON.parse((await preguntar('Q_FECHAS_MAL')).data.texto);
    ok(mal.length === 6 && mal.every((m) => m.error), 'pedidos mal hechos: los 6 vuelven como error (la charla no se rompe)');
    ok(/formato AAAA-MM-DD/.test(mal[0].contenido) && /formato AAAA-MM-DD/.test(mal[1].contenido), 'una fecha como "ayer" o un 30 de febrero: le explica el formato');
    ok(/mismo día que "hasta" o uno anterior/.test(mal[2].contenido), 'fechas al revés: se lo dice');
    ok(/demasiado largo/.test(mal[3].contenido), 'un período de años: pide hacerlo por partes');
    ok(/No existe la herramienta "borrar_todo"/.test(mal[4].contenido), 'una herramienta que no existe (nunca se ejecuta nada raro)');
    ok(mal[5].error, 'y un pedido con la forma equivocada tampoco la rompe');
    ok(JSON.stringify(mal.map((m) => m.id)) === JSON.stringify(['toolu_f1', 'toolu_f2', 'toolu_f3', 'toolu_f4', 'toolu_f5', 'toolu_f6']), 'cada error vuelve atado a su pedido');

    // ------------------------------------------------------------------ [4] memoria y basura
    log('\n[4] Se acuerda de lo hablado, y lo raro que llegue no la rompe');
    pedidos.length = 0;
    await preguntar('¿y ayer? Q_MEM', [
      { rol: 'asistente', texto: 'respuesta suelta del principio' },
      { rol: 'usuario', texto: '¿Cuánto vendí hoy?' },
      { rol: 'asistente', texto: 'Hoy cobraste $1.700.' },
    ]);
    const mem = pedidosDe('Q_MEM')[0].cuerpo.messages;
    ok(mem.length === 3 && mem[0].role === 'user' && mem[0].content === '¿Cuánto vendí hoy?', 'lo anterior viaja, y arranca siempre con una pregunta (se descarta la respuesta suelta del principio)');
    ok(mem[1].role === 'assistant' && mem[1].content === 'Hoy cobraste $1.700.' && mem[2].content === '¿y ayer? Q_MEM', 'después la respuesta de antes y la pregunta nueva');
    pedidos.length = 0;
    const muchos = Array.from({ length: 30 }, (_, i) => ({ rol: i % 2 === 0 ? 'usuario' : 'asistente', texto: `mensaje ${i}` }));
    await preguntar('Q_MUCHOS', muchos);
    const mm = pedidosDe('Q_MUCHOS')[0].cuerpo.messages;
    ok(mm.length <= 13, `una charla larguísima se recorta (${mm.length} mensajes en total, no 31)`);
    ok(mm[mm.length - 2].content === 'mensaje 29' || mm[mm.length - 2].content === 'mensaje 28', 'y se queda con lo más reciente');
    for (const [basura, que] of [
      ['texto', 'un texto'],
      [{ rol: 'usuario' }, 'un objeto'],
      [[null, 5, 'x', { rol: 'otro', texto: 'a' }, { rol: 'usuario', texto: 5 }, { rol: 'usuario', texto: '   ' }, { texto: 'sin rol' }], 'una lista con basura adentro'],
    ]) {
      const r = await preguntar('Q_BASURA', basura);
      ok(r.ok && r.data.modo === 'ia' && r.data.texto === 'Respuesta de prueba', `de historial llega ${que}: contesta igual`);
    }
    const pBasura = pedidosDe('Q_BASURA');
    ok(pBasura.every((p) => p.cuerpo.messages.length === 1), 'y la basura no se manda a la IA (viaja sólo la pregunta)');
    const larga = await preguntar('a'.repeat(601));
    ok(larga.ok === false && /muy larga/.test(larga.error), `una pregunta de más de 600 letras se rechaza ("${larga.error}")`);
    const antesVacia = pedidos.length;
    const vacia = await preguntar('   ');
    ok(vacia.ok && vacia.data.modo === 'simple' && /Te puedo contestar/.test(vacia.data.texto) && pedidos.length === antesVacia, 'una pregunta vacía muestra la ayuda, sin gastar un viaje a la IA');
    const sinPregunta = await api(base, 'POST', '/api/asistente/preguntar', {}, token);
    ok(sinPregunta.ok && sinPregunta.data.modo === 'simple', 'sin el campo "pregunta" tampoco se rompe');
    const sinSesion = await api(base, 'POST', '/api/asistente/preguntar', { pregunta: 'hola' });
    ok(sinSesion.ok === false && /sesión/i.test(sinSesion.error), `sin iniciar sesión no contesta ("${sinSesion.error}")`);

    // ------------------------------------------------------------------ [5] cuando la IA falla
    log('\n[5] Cuando la IA falla, contesta el asistente simple (con un aviso claro)');
    const fallas401 = await preguntar('¿Cuánto vendí hoy? Q_401');
    ok(fallas401.ok && fallas401.data.modo === 'simple' && /^Hoy /.test(fallas401.data.texto), `clave mala: contesta el simple y la pregunta se entiende igual ("${fallas401.data.texto.slice(0, 60)}…")`);
    ok(/La clave de la IA no sirve/.test(fallas401.data.aviso) && /Configuración/.test(fallas401.data.aviso), `y avisa qué pasó y dónde arreglarlo ("${fallas401.data.aviso}")`);
    const f429 = await preguntar('Q_429');
    ok(f429.data.modo === 'simple' && /demasiados pedidos/.test(f429.data.aviso), 'demasiados pedidos: lo avisa');
    pedidos.length = 0;
    const f500 = await preguntar('Q_500');
    ok(f500.data.modo === 'simple' && /tuvo un problema/.test(f500.data.aviso), 'la IA se cae (error 500): contesta el simple');
    ok(pedidosDe('Q_500').length === 2, `y se reintenta una vez antes de rendirse (${pedidosDe('Q_500').length} intentos)`);
    const f400 = await preguntar('Q_400');
    ok(f400.data.modo === 'simple' && /saldo/.test(f400.data.aviso), 'sin saldo en la cuenta: se lo sugiere');
    const fNo = await preguntar('Q_REFUSAL');
    ok(fNo.data.modo === 'simple' && /no quiso contestar/.test(fNo.data.aviso), 'la IA se niega: se avisa');
    const fVacio = await preguntar('Q_VACIO');
    ok(fVacio.data.modo === 'simple' && /no armó una respuesta/.test(fVacio.data.aviso), 'la IA no dice nada: se avisa');
    pedidos.length = 0;
    const bucle = await preguntar('Q_BUCLE');
    ok(pedidosDe('Q_BUCLE').length === 6, `una IA que no para de pedir datos se corta a las 6 vueltas (${pedidosDe('Q_BUCLE').length})`);
    ok(bucle.data.modo === 'simple' && /demasiadas consultas/.test(bucle.data.aviso), 'y se avisa');
    ok(fallas401.data.aviso.endsWith('Te contesto con el asistente simple.'), 'siempre aclara que ahora contesta el asistente simple');

    // ------------------------------------------------------------------ [6] sin clave
    log('\n[6] Sin clave: el asistente simple de siempre, sin tocar internet');
    const baseSinClave = await levantar({ puerto: 4193, db: 'test_asistente_ia_sin_clave', clave: null, urlIa: URL_FALSA });
    const tSin = (await api(baseSinClave, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    pedidos.length = 0;
    const sc = await preguntador(baseSinClave, tSin)('¿Cuánto vendí hoy? Q_HOY');
    ok(sc.ok && sc.data.modo === 'simple' && !sc.data.aviso && /^Todavía no hay ventas/.test(sc.data.texto), `contesta el simple, sin avisos ("${sc.data.texto}")`);
    ok(pedidos.length === 0, 'y no hace ni un viaje a la IA');
    const sc2 = await preguntador(baseSinClave, tSin)('hola');
    ok(sc2.ok && sc2.data.modo === 'simple' && /Te puedo contestar/.test(sc2.data.texto), 'el saludo y la ayuda siguen andando');

    // ------------------------------------------------------------------ [7] sin internet
    log('\n[7] Sin internet: contesta el asistente simple');
    const baseCaida = await levantar({ puerto: 4194, db: 'test_asistente_ia_sin_red', clave: CLAVE_PRUEBA, urlIa: `http://127.0.0.1:${PUERTO_CERRADO}` });
    const tCaida = (await api(baseCaida, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const sr = await preguntador(baseCaida, tCaida)('¿Cuánto vendí hoy?');
    ok(sr.ok && sr.data.modo === 'simple' && /No pude conectarme con la IA/.test(sr.data.aviso), `no hay conexión: lo avisa ("${sr.data.aviso}")`);
    ok(/^Todavía no hay ventas/.test(sr.data.texto), 'y la pregunta se contesta igual con el asistente simple');

    // ------------------------------------------------------------------ [8] el tope de gasto, de punta a punta
    log('\n[8] El tope de gasto: se frena solo, y sigue frenado al reiniciar');
    const DB_TOPE = 'test_asistente_ia_tope';
    const urlTope = await levantar({ puerto: 4195, db: DB_TOPE, clave: CLAVE_PRUEBA, urlIa: URL_FALSA, extraEnv: { MIS_AMORES_TOPE_IA_USD: '5' } });
    let tTope = (await api(urlTope, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const pTope = (...a) => preguntador(urlTope, tTope)(...a);
    const archivoUsoServidor = path.join(TMP, DB_TOPE, 'uso-ia.json');
    pedidos.length = 0;
    const c1r = await pTope('hola Q_CARO_FALLA');
    ok(c1r.ok && c1r.data.modo === 'simple' && /tuvo un problema/.test(c1r.data.aviso), 'una pregunta que falla a la mitad contesta el simple');
    await esperar(300);
    let usoSrv = JSON.parse(fs.readFileSync(archivoUsoServidor, 'utf-8'));
    ok(cerca2(usoSrv.costoUsd, 2) && usoSrv.preguntas === 1, `lo que se gastó antes de fallar igual se anota: US$ ${usoSrv.costoUsd} (la primera vuelta, un millón de tokens de entrada)`);
    const c2r = await pTope('hola Q_CARO');
    ok(c2r.ok && c2r.data.modo === 'ia' && c2r.data.texto === 'Respuesta cara', 'con US$ 2 de 5 todavía contesta la IA');
    const antesBloqueo = pedidos.length;
    const c3r = await pTope('¿Cuánto vendí hoy? Q_HOY');
    ok(c3r.ok && c3r.data.modo === 'simple' && /Se llegó al tope de gasto de la IA de este mes \(US\$ 5,00 de US\$ 5,00\)/.test(c3r.data.aviso), `con US$ 5 de 5 se frena y lo avisa ("${(c3r.data.aviso || '').slice(0, 90)}…")`);
    ok(/Configuración/.test(c3r.data.aviso) && /mes que viene/.test(c3r.data.aviso), 'diciendo dónde subirlo y cuándo vuelve sola');
    ok(/^Todavía no hay ventas/.test(c3r.data.texto), 'y la pregunta se contesta igual con el asistente simple');
    ok(pedidos.length === antesBloqueo, 'frenado no hace ni un viaje más a la IA (no gasta nada)');
    usoSrv = JSON.parse(fs.readFileSync(archivoUsoServidor, 'utf-8'));
    ok(cerca2(usoSrv.costoUsd, 5) && usoSrv.preguntas === 2, `la cuenta quedó en US$ ${usoSrv.costoUsd} y ${usoSrv.preguntas} preguntas`);
    await detener(DB_TOPE);
    const urlTope2 = await levantar({ puerto: 4195, db: DB_TOPE, clave: CLAVE_PRUEBA, urlIa: URL_FALSA, extraEnv: { MIS_AMORES_TOPE_IA_USD: '5' } });
    tTope = (await api(urlTope2, 'POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const c4r = await preguntador(urlTope2, tTope)('hola Q_CARO');
    ok(c4r.ok && c4r.data.modo === 'simple' && /tope de gasto/.test(c4r.data.aviso) && pedidos.length === antesBloqueo, 'al reiniciar el servidor, sigue frenado (la cuenta se guarda en el disco, no se "olvida")');
  } catch (err) {
    fallas += 1;
    log('\n✗ La prueba se cortó:', err && err.stack ? err.stack : err);
  } finally {
    for (const s of servidores) s.proceso.kill();
    falsa.close();
    await esperar(800);
    for (const s of servidores) {
      try {
        await vaciarBase(s.db);
      } catch {
        /* nada */
      }
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* nada */
    }
    log(`\n${fallas === 0 ? '✔' : '✘'} ${pasaron} comprobaciones bien, ${fallas} falla(s)`);
    process.exit(fallas === 0 ? 0 : 1);
  }
})();
