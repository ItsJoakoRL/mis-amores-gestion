// Qué hacer con los cambios que llegan de otra PC.
//
// Las reglas, pensadas para que dos PCs que cargan cosas a la vez (o que
// estuvieron un rato sin verse) terminen con exactamente lo mismo y sin perder
// nada de lo que se cargó:
//
// - Un documento que acá no existe se agrega tal cual.
// - Dos cambios al mismo documento se combinan CAMPO POR CAMPO: si una PC
//   cambió el precio y la otra el nombre, quedan los dos; si las dos cambiaron
//   el mismo campo, gana el más reciente (por la marca del reloj, no por la
//   hora de llegada).
// - Un documento borrado queda borrado (una venta anulada no puede
//   "resucitar" porque otra PC la estaba editando).
// - El stock no se copia: se calcula como "stock inicial + suma de movimientos",
//   y los movimientos (ventas, ingresos, ajustes) sí viajan y se suman. Así dos
//   PCs que venden lo mismo a la vez descuentan las dos.
// - Si dos PCs cargaron "lo mismo" a la vez (un rubro, una marca, un cliente o
//   un usuario con el mismo nombre) se unifican en uno solo y todo lo que
//   apuntaba al repetido pasa a apuntar al que queda. Si es un producto con el
//   mismo código de barras, no se pueden unir sin riesgo (hay stock y ventas):
//   a uno se le saca el código y se avisa.
import fs from 'fs';
import path from 'path';
import { BSON, ObjectId, type Collection, type Document } from 'mongodb';
import { redondearCantidad } from '../../shared/formato';
import type { Diario, ItemCambio } from './diario';
import {
  camposPropios,
  claveDeMeta,
  esErrorDuplicado,
  esReplicada,
  hex,
  REFERENCIAS,
  referenciasA,
  UNIFICABLES,
} from './modelo';

// =====================================================================
// La decisión (pura: no toca la base, así se puede probar suelta)
// =====================================================================

export interface MetaLocal {
  inc: number;
  del: string | null;
  clocks: Record<string, string>;
}

export interface MetaNueva extends MetaLocal {
  al?: ObjectId | null;
}

export interface Entrante {
  inc: number;
  del: string | null;
  clocks: Record<string, string>;
  doc: Document | null;
}

export type Decision =
  | { accion: 'nada' }
  /** Borrar el documento (si está) y dejar la lápida. */
  | { accion: 'borrar'; meta: MetaNueva }
  /** Dejar el documento tal como vino (crearlo si no estaba). */
  | { accion: 'reemplazar'; doc: Document; meta: MetaNueva }
  /** Cambiar sólo estos campos. */
  | { accion: 'combinar'; set: Document; unset: string[]; meta: MetaNueva };

export function decidir(local: MetaLocal | null, existeDoc: boolean, e: Entrante): Decision {
  const lapida = (): Decision => ({
    accion: 'borrar',
    meta: { inc: e.inc, del: e.del, clocks: {} },
  });
  const tomarEntrante = (): Decision =>
    e.del !== null
      ? lapida()
      : { accion: 'reemplazar', doc: e.doc ?? {}, meta: { inc: e.inc, del: null, clocks: { ...e.clocks } } };

  // Acá no hay registro de este documento.
  if (!local) return tomarEntrante();

  if (e.inc > local.inc) return tomarEntrante();
  if (e.inc < local.inc) return { accion: 'nada' };

  // Misma "vida" del documento. Dos PCs que borraron lo mismo cada una por su
  // lado anotaron marcas distintas: todas se quedan con la más alta, para que
  // terminen idénticas.
  if (local.del !== null) {
    if (e.del !== null && e.del > local.del) return { accion: 'borrar', meta: { inc: local.inc, del: e.del, clocks: {} } };
    return { accion: 'nada' };
  }
  if (e.del !== null) return { accion: 'borrar', meta: { inc: local.inc, del: e.del, clocks: {} } };

  const set: Document = {};
  const unset: string[] = [];
  const clocks = { ...local.clocks };
  let cambio = false;
  for (const [campo, marca] of Object.entries(e.clocks)) {
    const actual = local.clocks[campo];
    if (actual !== undefined && actual >= marca) continue;
    clocks[campo] = marca;
    cambio = true;
    if (e.doc && campo in e.doc) set[campo] = e.doc[campo];
    else unset.push(campo);
  }
  if (!cambio) return { accion: 'nada' };
  // Tenía registro pero el documento no estaba: se toma completo.
  if (!existeDoc) return { accion: 'reemplazar', doc: e.doc ?? {}, meta: { inc: local.inc, del: null, clocks } };
  return { accion: 'combinar', set, unset, meta: { inc: local.inc, del: null, clocks } };
}

