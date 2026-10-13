// Qué se replica entre las PCs y cómo se lo trata. Es la única parte que hay
// que tocar si se agrega una colección nueva con datos del negocio.
import crypto from 'crypto';
import { BSON, ObjectId, type Document } from 'mongodb';

export const COLECCIONES_REPLICADAS = [
  'usuarios',
  'familias',
  'marcas',
  'proveedores',
  'articulos',
  'clientes',
  'ventas',
  'pagos_cuenta',
  'ajustes_cuenta',
  'movimientos_stock',
  'historial_precios',
  'recordatorios',
] as const;
export type ColeccionReplicada = (typeof COLECCIONES_REPLICADAS)[number];

const REPLICADAS = new Set<string>(COLECCIONES_REPLICADAS);

export function esReplicada(nombre: string): nombre is ColeccionReplicada {
  return REPLICADAS.has(nombre);
}

// Campos que NO viajan porque cada PC los calcula con lo que tiene. El stock de
// un artículo es "stock inicial + suma de sus movimientos": si viajara el
// número, dos PCs que venden lo mismo a la vez se pisarían; en cambio los
// movimientos (ventas, ingresos, ajustes) se suman y el resultado es el mismo
// en todas (ver aplicar.ts: recalcularStock).
const CAMPOS_PROPIOS: Record<string, readonly string[]> = {
  articulos: ['stock'],
};

export function camposPropios(coleccion: string): readonly string[] {
  return CAMPOS_PROPIOS[coleccion] ?? [];
}

// A qué colección apunta cada campo que guarda el _id de otro documento.
export const REFERENCIAS: Record<string, Record<string, ColeccionReplicada>> = {
  articulos: { familiaId: 'familias', marcaId: 'marcas', proveedorId: 'proveedores' },
  ventas: { articuloId: 'articulos', clienteId: 'clientes', usuarioId: 'usuarios' },
  pagos_cuenta: { clienteId: 'clientes', usuarioId: 'usuarios' },
  ajustes_cuenta: { clienteId: 'clientes', usuarioId: 'usuarios' },
  movimientos_stock: { articuloId: 'articulos', usuarioId: 'usuarios' },
  historial_precios: { articuloId: 'articulos', usuarioId: 'usuarios' },
  recordatorios: {
    creadoPorId: 'usuarios',
    hechoPorId: 'usuarios',
    articuloId: 'articulos',
    clienteId: 'clientes',
  },
};

// Colecciones donde dos documentos "iguales" cargados a la vez en PCs
// distintas se unifican en uno solo (la base los trata como duplicados: ver
// los índices únicos de db/database.ts).
export const UNIFICABLES: Record<string, { campo: string; soloActivos?: boolean }> = {
  usuarios: { campo: 'usuario' },
  familias: { campo: 'nombre' },
  marcas: { campo: 'nombre' },
  clientes: { campo: 'nombre', soloActivos: true },
};

/** Las colecciones y campos que guardan el _id de un documento de `destino`. */
export function referenciasA(destino: string): Array<{ coleccion: string; campo: string }> {
  const lista: Array<{ coleccion: string; campo: string }> = [];
  for (const [coleccion, campos] of Object.entries(REFERENCIAS)) {
    for (const [campo, apunta] of Object.entries(campos)) {
      if (apunta === destino) lista.push({ coleccion, campo });
    }
  }
  return lista;
}

export function hex(id: unknown): string {
  return id instanceof ObjectId ? id.toHexString() : String(id);
}

export function claveDeMeta(coleccion: string, id: unknown): string {
  return `${coleccion}:${hex(id)}`;
}

// Para comparar sin que importe el orden de los campos de un documento.
function ordenado(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    const salida: Record<string, unknown> = {};
    for (const k of Object.keys(valor as object).sort()) salida[k] = ordenado((valor as Record<string, unknown>)[k]);
    return salida;
  }
  return valor;
}

/** Huella corta de un valor cualquiera: dos valores iguales dan la misma. */
export function huellaDeValor(valor: unknown): string {
  if (valor === undefined) return '∅';
  const texto = BSON.EJSON.stringify(ordenado(valor) as Document, { relaxed: false }) ?? '∅';
  return crypto.createHash('sha1').update(texto).digest('base64').slice(0, 16);
}

/** Los campos de un documento que se replican (sin _id ni los propios). */
export function camposReplicados(coleccion: string, doc: Document): string[] {
  const propios = camposPropios(coleccion);
  return Object.keys(doc).filter((k) => k !== '_id' && !propios.includes(k));
}

/** Lo que viaja de un documento: todo menos _id y los campos propios. */
export function cuerpoReplicado(coleccion: string, doc: Document): Document {
  const cuerpo: Document = {};
  for (const k of camposReplicados(coleccion, doc)) cuerpo[k] = doc[k];
  return cuerpo;
}

export function huellaDeDoc(coleccion: string, doc: Document): string {
  return huellaDeValor(cuerpoReplicado(coleccion, doc));
}

export function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}
