// Junta en esta PC los datos de otra PC del negocio que hasta ahora trabajaba
// por su cuenta — para que, al sumarla a la red (donde todas las PCs comparten
// los datos), no se pierda nada de lo que se cargó allá: ventas, fiados,
// pagos, clientes, productos nuevos, códigos de barras, precios y stock.
//
// Las dos bases arrancaron de la misma copia (el respaldo con el que se armó
// cada PC), así que mucho tiene el mismo _id en las dos. Lo cargado después
// en cada una tiene _id distinto, y a veces es "lo mismo" (ej. el mismo
// cliente anotado en las dos PCs): eso se reconoce por nombre, código de
// barras o descripción, y se une en vez de duplicarse.
//
// Se puede correr más de una vez sin duplicar nada: lo que ya se juntó se
// reconoce por su _id y se saltea (también al sumar el stock: ver más abajo).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BSON, ObjectId, type Document } from 'mongodb';
import { getDb } from './db/database';
import { redondearCantidad } from '../shared/formato';
import type { DatosParaJuntar, ResumenJuntar } from '../shared/types';

export const COLECCIONES_A_JUNTAR = [
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
type NombreColeccion = (typeof COLECCIONES_A_JUNTAR)[number];

const EXTENSIONES_FOTO = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_BYTES_FOTO = 8 * 1024 * 1024;

type Doc = Document & { _id: ObjectId };

function esObjectId(valor: unknown): valor is ObjectId {
  return valor instanceof ObjectId || (typeof valor === 'object' && valor !== null && (valor as { _bsontype?: string })._bsontype === 'ObjectId');
}

function hex(id: unknown): string {
  return esObjectId(id) ? id.toHexString() : String(id);
}

// Para comparar nombres sin que importen mayúsculas, tildes ni espacios de más.
const RANGO_DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
function normalizar(texto: unknown): string {
  return typeof texto === 'string'
    ? texto.normalize('NFD').replace(RANGO_DIACRITICOS, '').toLowerCase().replace(/\s+/g, ' ').trim()
    : '';
}

function codigo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

function leerColeccion(datos: DatosParaJuntar, nombre: NombreColeccion): Doc[] {
  const texto = datos.colecciones?.[nombre];
  if (typeof texto !== 'string' || !texto) return [];
  const docs: unknown = BSON.EJSON.parse(texto);
  if (!Array.isArray(docs)) throw new Error(`Los datos de "${nombre}" de la otra PC no tienen el formato esperado`);
  return docs.filter((d) => d && esObjectId((d as Doc)._id)) as Doc[];
}

interface Correspondencia {
  /** id en la otra PC -> id acá (el mismo, si el doc se va a insertar tal cual). */
  mapa: Map<string, ObjectId>;
  /** Los que no existen acá: se insertan con su mismo _id. */
  nuevos: Doc[];
  /** Los de la otra PC que eran "lo mismo" que uno de acá, pero con otro _id. */
  unidosPorClave: Set<string>;
}

// Empareja cada doc de la otra PC con uno de acá: primero por _id (vienen de
// la misma copia), si no por una clave (nombre, usuario...). `destino` va en
// orden de preferencia: si dos de acá tienen la misma clave, gana el primero.
function corresponder(origen: Doc[], destino: Doc[], clave: (d: Doc) => string): Correspondencia {
  const porId = new Map(destino.map((d) => [hex(d._id), d]));
  const porClave = new Map<string, Doc>();
  for (const d of destino) {
    const k = clave(d);
    if (k && !porClave.has(k)) porClave.set(k, d);
  }
  const mapa = new Map<string, ObjectId>();
  const nuevos: Doc[] = [];
  const unidosPorClave = new Set<string>();
  for (const o of origen) {
    const id = hex(o._id);
    const mismo = porId.get(id);
    if (mismo) {
      mapa.set(id, mismo._id);
      continue;
    }
    const k = clave(o);
    const parecido = k ? porClave.get(k) : undefined;
    if (parecido) {
      mapa.set(id, parecido._id);
      unidosPorClave.add(id);
      continue;
    }
    mapa.set(id, o._id);
    nuevos.push(o);
    if (k) porClave.set(k, o);
  }
  return { mapa, nuevos, unidosPorClave };
}

function remapear(mapa: Map<string, ObjectId>, id: unknown): unknown {
  if (!esObjectId(id)) return id ?? null;
  return mapa.get(hex(id)) ?? id;
}

function resumenVacio(): ResumenJuntar {
  return {
    usuariosNuevos: 0,
    rubrosNuevos: 0,
    marcasNuevas: 0,
    proveedoresNuevos: 0,
    clientesNuevos: 0,
    clientesUnidos: 0,
    articulosNuevos: 0,
    articulosActualizados: 0,
    preciosActualizados: 0,
    codigosAsignados: 0,
    stockAjustado: 0,
    ventasNuevas: 0,
    pagosNuevos: 0,
    ajustesNuevos: 0,
    movimientosNuevos: 0,
    historialNuevo: 0,
    imagenesCopiadas: 0,
    recordatoriosNuevos: 0,
    avisos: [],
  };
}

export interface OpcionesJuntar {
  /** true: sólo calcula qué se haría, sin escribir nada. */
  simular: boolean;
  carpetaImagenes: string;
  /** Se llama justo antes de empezar a escribir (para hacer un respaldo). */
  antesDeEscribir?: () => Promise<unknown>;
}

export async function juntarDatos(datos: DatosParaJuntar, opciones: OpcionesJuntar): Promise<ResumenJuntar> {
  if (!datos || typeof datos.colecciones !== 'object' || datos.colecciones === null) {
    throw new Error('No llegaron datos para juntar');
  }
  const db = getDb();
  const resumen = resumenVacio();
  const ahora = new Date().toISOString();

  // --- Lo que trae la otra PC ---
  const origen = Object.fromEntries(COLECCIONES_A_JUNTAR.map((n) => [n, leerColeccion(datos, n)])) as Record<
    NombreColeccion,
    Doc[]
  >;

  // --- Lo que hay acá ---
  const [usuariosD, familiasD, marcasD, proveedoresD, clientesD, articulosD, historialD] = await Promise.all([
    db.collection<Doc>('usuarios').find().toArray(),
    db.collection<Doc>('familias').find().toArray(),
    db.collection<Doc>('marcas').find().toArray(),
    db.collection<Doc>('proveedores').find().toArray(),
    db.collection<Doc>('clientes').find().toArray(),
    db.collection<Doc>('articulos').find().toArray(),
    db.collection<Doc>('historial_precios').find({}, { projection: { articuloId: 1, tipo: 1, fecha: 1 } }).toArray(),
  ]);
  const idsDe = async (nombre: string) =>
    new Set((await db.collection(nombre).find({}, { projection: { _id: 1 } }).toArray()).map((d) => hex(d._id)));
  const [idsVentas, idsPagos, idsAjustes, idsMovimientos, idsRecordatorios] = await Promise.all([
    idsDe('ventas'),
    idsDe('pagos_cuenta'),
    idsDe('ajustes_cuenta'),
    idsDe('movimientos_stock'),
    idsDe('recordatorios'),
  ]);
  const idsHistorial = new Set(historialD.map((h) => hex(h._id)));

  // --- Emparejar las cosas "de catálogo" ---
  const usuarios = corresponder(origen.usuarios, usuariosD, (u) => normalizar(u.usuario));
  const familias = corresponder(origen.familias, familiasD, (f) => normalizar(f.nombre));
  const marcas = corresponder(origen.marcas, marcasD, (m) => normalizar(m.nombre));
  const proveedores = corresponder(origen.proveedores, proveedoresD, (p) => normalizar(p.nombre));
  // Para clientes con el mismo nombre se prefiere el que está activo acá.
  const clientesDOrdenados = [...clientesD].sort((a, b) => Number(b.activo === true) - Number(a.activo === true));
  const clientes = corresponder(origen.clientes, clientesDOrdenados, (c) => normalizar(c.nombre));
  resumen.usuariosNuevos = usuarios.nuevos.length;
  resumen.rubrosNuevos = familias.nuevos.length;
  resumen.marcasNuevas = marcas.nuevos.length;
  resumen.proveedoresNuevos = proveedores.nuevos.length;
  resumen.clientesNuevos = clientes.nuevos.length;

  // Un cliente que acá se "sacó de la lista" pero en la otra PC se siguió
  // usando vuelve a la lista — si no, sus fiados nuevos quedarían escondidos.
  const clientePorIdD = new Map(clientesD.map((c) => [hex(c._id), c]));
  const clientesAReactivar = new Map<string, ObjectId>();
  for (const c of origen.clientes) {
    if (c.activo !== true) continue;
    const destino = clientePorIdD.get(hex(clientes.mapa.get(hex(c._id))));
    if (destino && destino.activo !== true) clientesAReactivar.set(hex(destino._id), destino._id);
  }

  // --- Emparejar artículos: por _id, después por código de barras, y si no
  // por descripción (sólo si acá hay uno solo con esa descripción y no tienen
  // códigos de barras distintos — dos productos distintos pueden llamarse igual) ---
  const articuloPorIdD = new Map(articulosD.map((a) => [hex(a._id), a]));
  const articuloPorCodigoD = new Map<string, Doc>();
  for (const a of articulosD) {
    const c = codigo(a.codigoBarras);
    if (c) articuloPorCodigoD.set(c, a);
  }
  const repeticionesDescripcion = new Map<string, number>();
  for (const a of articulosD) {
    const k = normalizar(a.descripcion);
    if (k) repeticionesDescripcion.set(k, (repeticionesDescripcion.get(k) ?? 0) + 1);
  }
  const articuloPorDescripcionD = new Map<string, Doc>();
  for (const a of articulosD) {
    const k = normalizar(a.descripcion);
    if (k && repeticionesDescripcion.get(k) === 1) articuloPorDescripcionD.set(k, a);
  }

  const mapaArticulos = new Map<string, ObjectId>();
  const articulosNuevosOrigen: Doc[] = [];
  const grupos = new Map<string, { destino: Doc; origenes: Doc[] }>();
  for (const o of origen.articulos) {
    const id = hex(o._id);
    const cod = codigo(o.codigoBarras);
    let destino = articuloPorIdD.get(id) ?? (cod ? articuloPorCodigoD.get(cod) : undefined);
    if (!destino) {
      const porDescripcion = articuloPorDescripcionD.get(normalizar(o.descripcion));
      const codDestino = porDescripcion ? codigo(porDescripcion.codigoBarras) : null;
      if (porDescripcion && !(cod && codDestino && cod !== codDestino)) destino = porDescripcion;
    }
    if (destino) {
      mapaArticulos.set(id, destino._id);
      const grupo = grupos.get(hex(destino._id)) ?? { destino, origenes: [] };
      grupo.origenes.push(o);
      grupos.set(hex(destino._id), grupo);
    } else {
      mapaArticulos.set(id, o._id);
      articulosNuevosOrigen.push(o);
    }
  }
  resumen.articulosNuevos = articulosNuevosOrigen.length;

  // --- Fotos: la ruta guardada es del disco de la otra PC, así que la foto
  // (si vino) se guarda de nuevo acá y se apunta a la copia. ---
  const fotosPorArticulo = new Map((datos.imagenes ?? []).map((i) => [i.articuloId, i]));
  const fotosAEscribir: Array<{ ruta: string; base64: string }> = [];
  function rutaParaFoto(articuloOrigenId: string): string | null {
    const foto = fotosPorArticulo.get(articuloOrigenId);
    if (!foto || typeof foto.base64 !== 'string') return null;
    const extension = path.extname(String(foto.nombre)).toLowerCase();
    if (!EXTENSIONES_FOTO.has(extension) || foto.base64.length > (MAX_BYTES_FOTO * 4) / 3 + 4) return null;
    const ruta = path.join(opciones.carpetaImagenes, `${crypto.randomUUID()}${extension}`);
    fotosAEscribir.push({ ruta, base64: foto.base64 });
    return ruta;
  }

  const articulosNuevos = articulosNuevosOrigen.map((a) => {
    const { codigoBarras, ...resto } = a;
    const cod = codigo(codigoBarras);
    // Sin código, el campo directamente no va (el índice único es "sparse").
    return {
      ...resto,
      ...(cod ? { codigoBarras: cod } : {}),
      familiaId: remapear(familias.mapa, a.familiaId),
      marcaId: remapear(marcas.mapa, a.marcaId),
      proveedorId: remapear(proveedores.mapa, a.proveedorId),
      imagenPath: rutaParaFoto(hex(a._id)),
    } as Doc;
  });

  // --- Precios: gana el último cambio de precio, esté en la PC que esté
  // (se mira el historial de precios de las dos). ---
  const ultimoCambioD = new Map<string, string>();
  for (const h of historialD) {
    const k = `${hex(h.articuloId)}|${h.tipo}`;
    const fecha = String(h.fecha);
    if (!ultimoCambioD.has(k) || fecha > ultimoCambioD.get(k)!) ultimoCambioD.set(k, fecha);
  }
  const ultimoCambioO = new Map<string, Doc>();
  for (const h of origen.historial_precios) {
    if (idsHistorial.has(hex(h._id))) continue;
    const articulo = mapaArticulos.get(hex(h.articuloId));
    if (!articulo) continue;
    const k = `${hex(articulo)}|${h.tipo}`;
    const actual = ultimoCambioO.get(k);
    if (!actual || String(h.fecha) > String(actual.fecha)) ultimoCambioO.set(k, h);
  }

  // --- Stock: lo que se movió en la otra PC y acá no está registrado (sus
  // ventas, ingresos y ajustes desde que se separaron las bases) se suma al
  // stock de acá. Los movimientos se copian con su mismo _id, así que si se
  // vuelve a juntar, ya están y no se suman dos veces. ---
  const idsArticulosNuevos = new Set(articulosNuevos.map((a) => hex(a._id)));
  const cambioStock = new Map<string, number>();
  const conAjusteManual = new Set<string>();
  for (const m of origen.movimientos_stock) {
    if (idsMovimientos.has(hex(m._id))) continue;
    const articulo = mapaArticulos.get(hex(m.articuloId));
    if (!articulo) continue;
    const k = hex(articulo);
    if (idsArticulosNuevos.has(k)) continue; // un artículo nuevo ya viene con su stock
    cambioStock.set(k, (cambioStock.get(k) ?? 0) + (typeof m.cantidad === 'number' ? m.cantidad : 0));
    if (m.tipo === 'ajuste') conAjusteManual.add(k);
  }

  // --- Qué cambia en cada artículo que ya existía acá ---
  const codigosUsados = new Set(articuloPorCodigoD.keys());
  const actualizaciones: Array<{ _id: ObjectId; set: Record<string, unknown> }> = [];
  let codigosDistintos = 0;
  let quedabanNegativos = 0;
  let ajustadosConAjusteManual = 0;
  for (const [k, { destino: d, origenes }] of grupos) {
    const set: Record<string, unknown> = {};

    const codDestino = codigo(d.codigoBarras);
    if (!codDestino) {
      const conCodigo = origenes.map((o) => codigo(o.codigoBarras)).find((c) => c && !codigosUsados.has(c));
      if (conCodigo) {
        set.codigoBarras = conCodigo;
        codigosUsados.add(conCodigo);
        resumen.codigosAsignados++;
      }
    } else if (origenes.some((o) => codigo(o.codigoBarras) && codigo(o.codigoBarras) !== codDestino)) {
      codigosDistintos++;
    }

    // Lo que acá está vacío y allá no, se completa (ej. el rubro).
    for (const [campo, mapa] of [
      ['familiaId', familias.mapa],
      ['marcaId', marcas.mapa],
      ['proveedorId', proveedores.mapa],
    ] as const) {
      if (d[campo]) continue;
      const conValor = origenes.find((o) => esObjectId(o[campo]));
      if (conValor) set[campo] = remapear(mapa, conValor[campo]);
    }
    if (!d.nota) {
      const conNota = origenes.find((o) => typeof o.nota === 'string' && o.nota.trim());
      if (conNota) set.nota = conNota.nota;
    }
    if (!d.imagenPath) {
      for (const o of origenes) {
        const ruta = rutaParaFoto(hex(o._id));
        if (ruta) {
          set.imagenPath = ruta;
          break;
        }
      }
    }

    let precioCosto = typeof d.precioCosto === 'number' ? d.precioCosto : 0;
    let precioVenta = typeof d.precioVenta === 'number' ? d.precioVenta : 0;
    let cambioPrecio = false;
    for (const [tipo, campo] of [
      ['venta', 'precioVenta'],
      ['costo', 'precioCosto'],
    ] as const) {
      const cambio = ultimoCambioO.get(`${k}|${tipo}`);
      const ultimoAca = ultimoCambioD.get(`${k}|${tipo}`);
      if (!cambio || typeof cambio.precioNuevo !== 'number') continue;
      if (ultimoAca && ultimoAca >= String(cambio.fecha)) continue;
      if (cambio.precioNuevo === d[campo]) continue;
      set[campo] = cambio.precioNuevo;
      if (campo === 'precioVenta') precioVenta = cambio.precioNuevo;
      else precioCosto = cambio.precioNuevo;
      cambioPrecio = true;
    }
    if (cambioPrecio) {
      set.utilidadPct = precioCosto > 0 ? Math.round(((precioVenta - precioCosto) / precioCosto) * 1000) / 10 : 0;
      resumen.preciosActualizados++;
    }

    const cambio = redondearCantidad(cambioStock.get(k) ?? 0);
    if (cambio !== 0) {
      let stock = redondearCantidad((typeof d.stock === 'number' ? d.stock : 0) + cambio);
      if (stock < 0) {
        // El stock se calcula como "stock inicial + movimientos": para que se
        // quede en 0, se sube el stock inicial lo que haga falta.
        if (typeof d.stockBase === 'number') set.stockBase = redondearCantidad(d.stockBase - stock);
        stock = 0;
        quedabanNegativos++;
      }
      set.stock = stock;
      resumen.stockAjustado++;
      if (conAjusteManual.has(k)) ajustadosConAjusteManual++;
    }

    if (Object.keys(set).length > 0) {
      set.actualizadoEn = ahora;
      actualizaciones.push({ _id: d._id, set });
    }
  }
  resumen.articulosActualizados = actualizaciones.length;
  resumen.imagenesCopiadas = fotosAEscribir.length;

  if (codigosDistintos > 0) {
    resumen.avisos.push(
      `${codigosDistintos} producto(s) tienen un código de barras distinto en cada PC: se dejó el de esta PC.`
    );
  }
  if (ajustadosConAjusteManual > 0) {
    resumen.avisos.push(
      `${ajustadosConAjusteManual} producto(s) tuvieron ajustes de stock a mano en la otra PC: conviene revisar que su stock esté bien.`
    );
  }
  if (quedabanNegativos > 0) {
    resumen.avisos.push(
      `${quedabanNegativos} producto(s) quedaban con stock negativo al sumar lo vendido en las dos PCs: se dejaron en 0.`
    );
  }

  // --- Ventas, pagos, saldos y registros: lo que acá no está, con las
  // referencias pasadas a los _id de acá ---
  const ventasNuevas = origen.ventas
    .filter((v) => !idsVentas.has(hex(v._id)))
    .map((v) => ({
      ...v,
      articuloId: remapear(mapaArticulos, v.articuloId),
      clienteId: v.clienteId ? remapear(clientes.mapa, v.clienteId) : null,
      usuarioId: remapear(usuarios.mapa, v.usuarioId),
    }));
  const pagosNuevos = origen.pagos_cuenta
    .filter((p) => !idsPagos.has(hex(p._id)))
    .map((p) => ({ ...p, clienteId: remapear(clientes.mapa, p.clienteId), usuarioId: remapear(usuarios.mapa, p.usuarioId) }));
  const ajustesNuevos = origen.ajustes_cuenta
    .filter((a) => !idsAjustes.has(hex(a._id)))
    .map((a) => ({ ...a, clienteId: remapear(clientes.mapa, a.clienteId), usuarioId: remapear(usuarios.mapa, a.usuarioId) }));
  const historialNuevo = origen.historial_precios
    .filter((h) => !idsHistorial.has(hex(h._id)))
    .map((h) => ({ ...h, articuloId: remapear(mapaArticulos, h.articuloId), usuarioId: remapear(usuarios.mapa, h.usuarioId) }));
  const movimientosNuevos = origen.movimientos_stock
    .filter((m) => !idsMovimientos.has(hex(m._id)))
    .map((m) => ({ ...m, articuloId: remapear(mapaArticulos, m.articuloId), usuarioId: remapear(usuarios.mapa, m.usuarioId) }));
  const recordatoriosNuevos = origen.recordatorios
    .filter((r) => !idsRecordatorios.has(hex(r._id)))
    .map((r) => ({
      ...r,
      creadoPorId: remapear(usuarios.mapa, r.creadoPorId),
      hechoPorId: r.hechoPorId ? remapear(usuarios.mapa, r.hechoPorId) : null,
      articuloId: r.articuloId ? remapear(mapaArticulos, r.articuloId) : null,
      clienteId: r.clienteId ? remapear(clientes.mapa, r.clienteId) : null,
    }));
  resumen.recordatoriosNuevos = recordatoriosNuevos.length;
  resumen.ventasNuevas = ventasNuevas.length;
  resumen.pagosNuevos = pagosNuevos.length;
  resumen.ajustesNuevos = ajustesNuevos.length;
  resumen.historialNuevo = historialNuevo.length;
  resumen.movimientosNuevos = movimientosNuevos.length;
  // Clientes anotados en las dos PCs que traen algo nuevo (un fiado, un
  // pago): ésos son los que de verdad se unen ahora. Si se vuelve a juntar
  // y ya no traen nada, no hace falta contarlos de nuevo.
  const clientesConNovedades = new Set(
    [...origen.ventas.filter((v) => !idsVentas.has(hex(v._id))), ...origen.pagos_cuenta.filter((p) => !idsPagos.has(hex(p._id))), ...origen.ajustes_cuenta.filter((a) => !idsAjustes.has(hex(a._id)))]
      .map((m) => (esObjectId(m.clienteId) ? hex(m.clienteId) : null))
      .filter((id): id is string => id !== null)
  );
  resumen.clientesUnidos = [...clientes.unidosPorClave].filter((id) => clientesConNovedades.has(id)).length;

  if (opciones.simular) return resumen;

  // Si no hay nada que escribir (ej. ya se había juntado todo), ni siquiera
  // hace falta el respaldo previo.
  const hayAlgoParaEscribir =
    Object.entries(resumen).some(([clave, valor]) => clave !== 'clientesUnidos' && typeof valor === 'number' && valor > 0) ||
    clientesAReactivar.size > 0;
  if (!hayAlgoParaEscribir) return resumen;

  // ================= De acá en adelante, se escribe =================
  await opciones.antesDeEscribir?.();

  if (fotosAEscribir.length > 0) {
    fs.mkdirSync(opciones.carpetaImagenes, { recursive: true });
    for (const foto of fotosAEscribir) fs.writeFileSync(foto.ruta, Buffer.from(foto.base64, 'base64'));
  }

  async function insertar(nombre: string, docs: Document[]) {
    if (docs.length === 0) return;
    try {
      await db.collection(nombre).insertMany(docs, { ordered: false });
    } catch (err) {
      // Con ordered:false, lo que no chocaba igual se guardó.
      const insertados = (err as { insertedCount?: number; result?: { insertedCount?: number } }).insertedCount ??
        (err as { result?: { insertedCount?: number } }).result?.insertedCount;
      resumen.avisos.push(
        `En "${nombre}" no se pudieron pasar ${docs.length - (insertados ?? 0)} registro(s): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // El orden importa por si algo se corta a la mitad: los movimientos de
  // stock van al final, después de sumar su efecto al stock — así, si se
  // corta antes, al volver a juntar se recalcula todo igual.
  await insertar('usuarios', usuarios.nuevos);
  await insertar('familias', familias.nuevos);
  await insertar('marcas', marcas.nuevos);
  await insertar('proveedores', proveedores.nuevos);
  await insertar('clientes', clientes.nuevos);
  if (clientesAReactivar.size > 0) {
    await db.collection('clientes').updateMany({ _id: { $in: [...clientesAReactivar.values()] } }, { $set: { activo: true } });
  }
  await insertar('articulos', articulosNuevos);
  await insertar('ventas', ventasNuevas);
  await insertar('pagos_cuenta', pagosNuevos);
  await insertar('ajustes_cuenta', ajustesNuevos);
  await insertar('historial_precios', historialNuevo);
  if (actualizaciones.length > 0) {
    await db
      .collection('articulos')
      .bulkWrite(actualizaciones.map((a) => ({ updateOne: { filter: { _id: a._id }, update: { $set: a.set } } })), {
        ordered: false,
      });
  }
  await insertar('movimientos_stock', movimientosNuevos);
  await insertar('recordatorios', recordatoriosNuevos);

  return resumen;
}

// Lo que manda esta PC cuando se suma a la red de otra: toda su base (las
// colecciones que importan) y las fotos de sus productos.
export async function exportarDatosParaJuntar(nombrePc: string): Promise<DatosParaJuntar> {
  const db = getDb();
  const colecciones: Record<string, string> = {};
  for (const nombre of COLECCIONES_A_JUNTAR) {
    colecciones[nombre] = BSON.EJSON.stringify(await db.collection(nombre).find().toArray());
  }
  const imagenes: DatosParaJuntar['imagenes'] = [];
  const conFoto = await db
    .collection('articulos')
    .find({ imagenPath: { $type: 'string', $ne: '' } }, { projection: { imagenPath: 1 } })
    .toArray();
  for (const a of conFoto) {
    try {
      const ruta = String(a.imagenPath);
      if (!EXTENSIONES_FOTO.has(path.extname(ruta).toLowerCase())) continue;
      const datosArchivo = fs.statSync(ruta);
      if (!datosArchivo.isFile() || datosArchivo.size > MAX_BYTES_FOTO) continue;
      imagenes.push({ articuloId: hex(a._id), nombre: path.basename(ruta), base64: fs.readFileSync(ruta).toString('base64') });
    } catch {
      // La foto ya no está en el disco: el producto pasa sin foto.
    }
  }
  return { nombrePc, colecciones, imagenes };
}
