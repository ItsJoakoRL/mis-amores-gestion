// Lo que quedó de la época de la "PC principal" y las "PCs conectadas":
//
// - La clave de copia (claveDeCopia). Ahora es la clave de la red: la usan las
//   PCs para reconocerse entre sí (ver sync/rutas.ts). Vive en la base de la PC
//   que la creó; al sumarse a una red, las otras la guardan en su configuración.
// - Las rutas /api/copia/... que sigue ofreciendo cada PC para que una PC con la
//   versión anterior (que todavía se conecta a una "principal") siga andando
//   hasta que se actualice.
// - Cargar en la base de esta PC la última copia guardada por la versión
//   anterior (carpeta "copia-principal"): sólo se usa una vez, al pasar de la
//   versión anterior a ésta, si la otra PC no está para traer los datos.
import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BSON, MongoClient, type Document } from 'mongodb';
import { carpetaRespaldos, respaldarBase } from './backup';
import { versionDeLosDatos } from './cambiosEnVivo';
import { getDb, MONGODB_DB_NAME, MONGODB_URI } from './db/database';
import { carpetaImagenes } from './imagenes';

const EXTENSIONES_FOTO = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const COLECCION_AJUSTES = 'ajustes_sistema';
const SUFIJO_TEMPORAL = '__copia';

// =====================================================================
// La clave y lo que se le ofrece a una PC con la versión anterior
// =====================================================================

interface DocAjuste {
  _id: string;
  clave: string;
}

// La clave que comparten las PCs del negocio, para pedirse datos sin tener
// que guardar ninguna contraseña. La crea la primera PC que la necesita.
export async function claveDeCopia(): Promise<string> {
  const col = getDb().collection<DocAjuste>(COLECCION_AJUSTES);
  const existente = await col.findOne({ _id: 'copia' });
  if (existente?.clave) return existente.clave;
  await col.updateOne(
    { _id: 'copia' },
    { $setOnInsert: { clave: crypto.randomBytes(24).toString('hex') } },
    { upsert: true }
  );
  const doc = await col.findOne({ _id: 'copia' });
  if (!doc?.clave) throw new Error('No se pudo crear la clave de copia');
  return doc.clave;
}

export async function claveEsValida(clave: unknown): Promise<boolean> {
  if (typeof clave !== 'string' || clave.length < 16) return false;
  const real = Buffer.from(await claveDeCopia());
  const recibida = Buffer.from(clave);
  return recibida.length === real.length && crypto.timingSafeEqual(recibida, real);
}

export interface ManifiestoCopia {
  /** Cambia cada vez que alguien carga algo en la principal. */
  version: string;
  fecha: string;
  idPc: string;
  nombrePc: string;
  generacion: number;
  colecciones: Array<{ nombre: string; cantidad: number }>;
  imagenes: Array<{ nombre: string; bytes: number }>;
}

async function nombresDeColecciones(): Promise<string[]> {
  const lista = await getDb().listCollections({}, { nameOnly: true }).toArray();
  return lista
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !n.startsWith('_sync_') && !n.endsWith(SUFIJO_TEMPORAL))
    .sort();
}

function listarImagenes(): ManifiestoCopia['imagenes'] {
  const carpeta = carpetaImagenes();
  if (!fs.existsSync(carpeta)) return [];
  const fotos: ManifiestoCopia['imagenes'] = [];
  for (const nombre of fs.readdirSync(carpeta)) {
    if (!EXTENSIONES_FOTO.has(path.extname(nombre).toLowerCase())) continue;
    try {
      const datos = fs.statSync(path.join(carpeta, nombre));
      if (datos.isFile()) fotos.push({ nombre, bytes: datos.size });
    } catch {
      // Se borró justo ahora: no cuenta.
    }
  }
  return fotos;
}

export async function armarManifiesto(idPc: string, nombrePc: string, generacion: number): Promise<ManifiestoCopia> {
  const colecciones: ManifiestoCopia['colecciones'] = [];
  for (const nombre of await nombresDeColecciones()) {
    colecciones.push({ nombre, cantidad: await getDb().collection(nombre).countDocuments() });
  }
  return {
    version: versionDeLosDatos(),
    fecha: new Date().toISOString(),
    idPc,
    nombrePc,
    generacion,
    colecciones,
    imagenes: listarImagenes(),
  };
}

// Una colección entera como EJSON "canónico" (conserva los tipos exactos:
// ObjectId, fechas, enteros y decimales), para cargarla igual en otra base.
export async function coleccionComoTexto(nombre: string): Promise<string> {
  if (!(await nombresDeColecciones()).includes(nombre)) throw new Error('Esa colección no existe');
  const docs = await getDb().collection(nombre).find().toArray();
  return BSON.EJSON.stringify(docs, { relaxed: false });
}

// =====================================================================
// La copia guardada por la versión anterior
// =====================================================================

