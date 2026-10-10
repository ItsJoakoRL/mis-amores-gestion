import { useEffect, useRef } from 'react';

// Con las PCs y los celulares cargando cosas a la vez, una pantalla que quedó
// abierta muestra datos viejos (ej. un precio que otra persona ya cambió).
// Esto la vuelve a cargar cuando se vuelve a ella (desde otra ventana, o
// desde otra app en el celular), como mucho una vez cada 30 segundos.
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
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cadaMs]);
}
