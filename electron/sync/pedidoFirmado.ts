// Un pedido firmado a otra PC (o al servidor de internet) que se arregla solo
// cuando el reloj de esta PC está corrido.
//
// Las PCs se reconocen con una firma que lleva la hora (ver seguridad.ts), y la
// otra PC sólo acepta horas que difieran poco de la suya. Una compu con la
// pila del reloj gastada, o con la fecha mal puesta, quedaba "afuera de la
// red" aunque tuviera la clave bien. Ahora, si la otra PC rechaza el pedido y
// le dice qué hora tiene (cabecera X-Red-Hora), este pedido se repite con la
// hora corregida, y se recuerda la diferencia para los pedidos siguientes.
import { firmarPedido } from './seguridad';

// La diferencia de reloj con cada servidor ("origen" = protocolo + dirección).
const desfases = new Map<string, number>();

// Diferencias más chicas que esto no se corrigen (son la demora del pedido).
const UMBRAL_MS = 5_000;

export interface OpcionesPedidoFirmado {
  clave: string;
  url: string;
  /** Si se pasa, el pedido es un POST con ese texto (firmado junto con él). */
  cuerpo?: string;
  esperaMs: number;
  senal?: AbortSignal;
  /** La hora de esta PC (para probar un reloj corrido). */
  ahora?: () => number;
}

export interface RespuestaFirmada {
  respuesta: Response;
  texto: string;
  /** El número al azar con que se firmó el pedido que dio esta respuesta. */
  nonce: string;
}

export async function pedirFirmado(o: OpcionesPedidoFirmado): Promise<RespuestaFirmada> {
  const ahora = o.ahora ?? Date.now;
  const u = new URL(o.url);
  const metodo = o.cuerpo === undefined ? 'GET' : 'POST';

  for (let intento = 0; ; intento++) {
    const desfase = desfases.get(u.origin) ?? 0;
    const firmado = firmarPedido(o.clave, metodo, u.pathname + u.search, o.cuerpo, ahora() + desfase);
    // Si falla la conexión, el error sube tal cual a quien llama.
    const respuesta = await fetch(o.url, {
      method: metodo,
      headers:
        o.cuerpo === undefined ? firmado.cabeceras : { ...firmado.cabeceras, 'Content-Type': 'text/plain; charset=utf-8' },
      body: o.cuerpo,
      signal: o.senal ? AbortSignal.any([o.senal, AbortSignal.timeout(o.esperaMs)]) : AbortSignal.timeout(o.esperaMs),
    });
    const texto = await respuesta.text();

    if (respuesta.status === 401 && intento === 0) {
      const horaOtra = Number(respuesta.headers.get('x-red-hora'));
      if (Number.isFinite(horaOtra) && horaOtra > 0) {
        const diferencia = horaOtra - ahora();
        // Sólo se reintenta si hay una diferencia de reloj que explique el rechazo.
        if (Math.abs(diferencia - desfase) > UMBRAL_MS) {
          desfases.set(u.origin, diferencia);
          continue;
        }
      }
    }
    return { respuesta, texto, nonce: firmado.nonce };
  }
}

/** Sólo para las pruebas. */
export function olvidarDesfases(): void {
  desfases.clear();
}
