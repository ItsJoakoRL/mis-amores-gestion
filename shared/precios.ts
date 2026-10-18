// El cálculo del cambio masivo de precios. Lo usan la pantalla (para mostrar cómo
// quedaría cada precio antes de aplicarlo) y las pruebas, así lo que se ve en la
// vista previa es exactamente lo que se guarda.

/** A cuánto se redondea el precio nuevo: 0 = sin redondear (queda con centavos). */
export type RedondeoPrecio = 0 | 1 | 5 | 10 | 50 | 100;

export const REDONDEOS: readonly RedondeoPrecio[] = [0, 1, 5, 10, 50, 100];

export interface OperacionPrecio {
  /** 'porcentaje': subir o bajar un tanto por ciento. 'monto': sumar o restar pesos. */
  tipo: 'porcentaje' | 'monto';
  /** Positivo sube, negativo baja. */
  valor: number;
  redondeo: RedondeoPrecio;
}

/** El precio nuevo: nunca negativo, redondeado al múltiplo más cercano (si se pidió) y con centavos. */
export function calcularPrecioNuevo(precio: number, op: OperacionPrecio): number {
  if (!Number.isFinite(precio) || !Number.isFinite(op.valor)) return precio;
  let nuevo = op.tipo === 'porcentaje' ? precio * (1 + op.valor / 100) : precio + op.valor;
  if (nuevo < 0) nuevo = 0;
  if (op.redondeo > 0) nuevo = Math.round(nuevo / op.redondeo) * op.redondeo;
  return Math.round(nuevo * 100) / 100;
}

/** De cuánto fue el cambio, en por ciento (con un decimal). */
export function porcentajeDeCambio(anterior: number, nuevo: number): number {
  if (!(anterior > 0)) return 0;
  return Math.round(((nuevo - anterior) / anterior) * 1000) / 10;
}

/** Un identificador para agrupar los cambios de un mismo lote (alcanza con letras y números). */
export function nuevoIdLote(): string {
  const azar = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(azar);
  } else {
    for (let i = 0; i < azar.length; i++) azar[i] = Math.floor(Math.random() * 256);
  }
  return `l${Date.now().toString(36)}${Array.from(azar, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
