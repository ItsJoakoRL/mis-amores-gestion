"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compararVersiones = compararVersiones;
exports.esperaParaPreguntarVersion = esperaParaPreguntarVersion;
/** Compara dos versiones de la app ("0.8.10" contra "0.8.9"): negativo si `a` es
 * más vieja que `b`, 0 si son iguales, positivo si `a` es más nueva. Compara
 * número por número (0.8.10 es MÁS nueva que 0.8.9, aunque como texto no lo sea). */
function compararVersiones(a, b) {
    const partes = (v) => v.split('.').map((n) => parseInt(n, 10) || 0);
    const x = partes(a);
    const y = partes(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const diferencia = (x[i] ?? 0) - (y[i] ?? 0);
        if (diferencia !== 0)
            return diferencia;
    }
    return 0;
}
/** Cada cuánto (en milisegundos) preguntarle a otra PC qué versión de la app tiene.
 *
 * - `forzar`: acaba de volver a conectarse (por ejemplo, se reinició para
 *   actualizarse): se pregunta ya, porque lo que se sabía puede estar viejo.
 * - Si no se sabe, o es distinta de la propia, seguido (puede estar por
 *   actualizarse y no conviene seguir diciendo que está desactualizada).
 * - Si es la misma, de vez en cuando. */
function esperaParaPreguntarVersion(sabida, propia, forzar) {
    if (forzar)
        return 0;
    if (!sabida)
        return 60000;
    return sabida === propia ? 5 * 60000 : 30000;
}
