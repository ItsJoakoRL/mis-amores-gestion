// Límite de intentos al iniciar sesión, para el servidor que está en internet
// (ver nube.ts): ahí cualquiera puede probar contraseñas. En la red del local no
// se usa.
//
// Se suma al freno de repositories/usuarios.ts (5 fallos → 5 minutos, que se
// reinicia cuando el servicio se duerme o se reinicia): éste es más largo, así
// que probar contraseñas de a poco tampoco sirve.
//
// Se cuentan los intentos fallidos de la última hora:
//   - por usuario (venga de donde venga): corta el adivinar la clave de una cuenta;
//   - por dirección: corta el probar muchas cuentas desde un mismo lugar.
// Pasado el límite se rechaza TODO intento (aunque la contraseña sea la
// correcta) hasta que el fallo más viejo salga de esa hora.
const VENTANA_MS = 60 * 60_000;
const MAX_POR_USUARIO = 10;
const MAX_POR_DIRECCION = 100;
const MAX_CLAVES_GUARDADAS = 5000;

const fallos = new Map<string, number[]>();

function claveUsuario(usuario: string): string {
  return `u:${usuario.trim().toLowerCase().slice(0, 80)}`;
}

function claveDireccion(ip: string): string {
  return `i:${ip}`;
}

function vigentes(clave: string, ahora: number): number[] {
  const lista = fallos.get(clave);
  if (!lista) return [];
  while (lista.length > 0 && ahora - lista[0] > VENTANA_MS) lista.shift();
  if (lista.length === 0) fallos.delete(clave);
  return lista;
}

/** ¿Hay que rechazar este intento sin ni mirar la contraseña? */
export function intentoBloqueado(ip: string, usuario: string, ahora = Date.now()): boolean {
  return (
    vigentes(claveUsuario(usuario), ahora).length >= MAX_POR_USUARIO ||
    vigentes(claveDireccion(ip), ahora).length >= MAX_POR_DIRECCION
  );
}

export function anotarFallo(ip: string, usuario: string, ahora = Date.now()): void {
  for (const clave of [claveUsuario(usuario), claveDireccion(ip)]) {
    const lista = fallos.get(clave) ?? [];
    lista.push(ahora);
    fallos.set(clave, lista);
  }
  // Que la memoria no crezca sin fin si alguien prueba con miles de nombres.
  if (fallos.size > MAX_CLAVES_GUARDADAS) {
    for (const clave of [...fallos.keys()]) {
      if (vigentes(clave, ahora).length === 0) fallos.delete(clave);
    }
    if (fallos.size > MAX_CLAVES_GUARDADAS) fallos.clear();
  }
}

/** Entró bien: se borran los fallos de esa cuenta. */
export function limpiarFallos(usuario: string): void {
  fallos.delete(claveUsuario(usuario));
}
