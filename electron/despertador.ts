// Que el servidor de internet no se duerma (ver SERVIDOR_RENDER.md).
//
// El plan gratuito de Render apaga el servidor si pasan 15 minutos sin que nadie
// lo visite, y al celular le toca esperar un minuto a que despierte. Con las PCs
// apagadas no hay quien lo visite, así que se visita solo: cada pocos minutos
// pide su propia página por la dirección pública (la que usa el celular), y eso
// llega a Render como una visita más, desde afuera.
//
// Es una de las dos capas. La otra es externa (.github/workflows/despertar-servidor.yml)
// y vuelve a levantarlo si alguna vez se cayera: un servidor dormido no puede
// visitarse a sí mismo.

/** Cada cuánto se visita: bien dentro de los 15 minutos de Render. */
const CADA_MS = 4 * 60 * 1000;
const ESPERA_MAX_MS = 30_000;

/** La dirección pública de este servidor, si se sabe: Render la pone sola en
 * RENDER_EXTERNAL_URL; MIS_AMORES_URL_PUBLICA sirve para fijarla a mano. */
export function direccionPublica(): string | null {
  const texto = (process.env.MIS_AMORES_URL_PUBLICA || process.env.RENDER_EXTERNAL_URL || '').trim();
  if (!/^https?:\/\//i.test(texto)) return null;
  return texto.replace(/\/+$/, '');
}

interface Opciones {
  url?: string | null;
  cadaMs?: number;
  registrar?: (mensaje: string) => void;
}

/** Empieza a visitarse. Devuelve la función que lo detiene, o null si no se
 * sabe la dirección pública (entonces no hace nada). */
export function iniciarDespertador(opciones: Opciones = {}): (() => void) | null {
  const base = opciones.url === undefined ? direccionPublica() : opciones.url;
  if (!base) return null;
  const cadaMs = opciones.cadaMs ?? (Number(process.env.MIS_AMORES_DESPERTADOR_MS) || CADA_MS);
  const registrar = opciones.registrar ?? (() => {});

  let fallos = 0;
  let visitando = false;
  const visitar = async () => {
    if (visitando) return;
    visitando = true;
    try {
      const r = await fetch(`${base}/api/sistema/info`, {
        signal: AbortSignal.timeout(ESPERA_MAX_MS),
        headers: { 'User-Agent': 'mis-amores-despertador' },
        cache: 'no-store',
      });
      await r.arrayBuffer();
      if (!r.ok) throw new Error(`respondió ${r.status}`);
      fallos = 0;
    } catch (err) {
      fallos += 1;
      // Sólo se anota la primera vez y de a ratos: no tiene que llenar el log.
      if (fallos === 1 || fallos % 15 === 0) {
        registrar(`No pudo visitarse por su dirección pública (${base}): ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      visitando = false;
    }
  };

  const temporizador = setInterval(() => void visitar(), cadaMs);
  // El proceso se mantiene vivo por el servidor, no por este reloj.
  temporizador.unref();
  return () => clearInterval(temporizador);
}
