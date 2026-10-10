// Aviso en vivo de que alguien cambió datos. Todo lo que se carga (desde esta
// PC, desde la PC conectada o desde un celular) pasa por la base de esta PC,
// así que alcanza con enterarse de cada escritura acá: database.ts avisa por
// cada comando de escritura que termina bien. De ahí sale el aviso a las
// pantallas abiertas (la de esta PC por IPC; las de los celulares y la PC
// conectada por /api/eventos) para que se vuelvan a cargar solas.
//
// También lleva una "versión de los datos" que cambia con cada escritura: la
// PC conectada la mira para saber cuándo le toca actualizar su copia de
// seguridad (ver replica.ts).
import { EventEmitter } from 'events';

// Sólo cuentan las colecciones con datos del negocio: guardar una sesión o un
// ajuste interno no es un cambio que alguien tenga que ver.
const COLECCIONES_DE_DATOS = new Set([
  'articulos',
  'ventas',
  'clientes',
  'pagos_cuenta',
  'ajustes_cuenta',
  'movimientos_stock',
  'historial_precios',
  'familias',
  'marcas',
  'proveedores',
  'usuarios',
]);

const emisor = new EventEmitter();
emisor.setMaxListeners(0);

// Cambia con cada escritura; arranca con la hora en que se abrió la app, así
// que después de reiniciar la principal las copias se refrescan una vez.
let version = `${Date.now()}-0`;
let contador = 0;

export function versionDeLosDatos(): string {
  return version;
}

// Devuelve la función para dejar de escuchar.
export function escucharCambios(alCambiar: () => void): () => void {
  emisor.on('cambio', alCambiar);
  return () => emisor.off('cambio', alCambiar);
}

let pendiente: NodeJS.Timeout | null = null;

export function notificarEscritura(coleccion: string): void {
  if (!COLECCIONES_DE_DATOS.has(coleccion)) return;
  contador += 1;
  version = `${Date.now()}-${contador}`;
  // Varias escrituras seguidas (una venta toca stock, movimientos, etc.) se
  // juntan en un solo aviso.
  if (pendiente) return;
  pendiente = setTimeout(() => {
    pendiente = null;
    emisor.emit('cambio');
  }, 400);
}
