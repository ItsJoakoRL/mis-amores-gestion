import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import RecorridoAyuda from './RecorridoAyuda';
import { RECORRIDOS } from './recorridos';

// Botón chiquito para poner al lado del título de cada pantalla — arranca un
// recorrido guiado que va señalando, uno por uno, los botones y partes de
// esta pantalla en particular (ver RecorridoAyuda y recorridos.ts).
export default function BotonAyuda({ seccion }: { seccion: string }) {
  const [abierto, setAbierto] = useState(false);
  const pasos = RECORRIDOS[seccion] ?? [];

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-slate-100 hover:text-violet-500"
        title={`Ayuda: ${seccion}`}
        aria-label={`Ayuda sobre ${seccion}`}
      >
        <HelpCircle className="h-5 w-5" />
      </button>
      <RecorridoAyuda pasos={pasos} activo={abierto} onCerrar={() => setAbierto(false)} />
    </>
  );
}
