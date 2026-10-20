"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPE_MAXIMO_USD = exports.TOPE_MINIMO_USD = exports.TOPE_POR_DEFECTO_USD = void 0;
exports.costoEnDolares = costoEnDolares;
exports.topeMensualUsd = topeMensualUsd;
exports.gastoDelMes = gastoDelMes;
exports.topeAlcanzado = topeAlcanzado;
exports.registrarUso = registrarUso;
exports.fijarTopeMensualUsd = fijarTopeMensualUsd;
// Cuánto gasta el asistente con IA, y el tope mensual que no puede pasar.
//
// La IA se paga por uso (tokens), no por pregunta: una pregunta con muchas consultas sale mucho más
// que una simple. Por eso el tope se calcula en dólares, con los tokens que la propia API informa en
// cada respuesta (los de pensar también cuentan) y la tabla de precios de abajo. Es una cuenta
// APROXIMADA: lo que vale es lo que dice platform.claude.com (donde también conviene poner un tope).
//
// Cuando el gasto del mes llega al tope, el asistente deja de usar la IA y contesta el simple hasta el
// mes que viene (o hasta que la administradora suba el tope en Configuración).
//
// Se guarda en un archivito de la carpeta de datos de esta PC (`uso-ia.json`), junto con el tope. En el
// servidor de internet el disco no sobrevive a un reinicio: ahí la cuenta vive en memoria (y se reinicia
// si el servidor se reinicia) y el tope sale de la variable MIS_AMORES_TOPE_IA_USD.
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const nube_1 = require("./nube");
const fechaLocal_1 = require("./fechaLocal");
exports.TOPE_POR_DEFECTO_USD = 10;
exports.TOPE_MINIMO_USD = 1;
exports.TOPE_MAXIMO_USD = 1000;
// Dólares por millón de tokens (entrada, salida), precios de octubre 2026. El orden importa: el primero que coincide gana.
const PRECIOS = [
    { patron: /haiku-5/, entrada: 0.1, salida: 0.5 },
    { patron: /haiku/, entrada: 1, salida: 5 },
    { patron: /sonnet-5/, entrada: 2, salida: 10 },
    { patron: /sonnet/, entrada: 3, salida: 15 },
    { patron: /opus-5-5/, entrada: 4, salida: 20 },
    { patron: /opus/, entrada: 5, salida: 25 },
    { patron: /fable|mythos/, entrada: 10, salida: 50 },
];
// Un modelo que no se conoce se calcula como el más caro: mejor frenar de más que gastar de más.
const PRECIO_DESCONOCIDO = { entrada: 10, salida: 50 };
function costoEnDolares(modelo, tokensEntrada, tokensSalida) {
    const p = PRECIOS.find((x) => x.patron.test(modelo)) ?? PRECIO_DESCONOCIDO;
    return (tokensEntrada * p.entrada + tokensSalida * p.salida) / 1000000;
}
let estado;
function archivo() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'uso-ia.json');
}
const mesActual = () => (0, fechaLocal_1.ymdLocal)().slice(0, 7);
function numeroValido(valor) {
    return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}
function leerArchivo() {
    const vacio = { topeUsd: null, mes: mesActual(), costoUsd: 0, preguntas: 0 };
    if ((0, nube_1.esModoNube)())
        return vacio;
    try {
        const l = JSON.parse(fs_1.default.readFileSync(archivo(), 'utf-8'));
        return {
            topeUsd: numeroValido(l.topeUsd) && l.topeUsd >= exports.TOPE_MINIMO_USD && l.topeUsd <= exports.TOPE_MAXIMO_USD ? l.topeUsd : null,
            mes: typeof l.mes === 'string' && /^\d{4}-\d{2}$/.test(l.mes) ? l.mes : vacio.mes,
            costoUsd: numeroValido(l.costoUsd) ? l.costoUsd : 0,
            preguntas: numeroValido(l.preguntas) ? Math.floor(l.preguntas) : 0,
        };
    }
    catch {
        // Sin archivo (todavía no se usó) o roto (se cortó la luz): se arranca de cero.
        return vacio;
    }
}
function guardar() {
    if ((0, nube_1.esModoNube)() || !estado)
        return;
    try {
        const destino = archivo();
        fs_1.default.mkdirSync(path_1.default.dirname(destino), { recursive: true });
        // Se escribe aparte y recién al final reemplaza al archivo: si se corta la luz a la mitad, no queda roto.
        const temporal = `${destino}.tmp`;
        fs_1.default.writeFileSync(temporal, JSON.stringify(estado));
        fs_1.default.renameSync(temporal, destino);
    }
    catch {
        // Si no se pudo escribir, la cuenta sigue en memoria hasta que se cierre la app.
    }
}
// El estado de ahora; si cambió el mes, la cuenta arranca de cero.
function actual() {
    if (!estado)
        estado = leerArchivo();
    const hoy = mesActual();
    if (estado.mes !== hoy) {
        estado = { ...estado, mes: hoy, costoUsd: 0, preguntas: 0 };
        guardar();
    }
    return estado;
}
/** El tope de gasto por mes: el que se puso en Configuración, o el de la variable del sistema, o el de siempre. */
function topeMensualUsd() {
    const propio = actual().topeUsd;
    if (propio !== null)
        return propio;
    const entorno = Number((process.env.MIS_AMORES_TOPE_IA_USD ?? '').trim().replace(',', '.'));
    return Number.isFinite(entorno) && entorno >= exports.TOPE_MINIMO_USD && entorno <= exports.TOPE_MAXIMO_USD ? entorno : exports.TOPE_POR_DEFECTO_USD;
}
function gastoDelMes() {
    const e = actual();
    return { mes: e.mes, costoUsd: Math.round(e.costoUsd * 10000) / 10000, preguntas: e.preguntas };
}
/** true si ya se gastó todo lo que el tope permite este mes. */
function topeAlcanzado() {
    return actual().costoUsd >= topeMensualUsd();
}
/** Suma lo que costó una consulta a la IA (con los tokens que informó la API). `esPregunta`: cuenta como pregunta del chat. */
function registrarUso(modelo, tokensEntrada, tokensSalida, esPregunta) {
    const e = actual();
    e.costoUsd += costoEnDolares(modelo, tokensEntrada, tokensSalida);
    if (esPregunta)
        e.preguntas += 1;
    guardar();
}
/** Cambia el tope mensual (sólo desde Configuración). */
function fijarTopeMensualUsd(valor) {
    if ((0, nube_1.esModoNube)()) {
        throw new Error('En el servidor de internet el tope se pone en Render (variable MIS_AMORES_TOPE_IA_USD), no desde acá.');
    }
    const n = typeof valor === 'number' ? valor : Number(String(valor ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < exports.TOPE_MINIMO_USD || n > exports.TOPE_MAXIMO_USD) {
        throw new Error(`El tope tiene que ser un número de dólares entre ${exports.TOPE_MINIMO_USD} y ${exports.TOPE_MAXIMO_USD.toLocaleString('es-AR')}.`);
    }
    actual().topeUsd = Math.round(n * 100) / 100;
    guardar();
}
