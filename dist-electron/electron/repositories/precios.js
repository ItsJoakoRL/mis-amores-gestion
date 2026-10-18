"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aplicarCambioPrecios = aplicarCambioPrecios;
exports.lotesDePrecios = lotesDePrecios;
exports.deshacerLotePrecios = deshacerLotePrecios;
exports.aplicarCostos = aplicarCostos;
// Cambios de precios y costos de muchos artículos juntos (sólo la administradora):
// el cambio masivo de precios (con "deshacer") y la carga de costos en planilla.
//
// Cada artículo se resuelve por su cuenta: si uno falla (ya no existe, está en la
// papelera, el valor es inválido, alguien lo cambió mientras tanto) los demás se
// cambian igual y el problema vuelve en `omitidos`. Cada cambio queda en el
// historial de precios del artículo, con quién lo hizo.
const mongodb_1 = require("mongodb");
const database_1 = require("../db/database");
const MAX_ITEMS = 1000;
const ID_LOTE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_VALOR = 1e9;
const articulos = () => (0, database_1.getDb)().collection('articulos');
const historial = () => (0, database_1.getDb)().collection('historial_precios');
function redondearPesos(n) {
    return Math.round(n * 100) / 100;
}
// La utilidad (margen sobre el costo, en %), como la calcula el resto de la app.
function utilidadPct(costo, venta) {
    return costo > 0 ? Math.round(((venta - costo) / costo) * 1000) / 10 : 0;
}
function validarLista(items) {
    if (!Array.isArray(items) || items.length === 0)
        throw new Error('No hay nada para cambiar');
    if (items.length > MAX_ITEMS)
        throw new Error(`Se pueden cambiar hasta ${MAX_ITEMS} productos por vez`);
}
function valorValido(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_VALOR;
}
// ---------------------------------------------------------------------------
// Precio de venta, de a muchos
// ---------------------------------------------------------------------------
async function aplicarCambioPrecios(items, descripcion, loteId, usuarioId) {
    validarLista(items);
    if (typeof loteId !== 'string' || !ID_LOTE.test(loteId))
        throw new Error('El identificador del cambio no es válido');
    const detalle = (typeof descripcion === 'string' ? descripcion.trim() : '').slice(0, 120) || 'Cambio de precios';
    const resultado = { loteId, cambiados: 0, sinCambios: 0, omitidos: [] };
    const vistos = new Set();
    const ahora = new Date().toISOString();
    for (const item of items) {
        const id = typeof item?.articuloId === 'string' ? item.articuloId : '';
        const omitir = (motivo, descripcionArticulo = null) => resultado.omitidos.push({ articuloId: id, descripcion: descripcionArticulo, motivo });
        if (!mongodb_1.ObjectId.isValid(id)) {
            omitir('El producto no es válido');
            continue;
        }
        if (vistos.has(id)) {
            omitir('El producto vino repetido');
            continue;
        }
        vistos.add(id);
        const articulo = await articulos().findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!articulo) {
            omitir('El producto ya no existe');
            continue;
        }
        if (!articulo.activo) {
            omitir('Está en la papelera', articulo.descripcion);
            continue;
        }
        if (!valorValido(item.precioNuevo)) {
            omitir('El precio nuevo no es válido', articulo.descripcion);
            continue;
        }
        const nuevo = redondearPesos(item.precioNuevo);
        // El precio que se vio al armar el cambio: si alguien lo cambió en el medio, no se pisa.
        if (typeof item.precioVisto === 'number' && redondearPesos(item.precioVisto) !== articulo.precioVenta) {
            omitir('Alguien le cambió el precio mientras tanto', articulo.descripcion);
            continue;
        }
        if (nuevo === articulo.precioVenta) {
            resultado.sinCambios += 1;
            continue;
        }
        const hecho = await articulos().updateOne({ _id: articulo._id, precioVenta: articulo.precioVenta }, { $set: { precioVenta: nuevo, utilidadPct: utilidadPct(articulo.precioCosto, nuevo), actualizadoEn: ahora } });
        if (hecho.matchedCount === 0) {
            omitir('Alguien le cambió el precio mientras tanto', articulo.descripcion);
            continue;
        }
        await historial().insertOne({
            articuloId: articulo._id,
            tipo: 'venta',
            precioAnterior: articulo.precioVenta,
            precioNuevo: nuevo,
            usuarioId: new mongodb_1.ObjectId(usuarioId),
            fecha: ahora,
            loteId,
            loteDescripcion: detalle,
        });
        resultado.cambiados += 1;
    }
    return resultado;
}
/** Los últimos cambios masivos de precios (para poder deshacerlos). */
async function lotesDePrecios(limite = 15) {
    const docs = await historial()
        .aggregate([
        { $match: { loteId: { $type: 'string' } } },
        {
            $group: {
                _id: '$loteId',
                fecha: { $max: '$fecha' },
                cantidad: { $sum: 1 },
                descripcion: { $first: '$loteDescripcion' },
                usuarioId: { $first: '$usuarioId' },
            },
        },
        { $sort: { fecha: -1 } },
        { $limit: Math.max(1, Math.min(50, limite)) },
        { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } },
    ])
        .toArray();
    const ids = docs.map((d) => d._id);
    const deshechos = new Set((await historial()
        .aggregate([{ $match: { revierteLote: { $in: ids } } }, { $group: { _id: '$revierteLote' } }])
        .toArray()).map((d) => d._id));
    return docs.map((d) => ({
        loteId: d._id,
        fecha: d.fecha,
        descripcion: d.descripcion ?? 'Cambio de precios',
        cantidad: d.cantidad,
        usuarioNombre: d.usuario?.[0]?.nombre ?? null,
        deshecho: deshechos.has(d._id),
    }));
}
/** Vuelve cada precio de un lote a como estaba, salvo los que ya se cambiaron de nuevo
 * después (esos no se pisan). Un lote se deshace una sola vez. */
