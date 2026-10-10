// Usar una base de datos compartida (ej. MongoDB Atlas) en vez de la propia de
// esta PC: así todas las PCs y celulares ven los mismos datos al instante y no
// hace falta que una haga de "principal". Acá está lo que se hace antes de
// cambiar de base: probar que la dirección anda y, si hace falta, subir los
// datos que ya tiene esta PC.
import fs from 'fs';
import path from 'path';
import { Binary, MongoClient } from 'mongodb';
import { MONGODB_URI_LOCAL, NOMBRE_BASE } from './db/database';
import { carpetaImagenes, tipoDeImagen } from './imagenes';
import type { ResumenSubidaBase } from '../shared/types';

function validarDireccion(uri: string): string {
  const limpia = String(uri ?? '').trim();
  if (!/^mongodb(\+srv)?:\/\//i.test(limpia)) {
    throw new Error('La dirección tiene que empezar con "mongodb://" o "mongodb+srv://".');
  }
  return limpia;
}

// Muestra a qué base apunta sin dejar a la vista el usuario ni la contraseña.
export function enmascararUri(uri: string | null): string | null {
  if (!uri) return null;
  const sinCredenciales = uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/i, '$1');
  return sinCredenciales.replace(/[/?].*$/, '').replace(/^mongodb(\+srv)?:\/\//i, '');
}

async function conectar(uri: string): Promise<MongoClient> {
  const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await cliente.connect();
    await cliente.db(NOMBRE_BASE).command({ ping: 1 });
  } catch (err) {
    await cliente.close().catch(() => {});
    const detalle = err instanceof Error ? err.message : String(err);
    if (/auth/i.test(detalle)) {
      throw new Error('El usuario o la contraseña de la dirección no son correctos.');
    }
    throw new Error(
      `No se pudo conectar a esa base. Revisá que haya internet y que la dirección esté bien copiada. (${detalle})`
    );
  }
  return cliente;
}

// Cuántos datos ya tiene la base compartida (para no pisar nada por error).
async function contarDatos(cliente: MongoClient): Promise<number> {
  const db = cliente.db(NOMBRE_BASE);
  let total = 0;
  for (const nombre of ['articulos', 'ventas', 'clientes']) {
    total += await db.collection(nombre).estimatedDocumentCount();
  }
  return total;
}

export async function probarBaseCompartida(uri: string): Promise<{ datos: number }> {
  const cliente = await conectar(validarDireccion(uri));
  try {
    return { datos: await contarDatos(cliente) };
  } finally {
    await cliente.close().catch(() => {});
  }
}

// Copia todo lo que tiene la base propia de esta PC (y las fotos de los
// productos) a la compartida. Sólo si la compartida todavía está vacía: si ya
// tiene datos, no se mezcla nada.
export async function subirDatosALaBaseCompartida(uri: string): Promise<ResumenSubidaBase> {
  const destino = await conectar(validarDireccion(uri));
  const origen = new MongoClient(MONGODB_URI_LOCAL, { serverSelectionTimeoutMS: 5000 });
  try {
    if ((await contarDatos(destino)) > 0) {
      throw new Error(
        'La base compartida ya tiene datos cargados. Si es la primera PC, algo se subió antes: usá "Sólo conectar" para usarla sin subir nada.'
      );
    }
    try {
      await origen.connect();
    } catch {
      throw new Error('No se pudo leer la base propia de esta PC para subirla. ¿Está corriendo MongoDB acá?');
    }
    const dbOrigen = origen.db(NOMBRE_BASE);
    const dbDestino = destino.db(NOMBRE_BASE);

    const resumen: ResumenSubidaBase = { colecciones: 0, documentos: 0, imagenes: 0 };
    const colecciones = (await dbOrigen.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'));
    for (const nombre of colecciones) {
      const docs = await dbOrigen.collection(nombre).find({}).toArray();
      if (docs.length === 0) continue;
      for (let i = 0; i < docs.length; i += 500) {
        await dbDestino.collection(nombre).insertMany(docs.slice(i, i + 500), { ordered: false });
      }
      resumen.colecciones++;
      resumen.documentos += docs.length;
    }

    // Las fotos viven como archivos en el disco de cada PC: las subimos para
    // que también se vean desde las otras.
    const carpeta = carpetaImagenes();
    if (fs.existsSync(carpeta)) {
      for (const archivo of fs.readdirSync(carpeta)) {
        const ruta = path.join(carpeta, archivo);
        if (!fs.statSync(ruta).isFile()) continue;
        await dbDestino
          .collection<{ _id: string; tipo: string; datos: Binary }>('imagenes')
          .updateOne(
            { _id: archivo },
            { $set: { tipo: tipoDeImagen(archivo), datos: new Binary(fs.readFileSync(ruta)) } },
            { upsert: true }
          );
        resumen.imagenes++;
      }
    }
    return resumen;
  } finally {
    await origen.close().catch(() => {});
    await destino.close().catch(() => {});
  }
}
