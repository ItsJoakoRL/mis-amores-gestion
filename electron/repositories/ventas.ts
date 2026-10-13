import crypto from 'crypto';
import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../db/database';
import { getArticulo, ajustarStock } from './articulos';
import { DIA_LOCAL_EXPR, limitesDiaLocal, limitesDiaLocalYMD, limitesMesLocal, ymdLocal } from '../fechaLocal';
import { redondearCantidad } from '../../shared/formato';
import type { MetodoPago, ResumenDiaVentas, Venta, VentaInput } from '../../shared/types';

const METODOS_PAGO: readonly MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];

interface VentaDoc {
  _id: ObjectId;
  articuloId: ObjectId;
  articuloDescripcion: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
  metodoPago: MetodoPago;
  clienteId: ObjectId | null;
  usuarioId: ObjectId;
  fecha: string;
  /** Sólo se usa cuando metodoPago es 'fiado'. Ventas viejas no tienen este
   * campo guardado todavía — mapDoc las trata como no pagadas. */
  pagado?: boolean;
}

interface VentaDocConJoins extends VentaDoc {
  usuario?: Array<{ nombre: string }>;
  cliente?: Array<{ nombre: string }>;
}

function coleccion(): Collection<VentaDoc> {
  return getDb().collection<VentaDoc>('ventas');
}

function mapDoc(doc: VentaDocConJoins): Venta {
  return {
    id: doc._id.toHexString(),
    articuloId: doc.articuloId.toHexString(),
    articuloDescripcion: doc.articuloDescripcion,
    cantidad: doc.cantidad,
    precioUnitario: doc.precioUnitario,
    total: doc.total,
    metodoPago: doc.metodoPago,
    clienteId: doc.clienteId ? doc.clienteId.toHexString() : null,
    clienteNombre: doc.cliente?.[0]?.nombre ?? null,
    usuarioId: doc.usuarioId.toHexString(),
    usuarioNombre: doc.usuario?.[0]?.nombre ?? null,
    fecha: doc.fecha,
    pagado: doc.pagado ?? false,
  };
}

const JOIN_USUARIO = { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } };
const JOIN_CLIENTE = { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } };

// Registrar una venta descuenta el stock del artículo (como un egreso más, así
// queda también en su historial de movimientos) y guarda una "foto" del
// nombre y precio del momento — si después cambian el precio o el artículo,
// esta venta vieja no se altera.
export async function crearVenta(input: VentaInput, usuarioId: string): Promise<Venta> {
  // "!(x > 0)" en vez de "x <= 0": así también frena un NaN o algo que ni
  // siquiera es un número (con "<= 0" un NaN pasaba y dejaba el stock en NaN).
  if (typeof input.cantidad !== 'number' || !(input.cantidad > 0) || !Number.isFinite(input.cantidad)) {
    throw new Error('La cantidad tiene que ser mayor a cero');
  }
  if (!METODOS_PAGO.includes(input.metodoPago)) {
    throw new Error('La forma de pago no es válida');
  }
  if (input.metodoPago === 'fiado' && !input.clienteId) {
    throw new Error('Para una venta fiada hay que elegir a qué cliente se le anota');
  }
  const articulo = await getArticulo(input.articuloId);
  if (!articulo) {
    throw new Error('El artículo no existe');
  }
  if (articulo.unidad !== 'peso' && !Number.isInteger(input.cantidad)) {
    throw new Error(`"${articulo.descripcion}" se vende por unidad: la cantidad tiene que ser un número entero`);
  }
  const cantidad = redondearCantidad(input.cantidad);

  // El descuento de stock va primero: además de ser la operación que
  // controla que haya stock suficiente (ver ajustarStock), así nunca se
  // registra una venta de algo que no se pudo descontar.
  await ajustarStock(input.articuloId, cantidad, 'egreso', 'Venta', usuarioId);

  const doc: Omit<VentaDoc, '_id'> = {
    articuloId: new ObjectId(input.articuloId),
    articuloDescripcion: articulo.descripcion,
    cantidad,
    precioUnitario: articulo.precioVenta,
    total: Math.round(articulo.precioVenta * cantidad * 100) / 100,
    metodoPago: input.metodoPago,
    clienteId: input.clienteId ? new ObjectId(input.clienteId) : null,
    usuarioId: new ObjectId(usuarioId),
    fecha: new Date().toISOString(),
  };

  try {
    const result = await coleccion().insertOne(doc as VentaDoc);
    const guardada = await coleccion()
      .aggregate<VentaDocConJoins>([{ $match: { _id: result.insertedId } }, JOIN_USUARIO, JOIN_CLIENTE])
      .toArray();
    return mapDoc(guardada[0]);
  } catch (err) {
    // El stock ya se había descontado para esta venta — si no se pudo
    // guardar el registro (ej. se cortó la conexión a la base a mitad de
    // camino), lo reponemos para no dejar el inventario corto sin ninguna
    // venta que lo explique.
    await ajustarStock(input.articuloId, cantidad, 'ingreso', 'Venta no se pudo guardar, stock repuesto', usuarioId).catch(
      () => {}
    );
    throw err;
  }
}