// =====================================================================
// Aplicar de verdad
// =====================================================================

export interface OpcionesAplicador {
  /** Dónde guarda las fotos de los productos esta PC. */
  carpetaImagenes: string;
  /** Algo que la administradora tiene que saber (ver Diario.avisar). */
  alAvisar?: (texto: string) => void;
  /** Se cambió o borró un usuario: para cerrar sus sesiones del celular. */
  alCambiarUsuario?: (idUsuario: string) => void;
  alFallar?: (etiqueta: string, err: unknown) => void;
}

export interface ResultadoAplicar {
  aplicados: number;
  sinCambio: number;
  errores: number;
  /** Nombres de las fotos que todavía no están en el disco de esta PC. */
  fotosFaltantes: string[];
}

function esObjectId(valor: unknown): valor is ObjectId {
  return valor instanceof ObjectId || (typeof valor === 'object' && valor !== null && (valor as { _bsontype?: string })._bsontype === 'ObjectId');
}

export class Aplicador {
  constructor(
    private readonly diario: Diario,
    private readonly opciones: OpcionesAplicador
  ) {}

  async aplicar(items: ItemCambio[], de: string): Promise<ResultadoAplicar> {
    const resultado: ResultadoAplicar = { aplicados: 0, sinCambio: 0, errores: 0, fotosFaltantes: [] };
    const fotos = new Set<string>();
    const stock = new Set<string>();
    const idsStock: ObjectId[] = [];

    for (const item of items) {
      try {
        const hizoAlgo = await this.diario.conLlave(() => this.aplicarUno(item, de, fotos, (id) => {
          const k = hex(id);
          if (stock.has(k)) return;
          stock.add(k);
          idsStock.push(id);
        }));
        if (hizoAlgo) resultado.aplicados += 1;
        else resultado.sinCambio += 1;
      } catch (err) {
        resultado.errores += 1;
        this.opciones.alFallar?.(`aplicar ${item.c}:${hex(item.id)}`, err);
      }
    }

    if (idsStock.length > 0) {
      await this.diario.conLlave(() => recalcularStock(this.diario, idsStock)).catch((err) => this.opciones.alFallar?.('stock', err));
    }
    resultado.fotosFaltantes = [...fotos];
    return resultado;
  }

