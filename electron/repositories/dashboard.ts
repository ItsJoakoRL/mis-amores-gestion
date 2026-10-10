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

  const [totalArticulos, stockBajoCount, sinStockCount, valores, totalFamilias] = await Promise.all([
    articulos.countDocuments({ activo: true }),
    articulos.countDocuments({ activo: true, stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$stockMinimo'] } }),
    articulos.countDocuments({ activo: true, stock: { $lte: 0 } }),
    articulos
      .aggregate<{ costo: number; venta: number }>([
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