async function deshacerLotePrecios(loteId, usuarioId) {
    if (typeof loteId !== 'string' || !ID_LOTE.test(loteId))
        throw new Error('El identificador del cambio no es válido');
    const entradas = await historial().find({ loteId }).toArray();
    if (entradas.length === 0)
        throw new Error('No encontré ese cambio de precios');
    if ((await historial().countDocuments({ revierteLote: loteId }, { limit: 1 })) > 0) {
        throw new Error('Ese cambio de precios ya se deshizo');
    }
    const resultado = { revertidos: 0, omitidos: 0 };
    const ahora = new Date().toISOString();
    for (const e of entradas) {
        const articulo = await articulos().findOne({ _id: e.articuloId });
        if (!articulo || !articulo.activo || articulo.precioVenta !== e.precioNuevo) {
            resultado.omitidos += 1;
            continue;
        }
        const hecho = await articulos().updateOne({ _id: articulo._id, precioVenta: e.precioNuevo }, { $set: { precioVenta: e.precioAnterior, utilidadPct: utilidadPct(articulo.precioCosto, e.precioAnterior), actualizadoEn: ahora } });
        if (hecho.matchedCount === 0) {
            resultado.omitidos += 1;
            continue;
        }
        await historial().insertOne({
            articuloId: articulo._id,
            tipo: 'venta',
            precioAnterior: e.precioNuevo,
            precioNuevo: e.precioAnterior,
            usuarioId: new mongodb_1.ObjectId(usuarioId),
            fecha: ahora,
            revierteLote: loteId,
        });
        resultado.revertidos += 1;
    }
    return resultado;
}
// ---------------------------------------------------------------------------
// Costos, de a muchos (la planilla)
// ---------------------------------------------------------------------------
async function aplicarCostos(items, usuarioId) {
    validarLista(items);
    const resultado = { cambiados: 0, sinCambios: 0, omitidos: [] };
    const vistos = new Set();
    const ahora = new Date().toISOString();
    for (const item of items) {
        const id = typeof item?.articuloId === 'string' ? item.articuloId : '';
        const omitir = (motivo, descripcionArticulo = null) => resultado.omitidos.push({ articuloId: id, descripcion: descripcionArticulo, motivo });
        if (!mongodb_1.ObjectId.isValid(id)) {
            omitir('El producto no es válido');
            continue;
        }
        if (vistos.has(id)) {
            omitir('El producto vino repetido');
            continue;
        }
        vistos.add(id);
        const articulo = await articulos().findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!articulo) {
            omitir('El producto ya no existe');
            continue;
        }
        if (!articulo.activo) {
            omitir('Está en la papelera', articulo.descripcion);
            continue;
        }
        if (!valorValido(item.precioCosto)) {
            omitir('El costo no es válido', articulo.descripcion);
            continue;
        }
        const nuevo = redondearPesos(item.precioCosto);
        if (typeof item.costoVisto === 'number' && redondearPesos(item.costoVisto) !== articulo.precioCosto) {
            omitir('Alguien le cambió el costo mientras tanto', articulo.descripcion);
            continue;
        }
        if (nuevo === articulo.precioCosto) {
            resultado.sinCambios += 1;
            continue;
        }
        const hecho = await articulos().updateOne({ _id: articulo._id, precioCosto: articulo.precioCosto }, { $set: { precioCosto: nuevo, utilidadPct: utilidadPct(nuevo, articulo.precioVenta), actualizadoEn: ahora } });
        if (hecho.matchedCount === 0) {
            omitir('Alguien le cambió el costo mientras tanto', articulo.descripcion);
            continue;
        }
        await historial().insertOne({
            articuloId: articulo._id,
            tipo: 'costo',
            precioAnterior: articulo.precioCosto,
            precioNuevo: nuevo,
            usuarioId: new mongodb_1.ObjectId(usuarioId),
            fecha: ahora,
        });
        resultado.cambiados += 1;
    }
    return resultado;
}
