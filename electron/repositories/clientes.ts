import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../db/database';
import { formatearCantidad } from '../../shared/formato';
import {
  compararAntiguedad,
  deudaDesdeDe,
  normalizarItemsDeuda,
  repartirPagos,
  type LineaDeuda,
} from '../../shared/cuentaCorriente';
import { DIA_LOCAL_EXPR, limitesDiaLocalYMD } from '../fechaLocal';
import type {
  Cliente,
  ClienteInput,
  EstadoCuenta,
  ItemDeuda,
  MetodoPago,
  MovimientoCuenta,
  PagoCuentaDelDia,
} from '../../shared/types';

// Con qué se puede pagar una deuda — "fiado" no: sería pagar una deuda con otra.
const METODOS_PAGO_CUENTA: readonly MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia'];

function redondearPesos(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/** El teléfono tal como se anotó, sin espacios de más. Sólo números, espacios y
 * + - ( ) . (a una persona se la llama o se le escribe: no hace falta más). */
export function limpiarTelefono(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new Error('El teléfono no es válido');
  const texto = valor.trim().replace(/\s+/g, ' ');
  if (texto === '') return null;
  if (texto.length > 30 || !/^[0-9 +()\-.]+$/.test(texto) || !/[0-9]/.test(texto)) {
    throw new Error('El teléfono sólo puede tener números, espacios y los signos + - ( )');
  }
  return texto;
}

interface ClienteDoc {
  _id: ObjectId;
  nombre: string;
  nota: string | null;
  /** Clientes de antes no lo tienen guardado todavía. */
  telefono?: string | null;
  activo: boolean;
  creadoEn: string;
}

function coleccion(): Collection<ClienteDoc> {
  return getDb().collection<ClienteDoc>('clientes');
}

// El saldo no se guarda como un número fijo en el cliente — se calcula sumando
// sus ventas fiadas y los ajustes manuales (ej. la deuda que ya traía de
// antes) y restando los pagos que hizo. Así nunca se puede desincronizar por
// un bug: siempre refleja los movimientos reales.
//
// Antes esto se calculaba con 3-4 consultas separadas por cada cliente
// (un patrón N+1: con unas pocas docenas de clientes, listar la pantalla
// entera disparaba cientos de viajes a la base). Ahora es una sola
// agregación con los tres $lookup resueltos para todos los clientes juntos.
export async function listClientes(): Promise<Cliente[]> {
  const docs = await coleccion()
    .aggregate<
      ClienteDoc & {
        ventasFiado: Array<{ totalPendiente: number; ultimaFecha: string }>;
        ajustes: Array<{ total: number }>;
        pagos: Array<{ total: number }>;
      }
    >([
      { $match: { activo: true } },
      {
        $lookup: {
          from: 'ventas',
          let: { clienteId: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$clienteId', '$$clienteId'] }, { $eq: ['$metodoPago', 'fiado'] }] } } },
            {
              $group: {
                _id: null,
                // Un fiado ya marcado como pagado deja de sumar deuda, pero
                // la fecha del último fiado es un dato histórico — cuenta
                // para eso esté pagado o no.
                totalPendiente: { $sum: { $cond: [{ $eq: ['$pagado', true] }, 0, '$total'] } },
                ultimaFecha: { $max: '$fecha' },
              },
            },
          ],
          as: 'ventasFiado',
        },
      },
      {
        $lookup: {
          from: 'ajustes_cuenta',
          let: { clienteId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$clienteId', '$$clienteId'] } } },
            { $group: { _id: null, total: { $sum: '$monto' } } },
          ],
          as: 'ajustes',
        },
      },
      {
        $lookup: {
          from: 'pagos_cuenta',
          let: { clienteId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$clienteId', '$$clienteId'] } } },
            { $group: { _id: null, total: { $sum: '$monto' } } },
          ],
          as: 'pagos',
        },
      },
    ])
    .toArray();

  const saldos = docs.map((doc) => {
    const debe = (doc.ventasFiado[0]?.totalPendiente ?? 0) + (doc.ajustes[0]?.total ?? 0);
    const totalPagos = doc.pagos[0]?.total ?? 0;
    return { doc, saldo: Math.round((debe - totalPagos) * 100) / 100, totalPagos };
  });
  const desde = await deudaDesdeDeLosQueDeben(saldos.filter((x) => x.saldo > 0).map((x) => ({ id: x.doc._id, totalPagos: x.totalPagos })));
  const clientes: Cliente[] = saldos.map(({ doc, saldo }) => ({
    id: doc._id.toHexString(),
    nombre: doc.nombre,
    nota: doc.nota,
    telefono: doc.telefono ?? null,
    activo: doc.activo,
    saldo,
    ultimoFiado: doc.ventasFiado[0]?.ultimaFecha ?? null,
    deudaDesde: desde.get(doc._id.toHexString()) ?? null,
  }));
  // Los que más deben primero — es lo que la jefa quiere ver de un vistazo.
  return clientes.sort((a, b) => b.saldo - a.saldo);
}

// Desde cuándo debe cada uno: los pagos (y los descuentos) se van descontando de lo
// más viejo primero, y la deuda "arranca" en la fecha de lo primero que todavía no
// quedó cubierto. Así quien pagó sus deudas viejas y debe sólo lo de esta semana
// figura "debe desde esta semana", no desde hace 3 meses. Con dos consultas para
// todos juntos (no una por cliente).
async function deudaDesdeDeLosQueDeben(deben: Array<{ id: ObjectId; totalPagos: number }>): Promise<Map<string, string>> {
  const resultado = new Map<string, string>();
  if (deben.length === 0) return resultado;
  const cuentas = await lineasPendientesDe(deben.map((d) => d.id));
  for (const { id, totalPagos } of deben) {
    const k = id.toHexString();
    const cuenta = cuentas.get(k);
    if (!cuenta) continue;
    // Un descuento (ajuste negativo) cubre deuda igual que un pago.
    const desde = deudaDesdeDe(cuenta.lineas, totalPagos + cuenta.descuentos);
    if (desde) resultado.set(k, desde);
  }
  return resultado;
}

// Lo que debe cada cliente, línea por línea: los fiados que no se marcaron como pagados y
// las deudas anotadas a mano. Los descuentos (ajustes que restan) van aparte: cubren deuda
// como un pago. Dos consultas para todos juntos (no una por cliente).
async function lineasPendientesDe(ids: ObjectId[]): Promise<Map<string, { lineas: LineaDeuda[]; descuentos: number }>> {
  const porCliente = new Map<string, { lineas: LineaDeuda[]; descuentos: number }>();
  if (ids.length === 0) return porCliente;
  const db = getDb();
  const [ventas, ajustes] = await Promise.all([
    db
      .collection('ventas')
      .find({ clienteId: { $in: ids }, metodoPago: 'fiado', pagado: { $ne: true } }, { projection: { clienteId: 1, fecha: 1, total: 1 } })
      .toArray(),
    db.collection('ajustes_cuenta').find({ clienteId: { $in: ids } }, { projection: { clienteId: 1, fecha: 1, monto: 1 } }).toArray(),
  ]);
  const de = (clienteId: ObjectId) => {
    const k = clienteId.toHexString();
    let c = porCliente.get(k);
    if (!c) porCliente.set(k, (c = { lineas: [], descuentos: 0 }));
    return c;
  };
  for (const v of ventas) {
    de(v.clienteId as ObjectId).lineas.push({ id: String(v._id), fecha: String(v.fecha), monto: Number(v.total) || 0 });
  }
  for (const a of ajustes) {
    const monto = Number(a.monto) || 0;
    const cuenta = de(a.clienteId as ObjectId);
    if (monto < 0) cuenta.descuentos -= monto;
    else cuenta.lineas.push({ id: String(a._id), fecha: String(a.fecha), monto });
  }
  return porCliente;
}

/** Cuánto falta pagar de cada fiado (por id de venta) de estos clientes, con los pagos de
 * cada uno descontados de lo más viejo a lo más nuevo. Los fiados marcados como pagados a
 * mano no figuran. */
export async function restasDeFiados(clienteIds: ObjectId[]): Promise<Map<string, number>> {
  const restas = new Map<string, number>();
  if (clienteIds.length === 0) return restas;
  const [cuentas, pagos] = await Promise.all([
    lineasPendientesDe(clienteIds),
    getDb()
      .collection('pagos_cuenta')
      .aggregate<{ _id: ObjectId; total: number }>([
        { $match: { clienteId: { $in: clienteIds } } },
        { $group: { _id: '$clienteId', total: { $sum: '$monto' } } },
      ])
      .toArray(),
  ]);
  const pagado = new Map(pagos.map((p) => [p._id.toHexString(), p.total]));
  for (const [k, cuenta] of cuentas) {
    for (const [id, resta] of repartirPagos(cuenta.lineas, (pagado.get(k) ?? 0) + cuenta.descuentos)) restas.set(id, resta);
  }
  return restas;
}

function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Deuda que el cliente ya traía antes de cargarlo (ej. venía anotado en un
// cuaderno) — se guarda como un ajuste manual, no como una venta real, para
// no inventar una venta que nunca pasó por la caja. `fechaInicial` deja
// anotar cuándo empezó a deber en realidad (puede ser de hace rato), en vez
// de que siempre quede fechado hoy.
// La fecha desde la que se debe algo anotado a mano: puede ser de hace rato, pero no del
// futuro. Sin fecha, es ahora.
function resolverFechaDeDeuda(fecha: unknown): string {
  if (fecha === undefined || fecha === null || fecha === '') return new Date().toISOString();
  const f = typeof fecha === 'string' ? new Date(fecha) : null;
  if (!f || Number.isNaN(f.getTime())) throw new Error('La fecha no es válida');
  if (f.getTime() > Date.now() + 60_000) throw new Error('La fecha no puede ser de más adelante');
  return f.toISOString();
}

// Lo que se anota a mano: o un monto solo, o una lista de productos (y entonces el monto
// es lo que suman: el que manda la pantalla se ignora).
function resolverDeudaAnotada(monto: unknown, items: unknown): { monto: number; items: ItemDeuda[] | null } {
  if (Array.isArray(items) && items.length > 0) {
    const r = normalizarItemsDeuda(items);
    return { monto: r.total, items: r.items };
  }
  if (typeof monto !== 'number' || !(monto > 0) || !Number.isFinite(monto) || monto > 1e9) {
    throw new Error('El monto de la deuda tiene que ser mayor a cero');
  }
  return { monto: redondearPesos(monto), items: null };
}

export async function crearCliente(
  input: ClienteInput,
  deudaInicial: number,
  usuarioId: string,
  fechaInicial?: string,
  items?: unknown
): Promise<Cliente> {
  const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : '';
  if (!nombre) throw new Error('Ingresá el nombre del cliente');
  // Un monto que no es un número (NaN, texto) se toma como "no debe nada"
  // en vez de guardarse tal cual y romper el saldo del cliente.
  const hayProductos = Array.isArray(items) && items.length > 0;
  const hayMonto = typeof deudaInicial === 'number' && Number.isFinite(deudaInicial) && deudaInicial > 0;
  const deudaAnotada = hayProductos || hayMonto ? resolverDeudaAnotada(deudaInicial, items) : null;
  const deuda = deudaAnotada?.monto ?? 0;
  // Se revisa antes de crear al cliente: con una fecha mala no tiene que quedar a medias.
  const fechaDeuda = deuda > 0 ? resolverFechaDeDeuda(fechaInicial) : null;
  const telefono = limpiarTelefono(input.telefono);
  const doc: Omit<ClienteDoc, '_id'> = {
    nombre,
    nota: input.nota?.trim() || null,
    telefono,
    activo: true,
    creadoEn: new Date().toISOString(),
  };
  try {
    const result = await coleccion().insertOne(doc as ClienteDoc);
    if (deuda > 0) {
      await getDb()
        .collection('ajustes_cuenta')
        .insertOne({
          clienteId: result.insertedId,
          monto: deuda,
          fecha: fechaDeuda as string,
          usuarioId: new ObjectId(usuarioId),
          nota: 'Saldo inicial',
          ...(deudaAnotada?.items ? { items: deudaAnotada.items } : {}),
        });
    }
    return {
      id: result.insertedId.toHexString(),
      nombre: doc.nombre,
      nota: doc.nota,
      telefono,
      activo: true,
      saldo: deuda,
      ultimoFiado: null,
      deudaDesde: deuda > 0 ? fechaDeuda : null,
    };
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un cliente con ese nombre');
    throw err;
  }
}

// Cambia el nombre, la nota o el teléfono de un cliente. Dos clientes no pueden
// llamarse igual (sin importar mayúsculas), como al crearlos.
export async function actualizarCliente(id: string, input: ClienteInput): Promise<void> {
  if (!(await existeClienteActivo(id))) throw new Error('Ese cliente ya no está en la lista');
  const nombre = typeof input?.nombre === 'string' ? input.nombre.trim() : '';
  if (!nombre) throw new Error('Ingresá el nombre del cliente');
  if (nombre.length > 120) throw new Error('El nombre es demasiado largo');
  const nota = typeof input.nota === 'string' ? input.nota.trim().slice(0, 300) || null : null;
  const telefono = limpiarTelefono(input.telefono);
  try {
    await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: { nombre, nota, telefono } });
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un cliente con ese nombre');
    throw err;
  }
}