  // Con la llave tomada. Devuelve true si cambió algo en esta PC.
  private async aplicarUno(
    item: ItemCambio,
    de: string,
    fotos: Set<string>,
    recalcular: (id: ObjectId) => void
  ): Promise<boolean> {
    const c = item.c;
    if (!esReplicada(c)) return false;
    if (item.del === null && !item.doc) return false;
    const d = this.diario;

    // El reloj de esta PC tiene que quedar por encima de todo lo visto.
    for (const marca of Object.values(item.clocks ?? {})) d.reloj.ver(marca);
    if (item.del) d.reloj.ver(item.del);

    // Un documento que acá se unificó con otro ya no existe (su lápida sí se
    // compara, para que todas las PCs terminen con la misma marca de borrado).
    if (item.del === null && d.aliasDe(c, item.id)) return false;

    const col = d.db.collection(c);
    const metaLocal = await d.meta.findOne({ _id: claveDeMeta(c, item.id) });
    const docLocal = await col.findOne({ _id: item.id });

    const entrante: Entrante = {
      inc: item.inc ?? 0,
      del: item.del,
      clocks: item.clocks ?? {},
      doc: item.doc ? this.localizar(c, item.doc, fotos) : null,
    };
    const local: MetaLocal | null = metaLocal ? { inc: metaLocal.inc, del: metaLocal.del, clocks: metaLocal.clocks } : null;
    const decision = decidir(local, docLocal !== null, entrante);
    if (decision.accion === 'nada') return false;

    if (decision.accion === 'borrar') {
      const unificadoCon = item.al ?? metaLocal?.al ?? null;
      if (unificadoCon && UNIFICABLES[c]) await this.pasarReferencias(c, item.id, unificadoCon);
      if (docLocal) await col.deleteOne({ _id: item.id });
      await d.guardarMetaAplicada(c, item.id, { ...decision.meta, al: unificadoCon }, null, de);
      if (c === 'usuarios') this.opciones.alCambiarUsuario?.(hex(item.id));
      return true;
    }

    // Lo que va a quedar guardado, antes de escribirlo.
    let resultado: Document;
    if (decision.accion === 'reemplazar') {
      resultado = { ...decision.doc, _id: item.id };
      for (const propio of camposPropios(c)) {
        if (docLocal && propio in docLocal) resultado[propio] = docLocal[propio];
      }
      if (c === 'articulos' && resultado.stock === undefined) {
        resultado.stock = typeof resultado.stockBase === 'number' ? resultado.stockBase : 0;
      }
    } else {
      resultado = { ...(docLocal ?? {}), _id: item.id, ...decision.set };
      for (const campo of decision.unset) delete resultado[campo];
    }

    let metaFinal = decision.meta;
    try {
      await this.escribir(col, item.id, docLocal !== null, decision.accion === 'reemplazar', resultado, decision);
    } catch (err) {
      if (!esErrorDuplicado(err)) throw err;
      const salida = await this.resolverDuplicado(c, item, resultado, docLocal !== null, decision);
      if (salida === 'descartado') return true;
      resultado = salida.doc;
      metaFinal = salida.meta;
    }

    await d.guardarMetaAplicada(c, item.id, metaFinal, resultado, metaFinal === decision.meta ? de : null);
    this.despues(c, item.id, resultado, recalcular);
    return true;
  }

  private async escribir(
    col: Collection<Document>,
    id: ObjectId,
    existe: boolean,
    entero: boolean,
    resultado: Document,
    decision: Decision
  ): Promise<void> {
    if (entero) {
      if (existe) await col.replaceOne({ _id: id }, resultado);
      else await col.insertOne(resultado);
      return;
    }
    if (decision.accion !== 'combinar') return;
    const update: Document = {};
    if (Object.keys(decision.set).length > 0) update.$set = decision.set;
    if (decision.unset.length > 0) update.$unset = Object.fromEntries(decision.unset.map((k) => [k, '']));
    if (Object.keys(update).length > 0) await col.updateOne({ _id: id }, update);
  }

  private despues(coleccion: string, id: ObjectId, doc: Document, recalcular: (id: ObjectId) => void): void {
    if (coleccion === 'articulos') recalcular(id);
    if (coleccion === 'movimientos_stock' && esObjectId(doc.articuloId)) recalcular(doc.articuloId);
    if (coleccion === 'usuarios') this.opciones.alCambiarUsuario?.(hex(id));
  }

  // --- Referencias unificadas y fotos ---

  // Cambia, en un documento que llega, las referencias a algo que acá se
  // unificó, y apunta la foto a la carpeta de esta PC.
  private localizar(coleccion: string, doc: Document, fotos: Set<string>): Document {
    const salida: Document = { ...doc };
    const refs = REFERENCIAS[coleccion];
    if (refs) {
      for (const [campo, destino] of Object.entries(refs)) {
        let valor = salida[campo];
        for (let vuelta = 0; vuelta < 5 && esObjectId(valor); vuelta++) {
          const unificado = this.diario.aliasDe(destino, valor);
          if (!unificado) break;
          valor = unificado;
        }
        if (valor !== undefined) salida[campo] = valor;
      }
    }
    if (coleccion === 'articulos' && typeof salida.imagenPath === 'string' && salida.imagenPath) {
      // La ruta que viene es del disco de la otra PC: sólo sirve el nombre.
      const nombre = path.win32.basename(salida.imagenPath);
      const ruta = path.join(this.opciones.carpetaImagenes, nombre);
      salida.imagenPath = ruta;
      if (!fs.existsSync(ruta)) fotos.add(nombre);
    }
    return salida;
  }

