// Cómo mostrar la foto de un producto: en la PC principal se lee directo del
// disco; en el celular y en la PC conectada se le pide a la principal por la
// red (ver /imagenes en electron/server/httpServer.ts) — antes ahí las fotos
// salían rotas, porque la ruta guardada es del disco de la principal.
export function urlImagen(ruta: string | null | undefined): string | undefined {
  if (!ruta) return undefined;
  if (window.api.esElectron) return `file://${ruta}`;
  const nombre = ruta.split(/[\\/]/).pop();
  return nombre ? `/imagenes/${encodeURIComponent(nombre)}` : undefined;
}