// Anota una deuda a mano en la cuenta del cliente (por ejemplo, algo que estaba en el
// cuaderno): se guarda como un "ajuste" que suma deuda, no como una venta, para no
// inventar una venta que nunca pasó por la caja. `fecha` es desde cuándo debe (puede
// ser de hace rato), no puede ser del futuro.
export async function registrarAjuste(
  clienteId: string,
  monto: number,
  nota: string | null,
  usuarioId: string,
  fecha?: string,
  items?: unknown
): Promise<void> {
  const deuda = resolverDeudaAnotada(monto, items);
  if (!(await existeClienteActivo(clienteId))) throw new Error('Ese cliente ya no está en la lista');
  const cuando = resolverFechaDeDeuda(fecha);
  const detalle = typeof nota === 'string' ? nota.trim().slice(0, 200) : '';
  await getDb()
    .collection('ajustes_cuenta')
    .insertOne({
      clienteId: new ObjectId(clienteId),
      monto: deuda.monto,
      fecha: cuando,
      usuarioId: new ObjectId(usuarioId),
      nota: detalle || 'Deuda anotada',
      ...(deuda.items ? { items: deuda.items } : {}),
    });
}

// Los pagos que se recibieron en un día (hora de Argentina), para verlos junto a las ventas.
export async function pagosDelDia(fechaYMD: string): Promise<PagoCuentaDelDia[]> {
  if (typeof fechaYMD !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaYMD)) throw new Error('La fecha no es válida');
  const { desde, hasta } = limitesDiaLocalYMD(fechaYMD);
  const docs = await getDb()
    .collection('pagos_cuenta')
    .aggregate<{
      _id: ObjectId;
      fecha: string;
      monto: number;
      nota: string | null;
      metodoPago?: MetodoPago;
      clienteId: ObjectId;
      cliente?: Array<{ nombre: string }>;
      usuario?: Array<{ nombre: string }>;
    }>([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } },
      { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } },
      { $sort: { fecha: 1 } },
    ])
    .toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    fecha: d.fecha,
    monto: d.monto,
    metodoPago: d.metodoPago ?? null,
    clienteId: d.clienteId.toHexString(),
    clienteNombre: d.cliente?.[0]?.nombre ?? null,
    usuarioNombre: d.usuario?.[0]?.nombre ?? null,
    nota: d.nota ?? null,
  }));
}

