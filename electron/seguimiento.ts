// Los seguimientos de una charla: "¿cuánto vendí hoy?" … "¿y ayer?" … "¿y en efectivo?".
// Una pregunta que no dice de qué habla se completa con lo que se venía hablando: se reescribe como una pregunta entera
// ("¿cuánto vendí ayer?") y recién ahí se contesta. Son funciones puras (se prueban sin base de datos).
import { METODOS, METODOS_GLOBAL, RE_DICE_VENTAS, tieneTema } from './lenguaje';
import { leerPeriodos } from './periodos';

// Las formas de preguntar por UN producto o UN cliente: el segundo grupo es el nombre. (Las usa también el asistente.)
export const RE_PRODUCTO = /(?:precio de|cuanto cuesta|cuanto sale|cuanto vale|a cuanto esta|stock de|hay stock de|cuanto tengo de)\s+(.+?)$/;
export const RE_DEUDA_DE = /(?:cuanto.*debe|cuanto.*deuda tiene|deuda de|saldo de|cuenta de|debe)\s+([a-z ]+?)$/;

// Una pregunta con tantas palabras ya no es un "¿y ayer?": tiene su propio sentido.
const MAX_PALABRAS_SEGUIMIENTO = 8;

/** Reescribe `pregunta` (ya normalizada) como una pregunta entera usando `previa`, la anterior ya completa; null si no es un seguimiento. */
function reescribir(pregunta: string, previa: string | null, ahora: Date): string | null {
  if (!previa) return null;
  const palabras = pregunta.split(' ').filter(Boolean);
  if (palabras.length === 0 || palabras.length > MAX_PALABRAS_SEGUIMIENTO || tieneTema(pregunta)) return null;

  // 1) Cambia el "cuándo": "¿y ayer?", "¿y la semana pasada?", "¿y el lunes?"
  const periodos = leerPeriodos(pregunta, ahora);
  if (periodos.length > 0) {
    const nuevo = periodos[0].texto;
    const deAntes = leerPeriodos(previa, ahora)[0];
    return deAntes ? previa.replace(deAntes.texto, nuevo) : `${previa} ${nuevo}`;
  }

  // 2) Cambia la forma de pago: "¿y en efectivo?", "¿y con tarjeta?"
  const metodo = pregunta.match(METODOS)?.[1];
  if (metodo && RE_DICE_VENTAS.test(previa)) {
    const sinMetodo = previa.replace(METODOS_GLOBAL, ' ').replace(/\s+/g, ' ').trim();
    return `${sinMetodo} en ${metodo}`;
  }

  // 3) Cambia de qué producto o de qué cliente se habla: "¿y la fanta?", "¿y Marta?"
  const sujeto = pregunta.replace(/^y\s+/, '').replace(/^(?:de|del|el|la|los|las|con|para)\s+/, '').trim();
  if (!sujeto) return null;
  const producto = previa.match(RE_PRODUCTO);
  if (producto) return previa.replace(producto[1], sujeto);
  const cliente = previa.match(RE_DEUDA_DE);
  if (cliente) return previa.replace(cliente[1], sujeto);
  return null;
}

/**
 * Si `pregunta` es un seguimiento de lo que se venía hablando, la pregunta completa; si no, null.
 * `anteriores`: las preguntas anteriores de la persona, normalizadas, de la más vieja a la más nueva.
 */
export function resolverSeguimiento(pregunta: string, anteriores: string[], ahora: Date = new Date()): string | null {
  // Se recorre lo anterior para tener la última pregunta ya completa (un "¿y anteayer?" después de un "¿y ayer?").
  let previa: string | null = null;
  for (const a of anteriores) previa = reescribir(a, previa, ahora) ?? a;
  return reescribir(pregunta, previa, ahora);
}
