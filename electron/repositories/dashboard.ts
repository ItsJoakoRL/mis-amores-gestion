import { getDb } from '../db/database';
import type { DashboardStats } from '../../shared/types';

interface ArticuloDoc {
  activo: boolean;
  stock: number;
  stockMinimo: number;
  precioCosto: number;
  precioVenta: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDb();
  const articulos = db.collection<ArticuloDoc>('articulos');

  const [totalArticulos, stockBajoCount, sinStockCount, paraRevisarCount, valores, totalFamilias] = await Promise.all([
    articulos.countDocuments({ activo: true }),
    articulos.countDocuments({ activo: true, stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$stockMinimo'] } }),
    articulos.countDocuments({ activo: true, stock: { $lte: 0 } }),
    // Se vendieron sin stock registrado (stock en negativo): hay que contarlos.
    articulos.countDocuments({ activo: true, stock: { $lt: 0 } }),
    articulos
      .aggregate<{ costo: number; venta: number }>([
        { $match: { activo: true } },
        {
          $group: {
            _id: null,
            // Un stock en negativo (se vendió sin stock registrado) no resta
            // valor al inventario: vale como cero hasta que se lo cuente.
            costo: { $sum: { $multiply: [{ $max: ['$stock', 0] }, '$precioCosto'] } },
            venta: { $sum: { $multiply: [{ $max: ['$stock', 0] }, '$precioVenta'] } },
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
    paraRevisarCount,
    valorInventarioCosto: valores[0]?.costo ?? 0,
    valorInventarioVenta: valores[0]?.venta ?? 0,
    totalFamilias,
  };
}
