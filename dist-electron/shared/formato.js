"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatearMoneda = formatearMoneda;
exports.formatearMonedaConCentavos = formatearMonedaConCentavos;
exports.formatearCantidad = formatearCantidad;
exports.redondearCantidad = redondearCantidad;
exports.pareceCodigoDeBarras = pareceCodigoDeBarras;
exports.limpiarDecimal = limpiarDecimal;
exports.numeroDeDecimal = numeroDeDecimal;
exports.parsearMonto = parsearMonto;
exports.nombreArchivoEstadoCuenta = nombreArchivoEstadoCuenta;
// Formato de moneda único para toda la app (pantallas y asistente) — antes
// cada archivo tenía su propio Intl.NumberFormat copiado, y se habían
// desincronizado: el asistente mostraba decimales que el resto de la app no.
const formatoMoneda = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
});
function formatearMoneda(monto) {
    return formatoMoneda.format(monto);
}
// Igual, pero sin redondear los centavos — para confirmar un monto recién
// escrito a mano (ej. "Se registra un pago de $ 1.500,50"), donde redondear
// escondería justo lo que hay que revisar.
const formatoMonedaConCentavos = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
});
function formatearMonedaConCentavos(monto) {
    return formatoMonedaConCentavos.format(monto);
}
// Cantidades (stock, kilos vendidos) con hasta 3 decimales y como se
// escriben acá ("2,5" en vez de "2.5"). Además esconde los restos de las
// cuentas con decimales de la computadora (0,30000000000000004).
const formatoCantidad = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });
function formatearCantidad(cantidad) {
    // "cantidad || 0" convierte el -0 en 0 (Intl lo mostraría como "-0").
    return formatoCantidad.format(cantidad || 0);
}
// Redondea a 3 decimales (gramos, si es por kilo) — sumar y restar decimales
// en binario deja restos como 0,7000000000000001 si no se redondea.
function redondearCantidad(cantidad) {
    return Math.round(cantidad * 1000) / 1000 || 0;
}
// ¿Lo que se escaneó o escribió parece un código de barras (EAN-8, UPC-A,
// EAN-13, ITF-14)? Sólo números, de 7 a 14. Un texto corto o con letras es una
// búsqueda por nombre: con un código en cambio no se adivina el producto por un
// parecido (un pedazo del número podría ser de otro producto).
function pareceCodigoDeBarras(texto) {
    return /^\d{7,14}$/.test(String(texto ?? '').trim());
}
// Para cuadros donde se escribe una cantidad con decimales (ej. kilos): deja
// usar coma ("2,5", como se escribe acá) o punto, pero un solo separador —
// con dos, el número quedaba inválido sin avisar. Devuelve el texto tal como
// se va a ver en el cuadro; numeroDeDecimal() lo pasa a número.
function limpiarDecimal(valor) {
    const limpio = valor.replace(/[^0-9.,]/g, '');
    const separador = limpio.search(/[.,]/);
    if (separador === -1)
        return limpio;
    return limpio.slice(0, separador + 1) + limpio.slice(separador + 1).replace(/[.,]/g, '');
}
function numeroDeDecimal(texto) {
    const numero = Number(texto.replace(',', '.'));
    return Number.isFinite(numero) ? numero : 0;
}
// Interpreta un monto en pesos escrito a mano como se escribe acá: "1500",
// "1500,50", "1.500" o "1.500,50" (punto de miles, coma de decimales).
// Antes el cuadro de pagos borraba la coma, y "1500,50" quedaba como 150050.
// Un punto solo, seguido de exactamente 3 cifras, se toma como de miles
// ("1.500" = 1500); si no, como decimal ("1500.5"). Devuelve NaN si el texto
// no es un número.
function parsearMonto(texto) {
    let t = texto.replace(/[\s$]/g, '');
    if (!t)
        return NaN;
    const ultimaComa = t.lastIndexOf(',');
    const ultimoPunto = t.lastIndexOf('.');
    if (ultimaComa !== -1 && ultimoPunto !== -1) {
        // Están los dos: el que aparece último es el de los decimales.
        const [miles, decimal] = ultimaComa > ultimoPunto ? ['.', ','] : [',', '.'];
        t = t.split(miles).join('').replace(decimal, '.');
    }
    else if (ultimaComa !== -1) {
        // Sólo comas: una sola es decimal ("1500,50"); varias, de miles.
        t = t.indexOf(',') !== ultimaComa ? t.replace(/,/g, '') : t.replace(',', '.');
    }
    else if (ultimoPunto !== -1) {
        const variosPuntos = t.indexOf('.') !== ultimoPunto;
        const deMiles = t.length - ultimoPunto - 1 === 3 && !t.startsWith('0.');
        if (variosPuntos || deMiles)
            t = t.replace(/\./g, '');
    }
    if (!/^(\d+\.?\d*|\.\d+)$/.test(t))
        return NaN;
    return Number(t);
}
// El nombre con que se guarda el estado de cuenta de un cliente: sin tildes ni
// símbolos (los sistemas de archivos y los navegadores lo agradecen).
function nombreArchivoEstadoCuenta(nombre) {
    const base = nombre
        .normalize('NFD')
        .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g'), '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `Estado-de-cuenta-${base || 'cliente'}.pdf`;
}
