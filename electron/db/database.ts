import bcrypt from 'bcryptjs';
import { MongoClient, type Db } from 'mongodb';

// Se puede apuntar a otro servidor (por ej. si el negocio abre otro local y
// quiere compartir el catálogo entre PCs en red) definiendo estas variables de
// entorno antes de abrir la app; si no están definidas, usa un Mongo local.
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';

let client: MongoClient | null = null;
let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    throw new Error('La base de datos todavía no fue inicializada');
  }
  return db;
}

export const MONGODB_URI_LOCAL = MONGODB_URI;
export const NOMBRE_BASE = MONGODB_DB_NAME;

// Con la dirección de una base compartida (ver configuracion.ts) se usa esa;
// sin ella, la de siempre: el Mongo local de esta PC.
export async function initDatabase(uri?: string | null): Promise<Db> {
  const destino = uri || MONGODB_URI;
  client = new MongoClient(destino, {
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      (uri
        ? 'No se pudo conectar a la base compartida. Revisá que haya internet y que la dirección sea correcta. '
        : `No se pudo conectar a MongoDB en ${MONGODB_URI}. ¿Está corriendo el servicio de MongoDB? `) +
        `(${err instanceof Error ? err.message : String(err)})`
    );
  }

  db = client.db(MONGODB_DB_NAME);

  await crearIndices(db);
  await seedIfEmpty(db);
  await migrarCodigosBarraNulos(db);

  return db;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
}

async function crearIndices(database: Db) {
  await database.collection('usuarios').createIndex({ usuario: 1 }, { unique: true });
  await database.collection('familias').createIndex({ nombre: 1 }, { unique: true });
  await database.collection('marcas').createIndex({ nombre: 1 }, { unique: true });
  // sparse: permite muchos artículos sin código de barras sin chocar contra
  // el índice único — pero sólo si el campo directamente no existe en el
  // documento (ver migrarCodigosBarraNulos: si quedara guardado como "null"
  // en vez de ausente, sí cuenta como valor duplicado para el índice).
  await database
    .collection('articulos')
    .createIndex({ codigoBarras: 1 }, { unique: true, sparse: true });
  await database.collection('articulos').createIndex({ descripcion: 1 });
  await database.collection('articulos').createIndex({ familiaId: 1 });
  await database.collection('movimientos_stock').createIndex({ articuloId: 1 });
  await database.collection('historial_precios').createIndex({ articuloId: 1 });
  await database.collection('ventas').createIndex({ fecha: 1 });
  await database.collection('ventas').createIndex({ clienteId: 1 });
  await migrarIndiceNombreClientes(database);
  await database.collection('pagos_cuenta').createIndex({ clienteId: 1 });
}

// El índice único de nombre de cliente antes no distinguía activo/inactivo:
// una vez que se "sacaba" un cliente de la lista (baja lógica, no se borra
// de la base), ese nombre quedaba bloqueado para siempre y no se podía usar
// de nuevo ni para el mismo cliente ni para uno nuevo que se llame igual.
// Lo migramos a un índice parcial que sólo exige nombres únicos entre los
// clientes activos — hay que borrar el índice viejo primero porque Mongo no
// deja crear uno con las mismas claves pero opciones distintas encima.
async function migrarIndiceNombreClientes(database: Db) {
  // Si nunca se cargó un cliente en esta base, la colección "clientes" ni
  // existe todavía — listar sus índices tira "ns does not exist" en vez de
  // una lista vacía. En ese caso no hay nada que migrar.
  const indiceViejo = await database
    .collection('clientes')
    .indexes()
    .then((indices) => indices.find((i) => i.name === 'nombre_1' && !i.partialFilterExpression))
    .catch(() => undefined);
  if (indiceViejo) {
    await database.collection('clientes').dropIndex('nombre_1');
  }
  await database
    .collection('clientes')
    .createIndex({ nombre: 1 }, { unique: true, partialFilterExpression: { activo: true } });
}

async function seedIfEmpty(database: Db) {
  const usuarios = database.collection('usuarios');
  if ((await usuarios.countDocuments()) === 0) {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    await usuarios.insertOne({
      nombre: 'Administradora',
      usuario: 'admin',
      passwordHash,
      rol: 'admin',
      activo: true,
      creadoEn: new Date().toISOString(),
    });
  }

  const familias = database.collection('familias');
  if ((await familias.countDocuments()) === 0) {
    const familiasBase = ['COMESTIBLE', 'BEBIDAS', 'LIMPIEZA', 'PERFUMERIA', 'KIOSCO', 'VARIOS'];
    await familias.insertMany(familiasBase.map((nombre) => ({ nombre })));
  }
}

// Corrige artículos viejos que hayan quedado con codigoBarras guardado como
// "null" en vez de directamente sin el campo — con el índice sparse, un
// "null" explícito cuenta como valor y sólo un artículo podría tener eso a la
// vez. Sacarles el campo del todo los deja bien para el índice sparse.
async function migrarCodigosBarraNulos(database: Db) {
  await database.collection('articulos').updateMany({ codigoBarras: null }, { $unset: { codigoBarras: '' } });
}
