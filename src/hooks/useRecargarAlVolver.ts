import { useEffect, useRef } from 'react';

// Con las PCs y los celulares cargando cosas a la vez, una pantalla que quedó
// abierta muestra datos viejos (ej. un precio que otra persona ya cambió).
// Esto la vuelve a cargar cuando se vuelve a ella (desde otra ventana, o
// desde otra app en el celular), como mucho una vez cada 30 segundos — y,
// además, apenas alguien cambia algo desde cualquier PC o celular (el aviso
// llega en vivo; ver electron/cambiosEnVivo.ts), con un respiro de 1,5 s para
// no recargar de más si llegan varios cambios seguidos.
export function useRecargarAlVolver(recargar: () => void, cadaMs = 30_000) {
  const recargarRef = useRef(recargar);
  recargarRef.current = recargar;

  useEffect(() => {
    let ultima = Date.now();
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultima < cadaMs) return;
      ultima = Date.now();
      recargarRef.current();
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);

    let ultimaEnVivo = 0;
    let pendiente: ReturnType<typeof setTimeout> | null = null;
    const alCambiarDatos = () => {
      if (document.visibilityState !== 'visible' || pendiente) return;
      const espera = Math.max(0, 1500 - (Date.now() - ultimaEnVivo));
      pendiente = setTimeout(() => {
        pendiente = null;
        ultimaEnVivo = Date.now();
        ultima = Date.now();
        recargarRef.current();
      }, espera);
    };
    const dejarDeEscuchar = window.api.sistema.onDatosCambio?.(alCambiarDatos);

    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
      dejarDeEscuchar?.();
      if (pendiente) clearTimeout(pendiente);
    };
  }, [cadaMs]);
}
