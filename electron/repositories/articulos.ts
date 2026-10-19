import { ObjectId, type Collection } from 'mongodb';
import { enTransaccion, getDb } from '../db/database';
import { formatearCantidad, redondearCantidad } from '../../shared/formato';
import type {
  Articulo,
  ArticuloInput,
  ArticulosFiltro,
  HistorialPrecio,
  ItemConteo,
  MovimientoStock,
  ResultadoConteo,
  UnidadVenta,
} from '../../shared/types';

interface ArticuloDoc {
  _id: ObjectId;
  codigoBarras: string | null;
  descripcion: string;
  marcaId: ObjectId | null;
  familiaId: ObjectId | null;
  proveedorId: ObjectId | null;
  precioCosto: number;
  precioVenta: number;
  precioLista2: number;
  precioLista3: number;
  utilidadPct: number;
  stock: number;
  /** El stock con el que se cargó el artículo. El stock de cada momento es
   * esto más la suma de sus movimientos: así dos PCs que venden lo mismo a la
   * vez llegan al mismo número (ver sync/aplicar.ts). */
  stockBase: number;
  stockMinimo: number;
  stockIdeal: number;
  unidad: UnidadVenta;
  imagenPath: string | null;
  nota: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

// Forma del documento después de las etapas $lookup: cada relación llega como
// un array (0 o 1 elemento) con el documento completo de la colección referenciada.
interface ArticuloDocConJoins extends ArticuloDoc {
  marca?: Array<{ nombre: string }>;
  familia?: Array<{ nombre: string }>;
  proveedor?: Array<{ nombre: string }>;
}

function coleccion(): Collection<ArticuloDoc> {
  return getDb().collection<ArticuloDoc>('articulos');
}

function escapeRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- La búsqueda por texto ---
//
// Lo que se escribe se parte en palabras y TODAS tienen que aparecer (en la
// descripción o en el código de barras), en cualquier orden: "coca 1,5" encuentra
// "COCA COLA 1.5L" y "1.5 coca" también. Tampoco importan las mayúsculas, las
// tildes ("cafe" encuentra "Café", "pina" encuentra "PIÑA") ni si el decimal se
// escribe con coma o con punto. Cada letra se convierte en un grupo (a → [aáàäâãAÁ…])
// en vez de guardar una copia sin tildes de cada descripción: así funciona con los
// artículos que ya están cargados, sin migrar nada.
const RANGO_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
const VARIANTES: Record<string, string> = {
  a: 'aáàäâã',
  e: 'eéèëê',
  i: 'iíìïî',
  o: 'oóòöôõ',
  u: 'uúùüû',
  n: 'nñ',
  c: 'cç',
};

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(RANGO_DIACRITICOS, '').toLowerCase();
}

function palabrasDeBusqueda(texto: string): string[] {
  return texto.split(/\s+/).filter(Boolean).slice(0, 8);
}

function patronDePalabra(palabra: string): string {
  let patron = '';
  for (const letra of palabra.normalize('NFC')) {
    const base = sinTildes(letra);
    const grupo = base.length === 1 ? VARIANTES[base] : undefined;
    if (grupo) patron += `[${grupo}${grupo.toUpperCase()}]`;
    else if (letra === '.' || letra === ',') patron += '[.,]';
    else patron += escapeRegex(letra);
  }
  return patron;
}

/** Qué tan parecido es un artículo a lo buscado: 0 es lo mejor. Sólo ordena (dentro
 * de lo que ya coincide, queda en orden alfabético). */
function puntajeDeBusqueda(a: Articulo, palabras: string[], buscado: string): number {
  if (a.codigoBarras && a.codigoBarras === buscado.trim()) return 0;
  const descripcion = sinTildes(a.descripcion);
  const consulta = sinTildes(buscado).trim().replace(/\s+/g, ' ');
  if (descripcion === consulta) return 1;
  if (descripcion.startsWith(consulta)) return 2;
  const inicios = descripcion.split(/[^a-z0-9ñ]+/);
  const todasAlPrincipio = palabras.every((p) => {
    const q = sinTildes(p);
    return inicios.some((w) => w.startsWith(q));
  });
  if (todasAlPrincipio) return 3;
  return 4;
}

