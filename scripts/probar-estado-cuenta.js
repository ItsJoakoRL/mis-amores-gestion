// Prueba del estado de cuenta de los clientes (fiados): los datos, el enlace
// firmado que va en el código QR, el PDF que se descarga sin usuario ni
// contraseña, y que un enlace adulterado, vencido o de otro cliente no sirva.
//
//   npm run build:electron
//   node scripts/probar-estado-cuenta.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_estado", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4184;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_estado';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-estado-'));
const CARPETA_DATOS = path.join(TMP, 'datos');
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');
// Los enlaces que arma esta prueba tienen que apuntar al servidor de prueba y no a
// la dirección real de internet del negocio (esa es la que se usa si no se dice otra).
process.env.MIS_AMORES_URL_PUBLICA = BASE;
const { crearEnlaceEstado, verificarEnlaceEstado, armarPdfEstado, nombreArchivoEstado, VIGENCIA_ENLACE_SEGUNDOS } = require(
  path.join(RAIZ, 'dist-electron/electron/estadoCuenta.js')
);

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
    env: {
      ...process.env,
      MONGODB_URI: MONGO,
      MONGODB_DB_NAME: DB,
      MIS_AMORES_PUERTO: String(PUERTO),
      MIS_AMORES_CARPETA_DATOS: CARPETA_DATOS,
      // La dirección pública del servidor (en internet la pone el servicio solo).
      MIS_AMORES_URL_PUBLICA: BASE,
    },
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
    stock: 50, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();
    let r = await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
    const token = r.data.token;
    const claveRed = JSON.parse(fs.readFileSync(path.join(CARPETA_DATOS, 'configuracion-pc.json'), 'utf8')).claveRed;
    ok(typeof claveRed === 'string' && claveRed.length > 0, 'el servidor tiene la clave de la red (con ella se firman los enlaces)');

    // ---- Datos de prueba ----
    const alfajor = (await api('POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR TRIPLE', precioVenta: 100 }), token)).data;
    const queso = (await api('POST', '/api/articulos', entradaArticulo({ descripcion: 'QUESO CREMOSO', precioVenta: 100 }), token)).data;
    const juan = (await api('POST', '/api/clientes', { nombre: 'JUAN PÉREZ', nota: null, deudaInicial: 500 }, token)).data;
    const otro = (await api('POST', '/api/clientes', { nombre: 'OTRA PERSONA', nota: null, deudaInicial: 90 }, token)).data;
    await api('POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'fiado', clienteId: juan.id }, token); // +200
    const ventaPagada = (await api('POST', '/api/ventas', { articuloId: queso.id, cantidad: 3, metodoPago: 'fiado', clienteId: juan.id }, token)).data; // +300 (se marca pagada)
    await api('POST', `/api/ventas/${ventaPagada.id}/pagado`, { pagado: true }, token);
    await api('POST', `/api/clientes/${juan.id}/pago`, { monto: 150, nota: null, metodoPago: 'efectivo' }, token);

    log('\n[1] Los datos del estado de cuenta');
    r = await api('GET', `/api/clientes/${juan.id}/estado`, undefined, token);
    ok(r.ok && r.data.nombre === 'JUAN PÉREZ', 'trae el nombre del cliente');
    ok(r.data.saldo === 550, `debe $550 (500 de antes + 200 de fiado - 150 de pago; el fiado marcado como pagado no cuenta) → ${r.data.saldo}`);
    ok(r.data.pendientes.length === 2, `lo pendiente son 2 líneas: el saldo inicial y el fiado sin pagar (${r.data.pendientes.length})`);
    ok(r.data.pendientes.some((l) => /2 x ALFAJOR TRIPLE/.test(l.descripcion) && l.monto === 200), 'el fiado sin pagar dice "2 x ALFAJOR TRIPLE" por $200');
    ok(!r.data.pendientes.some((l) => /QUESO/.test(l.descripcion)), 'el fiado ya marcado como pagado no aparece');
    ok(r.data.pagos.length === 1 && r.data.pagos[0].monto === 150, 'el pago de $150 figura aparte');
    const lista = (await api('GET', '/api/clientes', undefined, token)).data;
    ok(lista.find((c) => c.id === juan.id).saldo === r.data.saldo, 'es el mismo saldo que muestra la lista de clientes');
    r = await api('GET', `/api/clientes/${otro.id}/estado`, undefined, token);
    ok(r.data.saldo === 90 && r.data.pendientes.length === 1, 'otra persona: sólo lo suyo (90)');

    log('\n[2] Sólo con sesión se piden los datos y el enlace');
    ok((await api('GET', `/api/clientes/${juan.id}/estado`)).ok === false, 'sin sesión no se ven los datos');
    ok((await api('POST', `/api/clientes/${juan.id}/enlace-estado`)).ok === false, 'sin sesión no se arma el enlace');
    ok((await api('GET', `/api/clientes/${juan.id}/estado-pdf`)).ok === false, 'sin sesión no se baja el PDF por la API');
    ok(rechazo(await api('GET', '/api/clientes/000000000000000000000000/estado', undefined, token), 'ya no está'), 'un cliente que no existe se rechaza con un aviso claro');
    ok(rechazo(await api('POST', '/api/clientes/no-es-un-id/enlace-estado', undefined, token), 'ya no está'), 'un código roto también');

    log('\n[3] El enlace del código QR');
    r = await api('POST', `/api/clientes/${juan.id}/enlace-estado`, undefined, token);
    ok(r.ok && r.data.url.startsWith(`${BASE}/estado/${juan.id}/`), `el enlace lleva a la página pública (${r.data.url.slice(0, 60)}...)`);
    const [, , , , , expira, firma] = r.data.url.split('/'); // http: '' host estado id expira firma
    const dias = (new Date(r.data.expira).getTime() - Date.now()) / 86400000;
    ok(dias > 29.9 && dias <= 30, `vale 30 días (${dias.toFixed(2)})`);
    ok(String(expira) === String(Math.floor(new Date(r.data.expira).getTime() / 1000)), 'la fecha del enlace coincide con la que se muestra');
    ok(r.data.url.length < 130, `es corto, para que el código QR sea fácil de escanear (${r.data.url.length} letras)`);
    const url = r.data.url;

    log('\n[4] Quien escanea baja el PDF, sin usuario ni contraseña');
    let res = await fetch(url);
    let pdf = Buffer.from(await res.arrayBuffer());
    const texto = pdf.toString('latin1');
    ok(res.status === 200 && /application\/pdf/.test(res.headers.get('content-type') || ''), 'responde un PDF');
    ok(/attachment/.test(res.headers.get('content-disposition') || '') && /Estado-de-cuenta-JUAN-PEREZ\.pdf/.test(res.headers.get('content-disposition') || ''), 'se descarga con nombre "Estado-de-cuenta-JUAN-PEREZ.pdf"');
    ok(/no-store/.test(res.headers.get('cache-control') || ''), 'no se guarda en cachés (siempre trae lo de ahora)');
    ok(texto.startsWith('%PDF-1.4') && texto.trimEnd().endsWith('%%EOF'), 'es un PDF bien formado (empieza con %PDF y termina con %%EOF)');
    ok(texto.includes('JUAN P\xc9REZ') && texto.includes('550,00') && texto.includes('2 x ALFAJOR TRIPLE'), 'trae el nombre, lo que debe ($550,00) y el detalle');
    ok(!texto.includes('QUESO'), 'y no trae el fiado que ya se pagó');
    // Se paga algo más: el PDF siguiente ya refleja el saldo nuevo (el enlace siempre da lo de ahora).
    await api('POST', `/api/clientes/${juan.id}/pago`, { monto: 50, nota: null, metodoPago: 'transferencia' }, token);
    pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
    ok(pdf.toString('latin1').includes('500,00'), 'después de un pago de $50, el mismo enlace muestra $500,00');
    r = await api('GET', `/api/clientes/${juan.id}/estado-pdf`, undefined, token);
    ok(r.ok && Buffer.from(r.data, 'base64').toString('latin1').startsWith('%PDF-1.4'), 'con sesión, el PDF también viene por la API (en base64) para guardarlo desde la pantalla');

    log('\n[5] Un enlace malo, vencido o de otra persona no sirve');
    const texto404 = async (u) => {
      const x = await fetch(u);
      return { estado: x.status, cuerpo: await x.text(), tipo: x.headers.get('content-type') || '' };
    };
    let t = await texto404(url.slice(0, -1) + (url.endsWith('A') ? 'B' : 'A'));
    ok(t.estado === 404 && /no es válido o ya venció/.test(t.cuerpo) && !/pdf/.test(t.tipo), 'una firma cambiada se rechaza');
    t = await texto404(url.replace(`/${expira}/`, `/${Number(expira) + 1}/`));
    ok(t.estado === 404, 'alargar la fecha del enlace se rechaza (la fecha va firmada)');
    t = await texto404(url.replace(juan.id, otro.id));
    ok(t.estado === 404, 'usar la firma de Juan para ver a otra persona se rechaza');
    const vencido = crearEnlaceEstado(claveRed, juan.id, Date.now() - (VIGENCIA_ENLACE_SEGUNDOS + 3600) * 1000);
    t = await texto404(vencido.url);
    ok(t.estado === 404 && /ya venció/.test(t.cuerpo), 'un enlace de hace más de 30 días ya no sirve (aunque la firma sea buena)');
    const deOtraRed = crearEnlaceEstado('otra-clave-de-otra-red', juan.id);
    t = await texto404(deOtraRed.url);
    ok(t.estado === 404, 'un enlace firmado con otra clave de red no sirve');
    t = await texto404(`${BASE}/estado/${juan.id}/abc/xyz`);
    ok(t.estado === 404, 'datos que no tienen sentido se rechazan');
    t = await texto404(`${BASE}/estado/${'0'.repeat(24)}/9999999999/${'A'.repeat(27)}`);
    ok(t.estado === 404, 'una firma inventada se rechaza');
    // Un cliente que se sacó de la lista deja de poder verse.
    await api('POST', `/api/clientes/${otro.id}/activo`, { activo: false }, token);
    const enlaceOtro = crearEnlaceEstado(claveRed, otro.id);
    t = await texto404(enlaceOtro.url);
    ok(t.estado === 404, 'un cliente que se sacó de la lista ya no tiene estado de cuenta (aunque el enlace sea bueno)');
    ok(rechazo(await api('POST', `/api/clientes/${otro.id}/enlace-estado`, undefined, token), 'ya no está'), 'y no se le arma otro enlace');

    log('\n[6] Las firmas, por separado');
    const ahora = Date.now();
    const e = crearEnlaceEstado('clave', 'a'.repeat(24), ahora);
    const [, , , , , ex, fi] = e.url.split('/');
    ok(verificarEnlaceEstado('clave', 'a'.repeat(24), ex, fi, ahora) === 'ok', 'una firma buena y vigente: ok');
    ok(verificarEnlaceEstado('clave', 'a'.repeat(24), ex, fi, ahora + (VIGENCIA_ENLACE_SEGUNDOS + 5) * 1000) === 'vencido', 'pasados los 30 días: vencido');
    ok(verificarEnlaceEstado('otra', 'a'.repeat(24), ex, fi, ahora) === 'invalido', 'con otra clave: inválido');
    ok(verificarEnlaceEstado('clave', 'b'.repeat(24), ex, fi, ahora) === 'invalido', 'para otro cliente: inválido');
    ok(verificarEnlaceEstado('', 'a'.repeat(24), ex, fi, ahora) === 'invalido', 'sin clave de red no se puede verificar: inválido');
    ok(verificarEnlaceEstado('clave', 'a'.repeat(24), ex, '', ahora) === 'invalido', 'firma vacía: inválida');
    ok(verificarEnlaceEstado('clave', 'a'.repeat(24), ex, fi + 'x', ahora) === 'invalido', 'firma más larga: inválida (sin romper nada)');
    let sinClave = null;
    try {
      crearEnlaceEstado('', 'a'.repeat(24));
    } catch (err) {
      sinClave = err.message;
    }
    ok(/falta la clave de la red/.test(sinClave || ''), 'sin clave de red no se arma el enlace, y dice por qué');

    log('\n[7] El PDF por dentro');
    const lineas = (n) => Array.from({ length: n }, (_, i) => ({ fecha: new Date(2026, 9, 1 + (i % 28), 12).toISOString(), descripcion: `${i + 1} x PRODUCTO (con paréntesis) y \\ barras ${i}`, monto: 100 + i }));
    const grande = armarPdfEstado({ clienteId: 'c'.repeat(24), nombre: 'María Ñoño (kiosco)', fecha: new Date().toISOString(), saldo: 12345.5, pendientes: lineas(70), pagos: lineas(3) }).toString('latin1');
    const paginas = (grande.match(/\/Type \/Page /g) || []).length;
    ok(paginas >= 3, `con 70 líneas pasa a varias páginas (${paginas})`);
    ok(grande.includes(`Página 1 de ${paginas}`) && grande.includes(`Página ${paginas} de ${paginas}`), 'cada página dice "Página N de M"');
    ok(grande.includes('\\(con par\xe9ntesis\\)') && grande.includes('\\\\ barras'), 'los paréntesis y las barras del texto no rompen el PDF (van escapados)');
    ok(grande.includes('Mar\xeda \xd1o\xf1o (kiosco)') === false && grande.includes('Mar\xeda \xd1o\xf1o \\(kiosco\\)'), 'las tildes y la ñ se escriben bien');
    // El índice del PDF (la tabla "xref"): cada entrada tiene que apuntar justo al objeto que dice.
    const inicioTabla = Number(grande.match(/startxref\n(\d+)\n%%EOF/)[1]);
    ok(grande.slice(inicioTabla, inicioTabla + 4) === 'xref', 'el índice del PDF está donde dice "startxref"');
    const cantidad = Number(grande.slice(inicioTabla).match(/^xref\n0 (\d+)\n/)[1]);
    let bien = 0;
    for (let id = 1; id < cantidad; id++) {
      const entrada = grande.slice(inicioTabla).split('\n')[2 + id];
      const pos = Number(entrada.slice(0, 10));
      if (grande.slice(pos, pos + `${id} 0 obj`.length) === `${id} 0 obj`) bien += 1;
    }
    ok(bien === cantidad - 1, `las ${cantidad - 1} entradas del índice apuntan al objeto correcto (${bien})`);
    const alDia = armarPdfEstado({ clienteId: 'd'.repeat(24), nombre: 'Ana', fecha: new Date().toISOString(), saldo: 0, pendientes: [], pagos: [] }).toString('latin1');
    ok(alDia.includes('No debe nada') && alDia.includes('No hay nada anotado sin pagar'), 'quien no debe nada recibe un PDF que lo dice');
    const aFavor = armarPdfEstado({ clienteId: 'e'.repeat(24), nombre: 'Ana', fecha: new Date().toISOString(), saldo: -80, pendientes: [], pagos: [{ fecha: new Date().toISOString(), descripcion: 'Pago', monto: 80 }] }).toString('latin1');
    ok(aFavor.includes('SALDO A FAVOR') && aFavor.includes('80,00'), 'quien pagó de más ve "SALDO A FAVOR"');
    ok(nombreArchivoEstado('María Pérez (kiosco)') === 'Estado-de-cuenta-Maria-Perez-kiosco.pdf', 'el nombre del archivo no lleva tildes ni símbolos');
    ok(nombreArchivoEstado('???') === 'Estado-de-cuenta-cliente.pdf', 'y si el nombre no tiene letras, igual hay un nombre');
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
