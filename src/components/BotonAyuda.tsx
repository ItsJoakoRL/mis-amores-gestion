import { HelpCircle } from 'lucide-react';
import { useAyuda } from './AyudaContext';

// El botón "Ayuda" que va al lado del título de cada pantalla. Abre el centro de ayuda
// mostrando primero lo de esta pantalla: una guía que señala sus partes y las cosas que más
// se hacen acá, paso a paso (ver CentroDeAyuda). Es un botón con texto y color a propósito:
// quien recién empieza tiene que verlo y saber qué es.
export default function BotonAyuda({ seccion }: { seccion: string }) {
  const { abrirCentro } = useAyuda();

  return (
    <button
      onClick={() => abrirCentro(seccion)}
      data-boton-ayuda
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100"
      title="Ayuda: te explico cómo se usa esta pantalla y cómo hacer lo que más se hace"
      aria-label={`Ayuda sobre ${seccion}`}
    >
      <HelpCircle className="h-4 w-4" />
      Ayuda
    </button>
  );
}