  // Todo lo que apuntaba a `perdedor` pasa a apuntar a `ganador`.
  private async pasarReferencias(coleccion: string, perdedor: ObjectId, ganador: ObjectId): Promise<void> {
    await this.diario.guardarAlias(coleccion, perdedor, ganador);
    for (const { coleccion: otra, campo } of referenciasA(coleccion)) {
      await this.diario.ejecutar(this.diario.db.collection(otra), 'updateMany', [
        { [campo]: perdedor },
        { $set: { [campo]: ganador } },
      ]);
    }
  }

  // --- Duplicados ---

  private async resolverDuplicado(
    coleccion: string,
    item: ItemCambio,
    resultado: Document,
    existe: boolean,
    decision: Decision
  ): Promise<'descartado' | { doc: Document; meta: MetaNueva }> {
    const d = this.diario;
    const col = d.db.collection(coleccion);
    const reescribir = async (doc: Document) => {
      if (existe) await col.replaceOne({ _id: item.id }, doc);
      else await col.insertOne(doc);
    };

    // Un producto con el mismo código de barras que otro.
    if (coleccion === 'articulos' && typeof resultado.codigoBarras === 'string') {
      const otro = await col.findOne({ codigoBarras: resultado.codigoBarras, _id: { $ne: item.id } });
      if (!otro) throw new Error('Choque de código de barras que no se pudo ubicar');
      const mio = hex(item.id) > hex(otro._id);
      const quienPierde = mio ? resultado : otro;
      this.opciones.alAvisar?.(
        `Los productos "${String(resultado.descripcion ?? '')}" y "${String(otro.descripcion ?? '')}" se cargaron a la vez con el mismo código de barras (${resultado.codigoBarras}). Se le sacó el código a "${String(quienPierde.descripcion ?? '')}": conviene revisarlos y dejar uno solo.`
      );
      if (mio) {
        const sinCodigo = { ...resultado };
        delete sinCodigo.codigoBarras;
        await reescribir(sinCodigo);
        // Es un cambio de esta PC (la otra no lo tiene): tiene que viajar.
        const meta: MetaNueva = {
          inc: decision.accion === 'nada' ? 0 : decision.meta.inc,
          del: null,
          clocks: { ...(decision.accion === 'nada' ? {} : decision.meta.clocks), codigoBarras: d.reloj.nueva() },
        };
        return { doc: sinCodigo, meta };
      }
      await d.ejecutar(col, 'updateOne', [{ _id: otro._id }, { $unset: { codigoBarras: '' } }]);
      await reescribir(resultado);
      return { doc: resultado, meta: decision.accion === 'nada' ? { inc: 0, del: null, clocks: {} } : decision.meta };
    }

    // Rubros, marcas, clientes y usuarios con el mismo nombre: se unifican.
    const regla = UNIFICABLES[coleccion];
    if (regla && resultado[regla.campo] !== undefined) {
      const filtro: Document = { [regla.campo]: resultado[regla.campo], _id: { $ne: item.id } };
      if (regla.soloActivos) filtro.activo = true;
      const otro = await col.findOne(filtro);
      if (!otro) throw new Error('Choque de nombre que no se pudo ubicar');
      const gana = hex(item.id) < hex(otro._id) ? item.id : (otro._id as ObjectId);
      const pierde = hex(gana) === hex(item.id) ? (otro._id as ObjectId) : item.id;

      this.opciones.alAvisar?.(
        `Se cargó dos veces "${String(resultado[regla.campo])}" en distintas PCs (${nombreDeColeccion(coleccion)}). Quedaron unificados en uno solo.`
      );
      if (hex(pierde) === hex(item.id)) {
        // El que llega es el repetido: no se agrega, y se deja la lápida
        // (con a quién se unificó) para que las demás PCs hagan lo mismo.
        await this.pasarReferencias(coleccion, item.id, otro._id as ObjectId);
        await d.guardarMetaAplicada(
          coleccion,
          item.id,
          { inc: decision.accion === 'nada' ? 0 : decision.meta.inc, del: d.reloj.nueva(), clocks: {}, al: otro._id as ObjectId },
          null,
          null
        );
        return 'descartado';
      }
      // El repetido es el de acá: se unifica con el que llega.
      await this.pasarReferencias(coleccion, otro._id as ObjectId, item.id);
      await d.ejecutar(col, 'deleteOne', [{ _id: otro._id }]);
      await reescribir(resultado);
      return { doc: resultado, meta: decision.accion === 'nada' ? { inc: 0, del: null, clocks: {} } : decision.meta };
    }

    throw new Error(`Registro repetido en "${coleccion}" que no se sabe unificar`);
  }
}

