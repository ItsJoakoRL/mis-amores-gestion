"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSesion = setSesion;
exports.getSesion = getSesion;
exports.requiereSesion = requiereSesion;
exports.requiereAdmin = requiereAdmin;
// Sesión del usuario logueado, en memoria del proceso principal.
// Es una app de escritorio de un solo puesto por vez: alcanza con guardar
// quién está logueado ahora mismo para validar permisos en cada operación.
const types_1 = require("../shared/types");
let sesionActual = null;
function setSesion(sesion) {
    sesionActual = sesion;
}
function getSesion() {
    return sesionActual;
}
function requiereSesion() {
    if (!sesionActual) {
        throw new Error(types_1.MENSAJE_SIN_SESION);
    }
    return sesionActual;
}
function requiereAdmin() {
    const sesion = requiereSesion();
    if (sesion.rol !== 'admin') {
        throw new Error('Esta acción requiere permisos de administrador');
    }
    return sesion;
}
