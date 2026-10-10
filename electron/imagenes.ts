import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Dónde quedan guardadas las fotos de los productos en esta PC. El servidor
// para celulares también las sirve desde acá (ver /imagenes en httpServer.ts).
export function carpetaImagenes(): string {
  return path.join(app.getPath('userData'), 'data', 'imagenes');
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
  return destino;
}
