import { useEffect, useState } from 'react';
import type { ResumenRecordatorios } from '@shared/types';

// Cuántos recordatorios pendientes hay (y cuántos son urgentes o están
// vencidos): lo usan el menú y el Panel para que se note enseguida, desde
// cualquier pantalla, que hay algo para hacer. Se actualiza solo cuando
// alguien anota o marca algo, desde cualquier PC o celular.
export function useResumenRecordatorios(): ResumenRecordatorios | null {
  const [resumen, setResumen] = useState<ResumenRecordatorios | null>(null);

  useEffect(() => {
    let vigente = true;
    const cargar = () =>
      window.api.recordatorios
        .resumen()
        .then((r) => {
          if (vigente) setResumen(r);
        })
        .catch(() => {});
    cargar();
    // Por si pasa la medianoche y algo que era "para hoy" pasó a vencido.
    const intervalo = setInterval(cargar, 5 * 60_000);
    // Con un respiro, para no pedir de más si llegan varios cambios seguidos.
    let pendiente: ReturnType<typeof setTimeout> | null = null;
    const dejarDeEscuchar = window.api.sistema.onDatosCambio?.(() => {
      if (pendiente) return;
      pendiente = setTimeout(() => {
        pendiente = null;
        cargar();
      }, 800);
    });
    return () => {
      vigente = false;
      clearInterval(intervalo);
      if (pendiente) clearTimeout(pendiente);
      dejarDeEscuchar?.();
    };
  }, []);

  return resumen;
}
