// Cómo mostrar la foto de un producto: en la PC se lee directo del disco; en
// el celular se le pide a la PC por la red (ver /imagenes en
// electron/server/httpServer.ts) — la ruta guardada es del disco de la PC.
export function urlImagen(ruta: string | null | undefined): string | undefined {
  if (!ruta) return undefined;
  if (window.api.esElectron) return `file://${ruta}`;
  const nombre = ruta.split(/[\\/]/).pop();
  return nombre ? `/imagenes/${encodeURIComponent(nombre)}` : undefined;
}
