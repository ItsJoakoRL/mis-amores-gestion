"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cargarSesionesGuardadas = cargarSesionesGuardadas;
exports.crearToken = crearToken;
exports.obtenerSesionPorToken = obtenerSesionPorToken;
exports.eliminarToken = eliminarToken;
exports.invalidarTokensDeUsuario = invalidarTokensDeUsuario;
exports.invalidarTodasLasSesiones = invalidarTodasLasSesiones;
// Sesiones para los clientes que se conectan por HTTP (celulares en la misma
// red WiFi, y la PC "conectada"). A diferencia de la app de escritorio — que
// asume un solo puesto usándose a la vez y guarda la sesión en una sola
// variable (ver electron/session.ts) — acá puede haber varios celulares y
// PCs conectados al mismo tiempo, cada uno con su propio usuario. Por eso
// cada login genera un token random que el cliente guarda y manda en cada pedido.
//
// Las sesiones también se guardan en la base: antes vivían sólo en memoria, y
// cada vez que se reiniciaba la app de la PC (al prenderla, o al instalar una
// actualización) todos los celulares quedaban sin sesión y lo que intentaban
// guardar fallaba con "No hay una sesión iniciada". En la base sólo queda un
// hash del token, nunca el token mismo.
const crypto_1 = __importDefault(require("crypto"));
const database_1 = require("../db/database");
// Una sesión que no se usa en todo este tiempo vence sola (Mongo la borra).
const DIAS_VIGENCIA = 30;
// Para no escribir en la base en cada pedido: la marca de "último uso" se
// actualiza como mucho una vez por día por sesión.
const REFRESCO_USO_MS = 24 * 60 * 60 * 1000;
const sesionesPorHash = new Map();
function hashDe(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function coleccion() {
    return (0, database_1.getDb)().collection('sesiones');
}
function guardarSinEsperar(promesa) {
    // Si la base no responde justo en ese momento, la sesión igual sigue
    // andando en memoria; sólo se perdería si además se reinicia la app.
    promesa.catch(() => { });
}
// Se llama una vez al arrancar, después de conectar con la base.
async function cargarSesionesGuardadas() {
    await coleccion().createIndex({ usadoEn: 1 }, { expireAfterSeconds: DIAS_VIGENCIA * 24 * 60 * 60 });
    const limite = Date.now() - DIAS_VIGENCIA * 24 * 60 * 60 * 1000;
    for (const doc of await coleccion().find().toArray()) {
        const usadoEn = doc.usadoEn instanceof Date ? doc.usadoEn.getTime() : 0;
        if (usadoEn > limite && doc.sesion?.id)
            sesionesPorHash.set(doc._id, { sesion: doc.sesion, usadoEn });
    }
}
function crearToken(sesion) {
    const token = crypto_1.default.randomBytes(24).toString('hex');
    const hash = hashDe(token);
    const ahora = new Date();
    sesionesPorHash.set(hash, { sesion, usadoEn: ahora.getTime() });
    guardarSinEsperar(coleccion().insertOne({ _id: hash, sesion, usadoEn: ahora }));
    return token;
}
function obtenerSesionPorToken(token) {
    if (!token)
        return null;
    const hash = hashDe(token);
    const guardada = sesionesPorHash.get(hash);
    if (!guardada)
        return null;
    const ahora = Date.now();
    if (ahora - guardada.usadoEn > REFRESCO_USO_MS) {
        guardada.usadoEn = ahora;
        guardarSinEsperar(coleccion().updateOne({ _id: hash }, { $set: { usadoEn: new Date(ahora) } }));
    }
    return guardada.sesion;
}
function eliminarToken(token) {
    if (!token)
        return;
    const hash = hashDe(token);
    sesionesPorHash.delete(hash);
    guardarSinEsperar(coleccion().deleteOne({ _id: hash }));
}
// Se llama desde electron/repositories/usuarios.ts cuando a alguien lo
// desactivan, le cambian el rol o lo borran — para que cualquier sesión de
// celular que ya tuviera abierta deje de funcionar de una, en vez de seguir
// con los datos viejos.
function invalidarTokensDeUsuario(usuarioId) {
    for (const [hash, guardada] of sesionesPorHash) {
        if (guardada.sesion.id === usuarioId)
            sesionesPorHash.delete(hash);
    }
    guardarSinEsperar(coleccion().deleteMany({ 'sesion.id': usuarioId }));
}
// Al sumarse a la red de otra PC, las cuentas de antes dejan de existir: no
// puede quedar ninguna sesión abierta con una cuenta que ya no está.
function invalidarTodasLasSesiones() {
    sesionesPorHash.clear();
    guardarSinEsperar(coleccion().deleteMany({}));
}
