// Sesión del usuario logueado, en memoria del proceso principal.
// Es una app de escritorio de un solo puesto por vez: alcanza con guardar
// quién está logueado ahora mismo para validar permisos en cada operación.
import { MENSAJE_SIN_SESION, type SesionActual } from '../shared/types';

let sesionActual: SesionActual | null = null;

export function setSesion(sesion: SesionActual | null) {
  sesionActual = sesion;
}

export function getSesion(): SesionActual | null {
  return sesionActual;
}

export function requiereSesion(): SesionActual {
  if (!sesionActual) {
    throw new Error(MENSAJE_SIN_SESION);
  }
  return sesionActual;
}

export function requiereAdmin(): SesionActual {
  const sesion = requiereSesion();
  if (sesion.rol !== 'admin') {
    throw new Error('Esta acción requiere permisos de administrador');
  }
  return sesion;
}
