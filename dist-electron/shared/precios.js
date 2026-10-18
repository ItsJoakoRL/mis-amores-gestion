"use strict";
// El cálculo del cambio masivo de precios. Lo usan la pantalla (para mostrar cómo
// quedaría cada precio antes de aplicarlo) y las pruebas, así lo que se ve en la
// vista previa es exactamente lo que se guarda.
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDONDEOS = void 0;
exports.calcularPrecioNuevo = calcularPrecioNuevo;
exports.porcentajeDeCambio = porcentajeDeCambio;
exports.nuevoIdLote = nuevoIdLote;
exports.REDONDEOS = [0, 1, 5, 10, 50, 100];
/** El precio nuevo: nunca negativo, redondeado al múltiplo más cercano (si se pidió) y con centavos. */
function calcularPrecioNuevo(precio, op) {
    if (!Number.isFinite(precio) || !Number.isFinite(op.valor))
        return precio;
    let nuevo = op.tipo === 'porcentaje' ? precio * (1 + op.valor / 100) : precio + op.valor;
    if (nuevo < 0)
        nuevo = 0;
    if (op.redondeo > 0)
        nuevo = Math.round(nuevo / op.redondeo) * op.redondeo;
    return Math.round(nuevo * 100) / 100;
}
/** De cuánto fue el cambio, en por ciento (con un decimal). */
function porcentajeDeCambio(anterior, nuevo) {
    if (!(anterior > 0))
        return 0;
    return Math.round(((nuevo - anterior) / anterior) * 1000) / 10;
}
/** Un identificador para agrupar los cambios de un mismo lote (alcanza con letras y números). */
function nuevoIdLote() {
    const azar = new Uint8Array(12);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(azar);
    }
    else {
        for (let i = 0; i < azar.length; i++)
            azar[i] = Math.floor(Math.random() * 256);
    }
    return `l${Date.now().toString(36)}${Array.from(azar, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
