// Recordatorios: lo que hay que hacer, cambiar, reponer o cobrar, anotado en un
// lugar común para que todas las que usan la app (en las PCs y en los
// celulares) estén al tanto. Se sincroniza entre las PCs como el resto de los
// datos (ver sync/modelo.ts).
import { ObjectId, type Collection } from 'mongodb';
import { getDb } from '../db/database';
import { ymdLocal } from '../fechaLocal';
import type {
  Recordatorio,
  RecordatorioInput,
  ResumenRecordatorios,
  TipoRecordatorio,
} from '../../shared/types';

const TIPOS: readonly TipoRecordatorio[] = ['hacer', 'cambiar', 'reponer', 'cobrar', 'otro'];
const MAX_TEXTO = 300;
// Los "hechos" más viejos que esto se limpian solos (ver iniciarMantenimiento).
const DIAS_HECHOS_VISIBLES = 30;

interface RecordatorioDoc {
  _id: ObjectId;
  texto: string;
  tipo: TipoRecordatorio;
  urgente: boolean;
  /** 'YYYY-MM-DD' o null */
  paraFecha: string | null;
  /** A qué producto o cliente se refiere (como mucho uno). */
  articuloId?: ObjectId | null;
  clienteId?: ObjectId | null;
  /** El nombre de entonces: por si el producto o el cliente ya no está. */
  vinculoNombre?: string | null;
  hecho: boolean;
  creadoEn: string;
  creadoPorId: ObjectId;
  hechoEn: string | null;
  hechoPorId: ObjectId | null;
}

interface RecordatorioConJoins extends RecordatorioDoc {
  creador?: Array<{ nombre: string }>;
  hacedor?: Array<{ nombre: string }>;
  articulo?: Array<{ descripcion: string }>;
  cliente?: Array<{ nombre: string }>;
}

function coleccion(): Collection<RecordatorioDoc> {
  return getDb().collection<RecordatorioDoc>('recordatorios');
}

function mapDoc(d: RecordatorioConJoins): Recordatorio {
  return {
    id: d._id.toHexString(),
    texto: d.texto,
    tipo: d.tipo,
    urgente: d.urgente === true,
    paraFecha: d.paraFecha ?? null,
    articuloId: d.articuloId ? d.articuloId.toHexString() : null,
    clienteId: d.clienteId ? d.clienteId.toHexString() : null,
    // El nombre de ahora si el producto o cliente existe; si no, el de cuando se anotó.
    vinculoNombre: d.articulo?.[0]?.descripcion ?? d.cliente?.[0]?.nombre ?? d.vinculoNombre ?? null,
    vinculoExiste: d.articuloId ? !!d.articulo?.[0] : d.clienteId ? !!d.cliente?.[0] : false,
    hecho: d.hecho === true,
    creadoEn: d.creadoEn,
    creadoPorId: d.creadoPorId ? d.creadoPorId.toHexString() : null,
    creadoPorNombre: d.creador?.[0]?.nombre ?? null,
    hechoEn: d.hechoEn ?? null,
    hechoPorNombre: d.hacedor?.[0]?.nombre ?? null,
  };
}

const JOINS = [
  { $lookup: { from: 'usuarios', localField: 'creadoPorId', foreignField: '_id', as: 'creador' } },
  { $lookup: { from: 'usuarios', localField: 'hechoPorId', foreignField: '_id', as: 'hacedor' } },
  { $lookup: { from: 'articulos', localField: 'articuloId', foreignField: '_id', as: 'articulo' } },
  { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } },
];

function aObjectId(valor: unknown): ObjectId | null {
  return typeof valor === 'string' && /^[0-9a-f]{24}$/i.test(valor) ? new ObjectId(valor) : null;
}

type DatosLimpios = Pick<
  RecordatorioDoc,
  'texto' | 'tipo' | 'urgente' | 'paraFecha' | 'articuloId' | 'clienteId' | 'vinculoNombre'
>;

async function limpiarInput(input: RecordatorioInput): Promise<DatosLimpios> {
  const texto = typeof input.texto === 'string' ? input.texto.trim().replace(/\s+/g, ' ') : '';
  if (!texto) throw new Error('Escribí qué hay que hacer o cambiar');
  if (texto.length > MAX_TEXTO) throw new Error(`Es muy largo: hasta ${MAX_TEXTO} letras`);
  const tipo = TIPOS.includes(input.tipo) ? input.tipo : 'hacer';
  const paraFecha =
    typeof input.paraFecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.paraFecha) ? input.paraFecha : null;

  // A qué producto o cliente se refiere (uno solo), con su nombre de ahora.
  let articuloId = aObjectId(input.articuloId);
  let clienteId = articuloId ? null : aObjectId(input.clienteId);
  let vinculoNombre: string | null = null;
  if (articuloId) {
    const a = await getDb().collection('articulos').findOne({ _id: articuloId }, { projection: { descripcion: 1 } });
    if (a) vinculoNombre = String(a.descripcion ?? '');
    else articuloId = null;
  } else if (clienteId) {
    const c = await getDb().collection('clientes').findOne({ _id: clienteId }, { projection: { nombre: 1 } });
    if (c) vinculoNombre = String(c.nombre ?? '');
    else clienteId = null;
  }
  return { texto, tipo, urgente: input.urgente === true, paraFecha, articuloId, clienteId, vinculoNombre };
}

