// Aviso en vivo de que alguien cambió algo en la base (desde esta PC, otra PC
// o un celular). Con una base compartida (MongoDB Atlas, que tiene "change
// streams") llega al instante; si la base no los soporta (un Mongo local
// suelto) y es compartida, se avisa cada tanto para que las pantallas se
// vuelvan a cargar igual.
import { EventEmitter } from 'events';
import type { ChangeStream } from 'mongodb';
import { getDb } from './db/database';

const COLECCIONES_DE_DATOS = [
  'articulos',
  'ventas',
  'clientes',
  'pagos_cuenta',
  'movimientos_stock',
  'historial_precios',
  'familias',
  'marcas',
  'proveedores',
  'usuarios',
];

const emisor = new EventEmitter();
emisor.setMaxListeners(0);

// Devuelve la función para dejar de escuchar.
export function escucharCambios(alCambiar: () => void): () => void {
  emisor.on('cambio', alCambiar);
  return () => emisor.off('cambio', alCambiar);
}

let pendiente: NodeJS.Timeout | null = null;
function avisar() {
  // Varias escrituras seguidas (una venta toca stock, movimientos, etc.) se
  // juntan en un solo aviso.
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    emisor.emit('cambio');
  }, 400);
}

let flujo: ChangeStream | null = null;
let sondeo: NodeJS.Timeout | null = null;

export function iniciarCambiosEnVivo(esCompartida: boolean): void {
  detenerCambiosEnVivo();
  const sondeoDeRespaldo = () => {
    // Sin change streams: sólo vale la pena si hay otras PCs escribiendo.
    if (esCompartida && !sondeo) sondeo = setInterval(avisar, 15_000);
  };
  try {
    flujo = getDb().watch([{ $match: { 'ns.coll': { $in: COLECCIONES_DE_DATOS } } }]);
    flujo.on('change', avisar);
    flujo.on('error', () => {
      flujo?.close().catch(() => {});
      flujo = null;
      sondeoDeRespaldo();
    });
  } catch {
    sondeoDeRespaldo();
  }
}

export function detenerCambiosEnVivo(): void {
  flujo?.close().catch(() => {});
  flujo = null;
  if (sondeo) clearInterval(sondeo);
  sondeo = null;
}
