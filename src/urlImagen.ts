// Cómo mostrar la foto de un producto: siempre se le pide al servidor de la PC
// (ver /imagenes en electron/server/httpServer.ts), que la lee de su disco o,
// si la cargó otra PC, la baja de la base compartida. En el celular y en la PC
// conectada es la misma dirección que la página; en la PC con sus datos hay
// que pedirla a su propio servidor.
export function urlImagen(ruta: string | null | undefined): string | undefined {
  if (!ruta) return undefined;
  const nombre = ruta.split(/[\\/]/).pop();
  if (!nombre) return undefined;
  const base = window.api.esElectron ? `http://127.0.0.1:${window.api.puertoLocal}` : '';
  return `${base}/imagenes/${encodeURIComponent(nombre)}`;
}
