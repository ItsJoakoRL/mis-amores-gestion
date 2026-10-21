"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Aplicador = void 0;
exports.decidir = decidir;
exports.recalcularStock = recalcularStock;
exports.recalcularTodoElStock = recalcularTodoElStock;
exports.completarStockBase = completarStockBase;
exports.desdeTexto = desdeTexto;
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
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mongodb_1 = require("mongodb");
const formato_1 = require("../../shared/formato");
const modelo_1 = require("./modelo");
function decidir(local, existeDoc, e) {
    const lapida = () => ({
        accion: 'borrar',
        meta: { inc: e.inc, del: e.del, clocks: {} },
    });
    const tomarEntrante = () => e.del !== null
        ? lapida()
        : { accion: 'reemplazar', doc: e.doc ?? {}, meta: { inc: e.inc, del: null, clocks: { ...e.clocks } } };
    // Acá no hay registro de este documento.
    if (!local)
        return tomarEntrante();
    if (e.inc > local.inc)
        return tomarEntrante();
    if (e.inc < local.inc)
        return { accion: 'nada' };
    // Misma "vida" del documento. Dos PCs que borraron lo mismo cada una por su
    // lado anotaron marcas distintas: todas se quedan con la más alta, para que
    // terminen idénticas.
    if (local.del !== null) {
        if (e.del !== null && e.del > local.del)
            return { accion: 'borrar', meta: { inc: local.inc, del: e.del, clocks: {} } };
        return { accion: 'nada' };
    }
    if (e.del !== null)
        return { accion: 'borrar', meta: { inc: local.inc, del: e.del, clocks: {} } };
    const set = {};
    const unset = [];
    const clocks = { ...local.clocks };
    let cambio = false;
    for (const [campo, marca] of Object.entries(e.clocks)) {
        const actual = local.clocks[campo];
        if (actual !== undefined && actual >= marca)
            continue;
        clocks[campo] = marca;
        cambio = true;
        if (e.doc && campo in e.doc)
            set[campo] = e.doc[campo];
        else
            unset.push(campo);
    }
    if (!cambio)
        return { accion: 'nada' };
    // Tenía registro pero el documento no estaba: se toma completo.
    if (!existeDoc)
        return { accion: 'reemplazar', doc: e.doc ?? {}, meta: { inc: local.inc, del: null, clocks } };
    return { accion: 'combinar', set, unset, meta: { inc: local.inc, del: null, clocks } };
}
class Aplicador {
    constructor(diario, opciones) {
        this.diario = diario;
        this.opciones = opciones;
    }
    /** `alFinal`: el stock de los productos tocados se recalcula una sola vez al
     * terminar el lote (para cargas grandes, cuando nadie está usando la PC). Si
     * no, se recalcula en el momento, así el stock que lee una venta o un ajuste
     * local nunca queda atrasado respecto de los movimientos que ya llegaron. */
    async aplicar(items, de, opciones = {}) {
        const resultado = { aplicados: 0, sinCambio: 0, errores: 0, fotosFaltantes: [] };
        const fotos = new Set();
        const stock = new Set();
        const idsStock = [];
        for (const item of items) {
            try {
                const hizoAlgo = await this.diario.conLlave(async () => {
                    const tocados = [];
                    const aplicado = await this.aplicarUno(item, de, fotos, (id) => tocados.push(id));
                    if (opciones.alFinal) {
                        for (const id of tocados) {
                            const k = (0, modelo_1.hex)(id);
                            if (stock.has(k))
                                continue;
                            stock.add(k);
                            idsStock.push(id);
                        }
                    }
                    else if (tocados.length > 0) {
                        await recalcularStock(this.diario, tocados);
                    }
                    return aplicado;
                });
                if (hizoAlgo)
                    resultado.aplicados += 1;
                else
                    resultado.sinCambio += 1;
            }
            catch (err) {
                resultado.errores += 1;
                this.opciones.alFallar?.(`aplicar ${item.c}:${(0, modelo_1.hex)(item.id)}`, err);
            }
        }
        if (idsStock.length > 0) {
            await this.diario.conLlave(() => recalcularStock(this.diario, idsStock)).catch((err) => this.opciones.alFallar?.('stock', err));
        }
        resultado.fotosFaltantes = [...fotos];
        return resultado;
    }
    // Con la llave tomada. Devuelve true si cambió algo en esta PC.
    async aplicarUno(item, de, fotos, recalcular) {
        const c = item.c;
        if (!(0, modelo_1.esReplicada)(c))
            return false;
        if (item.del === null && !item.doc)
            return false;
        const d = this.diario;
        // El reloj de esta PC tiene que quedar por encima de todo lo visto.
        for (const marca of Object.values(item.clocks ?? {}))
            d.reloj.ver(marca);
        if (item.del)
            d.reloj.ver(item.del);
        // Un documento que acá se unificó con otro ya no existe (su lápida sí se
        // compara, para que todas las PCs terminen con la misma marca de borrado).
        if (item.del === null && d.aliasDe(c, item.id))
            return false;
        const col = d.db.collection(c);
        const metaLocal = await d.meta.findOne({ _id: (0, modelo_1.claveDeMeta)(c, item.id) });
        const docLocal = await col.findOne({ _id: item.id });
        const entrante = {
            inc: item.inc ?? 0,
            del: item.del,
            clocks: item.clocks ?? {},
            doc: item.doc ? this.localizar(c, item.doc, fotos) : null,
        };
        const local = metaLocal ? { inc: metaLocal.inc, del: metaLocal.del, clocks: metaLocal.clocks } : null;
        const decision = decidir(local, docLocal !== null, entrante);
        if (decision.accion === 'nada')
            return false;
        if (decision.accion === 'borrar') {
            const unificadoCon = item.al ?? metaLocal?.al ?? null;
            if (unificadoCon && modelo_1.UNIFICABLES[c])
                await this.pasarReferencias(c, item.id, unificadoCon);
            if (docLocal)
                await col.deleteOne({ _id: item.id });
            await d.guardarMetaAplicada(c, item.id, { ...decision.meta, al: unificadoCon }, null, de);
            if (c === 'usuarios')
                this.opciones.alCambiarUsuario?.((0, modelo_1.hex)(item.id));
            return true;
        }
        // Lo que va a quedar guardado, antes de escribirlo.
        let resultado;
        if (decision.accion === 'reemplazar') {
            resultado = { ...decision.doc, _id: item.id };
            for (const propio of (0, modelo_1.camposPropios)(c)) {
                if (docLocal && propio in docLocal)
                    resultado[propio] = docLocal[propio];
            }
            if (c === 'articulos' && resultado.stock === undefined) {
                resultado.stock = typeof resultado.stockBase === 'number' ? resultado.stockBase : 0;
            }
        }
        else {
            resultado = { ...(docLocal ?? {}), _id: item.id, ...decision.set };
            for (const campo of decision.unset)
                delete resultado[campo];
        }
        let metaFinal = decision.meta;
        try {
            await this.escribir(col, item.id, docLocal !== null, decision.accion === 'reemplazar', resultado, decision);
        }
        catch (err) {
            if (!(0, modelo_1.esErrorDuplicado)(err))
                throw err;
            const salida = await this.resolverDuplicado(c, item, resultado, docLocal !== null, decision);
            if (salida === 'descartado')
                return true;
            resultado = salida.doc;
            metaFinal = salida.meta;
        }
        await d.guardarMetaAplicada(c, item.id, metaFinal, resultado, metaFinal === decision.meta ? de : null);
        this.despues(c, item.id, resultado, recalcular);
        return true;
    }
    async escribir(col, id, existe, entero, resultado, decision) {
        if (entero) {
            if (existe)
                await col.replaceOne({ _id: id }, resultado);
            else
                await col.insertOne(resultado);
            return;
        }
        if (decision.accion !== 'combinar')
            return;
        const update = {};
        if (Object.keys(decision.set).length > 0)
            update.$set = decision.set;
        if (decision.unset.length > 0)
            update.$unset = Object.fromEntries(decision.unset.map((k) => [k, '']));
        if (Object.keys(update).length > 0)
            await col.updateOne({ _id: id }, update);
    }
    despues(coleccion, id, doc, recalcular) {
        if (coleccion === 'articulos')
            recalcular(id);
        if (coleccion === 'movimientos_stock' && (0, modelo_1.esObjectId)(doc.articuloId))
            recalcular(doc.articuloId);
        if (coleccion === 'usuarios')
            this.opciones.alCambiarUsuario?.((0, modelo_1.hex)(id));
    }
    // --- Referencias unificadas y fotos ---
    // Cambia, en un documento que llega, las referencias a algo que acá se
    // unificó, y apunta la foto a la carpeta de esta PC.
    localizar(coleccion, doc, fotos) {
        const salida = { ...doc };
        Object.assign(salida, (0, modelo_1.referenciasUnificadas)(coleccion, doc, (destino, id) => this.diario.aliasDe(destino, id)));
        if (coleccion === 'articulos' && typeof salida.imagenPath === 'string' && salida.imagenPath) {
            // La ruta que viene es del disco de la otra PC: sólo sirve el nombre.
            const nombre = path_1.default.win32.basename(salida.imagenPath);
            const ruta = path_1.default.join(this.opciones.carpetaImagenes, nombre);
            salida.imagenPath = ruta;
            if (!fs_1.default.existsSync(ruta))
                fotos.add(nombre);
        }
        return salida;
    }
    // Todo lo que apuntaba a `perdedor` pasa a apuntar a `ganador`.
    async pasarReferencias(coleccion, perdedor, ganador) {
        await this.diario.guardarAlias(coleccion, perdedor, ganador);
        for (const { coleccion: otra, campo } of (0, modelo_1.referenciasA)(coleccion)) {
            await this.diario.ejecutar(this.diario.db.collection(otra), 'updateMany', [
                { [campo]: perdedor },
                { $set: { [campo]: ganador } },
            ]);
        }
    }
    // --- Duplicados ---
    async resolverDuplicado(coleccion, item, resultado, existe, decision) {
        const d = this.diario;
        const col = d.db.collection(coleccion);
        const reescribir = async (doc) => {
            if (existe)
                await col.replaceOne({ _id: item.id }, doc);
            else
                await col.insertOne(doc);
        };
        // Un producto con el mismo código de barras que otro.
        if (coleccion === 'articulos' && typeof resultado.codigoBarras === 'string') {
            const otro = await col.findOne({ codigoBarras: resultado.codigoBarras, _id: { $ne: item.id } });
            if (!otro)
                throw new Error('Choque de código de barras que no se pudo ubicar');
            const mio = (0, modelo_1.hex)(item.id) > (0, modelo_1.hex)(otro._id);
            const quienPierde = mio ? resultado : otro;
            this.opciones.alAvisar?.(`Los productos "${String(resultado.descripcion ?? '')}" y "${String(otro.descripcion ?? '')}" se cargaron a la vez con el mismo código de barras (${resultado.codigoBarras}). Se le sacó el código a "${String(quienPierde.descripcion ?? '')}": conviene revisarlos y dejar uno solo.`);
            if (mio) {
                const sinCodigo = { ...resultado };
                delete sinCodigo.codigoBarras;
                await reescribir(sinCodigo);
                // Es un cambio de esta PC (la otra no lo tiene): tiene que viajar.
                const meta = {
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
        const regla = modelo_1.UNIFICABLES[coleccion];
        if (regla && resultado[regla.campo] !== undefined) {
            const filtro = { [regla.campo]: resultado[regla.campo], _id: { $ne: item.id } };
            if (regla.soloActivos)
                filtro.activo = true;
            const otro = await col.findOne(filtro);
            if (!otro)
                throw new Error('Choque de nombre que no se pudo ubicar');
            const gana = (0, modelo_1.hex)(item.id) < (0, modelo_1.hex)(otro._id) ? item.id : otro._id;
            const pierde = (0, modelo_1.hex)(gana) === (0, modelo_1.hex)(item.id) ? otro._id : item.id;
            this.opciones.alAvisar?.(`Se cargó dos veces "${String(resultado[regla.campo])}" en distintas PCs (${nombreDeColeccion(coleccion)}). Quedaron unificados en uno solo.`);
            if ((0, modelo_1.hex)(pierde) === (0, modelo_1.hex)(item.id)) {
                // El que llega es el repetido: no se agrega, y se deja la lápida
                // (con a quién se unificó) para que las demás PCs hagan lo mismo.
                await this.pasarReferencias(coleccion, item.id, otro._id);
                // Si ya estaba acá (alguien lo renombró y chocó con otro), la fila vieja
                // tiene que irse también: si no, se la volvería a anotar como nueva.
                if (existe)
                    await col.deleteOne({ _id: item.id });
                await d.guardarMetaAplicada(coleccion, item.id, { inc: decision.accion === 'nada' ? 0 : decision.meta.inc, del: d.reloj.nueva(), clocks: {}, al: otro._id }, null, null);
                return 'descartado';
            }
            // El repetido es el de acá: se unifica con el que llega.
            await this.pasarReferencias(coleccion, otro._id, item.id);
            await d.ejecutar(col, 'deleteOne', [{ _id: otro._id }]);
            await reescribir(resultado);
            return { doc: resultado, meta: decision.accion === 'nada' ? { inc: 0, del: null, clocks: {} } : decision.meta };
        }
        throw new Error(`Registro repetido en "${coleccion}" que no se sabe unificar`);
    }
}
exports.Aplicador = Aplicador;
function nombreDeColeccion(coleccion) {
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
async function recalcularStock(diario, ids) {
    const articulos = diario.db.collection('articulos');
    const movimientos = diario.db.collection('movimientos_stock');
    let corregidos = 0;
    for (const id of ids) {
        const art = await articulos.findOne({ _id: id }, { projection: { stock: 1, stockBase: 1 } });
        if (!art || typeof art.stockBase !== 'number')
            continue;
        const suma = await movimientos
            .aggregate([{ $match: { articuloId: id } }, { $group: { _id: null, total: { $sum: '$cantidad' } } }])
            .toArray();
        const esperado = (0, formato_1.redondearCantidad)(art.stockBase + (suma[0]?.total ?? 0));
        if (art.stock !== esperado) {
            await articulos.updateOne({ _id: id }, { $set: { stock: esperado } });
            corregidos += 1;
        }
    }
    return corregidos;
}
/** Lo mismo, para todos los artículos (la revisión general). */
async function recalcularTodoElStock(diario) {
    const sumas = new Map();
    for await (const s of diario.db
        .collection('movimientos_stock')
        .aggregate([{ $group: { _id: '$articuloId', total: { $sum: '$cantidad' } } }])) {
        if ((0, modelo_1.esObjectId)(s._id))
            sumas.set((0, modelo_1.hex)(s._id), s.total);
    }
    const equivocados = [];
    let hechos = 0;
    for await (const art of diario.db.collection('articulos').find({}, { projection: { stock: 1, stockBase: 1 } })) {
        if (++hechos % 2000 === 0)
            await new Promise((r) => setImmediate(r));
        if (typeof art.stockBase !== 'number')
            continue;
        const esperado = (0, formato_1.redondearCantidad)(art.stockBase + (sumas.get((0, modelo_1.hex)(art._id)) ?? 0));
        if (art.stock !== esperado)
            equivocados.push(art._id);
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
async function completarStockBase(diario) {
    const articulos = diario.db.collection('articulos');
    const sumas = new Map();
    for await (const s of diario.db
        .collection('movimientos_stock')
        .aggregate([{ $group: { _id: '$articuloId', total: { $sum: '$cantidad' } } }])) {
        if ((0, modelo_1.esObjectId)(s._id))
            sumas.set((0, modelo_1.hex)(s._id), s.total);
    }
    const operaciones = [];
    for await (const art of articulos.find({ stockBase: { $exists: false } }, { projection: { stock: 1 } })) {
        const stock = typeof art.stock === 'number' && Number.isFinite(art.stock) ? art.stock : 0;
        const base = (0, formato_1.redondearCantidad)(stock - (sumas.get((0, modelo_1.hex)(art._id)) ?? 0));
        operaciones.push({ updateOne: { filter: { _id: art._id }, update: { $set: { stockBase: base } } } });
    }
    for (let i = 0; i < operaciones.length; i += 500) {
        await articulos.bulkWrite(operaciones.slice(i, i + 500), { ordered: false });
    }
    return operaciones.length;
}
// Para las pruebas que arman documentos desde texto.
function desdeTexto(texto) {
    return mongodb_1.BSON.EJSON.parse(texto);
}
