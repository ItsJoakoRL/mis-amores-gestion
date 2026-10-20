"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leerClaveIa = leerClaveIa;
exports.pistaDeClave = pistaDeClave;
exports.guardarClaveIa = guardarClaveIa;
// La clave de la IA del asistente (la cuenta de Anthropic que paga las preguntas).
//
// Se guarda en un archivito propio de la carpeta de datos de esta PC, aparte de la
// configuración de la red de PCs (configuracion.ts): así no se pisan entre sí. Cada
// PC tiene la suya. En el servidor de internet (Render) la clave sale de la variable
// MIS_AMORES_CLAVE_IA, porque ahí el disco no sobrevive a un reinicio.
//
// La clave nunca viaja a la pantalla: sólo se muestra una "pista" para reconocerla.
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const nube_1 = require("./nube");
function archivo() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'clave-ia.json');
}
// undefined: todavía no se leyó el archivo.
let delArchivo;
function leerArchivo() {
    try {
        const leido = JSON.parse(fs_1.default.readFileSync(archivo(), 'utf-8'));
        return typeof leido.clave === 'string' && leido.clave.trim() ? leido.clave.trim() : null;
    }
    catch {
        return null;
    }
}
function delEntorno() {
    return (process.env.MIS_AMORES_CLAVE_IA || process.env.ANTHROPIC_API_KEY || '').trim() || null;
}
/** La clave que hay que usar ahora, o null si no hay ninguna (entonces contesta el asistente simple). */
function leerClaveIa() {
    if (delArchivo === undefined)
        delArchivo = leerArchivo();
    if (delArchivo)
        return { clave: delArchivo, origen: 'archivo' };
    const entorno = delEntorno();
    return entorno ? { clave: entorno, origen: 'entorno' } : null;
}
/** "sk-ant-…a1b2": alcanza para reconocerla sin dejarla a la vista. */
function pistaDeClave(clave) {
    return clave.length <= 12 ? '…' : `${clave.slice(0, 7)}…${clave.slice(-4)}`;
}
/** Guarda la clave cargada en Configuración, o la saca si viene null. */
function guardarClaveIa(clave) {
    if ((0, nube_1.esModoNube)()) {
        throw new Error('En el servidor de internet la clave se carga en Render (variable MIS_AMORES_CLAVE_IA), no desde acá.');
    }
    if (clave === null) {
        try {
            fs_1.default.rmSync(archivo(), { force: true });
        }
        catch {
            throw new Error('No se pudo borrar la clave guardada en esta PC.');
        }
        delArchivo = null;
        return;
    }
    const limpia = typeof clave === 'string' ? clave.trim() : '';
    if (!limpia)
        throw new Error('Pegá la clave en el casillero.');
    // Las claves de Anthropic empiezan con "sk-ant-". Una con espacios o saltos de línea adentro
    // es una copia cortada o mezclada con otro texto: mejor avisar ahora que fallar después.
    if (!/^sk-ant-\S{20,}$/.test(limpia)) {
        throw new Error('Esa clave no parece una clave de Anthropic: empieza con "sk-ant-" y no tiene espacios. Copiala entera desde platform.claude.com.');
    }
    try {
        const destino = archivo();
        fs_1.default.mkdirSync(path_1.default.dirname(destino), { recursive: true });
        // Se escribe aparte y recién al final reemplaza al archivo: si se corta la luz a la mitad, no queda roto.
        const temporal = `${destino}.tmp`;
        fs_1.default.writeFileSync(temporal, JSON.stringify({ clave: limpia }), { mode: 0o600 });
        fs_1.default.renameSync(temporal, destino);
    }
    catch {
        throw new Error('No se pudo guardar la clave en esta PC. Probá de nuevo.');
    }
    delArchivo = limpia;
}