function nombreDeColeccion(coleccion: string): string {
  switch (coleccion) {
    case 'familias':
      return 'rubros';
    case 'marcas':
      return 'marcas';
    case 'clientes':
      return 'clientes';
    case 'usuarios':
      return 'usuarios';
    default:
      return coleccion;
  }
}

// =====================================================================
// Stock
// =====================================================================

/** Deja el stock de cada artículo en "stock inicial + suma de sus
 * movimientos". Con la llave tomada. Devuelve cuántos tuvo que corregir. */
export async function recalcularStock(diario: Diario, ids: ObjectId[]): Promise<number> {
  const articulos = diario.db.collection('articulos');
  const movimientos = diario.db.collection('movimientos_stock');
  let corregidos = 0;
  for (const id of ids) {
    const art = await articulos.findOne({ _id: id }, { projection: { stock: 1, stockBase: 1 } });
    if (!art || typeof art.stockBase !== 'number') continue;
    const suma = await movimientos
      .aggregate<{ total: number }>([{ $match: { articuloId: id } }, { $group: { _id: null, total: { $sum: '$cantidad' } } }])
      .toArray();
    const esperado = redondearCantidad(art.stockBase + (suma[0]?.total ?? 0));
    if (art.stock !== esperado) {
      await articulos.updateOne({ _id: id }, { $set: { stock: esperado } });
      corregidos += 1;
    }
  }
  return corregidos;
}

/** Lo mismo, para todos los artículos (la revisión general). */
export async function recalcularTodoElStock(diario: Diario): Promise<number> {
  const sumas = new Map<string, number>();
  for await (const s of diario.db
    .collection('movimientos_stock')
    .aggregate<{ _id: ObjectId; total: number }>([{ $group: { _id: '$articuloId', total: { $sum: '$cantidad' } } }])) {
    if (esObjectId(s._id)) sumas.set(hex(s._id), s.total);
  }
  const equivocados: ObjectId[] = [];
  for await (const art of diario.db.collection('articulos').find({}, { projection: { stock: 1, stockBase: 1 } })) {
    if (typeof art.stockBase !== 'number') continue;
    const esperado = redondearCantidad(art.stockBase + (sumas.get(hex(art._id)) ?? 0));
    if (art.stock !== esperado) equivocados.push(art._id as ObjectId);
  }
  let corregidos = 0;
  for (let i = 0; i < equivocados.length; i += 100) {
    const tanda = equivocados.slice(i, i + 100);
    corregidos += await diario.conLlave(() => recalcularStock(diario, tanda));
  }
  return corregidos;
}

// =====================================================================
// De la base de siempre a la base con sincronización
// =====================================================================

/** Los artículos de antes no tienen "stock inicial": se lo calcula como
 * stock actual menos lo que sumaron sus movimientos, así la cuenta cierra. */
export async function completarStockBase(diario: Diario): Promise<number> {
  const articulos = diario.db.collection('articulos');
  const sumas = new Map<string, number>();
  for await (const s of diario.db
    .collection('movimientos_stock')
    .aggregate<{ _id: ObjectId; total: number }>([{ $group: { _id: '$articuloId', total: { $sum: '$cantidad' } } }])) {
    if (esObjectId(s._id)) sumas.set(hex(s._id), s.total);
  }
  const operaciones: Array<{ updateOne: { filter: Document; update: Document } }> = [];
  for await (const art of articulos.find({ stockBase: { $exists: false } }, { projection: { stock: 1 } })) {
    const stock = typeof art.stock === 'number' && Number.isFinite(art.stock) ? art.stock : 0;
    const base = redondearCantidad(stock - (sumas.get(hex(art._id)) ?? 0));
    operaciones.push({ updateOne: { filter: { _id: art._id }, update: { $set: { stockBase: base } } } });
  }
  for (let i = 0; i < operaciones.length; i += 500) {
    await articulos.bulkWrite(operaciones.slice(i, i + 500), { ordered: false });
  }
  return operaciones.length;
}

// Para las pruebas que arman documentos desde texto.
export function desdeTexto(texto: string): unknown {
  return BSON.EJSON.parse(texto);
}
