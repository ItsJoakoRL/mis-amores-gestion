// Prueba del asistente SIMPLE (el de los patrones, sin IA): lo que entiende y cómo se acuerda de la charla.
//  [1] la limpieza del texto y los errores de tipeo
//  [2] los "cuándo": hoy, ayer, la semana pasada, el mes pasado, el lunes, el 15/10, septiembre, los últimos 15 días...
//      (con una fecha fija, en días raros: lunes, domingo, primer día del mes, enero)
//  [3] los seguimientos: "¿y ayer?", "¿y en efectivo?", "¿y la fanta?"
//  [4] contra un servidor de verdad con 45 días de ventas: ventas por período, comparaciones, mejor día, qué se vendió,
//      cuántas unidades de un producto, pagos, fiados, deudas, clientes, stock, precios, códigos, recordatorios,
//      saludos, errores de tipeo, preguntas que no entiende y basura en el historial
//
//   npm run build:electron
//   node scripts/probar-asistente-simple.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba "test_asistente_simple", su carpeta y su
// puerto: no toca la base real del negocio. No necesita internet ni ninguna clave.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4196;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_asistente_simple';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-asistente-simple-'));
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');

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

const { canonico, corregirTipeos, tieneTema } = require(path.join(RAIZ, 'dist-electron/electron/lenguaje.js'));
const { leerPeriodos, periodoAnterior } = require(path.join(RAIZ, 'dist-electron/electron/periodos.js'));
const { resolverSeguimiento } = require(path.join(RAIZ, 'dist-electron/electron/seguimiento.js'));
const { formatearMoneda } = require(path.join(RAIZ, 'dist-electron/shared/formato.js'));

// El dinero como lo escribe el asistente, con el espacio normal (el programa usa un espacio "duro").
const plata = (n) => formatearMoneda(n).replace(/ /g, ' ');
const sinEspaciosDuros = (t) => String(t).replace(/ /g, ' ');