export interface MetaCopia {
  version: string;
  fecha: string;
  idPrincipal: string;
  nombrePrincipal: string;
  generacion: number;
  direccion: string;
  resumen: { articulos: number; clientes: number; ventas: number };
}

export function carpetaCopia(): string {
  return path.join(app.getPath('userData'), 'copia-principal');
}

export function leerMetaCopia(): MetaCopia | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(carpetaCopia(), 'meta.json'), 'utf-8')) as MetaCopia;
    return typeof meta.fecha === 'string' && typeof meta.version === 'string' ? meta : null;
  } catch {
    return null;
  }
}

function marcaDeTiempo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Carga la copia guardada en la base de esta PC, reemplazando lo que tenga.
// Va de a pasos para que, si algo falla a la mitad, la base siga como estaba:
// primero se carga todo en colecciones temporales, y sólo cuando está todo
// cargado se reemplazan. Antes de tocar nada, lo que había se respalda en
// "Documentos\Mis Amores - Respaldos".
export async function cargarCopiaEnEstaPc(
  carpeta: string = carpetaCopia(),
  alAvanzar?: (texto: string) => void
): Promise<{ respaldo: string | null }> {
  if (!fs.existsSync(carpeta)) throw new Error('No hay una copia de los datos guardada en esta PC.');
  const archivos = fs.readdirSync(carpeta).filter((n) => n.endsWith('.json') && n !== 'meta.json');
  if (archivos.length === 0) throw new Error('La copia guardada en esta PC está vacía.');

  const cliente = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await cliente.connect();
  } catch {
    throw new Error('No se pudo abrir la base de datos de esta PC. ¿Está corriendo MongoDB?');
  }
  try {
    const db = cliente.db(MONGODB_DB_NAME);
    const existentes = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'));

    let respaldo: string | null = null;
    if (existentes.length > 0) {
      alAvanzar?.('Guardando un respaldo de lo que había en esta PC...');
      respaldo = path.join(carpetaRespaldos(), `antes-de-cargar-copia-${marcaDeTiempo()}`);
      await respaldarBase(db, respaldo);
    }

    const nombres: string[] = [];
    for (const archivo of archivos) {
      const nombre = path.basename(archivo, '.json');
      alAvanzar?.(`Cargando ${nombre}...`);
      const docs = BSON.EJSON.parse(fs.readFileSync(path.join(carpeta, archivo), 'utf-8'), { relaxed: false }) as Document[];
      const temporal = `${nombre}${SUFIJO_TEMPORAL}`;
      await db.collection(temporal).drop().catch(() => {});
      if (docs.length === 0) {
        await db.createCollection(temporal);
      } else {
        for (let i = 0; i < docs.length; i += 500) {
          await db.collection(temporal).insertMany(docs.slice(i, i + 500), { ordered: true });
        }
      }
      nombres.push(nombre);
    }

    // Las fotos, antes de reemplazar: así las rutas de los productos se
    // pueden apuntar a la carpeta de esta PC (la que traen es la del disco de
    // la principal anterior).
    const carpetaFotos = path.join(carpeta, 'imagenes');
    const destinoFotos = carpetaImagenes();
    const fotosCopiadas = new Set<string>();
    if (fs.existsSync(carpetaFotos)) {
      fs.mkdirSync(destinoFotos, { recursive: true });
      for (const nombre of fs.readdirSync(carpetaFotos)) {
        const origen = path.join(carpetaFotos, nombre);
        const aca = path.join(destinoFotos, nombre);
        try {
          if (!fs.existsSync(aca) || fs.statSync(aca).size !== fs.statSync(origen).size) fs.copyFileSync(origen, aca);
          fotosCopiadas.add(nombre);
        } catch {
          // Esa foto no se pudo copiar: el producto queda sin foto.
        }
      }
    }
    if (nombres.includes('articulos')) {
      const articulos = db.collection(`articulos${SUFIJO_TEMPORAL}`);
      const conFoto = await articulos
        .find({ imagenPath: { $type: 'string', $ne: '' } }, { projection: { imagenPath: 1 } })
        .toArray();
      const cambios = conFoto
        .map((a) => ({ id: a._id, nombre: path.win32.basename(String(a.imagenPath)) }))
        .filter((a) => fotosCopiadas.has(a.nombre))
        .map((a) => ({
          updateOne: { filter: { _id: a.id }, update: { $set: { imagenPath: path.join(destinoFotos, a.nombre) } } },
        }));
      if (cambios.length > 0) await articulos.bulkWrite(cambios, { ordered: false });
    }

    alAvanzar?.('Reemplazando los datos de esta PC...');
    for (const nombre of existentes) {
      if (!nombres.includes(nombre) && !nombre.endsWith(SUFIJO_TEMPORAL)) {
        await db.collection(nombre).drop().catch(() => {});
      }
    }
    for (const nombre of nombres) {
      await db.collection(`${nombre}${SUFIJO_TEMPORAL}`).rename(nombre, { dropTarget: true });
    }
    return { respaldo };
  } finally {
    await cliente.close().catch(() => {});
  }
}
