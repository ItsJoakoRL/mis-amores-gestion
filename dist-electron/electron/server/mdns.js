"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOMBRE_HOST = void 0;
exports.iniciarMdns = iniciarMdns;
// Hace que "misamores.local" resuelva a esta PC dentro de la red del local,
// sin depender de internet ni de comprar un dominio. Es el mismo mecanismo
// (mDNS / Bonjour) que usan las impresoras de red o un Chromecast para que
// los aparatos se encuentren por nombre en vez de por IP — funciona en
// celulares Android e iPhone sin instalar nada de su lado.
const multicast_dns_1 = __importDefault(require("multicast-dns"));
exports.NOMBRE_HOST = 'misamores.local';
function iniciarMdns(ip) {
    const respondedor = (0, multicast_dns_1.default)();
    respondedor.on('query', (consulta) => {
        const preguntaPorNuestroNombre = consulta.questions.some((q) => q.name.toLowerCase() === exports.NOMBRE_HOST && q.type === 'A');
        if (!preguntaPorNuestroNombre)
            return;
        respondedor.respond({
            answers: [{ name: exports.NOMBRE_HOST, type: 'A', ttl: 120, data: ip }],
        });
    });
    respondedor.on('error', () => {
        // Si falla (por ejemplo, algo ya está usando el puerto de mDNS), no pasa
        // nada grave: el acceso desde el celular sigue andando igual por IP.
    });
    return () => respondedor.destroy();
}
