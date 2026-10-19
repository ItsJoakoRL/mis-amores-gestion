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
    // ------------------------------------------------------------------ productos en la deuda anotada
    log('\n[7] La deuda anotada a mano con la lista de productos');
    const deudaCon = (id, items, extra = {}) =>
      api('POST', `/api/clientes/${id}/deuda`, { monto: 1, nota: null, fecha: haceDias(30), items, ...extra }, token);
    const rosa = await crearCliente('ROSA PRODUCTOS');
    const cuaderno = [
      { descripcion: 'Fiambre de jamón cocido (kg)', cantidad: 0.5, precioUnitario: 9000 },
      { descripcion: 'Queso cremoso', cantidad: 1, precioUnitario: 4800 },
      { descripcion: '  Pan   lactal  ', cantidad: 2, precioUnitario: 2100 },
    ];
    r = await deudaCon(rosa.id, cuaderno, { nota: 'Cuaderno de septiembre' });
    ok(r.ok === true, 'se anota una deuda con 3 productos');
    c = await de(rosa.id);
    ok(c.saldo === 4500 + 4800 + 4200, `debe lo que suman los productos: $13.500 (aunque la pantalla mande otro monto): ${c.saldo}`);
    hist = (await api('GET', `/api/clientes/${rosa.id}/historial`, undefined, token)).data;
    const mov = hist.find((m) => m.tipo === 'ajuste');
    ok(mov.descripcion === 'Cuaderno de septiembre' && mov.monto === 13500, 'en su cuenta queda con la nota y el total');
    ok(mov.items?.length === 3 && mov.items[0].descripcion.startsWith('Fiambre') && mov.items[0].cantidad === 0.5 && mov.items[0].precioUnitario === 9000, 'y con cada producto, su cantidad (también por kilo) y su precio');
    ok(mov.items[2].descripcion === 'Pan lactal', 'los espacios de más del nombre se limpian');
    r = await api('POST', `/api/clientes/${rosa.id}/deuda`, { monto: 700, nota: 'solo monto', fecha: haceDias(10) }, token);
    hist = (await api('GET', `/api/clientes/${rosa.id}/historial`, undefined, token)).data;
    ok(r.ok && hist.find((m) => m.descripcion === 'solo monto').items === null, 'una deuda anotada sólo con el monto sigue andando (sin productos)');

    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: '', cantidad: 1, precioUnitario: 5 }]), 'le falta el nombre'), 'un producto sin nombre se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X', cantidad: 0, precioUnitario: 5 }]), 'cantidad.*mayor a cero'), 'una cantidad de cero se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X', cantidad: 1, precioUnitario: -5 }]), 'precio.*no es v'), 'un precio negativo se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X', cantidad: 1, precioUnitario: 0 }]), 'total.*mayor a cero'), 'si todo vale cero, se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X', cantidad: '2', precioUnitario: 5 }]), 'cantidad'), 'una cantidad que no es número se rechaza');
    ok(rechazo(await deudaCon(rosa.id, Array.from({ length: 61 }, (_, n) => ({ descripcion: 'P' + n, cantidad: 1, precioUnitario: 1 }))), 'hasta 60'), 'más de 60 productos juntos se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X'.repeat(121), cantidad: 1, precioUnitario: 5 }]), 'demasiado largo'), 'un nombre larguísimo se rechaza');
    ok(rechazo(await deudaCon(rosa.id, [{ descripcion: 'X', cantidad: 1, precioUnitario: 5 }], { fecha: new Date(Date.now() + 5 * DIA).toISOString() }), 'más adelante'), 'una fecha del futuro se rechaza');
    ok(rechazo(await api('POST', `/api/clientes/${rosa.id}/deuda`, { monto: 0, items: [] }, token), 'mayor a cero'), 'sin productos y sin monto no se anota nada');
    ok((await de(rosa.id)).saldo === 13500 + 700, 'y nada de eso modificó lo que debe ($14.200)');

    // Crear un cliente con la deuda de entrada.
    r = await api('POST', '/api/clientes', { nombre: 'NUEVO CON LISTA', nota: null, telefono: null, deudaInicial: 1, fechaInicial: haceDias(15), items: [{ descripcion: 'Yerba', cantidad: 2, precioUnitario: 3500 }, { descripcion: 'Azúcar', cantidad: 1, precioUnitario: 1200 }] }, token);
    ok(r.ok && r.data.saldo === 8200, `un cliente nuevo puede nacer debiendo una lista de productos: $8.200 (${r.data?.saldo})`);
    hist = (await api('GET', `/api/clientes/${r.data.id}/historial`, undefined, token)).data;
    ok(hist.length === 1 && hist[0].descripcion === 'Saldo inicial' && hist[0].items?.length === 2, 'figura como "Saldo inicial" con sus 2 productos');
    ok(Math.abs(new Date(r.data.deudaDesde).getTime() - (Date.now() - 15 * DIA)) < 60000, 'y debe desde la fecha que se puso (hace 15 días)');

    const antes = (await lista()).length;
    r = await api('POST', '/api/clientes', { nombre: 'FECHA ROTA', nota: null, telefono: null, deudaInicial: 500, fechaInicial: 'no es una fecha' }, token);
    ok(rechazo(r, 'fecha no es v'), 'crear con una fecha que no es fecha se rechaza');
    r = await api('POST', '/api/clientes', { nombre: 'FECHA FUTURA', nota: null, telefono: null, deudaInicial: 500, fechaInicial: new Date(Date.now() + 9 * DIA).toISOString() }, token);
    ok(rechazo(r, 'más adelante'), 'crear con una fecha del futuro se rechaza');
    ok((await lista()).length === antes, 'y en ninguno de los dos casos queda un cliente a medias');
    r = await api('POST', '/api/clientes', { nombre: 'SIN FECHA', nota: null, telefono: null, deudaInicial: 100 }, token);
    ok(r.ok && Math.abs(new Date(r.data.deudaDesde).getTime() - Date.now()) < 60000, 'sin fecha, la deuda de entrada es de ahora');
    r = await api('POST', '/api/clientes', { nombre: 'SIN DEUDA', nota: null, telefono: null, deudaInicial: 0, fechaInicial: 'cualquier cosa' }, token);
    ok(r.ok && r.data.saldo === 0 && r.data.deudaDesde === null, 'sin deuda, la fecha no importa (no se anota nada)');

    // ------------------------------------------------------------------ cuánto falta pagar de cada cosa
    log('\n[8] Lo que paga se descuenta de lo más viejo: qué falta pagar, producto por producto');
    const anita = await crearCliente('ANA LA DEL FIADO');
    const alfajor = (await api('POST', '/api/articulos', entradaArticulo({ descripcion: 'ALFAJOR TRIPLE', precioVenta: 1200 }), token)).data;
    const cola = (await api('POST', '/api/articulos', entradaArticulo({ descripcion: 'COCA COLA 1.5L', precioVenta: 2500 }), token)).data;
    await deudaCon(anita.id, [{ descripcion: 'Fiambre', cantidad: 1, precioUnitario: 3000 }, { descripcion: 'Queso', cantidad: 1, precioUnitario: 1200 }], { nota: 'Del cuaderno', fecha: haceDias(40) });
    const v1 = (await api('POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'fiado', clienteId: anita.id }, token)).data;
    const v2 = (await api('POST', '/api/ventas', { articuloId: cola.id, cantidad: 1, metodoPago: 'fiado', clienteId: anita.id }, token)).data;
    ok((await de(anita.id)).saldo === 4200 + 2400 + 2500, 'debe $9.100 (cuaderno $4.200 + alfajores $2.400 + coca $2.500)');
    let est = (await api('GET', `/api/clientes/${anita.id}/estado`, undefined, token)).data;
    ok(est.pendientes.length === 3 && est.pagos.length === 0 && est.totalPagado === 0, 'sin pagos: 3 cosas pendientes y nada pagado');
    ok(est.pendientes[0].descripcion === 'Del cuaderno' && est.pendientes[0].items.length === 2 && est.pendientes[0].resta === 4200, 'lo más viejo es el cuaderno, con sus 2 productos');
    const lAlfajor = est.pendientes.find((l) => l.descripcion === '2 x ALFAJOR TRIPLE');
    ok(lAlfajor && lAlfajor.items.length === 1 && lAlfajor.items[0].precioUnitario === 1200 && lAlfajor.items[0].cantidad === 2 && lAlfajor.resta === 2400, 'un fiado del mostrador trae su producto, su cantidad y el precio de cada uno');

    await pago(anita.id, 3000);
    est = (await api('GET', `/api/clientes/${anita.id}/estado`, undefined, token)).data;
    ok(est.saldo === 6100 && est.totalPagado === 3000, 'paga $3.000: ahora debe $6.100');
    ok(est.pendientes.length === 3 && est.pendientes[0].monto === 4200 && est.pendientes[0].resta === 1200, 'se descontó del cuaderno (lo más viejo): le quedan $1.200 de $4.200');
    ok(est.pendientes.reduce((a, l) => a + l.resta, 0) === est.saldo, 'lo que falta pagar de cada cosa suma exactamente lo que debe');
    hist = (await api('GET', `/api/clientes/${anita.id}/historial`, undefined, token)).data;
    ok(hist.find((m) => m.descripcion === 'Del cuaderno').resta === 1200 && hist.find((m) => m.id === v1.id).resta === 2400, 'el historial también dice cuánto falta de cada cosa');
    ok(hist.find((m) => m.tipo === 'pago').resta === null && hist.find((m) => m.tipo === 'pago').items === null, 'y un pago no tiene ni "falta" ni productos');
    let ultimos = (await api('GET', '/api/ventas/ultimos-fiados?limite=10', undefined, token)).data;
    ok(ultimos.find((v) => v.id === v1.id).resta === 2400 && ultimos.find((v) => v.id === v2.id).resta === 2500, 'la lista de últimos fiados trae cuánto falta de cada uno');

    await pago(anita.id, 2500);
    est = (await api('GET', `/api/clientes/${anita.id}/estado`, undefined, token)).data;
    ok(est.saldo === 3600 && est.pendientes.length === 2, 'paga $2.500 más: el cuaderno ya no figura (quedó cubierto) y debe $3.600');
    ok(est.pendientes[0].descripcion === '2 x ALFAJOR TRIPLE' && est.pendientes[0].resta === 1100 && est.pendientes[0].monto === 2400, 'se empezó a pagar los alfajores: faltan $1.100 de $2.400');
    ok(est.pendientes[1].resta === 2500, 'la coca sigue completa');
    ultimos = (await api('GET', '/api/ventas/ultimos-fiados?limite=10', undefined, token)).data;
    ok(ultimos.find((v) => v.id === v1.id).resta === 1100 && ultimos.find((v) => v.id === v2.id).resta === 2500, 'en últimos fiados, los alfajores figuran "faltan $1.100"');
    c = await de(anita.id);
    ok(Math.abs(new Date(c.deudaDesde).getTime() - new Date(v1.fecha).getTime()) < 5, 'y debe desde la fecha de los alfajores (lo más viejo que sigue sin cubrirse)');

    await pago(anita.id, 5000);
    est = (await api('GET', `/api/clientes/${anita.id}/estado`, undefined, token)).data;
    ok(est.saldo === -1400 && est.pendientes.length === 0 && est.totalPagado === 10500, 'si paga de más: no queda nada pendiente y tiene $1.400 a favor');
    ultimos = (await api('GET', '/api/ventas/ultimos-fiados?limite=10', undefined, token)).data;
    ok(ultimos.find((v) => v.id === v1.id).resta === 0 && ultimos.find((v) => v.id === v2.id).resta === 0, 'y en últimos fiados los dos figuran cubiertos');

    // Un fiado marcado como pagado a mano (como se hacía antes) no cuenta; un descuento (ajuste que resta) cubre como un pago.
    const beto = await crearCliente('BETO CON DESCUENTO');
    await deudaCon(beto.id, [{ descripcion: 'Cosas', cantidad: 1, precioUnitario: 1000 }], { nota: 'Primero', fecha: haceDias(30) });
    await deudaCon(beto.id, [{ descripcion: 'Más cosas', cantidad: 1, precioUnitario: 600 }], { nota: 'Segundo', fecha: haceDias(10) });
    const vb = (await api('POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 1, metodoPago: 'fiado', clienteId: beto.id }, token)).data;
    await api('POST', `/api/ventas/${vb.id}/pagado`, { pagado: true }, token);
    const c3 = new MongoClient(MONGO);
    await c3.connect();
    await c3.db(DB).collection('ajustes_cuenta').insertOne({ _id: new ObjectId(), clienteId: new ObjectId(beto.id), monto: -400, fecha: haceDias(5), usuarioId: new ObjectId(idAdmin), nota: 'Descuento por pronto pago' });
    await c3.close();
    est = (await api('GET', `/api/clientes/${beto.id}/estado`, undefined, token)).data;
    ok(est.saldo === 1200, `debe 1000 + 600 - 400 de descuento, sin contar el fiado marcado como pagado: $1.200 (${est.saldo})`);
    ok(est.pendientes.length === 2 && est.pendientes[0].resta === 600 && est.pendientes[1].resta === 600, 'el descuento de $400 se aplicó a lo más viejo: $1.000 pasó a $600');
    ok(est.pagos.length === 1 && est.pagos[0].monto === 400 && /Descuento/.test(est.pagos[0].descripcion), 'y el descuento figura entre lo que se descontó');
    ok((await de(beto.id)).saldo === 1200, 'la lista de clientes dice lo mismo ($1.200)');

    // Dos deudas con exactamente la misma fecha (pasa: la fecha llega hasta el minuto): siempre se cubre primero la que se anotó antes.
    const gemelos = await crearCliente('GEMELOS DE FECHA');
    const mismaFecha = haceDias(7);
    await deudaCon(gemelos.id, [{ descripcion: 'Primera cosa', cantidad: 1, precioUnitario: 1000 }], { nota: 'Primera', fecha: mismaFecha });
    await deudaCon(gemelos.id, [{ descripcion: 'Segunda cosa', cantidad: 1, precioUnitario: 500 }], { nota: 'Segunda', fecha: mismaFecha });
    await pago(gemelos.id, 1000);
    est = (await api('GET', `/api/clientes/${gemelos.id}/estado`, undefined, token)).data;
    ok(est.pendientes.length === 1 && est.pendientes[0].descripcion === 'Segunda' && est.pendientes[0].resta === 500, 'con la misma fecha exacta, se cubre primero lo que se anotó antes: queda pendiente "Segunda" ($500)');
    hist = (await api('GET', `/api/clientes/${gemelos.id}/historial`, undefined, token)).data;
    ok(hist.find((m) => m.descripcion === 'Primera').resta === 0 && hist.find((m) => m.descripcion === 'Segunda').resta === 500, 'y el historial dice lo mismo');
    ok(hist[0].descripcion === 'Pago recibido' || hist[0].descripcion === 'Segunda', 'el historial va de lo más nuevo a lo más viejo, también con fechas iguales');

    // El PDF dice qué productos debe.
    log('\n[9] El PDF dice qué productos tiene que pagar');
    const carla = await crearCliente('CARLA DEL MOSTRADOR');
    await api('POST', '/api/ventas', { articuloId: alfajor.id, cantidad: 2, metodoPago: 'fiado', clienteId: carla.id }, token);
    await api('POST', '/api/ventas', { articuloId: cola.id, cantidad: 1, metodoPago: 'fiado', clienteId: carla.id }, token);
    const pdfCarla = Buffer.from((await api('GET', `/api/clientes/${carla.id}/estado-pdf`, undefined, token)).data, 'base64').toString('latin1');
    ok(pdfCarla.includes('2 x ALFAJOR TRIPLE') && pdfCarla.includes('1 x COCA COLA 1.5L'), 'lista los productos del mostrador por su nombre y cantidad');
    ok(pdfCarla.includes('1.200,00 cada uno'), 'y el precio de cada alfajor');
    const pdf = Buffer.from((await api('GET', `/api/clientes/${anita.id}/estado-pdf`, undefined, token)).data, 'base64').toString('latin1');
    const pdfRosa = Buffer.from((await api('GET', `/api/clientes/${rosa.id}/estado-pdf`, undefined, token)).data, 'base64').toString('latin1');
    ok(pdfRosa.includes('Fiambre de') && pdfRosa.includes('Queso cremoso') && pdfRosa.includes('Pan lactal'), 'lista los productos de lo anotado a mano');
    ok(pdfRosa.includes('0,5 x Fiambre') && pdfRosa.includes('c/u'), 'con su cantidad y el precio de cada uno');
    ok(pdfRosa.includes('Cuaderno de septiembre') && pdfRosa.includes('FALTA PAGAR'), 'y la nota, con la columna "falta pagar"');
    const pdfBeto = Buffer.from((await api('GET', `/api/clientes/${beto.id}/estado-pdf`, undefined, token)).data, 'base64').toString('latin1');
    ok(pdfBeto.includes('Lo que ya pag') && pdfBeto.includes('1.200,00'), 'si ya pagó algo, el PDF lo aclara y muestra el total');
    ok(!pdf.includes('Del cuaderno'), 'lo que ya quedó cubierto (el cuaderno de Ana) ya no aparece entre lo pendiente');

    // Un pago con nota; y la nota se limpia y se corta.
    const ben = await crearCliente('BEN LAS NOTAS');
    await deudaCon(ben.id, [{ descripcion: 'X', cantidad: 1, precioUnitario: 900 }]);
    await api('POST', `/api/clientes/${ben.id}/pago`, { monto: 100, nota: '   dejó una parte   ', metodoPago: 'efectivo' }, token);
    await api('POST', `/api/clientes/${ben.id}/pago`, { monto: 50, nota: 'z'.repeat(500), metodoPago: 'efectivo' }, token);
    await api('POST', `/api/clientes/${ben.id}/pago`, { monto: 25, nota: '   ', metodoPago: 'efectivo' }, token);
    hist = (await api('GET', `/api/clientes/${ben.id}/historial`, undefined, token)).data.filter((m) => m.tipo === 'pago');
    ok(hist.some((m) => m.descripcion === 'dejó una parte'), 'la nota de un pago se guarda sin espacios de más');
    ok(hist.some((m) => m.descripcion.length === 200), 'y se corta en 200 letras');
    ok(hist.some((m) => m.monto === 25 && m.descripcion === 'Pago recibido'), 'una nota en blanco queda como "Pago recibido"');
    // ------------------------------------------------------------------ la cuenta, sin base de datos
    log('\n[10] El reparto de los pagos (la cuenta sola, con casos raros)');
    const { repartirPagos, deudaDesdeDe, normalizarItemsDeuda, aclaracionesDeLinea } = require(path.join(RAIZ, 'dist-electron/shared/cuentaCorriente.js'));
    const L = (id, fecha, monto) => ({ id, fecha, monto });
    let rp = repartirPagos([L('b', '2026-02-01', 300), L('a', '2026-01-01', 200), L('c', '2026-03-01', 100)], 250);
    ok(rp.get('a') === 0 && rp.get('b') === 250 && rp.get('c') === 100, 'se paga de lo más viejo a lo más nuevo, sin importar en qué orden vengan');
    rp = repartirPagos([L('a', '2026-01-01', 0.1), L('b', '2026-01-02', 0.2), L('c', '2026-01-03', 5)], 0.3);
    ok(rp.get('a') === 0 && rp.get('b') === 0 && rp.get('c') === 5, 'con decimales (0,1 + 0,2 = 0,3) no queda un centavo fantasma');
    rp = repartirPagos([L('b', '2026-01-01', 100), L('a', '2026-01-01', 100)], 100);
    ok(rp.get('a') === 0 && rp.get('b') === 100, 'con la misma fecha manda el orden de creación (el id), venga como venga la lista');
    rp = repartirPagos([L('a', '2026-01-01', 0), L('b', '2026-01-02', -50), L('c', '2026-01-03', 80)], 30);
    ok(!rp.has('a') && !rp.has('b') && rp.get('c') === 50, 'lo que vale cero o es negativo no es deuda y se ignora');
    rp = repartirPagos([L('a', '2026-01-01', 100)], -500);
    ok(rp.get('a') === 100, 'un crédito negativo no aumenta la deuda');
    rp = repartirPagos([], 100);
    ok(rp.size === 0, 'sin deudas no hay nada que repartir');
    ok(deudaDesdeDe([L('a', '2026-01-01', 100), L('b', '2026-02-01', 100)], 100) === '2026-02-01', 'debe desde la fecha de lo primero que no quedó cubierto');
    ok(deudaDesdeDe([L('a', '2026-01-01', 100), L('b', '2026-02-01', 100)], 150) === '2026-02-01', 'una parte pagada de lo segundo: sigue debiendo desde ahí');
    ok(deudaDesdeDe([L('a', '2026-01-01', 100)], 100) === null && deudaDesdeDe([], 0) === null, 'si no debe nada, no hay fecha');
    ok(deudaDesdeDe([L('b', '2026-02-01', 100), L('a', '2026-01-01', 100)], 0) === '2026-01-01', 'sin pagos: desde la deuda más vieja');
    let n = normalizarItemsDeuda([{ descripcion: ' Pan ', cantidad: 3, precioUnitario: 0.1 }, { descripcion: 'Leche', cantidad: 1.2345, precioUnitario: 100 }]);
    ok(n.items[1].cantidad === 1.235 && n.total === 123.8, `la cantidad se redondea a 3 decimales y el total no arrastra restos (${n.total})`);
    ok(n.items[0].descripcion === 'Pan', 'el nombre se limpia');
    ok(aclaracionesDeLinea({ descripcion: '2 x ALFAJOR', items: [{ descripcion: 'ALFAJOR', cantidad: 2, precioUnitario: 1200 }] }).join('|').includes('1.200,00 cada uno'), 'un fiado de varias unidades aclara el precio de cada una');
    ok(aclaracionesDeLinea({ descripcion: '1 x ALFAJOR', items: [{ descripcion: 'ALFAJOR', cantidad: 1, precioUnitario: 1200 }] }).length === 0, 'uno solo no repite el precio');
    ok(aclaracionesDeLinea({ descripcion: 'Del cuaderno', items: [{ descripcion: 'Pan', cantidad: 2, precioUnitario: 100 }] })[0].replace(/ /g, ' ') === '2 x Pan · $ 100,00 c/u · $ 200,00', 'una deuda anotada a mano lista cada producto con su precio y subtotal');
    ok(aclaracionesDeLinea({ descripcion: 'Cualquiera' }).length === 0, 'sin productos no aclara nada');
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
