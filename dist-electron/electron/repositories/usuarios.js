"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarCredenciales = verificarCredenciales;
exports.getUsuario = getUsuario;
exports.listUsuarios = listUsuarios;
exports.listCuentasPublicas = listCuentasPublicas;
exports.crearUsuario = crearUsuario;
exports.actualizarUsuario = actualizarUsuario;
exports.setUsuarioActivo = setUsuarioActivo;
exports.resetPassword = resetPassword;
exports.eliminarUsuario = eliminarUsuario;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongodb_1 = require("mongodb");
const database_1 = require("../db/database");
const tokenSessions_1 = require("../server/tokenSessions");
const LARGO_MINIMO_PASSWORD = 4;
function validarLargoPassword(password) {
    if (password.length < LARGO_MINIMO_PASSWORD) {
        throw new Error(`La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
    }
}
// Freno contra fuerza bruta: después de varios intentos fallidos seguidos
// para el mismo usuario, se bloquean los intentos siguientes un rato —
// aplica tanto al login de escritorio como al del celular (ambos pasan por
// acá). Vive en memoria nada más: si se reinicia la app, se resetea solo.
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const intentosFallidos = new Map();
function coleccion() {
    return (0, database_1.getDb)().collection('usuarios');
}
function mapDoc(doc) {
    return {
        id: doc._id.toHexString(),
        nombre: doc.nombre,
        usuario: doc.usuario,
        rol: doc.rol,
        // Cuentas creadas antes de agregar este campo no lo tienen guardado —
        // "F" como default es sólo para no romper con datos viejos.
        genero: doc.genero ?? 'F',
        activo: doc.activo,
    };
}
function esErrorDuplicado(err) {
    return typeof err === 'object' && err !== null && err.code === 11000;
}
async function verificarCredenciales(usuario, password) {
    const clave = usuario.trim().toLowerCase();
    const estado = intentosFallidos.get(clave);
    if (estado && estado.bloqueadoHasta > Date.now()) {
        const minutos = Math.ceil((estado.bloqueadoHasta - Date.now()) / 60000);
        throw new Error(`Demasiados intentos fallidos. Probá de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`);
    }
    const doc = await coleccion().findOne({ usuario });
    const ok = doc && doc.activo && bcryptjs_1.default.compareSync(password, doc.passwordHash);
    if (!ok) {
        const cantidad = (estado?.cantidad ?? 0) + 1;
        intentosFallidos.set(clave, {
            cantidad,
            bloqueadoHasta: cantidad >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0,
        });
        return null;
    }
    intentosFallidos.delete(clave);
    return mapDoc(doc);
}
async function getUsuario(id) {
    if (!mongodb_1.ObjectId.isValid(id))
        return null;
    const doc = await coleccion().findOne({ _id: new mongodb_1.ObjectId(id) });
    return doc ? mapDoc(doc) : null;
}
async function listUsuarios() {
    const docs = await coleccion().find().sort({ nombre: 1 }).toArray();
    return docs.map(mapDoc);
}
// Se muestra en la pantalla de login, antes de iniciar sesión — por eso sólo
// devuelve lo justo para elegir la cuenta (nada de passwordHash) y sólo las
// activas.
async function listCuentasPublicas() {
    const docs = await coleccion().find({ activo: true }).sort({ nombre: 1 }).toArray();
    return docs.map((doc) => ({
        id: doc._id.toHexString(),
        nombre: doc.nombre,
        usuario: doc.usuario,
        rol: doc.rol,
        genero: doc.genero ?? 'F',
    }));
}
async function crearUsuario(nombre, usuario, password, rol, genero) {
    validarLargoPassword(password);
    const nombreLimpio = nombre.trim();
    const usuarioLimpio = usuario.trim();
    const passwordHash = bcryptjs_1.default.hashSync(password, 10);
    try {
        const result = await coleccion().insertOne({
            nombre: nombreLimpio,
            usuario: usuarioLimpio,
            passwordHash,
            rol,
            genero,
            activo: true,
        });
        return {
            id: result.insertedId.toHexString(),
            nombre: nombreLimpio,
            usuario: usuarioLimpio,
            rol,
            genero,
            activo: true,
        };
    }
    catch (err) {
        if (esErrorDuplicado(err))
            throw new Error('Ya existe un usuario con ese nombre de usuario');
        throw err;
    }
}
// Evita que la única admin activa se quede sin poder administrar usuarios
// (por sacarse el rol ella misma, o por desactivar su propia cuenta) — no
// habría forma de volver atrás desde la UI si eso pasara.
async function esUnicaAdminActiva(id) {
    const doc = await coleccion().findOne({ _id: new mongodb_1.ObjectId(id) });
    if (!doc || doc.rol !== 'admin' || !doc.activo)
        return false;
    const otrasAdmins = await coleccion().countDocuments({
        _id: { $ne: new mongodb_1.ObjectId(id) },
        rol: 'admin',
        activo: true,
    });
    return otrasAdmins === 0;
}
async function actualizarUsuario(id, nombre, usuario, rol, genero) {
    if (rol !== 'admin' && (await esUnicaAdminActiva(id))) {
        throw new Error('No se le puede sacar el rol de administradora: es la única activa. Creá otra admin antes.');
    }
    const nombreLimpio = nombre.trim();
    const usuarioLimpio = usuario.trim();
    try {
        await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { nombre: nombreLimpio, usuario: usuarioLimpio, rol, genero } });
    }
    catch (err) {
        if (esErrorDuplicado(err))
            throw new Error('Ya existe un usuario con ese nombre de usuario');
        throw err;
    }
    const doc = await coleccion().findOne({ _id: new mongodb_1.ObjectId(id) });
    if (!doc)
        throw new Error('El usuario no existe');
    // Si le cambiaron el rol (u otro dato), cualquier sesión de celular que ya
    // tuviera abierta queda con datos viejos cacheados — se cierra para que
    // tenga que volver a entrar y traiga los datos nuevos.
    (0, tokenSessions_1.invalidarTokensDeUsuario)(id);
    return mapDoc(doc);
}
async function setUsuarioActivo(id, activo) {
    if (!activo && (await esUnicaAdminActiva(id))) {
        throw new Error('No se puede desactivar: es la única administradora activa.');
    }
    await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { activo } });
    // Si se la desactivó, cualquier sesión de celular que ya tuviera abierta
    // (con el rol/acceso de cuando todavía estaba activa) deja de funcionar
    // de una, en vez de seguir funcionando hasta que se reinicie la app.
    if (!activo)
        (0, tokenSessions_1.invalidarTokensDeUsuario)(id);
}
async function resetPassword(id, password) {
    validarLargoPassword(password);
    const passwordHash = bcryptjs_1.default.hashSync(password, 10);
    await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id) }, { $set: { passwordHash } });
}
// Borrado definitivo — a diferencia de desactivar (que sólo le bloquea el
// login), esto saca a la persona de la lista para siempre. Las ventas y
// pagos que ya registró quedan igual en el historial, sólo que sin poder
// mostrar su nombre (el mismo comportamiento que ya tenía un usuario
// desactivado al hacer los $lookup contra la colección de usuarios).
async function eliminarUsuario(id) {
    if (await esUnicaAdminActiva(id)) {
        throw new Error('No se puede eliminar: es la única administradora activa. Creá otra admin antes.');
    }
    await coleccion().deleteOne({ _id: new mongodb_1.ObjectId(id) });
    (0, tokenSessions_1.invalidarTokensDeUsuario)(id);
}
