import { Monitor, Moon, Sun } from 'lucide-react';
import { useTema, type PreferenciaTema } from '../tema';

const OPCIONES: { valor: PreferenciaTema; etiqueta: string; titulo: string; icono: typeof Sun }[] = [
  { valor: 'claro', etiqueta: 'Claro', titulo: 'Fondo claro', icono: Sun },
  { valor: 'oscuro', etiqueta: 'Oscuro', titulo: 'Fondo oscuro (descansa la vista de noche)', icono: Moon },
  { valor: 'auto', etiqueta: 'Auto', titulo: 'Igual que la configuración de este aparato', icono: Monitor },
];

// Tres botones para elegir cómo se ve la app. Se recuerda en este aparato.
export default function SelectorTema({ compacto = false }: { compacto?: boolean }) {
  const { preferencia, elegirTema } = useTema();
  return (
    <div
      data-selector-tema
      data-tour="menu-tema"
      role="radiogroup"
      aria-label="Aspecto de la aplicación"
      className="flex gap-1 rounded-xl bg-slate-100 p-1"
    >
      {OPCIONES.map(({ valor, etiqueta, titulo, icono: Icono }) => {
        const activo = preferencia === valor;
        return (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={titulo}
            title={titulo}
            data-tema={valor}
            onClick={() => elegirTema(valor)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-all ${
              'px-2 py-1.5'
            } ${
              activo
                ? 'bg-surface text-brand-700 shadow-sm'
                : 'text-slate-500 hover:bg-surface/60 hover:text-slate-700'
            }`}
          >
            <Icono className="h-3.5 w-3.5" />
            {!compacto && <span>{etiqueta}</span>}
          </button>
        );
      })}
    </div>
  );
}
