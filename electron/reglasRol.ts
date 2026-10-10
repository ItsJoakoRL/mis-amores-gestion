// Reglas de qué puede ver/tocar cada rol sobre un artículo — un solo lugar
// para que la app de escritorio (electron/ipc/handlers.ts) y el servidor
// para celulares (electron/server/httpServer.ts) apliquen exactamente lo
// mismo, en vez de tener cada una su propia copia que se puede desincronizar.
import type { ArticuloInput, Rol } from '../shared/types';

// Si quien edita no es admin, no dejamos que toque el precio de costo ni la
// utilidad calculada: eso queda reservado para la jefa. La utilidad se
// recalcula acá con el costo real — antes quedaba en 0 cada vez que una
// empleada editaba el artículo (ej. le cambiaba el precio de venta).
export function sanitizarInputSegunRol(input: ArticuloInput, rol: Rol, precioCostoActual = 0): ArticuloInput {
  if (rol === 'admin') return input;
  const utilidadPct =
    precioCostoActual > 0
      ? Math.round(((input.precioVenta - precioCostoActual) / precioCostoActual) * 1000) / 10
      : 0;
  return { ...input, precioCosto: precioCostoActual, utilidadPct };
}

// Mismo criterio pero para lo que se devuelve: antes sólo se ocultaba el
// precio de costo deshabilitando el campo en la pantalla, pero el valor real
// viajaba igual en la respuesta — cualquiera podía verlo abriendo la consola
// del navegador o entrando por el celular. Esto lo saca de la respuesta
// misma para quien no sea admin.
export function ocultarCostoSiNoAdmin<T extends { precioCosto: number; utilidadPct: number }>(
  articulo: T,
  rol: Rol
): T {
  if (rol === 'admin') return articulo;
  return { ...articulo, precioCosto: 0, utilidadPct: 0 };
}

export function ocultarCostoSiNoAdminLista<T extends { precioCosto: number; utilidadPct: number }>(
  articulos: T[],
  rol: Rol
): T[] {
  return rol === 'admin' ? articulos : articulos.map((a) => ocultarCostoSiNoAdmin(a, rol));
}
