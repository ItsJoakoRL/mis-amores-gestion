import { parsearMonto } from '@shared/formato';

// Cuenta del vuelto al cobrar en efectivo: "paga con $20.000" → "vuelto $2.500". Es sólo una ayuda para el
// mostrador: no se guarda en ninguna venta ni cambia lo que se cobra.

export type ResultadoPago =
  | { tipo: 'vacio' } // no escribió nada (o no hay nada para cobrar)
  | { tipo: 'invalido' } // lo escrito no es un monto
  | { tipo: 'falta'; faltan: number }
  | { tipo: 'justo' }
  | { tipo: 'vuelto'; vuelto: number };

/** Redondea a centavos: sumar y restar decimales en binario deja restos (0,1 + 0,2 = 0,30000000000000004). */
export const aCentavos = (n: number): number => Math.round(n * 100) / 100;

const MAXIMO = 1_000_000_000;

/** Lo que se escribe en "Paga con": sólo números, puntos y comas (así no entran letras ni símbolos por error). */
export function limpiarMontoEscrito(valor: string): string {
  return valor.replace(/[^0-9.,]/g, '').slice(0, 14);
}

/** El monto que escribió, o null si está vacío o no es un monto válido. */
export function montoEscrito(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const n = parsearMonto(t);
  return Number.isFinite(n) && n > 0 && n < MAXIMO ? n : null;
}

/** Qué le toca a la cuenta: vuelto, falta plata, justo... `aCobrar` es la parte que se cobra en efectivo. */
export function calcularPago(textoPagaCon: string, aCobrar: number): ResultadoPago {
  const total = aCentavos(aCobrar);
  if (!(total > 0) || !textoPagaCon.trim()) return { tipo: 'vacio' };
  const pago = montoEscrito(textoPagaCon);
  if (pago === null) return { tipo: 'invalido' };
  const diferencia = aCentavos(pago - total);
  if (diferencia < 0) return { tipo: 'falta', faltan: aCentavos(-diferencia) };
  if (diferencia === 0) return { tipo: 'justo' };
  return { tipo: 'vuelto', vuelto: diferencia };
}

const BILLETES = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

/** Los montos que más se usan para pagar una cuenta de este valor (billetes redondos que la superan). */
export function billetesSugeridos(aCobrar: number): number[] {
  const total = aCentavos(aCobrar);
  if (!(total > 0)) return [];
  const mayores = BILLETES.filter((b) => b > total).slice(0, 3);
  if (mayores.length > 0) return mayores;
  // Más de $100.000: de a $50.000.
  const siguiente = (Math.floor(total / 50000) + 1) * 50000;
  return [siguiente, siguiente + 50000];
}

/** El monto como se escribe en el cuadro ("2500" o "2500,5"), para el botón "Justo". */
export function textoDeMonto(n: number): string {
  return String(aCentavos(n)).replace('.', ',');
}
