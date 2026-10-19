"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReporteVentas = getReporteVentas;
const database_1 = require("../db/database");
const fechaLocal_1 = require("../fechaLocal");
const clientes_1 = require("./clientes");
const ventas_1 = require("./ventas");
function coleccionVentas() {
    return (0, database_1.getDb)().collection('ventas');
}
// Igual que en ventas.ts: separa lo fiado (no es plata cobrada) de lo que sí
// entró en efectivo, tarjeta o transferencia.
const SUMA_COBRADO = { $cond: [{ $ne: ['$metodoPago', 'fiado'] }, '$total', 0] };
const SUMA_FIADO = { $cond: [{ $eq: ['$metodoPago', 'fiado'] }, '$total', 0] };
// Cuántas ventas hubo por día dentro del rango — misma idea que
// ventas.ts/resumenMes pero para un rango arbitrario, lo que pide el
// gráfico de tendencia de Reportes.
async function porDia(desde, hasta) {
    const pagos = await (0, clientes_1.pagosPorDia)(desde, hasta);
    const docs = await coleccionVentas()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        {
            $group: {
                _id: fechaLocal_1.DIA_LOCAL_EXPR,
                total: { $sum: '$total' },
                totalCobrado: { $sum: SUMA_COBRADO },
                totalFiado: { $sum: SUMA_FIADO },
                // Compras (tickets), no productos sueltos: ver CLAVE_TICKET en ventas.ts.
                tickets: { $addToSet: ventas_1.CLAVE_TICKET },
            },
        },
        { $sort: { _id: 1 } },
    ])
        .toArray();
    const filas = new Map(docs.map((d) => [
        d._id,
        {
            fecha: d._id,
            total: d.total,
            totalCobrado: d.totalCobrado,
            totalFiado: d.totalFiado,
            cantidadVentas: d.tickets.length,
            totalPagos: pagos.get(d._id)?.total ?? 0,
            cantidadPagos: pagos.get(d._id)?.cantidad ?? 0,
        },
    ]));
    // Un día con pagos de cuentas pero sin ventas también cuenta.
    for (const [dia, p] of pagos) {
        if (!filas.has(dia)) {
            filas.set(dia, { fecha: dia, total: 0, totalCobrado: 0, totalFiado: 0, cantidadVentas: 0, totalPagos: p.total, cantidadPagos: p.cantidad });
        }
    }
    return [...filas.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}
async function topProductos(desde, hasta, limite) {
    const docs = await coleccionVentas()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        // Ordenadas por fecha para que $last tome el nombre más reciente del
        // artículo (si lo renombraron); sin esto, el orden era cualquiera.
        { $sort: { fecha: 1 } },
        {
            $group: {
                _id: '$articuloId',
                descripcion: { $last: '$articuloDescripcion' },
                cantidad: { $sum: '$cantidad' },
                total: { $sum: '$total' },
            },
        },
        { $sort: { total: -1 } },
        { $limit: limite },
    ])
        .toArray();
    return docs.map((d) => ({
        articuloId: String(d._id),
        descripcion: d.descripcion,
        cantidad: d.cantidad,
        total: d.total,
    }));
}
async function porMetodoPago(desde, hasta) {
    const docs = await coleccionVentas()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        { $group: { _id: '$metodoPago', tickets: { $addToSet: ventas_1.CLAVE_TICKET }, total: { $sum: '$total' } } },
        { $sort: { total: -1 } },
    ])
        .toArray();
    return docs.map((d) => ({ metodoPago: d._id, cantidad: d.tickets.length, total: d.total }));
}
// Junta cada venta con el artículo vendido y el rubro de ese artículo, para
// saber qué rubros venden más. Un artículo borrado o sin rubro cae en "Sin
// rubro" en vez de desaparecer de la cuenta.
async function porRubro(desde, hasta) {
    const docs = await coleccionVentas()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        { $lookup: { from: 'articulos', localField: 'articuloId', foreignField: '_id', as: 'articulo' } },
        { $unwind: { path: '$articulo', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'familias', localField: 'articulo.familiaId', foreignField: '_id', as: 'familia' } },
        {
            $group: {
                _id: { $ifNull: [{ $arrayElemAt: ['$familia.nombre', 0] }, 'Sin rubro'] },
                total: { $sum: '$total' },
            },
        },
        { $sort: { total: -1 } },
    ])
        .toArray();
    return docs.map((d) => ({ familiaNombre: d._id, total: d.total }));
}
async function getReporteVentas(desde, hasta) {
    const [dia, top, metodoPago, rubro] = await Promise.all([
        porDia(desde, hasta),
        topProductos(desde, hasta, 10),
        porMetodoPago(desde, hasta),
        porRubro(desde, hasta),
    ]);
    const totalVendido = dia.reduce((acc, d) => acc + d.total, 0);
    const totalCobrado = dia.reduce((acc, d) => acc + d.totalCobrado, 0);
    const totalFiado = dia.reduce((acc, d) => acc + d.totalFiado, 0);
    const cantidadVentas = dia.reduce((acc, d) => acc + d.cantidadVentas, 0);
    const totalPagos = dia.reduce((acc, d) => acc + d.totalPagos, 0);
    const cantidadPagos = dia.reduce((acc, d) => acc + d.cantidadPagos, 0);
    return {
        desde,
        hasta,
        totalVendido,
        totalCobrado,
        totalFiado,
        cantidadVentas,
        totalPagos,
        cantidadPagos,
        ticketPromedio: cantidadVentas > 0 ? totalVendido / cantidadVentas : 0,
        porDia: dia,
        topProductos: top,
        porMetodoPago: metodoPago,
        porRubro: rubro,
    };
}
