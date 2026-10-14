"use strict";
// Reloj para ordenar los cambios que hacen las distintas PCs.
//
// No se puede confiar en que la hora de dos PCs sea exactamente la misma (una
// puede estar unos segundos o minutos corrida), así que cada cambio se marca
// con un "reloj híbrido": la hora de la PC, pero que nunca retrocede y que
// siempre queda por encima de cualquier marca que ya se haya visto de otra PC.
// Así, si alguien edita algo DESPUÉS de haber recibido un cambio ajeno, su
// edición queda sí o sí con una marca mayor, aunque su reloj vaya atrasado.
//
// La marca es un texto que se ordena bien comparándolo como texto:
//   "<ms con 15 cifras>-<contador en hex de 4 cifras>-<id de la PC>"
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reloj = exports.MARCA_COPIA = void 0;
exports.formatearMarca = formatearMarca;
exports.marcaBase = marcaBase;
exports.milisDeMarca = milisDeMarca;
const ANCHO_MS = 15;
const ANCHO_CONTADOR = 4;
// Una PC con la fecha mal puesta (aunque sea años adelantada) deja marcas
// "del futuro". Si el reloj de las demás no las siguiera, sus ediciones
// nuevas quedarían por debajo y se rechazarían sin avisar: por eso se las
// sigue. Sólo se descarta lo que es evidentemente basura (más allá del 2100).
const LIMITE_MS = 4102444800000;
function formatearMarca(ms, contador, nodo) {
    return `${String(ms).padStart(ANCHO_MS, '0')}-${contador.toString(16).padStart(ANCHO_CONTADOR, '0')}-${nodo}`;
}
/** Marca de lo que se cargó con la base de siempre, antes de que existiera la
 * sincronización: cualquier edición real la supera. */
function marcaBase(nodo) {
    return formatearMarca(1, 0, nodo);
}
/** Marca de lo que vino de una copia vieja: pierde contra todo, incluso
 * contra la base de la PC que tiene los datos de verdad. */
exports.MARCA_COPIA = formatearMarca(0, 0, '');
function milisDeMarca(marca) {
    const ms = Number(marca.slice(0, ANCHO_MS));
    return Number.isFinite(ms) ? ms : 0;
}
function partesDeMarca(marca) {
    const contador = parseInt(marca.slice(ANCHO_MS + 1, ANCHO_MS + 1 + ANCHO_CONTADOR), 16);
    return { ms: milisDeMarca(marca), contador: Number.isFinite(contador) ? contador : 0 };
}
class Reloj {
    constructor(nodo, ahora = Date.now) {
        this.nodo = nodo;
        this.ahora = ahora;
        this.ms = 0;
        this.contador = 0;
    }
    /** La marca para algo que pasa ahora en esta PC. */
    nueva() {
        const t = this.ahora();
        if (t > this.ms) {
            this.ms = t;
            this.contador = 0;
        }
        else {
            this.contador += 1;
        }
        return formatearMarca(this.ms, this.contador, this.nodo);
    }
    /** Avisa que se vio una marca de otra PC: las próximas van a quedar por encima. */
    ver(marca) {
        if (!marca)
            return;
        const { ms, contador } = partesDeMarca(marca);
        if (ms > LIMITE_MS)
            return;
        if (ms > this.ms) {
            this.ms = ms;
            this.contador = contador;
        }
        else if (ms === this.ms && contador > this.contador) {
            this.contador = contador;
        }
    }
}
exports.Reloj = Reloj;
