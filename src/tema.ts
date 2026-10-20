import { useSyncExternalStore } from 'react';

// Modo claro / oscuro. La preferencia se guarda en este aparato (no se sincroniza con las otras PCs ni los
// celulares: cada pantalla elige la suya). "auto" sigue lo que tenga configurado el sistema (Windows, celular).
export type PreferenciaTema = 'claro' | 'oscuro' | 'auto';
export type TemaResuelto = 'claro' | 'oscuro';

const CLAVE = 'ma-tema';
const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

function leerPreferencia(): PreferenciaTema {
  try {
    const guardada = localStorage.getItem(CLAVE);
    if (guardada === 'claro' || guardada === 'oscuro' || guardada === 'auto') return guardada;
  } catch {
    // Sin dónde guardar (modo privado o bloqueado): se usa el claro de siempre.
  }
  return 'claro';
}

function sistemaEnOscuro(): boolean {
  try {
    return window.matchMedia(CONSULTA_OSCURO).matches;
  } catch {
    return false;
  }
}

function resolver(preferencia: PreferenciaTema): TemaResuelto {
  if (preferencia === 'auto') return sistemaEnOscuro() ? 'oscuro' : 'claro';
  return preferencia;
}

function aplicar(resuelto: TemaResuelto) {
  document.documentElement.classList.toggle('dark', resuelto === 'oscuro');
}

// La preferencia vive en memoria (la verdad de esta ventana) y se copia al almacenamiento; así, si el
// almacenamiento falla, el tema elegido igual se mantiene mientras la ventana esté abierta.
let preferenciaActual = leerPreferencia();
// useSyncExternalStore pide una "foto" que sólo cambie cuando de verdad cambia algo.
let foto = { preferencia: preferenciaActual, resuelto: resolver(preferenciaActual) };
const oyentes = new Set<() => void>();

function recalcular() {
  const resuelto = resolver(preferenciaActual);
  if (preferenciaActual === foto.preferencia && resuelto === foto.resuelto) return;
  foto = { preferencia: preferenciaActual, resuelto };
  aplicar(resuelto);
  oyentes.forEach((o) => o());
}

export function elegirTema(preferencia: PreferenciaTema) {
  preferenciaActual = preferencia;
  try {
    localStorage.setItem(CLAVE, preferencia);
  } catch {
    // No se pudo guardar: igual se cambia ahora, sólo que no se recuerda al reabrir.
  }
  recalcular();
}

let escuchando = false;
function empezarAEscuchar() {
  if (escuchando) return;
  escuchando = true;
  try {
    // Si el sistema pasa de claro a oscuro (ej. de noche) y se eligió "automático", sigue solo.
    window.matchMedia(CONSULTA_OSCURO).addEventListener('change', recalcular);
  } catch {
    // navegador sin matchMedia: no pasa nada
  }
  // Otra ventana de la misma app cambió el tema.
  window.addEventListener('storage', (e) => {
    if (e.key !== CLAVE) return;
    preferenciaActual = leerPreferencia();
    recalcular();
  });
}

aplicar(foto.resuelto);
empezarAEscuchar();

function suscribir(cb: () => void) {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}

export function useTema() {
  const actual = useSyncExternalStore(
    suscribir,
    () => foto,
    () => foto
  );
  return { preferencia: actual.preferencia, tema: actual.resuelto, elegirTema };
}