function aObjectIdOrNull(id: string | null | undefined): ObjectId | null {
  return id ? new ObjectId(id) : null;
}

function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

function mapDoc(doc: ArticuloDocConJoins): Articulo {
  return {
    id: doc._id.toHexString(),
    codigoBarras: doc.codigoBarras ?? null,
    descripcion: doc.descripcion,
    marcaId: doc.marcaId ? doc.marcaId.toHexString() : null,
    marcaNombre: doc.marca?.[0]?.nombre ?? null,
    familiaId: doc.familiaId ? doc.familiaId.toHexString() : null,
    familiaNombre: doc.familia?.[0]?.nombre ?? null,
    proveedorId: doc.proveedorId ? doc.proveedorId.toHexString() : null,
    proveedorNombre: doc.proveedor?.[0]?.nombre ?? null,
    precioCosto: doc.precioCosto,
    precioVenta: doc.precioVenta,
    precioLista2: doc.precioLista2,
    precioLista3: doc.precioLista3,
    utilidadPct: doc.utilidadPct,
    stock: doc.stock,
    stockMinimo: doc.stockMinimo,
    stockIdeal: doc.stockIdeal,
    unidad: doc.unidad,
    imagenPath: doc.imagenPath ?? null,
    nota: doc.nota ?? null,
    activo: doc.activo,
    creadoEn: doc.creadoEn,
    actualizadoEn: doc.actualizadoEn,
  };
}

const JOIN_STAGES = [
  { $lookup: { from: 'marcas', localField: 'marcaId', foreignField: '_id', as: 'marca' } },
  { $lookup: { from: 'familias', localField: 'familiaId', foreignField: '_id', as: 'familia' } },
  { $lookup: { from: 'proveedores', localField: 'proveedorId', foreignField: '_id', as: 'proveedor' } },
];

// Búsqueda por texto y rubro: lo comparten listArticulos y vaciarPapelera,
// para que "vaciar papelera" borre exactamente lo que la pantalla está
// mostrando en ese momento (con el mismo filtro), ni más ni menos.
function construirMatchBusqueda(filtro: ArticulosFiltro): Record<string, unknown> {
  const match: Record<string, unknown> = {};
  const palabras = filtro.busqueda ? palabrasDeBusqueda(filtro.busqueda) : [];
  if (palabras.length > 0) {
    match.$and = palabras.map((p) => {
      const re = new RegExp(patronDePalabra(p), 'i');
      return { $or: [{ descripcion: re }, { codigoBarras: re }] };
    });
  }
  if (filtro.familiaId) {
    match.familiaId = new ObjectId(filtro.familiaId);
  }
  return match;
}

// Controla y limpia lo que se quiere guardar de un artículo: sin descripción, o
// con un precio negativo o que no es un número, el artículo quedaba roto y
// después falla al venderlo o al sumar el inventario.
//
// Al editar ("previo" = cómo está guardado ahora): un valor que ya estaba así en
// la base (por ejemplo un stock viejo que quedó mal) no impide corregir el
// nombre o el precio; sólo se rechaza lo que se está cambiando a algo inválido.
function limpiarInputArticulo(input: ArticuloInput, previo?: Articulo): ArticuloInput {
  if (!input || typeof input !== 'object') throw new Error('Faltan los datos del artículo');
  const descripcion = typeof input.descripcion === 'string' ? input.descripcion.trim() : '';
  if (!descripcion) throw new Error('Escribí la descripción del artículo');
  const unidad = input.unidad ?? 'unidad';
  if (unidad !== 'unidad' && unidad !== 'peso') throw new Error('La unidad de venta no es válida');

  const numero = (valor: unknown, etiqueta: string, obligatorio: boolean, valorPrevio?: number): number => {
    if ((valor === undefined || valor === null || valor === '') && !obligatorio) return 0;
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
      if (previo && typeof valor === 'number' && Object.is(valor, valorPrevio)) return valor;
      throw new Error(`El ${etiqueta} tiene que ser un número igual o mayor a cero`);
    }
    return valor;
  };
  return {
    ...input,
    descripcion,
    unidad,
    precioCosto: numero(input.precioCosto, 'precio de costo', false, previo?.precioCosto),
    precioVenta: numero(input.precioVenta, 'precio de venta', true, previo?.precioVenta),
    precioLista2: numero(input.precioLista2, 'precio de la lista 2', false, previo?.precioLista2),
    precioLista3: numero(input.precioLista3, 'precio de la lista 3', false, previo?.precioLista3),
    // Al editar el stock no se guarda (va por "Ajustar stock"): no se controla.
    stock: previo ? input.stock : numero(input.stock, 'stock', false),
    stockMinimo: numero(input.stockMinimo, 'stock mínimo', false, previo?.stockMinimo),
    stockIdeal: numero(input.stockIdeal, 'stock ideal', false, previo?.stockIdeal),
  };
}