(async () => {
  try {
    // ------------------------------------------------------------------ [1] el texto
    log('\n[1] Se limpia lo que se escribe');
    const casos = [
      ['¿Cuánto vendí HOY?', 'cuanto vendi hoy'],
      ['  cuanto   vendiiiii  hoy ', 'cuanto vendi hoy'],
      ['holaaaa', 'hola'],
      ['q tiene poco stok', 'que tiene poco stock'],
      ['cuanto bendi ayer??', 'cuanto vendi ayer'],
      ['¡¡Buenas!!', 'buenas'],
      ['Precio de la COCA 1000', 'precio de la coca 1000'],
    ];
    for (const [entrada, esperado] of casos) ok(canonico(entrada) === esperado, `"${entrada}" → "${canonico(entrada)}"`);
    ok(canonico('cobré $1.500') === 'cobre $1.500', 'los números y el signo $ no se tocan ("1000" no pierde ceros)');
    ok(canonico('') === '' && canonico('???') === '', 'un texto vacío o sólo signos queda vacío');
    const tipeos = [
      ['cuanto vedi hoy', 'cuanto vendi hoy'],
      ['cuantto vendi ayer', 'cuanto vendi ayer'],
      ['quien me debe mas', 'quien me debe mas'],
      ['cuanto cuesta la cocaa', 'cuanto cuesta la cocaa'],
      ['que tiene poco stoc', 'que tiene poco stock'],
      ['cuanto cobre el mes pasdo', 'cuanto cobre el mes pasado'],
    ];
    for (const [entrada, esperado] of tipeos) ok(corregirTipeos(entrada) === esperado, `errores de tipeo: "${entrada}" → "${corregirTipeos(entrada)}"`);
    ok(corregirTipeos('cuanto cuesta marta gomez') === 'cuanto cuesta marta gomez', 'un nombre propio no se "corrige" a otra cosa');
    ok(!tieneTema('y ayer') && !tieneTema('y en efectivo') && !tieneTema('y marta') && tieneTema('cuanto vendi') && tieneTema('hay stock de coca'), 'distingue una pregunta con tema ("cuánto vendí") de un seguimiento ("¿y ayer?")');

    // ------------------------------------------------------------------ [2] los "cuándo"
    log('\n[2] Los "cuándo" (con una fecha fija: martes 20/10/2026, 14:30)');
    const ahora = new Date(2026, 9, 20, 14, 30);
    const iso = (a, m, d) => new Date(a, m, d).toISOString();
    const uno = (texto, f = ahora) => leerPeriodos(canonico(texto), f)[0] ?? null;
    const igual = (p, desde, hasta) => p && p.desde === iso(...desde) && p.hasta === iso(...hasta);
    let p = uno('¿cuánto vendí hoy?');
    ok(p && igual(p, [2026, 9, 20], [2026, 9, 21]) && p.etiqueta === 'Hoy' && p.unDia === '2026-10-20' && p.dias === 1 && p.enCurso, 'hoy');
    p = uno('ayer');
    ok(p && igual(p, [2026, 9, 19], [2026, 9, 20]) && p.etiqueta === 'Ayer' && p.unDia === '2026-10-19' && !p.enCurso, 'ayer');
    ok(igual(uno('anteayer'), [2026, 9, 18], [2026, 9, 19]) && uno('anteayer').etiqueta === 'Anteayer' && igual(uno('antes de ayer'), [2026, 9, 18], [2026, 9, 19]), 'anteayer / antes de ayer');
    p = uno('esta semana');
    ok(p && igual(p, [2026, 9, 19], [2026, 9, 21]) && p.dias === 2 && p.tipo === 'semana' && p.etiqueta === 'En lo que va de la semana', 'esta semana: desde el lunes (19/10) hasta hoy (2 días)');
    p = uno('la semana pasada');
    ok(p && igual(p, [2026, 9, 12], [2026, 9, 19]) && p.dias === 7 && leerPeriodos(canonico('la semana pasada'), ahora).length === 1, 'la semana pasada: lunes 12 a domingo 18 (y no se lee también como "la semana")');
    p = uno('este mes');
    ok(p && igual(p, [2026, 9, 1], [2026, 9, 21]) && p.dias === 20 && p.etiqueta === 'En lo que va del mes', 'este mes: del 1 a hoy (20 días)');
    p = uno('el mes pasado');
    ok(p && igual(p, [2026, 8, 1], [2026, 9, 1]) && p.etiqueta === 'El mes pasado (septiembre)' && leerPeriodos('el mes pasado', ahora).length === 1, 'el mes pasado: septiembre entero (y no se lee también como "el mes")');
    p = uno('en septiembre');
    ok(p && igual(p, [2026, 8, 1], [2026, 9, 1]) && p.etiqueta === 'En septiembre', 'en septiembre');
    p = uno('en noviembre');
    ok(p && igual(p, [2025, 10, 1], [2025, 11, 1]) && p.etiqueta === 'En noviembre de 2025', 'en noviembre (todavía no llegó: es el del año pasado)');
    p = uno('en octubre');
    ok(p && igual(p, [2026, 9, 1], [2026, 9, 21]) && p.etiqueta === 'En octubre', 'en octubre (este mes: hasta hoy)');
    ok(igual(uno('este año'), [2026, 0, 1], [2026, 9, 21]) && igual(uno('el año pasado'), [2025, 0, 1], [2026, 0, 1]), 'este año / el año pasado');
    for (const [texto, dias] of [['los ultimos 7 dias', 7], ['las ultimas 2 semanas', 14], ['el ultimo mes', 30], ['la ultima semana', 7], ['los ultimos tres dias', 3], ['ultimos 15 dias', 15]]) {
      p = uno(texto);
      ok(p && p.dias === dias && p.tipo === 'ultimos' && p.hasta === iso(2026, 9, 21) && p.desde === iso(2026, 9, 21 - dias) && p.etiqueta === `En los últimos ${dias} días`, `"${texto}": ${dias} días hasta hoy`);
    }
    ok(uno('los ultimos 9999 dias') === null, 'una cantidad de días absurda no se toma');
    for (const [texto, d, etiqueta] of [['el lunes', 19, 'El lunes 19/10'], ['el martes', 13, 'El martes 13/10'], ['el martes pasado', 13, 'El martes 13/10'], ['el domingo', 18, 'El domingo 18/10'], ['el jueves', 15, 'El jueves 15/10'], ['el miercoles', 14, 'El miércoles 14/10']]) {
      p = uno(texto);
      ok(p && igual(p, [2026, 9, d], [2026, 9, d + 1]) && p.etiqueta === etiqueta, `"${texto}" → ${etiqueta} (el último que ya pasó; "el martes" siendo martes es el de hace una semana)`);
    }
    p = uno('el 15/10');
    ok(p && igual(p, [2026, 9, 15], [2026, 9, 16]) && p.etiqueta === 'El jueves 15/10', '15/10');
    p = uno('el 25/10');
    ok(p && igual(p, [2025, 9, 25], [2025, 9, 26]) && p.etiqueta === 'El sábado 25/10/2025', '25/10 (todavía no llegó: es del año pasado)');
    ok(uno('31/02') === null && uno('45/10') === null && uno('15/13') === null, 'fechas que no existen (31/02, 45/10, 15/13) no se toman');
    ok(igual(uno('el 3 de septiembre'), [2026, 8, 3], [2026, 8, 4]) && igual(uno('el 3 de septiembre de 2025'), [2025, 8, 3], [2025, 8, 4]), '3 de septiembre / 3 de septiembre de 2025');
    ok(leerPeriodos('el 3 de septiembre', ahora).length === 1, 'y "3 de septiembre" no se lee también como "septiembre" entero');
    ok(igual(uno('el 15'), [2026, 9, 15], [2026, 9, 16]) && igual(uno('el 25'), [2026, 8, 25], [2026, 8, 26]) && uno('el 31') === null, '"el 15" (de este mes), "el 25" (todavía no llegó: del mes pasado), "el 31" (septiembre no tiene 31)');
    ok(uno('cuesta el 15% mas') === null, '"el 15%" no es una fecha');
    const dos = leerPeriodos(canonico('vendi mas hoy que ayer'), ahora);
    ok(dos.length === 2 && dos[0].etiqueta === 'Hoy' && dos[1].etiqueta === 'Ayer', 'dos "cuándo" en una pregunta, en el orden en que aparecen');
    ok(leerPeriodos(canonico('quien me debe'), ahora).length === 0 && leerPeriodos(canonico('el mesero'), ahora).length === 0 && leerPeriodos(canonico('hoyo'), ahora).length === 0, 'sin "cuándo": ninguno (y "mesero" u "hoyo" no engañan)');
    // días raros
    const lunes = new Date(2026, 9, 19, 9, 0);
    ok(uno('esta semana', lunes).dias === 1 && igual(uno('la semana pasada', lunes), [2026, 9, 12], [2026, 9, 19]), 'un lunes: "esta semana" es sólo hoy y "la semana pasada" es la de antes');
    const domingo = new Date(2026, 9, 25, 23, 50);
    ok(uno('esta semana', domingo).dias === 7 && uno('el domingo', domingo).unDia === '2026-10-18', 'un domingo: la semana entera, y "el domingo" es el de hace una semana');
    const primero = new Date(2026, 10, 1, 8, 0);
    ok(uno('este mes', primero).dias === 1 && uno('el mes pasado', primero).etiqueta === 'El mes pasado (octubre)', 'el primer día del mes: "este mes" es sólo hoy y "el mes pasado" es octubre');
    const enero = new Date(2027, 0, 5, 10, 0);
    ok(uno('el mes pasado', enero).etiqueta === 'El mes pasado (diciembre)' && igual(uno('el mes pasado', enero), [2026, 11, 1], [2027, 0, 1]), 'en enero: "el mes pasado" es diciembre del año anterior');
    ok(uno('en diciembre', enero).etiqueta === 'En diciembre de 2026' && uno('este año', enero).dias === 5, 'en enero: "en diciembre" es el de 2026 y "este año" son 5 días');
    ok(uno('ayer', primero).unDia === '2026-10-31' && uno('anteayer', enero).unDia === '2027-01-03', 'ayer y anteayer cruzan fin de mes y de año bien');
    // período anterior (para comparar)
    const anterior = (texto, f = ahora) => periodoAnterior(uno(texto, f), f);
    ok(anterior('hoy').etiqueta === 'Ayer' && anterior('ayer').etiqueta === 'Anteayer' && anterior('el lunes').unDia === '2026-10-18', 'el anterior de hoy es ayer, el de ayer es anteayer, el de un día es el día antes');
    let a = anterior('esta semana');
    ok(igual(a, [2026, 9, 12], [2026, 9, 14]) && a.dias === 2 && /hasta el mismo día/.test(a.etiqueta), 'el anterior de "esta semana" (2 días) es la semana pasada, los mismos 2 días');
    a = anterior('este mes');
    ok(igual(a, [2026, 8, 1], [2026, 8, 21]) && /hasta el día 20/.test(a.etiqueta), 'el anterior de "este mes" (20 días) son los primeros 20 días de septiembre');
    a = anterior('el mes pasado');
    ok(igual(a, [2026, 7, 1], [2026, 8, 1]) && /agosto/.test(a.etiqueta), 'el anterior del mes pasado es agosto');
    a = anterior('los ultimos 7 dias');
    ok(a.dias === 7 && a.hasta === iso(2026, 9, 14) && a.desde === iso(2026, 9, 7), 'el anterior de "los últimos 7 días" son los 7 días de antes');
    a = anterior('este mes', primero);
    ok(a.dias === 31 || a.dias === 1 || a.dias >= 1, 'el primer día del mes tiene un anterior válido');

    // ------------------------------------------------------------------ [3] los seguimientos
    log('\n[3] Los seguimientos de la charla');
    const seguir = (pregunta, anteriores) => resolverSeguimiento(canonico(pregunta), anteriores.map(canonico), ahora);
    ok(seguir('¿y ayer?', ['¿Cuánto vendí hoy?']) === 'cuanto vendi ayer', '"¿y ayer?" después de "¿cuánto vendí hoy?" → "cuanto vendi ayer"');
    ok(seguir('¿y anteayer?', ['¿Cuánto vendí hoy?', '¿y ayer?']) === 'cuanto vendi anteayer', 'y encadenado: "¿y anteayer?" después de "…hoy" y "¿y ayer?"');
    ok(seguir('¿y en efectivo?', ['¿Cuánto vendí hoy?']) === 'cuanto vendi hoy en efectivo', '"¿y en efectivo?" → "cuanto vendi hoy en efectivo"');
    ok(seguir('¿y con tarjeta?', ['¿Cuánto vendí hoy?', '¿y en efectivo?']) === 'cuanto vendi hoy en tarjeta', '"¿y con tarjeta?" cambia la forma de pago anterior (no suma las dos)');
    ok(seguir('¿y ayer?', ['¿Cuánto vendí hoy en efectivo?']) === 'cuanto vendi ayer en efectivo', 'cambiar el día mantiene la forma de pago');
    ok(seguir('¿y la semana pasada?', ['¿Cuánto vendí esta semana?']) === 'cuanto vendi la semana pasada', '"¿y la semana pasada?" cambia "esta semana"');
    ok(seguir('¿y el lunes?', ['cuanto cobre hoy']) === 'cuanto cobre el lunes', '"¿y el lunes?"');
    ok(seguir('¿y la fanta?', ['¿Cuánto cuesta la coca?']) === 'cuanto cuesta fanta', '"¿y la fanta?" cambia de producto');
    ok(seguir('¿y de Marta?', ['¿Cuánto debe Juan?']) === 'cuanto debe marta', '"¿y de Marta?" cambia de cliente');
    ok(seguir('¿cuánto debe Marta?', ['¿Cuánto vendí hoy?']) === null, 'una pregunta con tema propio no es un seguimiento');
    ok(seguir('¿y ayer?', []) === null, 'sin nada de antes no hay a qué seguir');
    ok(seguir('¿y ayer?', ['hola']) === 'hola ayer', 'después de un saludo, el "cuándo" se pega igual (después se contesta "ayer")');
    ok(seguir('¿Qué tiene poco stock y qué falta para la semana que viene con tanta venta?', ['¿Cuánto vendí hoy?']) === null, 'una pregunta larga no se toma por seguimiento');

    // ------------------------------------------------------------------ [4] contra un servidor con ventas de 45 días
    log('\nLevantando un servidor de prueba y cargando 45 días de ventas...');
    const cli = new MongoClient(MONGO);
    await cli.connect();
    await cli.db(DB).dropDatabase();
    const servidor = spawn(process.execPath, [SERVIDOR_JS], {
      cwd: RAIZ,
      env: { ...process.env, MONGODB_URI: MONGO, MONGODB_DB_NAME: DB, MIS_AMORES_PUERTO: String(PUERTO), MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos') },
      stdio: 'ignore',
    });
    try {
      const limite = Date.now() + 60000;
      for (;;) {
        try {
          if ((await fetch(BASE + '/api/sistema/info')).ok) break;
        } catch {
          /* todavía no */
        }
        if (Date.now() > limite) throw new Error('El servidor de prueba no arrancó');
        await esperar(300);
      }
      const api = async (metodo, ruta, cuerpo, token) =>
        (await fetch(BASE + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) })).json();
      const token = (await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
      const sesion = (await api('GET', '/api/auth/sesion', undefined, token)).data;
      const entrada = (b) => ({ codigoBarras: null, descripcion: 'X', marcaId: null, familiaId: null, proveedorId: null, precioCosto: 60, precioVenta: 100, precioLista2: 0, precioLista3: 0, utilidadPct: 0, stock: 100, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...b });
      const crear = async (descripcion, precioVenta, extra = {}) => (await api('POST', '/api/articulos', entrada({ descripcion, precioVenta, ...extra }), token)).data;
      const A = await crear('PRODUCTO A', 500, { stock: 50 });
      const COCA = await crear('COCA COLA 1.5L', 2500, { stock: 12, stockMinimo: 2, codigoBarras: '7790895000011' });
      const ZERO = await crear('COCA COLA ZERO 1.5L', 2600, { stock: 0, stockMinimo: 2 });
      const FANTA = await crear('FANTA 1.5L', 2400, { stock: 3, stockMinimo: 5 });
      const OREO = await crear('GALLETITAS OREO', 1800, { stock: 1, stockMinimo: 1 });
      const AGUA = await crear('AGUA 500ML', 900, { stock: 40, stockMinimo: 5 });
      const cliente = async (nombre, telefono = null) => (await api('POST', '/api/clientes', { nombre, nota: null, telefono, deudaInicial: 0 }, token)).data;
      const marta = await cliente('Marta Gómez', '11-5555-1234');
      const marta2 = await cliente('Marta Díaz');
      const pedro = await cliente('Pedro Pérez');
      const juan = await cliente('Juan Ramírez');
      const idAdmin = new ObjectId(sesion.id);
      const db = cli.db(DB);

      // El registro de lo vendido (todo lo que se carga, para calcular lo esperado): offset de días, compra, líneas, forma de pago, cliente.
      const registro = [];
      const hexa = (n) => String(n).padStart(24, '0');
      let compra = 0;
      const anotar = (offset, lineas, metodo, clienteId = null) => registro.push({ offset, ticket: hexa(++compra), lineas, metodo, clienteId });
      const fechaDe = (offset, hora = 11) => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + offset, hora, 0).toISOString();
      // Hoy (por la API, como se hace en el mostrador)
      const vender = (articulo, cantidad, metodoPago, ticketId, clienteId) => api('POST', '/api/ventas', { articuloId: articulo.id, cantidad, metodoPago, ticketId, ...(clienteId ? { clienteId } : {}) }, token);
      let t = hexa(1);
      await vender(A, 2, 'efectivo', t); await vender(COCA, 1, 'efectivo', t);
      anotar(0, [[A, 2], [COCA, 1]], 'efectivo');
      await vender(FANTA, 1, 'tarjeta', hexa(2)); anotar(0, [[FANTA, 1]], 'tarjeta');
      await vender(A, 1, 'fiado', hexa(3), marta.id); anotar(0, [[A, 1]], 'fiado', marta.id);
      await vender(OREO, 3, 'efectivo', hexa(4)); anotar(0, [[OREO, 3]], 'efectivo');
      compra = 4;
      // Los días de antes (directo en la base)
      anotar(-1, [[A, 1], [AGUA, 2]], 'efectivo');
      anotar(-1, [[COCA, 2]], 'tarjeta');
      anotar(-2, [[ZERO, 1]], 'tarjeta');
      anotar(-4, [[COCA, 1]], 'fiado', juan.id);
      for (let n = 3; n <= 45; n++) {
        if (n === 10) anotar(-10, [[COCA, 40]], 'efectivo');
        else if (n === 17) anotar(-17, [[AGUA, 1]], 'efectivo');
        else anotar(-n, [[AGUA, 2 + (n % 2)]], 'efectivo');
      }
      const docs = [];
      for (const c of registro.filter((r) => r.offset < 0)) {
        for (const [art, cant] of c.lineas) {
          docs.push({
            _id: new ObjectId(), articuloId: new ObjectId(art.id), articuloDescripcion: art.descripcion, cantidad: cant, precioUnitario: art.precioVenta,
            total: cant * art.precioVenta, metodoPago: c.metodo, clienteId: c.clienteId ? new ObjectId(c.clienteId) : null, usuarioId: idAdmin,
            fecha: fechaDe(c.offset), ticketId: c.ticket, ...(c.metodo === 'fiado' ? { pagado: false } : {}),
          });
        }
      }
      await db.collection('ventas').insertMany(docs);
      // Pagos de cuentas de hoy y una deuda vieja a mano (Pedro, hace 30 días)
      await db.collection('pagos_cuenta').insertMany([
        { clienteId: new ObjectId(marta.id), monto: 200, fecha: fechaDe(0, 10), usuarioId: idAdmin, nota: null, metodoPago: 'efectivo' },
        { clienteId: new ObjectId(pedro.id), monto: 100, fecha: fechaDe(0, 12), usuarioId: idAdmin, nota: null, metodoPago: 'transferencia' },
      ]);
      await db.collection('ajustes_cuenta').insertOne({ clienteId: new ObjectId(pedro.id), monto: 1500, fecha: fechaDe(-30), usuarioId: idAdmin, nota: 'Deuda anotada' });
      await api('POST', '/api/recordatorios', { texto: 'Pedir más cajas al proveedor', tipo: 'reponer', urgente: true, paraFecha: null }, token);
      await api('POST', '/api/recordatorios', { texto: 'Cambiar el cartel de la vidriera', tipo: 'hacer', urgente: false, paraFecha: null }, token);

      // ---- lo esperado, calculado aparte con fechas simples
      const hoyD = new Date();
      const dow = hoyD.getDay();
      const lunesOff = -((dow + 6) % 7);
      const primeroOff = -(hoyD.getDate() - 1);
      const primeroMesPasado = new Date(hoyD.getFullYear(), hoyD.getMonth() - 1, 1);
      const offsetDe = (f) => Math.round((new Date(f.getFullYear(), f.getMonth(), f.getDate()) - new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate())) / 86400000);
      const finMesPasadoOff = primeroOff - 1;
      const inicioMesPasadoOff = offsetDe(primeroMesPasado);
      const total = (c) => c.lineas.reduce((s, [art, cant]) => s + art.precioVenta * cant, 0);
      const resumen = (desdeOff, hastaOff, filtro = () => true) => {
        const cs = registro.filter((c) => c.offset >= desdeOff && c.offset <= hastaOff && filtro(c));
        const vendido = cs.reduce((s, c) => s + total(c), 0);
        const fiado = cs.filter((c) => c.metodo === 'fiado').reduce((s, c) => s + total(c), 0);
        return { compras: cs.length, vendido, fiado, cobrado: vendido - fiado };
      };
      const frase = (r) => (r.fiado === 0 ? `${plata(r.cobrado)} cobrado en ${r.compras} venta(s)` : `${plata(r.cobrado)} cobrado y ${plata(r.fiado)} fiado (sin cobrar) en ${r.compras} venta(s)`);

      const preguntar = async (texto, historial, tk = token) => {
        const r = await api('POST', '/api/asistente/preguntar', { pregunta: texto, ...(historial !== undefined ? { historial } : {}) }, tk);
        const salida = r.ok ? { ...r.data, texto: sinEspaciosDuros(r.data.texto) } : { error: r.error, texto: '' };
        if (process.env.VER) log(`      » ${JSON.stringify(texto)}${historial && historial.length ? ' (con historial)' : ''}\n      ← ${salida.texto.replace(/\n/g, '\n        ')}`);
        return salida;
      };
      const yo = (texto) => ({ rol: 'usuario', texto });
      const el = (texto) => ({ rol: 'asistente', texto });

      // ---- ventas por período
      log('\n[4a] Ventas de cada "cuándo"');
      const hoy = resumen(0, 0);
      let r = await preguntar('¿Cuánto vendí hoy?');
      ok(r.reconocida && r.modo === 'simple' && r.texto.startsWith('Hoy ') && r.texto.includes(frase(hoy)) && r.texto.includes('recibiste $ 300 de pagos de cuentas'), `hoy: "${r.texto}"`);
      const ayer = resumen(-1, -1);
      r = await preguntar('¿Cuánto vendí ayer?');
      ok(r.texto === `Ayer ${frase(ayer)}.`, `ayer: "${r.texto}"`);
      r = await preguntar('cuanto vendi anteayer');
      ok(r.texto === `Anteayer ${frase(resumen(-2, -2))}.`, `anteayer: "${r.texto}"`);
      const semana = resumen(lunesOff, 0);
      r = await preguntar('¿Cuánto vendí esta semana?');
      ok(r.texto.startsWith('En lo que va de la semana ') && r.texto.includes(frase(semana)) && r.texto.includes('Cada compra salió en promedio'), `esta semana (desde el lunes, ${-lunesOff + 1} día(s)): "${r.texto.slice(0, 120)}…"`);
      const semanaPasada = resumen(lunesOff - 7, lunesOff - 1);
      r = await preguntar('¿Y cuánto vendí la semana pasada?');
      ok(r.texto.startsWith('La semana pasada ') && r.texto.includes(frase(semanaPasada)), `la semana pasada: "${r.texto.slice(0, 120)}…"`);
      const mes = resumen(primeroOff, 0);
      r = await preguntar('cuanto vendi este mes');
      ok(r.texto.startsWith('En lo que va del mes ') && r.texto.includes(frase(mes)), `este mes (${-primeroOff + 1} día(s)): "${r.texto.slice(0, 110)}…"`);
      const mesPasado = resumen(inicioMesPasadoOff, finMesPasadoOff);
      r = await preguntar('¿Cuánto vendí el mes pasado?');
      const nombreMes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][primeroMesPasado.getMonth()];
      ok(r.texto.startsWith(`El mes pasado (${nombreMes}) `) && (mesPasado.compras === 0 ? /no hubo ventas/.test(r.texto) : r.texto.includes(frase(mesPasado))), `el mes pasado (${nombreMes}): "${r.texto.slice(0, 110)}…"`);
      const ult15 = resumen(-14, 0);
      r = await preguntar('¿cuánto vendí en los últimos 15 días?');
      ok(r.texto.startsWith('En los últimos 15 días ') && r.texto.includes(frase(ult15)), `los últimos 15 días: "${r.texto.slice(0, 110)}…"`);
      // un día de la semana puntual (el último miércoles que ya pasó)
      const hace = ((dow - 3 + 6) % 7) + 1;
      const miercoles = resumen(-hace, -hace);
      r = await preguntar('¿cuánto vendí el miércoles?');
      ok(r.texto.startsWith('El miércoles ') && r.texto.includes(frase(miercoles)), `el miércoles (hace ${hace} días): "${r.texto.slice(0, 100)}…"`);
      const fechaHace5 = new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate() - 5);
      r = await preguntar(`cuanto vendi el ${fechaHace5.getDate()}/${fechaHace5.getMonth() + 1}`);
      ok(r.texto.includes(frase(resumen(-5, -5))), `una fecha ("el ${fechaHace5.getDate()}/${fechaHace5.getMonth() + 1}"): "${r.texto.slice(0, 100)}…"`);
      r = await preguntar('cuanto vendi el 31/12/2019');
      ok(/no hubo ventas registradas/.test(r.texto), `un día sin ventas: "${r.texto}"`);
      r = await preguntar('ayer');
      ok(r.texto === `Ayer ${frase(ayer)}.`, 'sólo "ayer" (sin más) se toma como las ventas de ayer');
      for (const t2 of ['¿Cuánto cobré hoy?', '¿Cuánto entró hoy?', '¿Cuánto facturé hoy?', 'la caja de hoy', 'ventas de hoy', 'cuanto vendimos hoy']) {
        r = await preguntar(t2);
        ok(r.reconocida && /cobrado/.test(r.texto), `entiende "${t2}"`);
      }

      // ---- seguimientos reales
      log('\n[4b] Se acuerda de la charla');
      const h1 = [yo('¿Cuánto vendí hoy?'), el('Hoy ...')];
      r = await preguntar('¿y ayer?', h1);
      ok(r.texto === `Ayer ${frase(ayer)}.`, `"¿y ayer?" después de "hoy": "${r.texto}"`);
      const h2 = [...h1, yo('¿y ayer?'), el('Ayer ...')];
      r = await preguntar('¿y anteayer?', h2);
      ok(r.texto === `Anteayer ${frase(resumen(-2, -2))}.`, '"¿y anteayer?" después de "hoy" y "ayer"');
      const efectivoHoy = registro.filter((c) => c.offset === 0 && c.metodo === 'efectivo').reduce((s, c) => s + total(c), 0);
      r = await preguntar('¿y en efectivo?', h1);
      ok(r.texto === `Hoy vendiste ${plata(efectivoHoy)} en efectivo (2 venta(s)).`, `"¿y en efectivo?" después de "hoy": "${r.texto}"`);
      const tarjetaAyer = registro.filter((c) => c.offset === -1 && c.metodo === 'tarjeta').reduce((s, c) => s + total(c), 0);
      r = await preguntar('¿y con tarjeta?', [yo('¿Cuánto vendí ayer en efectivo?'), el('...')]);
      ok(r.texto === `Ayer vendiste ${plata(tarjetaAyer)} en tarjeta (1 venta(s)).`, `"¿y con tarjeta?" después de "ayer en efectivo": "${r.texto}"`);
      r = await preguntar('¿y la semana pasada?', [yo('¿Cuánto vendí esta semana?'), el('...')]);
      ok(r.texto.startsWith('La semana pasada ') && r.texto.includes(frase(semanaPasada)), '"¿y la semana pasada?" después de "esta semana"');
      r = await preguntar('¿y la fanta?', [yo('¿Cuánto cuesta la coca zero?'), el('...')]);
      ok(r.texto === `"FANTA 1.5L": ${plata(2400)}, stock 2.`, `"¿y la fanta?" después de un precio: "${r.texto}"`);
      r = await preguntar('¿y Pedro?', [yo('¿Cuánto debe Marta Gómez?'), el('...')]);
      ok(r.texto === `Pedro Pérez debe ${plata(1400)}.`, `"¿y Pedro?" después de una deuda: "${r.texto}"`);
      r = await preguntar('¿y ayer?');
      ok(r.texto === `Ayer ${frase(ayer)}.`, 'un "¿y ayer?" sin nada de antes igual contesta las ventas de ayer');
      r = await preguntar('¿y ayer?', [yo('x'), el('y')]);
      ok(r.reconocida, 'con un historial que no sirve de nada tampoco se pierde');
      for (const basura of ['texto', { rol: 'usuario' }, [null, 5, 'x', { rol: 'otro', texto: 'a' }, { rol: 'usuario', texto: 5 }, { rol: 'usuario', texto: '   ' }, { texto: 'sin rol' }], Array.from({ length: 60 }, () => yo('¿Cuánto vendí hoy?'))]) {
        r = await preguntar('¿Cuánto vendí hoy?', basura);
        ok(r.reconocida && r.texto.includes(frase(hoy)), `un historial raro (${Array.isArray(basura) ? `lista de ${basura.length}` : typeof basura}) no la rompe`);
      }

      // ---- comparaciones
      log('\n[4c] Comparaciones, mejor día y detalle');
      r = await preguntar('¿vendí más que ayer?');
      const dif = hoy.vendido - ayer.vendido;
      ok(r.texto.includes(`Hoy vendiste ${plata(hoy.vendido)} (${plata(hoy.cobrado)} cobrados)`) && r.texto.includes(`Ayer vendiste ${plata(ayer.vendido)}`) && r.texto.includes(`Vendiste ${plata(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'}`) && /\(\+|\(-/.test(r.texto) && /Ojo: hoy todavía no terminó/.test(r.texto), `vendí más que ayer: "${r.texto}"`);
      r = await preguntar('comparado con ayer, como me fue hoy?');
      ok(r.texto.includes(`Ayer vendiste ${plata(ayer.vendido)}`), 'comparado con ayer, cómo me fue hoy');
      r = await preguntar('¿vendí menos hoy que ayer?');
      ok(r.texto.includes(`Hoy vendiste ${plata(hoy.vendido)}`) && r.texto.includes(`Ayer vendiste ${plata(ayer.vendido)}`), 'vendí menos hoy que ayer: hoy contra ayer');
      r = await preguntar('¿cómo me fue ayer comparado con anteayer?');
      const anteayer = resumen(-2, -2);
      ok(r.texto.includes(`Ayer vendiste ${plata(ayer.vendido)}`) && r.texto.includes(`Anteayer vendiste ${plata(anteayer.vendido)}`) && !/todavía no terminó/.test(r.texto), 'ayer contra anteayer (sin el "ojo": ayer ya terminó)');
      r = await preguntar('¿vendí más que la semana pasada?');
      ok(r.texto.startsWith('En lo que va de la semana vendiste') && /La semana pasada/.test(r.texto), '"más que la semana pasada" compara la semana en curso con la pasada');
      r = await preguntar('¿vendí más este mes que el mes pasado?');
      ok(/En lo que va del mes/.test(r.texto) && /El mes pasado/.test(r.texto), 'este mes contra el mes pasado');
      r = await preguntar('¿qué día vendí más?');
      const ult30 = registro.filter((c) => c.offset >= -29).reduce((m, c) => ({ ...m, [c.offset]: (m[c.offset] ?? 0) + total(c) }), {});
      const mejorOff = Number(Object.entries(ult30).sort((x, y) => y[1] - x[1])[0][0]);
      ok(r.texto.startsWith('En los últimos 30 días, el día que más vendiste fue') && r.texto.includes(plata(ult30[mejorOff])), `el día que más vendí (hace ${-mejorOff} días, ${plata(ult30[mejorOff])}): "${r.texto}"`);
      r = await preguntar('¿qué día vendí menos?');
      const peorOff = Number(Object.entries(ult30).sort((x, y) => x[1] - y[1])[0][0]);
      ok(r.texto.includes('el día que menos vendiste fue') && r.texto.includes(plata(ult30[peorOff])), `el día que menos vendí (hace ${-peorOff} días, ${plata(ult30[peorOff])}): "${r.texto}"`);
      r = await preguntar('¿Qué se vendió hoy?');
      ok(/^Hoy se vendió:/.test(r.texto) && r.texto.includes('3 × GALLETITAS OREO') && r.texto.includes('2 × PRODUCTO A') === false && r.texto.includes('3 × PRODUCTO A') && r.texto.includes('1 × FANTA 1.5L'), `qué se vendió hoy (lista de unidades): "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿qué vendí ayer?');
      ok(/^Ayer se vendió:/.test(r.texto) && r.texto.includes('2 × COCA COLA 1.5L') && r.texto.includes('2 × AGUA 500ML'), 'qué vendí ayer');
      r = await preguntar('¿Cuál es el ticket promedio?');
      const r30 = resumen(-29, 0);
      ok(r.texto.includes(`cada compra salió en promedio ${plata(r30.vendido / r30.compras)}`) && r.texto.includes(`${r30.compras} compra(s)`), `ticket promedio de los últimos 30 días: "${r.texto}"`);
      r = await preguntar('¿Cuál es el producto más vendido?');
      ok(/^En los últimos 30 días, lo más vendido fue "AGUA 500ML"/.test(r.texto), `el más vendido de los últimos 30 días (por unidades): "${r.texto.slice(0, 120)}…"`);
      ok(/El que más plata dejó fue "COCA COLA 1\.5L"/.test(r.texto), 'y aclara cuál dejó más plata (otro)');
      r = await preguntar('¿Cuál es el producto más vendido ayer?');
      ok(/^Ayer, lo más vendido fue/.test(r.texto), 'el más vendido de ayer (con "cuándo")');
      r = await preguntar('los 3 más vendidos de la semana pasada');
      ok(/lo más vendido por unidades:/.test(r.texto) && /1\. /.test(r.texto), 'los 3 más vendidos (una lista)');

      // ---- productos vendidos
      log('\n[4d] Cuántas unidades de un producto');
      r = await preguntar('¿cuántas fanta vendí hoy?');
      ok(r.texto === 'Hoy vendiste 1 unidad(es) de "FANTA 1.5L" ($ 2.400).', `una fanta hoy: "${r.texto}"`);
      r = await preguntar('cuanto vendi de coca ayer');
      ok(r.texto === `Ayer vendiste 2 unidad(es) de "COCA COLA 1.5L" (${plata(5000)}).`, `de coca ayer (sólo se vendió una de las dos cocas): "${r.texto}"`);
      r = await preguntar('¿cuántas coca vendí esta semana?');
      const cocaSemana = registro.filter((c) => c.offset >= lunesOff).flatMap((c) => c.lineas).filter(([art]) => art === COCA || art === ZERO).reduce((s, [, n]) => s + n, 0);
      ok(cocaSemana === 0 ? /no vendiste/.test(r.texto) : /COCA COLA/.test(r.texto), `de coca esta semana (${cocaSemana} u.): "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿cuántas agua vendí el mes pasado?');
      ok(r.reconocida, 'de agua el mes pasado se contesta');
      r = await preguntar('¿cuántas empanadas vendí hoy?');
      ok(r.texto === 'No encontré ningún artículo que coincida con "empanadas".', `un producto que no existe: "${r.texto}"`);
      r = await preguntar('¿cuántas oreo vendí ayer?');
      ok(r.texto === 'Ayer no vendiste "GALLETITAS OREO".', `un producto que existe pero no se vendió: "${r.texto}"`);

      // ---- por forma de pago
      log('\n[4e] Forma de pago, pagos de cuentas y fiados');
      r = await preguntar('¿Cuánto vendí en efectivo hoy?');
      ok(r.texto === `Hoy vendiste ${plata(efectivoHoy)} en efectivo (2 venta(s)).`, `efectivo hoy: "${r.texto}"`);
      r = await preguntar('¿cuánto cobré con tarjeta ayer?');
      ok(r.texto === `Ayer vendiste ${plata(tarjetaAyer)} en tarjeta (1 venta(s)).`, `tarjeta ayer: "${r.texto}"`);
      r = await preguntar('¿cuánto vendí en transferencia hoy?');
      ok(r.texto === 'Hoy no hubo ventas en transferencia.', `transferencia hoy: "${r.texto}"`);
      r = await preguntar('¿cuánto vendí en efectivo la semana pasada?');
      ok(/^La semana pasada /.test(r.texto), 'efectivo la semana pasada (con "cuándo")');
      r = await preguntar('¿Cómo vienen los pagos hoy?');
      ok(/^Hoy por método de pago — /.test(r.texto) && r.texto.includes(`efectivo: ${plata(efectivoHoy)}`) && r.texto.includes(`tarjeta: ${plata(2400)}`) && r.texto.includes(`fiado: ${plata(500)}`), `por método de pago: "${r.texto}"`);
      r = await preguntar('¿quién me pagó hoy?');
      ok(/Hoy recibiste \$ 300 de pagos de cuentas \(2 pago\(s\)\)/.test(r.texto) && /- Marta Gómez: \$ 200/.test(r.texto) && /- Pedro Pérez: \$ 100/.test(r.texto), `quién me pagó hoy: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿cuánto me pagaron ayer?');
      ok(r.texto === 'Ayer no hubo pagos de cuentas.', `pagos de ayer: "${r.texto}"`);
      r = await preguntar('¿a quién le fié hoy?');
      ok(/Hoy le fiaste a 1 cliente \(\$ 500 en total\):/.test(r.texto) && /- Marta Gómez: \$ 500/.test(r.texto), `a quién le fié hoy: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿cuántos fiados hoy?');
      ok(r.texto === 'Hoy anotaron 1 venta(s) fiada(s), por $ 500.', `cuántos fiados hoy: "${r.texto}"`);
      r = await preguntar('¿a quién le fié en los últimos 7 días?');
      ok(/le fiaste a 2 clientes \(\$ 3\.000 en total\)/.test(r.texto) && /- Juan Ramírez: \$ 2\.500/.test(r.texto), `a quién le fié en los últimos 7 días: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿a quién le fié ayer?');
      ok(r.texto === 'Ayer no se anotó ningún fiado.', 'a quién le fié ayer: nadie');

      // ---- deudas y clientes
      log('\n[4f] Deudas y clientes');
      r = await preguntar('¿Quién me debe más?');
      ok(r.texto === `El que más debe es Juan Ramírez, con ${plata(2500)}. Le siguen Pedro Pérez (${plata(1400)}) y Marta Gómez (${plata(300)}).`, `quién debe más: "${r.texto}"`);
      r = await preguntar('¿quién me debe?');
      ok(/Te deben \$ 4\.200 entre 3 clientes:/.test(r.texto) && /- Juan Ramírez: \$ 2\.500 \(desde el /.test(r.texto) && /- Marta Gómez: \$ 300/.test(r.texto), `quién me debe (lista): "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿cuántos clientes me deben?');
      ok(r.texto === `Te deben 3 clientes, por ${plata(4200)} en total.`, `cuántos clientes me deben: "${r.texto}"`);
      r = await preguntar('¿cuánto me deben en total?');
      ok(r.texto === `Entre todos los clientes te deben ${plata(4200)} en total.`, 'deuda total');
      r = await preguntar('¿cuánto me debe Marta Gómez?');
      ok(r.texto === `Marta Gómez debe ${plata(300)}.`, `cuánto debe Marta Gómez (exacto): "${r.texto}"`);
      r = await preguntar('¿cuánto me debe marta?');
      ok(/Encontré 2 clientes que coinciden con "marta":/.test(r.texto) && /- Marta Gómez: debe \$ 300/.test(r.texto) && /- Marta Díaz: no tiene deuda pendiente/.test(r.texto), `dos Martas: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('cuanto debe gomez');
      ok(r.texto === `Marta Gómez debe ${plata(300)}.`, 'por el apellido y sin tildes');
      r = await preguntar('cuanto debe fulano de tal');
      ok(r.texto === 'No encontré ningún cliente que se llame "fulano de tal".', `un cliente que no existe: "${r.texto}"`);
      r = await preguntar('¿desde cuándo debe Pedro Pérez?');
      const d30 = new Date(hoyD.getFullYear(), hoyD.getMonth(), hoyD.getDate() - 30);
      ok(r.texto === `Pedro Pérez debe ${plata(1400)} desde el ${d30.getDate()}/${d30.getMonth() + 1}${d30.getFullYear() === hoyD.getFullYear() ? '' : `/${d30.getFullYear()}`}.`, `desde cuándo debe Pedro: "${r.texto}"`);
      r = await preguntar('¿quién debe hace más tiempo?');
      ok(/^El que debe hace más tiempo es Pedro Pérez: \$ 1\.400, desde el /.test(r.texto), `quién debe hace más tiempo: "${r.texto}"`);
      r = await preguntar('¿cuál es el teléfono de Marta Gómez?');
      ok(r.texto === 'El teléfono de Marta Gómez es 11-5555-1234.', `teléfono: "${r.texto}"`);
      r = await preguntar('teléfono de Pedro Pérez');
      ok(r.texto === 'Pedro Pérez no tiene un teléfono anotado.', 'un cliente sin teléfono');
      r = await preguntar('¿Cuántos clientes tengo?');
      ok(r.texto === 'Tenés 4 cliente(s) cargado(s).', 'cuántos clientes');
      r = await preguntar('¿a quién le tengo que cobrar?');
      ok(/Te deben \$ 4\.200 entre 3 clientes/.test(r.texto), '"a quién le tengo que cobrar" también');

      // ---- stock y productos
      log('\n[4g] Stock, precios y códigos');
      r = await preguntar('¿Qué tiene poco stock?');
      ok(r.texto === 'Tenés 1 artículo(s) con stock bajo (quedan pocos): FANTA 1.5L (2). Los podés ver en Artículos y stock, con el botón "Stock bajo".', `poco stock (con nombres): "${r.texto}"`);
      r = await preguntar('¿Qué está sin stock?');
      ok(/Tenés 2 artículo\(s\) sin stock: COCA COLA ZERO 1\.5L, GALLETITAS OREO\. Los ves en Artículos y stock, con el botón "Sin stock"\./.test(r.texto), `sin stock (con nombres): "${r.texto}"`);
      r = await preguntar('¿qué se acabó?');
      ok(/sin stock: /.test(r.texto), 'qué se acabó');
      r = await preguntar('¿qué tengo que reponer?');
      ok(/^Para reponer:/.test(r.texto) && /Sin stock \(2\): COCA COLA ZERO 1\.5L, GALLETITAS OREO\./.test(r.texto) && /Con poco stock \(1\): FANTA 1\.5L \(2\)\./.test(r.texto), `qué reponer: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿qué hay que comprar?');
      ok(/^Para reponer:/.test(r.texto), 'qué hay que comprar');
      r = await preguntar('¿qué hay que contar?');
      ok(/Hay 1 artículo\(s\) para contar \(se vendieron sin stock cargado\): GALLETITAS OREO \(-2\)\./.test(r.texto), `para contar: "${r.texto}"`);
      r = await preguntar('¿Cuánto cuesta la coca zero?');
      ok(r.texto === `"COCA COLA ZERO 1.5L": ${plata(2600)}, stock 0.`, `una coca zero: "${r.texto}"`);
      r = await preguntar('¿cuánto cuesta la coca?');
      ok(/Encontré 2 artículos que coinciden con "coca":/.test(r.texto) && /- "COCA COLA 1\.5L": \$ 2\.500, stock 11/.test(r.texto) && /- "COCA COLA ZERO 1\.5L": \$ 2\.600, stock 0/.test(r.texto), `la coca (dos): "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿hay stock de fanta?');
      ok(r.texto === `"FANTA 1.5L": ${plata(2400)}, stock 2.`, 'hay stock de fanta');
      r = await preguntar('¿tenés oreo?');
      ok(/GALLETITAS OREO/.test(r.texto) && /figura -2/.test(r.texto) && /conviene contarlo/.test(r.texto), `oreo (stock negativo): "${r.texto}"`);
      r = await preguntar('precio agua');
      ok(r.texto === `"AGUA 500ML": ${plata(900)}, stock 40.`, `precio agua: "${r.texto}"`);
      r = await preguntar('¿a cuánto está la fanta?');
      ok(r.texto === `"FANTA 1.5L": ${plata(2400)}, stock 2.`, 'a cuánto está la fanta');
      r = await preguntar('¿cuántas aguas quedan?');
      ok(r.texto === `"AGUA 500ML": ${plata(900)}, stock 40.`, `en plural ("aguas") también la encuentra: "${r.texto}"`);
      r = await preguntar('¿cuántas cocas vendí hoy?');
      ok(r.texto === 'Hoy vendiste 1 unidad(es) de "COCA COLA 1.5L" ($ 2.500).', `"cocas" en plural: "${r.texto}"`);
      r = await preguntar('¿cuánto hay en la caja?');
      ok(r.texto.startsWith(`Hoy entró ${plata(efectivoHoy)} en efectivo (y ${plata(2400)} por tarjeta o transferencia, que no está en la caja); además recibiste $ 300 de pagos de cuentas.`) && /no la registro/.test(r.texto), `cuánto hay en la caja (sólo lo que entró en efectivo): "${r.texto}"`);
      r = await preguntar('¿cuánto me falta cobrar?');
      ok(r.texto === `Entre todos los clientes te deben ${plata(4200)} en total.`, `cuánto me falta cobrar: "${r.texto}"`);
      r = await preguntar('¿cuánto cuesta el submarino de chocolate?');
      ok(r.texto === 'No encontré ningún artículo que coincida con "submarino de chocolate".', 'un producto que no existe');
      r = await preguntar('¿cuál es el código de barras de la coca?');
      ok(/"COCA COLA 1\.5L": código de barras 7790895000011\./.test(r.texto) && /"COCA COLA ZERO 1\.5L" todavía no tiene código de barras\./.test(r.texto), `código de barras: "${r.texto.replace(/\n/g, ' | ')}"`);
      r = await preguntar('¿Cuál es el artículo más caro?');
      ok(r.texto === `El más caro es "COCA COLA ZERO 1.5L", a ${plata(2600)}.`, 'el más caro');
      r = await preguntar('¿Cuál es el producto más barato?');
      ok(r.texto === `El más barato es "PRODUCTO A", a ${plata(500)}.`, 'el más barato');
      r = await preguntar('¿Cuántos productos tengo?');
      ok(r.texto === 'Tenés 6 artículo(s) activos cargados.', 'cuántos productos');
      r = await preguntar('¿Qué rubro vende más?');
      ok(r.reconocida && /^En los últimos 30 días, el rubro que más vendió fue/.test(r.texto), `rubro: "${r.texto}"`);

      // ---- recordatorios
      r = await preguntar('¿Qué tengo pendiente?');
      ok(/Tenés 2 recordatorio\(s\) pendiente\(s\):/.test(r.texto) && r.texto.indexOf('(urgente) Pedir más cajas') < r.texto.indexOf('Cambiar el cartel'), `recordatorios (el urgente primero): "${r.texto.replace(/\n/g, ' | ')}"`);

      // ---- charla
      log('\n[4h] Saludos, errores de tipeo y lo que no entiende');
      r = await preguntar('hola');
      ok(/^¡(?:Buen día|Buenas tardes|Buenas noches), Administradora! 😊 Te puedo contestar cosas como:/.test(r.texto), `saluda por el nombre y según la hora: "${r.texto.slice(0, 70)}…"`);
      r = await preguntar('Hola, ¿cuánto vendí hoy?');
      ok(r.texto.startsWith('Hoy ') && r.texto.includes(frase(hoy)), 'un saludo con una pregunta: contesta la pregunta');
      r = await preguntar('buenas tardes, quien me debe mas');
      ok(/^El que más debe es Juan Ramírez/.test(r.texto), 'buenas tardes + pregunta');
      r = await preguntar('gracias');
      ok(/^¡De nada!/.test(r.texto), 'gracias');
      r = await preguntar('dale, cuánto vendí hoy');
      ok(r.texto.startsWith('Hoy '), '"dale, cuánto vendí hoy" no se toma por un agradecimiento');
      r = await preguntar('chau');
      ok(/^¡Chau, Administradora!/.test(r.texto), 'chau');
      r = await preguntar('¿cómo estás?');
      ok(/Muy bien/.test(r.texto), 'cómo estás');
      r = await preguntar('¿quién sos?');
      ok(/Soy el asistente de Mis Amores/.test(r.texto), 'quién sos');
      r = await preguntar('¿qué sabés hacer?');
      ok(/Te puedo contestar cosas como:/.test(r.texto), 'qué sabés hacer');
      r = await preguntar('¿cuánto gané hoy?');
      ok(/ganancias todavía no las calculo/.test(r.texto) && /administradora/.test(r.texto), 'ganancias: explica por qué no');
      r = await preguntar('cuanto vedi hoy');
      ok(r.texto.startsWith('Hoy ') && r.texto.includes(frase(hoy)), 'un error de tipeo ("vedi") se arregla');
      r = await preguntar('q tiene poco stok');
      ok(/stock bajo \(quedan pocos\)/.test(r.texto), 'jerga y tipeo: "q tiene poco stok"');
      r = await preguntar('cuanto cobre el mes pasdo');
      ok(/^El mes pasado \(/.test(r.texto), `un error de tipeo en el "cuándo" ("pasdo") no hace contestar las ventas de HOY: "${r.texto.slice(0, 60)}…"`);
      r = await preguntar('cuanto cobre ayr');
      ok(/^Ayer /.test(r.texto) || /No entendí/.test(r.texto), 'una palabra muy mal escrita ("ayr") se contesta o se pide de nuevo, sin romper');
      r = await preguntar('jajaja stock raro xyz');
      ok(r.reconocida === false && /^No entendí esa pregunta\. Quizás querías preguntar algo como: "¿Qué tiene poco stock\?"/.test(r.texto) && /Te puedo contestar cosas como:/.test(r.texto), `lo que no entiende: sugiere cosas del tema ("stock") y la ayuda: "${r.texto.slice(0, 120)}…"`);
      r = await preguntar('blablabla');
      ok(r.reconocida === false && /^No entendí esa pregunta\. Te puedo contestar/.test(r.texto), 'sin tema: sólo la ayuda');
      r = await preguntar('   ');
      ok(r.reconocida === false && /Te puedo contestar/.test(r.texto), 'una pregunta vacía muestra la ayuda');
      r = await preguntar('x'.repeat(500));
      ok(r.reconocida === false, 'una pregunta de 500 letras seguidas no rompe nada');
      r = await preguntar('hola'.repeat(100).slice(0, 590));
      ok(typeof r.texto === 'string', 'una pregunta larga con repeticiones se contesta algo');
      r = await preguntar("'; db.dropDatabase(); //");
      ok(r.reconocida === false, 'texto raro con comillas: no entiende y no pasa nada');
      r = await preguntar('cuanto vendi $where: 1');
      ok(typeof r.texto === 'string', 'texto con símbolos de Mongo no rompe');
      // con una empleada también anda (el nombre cambia)
      await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, token);
      const tLucia = (await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).data.token;
      r = await preguntar('hola', undefined, tLucia);
      ok(/, Lucía! 😊/.test(r.texto), 'a la empleada la saluda por su nombre');
      r = await preguntar('¿Cuánto vendí hoy?', undefined, tLucia);
      ok(r.texto.includes(frase(hoy)), 'y le contesta lo mismo de las ventas');
      const sinSesion = await api('POST', '/api/asistente/preguntar', { pregunta: 'hola' });
      ok(sinSesion.ok === false, 'sin iniciar sesión no contesta');
    } finally {
      servidor.kill();
      await esperar(800);
      try {
        await cli.db(DB).dropDatabase();
      } catch {
        /* nada */
      }
      await cli.close();
    }
  } catch (err) {
    fallas += 1;
    log('\n✗ La prueba se cortó:', err && err.stack ? err.stack : err);
  } finally {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* nada */
    }
    log(`\n${fallas === 0 ? '✔' : '✘'} ${pasaron} comprobaciones bien, ${fallas} falla(s)`);
    process.exit(fallas === 0 ? 0 : 1);
  }
})();
