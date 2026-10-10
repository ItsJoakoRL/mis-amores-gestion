import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../db/database';
import { formatearCantidad } from '../../shared/formato';
import type { Cliente, ClienteInput, MetodoPago, MovimientoCuenta } from '../../shared/types';

// Con qué se puede pagar una deuda — "fiado" no: sería pagar una deuda con otra.
const METODOS_PAGO_CUENTA: readonly MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia'];

function redondearPesos(monto: number): number {
  return Math.round(monto * 100) / 100;
}

interface ClienteDoc {
  _id: ObjectId;
  nombre: string;
  nota: string | null;
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

  const clientes = docs.map((doc) => {
    const debe = (doc.ventasFiado[0]?.totalPendiente ?? 0) + (doc.ajustes[0]?.total ?? 0);
    const totalPagos = doc.pagos[0]?.total ?? 0;
    return {
      id: doc._id.toHexString(),
      nombre: doc.nombre,
      nota: doc.nota,
      activo: doc.activo,
      saldo: Math.round((debe - totalPagos) * 100) / 100,
      ultimoFiado: doc.ventasFiado[0]?.ultimaFecha ?? null,
    };
  });
  // Los que más deben primero — es lo que la jefa quiere ver de un vistazo.
  return clientes.sort((a, b) => b.saldo - a.saldo);
}

function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// Deuda que el cliente ya traía antes de cargarlo (ej. venía anotado en un
// cuaderno) — se guarda como un ajuste manual, no como una venta real, para
// no inventar una venta que nunca pasó por la caja. `fechaInicial` deja
// anotar cuándo empezó a deber en realidad (puede ser de hace rato), en vez
// de que siempre quede fechado hoy.
export async function crearCliente(
  input: ClienteInput,
  deudaInicial: number,
  usuarioId: string,
  fechaInicial?: string
): Promise<Cliente> {
  const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : '';
  if (!nombre) throw new Error('Ingresá el nombre del cliente');
  // Un monto que no es un número (NaN, texto) se toma como "no debe nada"
  // en vez de guardarse tal cual y romper el saldo del cliente.
  const deuda = typeof deudaInicial === 'number' && Number.isFinite(deudaInicial) && deudaInicial > 0
    ? redondearPesos(deudaInicial)
    : 0;
  const doc: Omit<ClienteDoc, '_id'> = {
    nombre,
    nota: input.nota?.trim() || null,
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
          fecha: fechaInicial || new Date().toISOString(),
          usuarioId: new ObjectId(usuarioId),
          nota: 'Saldo inicial',
        });
    }
    return {
      id: result.insertedId.toHexString(),
      nombre: doc.nombre,
      nota: doc.nota,
      activo: true,
      saldo: deuda,
      ultimoFiado: null,
    };
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un cliente con ese nombre');
    throw err;
  }
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
  await getDb()
    .collection('pagos_cuenta')
    .insertOne({
      clienteId: new ObjectId(clienteId),
      monto: redondearPesos(monto),
      fecha: new Date().toISOString(),
      usuarioId: new ObjectId(usuarioId),
      nota,
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

// El historial de cuenta de un cliente: cada compra fiada suma, cada pago
// resta, todo mezclado por fecha para ver el ida y vuelta completo.
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
      usuario?: Array<{ nombre: string }>;
    }>([{ $match: { clienteId: objectId } }, JOIN_USUARIO])
    .toArray();

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
    })),
  ];

  return movimientos.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
