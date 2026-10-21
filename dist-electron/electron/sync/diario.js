"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Diario = exports.COLECCIONES_DE_SYNC = exports.COL_AVISOS = exports.COL_PARES = exports.COL_ALIAS = exports.COL_ESTADO = exports.COL_META = void 0;
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
const async_hooks_1 = require("async_hooks");
const crypto_1 = __importDefault(require("crypto"));
const events_1 = require("events");
const modelo_1 = require("./modelo");
const reloj_1 = require("./reloj");
exports.COL_META = '_sync_meta';
exports.COL_ESTADO = '_sync_estado';
exports.COL_ALIAS = '_sync_alias';
exports.COL_PARES = '_sync_pares';
exports.COL_AVISOS = '_sync_avisos';
exports.COLECCIONES_DE_SYNC = [exports.COL_META, exports.COL_ESTADO, exports.COL_ALIAS, exports.COL_PARES, exports.COL_AVISOS];
const MAX_AVISOS = 60;
const ESPERA_BARRIDO_MS = 2000;
class Diario {
    constructor(db, reloj, idPc) {
        this.db = db;
        this.reloj = reloj;
        this.idPc = idPc;
        this.emisor = new events_1.EventEmitter();
        this.epoca = '';
        /** Se avisa acá cuando algo del diario falla (el uso de la app sigue igual). */
        this.alFallar = () => { };
        // `seq` es la última reservada; `seqVisible`, la última que ya quedó
        // escrita (la que se ofrece a las otras PCs).
        this.seq = 0;
        this.seqVisible = 0;
        this.cola = Promise.resolve();
        // Marca el código que corre "con la llave": si ahí adentro se vuelve a
        // pedir la llave (una escritura dentro de una transacción), sigue de largo
        // en vez de quedarse esperándose a sí mismo.
        this.contexto = new async_hooks_1.AsyncLocalStorage();
        this.alias = new Map();
        this.sucias = new Set();
        this.temporizadorBarrido = null;
        this.barriendo = false;
        this.emisor.setMaxListeners(0);
    }
    get meta() {
        return this.db.collection(exports.COL_META);
    }
    // =================================================================
    // Arranque
    // =================================================================
    async iniciar() {
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
            if (m.del && m.del > masAlta)
                masAlta = m.del;
            for (const marca of Object.values(m.clocks ?? {}))
                if (marca > masAlta)
                    masAlta = marca;
        }
        if (masAlta)
            this.reloj.ver(masAlta);
        const estado = this.db.collection(exports.COL_ESTADO);
        const epoca = await estado.findOne({ _id: 'epoca' });
        if (epoca) {
            this.epoca = epoca.v;
        }
        else {
            this.epoca = crypto_1.default.randomUUID();
            await estado.insertOne({ _id: 'epoca', v: this.epoca });
        }
        this.alias.clear();
        for (const a of await this.db.collection(exports.COL_ALIAS).find().toArray()) {
            this.alias.set(a._id, a.a);
        }
    }
    seqActual() {
        return this.seqVisible;
    }
    // =================================================================
    // La llave
    // =================================================================
    /** Corre `tarea` con la llave: nada más (ni una escritura de otra parte de
     * la app, ni un cambio que llega de otra PC) se mete en el medio. Se puede
     * anidar: lo que se pida adentro de una tarea con la llave no espera. */
    async conLlave(tarea) {
        if (this.contexto.getStore()?.activo)
            return tarea();
        const previa = this.cola;
        let soltar;
        this.cola = new Promise((resolve) => {
            soltar = resolve;
        });
        await previa;
        const ctx = { activo: true };
        try {
            return await this.contexto.run(ctx, tarea);
        }
        finally {
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
    envolver(coleccion, metodo, args) {
        return this.conLlave(() => this.ejecutar(coleccion, metodo, args));
    }
    /** Igual que `envolver`, pero SIN tomar la llave: sólo para código que ya la tiene. */
    async ejecutar(coleccion, metodo, args) {
        const nombre = coleccion.collectionName;
        const metodoReal = coleccion[metodo];
        const original = () => metodoReal.apply(coleccion, args);
        const filtro = args[0] ?? {};
        const opciones = args[2];
        switch (metodo) {
            case 'insertOne': {
                const res = (await original());
                await this.seguro(nombre, () => this.registrarInsertados(nombre, [res.insertedId]));
                return res;
            }
            case 'insertMany': {
                try {
                    const res = (await original());
                    await this.seguro(nombre, () => this.registrarInsertados(nombre, Object.values(res.insertedIds)));
                    return res;
                }
                catch (err) {
                    // Con ordered:false lo que no chocó igual se guardó.
                    const ids = args[0].map((d) => d._id).filter(Boolean);
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
                    if (antes)
                        await this.registrarModificados(nombre, [antes]);
                    const creado = res?.upsertedId ?? (!antes ? res?._id : null);
                    if (creado)
                        await this.registrarInsertados(nombre, [creado]);
                });
                return res;
            }
            case 'updateMany': {
                const antes = await coleccion.find(filtro).toArray();
                const res = await original();
                await this.seguro(nombre, async () => {
                    await this.registrarModificados(nombre, antes);
                    const creado = res?.upsertedId;
                    if (creado)
                        await this.registrarInsertados(nombre, [creado]);
                });
                return res;
            }
            case 'deleteOne':
            case 'findOneAndDelete': {
                const antes = await coleccion.findOne(filtro, { projection: { _id: 1 } });
                const res = await original();
                if (antes)
                    await this.seguro(nombre, () => this.registrarBorrados(nombre, [antes._id]));
                return res;
            }
            case 'deleteMany': {
                const antes = await coleccion.find(filtro, { projection: { _id: 1 } }).toArray();
                const res = await original();
                if (antes.length > 0) {
                    await this.seguro(nombre, () => this.registrarBorrados(nombre, antes.map((d) => d._id)));
                }
                return res;
            }
            default: {
                const res = await original();
                // No se sabe qué tocaron: se revisa la colección entera en un rato.
                if (metodo === 'bulkWrite' || metodo === 'drop' || metodo === 'rename')
                    this.marcarSucia(nombre);
                return res;
            }
        }
    }
    async seguro(coleccion, tarea) {
        try {
            await tarea();
        }
        catch (err) {
            // Anotar en el diario nunca tiene que hacer fallar lo que la persona
            // estaba haciendo: si algo sale mal, la revisión general lo repara.
            this.alFallar('diario', err);
            this.marcarSucia(coleccion);
        }
    }
    /** Pide que se revise esa colección entera en un ratito (ver barrer). */
    marcarSucia(coleccion) {
        if (!(0, modelo_1.esReplicada)(coleccion))
            return;
        this.sucias.add(coleccion);
        if (this.temporizadorBarrido)
            return;
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
    async leerMetas(claves) {
        const mapa = new Map();
        if (claves.length === 0)
            return mapa;
        for (const m of await this.meta.find({ _id: { $in: claves } }).toArray())
            mapa.set(m._id, m);
        return mapa;
    }
    subirSeq() {
        this.seq += 1;
        return this.seq;
    }
    avisarSeq() {
        this.seqVisible = this.seq;
        this.emisor.emit('seq', this.seqVisible);
    }
    marcaPara(modo) {
        if (modo === 'base')
            return (0, reloj_1.marcaBase)(this.idPc);
        if (modo === 'copia')
            return reloj_1.MARCA_COPIA;
        return this.reloj.nueva();
    }
    /** Documentos que están completos (nuevos, o que hay que tratar enteros). */
    async estamparNuevos(coleccion, docs, modo = 'ahora') {
        if (docs.length === 0)
            return;
        const metas = await this.leerMetas(docs.map((d) => (0, modelo_1.claveDeMeta)(coleccion, d._id)));
        const ops = [];
        for (const doc of docs) {
            const clave = (0, modelo_1.claveDeMeta)(coleccion, doc._id);
            const previa = metas.get(clave);
            const marca = this.marcaPara(modo);
            const clocks = {};
            for (const campo of (0, modelo_1.camposReplicados)(coleccion, doc))
                clocks[campo] = marca;
            // Un documento que se vuelve a crear con el mismo _id después de
            // haberse borrado le gana a la "lápida" (ver decidir en aplicar.ts).
            const inc = previa ? (previa.del !== null ? previa.inc + 1 : previa.inc) : 0;
            ops.push({
                updateOne: {
                    filter: { _id: clave },
                    update: {
                        $set: {
                            c: coleccion,
                            d: doc._id,
                            seq: this.subirSeq(),
                            inc,
                            del: null,
                            clocks,
                            h: (0, modelo_1.huellaDeDoc)(coleccion, doc),
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
    async estamparCambios(coleccion, cambios, modo = 'ahora') {
        if (cambios.length === 0)
            return;
        const ops = [];
        for (const { doc, campos } of cambios) {
            const marca = this.marcaPara(modo);
            const set = {
                c: coleccion,
                d: doc._id,
                seq: this.subirSeq(),
                h: (0, modelo_1.huellaDeDoc)(coleccion, doc),
                de: null,
            };
            for (const campo of campos)
                set[`clocks.${campo}`] = marca;
            ops.push({
                updateOne: {
                    filter: { _id: (0, modelo_1.claveDeMeta)(coleccion, doc._id) },
                    update: { $set: set, $setOnInsert: { inc: 0, del: null } },
                    upsert: true,
                },
            });
        }
        await this.meta.bulkWrite(ops, { ordered: true });
        this.avisarSeq();
    }
    async estamparBorrados(coleccion, ids) {
        if (ids.length === 0)
            return;
        const metas = await this.leerMetas(ids.map((id) => (0, modelo_1.claveDeMeta)(coleccion, id)));
        const ops = [];
        for (const id of ids) {
            const clave = (0, modelo_1.claveDeMeta)(coleccion, id);
            if (metas.get(clave)?.del != null)
                continue;
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
        if (ops.length === 0)
            return;
        await this.meta.bulkWrite(ops, { ordered: true });
        this.avisarSeq();
    }
    /** Lo que se escribe acá puede apuntar a algo que ya se unificó con otro (la
     * persona lo había elegido un instante antes, o la escritura venía en dos
     * pasos y en el medio llegó la unificación): se lo pasa a apuntar al que
     * quedó, y el documento ya se anota corregido. Siempre con la llave tomada. */
    async corregirReferencias(coleccion, docs) {
        for (const doc of docs) {
            const arreglos = (0, modelo_1.referenciasUnificadas)(coleccion, doc, (destino, id) => this.aliasDe(destino, id));
            if (Object.keys(arreglos).length === 0)
                continue;
            await this.db.collection(coleccion).updateOne({ _id: doc._id }, { $set: arreglos });
            Object.assign(doc, arreglos);
        }
    }
    async registrarInsertados(coleccion, ids) {
        if (ids.length === 0)
            return;
        const docs = await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray();
        await this.corregirReferencias(coleccion, docs);
        await this.estamparNuevos(coleccion, docs);
    }
    async registrarModificados(coleccion, antes) {
        if (antes.length === 0)
            return;
        const ids = antes.map((d) => d._id);
        const despues = new Map();
        const leidos = await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray();
        await this.corregirReferencias(coleccion, leidos);
        for (const d of leidos)
            despues.set((0, modelo_1.hex)(d._id), d);
        const metas = await this.leerMetas(ids.map((id) => (0, modelo_1.claveDeMeta)(coleccion, id)));
        const nuevos = [];
        const cambios = [];
        const borrados = [];
        for (const pre of antes) {
            const post = despues.get((0, modelo_1.hex)(pre._id));
            if (!post) {
                borrados.push(pre._id);
                continue;
            }
            const meta = metas.get((0, modelo_1.claveDeMeta)(coleccion, pre._id));
            if (!meta || meta.del !== null) {
                nuevos.push(post);
                continue;
            }
            let campos = camposDistintos(coleccion, pre, post);
            if (campos.length === 0) {
                if (meta.h === (0, modelo_1.huellaDeDoc)(coleccion, post))
                    continue;
                campos = (0, modelo_1.camposReplicados)(coleccion, post);
            }
            cambios.push({ doc: post, campos });
        }
        await this.estamparNuevos(coleccion, nuevos);
        await this.estamparCambios(coleccion, cambios);
        await this.estamparBorrados(coleccion, borrados);
    }
    async registrarBorrados(coleccion, ids) {
        if (ids.length === 0)
            return;
        const quedan = new Set((await this.db.collection(coleccion).find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => (0, modelo_1.hex)(d._id)));
        await this.estamparBorrados(coleccion, ids.filter((id) => !quedan.has((0, modelo_1.hex)(id))));
    }
    /** Para lo que llega de otra PC: guarda cómo quedó el registro de ese documento. */
    async guardarMetaAplicada(coleccion, id, meta, doc, de) {
        await this.meta.updateOne({ _id: (0, modelo_1.claveDeMeta)(coleccion, id) }, {
            $set: {
                c: coleccion,
                d: id,
                seq: this.subirSeq(),
                inc: meta.inc,
                del: meta.del,
                clocks: meta.clocks,
                h: doc && meta.del === null ? (0, modelo_1.huellaDeDoc)(coleccion, doc) : null,
                de: de || null,
                al: meta.al ?? null,
            },
        }, { upsert: true });
        this.avisarSeq();
    }
    // =================================================================
    // Revisión general: encuentra lo que se cambió sin pasar por acá
    // =================================================================
    /** Compara cada documento con su registro y anota lo que difiera (algo que
     * se escribió desde un script, una restauración, o un fallo a medio camino).
     * Con `marcaNuevos: 'base'` lo que no tiene registro queda como "lo de
     * siempre" (primer arranque); con 'ahora', como un cambio de este momento. */
    async barrer(opciones = {}) {
        if (this.barriendo) {
            // Ya hay una revisión en curso: ésta se hace cuando termine.
            for (const c of opciones.colecciones ?? modelo_1.COLECCIONES_REPLICADAS)
                this.marcarSucia(c);
            return 0;
        }
        this.barriendo = true;
        let anotados = 0;
        try {
            const modo = opciones.marcaNuevos ?? 'ahora';
            for (const nombre of opciones.colecciones ?? modelo_1.COLECCIONES_REPLICADAS) {
                if (!(0, modelo_1.esReplicada)(nombre))
                    continue;
                const metas = new Map();
                for await (const m of this.meta.find({ c: nombre }, { projection: { h: 1, del: 1, d: 1 } })) {
                    metas.set((0, modelo_1.hex)(m.d), { h: m.h, del: m.del, d: m.d });
                }
                const candidatos = [];
                const vistos = new Set();
                let hechos = 0;
                for await (const doc of this.db.collection(nombre).find({})) {
                    // Con muchos datos, de a ratos se le da el paso al resto de la app
                    // (la pantalla y los celulares usan este mismo proceso).
                    if (++hechos % 500 === 0)
                        await new Promise((r) => setImmediate(r));
                    const k = (0, modelo_1.hex)(doc._id);
                    vistos.add(k);
                    const m = metas.get(k);
                    if (!m || m.del !== null || m.h !== (0, modelo_1.huellaDeDoc)(nombre, doc) || apuntaAUnificado(nombre, doc, this.alias)) {
                        candidatos.push(doc._id);
                    }
                }
                for (const [k, m] of metas) {
                    if (m.del === null && !vistos.has(k))
                        candidatos.push(m.d);
                }
                for (let i = 0; i < candidatos.length; i += 200) {
                    const tanda = candidatos.slice(i, i + 200);
                    anotados += await this.conLlave(() => this.repasar(nombre, tanda, modo));
                }
            }
        }
        finally {
            this.barriendo = false;
        }
        return anotados;
    }
    // Con la llave tomada: vuelve a mirar cada uno (por si cambió mientras se
    // armaba la lista) y anota lo que corresponda.
    async repasar(coleccion, ids, modo) {
        const docs = new Map();
        const leidos = await this.db.collection(coleccion).find({ _id: { $in: ids } }).toArray();
        // Si apuntaba a algo ya unificado, queda corregido y por eso figura como cambiado.
        await this.corregirReferencias(coleccion, leidos);
        for (const d of leidos)
            docs.set((0, modelo_1.hex)(d._id), d);
        const metas = await this.leerMetas(ids.map((id) => (0, modelo_1.claveDeMeta)(coleccion, id)));
        const nuevos = [];
        const cambiados = [];
        const borrados = [];
        for (const id of ids) {
            const doc = docs.get((0, modelo_1.hex)(id));
            const meta = metas.get((0, modelo_1.claveDeMeta)(coleccion, id));
            if (!doc) {
                if (meta && meta.del === null)
                    borrados.push(id);
                continue;
            }
            if (!meta || meta.del !== null)
                nuevos.push(doc);
            else if (meta.h !== (0, modelo_1.huellaDeDoc)(coleccion, doc))
                cambiados.push(doc);
        }
        await this.estamparNuevos(coleccion, nuevos, modo);
        // Cambiado sin saber qué campo: se toma el documento entero.
        await this.estamparCambios(coleccion, cambiados.map((doc) => ({ doc, campos: (0, modelo_1.camposReplicados)(coleccion, doc) })), modo);
        await this.estamparBorrados(coleccion, borrados);
        return nuevos.length + cambiados.length + borrados.length;
    }
    // =================================================================
    // Lo que se ofrece a las otras PCs
    // =================================================================
    /** Los cambios con secuencia mayor a `desde`, en orden. Se manda todo, aun
     * lo que esa PC misma nos había mandado: así, si perdió su base (una copia
     * vieja, una restauración), se lo puede volver a dar. */
    async cambiosDesde(desde, limite) {
        const metas = await this.meta.find({ seq: { $gt: desde } }).sort({ seq: 1 }).limit(limite).toArray();
        let hasta = desde;
        const idsPorColeccion = new Map();
        for (const m of metas) {
            if (m.del !== null || !(0, modelo_1.esReplicada)(m.c))
                continue;
            const lista = idsPorColeccion.get(m.c) ?? [];
            lista.push(m.d);
            idsPorColeccion.set(m.c, lista);
        }
        const docs = new Map();
        for (const [c, ids] of idsPorColeccion) {
            for (const d of await this.db.collection(c).find({ _id: { $in: ids } }).toArray())
                docs.set((0, modelo_1.claveDeMeta)(c, d._id), d);
        }
        const items = [];
        for (const m of metas) {
            hasta = m.seq;
            if (!(0, modelo_1.esReplicada)(m.c))
                continue;
            if (m.del !== null) {
                items.push({ c: m.c, id: m.d, seq: m.seq, inc: m.inc, del: m.del, clocks: {}, doc: null, al: m.al ?? null });
                continue;
            }
            const doc = docs.get(m._id);
            if (!doc)
                continue; // se borró justo ahora: ya va a aparecer como borrado
            items.push({ c: m.c, id: m.d, seq: m.seq, inc: m.inc, del: null, clocks: m.clocks, doc: (0, modelo_1.cuerpoReplicado)(m.c, doc) });
        }
        return { items, hasta, maxSeq: this.seqVisible };
    }
    /** Espera (hasta `ms`) a que haya algún cambio con secuencia mayor a `desde`. */
    esperarCambios(desde, ms) {
        if (this.seqVisible > desde)
            return Promise.resolve();
        return new Promise((resolve) => {
            const listo = () => {
                clearTimeout(temporizador);
                this.emisor.off('seq', alSubir);
                resolve();
            };
            const alSubir = (s) => {
                if (s > desde)
                    listo();
            };
            const temporizador = setTimeout(listo, ms);
            this.emisor.on('seq', alSubir);
        });
    }
    // =================================================================
    // Alias (documentos que se unificaron con otro)
    // =================================================================
    aliasDe(coleccion, id) {
        return this.alias.get((0, modelo_1.claveDeMeta)(coleccion, id));
    }
    async guardarAlias(coleccion, perdedor, ganador) {
        const clave = (0, modelo_1.claveDeMeta)(coleccion, perdedor);
        this.alias.set(clave, ganador);
        await this.db.collection(exports.COL_ALIAS).updateOne({ _id: clave }, { $set: { a: ganador } }, { upsert: true });
    }
    // =================================================================
    // Avisos para la administradora
    // =================================================================
    async avisar(texto) {
        const col = this.db.collection(exports.COL_AVISOS);
        await col.insertOne({ fecha: new Date().toISOString(), texto });
        const total = await col.countDocuments();
        if (total > MAX_AVISOS) {
            const viejos = await col.find({}, { projection: { _id: 1 } }).sort({ fecha: 1 }).limit(total - MAX_AVISOS).toArray();
            await col.deleteMany({ _id: { $in: viejos.map((v) => v._id) } });
        }
    }
    async avisos() {
        const docs = await this.db
            .collection(exports.COL_AVISOS)
            .find()
            .sort({ fecha: -1 })
            .limit(MAX_AVISOS)
            .toArray();
        return docs.map((d) => ({ id: d._id.toHexString(), fecha: d.fecha, texto: d.texto }));
    }
    async borrarAvisos() {
        await this.db.collection(exports.COL_AVISOS).deleteMany({});
    }
    // Para saber si ya se hizo alguna vez la revisión general (la primera vez,
    // todo lo que había es "lo de siempre"; después, lo que aparezca sin
    // registro es un cambio de este momento).
    async yaSeBarrio() {
        return (await this.db.collection(exports.COL_ESTADO).findOne({ _id: 'barrido' })) !== null;
    }
    async marcarBarrido() {
        await this.db.collection(exports.COL_ESTADO).updateOne({ _id: 'barrido' }, { $set: { v: true } }, { upsert: true });
    }
    // =================================================================
    // Empezar de cero (al sumarse a la red de otra PC)
    // =================================================================
    /** Vacía los datos replicados y el diario, y arranca una época nueva.
     * Quien llama tiene que haber hecho el respaldo antes. */
    async vaciarTodo() {
        await this.conLlave(async () => {
            for (const nombre of modelo_1.COLECCIONES_REPLICADAS)
                await this.db.collection(nombre).deleteMany({});
            for (const nombre of exports.COLECCIONES_DE_SYNC)
                await this.db.collection(nombre).deleteMany({});
            this.seq = 0;
            this.seqVisible = 0;
            this.alias.clear();
            this.epoca = crypto_1.default.randomUUID();
            await this.db.collection(exports.COL_ESTADO).insertOne({ _id: 'epoca', v: this.epoca });
        });
    }
}
exports.Diario = Diario;
// Si algún campo del documento apunta a algo que se unificó con otro.
function apuntaAUnificado(coleccion, doc, alias) {
    return Object.keys((0, modelo_1.referenciasUnificadas)(coleccion, doc, (destino, id) => alias.get((0, modelo_1.claveDeMeta)(destino, id)))).length > 0;
}
// Los campos replicados que valen distinto antes y después.
function camposDistintos(coleccion, antes, despues) {
    const propios = (0, modelo_1.camposPropios)(coleccion);
    const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
    const lista = [];
    for (const k of claves) {
        if (k === '_id' || propios.includes(k))
            continue;
        if ((0, modelo_1.huellaDeValor)(antes[k]) !== (0, modelo_1.huellaDeValor)(despues[k]))
            lista.push(k);
    }
    return lista;
}
