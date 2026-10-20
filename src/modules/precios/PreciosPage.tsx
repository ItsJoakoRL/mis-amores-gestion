import { useState } from 'react';
import { ClipboardPen, Tags } from 'lucide-react';
import BotonAyuda from '../../components/BotonAyuda';
import CambioMasivo from './CambioMasivo';
import PlanillaCostos from './PlanillaCostos';

type Pestana = 'precios' | 'costos';

// Precios y costos de muchos productos juntos (sólo la administradora): subir o bajar
// los precios en conjunto, y cargar los costos en una planilla para saber cuánto se gana.
export default function PreciosPage() {
  const [pestana, setPestana] = useState<Pestana>('precios');

  return (
    <div className="mx-auto max-w-5xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-5">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
          Precios y costos
          <BotonAyuda seccion="Precios y costos" />
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Cambiá los precios de muchos productos juntos, o cargá lo que te cuesta cada uno para ver cuánto ganás.
        </p>
      </div>

      <div data-tour="precios-pestanas" className="mb-5 flex gap-1 rounded-lg border border-slate-200 bg-surface p-1">
        <button
          onClick={() => setPestana('precios')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            pestana === 'precios' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Tags className="h-4 w-4" />
          Cambiar precios
        </button>
        <button
          onClick={() => setPestana('costos')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            pestana === 'costos' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ClipboardPen className="h-4 w-4" />
          Cargar costos
        </button>
      </div>

      {pestana === 'precios' ? <CambioMasivo /> : <PlanillaCostos />}
    </div>
  );
}
