// Prueba de los fiados: anotar una deuda a mano, el teléfono del cliente, desde cuándo
// debe cada uno (los pagos se descuentan de lo más viejo) y los pagos de cuentas
// dentro de lo "cobrado" del día, del calendario y de los reportes.
//
//   npm run build:electron
//   node scripts/probar-fiados.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_fiados", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4186;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_fiados';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-fiados-'));
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
const DIA = 86400000;
const haceDias = (n) => new Date(Date.now() - n * DIA).toISOString();

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
    env: { ...process.env, MONGODB_URI: MONGO, MONGODB_DB_NAME: DB, MIS_AMORES_PUERTO: String(PUERTO), MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos') },
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
    stock: 100, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();
    const token = (await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const idAdmin = (await api('GET', '/api/auth/sesion', undefined, token)).data.id;
    await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, token);
    const tLucia = (await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' })).data.token;
    const crearCliente = async (nombre, deuda = 0, fecha, telefono = null) =>
      (await api('POST', '/api/clientes', { nombre, nota: null, telefono, deudaInicial: deuda, fechaInicial: fecha }, token)).data;
    const lista = async () => (await api('GET', '/api/clientes', undefined, token)).data;
    const de = async (id) => (await lista()).find((c) => c.id === id);
    const pago = (id, monto) => api('POST', `/api/clientes/${id}/pago`, { monto, nota: null, metodoPago: 'efectivo' }, token);
    const deuda = (id, monto, nota, fecha) => api('POST', `/api/clientes/${id}/deuda`, { monto, nota, fecha }, token);

    log('\n[1] Anotar una deuda a mano (lo del cuaderno)');
    const juan = await crearCliente('JUAN PEREZ');
    let r = await deuda(juan.id, 1500, 'Cuaderno: fiambre del 3/10', haceDias(20));
    ok(r.ok === true, 'se anota una deuda de $1500 con su detalle y de hace 20 días');
    let c = await de(juan.id);
    ok(c.saldo === 1500, `ahora debe $1500 (${c.saldo})`);
    let hist = (await api('GET', `/api/clientes/${juan.id}/historial`, undefined, token)).data;
    ok(hist.some((m) => m.tipo === 'ajuste' && m.monto === 1500 && m.descripcion === 'Cuaderno: fiambre del 3/10'), 'en su cuenta queda "Cuaderno: fiambre del 3/10" por $1500');
    ok(Math.abs(new Date(hist.find((m) => m.tipo === 'ajuste').fecha).getTime() - (Date.now() - 20 * DIA)) < 60000, 'con la fecha en que empezó a deber (hace 20 días), no la de hoy');
    r = await deuda(juan.id, 250.5, '', undefined);
    ok(r.ok && (await de(juan.id)).saldo === 1750.5, 'sin detalle ni fecha: se anota igual (con centavos): $1750,50');
    hist = (await api('GET', `/api/clientes/${juan.id}/historial`, undefined, token)).data;
    ok(hist.some((m) => m.descripcion === 'Deuda anotada'), 'sin detalle queda como "Deuda anotada"');
    const estado = (await api('GET', `/api/clientes/${juan.id}/estado`, undefined, token)).data;
    ok(estado.saldo === 1750.5 && estado.pendientes.length === 2, 'el estado de cuenta (PDF) también la incluye');
    const largo = 'x'.repeat(500);
    await deuda(juan.id, 10, largo);
    hist = (await api('GET', `/api/clientes/${juan.id}/historial`, undefined, token)).data;
    ok(hist.find((m) => m.monto === 10 && m.tipo === 'ajuste').descripcion.length === 200, 'un detalle larguísimo se recorta a 200 letras');
    const ajusteId = hist.find((m) => m.monto === 10 && m.tipo === 'ajuste').id;
    r = await api('DELETE', `/api/clientes/movimientos/ajuste/${ajusteId}`, undefined, token);
    ok(r.ok && (await de(juan.id)).saldo === 1750.5, 'una deuda anotada por error se puede borrar (vuelve a $1750,50)');
    r = await api('POST', `/api/clientes/${juan.id}/deuda`, { monto: 100, nota: 'la anota una empleada' }, tLucia);
    ok(r.ok === true, 'una empleada también puede anotar una deuda');

    log('\n[2] Lo que se rechaza al anotar una deuda');
    ok(rechazo(await deuda(juan.id, 0, 'x'), 'mayor a cero'), 'monto cero');
    ok(rechazo(await deuda(juan.id, -50, 'x'), 'mayor a cero'), 'monto negativo');
    ok(rechazo(await deuda(juan.id, 'mucho', 'x'), 'mayor a cero'), 'monto que no es número');
    ok(rechazo(await deuda(juan.id, 1e10, 'x'), 'mayor a cero'), 'un monto absurdo');
    ok(rechazo(await deuda(juan.id, 10, 'x', new Date(Date.now() + 3 * DIA).toISOString()), 'más adelante'), 'una fecha del futuro');
    ok(rechazo(await deuda(juan.id, 10, 'x', 'no-es-una-fecha'), 'fecha no es válida'), 'una fecha que no es fecha');
    ok(rechazo(await deuda('000000000000000000000000', 10, 'x'), 'ya no está'), 'un cliente que no existe');
    ok(rechazo(await deuda('no-es-un-id', 10, 'x'), 'ya no está'), 'un código roto');
    r = await api('POST', `/api/clientes/${juan.id}/deuda`, { monto: 10 });
    ok(r.ok === false, 'sin sesión');
    const baja = await crearCliente('CLIENTE DE BAJA');
    await api('POST', `/api/clientes/${baja.id}/activo`, { activo: false }, token);
    ok(rechazo(await deuda(baja.id, 10, 'x'), 'ya no está'), 'un cliente que ya no está en la lista');
    ok((await de(juan.id)).saldo === 1850.5, 'y los rechazos no tocaron el saldo ($1850,50)');

    log('\n[3] El teléfono y editar al cliente');
    const ana = await crearCliente('ANA GOMEZ', 0, undefined, '11 5555-1234');
    ok(ana.telefono === '11 5555-1234', 'al crear un cliente se guarda su teléfono');
    ok((await de(ana.id)).telefono === '11 5555-1234', 'y viene en la lista de clientes');
    ok((await de(juan.id)).telefono === null, 'los que no tienen teléfono (como los de antes) vienen con null');
    r = await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'ANA GOMEZ DE LOPEZ', nota: 'vive enfrente', telefono: '+54 9 11 5555-9999' }, token);
    c = await de(ana.id);
    ok(r.ok && c.nombre === 'ANA GOMEZ DE LOPEZ' && c.nota === 'vive enfrente' && c.telefono === '+54 9 11 5555-9999', 'se cambian el nombre, la nota y el teléfono');
    r = await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'ANA GOMEZ DE LOPEZ', nota: null, telefono: '' }, token);
    ok(r.ok && (await de(ana.id)).telefono === null && (await de(ana.id)).nota === null, 'un teléfono vacío lo borra (y la nota también)');
    r = await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'JUAN PEREZ', nota: null, telefono: null }, token);
    ok(rechazo(r, 'Ya existe'), 'no se le puede poner el nombre de otro cliente');
    ok(rechazo(await api('PUT', `/api/clientes/${ana.id}`, { nombre: '   ', nota: null, telefono: null }, token), 'nombre'), 'ni dejarlo sin nombre');
    ok(rechazo(await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'ANA', nota: null, telefono: 'llamar a la tarde' }, token), 'teléfono sólo puede'), 'un teléfono con letras se rechaza');
    ok(rechazo(await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'ANA', nota: null, telefono: '1'.repeat(40) }, token), 'teléfono sólo puede'), 'uno larguísimo también');
    ok(rechazo(await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'ANA', nota: null, telefono: '+++---' }, token), 'teléfono sólo puede'), 'uno sin ningún número también');
    ok(rechazo(await api('PUT', '/api/clientes/000000000000000000000000', { nombre: 'X', nota: null, telefono: null }, token), 'ya no está'), 'un cliente que no existe');
    ok((await api('PUT', `/api/clientes/${ana.id}`, { nombre: 'X', nota: null, telefono: null })).ok === false, 'sin sesión');
    r = await api('POST', '/api/clientes', { nombre: 'CON LETRAS', nota: null, telefono: 'abc', deudaInicial: 0 }, token);
    ok(rechazo(r, 'teléfono sólo puede'), 'al crear, un teléfono con letras se rechaza');
    ok((await lista()).every((x) => x.nombre !== 'CON LETRAS'), 'y no se crea el cliente');

    log('\n[4] Desde cuándo debe cada uno (los pagos se descuentan de lo más viejo)');
    const luis = await crearCliente('LUIS DEUDOR');
    await deuda(luis.id, 500, 'viejo', haceDias(100));
    await deuda(luis.id, 300, 'medio', haceDias(50));
    await deuda(luis.id, 200, 'reciente', haceDias(10));
    const desdeDe = async (id) => {
      const x = await de(id);
      return x.deudaDesde ? Math.round((Date.now() - new Date(x.deudaDesde).getTime()) / DIA) : null;
    };
    ok((await de(luis.id)).saldo === 1000 && (await desdeDe(luis.id)) === 100, 'debe $1000 desde hace 100 días (lo más viejo)');
    await pago(luis.id, 100);
    ok((await desdeDe(luis.id)) === 100, 'paga $100: lo viejo ($500) todavía no se cubrió: sigue "desde hace 100 días"');
    await pago(luis.id, 400);
    ok((await de(luis.id)).saldo === 500 && (await desdeDe(luis.id)) === 50, 'paga otros $400 (cubre los $500 viejos): ahora debe desde hace 50 días');
    await pago(luis.id, 300);
    ok((await desdeDe(luis.id)) === 10, 'paga $300 más: debe sólo lo reciente, desde hace 10 días');
    await pago(luis.id, 200);
    c = await de(luis.id);
    ok(c.saldo === 0 && c.deudaDesde === null, 'paga todo: saldo 0 y ya no debe desde ninguna fecha (null)');
    const sinDeuda = await crearCliente('NUNCA DEBIO');
    ok((await de(sinDeuda.id)).deudaDesde === null, 'quien nunca debió: null');
    const conInicial = await crearCliente('CON SALDO INICIAL', 800, haceDias(70));
    ok(Math.abs(new Date(conInicial.deudaDesde).getTime() - (Date.now() - 70 * DIA)) < 60000 && (await desdeDe(conInicial.id)) === 70, 'un cliente cargado con deuda inicial de hace 70 días: debe desde hace 70');
    // Un fiado ya marcado como pagado no cuenta para "desde cuándo".
    const art = (await api('POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR' }), token)).data;
    const marta = await crearCliente('MARTA');
    await deuda(marta.id, 400, 'del cuaderno', haceDias(30));
    const vPagada = (await api('POST', '/api/ventas', { articuloId: art.id, cantidad: 1, metodoPago: 'fiado', clienteId: marta.id }, token)).data;
    await api('POST', `/api/ventas/${vPagada.id}/pagado`, { pagado: true }, token);
    ok((await de(marta.id)).saldo === 400 && (await desdeDe(marta.id)) === 30, 'un fiado de hoy ya marcado como pagado no cuenta: debe desde hace 30 días (lo del cuaderno)');
    const orden = (await lista()).map((x) => x.nombre);
    ok(orden.indexOf('JUAN PEREZ') < orden.indexOf('MARTA'), 'la lista sigue ordenada por quién más debe');

    log('\n[5] Los pagos de cuentas cuentan en lo cobrado');
    const hoy = (await api('GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    // Hoy: la venta fiada de $100 (ya marcada pagada, sigue siendo fiado) + los pagos de arriba.
    const pagosDeHoy = 100 + 400 + 300 + 200;
    ok(hoy.totalPagos === pagosDeHoy && hoy.cantidadPagos === 4, `el resumen de hoy trae los pagos de cuentas: $${pagosDeHoy} en 4 pagos (${hoy.totalPagos} en ${hoy.cantidadPagos})`);
    ok(hoy.totalCobrado === 0 && hoy.totalFiado === 100, 'sin tocar lo de siempre: cobrado de ventas $0, fiado $100');
    await api('POST', '/api/ventas', { articuloId: art.id, cantidad: 3, metodoPago: 'efectivo' }, token);
    const hoy2 = (await api('GET', '/api/ventas/resumen-hoy', undefined, token)).data;
    ok(hoy2.totalCobrado === 300 && hoy2.cantidadVentas === 2 && hoy2.totalPagos === pagosDeHoy, 'una venta en efectivo suma a lo cobrado de ventas ($300) y los pagos siguen aparte');
    const dia = (await api('GET', `/api/clientes/pagos/dia/${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })}`, undefined, token)).data;
    ok(dia.length === 4 && dia.every((p) => p.clienteNombre === 'LUIS DEUDOR' && p.usuarioNombre && p.metodoPago === 'efectivo'), 'el detalle del día lista los 4 pagos con quién pagó, quién lo recibió y cómo');
    ok(dia.reduce((a, p) => a + p.monto, 0) === pagosDeHoy, 'y suman lo mismo');
    ok(rechazo(await api('GET', '/api/clientes/pagos/dia/ayer', undefined, token), 'fecha no es válida'), 'una fecha rara se rechaza');
    ok((await api('GET', '/api/clientes/pagos/dia/2026-01-01')).ok === false, 'sin sesión no se ven');

    // Pagos de otros días: se escriben directo en la base de prueba (la API sólo registra "ahora").
    const c2 = new MongoClient(MONGO);
    await c2.connect();
    const pagos = c2.db(DB).collection('pagos_cuenta');
    const nuevoPago = (fecha, monto) => ({ _id: new ObjectId(), clienteId: new ObjectId(luis.id), monto, fecha, usuarioId: new ObjectId(idAdmin), nota: null, metodoPago: 'transferencia' });
    await pagos.insertMany([
      nuevoPago('2026-09-15T02:59:59.000Z', 111), // 23:59:59 del 14/9 en Argentina
      nuevoPago('2026-09-15T03:00:00.000Z', 222), // 00:00:00 del 15/9 en Argentina
      nuevoPago('2026-09-20T15:00:00.000Z', 333), // 20/9, sin ventas ese día
    ]);
    await c2.close();
    const mes = (await api('GET', '/api/ventas/resumen-mes?anio=2026&mes=8', undefined, token)).data;
    const fila = (f) => mes.find((x) => x.fecha === f);
    ok(fila('2026-09-14')?.totalPagos === 111 && fila('2026-09-15')?.totalPagos === 222, 'el día se corta a medianoche de Argentina: 23:59:59 es del 14 y 00:00:00 es del 15');
    ok(fila('2026-09-20')?.totalPagos === 333 && fila('2026-09-20')?.cantidadVentas === 0 && fila('2026-09-20')?.totalCobrado === 0, 'un día con un pago y sin ventas igual aparece en el calendario');
    ok(mes.every((x, i) => i === 0 || mes[i - 1].fecha < x.fecha), 'los días vienen en orden');
    const pagosDel14 = (await api('GET', '/api/clientes/pagos/dia/2026-09-14', undefined, token)).data;
    ok(pagosDel14.length === 1 && pagosDel14[0].monto === 111 && pagosDel14[0].metodoPago === 'transferencia', 'el detalle del 14/9 trae sólo ese pago ($111, por transferencia)');
    const rep = (await api('GET', `/api/reportes/ventas?desde=${encodeURIComponent('2026-09-01T03:00:00.000Z')}&hasta=${encodeURIComponent('2026-10-01T03:00:00.000Z')}`, undefined, token)).data;
    ok(rep.totalPagos === 111 + 222 + 333 && rep.cantidadPagos === 3, `el reporte de septiembre suma los pagos de cuentas: $666 en 3 pagos (${rep.totalPagos})`);
    ok(rep.cantidadVentas === 0 && rep.porDia.length === 3 && rep.porDia.every((d) => d.cantidadVentas === 0 && d.totalPagos > 0), 'sin ventas ese mes, el reporte igual trae los 3 días con pagos');
    const repHoy = (await api('GET', `/api/reportes/ventas?desde=${encodeURIComponent(haceDias(1))}&hasta=${encodeURIComponent(new Date(Date.now() + DIA).toISOString())}`, undefined, token)).data;
    ok(repHoy.totalPagos === pagosDeHoy && repHoy.totalCobrado === 300, 'el reporte de los últimos días: pagos $1000 y ventas cobradas $300, cada uno en su lugar');
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
