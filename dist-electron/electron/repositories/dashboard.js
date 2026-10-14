"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardStats = getDashboardStats;
const database_1 = require("../db/database");
async function getDashboardStats() {
    const db = (0, database_1.getDb)();
    const articulos = db.collection('articulos');
    const [totalArticulos, stockBajoCount, sinStockCount, valores, totalFamilias] = await Promise.all([
        articulos.countDocuments({ activo: true }),
        articulos.countDocuments({ activo: true, stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$stockMinimo'] } }),
        articulos.countDocuments({ activo: true, stock: { $lte: 0 } }),
        articulos
            .aggregate([
            { $match: { activo: true } },
            {
                $group: {
                    _id: null,
                    costo: { $sum: { $multiply: ['$stock', '$precioCosto'] } },
                    venta: { $sum: { $multiply: ['$stock', '$precioVenta'] } },
                },
            },
        ])
            .toArray(),
        db.collection('familias').countDocuments(),
    ]);
    return {
        totalArticulos,
        stockBajoCount,
        sinStockCount,
        valorInventarioCosto: valores[0]?.costo ?? 0,
        valorInventarioVenta: valores[0]?.venta ?? 0,
        totalFamilias,
    };
}
