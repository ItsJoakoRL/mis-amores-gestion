// El diario de cambios de esta PC.
//
// Cada vez que se escribe un documento de una colección replicada (una venta,
// un cambio de precio, un cliente nuevo...), acá queda anotado QUÉ campos
// cambiaron y CUÁNDO (con la marca del reloj, ver reloj.ts), en la colección
// "_sync_meta": un registro por documento, con un número de secuencia local que
// sube con cada cambio. Las otras PCs piden "todo lo que cambió desde la
// secuencia N" y así se enteran de a poco, en orden, sin perder nada.
//
// Es un diario "compactado": por documento queda sólo su estado más reciente
// (no la lista de todo lo que pasó), así no crece sin límite.
//
// Todo lo que toca el diario corre de a una cosa por vez (la "llave"): la
// escritura del documento, la lectura de cómo era antes, y la anotación quedan
// juntas, y los cambios que llegan de otras PCs no se mezclan con los de acá.
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import type { AnyBulkWriteOperation, Collection, Db, Document, ObjectId } from 'mongodb';
import {
  camposPropios,
  camposReplicados,
  claveDeMeta,
  COLECCIONES_REPLICADAS,
  cuerpoReplicado,
  esReplicada,
  hex,
  huellaDeDoc,
  huellaDeValor,
} from './modelo';
import { marcaBase, MARCA_COPIA, type Reloj } from './reloj';

export const COL_META = '_sync_meta';
export const COL_ESTADO = '_sync_estado';
export const COL_ALIAS = '_sync_alias';
export const COL_PARES = '_sync_pares';
export const COL_AVISOS = '_sync_avisos';
export const COLECCIONES_DE_SYNC = [COL_META, COL_ESTADO, COL_ALIAS, COL_PARES, COL_AVISOS];

const MAX_AVISOS = 60;
const ESPERA_BARRIDO_MS = 2000;

export interface MetaDoc {
  /** "coleccion:idHex" */
  _id: string;
  c: string;
  d: ObjectId;
  /** Secuencia local: sube con cada cambio de este documento en esta PC. */
  seq: number;
  /** Cuántas veces se volvió a crear con el mismo _id después de borrarse. */
  inc: number;
  /** Marca de cuándo se borró (o null si está vivo). */
  del: string | null;
  /** Marca del último cambio de cada campo. */
  clocks: Record<string, string>;
  /** Huella del documento tal como está guardado acá. */
  h: string | null;
  /** De qué PC llegó el último cambio (null: se hizo en esta). Sólo informativo. */
  de: string | null;
  /** Si el documento se borró porque se unificó con otro: con cuál. */
  al?: ObjectId | null;
}

/** Un cambio tal como viaja entre PCs. */
export interface ItemCambio {
  c: string;
  id: ObjectId;
  seq: number;
  inc: number;
  del: string | null;
  clocks: Record<string, string>;
  /** Los campos replicados del documento (null si está borrado). */
  doc: Document | null;
  al?: ObjectId | null;
}

export type MarcaParaNuevos = 'ahora' | 'base' | 'copia';

export class Diario {
  readonly emisor = new EventEmitter();
  epoca = '';
  /** Se avisa acá cuando algo del diario falla (el uso de la app sigue igual). */
  alFallar: (etiqueta: string, err: unknown) => void = () => {};

  // `seq` es la última reservada; `seqVisible`, la última que ya quedó
  // escrita (la que se ofrece a las otras PCs).
  private seq = 0;
  private seqVisible = 0;
  private cola: Promise<void> = Promise.resolve();
  // Marca el código que corre "con la llave": si ahí adentro se vuelve a
  // pedir la llave (una escritura dentro de una transacción), sigue de largo
  // en vez de quedarse esperándose a sí mismo.
  private readonly contexto = new AsyncLocalStorage<{ activo: boolean }>();
  private readonly alias = new Map<string, ObjectId>();
  private readonly sucias = new Set<string>();
  private temporizadorBarrido: NodeJS.Timeout | null = null;
  private barriendo = false;