export async function listArticulos(filtro: ArticulosFiltro = {}): Promise<Articulo[]> {
  const match = construirMatchBusqueda(filtro);

  if (filtro.soloInactivos) {
    match.activo = false;
  } else if (!filtro.incluirInactivos) {
    match.activo = true;
  }
  // Los filtros de stock. "Stock bajo" quiere decir lo mismo que en el Panel: quedan pocos
  // pero todavía hay (los que ya no quedan tienen su propio filtro, "Sin stock").
  const porStock: Record<string, unknown>[] = [];
  if (filtro.soloStockBajo) porStock.push({ stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$stockMinimo'] } });
  if (filtro.soloSinStock) porStock.push({ stock: { $lte: 0 } });
  // Se vendieron sin stock registrado: hay que contarlos y corregirlos.
  if (filtro.soloParaRevisar) porStock.push({ stock: { $lt: 0 } });
  if (porStock.length > 0) match.$and = [...((match.$and as unknown[] | undefined) ?? []), ...porStock];

  const docs = await coleccion()
    .aggregate<ArticuloDocConJoins>([{ $match: match }, ...JOIN_STAGES, { $sort: { descripcion: 1 } }])
    .toArray();

  const articulos = docs.map(mapDoc);
  // Buscando, lo más parecido primero (el orden de siempre se mantiene entre iguales).
  const palabras = filtro.busqueda ? palabrasDeBusqueda(filtro.busqueda) : [];
  if (palabras.length > 0 && filtro.busqueda) {
    const buscado = filtro.busqueda;
    const puntajes = new Map(articulos.map((a) => [a.id, puntajeDeBusqueda(a, palabras, buscado)]));
    articulos.sort((a, b) => (puntajes.get(a.id) ?? 4) - (puntajes.get(b.id) ?? 4));
  }
  return articulos;
}

export async function getArticulo(id: string): Promise<Articulo | null> {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) return null;
  const docs = await coleccion()
    .aggregate<ArticuloDocConJoins>([{ $match: { _id: new ObjectId(id) } }, ...JOIN_STAGES])
    .toArray();
  return docs[0] ? mapDoc(docs[0]) : null;
}

export async function buscarPorCodigo(codigo: string): Promise<Articulo | null> {
  const docs = await coleccion()
    .aggregate<ArticuloDocConJoins>([{ $match: { codigoBarras: codigo } }, ...JOIN_STAGES])
    .toArray();
  return docs[0] ? mapDoc(docs[0]) : null;
}

export async function crearArticulo(inputRecibido: ArticuloInput): Promise<Articulo> {
  const input = limpiarInputArticulo(inputRecibido);
  const ahora = new Date().toISOString();
  const doc: Omit<ArticuloDoc, '_id' | 'codigoBarras'> & { codigoBarras?: string } = {
    descripcion: input.descripcion,
    marcaId: aObjectIdOrNull(input.marcaId),
    familiaId: aObjectIdOrNull(input.familiaId),
    proveedorId: aObjectIdOrNull(input.proveedorId),
    precioCosto: input.precioCosto,
    precioVenta: input.precioVenta,
    precioLista2: input.precioLista2,
    precioLista3: input.precioLista3,
    utilidadPct: input.utilidadPct,
    stock: input.stock,
    stockBase: input.stock,
    stockMinimo: input.stockMinimo,
    stockIdeal: input.stockIdeal,
    unidad: input.unidad,
    imagenPath: input.imagenPath,
    nota: input.nota,
    activo: true,
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
  // Importante: si no hay código, el campo NO se manda (en vez de mandarlo en
  // null). El índice único es "sparse" — sólo ignora documentos donde el
  // campo directamente no existe. Si lo mandáramos como null, el primer
  // artículo sin código ocuparía ese valor y ningún otro artículo sin código
  // podría crearse después (chocarían entre sí como si fuera un duplicado).
  const codigo = input.codigoBarras?.trim();
  if (codigo) doc.codigoBarras = codigo;

  try {
    const result = await coleccion().insertOne(doc as ArticuloDoc);
    return (await getArticulo(result.insertedId.toHexString()))!;
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un artículo con ese código de barras');
    throw err;
  }
}

// Los campos que se editan desde la ficha del artículo (el stock no: va por
// "Ajustar stock").
const CAMPOS_EDITABLES = [
  'codigoBarras',
  'descripcion',
  'marcaId',
  'familiaId',
  'proveedorId',
  'precioCosto',
  'precioVenta',
  'precioLista2',
  'precioLista3',
  'stockMinimo',
  'stockIdeal',
  'unidad',
  'imagenPath',
  'nota',
] as const;

function mismoValor(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === undefined || v === '' ? null : typeof v === 'string' ? v.trim() : v);
  return n(a) === n(b);
}

// Si dos personas editan el mismo artículo a la vez (ej. una le cambia el
// precio desde el celular mientras otra le corrige el nombre en la PC), la
// que guardaba última pisaba el cambio de la otra con lo que tenía en el
// formulario cuando lo abrió. Con `original` (cómo estaba el artículo al
// abrir el formulario) se aplican sólo los campos que esta persona cambió;
// el resto queda como esté ahora en la base.
function combinarConCambiosAjenos(input: ArticuloInput, original: ArticuloInput | undefined, actual: Articulo): ArticuloInput {
  if (!original) return input;
  const combinado: Record<string, unknown> = { ...input };
  for (const campo of CAMPOS_EDITABLES) {
    if (mismoValor(input[campo], original[campo])) combinado[campo] = actual[campo];
  }
  return combinado as unknown as ArticuloInput;
}

export async function actualizarArticulo(
  id: string,
  inputRecibido: ArticuloInput,
  usuarioId: string,
  original?: ArticuloInput
): Promise<Articulo> {
  const actual = await getArticulo(id);
  if (!actual) {
    throw new Error('El artículo no existe');
  }
  const combinado = combinarConCambiosAjenos(limpiarInputArticulo(inputRecibido, actual), original, actual);
  // La utilidad se calcula acá con los precios que de verdad quedan (los del
  // formulario pueden haberse combinado con un cambio de otra persona).
  const input: ArticuloInput = {
    ...combinado,
    utilidadPct:
      combinado.precioCosto > 0
        ? Math.round(((combinado.precioVenta - combinado.precioCosto) / combinado.precioCosto) * 1000) / 10
        : 0,
  };

  const ahora = new Date().toISOString();

  const camposComunes = {
    descripcion: input.descripcion,
    marcaId: aObjectIdOrNull(input.marcaId),
    familiaId: aObjectIdOrNull(input.familiaId),
    proveedorId: aObjectIdOrNull(input.proveedorId),
    precioCosto: input.precioCosto,
    precioVenta: input.precioVenta,
    precioLista2: input.precioLista2,
    precioLista3: input.precioLista3,
    utilidadPct: input.utilidadPct,
    // El stock NO se toca acá a propósito: el formulario de edición lo
    // muestra deshabilitado porque los cambios de stock tienen que pasar
    // por "Ajustar stock" (ajustarStock, más abajo), que además registra el
    // movimiento. Si lo escribiéramos acá, una edición hecha mientras otro
    // dispositivo vendía el mismo artículo pisaría ese cambio con el valor
    // viejo que tenía el formulario al abrirse.
    stockMinimo: input.stockMinimo,
    stockIdeal: input.stockIdeal,
    unidad: input.unidad,
    imagenPath: input.imagenPath,
    nota: input.nota,
    actualizadoEn: ahora,
  };

  // Mismo motivo que en crearArticulo: sin código, hay que sacar el campo
  // del documento (no dejarlo en null) para no chocar con otros artículos
  // que tampoco tengan código.
  const codigo = input.codigoBarras?.trim();
  const update = codigo
    ? { $set: { ...camposComunes, codigoBarras: codigo } }
    : { $set: camposComunes, $unset: { codigoBarras: '' as const } };

  try {
    await coleccion().updateOne({ _id: new ObjectId(id) }, update);
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un artículo con ese código de barras');
    throw err;
  }

  // El historial se anota recién ahora, con el cambio ya guardado: si la
  // edición fallaba (por ejemplo, un código de barras repetido), antes
  // quedaba anotado un cambio de precio que nunca se aplicó — y cada reintento
  // sumaba otro.
  const historial = getDb().collection('historial_precios');
  if (input.precioCosto !== actual.precioCosto) {
    await historial.insertOne({
      articuloId: new ObjectId(id),
      tipo: 'costo',
      precioAnterior: actual.precioCosto,
      precioNuevo: input.precioCosto,
      usuarioId: new ObjectId(usuarioId),
      fecha: ahora,
    });
  }
  if (input.precioVenta !== actual.precioVenta) {
    await historial.insertOne({
      articuloId: new ObjectId(id),
      tipo: 'venta',
      precioAnterior: actual.precioVenta,
      precioNuevo: input.precioVenta,
      usuarioId: new ObjectId(usuarioId),
      fecha: ahora,
    });
  }

  return (await getArticulo(id))!;
}

export async function eliminarArticulo(id: string): Promise<void> {
  await coleccion().updateOne(
    { _id: new ObjectId(id) },
    { $set: { activo: false, actualizadoEn: new Date().toISOString() } }
  );
}

// La "papelera": el artículo nunca se borra de la base, sólo se marca
// inactivo. Restaurarlo lo vuelve a poner activo con el mismo stock, precios
// e historial que tenía antes de darlo de baja.
export async function restaurarArticulo(id: string): Promise<Articulo> {
  await coleccion().updateOne(
    { _id: new ObjectId(id) },
    { $set: { activo: true, actualizadoEn: new Date().toISOString() } }
  );
  return (await getArticulo(id))!;
}

// Borra en serio de la base — sólo se aplica a artículos que ya estaban en la
// papelera (activo:false), como resguardo para no borrar algo activo por
// error. También limpia su historial de precios y movimientos de stock para
// no dejar registros huérfanos dando vueltas.
async function borrarDefinitivoPorFiltro(filtro: Record<string, unknown>): Promise<number> {
  const db = getDb();
  const idsABorrar = await coleccion()
    .find({ ...filtro, activo: false }, { projection: { _id: 1 } })
    .toArray();
  if (idsABorrar.length === 0) return 0;

  const objectIds = idsABorrar.map((d) => d._id);
  await db.collection('historial_precios').deleteMany({ articuloId: { $in: objectIds } });
  await db.collection('movimientos_stock').deleteMany({ articuloId: { $in: objectIds } });
  const result = await coleccion().deleteMany({ _id: { $in: objectIds } });
  return result.deletedCount;
}

export async function eliminarDefinitivo(ids: string[]): Promise<number> {
  return borrarDefinitivoPorFiltro({ _id: { $in: ids.map((id) => new ObjectId(id)) } });
}

// Vacía exactamente lo que la Papelera está mostrando en pantalla en ese
// momento (mismo filtro de búsqueda/rubro que listArticulos con
// soloInactivos), nunca más que eso — antes borraba TODA la papelera sin
// importar qué había filtrado la pantalla.
export async function vaciarPapelera(filtro: ArticulosFiltro = {}): Promise<number> {
  return borrarDefinitivoPorFiltro(construirMatchBusqueda(filtro));
}

// Las cantidades por peso (ej. 0,3 kg) no tienen representación exacta en
// binario: sumar y restar decimales deja restos como 0,7000000000000001, y
// con eso vender "lo que queda" podía fallar con "no hay stock suficiente
// (quedan 0.09999999999999987)". El stock se guarda redondeado a gramos (3
// decimales) y, al chequear si alcanza, se tolera esa diferencia ínfima.
const DECIMALES_STOCK = 3;
const TOLERANCIA_STOCK = 1e-6;

export async function ajustarStock(
  id: string,
  cantidadPedida: number,
  tipo: 'ingreso' | 'egreso' | 'ajuste',
  motivo: string | null,
  usuarioId: string,
  /** Si se indica, el movimiento se guarda con ese _id: así, si dos PCs hacen
   * "lo mismo" a la vez (anular la misma venta), terminan con un solo movimiento. */
  idMovimiento?: ObjectId,
  opciones: {
    /** Una venta se registra aunque el sistema diga que no queda stock (en el
     * local el producto está en la mano): el stock queda en negativo y el
     * artículo aparece en "Para revisar" hasta que se lo cuente. */
    permitirNegativo?: boolean;
  } = {}
): Promise<Articulo> {
  if (typeof cantidadPedida !== 'number' || !Number.isFinite(cantidadPedida)) {
    throw new Error('La cantidad no es un número válido');
  }
  const cantidad = redondearCantidad(cantidadPedida);
  if (tipo !== 'ajuste' && cantidad <= 0) throw new Error('La cantidad tiene que ser mayor a cero');

  const objectId = new ObjectId(id);
  const ahora = new Date().toISOString();

  // El cambio del stock y el movimiento que lo explica van juntos: si entre
  // los dos se metiera un cambio de otra PC y recalculara el stock con los
  // movimientos, el descuento recién hecho se deshacía.
  await enTransaccion(async () => {
    let movimiento: number;
    let nuevoStock: number;

    if (tipo === 'ajuste') {
      // Ajuste manual: fija el stock al número indicado (no es un delta).
      if (cantidad < 0) throw new Error('El stock no puede quedar en un número negativo');
      const actual = await coleccion().findOneAndUpdate(
        { _id: objectId },
        { $set: { stock: cantidad, actualizadoEn: ahora } },
        { returnDocument: 'before' }
      );
      if (!actual) throw new Error('El artículo no existe');
      nuevoStock = cantidad;
      movimiento = redondearCantidad(cantidad - actual.stock);
    } else {
      const delta = tipo === 'egreso' ? -cantidad : cantidad;
      // Suma atómica: si dos ventas del mismo artículo llegan casi juntas
      // (dos celulares, o celular + PC), Mongo procesa una después de la otra
      // en vez de que una pise el cálculo de la otra. La condición
      // "stock >= lo que se necesita" en el filtro (sólo para egresos) hace
      // que la operación entera falle en vez de dejar el stock negativo. Es un
      // update con pipeline (en vez de $inc) para poder redondear en la misma
      // operación; el "+ 0" convierte en 0 el -0 que puede dejar el redondeo.
      const condicion =
        delta < 0 && !opciones.permitirNegativo
          ? { _id: objectId, stock: { $gte: -delta - TOLERANCIA_STOCK } }
          : { _id: objectId };
      const actualizado = await coleccion().findOneAndUpdate(
        condicion,
        [
          {
            $set: {
              stock: { $add: [{ $round: [{ $add: ['$stock', delta] }, DECIMALES_STOCK] }, 0] },
              actualizadoEn: ahora,
            },
          },
        ],
        { returnDocument: 'after' }
      );
      if (!actualizado) {
        const existe = await coleccion().findOne({ _id: objectId });
        if (!existe) throw new Error('El artículo no existe');
        throw new Error(`No hay stock suficiente (quedan ${formatearCantidad(existe.stock)})`);
      }
      nuevoStock = actualizado.stock;
      movimiento = delta;
    }

    try {
      await getDb()
        .collection('movimientos_stock')
        .insertOne({
          ...(idMovimiento ? { _id: idMovimiento } : {}),
          articuloId: objectId,
          tipo,
          cantidad: movimiento,
          stockResultante: nuevoStock,
          motivo,
          usuarioId: new ObjectId(usuarioId),
          fecha: ahora,
        });
    } catch (err) {
      if (!idMovimiento || !esErrorDuplicado(err)) throw err;
      // Otra PC ya anotó este mismo movimiento (la misma venta anulada a la
      // vez): no se cuenta dos veces, y el stock se vuelve a calcular con los
      // movimientos que hay.
      const sumas = await getDb()
        .collection('movimientos_stock')
        .aggregate<{ total: number }>([
          { $match: { articuloId: objectId } },
          { $group: { _id: null, total: { $sum: '$cantidad' } } },
        ])
        .toArray();
      const art = await coleccion().findOne({ _id: objectId });
      if (art && typeof art.stockBase === 'number') {
        await coleccion().updateOne(
          { _id: objectId },
          { $set: { stock: redondearCantidad(art.stockBase + (sumas[0]?.total ?? 0)) } }
        );
      }
    }
  });

  return (await getArticulo(id))!;
}

// El conteo de inventario: alguien contó lo que hay en la góndola o el depósito
// y el stock del sistema se corrige a lo contado. Es un "ajuste" por producto
// (queda en su historial de movimientos, con lo que figuraba antes), y recién
// ahí se sincroniza con las otras PCs. Cada producto se resuelve por su cuenta:
// si uno falla (ya no existe, está en la papelera, número inválido) los demás se
// corrigen igual y el problema vuelve en `errores`.
const MAX_ITEMS_CONTEO = 1000;

export async function aplicarConteo(items: ItemConteo[], usuarioId: string): Promise<ResultadoConteo> {
  if (!Array.isArray(items) || items.length === 0) throw new Error('No hay nada contado para corregir');
  if (items.length > MAX_ITEMS_CONTEO) {
    throw new Error(`Se pueden corregir hasta ${MAX_ITEMS_CONTEO} productos por vez`);
  }
  const resultado: ResultadoConteo = { corregidos: 0, sinCambios: 0, errores: [] };
  const vistos = new Set<string>();

  for (const item of items) {
    const id = typeof item?.articuloId === 'string' ? item.articuloId : '';
    const falla = (mensaje: string, descripcion: string | null = null) =>
      resultado.errores.push({ articuloId: id, descripcion, mensaje });

    if (!ObjectId.isValid(id)) {
      falla('El producto no es válido');
      continue;
    }
    if (vistos.has(id)) {
      falla('El producto vino repetido en el conteo');
      continue;
    }
    vistos.add(id);

    const articulo = await getArticulo(id);
    if (!articulo) {
      falla('El producto ya no existe');
      continue;
    }
    if (!articulo.activo) {
      falla('Está en la papelera', articulo.descripcion);
      continue;
    }
    const contado = item.contado;
    if (typeof contado !== 'number' || !Number.isFinite(contado) || contado < 0) {
      falla('Lo contado tiene que ser un número igual o mayor a cero', articulo.descripcion);
      continue;
    }
    if (articulo.unidad !== 'peso' && !Number.isInteger(contado)) {
      falla('Se cuenta por unidad: tiene que ser un número entero', articulo.descripcion);
      continue;
    }
    const nuevo = redondearCantidad(contado);
    if (nuevo === articulo.stock) {
      resultado.sinCambios += 1;
      continue;
    }
    try {
      await ajustarStock(
        id,
        nuevo,
        'ajuste',
        `Conteo de inventario (figuraba ${formatearCantidad(articulo.stock)})`,
        usuarioId
      );
      resultado.corregidos += 1;
    } catch (err) {
      falla(err instanceof Error ? err.message : 'No se pudo corregir', articulo.descripcion);
    }
  }
  return resultado;
}

export async function historialPrecios(articuloId: string): Promise<HistorialPrecio[]> {
  const docs = await getDb()
    .collection('historial_precios')
    .aggregate([
      { $match: { articuloId: new ObjectId(articuloId) } },
      { $sort: { fecha: -1 } },
      { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } },
    ])
    .toArray();

  return docs.map((d) => ({
    id: (d._id as ObjectId).toHexString(),
    articuloId: (d.articuloId as ObjectId).toHexString(),
    tipo: d.tipo,
    precioAnterior: d.precioAnterior,
    precioNuevo: d.precioNuevo,
    usuarioNombre: d.usuario?.[0]?.nombre ?? null,
    fecha: d.fecha,
  }));
}

export async function movimientosStock(articuloId: string): Promise<MovimientoStock[]> {
  const docs = await getDb()
    .collection('movimientos_stock')
    .aggregate([
      { $match: { articuloId: new ObjectId(articuloId) } },
      { $sort: { fecha: -1 } },
      { $limit: 100 },
      { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } },
    ])
    .toArray();

  return docs.map((d) => ({
    id: (d._id as ObjectId).toHexString(),
    articuloId: (d.articuloId as ObjectId).toHexString(),
    tipo: d.tipo,
    cantidad: d.cantidad,
    stockResultante: d.stockResultante,
    motivo: d.motivo ?? null,
    usuarioNombre: d.usuario?.[0]?.nombre ?? null,
    fecha: d.fecha,
  }));
}
