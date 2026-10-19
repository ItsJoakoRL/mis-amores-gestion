// Los errores técnicos (del código o de la base de datos) no le sirven a quien usa el programa:
// "Cannot read properties of undefined" o "input must be a 24 character hex string" no dicen qué
// hacer. Acá se reemplazan por una frase que se entienda. Los mensajes que ya están escritos
// para la persona ("No hay stock suficiente...") pasan tal cual.

const NO_ES_UN_ID = /input must be a 24|ObjectId|BSON/i;
const TECNICO =
  /Cannot read propert|Cannot destructure|is not a function|is not iterable|is not defined|MongoServerError|MongoError|MongoNetworkError|TypeError|ReferenceError|RangeError|SyntaxError|E11000|Unexpected token|at .*\.(ts|js):\d+/i;

export function mensajeParaLaPersona(err: unknown): string {
  const mensaje = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error desconocido';
  if (NO_ES_UN_ID.test(mensaje)) return 'No se encontró lo que se pidió: el dato no es válido.';
  if (TECNICO.test(mensaje)) {
    // Queda en el registro del programa para poder revisarlo, pero la persona ve algo claro.
    console.error('[error técnico]', mensaje);
    return 'Faltan datos o no son válidos. Probá de nuevo y, si sigue pasando, avisá.';
  }
  return mensaje;
}