  constructor(
    readonly db: Db,
    readonly reloj: Reloj,
    readonly idPc: string
  ) {
    this.emisor.setMaxListeners(0);
  }

  get meta(): Collection<MetaDoc> {
    return this.db.collection<MetaDoc>(COL_META);
  }

  // =================================================================
  // Arranque
  // =================================================================

  async iniciar(): Promise<void> {
    await this.meta.createIndex({ seq: 1 });
    await this.meta.createIndex({ c: 1 });
    const ultimo = await this.meta.find({}, { projection: { seq: 1 } }).sort({ seq: -1 }).limit(1).toArray();
    this.seq = ultimo[0]?.seq ?? 0;
    this.seqVisible = this.seq;

    // El reloj arranca por encima de todo lo que ya está anotado: si se
    // corrigió la hora de la PC hacia atrás, sus cambios nuevos igual tienen
    // que ganarle a los viejos (si no, las otras PCs los rechazarían).
    let masAlta = '';
    for await (const m of this.meta.find({}, { projection: { clocks: 1, del: 1 } })) {
      if (m.del && m.del > masAlta) masAlta = m.del;
      for (const marca of Object.values(m.clocks ?? {})) if (marca > masAlta) masAlta = marca;
    }
    if (masAlta) this.reloj.ver(masAlta);

    const estado = this.db.collection<{ _id: string; v: string }>(COL_ESTADO);
    const epoca = await estado.findOne({ _id: 'epoca' });
    if (epoca) {
      this.epoca = epoca.v;
    } else {
      this.epoca = crypto.randomUUID();
      await estado.insertOne({ _id: 'epoca', v: this.epoca });
    }

    this.alias.clear();
    for (const a of await this.db.collection<{ _id: string; a: ObjectId }>(COL_ALIAS).find().toArray()) {
      this.alias.set(a._id, a.a);
    }
  }

  seqActual(): number {
    return this.seqVisible;
  }

  // =================================================================
  // La llave
  // =================================================================

  /** Corre `tarea` con la llave: nada más (ni una escritura de otra parte de
   * la app, ni un cambio que llega de otra PC) se mete en el medio. Se puede
   * anidar: lo que se pida adentro de una tarea con la llave no espera. */
  async conLlave<T>(tarea: () => Promise<T>): Promise<T> {
    if (this.contexto.getStore()?.activo) return tarea();
    const previa = this.cola;
    let soltar!: () => void;
    this.cola = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    await previa;
    const ctx = { activo: true };
    try {
      return await this.contexto.run(ctx, tarea);
    } finally {
      // Lo que haya quedado colgado de acá (un temporizador, por ejemplo) ya
      // no cuenta como "adentro de la llave".
      ctx.activo = false;
      soltar();
    }
  }

  // =================================================================
  // Escrituras locales
  // =================================================================

  /** Lo que usa database.ts: hace la escritura y la anota, con la llave. */
  envolver(coleccion: Collection<Document>, metodo: string, args: unknown[]): Promise<unknown> {
    return this.conLlave(() => this.ejecutar(coleccion, metodo, args));
  }