/** Cuánto se cobró en pagos de cuentas, día por día, dentro de [desde, hasta). */
export async function pagosPorDia(desde: string, hasta: string): Promise<Map<string, { total: number; cantidad: number }>> {
  const docs = await getDb()
    .collection('pagos_cuenta')
    .aggregate<{ _id: string; total: number; cantidad: number }>([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      { $group: { _id: DIA_LOCAL_EXPR, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(docs.map((d) => [d._id, { total: d.total, cantidad: d.cantidad }]));
}

/** ¿Existe este cliente y está en la lista? Una venta fiada o un pago a nombre
 * de alguien que no está dejaría una deuda que no aparece en ninguna pantalla. */
export async function existeClienteActivo(id: unknown): Promise<boolean> {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) return false;
  return (await coleccion().countDocuments({ _id: new ObjectId(id), activo: true }, { limit: 1 })) > 0;
}

export async function setClienteActivo(id: string, activo: boolean): Promise<void> {
  await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: { activo } });
}

export async function registrarPago(
  clienteId: string,
  monto: number,
  usuarioId: string,
  nota: string | null,
  metodoPago: MetodoPago
): Promise<void> {
  // "!(monto > 0)" en vez de "monto <= 0": también frena un NaN, que antes
  // pasaba y dejaba el saldo del cliente en NaN para siempre.
  if (typeof monto !== 'number' || !(monto > 0) || !Number.isFinite(monto)) {
    throw new Error('El monto del pago tiene que ser mayor a cero');
  }
  if (!METODOS_PAGO_CUENTA.includes(metodoPago)) throw new Error('La forma de pago no es válida');
  if (!(await existeClienteActivo(clienteId))) throw new Error('Ese cliente ya no está en la lista');
  await getDb()
    .collection('pagos_cuenta')
    .insertOne({
      clienteId: new ObjectId(clienteId),
      monto: redondearPesos(monto),
      fecha: new Date().toISOString(),
      usuarioId: new ObjectId(usuarioId),
      nota: typeof nota === 'string' ? nota.trim().slice(0, 200) || null : null,
      metodoPago,
    });
}

// Para corregir un pago cargado por error (monto equivocado, cliente
// equivocado, etc.) — lo saca de la cuenta corriente, el saldo se recalcula
// solo la próxima vez que se pida.
export async function eliminarPago(id: string): Promise<void> {
  await getDb()
    .collection('pagos_cuenta')
    .deleteOne({ _id: new ObjectId(id) });
}

// Igual que eliminarPago, pero para un ajuste manual (ej. un "saldo inicial"
// que se cargó mal).
export async function eliminarAjuste(id: string): Promise<void> {
  await getDb()
    .collection('ajustes_cuenta')
    .deleteOne({ _id: new ObjectId(id) });
}

/// Lo que debe un cliente para mandárselo: lo que todavía tiene que pagar, producto por
// producto, y lo que ya pagó. Los pagos se descuentan de lo más viejo primero (así lo que
// queda anotado es lo que de verdad sigue sin pagar: un fiado viejo que ya se cubrió no
// aparece). Un fiado marcado como pagado a mano no cuenta, igual que en el saldo de la
// lista. Devuelve null si el cliente no existe o ya no está en la lista.
export async function estadoDeCuenta(clienteId: string): Promise<EstadoCuenta | null> {
  if (typeof clienteId !== 'string' || !ObjectId.isValid(clienteId)) return null;
  const cliente = await coleccion().findOne({ _id: new ObjectId(clienteId), activo: true });
  if (!cliente) return null;
  const movimientos = (await historialCliente(clienteId)).sort(compararAntiguedad);
  const pendientes = movimientos
    .filter((m) => m.tipo !== 'pago' && m.resta !== null && m.resta > 0.005)
    .map((m) => ({
      fecha: m.fecha,
      descripcion: m.descripcion,
      monto: m.monto,
      resta: m.resta as number,
      ...(m.items && m.items.length > 0 ? { items: m.items } : {}),
    }));
  // Lo que se descontó de la deuda: pagos y, si los hay, descuentos cargados a mano.
  const pagos = movimientos
    .filter((m) => m.tipo === 'pago' || (m.tipo === 'ajuste' && m.monto < 0))
    .map((m) => ({ fecha: m.fecha, descripcion: m.descripcion, monto: Math.abs(m.monto) }));
  const saldo = redondearPesos(
    movimientos.reduce((acc, m) => {
      if (m.tipo === 'pago') return acc - m.monto;
      if (m.tipo === 'venta' && m.pagado) return acc;
      return acc + m.monto;
    }, 0)
  );
  const totalPagado = redondearPesos(pagos.reduce((acc, l) => acc + l.monto, 0));
  return { clienteId, nombre: cliente.nombre, fecha: new Date().toISOString(), saldo, pendientes, pagos, totalPagado };
}

// El historial de cuenta de un cliente: cada compra fiada suma, cada pago
// resta, todo mezclado por fecha para ver el ida y vuelta completo. Cada deuda trae qué
// productos son (si se sabe) y cuánto falta pagar de ella.
export async function historialCliente(clienteId: string): Promise<MovimientoCuenta[]> {
  const db = getDb();
  const objectId = new ObjectId(clienteId);
  const JOIN_USUARIO = { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } };

  const ventas = await db
    .collection('ventas')
    .aggregate<{
      _id: ObjectId;
      fecha: string;
      total: number;
      cantidad: number;
      precioUnitario?: number;
      articuloDescripcion: string;
      pagado?: boolean;
      usuario?: Array<{ nombre: string }>;
    }>([{ $match: { clienteId: objectId, metodoPago: 'fiado' } }, JOIN_USUARIO])
    .toArray();

  const pagos = await db
    .collection('pagos_cuenta')
    .aggregate<{
      _id: ObjectId;
      fecha: string;
      monto: number;
      nota: string | null;
      metodoPago?: MetodoPago;
      usuario?: Array<{ nombre: string }>;
    }>([{ $match: { clienteId: objectId } }, JOIN_USUARIO])
    .toArray();

  const ajustes = await db
    .collection('ajustes_cuenta')
    .aggregate<{
      _id: ObjectId;
      fecha: string;
      monto: number;
      nota: string | null;
      items?: ItemDeuda[];
      usuario?: Array<{ nombre: string }>;
    }>([{ $match: { clienteId: objectId } }, JOIN_USUARIO])
    .toArray();

  // Cuánto falta pagar de cada deuda: los pagos (y los descuentos) cubren de lo más viejo
  // a lo más nuevo. Un fiado marcado como pagado a mano no entra en la cuenta.
  const lineas: LineaDeuda[] = [
    ...ventas.filter((v) => v.pagado !== true).map((v) => ({ id: v._id.toHexString(), fecha: v.fecha, monto: v.total })),
    ...ajustes.filter((a) => a.monto > 0).map((a) => ({ id: a._id.toHexString(), fecha: a.fecha, monto: a.monto })),
  ];
  const credito =
    pagos.reduce((acc, p) => acc + p.monto, 0) + ajustes.filter((a) => a.monto < 0).reduce((acc, a) => acc - a.monto, 0);
  const restas = repartirPagos(lineas, credito);

  const movimientos: MovimientoCuenta[] = [
    ...ventas.map((v) => ({
      id: v._id.toHexString(),
      tipo: 'venta' as const,
      fecha: v.fecha,
      monto: v.total,
      descripcion: `${formatearCantidad(v.cantidad)} x ${v.articuloDescripcion}`,
      usuarioNombre: v.usuario?.[0]?.nombre ?? null,
      metodoPago: null,
      pagado: v.pagado ?? false,
      items: [
        {
          descripcion: v.articuloDescripcion,
          cantidad: v.cantidad,
          precioUnitario: v.precioUnitario ?? (v.cantidad > 0 ? redondearPesos(v.total / v.cantidad) : v.total),
        },
      ],
      resta: restas.get(v._id.toHexString()) ?? null,
    })),
    ...pagos.map((p) => ({
      id: p._id.toHexString(),
      tipo: 'pago' as const,
      fecha: p.fecha,
      monto: p.monto,
      descripcion: p.nota || 'Pago recibido',
      usuarioNombre: p.usuario?.[0]?.nombre ?? null,
      // Pagos cargados antes de este campo no tienen método guardado.
      metodoPago: p.metodoPago ?? null,
      pagado: null,
      items: null,
      resta: null,
    })),
    ...ajustes.map((a) => ({
      id: a._id.toHexString(),
      tipo: 'ajuste' as const,
      fecha: a.fecha,
      monto: a.monto,
      descripcion: a.nota || 'Ajuste de saldo',
      usuarioNombre: a.usuario?.[0]?.nombre ?? null,
      metodoPago: null,
      pagado: null,
      items: Array.isArray(a.items) && a.items.length > 0 ? a.items : null,
      resta: restas.get(a._id.toHexString()) ?? null,
    })),
  ];

  // Lo más nuevo primero (con la misma fecha, el que se creó después).
  return movimientos.sort((a, b) => compararAntiguedad(b, a));
}
