"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listRecordatorios = listRecordatorios;
exports.resumenRecordatorios = resumenRecordatorios;
exports.crearRecordatorio = crearRecordatorio;
exports.actualizarRecordatorio = actualizarRecordatorio;
exports.marcarRecordatorioHecho = marcarRecordatorioHecho;
exports.eliminarRecordatorio = eliminarRecordatorio;
exports.limpiarRecordatoriosHechos = limpiarRecordatoriosHechos;
// Recordatorios: lo que hay que hacer, cambiar, reponer o cobrar, anotado en un
// lugar común para que todas las que usan la app (en las PCs y en los
// celulares) estén al tanto. Se sincroniza entre las PCs como el resto de los
// datos (ver sync/modelo.ts).
const mongodb_1 = require("mongodb");
const database_1 = require("../db/database");
const fechaLocal_1 = require("../fechaLocal");
const TIPOS = ['hacer', 'cambiar', 'reponer', 'cobrar', 'otro'];
const MAX_TEXTO = 300;
// Los "hechos" más viejos que esto se limpian solos (ver iniciarMantenimiento).
const DIAS_HECHOS_VISIBLES = 30;
function coleccion() {
    return (0, database_1.getDb)().collection('recordatorios');
}
function mapDoc(d) {
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
function aObjectId(valor) {
    return typeof valor === 'string' && /^[0-9a-f]{24}$/i.test(valor) ? new mongodb_1.ObjectId(valor) : null;
}
async function limpiarInput(input) {
    const texto = typeof input.texto === 'string' ? input.texto.trim().replace(/\s+/g, ' ') : '';
    if (!texto)
        throw new Error('Escribí qué hay que hacer o cambiar');
    if (texto.length > MAX_TEXTO)
        throw new Error(`Es muy largo: hasta ${MAX_TEXTO} letras`);
    const tipo = TIPOS.includes(input.tipo) ? input.tipo : 'hacer';
    const paraFecha = typeof input.paraFecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.paraFecha) ? input.paraFecha : null;
    // A qué producto o cliente se refiere (uno solo), con su nombre de ahora.
    let articuloId = aObjectId(input.articuloId);
    let clienteId = articuloId ? null : aObjectId(input.clienteId);
    let vinculoNombre = null;
    if (articuloId) {
        const a = await (0, database_1.getDb)().collection('articulos').findOne({ _id: articuloId }, { projection: { descripcion: 1 } });
        if (a)
            vinculoNombre = String(a.descripcion ?? '');
        else
            articuloId = null;
    }
    else if (clienteId) {
        const c = await (0, database_1.getDb)().collection('clientes').findOne({ _id: clienteId }, { projection: { nombre: 1 } });
        if (c)
            vinculoNombre = String(c.nombre ?? '');
        else
            clienteId = null;
    }
    return { texto, tipo, urgente: input.urgente === true, paraFecha, articuloId, clienteId, vinculoNombre };
}
async function listRecordatorios(estado) {
    if (estado === 'hechos') {
        const docs = await coleccion()
            .aggregate([
            { $match: { hecho: true } },
            { $sort: { hechoEn: -1 } },
            { $limit: 100 },
            ...JOINS,
        ])
            .toArray();
        return docs.map(mapDoc);
    }
    const docs = await coleccion()
        .aggregate([
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
async function resumenRecordatorios() {
    const hoy = (0, fechaLocal_1.ymdLocal)();
    const [pendientes, urgentes, vencidos, paraHoy] = await Promise.all([
        coleccion().countDocuments({ hecho: false }),
        coleccion().countDocuments({ hecho: false, urgente: true }),
        coleccion().countDocuments({ hecho: false, paraFecha: { $lt: hoy } }),
        coleccion().countDocuments({ hecho: false, paraFecha: hoy }),
    ]);
    return { pendientes, urgentes, vencidos, paraHoy };
}
async function crearRecordatorio(input, usuarioId) {
    const datos = await limpiarInput(input);
    const doc = {
        ...datos,
        hecho: false,
        creadoEn: new Date().toISOString(),
        creadoPorId: new mongodb_1.ObjectId(usuarioId),
        hechoEn: null,
        hechoPorId: null,
    };
    const res = await coleccion().insertOne(doc);
    const guardado = await coleccion()
        .aggregate([{ $match: { _id: res.insertedId } }, ...JOINS])
        .toArray();
    return mapDoc(guardado[0]);
}
async function actualizarRecordatorio(id, input) {
    const datos = await limpiarInput(input);
    const res = await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: datos });
    if (res.matchedCount === 0)
        throw new Error('Ese recordatorio ya no existe');
    const guardado = await coleccion()
        .aggregate([{ $match: { _id: new mongodb_1.ObjectId(id) } }, ...JOINS])
        .toArray();
    return mapDoc(guardado[0]);
}
/** Marca (o desmarca) como hecho: queda anotado quién y cuándo. */
async function marcarRecordatorioHecho(id, hecho, usuarioId) {
    const cambios = hecho
        ? { hecho: true, hechoEn: new Date().toISOString(), hechoPorId: new mongodb_1.ObjectId(usuarioId) }
        : { hecho: false, hechoEn: null, hechoPorId: null };
    const res = await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: cambios });
    if (res.matchedCount === 0)
        throw new Error('Ese recordatorio ya no existe');
}
/** Lo borra el que lo anotó o una administradora. */
async function eliminarRecordatorio(id, usuarioId, esAdmin) {
    const doc = await coleccion().findOne({ _id: new mongodb_1.ObjectId(id) });
    if (!doc)
        return;
    if (!esAdmin && doc.creadoPorId.toHexString() !== usuarioId) {
        throw new Error('Sólo lo puede borrar quien lo anotó o una administradora. Si ya está hecho, marcalo como hecho.');
    }
    await coleccion().deleteOne({ _id: doc._id });
}
/** Saca de la lista los "hechos" de hace más de unos días (los que ya no sirven). */
async function limpiarRecordatoriosHechos() {
    const limite = new Date(Date.now() - DIAS_HECHOS_VISIBLES * 24 * 60 * 60 * 1000).toISOString();
    const res = await coleccion().deleteMany({ hecho: true, hechoEn: { $lt: limite } });
    return res.deletedCount;
}
