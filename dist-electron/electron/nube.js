"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claveRedNube = claveRedNube;
exports.esModoNube = esModoNube;
exports.idPcNube = idPcNube;
exports.esDireccionRemota = esDireccionRemota;
exports.urlBase = urlBase;
exports.normalizarUrlNube = normalizarUrlNube;
// Modo "nube": la app corriendo como servidor en un servicio de internet como
// Render (ver SERVIDOR_RENDER.md), en vez de en una PC del negocio o en una
// máquina propia (ver SERVIDOR.md).
//
// Qué cambia respecto de un servidor común:
//   - El disco no guarda nada de un reinicio al otro: quién es este servidor y
//     la clave de la red salen de variables de entorno. Todo lo demás (datos,
//     cursores de sincronización, sesiones) vive en la base (MongoDB Atlas).
//   - No puede llegar a las PCs del negocio (están detrás de su router): son
//     ellas las que lo llaman y le empujan sus cambios (ver sync/motor.ts).
//   - Está abierto a internet: sin usuario "admin" de fábrica, con límite de
//     intentos al iniciar sesión y sin las rutas que sólo sirven en la red del
//     local (ver server/httpServer.ts).
const crypto_1 = __importDefault(require("crypto"));
/** La clave de la red del negocio (es la misma que tienen las PCs). */
function claveRedNube() {
    return (process.env.MIS_AMORES_CLAVE_RED ?? '').trim();
}
function esModoNube() {
    return process.env.MIS_AMORES_MODO_SERVIDOR === '1' && claveRedNube().length > 0;
}
/** El identificador de este servidor en la red. Tiene que ser siempre el mismo
 * entre reinicios aunque el disco se borre: sale de la clave (o de
 * MIS_AMORES_ID_PC, si se quiere fijar a mano). */
function idPcNube() {
    const fijo = (process.env.MIS_AMORES_ID_PC ?? '').trim();
    if (fijo)
        return fijo;
    const h = crypto_1.default.createHash('sha256').update(`mis-amores-servidor-nube:${claveRedNube()}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** ¿Esta dirección de otra PC es una dirección de internet completa
 * ("https://mis-amores.onrender.com") y no una de la red del local
 * ("192.168.1.50:4000")? A esas no se las puede llamar desde afuera: son ellas
 * las que reciben lo que esta PC les empuja. */
function esDireccionRemota(direccion) {
    return /^https?:\/\//i.test(direccion.trim());
}
/** La dirección lista para armar un pedido: con "http://" si es de la red del
 * local, o tal cual (sin barra al final) si ya trae el protocolo. */
function urlBase(direccion) {
    const d = direccion.trim();
    return esDireccionRemota(d) ? d.replace(/\/+$/, '') : `http://${d}`;
}
/** Lo que alguien escribe como dirección del servidor de internet, normalizado
 * ("mis-amores.onrender.com" → "https://mis-amores.onrender.com"). */
function normalizarUrlNube(texto) {
    let t = String(texto ?? '').trim();
    if (!t)
        throw new Error('Escribí la dirección del servidor de internet.');
    if (!/^https?:\/\//i.test(t))
        t = `https://${t}`;
    let u;
    try {
        u = new URL(t);
    }
    catch {
        throw new Error('Esa dirección no parece válida. Ejemplo: https://mis-amores.onrender.com');
    }
    return `${u.protocol}//${u.host}`;
}
