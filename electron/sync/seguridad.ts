// Cómo se reconocen entre sí las PCs de la red.
//
// Todas comparten una clave, pero la clave NUNCA viaja por la red: cada pedido
// lleva una firma (HMAC) calculada con ella sobre algo que cambia siempre (un
// número al azar y la hora) y sobre qué se está pidiendo. Quien no tiene la
// clave no puede firmar, y quien escucha la red no puede sacar la clave de las
// firmas. La respuesta también lleva una prueba, para que una PC no le crea a
// cualquier aparato que conteste en la dirección donde esperaba a otra.
import crypto from 'crypto';

// Dos PCs pueden tener la hora corrida (a veces por horas): la tolerancia es
// grande, y lo que corta las repeticiones es el número al azar de cada pedido.
const VENTANA_MS = 24 * 60 * 60 * 1000;
const MAX_NONCES = 5000;

function firma(clave: string, texto: string): string {
  return crypto.createHmac('sha256', clave).update(texto).digest('hex');
}

function igualesSeguros(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export interface PedidoFirmado {
  cabeceras: Record<string, string>;
  nonce: string;
}

// Un pedido sin contenido (un GET) se firma como siempre; uno con contenido
// agrega la huella del contenido al final.
function textoAFirmar(ts: string, nonce: string, metodo: string, ruta: string, cuerpo?: string): string {
  const base = `${ts}.${nonce}.${metodo.toUpperCase()}.${ruta}`;
  if (cuerpo === undefined) return base;
  return `${base}.${crypto.createHash('sha256').update(cuerpo).digest('hex')}`;
}

/** Las cabeceras que hay que mandar para pedir `metodo` `ruta` (ruta + query).
 * `cuerpo`: el texto que se manda, si es un POST (queda cubierto por la firma).
 * `ahora`: la hora a firmar (la de esta PC, corregida por la diferencia de reloj
 * con la otra; ver pedidoFirmado.ts). */
export function firmarPedido(
  clave: string,
  metodo: string,
  ruta: string,
  cuerpo?: string,
  ahora: number = Date.now()
): PedidoFirmado {
  const ts = String(Math.round(ahora));
  const nonce = crypto.randomBytes(16).toString('hex');
  return {
    nonce,
    cabeceras: {
      'X-Red-Ts': ts,
      'X-Red-Nonce': nonce,
      'X-Red-Firma': firma(clave, textoAFirmar(ts, nonce, metodo, ruta, cuerpo)),
    },
  };
}

/** La prueba que acompaña a la respuesta: sólo la puede dar quien tiene la clave. */
export function pruebaDeRespuesta(clave: string, nonce: string): string {
  return firma(clave, `respuesta.${nonce}`);
}

export function respuestaEsDeLaRed(clave: string, nonce: string, prueba: string | null): boolean {
  return !!prueba && igualesSeguros(prueba, pruebaDeRespuesta(clave, nonce));
}

/** Cuando un pedido se rechaza: ¿es porque la clave no coincide, o porque la
 * hora de la otra PC está muy corrida? (La firma es válida con esa hora: o sea,
 * tiene la clave bien, sólo que el reloj no coincide.) */
export function motivoDeRechazo(
  clave: string,
  cabeceras: Record<string, string | string[] | undefined>,
  metodo: string,
  ruta: string,
  cuerpo?: string
): 'hora' | 'clave' {
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const ts = un(cabeceras['x-red-ts']);
  const nonce = un(cabeceras['x-red-nonce']);
  const recibida = un(cabeceras['x-red-firma']);
  if (!clave || !ts || !nonce || !recibida) return 'clave';
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{16,64}$/.test(nonce)) return 'clave';
  if (!igualesSeguros(recibida, firma(clave, textoAFirmar(ts, nonce, metodo, ruta, cuerpo)))) return 'clave';
  return Math.abs(Date.now() - Number(ts)) > VENTANA_MS ? 'hora' : 'clave';
}

// Los pedidos ya vistos (para que uno capturado no se pueda repetir).
const vistos = new Map<string, number>();

/** ¿Este pedido viene de una PC que tiene la clave? Devuelve el nonce si sí.
 * `cuerpo`: el texto del pedido, si lo lleva (un POST): la firma también lo
 * cubre, así nadie puede cambiarle el contenido por el camino. */
export function verificarPedido(
  clave: string,
  cabeceras: Record<string, string | string[] | undefined>,
  metodo: string,
  ruta: string,
  cuerpo?: string
): string | null {
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const ts = un(cabeceras['x-red-ts']);
  const nonce = un(cabeceras['x-red-nonce']);
  const recibida = un(cabeceras['x-red-firma']);
  if (!clave || !ts || !nonce || !recibida) return null;
  if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{16,64}$/.test(nonce)) return null;
  const ahora = Date.now();
  if (Math.abs(ahora - Number(ts)) > VENTANA_MS) return null;
  if (!igualesSeguros(recibida, firma(clave, textoAFirmar(ts, nonce, metodo, ruta, cuerpo)))) return null;
  if (vistos.has(nonce)) return null;
  vistos.set(nonce, ahora);
  if (vistos.size > MAX_NONCES) {
    // Se sueltan los más viejos (el Map conserva el orden de inserción).
    for (const k of vistos.keys()) {
      vistos.delete(k);
      if (vistos.size <= MAX_NONCES * 0.8) break;
    }
  }
  return nonce;
}
