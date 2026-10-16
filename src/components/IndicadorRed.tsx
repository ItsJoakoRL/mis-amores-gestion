import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { EstadoRed } from '@shared/types';
import { compararVersiones } from '@shared/versiones';

// Un renglón discreto en la barra lateral con cómo anda la sincronización con
// las otras PCs del negocio: para que se note enseguida si una no está
// recibiendo lo que se carga acá. No aparece si esta PC trabaja sola.
export default function IndicadorRed() {
  const [red, setRed] = useState<EstadoRed | null>(null);

  useEffect(() => {
    const puente = window.escritorio;
    if (!puente || (puente.versionPuente ?? 0) < 3) return;
    let vigente = true;
    const cargar = () =>
      puente
        .red()
        .then((r) => {
          if (vigente) setRed(r);
        })
        .catch(() => {});
    cargar();
    const t = setInterval(cargar, 5000);
    return () => {
      vigente = false;
      clearInterval(t);
    };
  }, []);

  if (!red || red.pcs.length === 0) return null;

  const sinConexion = red.pcs.filter((p) => !p.enLinea);
  if (red.poniendoseAlDia || (red.sincronizando && sinConexion.length === 0)) {
    return (
      <p className="mb-2 flex items-center gap-2 px-1 text-xs text-brand-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {red.poniendoseAlDia ? 'Trayendo los datos de la otra PC...' : 'Sincronizando...'}
      </p>
    );
  }
  if (sinConexion.length > 0) {
    const nombres = sinConexion.map((p) => p.nombrePc || 'otra PC').join(', ');
    return (
      <p
        className="mb-2 flex items-start gap-2 px-1 text-xs text-amber-700"
        title="Lo que se cargue acá le llega cuando vuelva a estar en línea."
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        <span>Sin conexión con {nombres}. Se pone al día sola cuando vuelva.</span>
      </p>
    );
  }
  // Una PC puede estar en línea y sin cambios pendientes y aun así tener una
  // versión vieja del programa: no se dice que está "al día".
  const viejas = red.pcs.filter(
    (p) => p.enLinea && !/^https?:\/\//i.test(p.direccion) && !!p.version && compararVersiones(p.version, red.versionApp) < 0
  );
  if (viejas.length > 0) {
    const nombres = viejas.map((p) => p.nombrePc || 'otra PC').join(', ');
    return (
      <p
        className="mb-2 flex items-start gap-2 px-1 text-xs text-amber-700"
        title="Hay que abrir Mis Amores en esa PC y buscar actualizaciones."
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
        <span>{nombres}: tiene la app desactualizada.</span>
      </p>
    );
  }
  return (
    <p className="mb-2 flex items-center gap-2 px-1 text-xs text-slate-400">
      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
      {red.pcs.length === 1 ? 'Al día con la otra PC' : `Al día con las otras ${red.pcs.length} PCs`}
    </p>
  );
}
