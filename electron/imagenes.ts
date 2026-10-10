import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Binary } from 'mongodb';
import { getDb } from './db/database';

// Dónde quedan guardadas las fotos de los productos en esta PC. El servidor
// para celulares también las sirve desde acá (ver /imagenes en httpServer.ts).
export function carpetaImagenes(): string {
  return path.join(app.getPath('userData'), 'data', 'imagenes');
}

export function tipoDeImagen(nombre: string): string {
  const ext = path.extname(nombre).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

interface DocImagen {
  _id: string;
  tipo: string;
  datos: Binary;
}

// Las fotos también se guardan en la base, para que se vean desde las demás
// PCs cuando se usa una base compartida (ver baseCompartida.ts).
export async function guardarImagenEnBase(archivo: string): Promise<void> {
  const nombre = path.basename(archivo);
  await getDb()
    .collection<DocImagen>('imagenes')
    .updateOne(
      { _id: nombre },
      { $set: { tipo: tipoDeImagen(nombre), datos: new Binary(fs.readFileSync(archivo)) } },
      { upsert: true }
    );
}

// Devuelve la ruta de una foto en el disco de esta PC; si no está acá (la
// cargó otra PC), la baja de la base y la deja guardada para la próxima.
export async function rutaDeImagen(nombre: string): Promise<string | null> {
  const archivo = path.basename(nombre);
  const ruta = path.join(carpetaImagenes(), archivo);
  if (fs.existsSync(ruta)) return ruta;
  const doc = await getDb().collection<DocImagen>('imagenes').findOne({ _id: archivo });
  if (!doc?.datos) return null;
  fs.mkdirSync(carpetaImagenes(), { recursive: true });
  fs.writeFileSync(ruta, doc.datos.buffer);
  return ruta;
}

// Copia la imagen elegida a la carpeta de datos de la app y devuelve la ruta
// absoluta guardada, para no depender de que el archivo original no se mueva
// o se borre desde donde el usuario lo tenía.
export async function seleccionarImagen(win: BrowserWindow | null): Promise<string | null> {
  const result = await dialog.showOpenDialog(win ?? undefined as unknown as BrowserWindow, {
    title: 'Elegir imagen del artículo',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const origen = result.filePaths[0];
  const imagenesDir = carpetaImagenes();
  if (!fs.existsSync(imagenesDir)) fs.mkdirSync(imagenesDir, { recursive: true });

  const extension = path.extname(origen);
  const nombreDestino = `${crypto.randomUUID()}${extension}`;
  const destino = path.join(imagenesDir, nombreDestino);

  fs.copyFileSync(origen, destino);
  // Si no se pudo subir a la base, la foto igual queda en esta PC.
  await guardarImagenEnBase(destino).catch(() => {});
  return destino;
}