export async function listRecordatorios(estado: 'pendientes' | 'hechos'): Promise<Recordatorio[]> {
  if (estado === 'hechos') {
    const docs = await coleccion()
      .aggregate<RecordatorioConJoins>([
        { $match: { hecho: true } },
        { $sort: { hechoEn: -1 } },
        { $limit: 100 },
        ...JOINS,
      ])
      .toArray();
    return docs.map(mapDoc);
  }
  const docs = await coleccion()
    .aggregate<RecordatorioConJoins>([
      { $match: { hecho: false } },
      // Primero lo urgente, después lo que tiene fecha (la más cercana
      // primero) y al final lo que no tiene fecha (lo más nuevo arriba).
      { $addFields: { _sinFecha: { $cond: [{ $eq: [{ $ifNull: ['$paraFecha', null] }, null] }, 1, 0] } } },
      { $sort: { urgente: -1, _sinFecha: 1, paraFecha: 1, creadoEn: -1 } },
      ...JOINS,
    ])
    .toArray();
  return docs.map(mapDoc);
}

export async function resumenRecordatorios(): Promise<ResumenRecordatorios> {
  const hoy = ymdLocal();
  const [pendientes, urgentes, vencidos, paraHoy] = await Promise.all([
    coleccion().countDocuments({ hecho: false }),
    coleccion().countDocuments({ hecho: false, urgente: true }),
    coleccion().countDocuments({ hecho: false, paraFecha: { $lt: hoy } }),
    coleccion().countDocuments({ hecho: false, paraFecha: hoy }),
  ]);
  return { pendientes, urgentes, vencidos, paraHoy };
}

export async function crearRecordatorio(input: RecordatorioInput, usuarioId: string): Promise<Recordatorio> {
  const datos = await limpiarInput(input);
  const doc: Omit<RecordatorioDoc, '_id'> = {
    ...datos,
    hecho: false,
    creadoEn: new Date().toISOString(),
    creadoPorId: new ObjectId(usuarioId),
    hechoEn: null,
    hechoPorId: null,
  };
  const res = await coleccion().insertOne(doc as RecordatorioDoc);
  const guardado = await coleccion()
    .aggregate<RecordatorioConJoins>([{ $match: { _id: res.insertedId } }, ...JOINS])
    .toArray();
  return mapDoc(guardado[0]);
}

export async function actualizarRecordatorio(id: string, input: RecordatorioInput): Promise<Recordatorio> {
  const datos = await limpiarInput(input);
  const res = await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: datos });
  if (res.matchedCount === 0) throw new Error('Ese recordatorio ya no existe');
  const guardado = await coleccion()
    .aggregate<RecordatorioConJoins>([{ $match: { _id: new ObjectId(id) } }, ...JOINS])
    .toArray();
  return mapDoc(guardado[0]);
}

/** Marca (o desmarca) como hecho: queda anotado quién y cuándo. */
export async function marcarRecordatorioHecho(id: string, hecho: boolean, usuarioId: string): Promise<void> {
  const cambios = hecho
    ? { hecho: true, hechoEn: new Date().toISOString(), hechoPorId: new ObjectId(usuarioId) }
    : { hecho: false, hechoEn: null, hechoPorId: null };
  const res = await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: cambios });
  if (res.matchedCount === 0) throw new Error('Ese recordatorio ya no existe');
}

/** Lo borra el que lo anotó o una administradora. */
export async function eliminarRecordatorio(id: string, usuarioId: string, esAdmin: boolean): Promise<void> {
  const doc = await coleccion().findOne({ _id: new ObjectId(id) });
  if (!doc) return;
  if (!esAdmin && doc.creadoPorId.toHexString() !== usuarioId) {
    throw new Error('Sólo lo puede borrar quien lo anotó o una administradora. Si ya está hecho, marcalo como hecho.');
  }
  await coleccion().deleteOne({ _id: doc._id });
}

/** Saca de la lista los "hechos" de hace más de unos días (los que ya no sirven). */
export async function limpiarRecordatoriosHechos(): Promise<number> {
  const limite = new Date(Date.now() - DIAS_HECHOS_VISIBLES * 24 * 60 * 60 * 1000).toISOString();
  const res = await coleccion().deleteMany({ hecho: true, hechoEn: { $lt: limite } });
  return res.deletedCount;
}
