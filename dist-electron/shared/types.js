"use strict";
// Tipos compartidos entre el proceso principal (Electron) y el renderer (React).
// Mantenerlos acá evita duplicar interfaces y que se desincronicen.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENSAJE_SIN_SESION = void 0;
exports.etiquetaRol = etiquetaRol;
// "Administrador/a" o "Empleado/a" según corresponda — se usa en el
// selector de login, la barra lateral y el listado de Usuarios.
function etiquetaRol(rol, genero) {
    if (rol === 'admin')
        return genero === 'M' ? 'Administrador' : 'Administradora';
    return genero === 'M' ? 'Empleado' : 'Empleada';
}
/** Con qué mensaje avisa el servidor que la sesión ya no vale (se cerró o
 * venció) — el cliente web lo reconoce para volver a la pantalla de login. */
exports.MENSAJE_SIN_SESION = 'No hay una sesión iniciada';
