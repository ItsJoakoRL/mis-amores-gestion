// Las cuentas de los fiados, sin tocar la base: repartir lo que pagó un cliente entre lo que
// debe, y revisar la lista de productos de una deuda anotada a mano. Lo usan la PC, el
// servidor y las pantallas, así que todos hacen exactamente la misma cuenta.
import { formatearCantidad, formatearMonedaConCentavos, redondearCantidad } from './formato';
import type { ItemDeuda, LineaEstadoCuenta } from './types';

export interface LineaDeuda {
  id: string;
  /** ISO: sirve para saber qué es lo más viejo. */
  fecha: string;
  monto: number;
}

const redondearPesos = (n: number) => Math.round(n * 100) / 100;

/** Para ordenar de lo más viejo a lo más nuevo. Si dos cosas tienen exactamente la misma
 * fecha (pasa: la fecha de algo anotado a mano llega hasta el minuto), se ordenan por su id,
 * que sale del momento en que se crearon: así el orden es siempre el mismo en la PC, en el
 * servidor y en el celular, y los pagos se reparten igual en todos lados. */
export function compararAntiguedad(a: { fecha: string; id: string }, b: { fecha: string; id: string }): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Reparte lo que el cliente ya pagó entre lo que debe, empezando por lo más viejo, y
 * devuelve cuánto le falta pagar de cada línea (0 si quedó cubierta del todo). Las líneas
 * con monto cero o negativo no son deuda: se ignoran. A igual fecha, la que se creó
 * primero (ver compararAntiguedad). */
export function repartirPagos(lineas: LineaDeuda[], credito: number): Map<string, number> {
  const resta = new Map<string, number>();
  let disponible = Math.max(0, credito);
  const ordenadas = lineas.filter((l) => l.monto > 0).sort(compararAntiguedad);
  for (const l of ordenadas) {
    // Con medio centavo de tolerancia: 0,1 + 0,2 no da 0,3 en la computadora.
    const cubierto = disponible >= l.monto - 0.005 ? l.monto : disponible;
    disponible = Math.max(0, disponible - cubierto);
    resta.set(l.id, redondearPesos(l.monto - cubierto));
  }
  return resta;
}

/** La fecha de lo primero que todavía no quedó cubierto (desde cuándo debe), o null. */
export function deudaDesdeDe(lineas: LineaDeuda[], credito: number): string | null {
  const resta = repartirPagos(lineas, credito);
  const pendientes = lineas.filter((l) => (resta.get(l.id) ?? 0) > 0.005);
  if (pendientes.length === 0) return null;
  return pendientes.reduce((min, l) => (l.fecha < min ? l.fecha : min), pendientes[0].fecha);
}

export const MAX_ITEMS_DEUDA = 60;

/** Lo que va debajo del título de una línea del estado de cuenta para que se entienda qué
 * es: el precio de cada unidad si compró varias, o la lista de productos de una deuda
 * anotada a mano. El PDF y la pantalla muestran exactamente esto. */
export function aclaracionesDeLinea(l: Pick<LineaEstadoCuenta, 'descripcion' | 'items'>): string[] {
  const items = l.items ?? [];
  if (items.length === 0) return [];
  const mon = formatearMonedaConCentavos;
  // Un fiado del mostrador: el título ya dice "2 x ALFAJOR", sólo falta el precio de cada uno.
  if (items.length === 1 && l.descripcion === `${formatearCantidad(items[0].cantidad)} x ${items[0].descripcion}`) {
    return items[0].cantidad === 1 ? [] : [`${mon(items[0].precioUnitario)} cada uno`];
  }
  return items.map(
    (i) => `${formatearCantidad(i.cantidad)} x ${i.descripcion} · ${mon(i.precioUnitario)} c/u · ${mon(subtotalDeItem(i))}`
  );
}

export function subtotalDeItem(item: Pick<ItemDeuda, 'cantidad' | 'precioUnitario'>): number {
  return redondearPesos(item.cantidad * item.precioUnitario);
}

export function totalDeItems(items: Array<Pick<ItemDeuda, 'cantidad' | 'precioUnitario'>>): number {
  return redondearPesos(items.reduce((acc, i) => acc + subtotalDeItem(i), 0));
}

/** Revisa los productos de una deuda anotada a mano y los deja limpios. Tira un error con
 * un mensaje para mostrar tal cual. */
export function normalizarItemsDeuda(entrada: unknown): { items: ItemDeuda[]; total: number } {
  if (!Array.isArray(entrada) || entrada.length === 0) throw new Error('Agregá al menos un producto');
  if (entrada.length > MAX_ITEMS_DEUDA) throw new Error(`Se pueden anotar hasta ${MAX_ITEMS_DEUDA} productos por vez`);
  const items = entrada.map((crudo, i): ItemDeuda => {
    const n = i + 1;
    const x = (crudo ?? {}) as Record<string, unknown>;
    const descripcion = typeof x.descripcion === 'string' ? x.descripcion.trim().replace(/\s+/g, ' ') : '';
    if (!descripcion) throw new Error(`Al producto ${n} le falta el nombre`);
    if (descripcion.length > 120) throw new Error(`El nombre del producto ${n} es demasiado largo`);
    const cantidad = typeof x.cantidad === 'number' ? redondearCantidad(x.cantidad) : NaN;
    if (!Number.isFinite(cantidad) || !(cantidad > 0) || cantidad > 1_000_000) {
      throw new Error(`La cantidad de "${descripcion}" tiene que ser mayor a cero`);
    }
    const precio = typeof x.precioUnitario === 'number' ? redondearPesos(x.precioUnitario) : NaN;
    if (!Number.isFinite(precio) || precio < 0 || precio > 1e9) {
      throw new Error(`El precio de "${descripcion}" no es válido`);
    }
    return { descripcion, cantidad, precioUnitario: precio };
  });
  const total = totalDeItems(items);
  if (!(total > 0)) throw new Error('El total de lo anotado tiene que ser mayor a cero');
  if (total > 1e9) throw new Error('El total es demasiado grande');
  return { items, total };
}