// Marca (o desmarca) un fiado puntual como pagado — deja de contar para la
// deuda del cliente (ver listClientes en clientes.ts), pero el registro
// sigue en el historial para que quede memoria de qué se compró.
export async function marcarFiadoPagado(id: string, pagado: boolean): Promise<void> {
  const result = await coleccion().updateOne(
    { _id: new ObjectId(id), metodoPago: 'fiado' },
    { $set: { pagado: pagado === true } }
  );
  if (result.matchedCount === 0) {
    throw new Error('No se encontró ese fiado');
  }
}

// Deshacer una venta: borra el registro y repone el stock (como un ingreso,
// a nombre de quien la anuló). El borrado va primero y es atómico: si dos
// personas anulan la misma venta casi a la vez, sólo una la encuentra — antes
// las dos reponían el stock y quedaba inflado.
export async function eliminarVenta(id: string, usuarioId: string): Promise<void> {
  const venta = await coleccion().findOneAndDelete({ _id: new ObjectId(id) });
  if (!venta) return;

  try {
    const articuloId = venta.articuloId.toHexString();
    if (await getArticulo(articuloId)) {
      // El movimiento de reposición tiene un _id que sale de la venta: si dos
      // PCs anulan la misma venta a la vez (antes de enterarse una de la otra),
      // las dos generan el MISMO movimiento y el stock se repone una sola vez.
      const idMovimiento = new ObjectId(
        crypto.createHash('sha1').update(`anulacion:${id}`).digest().subarray(0, 12)
      );
      await ajustarStock(articuloId, venta.cantidad, 'ingreso', 'Venta anulada', usuarioId, idMovimiento);
    }
  } catch (err) {
    // No se pudo reponer el stock: se vuelve a guardar la venta tal cual
    // estaba, mejor que una venta borrada sin su stock devuelto.
    await coleccion()
      .insertOne(venta)
      .catch(() => {});
    throw err;
  }
}

export async function listVentasPorDia(fechaYMD: string): Promise<Venta[]> {
  const { desde, hasta } = limitesDiaLocalYMD(fechaYMD);
  const docs = await coleccion()
    .aggregate<VentaDocConJoins>([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      JOIN_USUARIO,
      JOIN_CLIENTE,
      { $sort: { fecha: 1 } },
    ])
    .toArray();
  return docs.map(mapDoc);
}

// Suma condicional: separa lo que fue fiado (no es plata en la caja) de lo
// que sí se cobró (efectivo, tarjeta o transferencia) — se reusa en cada
// agregación que resume ventas por día, para no repetir el $cond.
const SUMA_COBRADO = { $cond: [{ $ne: ['$metodoPago', 'fiado'] }, '$total', 0] };
const SUMA_FIADO = { $cond: [{ $eq: ['$metodoPago', 'fiado'] }, '$total', 0] };

// Un total y una cantidad de ventas por cada día del mes pedido — lo que
// necesita el calendario para pintar cada casillero sin traer cada venta.
export async function resumenMes(anio: number, mesIndiceCero: number): Promise<ResumenDiaVentas[]> {
  const { desde, hasta } = limitesMesLocal(anio, mesIndiceCero);

  const docs = await coleccion()
    .aggregate<{ _id: string; total: number; totalCobrado: number; totalFiado: number; cantidadVentas: number }>([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      {
        $group: {
          _id: DIA_LOCAL_EXPR,
          total: { $sum: '$total' },
          totalCobrado: { $sum: SUMA_COBRADO },
          totalFiado: { $sum: SUMA_FIADO },
          cantidadVentas: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return docs.map((d) => ({
    fecha: d._id,
    total: d.total,
    totalCobrado: d.totalCobrado,
    totalFiado: d.totalFiado,
    cantidadVentas: d.cantidadVentas,
  }));
}

// Los fiados más recientes de TODOS los clientes, de una — pensado para que
// cualquiera (esté en el celular o en la PC) vea de un vistazo quién le fió
// qué a quién sin tener que entrar cliente por cliente.
export async function listUltimosFiados(limite: number): Promise<Venta[]> {
  const docs = await coleccion()
    .aggregate<VentaDocConJoins>([
      { $match: { metodoPago: 'fiado' } },
      JOIN_USUARIO,
      JOIN_CLIENTE,
      { $sort: { fecha: -1 } },
      { $limit: limite },
    ])
    .toArray();
  return docs.map(mapDoc);
}

export async function resumenHoy(): Promise<ResumenDiaVentas> {
  const { desde, hasta } = limitesDiaLocal(0);
  const docs = await coleccion()
    .aggregate<{ total: number; totalCobrado: number; totalFiado: number; cantidadVentas: number }>([
      { $match: { fecha: { $gte: desde, $lt: hasta } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          totalCobrado: { $sum: SUMA_COBRADO },
          totalFiado: { $sum: SUMA_FIADO },
          cantidadVentas: { $sum: 1 },
        },
      },
    ])
    .toArray();
  return {
    fecha: ymdLocal(),
    total: docs[0]?.total ?? 0,
    totalCobrado: docs[0]?.totalCobrado ?? 0,
    totalFiado: docs[0]?.totalFiado ?? 0,
    cantidadVentas: docs[0]?.cantidadVentas ?? 0,
  };
}