  /** Igual que `envolver`, pero SIN tomar la llave: sólo para código que ya la tiene. */
  async ejecutar(coleccion: Collection<Document>, metodo: string, args: unknown[]): Promise<unknown> {
    const nombre = coleccion.collectionName;
    const metodoReal = (coleccion as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[metodo];
    const original = () => metodoReal.apply(coleccion, args);
    const filtro = (args[0] as Document | undefined) ?? {};
    const opciones = args[2] as { sort?: Document } | undefined;

    switch (metodo) {
      case 'insertOne': {
        const res = (await original()) as { insertedId: ObjectId };
        await this.seguro(nombre, () => this.registrarInsertados(nombre, [res.insertedId]));
        return res;
      }
      case 'insertMany': {
        try {
          const res = (await original()) as { insertedIds: Record<string, ObjectId> };
          await this.seguro(nombre, () => this.registrarInsertados(nombre, Object.values(res.insertedIds)));
          return res;
        } catch (err) {
          // Con ordered:false lo que no chocó igual se guardó.
          const ids = (args[0] as Document[]).map((d) => d._id as ObjectId).filter(Boolean);
          await this.seguro(nombre, () => this.registrarInsertados(nombre, ids));
          throw err;
        }
      }
      case 'updateOne':
      case 'findOneAndUpdate':
      case 'replaceOne':
      case 'findOneAndReplace': {
        const antes = await coleccion.findOne(filtro, opciones?.sort ? { sort: opciones.sort } : undefined);
        const res = await original();
        await this.seguro(nombre, async () => {
          if (antes) await this.registrarModificados(nombre, [antes]);
          const creado = (res as { upsertedId?: ObjectId | null } | null)?.upsertedId ?? (!antes ? (res as Document | null)?._id : null);
          if (creado) await this.registrarInsertados(nombre, [creado as ObjectId]);
        });
        return res;
      }
      case 'updateMany': {
        const antes = await coleccion.find(filtro).toArray();
        const res = await original();
        await this.seguro(nombre, async () => {
          await this.registrarModificados(nombre, antes);
          const creado = (res as { upsertedId?: ObjectId | null } | null)?.upsertedId;
          if (creado) await this.registrarInsertados(nombre, [creado]);
        });
        return res;
      }
      case 'deleteOne':
      case 'findOneAndDelete': {
        const antes = await coleccion.findOne(filtro, { projection: { _id: 1 } });
        const res = await original();
        if (antes) await this.seguro(nombre, () => this.registrarBorrados(nombre, [antes._id as ObjectId]));
        return res;
      }
      case 'deleteMany': {
        const antes = await coleccion.find(filtro, { projection: { _id: 1 } }).toArray();
        const res = await original();
        if (antes.length > 0) {
          await this.seguro(nombre, () => this.registrarBorrados(nombre, antes.map((d) => d._id as ObjectId)));
        }
        return res;
      }
      default: {
        const res = await original();
        // No se sabe qué tocaron: se revisa la colección entera en un rato.
        if (metodo === 'bulkWrite' || metodo === 'drop' || metodo === 'rename') this.marcarSucia(nombre);
        return res;
      }
    }
  }

  private async seguro(coleccion: string, tarea: () => Promise<void>): Promise<void> {
    try {
      await tarea();
    } catch (err) {
      // Anotar en el diario nunca tiene que hacer fallar lo que la persona
      // estaba haciendo: si algo sale mal, la revisión general lo repara.
      this.alFallar('diario', err);
      this.marcarSucia(coleccion);
    }
  }

  /** Pide que se revise esa colección entera en un ratito (ver barrer). */
  marcarSucia(coleccion: string): void {
    if (!esReplicada(coleccion)) return;
    this.sucias.add(coleccion);
    if (this.temporizadorBarrido) return;
    this.temporizadorBarrido = setTimeout(() => {
      this.temporizadorBarrido = null;
      const lista = [...this.sucias];
      this.sucias.clear();
      this.barrer({ colecciones: lista, marcaNuevos: 'ahora' }).catch((err) => this.alFallar('barrido', err));
    }, ESPERA_BARRIDO_MS);
  }

  // =================================================================
  // Anotar en el diario (siempre con la llave tomada)
  // =================================================================

  private async leerMetas(claves: string[]): Promise<Map<string, MetaDoc>> {
    const mapa = new Map<string, MetaDoc>();
    if (claves.length === 0) return mapa;
    for (const m of await this.meta.find({ _id: { $in: claves } }).toArray()) mapa.set(m._id, m);
    return mapa;
  }

  private subirSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private avisarSeq(): void {
    this.seqVisible = this.seq;
    this.emisor.emit('seq', this.seqVisible);
  }

  private marcaPara(modo: MarcaParaNuevos): string {
    if (modo === 'base') return marcaBase(this.idPc);
    if (modo === 'copia') return MARCA_COPIA;
    return this.reloj.nueva();
  }

  /** Documentos que están completos (nuevos, o que hay que tratar enteros). */
  private async estamparNuevos(coleccion: string, docs: Document[], modo: MarcaParaNuevos = 'ahora'): Promise<void> {
    if (docs.length === 0) return;
    const metas = await this.leerMetas(docs.map((d) => claveDeMeta(coleccion, d._id)));
    const ops: AnyBulkWriteOperation<MetaDoc>[] = [];
    for (const doc of docs) {
      const clave = claveDeMeta(coleccion, doc._id);
      const previa = metas.get(clave);
      const marca = this.marcaPara(modo);
      const clocks: Record<string, string> = {};
      for (const campo of camposReplicados(coleccion, doc)) clocks[campo] = marca;
      // Un documento que se vuelve a crear con el mismo _id después de
      // haberse borrado le gana a la "lápida" (ver decidir en aplicar.ts).
      const inc = previa ? (previa.del !== null ? previa.inc + 1 : previa.inc) : 0;
      ops.push({
        updateOne: {
          filter: { _id: clave },
          update: {
            $set: {
              c: coleccion,
              d: doc._id as ObjectId,
              seq: this.subirSeq(),
              inc,
              del: null,
              clocks,
              h: huellaDeDoc(coleccion, doc),
              de: null,
              al: null,
            },
          },
          upsert: true,
        },
      });
    }
    await this.meta.bulkWrite(ops, { ordered: true });
    this.avisarSeq();
  }

  private async estamparCambios(
    coleccion: string,
    cambios: Array<{ doc: Document; campos: string[] }>,
    modo: MarcaParaNuevos = 'ahora'
  ): Promise<void> {
    if (cambios.length === 0) return;
    const ops: AnyBulkWriteOperation<MetaDoc>[] = [];
    for (const { doc, campos } of cambios) {
      const marca = this.marcaPara(modo);
      const set: Record<string, unknown> = {
        c: coleccion,
        d: doc._id,
        seq: this.subirSeq(),
        h: huellaDeDoc(coleccion, doc),
        de: null,
      };
      for (const campo of campos) set[`clocks.${campo}`] = marca;
      ops.push({
        updateOne: {
          filter: { _id: claveDeMeta(coleccion, doc._id) },
          update: { $set: set, $setOnInsert: { inc: 0, del: null } },
          upsert: true,
        },
      });
    }
    await this.meta.bulkWrite(ops, { ordered: true });
    this.avisarSeq();
  }

  private async estamparBorrados(coleccion: string, ids: ObjectId[]): Promise<void> {
    if (ids.length === 0) return;
    const metas = await this.leerMetas(ids.map((id) => claveDeMeta(coleccion, id)));
    const ops: AnyBulkWriteOperation<MetaDoc>[] = [];
    for (const id of ids) {
      const clave = claveDeMeta(coleccion, id);
      if (metas.get(clave)?.del != null) continue;
      ops.push({
        updateOne: {
          filter: { _id: clave },
          update: {
            $set: {
              c: coleccion,
              d: id,
              seq: this.subirSeq(),
              del: this.reloj.nueva(),
              // De un documento borrado ya no importan sus campos.
              clocks: {},
              h: null,
              de: null,
              // Si se borró porque se unificó con otro, que se sepa con cuál.
              al: this.alias.get(clave) ?? null,
            },
            $setOnInsert: { inc: 0 },
          },
          upsert: true,
        },
      });
    }
    if (ops.length === 0) return;
    await this.meta.bulkWrite(ops, { ordered: true });
    this.avisarSeq();
  }

  async registrarInsertados(coleccion: string, ids: ObjectId[]): Promise<void> {
    if (ids.length === 0) return;
    const docs = await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray();
    await this.estamparNuevos(coleccion, docs);
  }

  async registrarModificados(coleccion: string, antes: Document[]): Promise<void> {
    if (antes.length === 0) return;
    const ids = antes.map((d) => d._id as ObjectId);
    const despues = new Map<string, Document>();
    for (const d of await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray()) despues.set(hex(d._id), d);
    const metas = await this.leerMetas(ids.map((id) => claveDeMeta(coleccion, id)));

    const nuevos: Document[] = [];
    const cambios: Array<{ doc: Document; campos: string[] }> = [];
    const borrados: ObjectId[] = [];
    for (const pre of antes) {
      const post = despues.get(hex(pre._id));
      if (!post) {
        borrados.push(pre._id as ObjectId);
        continue;
      }
      const meta = metas.get(claveDeMeta(coleccion, pre._id));
      if (!meta || meta.del !== null) {
        nuevos.push(post);
        continue;
      }
      let campos = camposDistintos(coleccion, pre, post);
      if (campos.length === 0) {
        if (meta.h === huellaDeDoc(coleccion, post)) continue;
        campos = camposReplicados(coleccion, post);
      }
      cambios.push({ doc: post, campos });
    }
    await this.estamparNuevos(coleccion, nuevos);
    await this.estamparCambios(coleccion, cambios);
    await this.estamparBorrados(coleccion, borrados);
  }

  async registrarBorrados(coleccion: string, ids: ObjectId[]): Promise<void> {
    if (ids.length === 0) return;
    const quedan = new Set(
      (await this.db.collection(coleccion).find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => hex(d._id))
    );
    await this.estamparBorrados(
      coleccion,
      ids.filter((id) => !quedan.has(hex(id)))
    );
  }

  /** Para lo que llega de otra PC: guarda cómo quedó el registro de ese documento. */
  async guardarMetaAplicada(
    coleccion: string,
    id: ObjectId,
    meta: { inc: number; del: string | null; clocks: Record<string, string>; al?: ObjectId | null },
    doc: Document | null,
    de: string | null
  ): Promise<void> {
    await this.meta.updateOne(
      { _id: claveDeMeta(coleccion, id) },
      {
        $set: {
          c: coleccion,
          d: id,
          seq: this.subirSeq(),
          inc: meta.inc,
          del: meta.del,
          clocks: meta.clocks,
          h: doc && meta.del === null ? huellaDeDoc(coleccion, doc) : null,
          de: de || null,
          al: meta.al ?? null,
        },
      },
      { upsert: true }
    );
    this.avisarSeq();
  }

  // =================================================================
  // Revisión general: encuentra lo que se cambió sin pasar por acá
  // =================================================================

  /** Compara cada documento con su registro y anota lo que difiera (algo que
   * se escribió desde un script, una restauración, o un fallo a medio camino).
   * Con `marcaNuevos: 'base'` lo que no tiene registro queda como "lo de
   * siempre" (primer arranque); con 'ahora', como un cambio de este momento. */
  async barrer(opciones: { colecciones?: string[]; marcaNuevos?: MarcaParaNuevos } = {}): Promise<number> {
    if (this.barriendo) {
      // Ya hay una revisión en curso: ésta se hace cuando termine.
      for (const c of opciones.colecciones ?? COLECCIONES_REPLICADAS) this.marcarSucia(c);
      return 0;
    }
    this.barriendo = true;
    let anotados = 0;
    try {
      const modo = opciones.marcaNuevos ?? 'ahora';
      for (const nombre of opciones.colecciones ?? COLECCIONES_REPLICADAS) {
        if (!esReplicada(nombre)) continue;
        const metas = new Map<string, { h: string | null; del: string | null; d: ObjectId }>();
        for await (const m of this.meta.find({ c: nombre }, { projection: { h: 1, del: 1, d: 1 } })) {
          metas.set(hex(m.d), { h: m.h, del: m.del, d: m.d });
        }
        const candidatos: ObjectId[] = [];
        const vistos = new Set<string>();
        for await (const doc of this.db.collection(nombre).find({})) {
          const k = hex(doc._id);
          vistos.add(k);
          const m = metas.get(k);
          if (!m || m.del !== null || m.h !== huellaDeDoc(nombre, doc)) candidatos.push(doc._id as ObjectId);
        }
        for (const [k, m] of metas) {
          if (m.del === null && !vistos.has(k)) candidatos.push(m.d);
        }
        for (let i = 0; i < candidatos.length; i += 200) {
          const tanda = candidatos.slice(i, i + 200);
          anotados += await this.conLlave(() => this.repasar(nombre, tanda, modo));
        }
      }
    } finally {
      this.barriendo = false;
    }
    return anotados;
  }

  // Con la llave tomada: vuelve a mirar cada uno (por si cambió mientras se
  // armaba la lista) y anota lo que corresponda.
  private async repasar(coleccion: string, ids: ObjectId[], modo: MarcaParaNuevos): Promise<number> {
    const docs = new Map<string, Document>();
    for (const d of await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray()) docs.set(hex(d._id), d);
    const metas = await this.leerMetas(ids.map((id) => claveDeMeta(coleccion, id)));

    const nuevos: Document[] = [];
    const cambiados: Document[] = [];
    const borrados: ObjectId[] = [];
    for (const id of ids) {
      const doc = docs.get(hex(id));
      const meta = metas.get(claveDeMeta(coleccion, id));
      if (!doc) {
        if (meta && meta.del === null) borrados.push(id);
        continue;
      }
      if (!meta || meta.del !== null) nuevos.push(doc);
      else if (meta.h !== huellaDeDoc(coleccion, doc)) cambiados.push(doc);
    }
    await this.estamparNuevos(coleccion, nuevos, modo);
    // Cambiado sin saber qué campo: se toma el documento entero.
    await this.estamparCambios(
      coleccion,
      cambiados.map((doc) => ({ doc, campos: camposReplicados(coleccion, doc) })),
      modo
    );
    await this.estamparBorrados(coleccion, borrados);
    return nuevos.length + cambiados.length + borrados.length;
  }

  // =================================================================
  // Lo que se ofrece a las otras PCs
  // =================================================================

  /** Los cambios con secuencia mayor a `desde`, en orden. Se manda todo, aun
   * lo que esa PC misma nos había mandado: así, si perdió su base (una copia
   * vieja, una restauración), se lo puede volver a dar. */
  async cambiosDesde(desde: number, limite: number): Promise<{ items: ItemCambio[]; hasta: number; maxSeq: number }> {
    const metas = await this.meta.find({ seq: { $gt: desde } }).sort({ seq: 1 }).limit(limite).toArray();
    let hasta = desde;

    const idsPorColeccion = new Map<string, ObjectId[]>();
    for (const m of metas) {
      if (m.del !== null || !esReplicada(m.c)) continue;
      const lista = idsPorColeccion.get(m.c) ?? [];
      lista.push(m.d);
      idsPorColeccion.set(m.c, lista);
    }
    const docs = new Map<string, Document>();
    for (const [c, ids] of idsPorColeccion) {
      for (const d of await this.db.collection(c).find({ _id: { $in: ids } }).toArray()) docs.set(claveDeMeta(c, d._id), d);
    }

    const items: ItemCambio[] = [];
    for (const m of metas) {
      hasta = m.seq;
      if (!esReplicada(m.c)) continue;
      if (m.del !== null) {
        items.push({ c: m.c, id: m.d, seq: m.seq, inc: m.inc, del: m.del, clocks: {}, doc: null, al: m.al ?? null });
        continue;
      }
      const doc = docs.get(m._id);
      if (!doc) continue; // se borró justo ahora: ya va a aparecer como borrado
      items.push({ c: m.c, id: m.d, seq: m.seq, inc: m.inc, del: null, clocks: m.clocks, doc: cuerpoReplicado(m.c, doc) });
    }
    return { items, hasta, maxSeq: this.seqVisible };
  }

  /** Espera (hasta `ms`) a que haya algún cambio con secuencia mayor a `desde`. */
  esperarCambios(desde: number, ms: number): Promise<void> {
    if (this.seqVisible > desde) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const listo = () => {
        clearTimeout(temporizador);
        this.emisor.off('seq', alSubir);
        resolve();
      };
      const alSubir = (s: number) => {
        if (s > desde) listo();
      };
      const temporizador = setTimeout(listo, ms);
      this.emisor.on('seq', alSubir);
    });
  }

  // =================================================================
  // Alias (documentos que se unificaron con otro)
  // =================================================================

  aliasDe(coleccion: string, id: unknown): ObjectId | undefined {
    return this.alias.get(claveDeMeta(coleccion, id));
  }

  async guardarAlias(coleccion: string, perdedor: ObjectId, ganador: ObjectId): Promise<void> {
    const clave = claveDeMeta(coleccion, perdedor);
    this.alias.set(clave, ganador);
    await this.db.collection<{ _id: string; a: ObjectId }>(COL_ALIAS).updateOne(
      { _id: clave },
      { $set: { a: ganador } },
      { upsert: true }
    );
  }

  // =================================================================
  // Avisos para la administradora
  // =================================================================

  async avisar(texto: string): Promise<void> {
    const col = this.db.collection<{ fecha: string; texto: string }>(COL_AVISOS);
    await col.insertOne({ fecha: new Date().toISOString(), texto });
    const total = await col.countDocuments();
    if (total > MAX_AVISOS) {
      const viejos = await col.find({}, { projection: { _id: 1 } }).sort({ fecha: 1 }).limit(total - MAX_AVISOS).toArray();
      await col.deleteMany({ _id: { $in: viejos.map((v) => v._id) } });
    }
  }

  async avisos(): Promise<Array<{ id: string; fecha: string; texto: string }>> {
    const docs = await this.db
      .collection<{ fecha: string; texto: string }>(COL_AVISOS)
      .find()
      .sort({ fecha: -1 })
      .limit(MAX_AVISOS)
      .toArray();
    return docs.map((d) => ({ id: d._id.toHexString(), fecha: d.fecha, texto: d.texto }));
  }

  async borrarAvisos(): Promise<void> {
    await this.db.collection(COL_AVISOS).deleteMany({});
  }

  // Para saber si ya se hizo alguna vez la revisión general (la primera vez,
  // todo lo que había es "lo de siempre"; después, lo que aparezca sin
  // registro es un cambio de este momento).
  async yaSeBarrio(): Promise<boolean> {
    return (await this.db.collection(COL_ESTADO).findOne({ _id: 'barrido' as never })) !== null;
  }

  async marcarBarrido(): Promise<void> {
    await this.db.collection(COL_ESTADO).updateOne({ _id: 'barrido' as never }, { $set: { v: true } }, { upsert: true });
  }

  // =================================================================
  // Empezar de cero (al sumarse a la red de otra PC)
  // =================================================================

  /** Vacía los datos replicados y el diario, y arranca una época nueva.
   * Quien llama tiene que haber hecho el respaldo antes. */
  async vaciarTodo(): Promise<void> {
    await this.conLlave(async () => {
      for (const nombre of COLECCIONES_REPLICADAS) await this.db.collection(nombre).deleteMany({});
      for (const nombre of COLECCIONES_DE_SYNC) await this.db.collection(nombre).deleteMany({});
      this.seq = 0;
      this.seqVisible = 0;
      this.alias.clear();
      this.epoca = crypto.randomUUID();
      await this.db.collection<{ _id: string; v: string }>(COL_ESTADO).insertOne({ _id: 'epoca', v: this.epoca });
    });
  }
}

// Los campos replicados que valen distinto antes y después.
function camposDistintos(coleccion: string, antes: Document, despues: Document): string[] {
  const propios = camposPropios(coleccion);
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  const lista: string[] = [];
  for (const k of claves) {
    if (k === '_id' || propios.includes(k)) continue;
    if (huellaDeValor(antes[k]) !== huellaDeValor(despues[k])) lista.push(k);
  }
  return lista;
}
