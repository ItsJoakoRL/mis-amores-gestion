import { useState } from 'react';
import { useAuth } from '../modules/auth/AuthContext';
import { useAyuda } from './AyudaContext';
import Mascota from './Mascota';

const clave = (usuarioId: string) => `misAmores.ayuda.bienvenida.${usuarioId}`;

// Una tarjeta arriba del Panel para quien recién empieza: ofrece mostrar lo básico, paso a paso,
// sin tener que buscar nada. Cada persona la puede sacar con "Ya sé usarlo" (se acuerda en esa
// computadora o celular, por usuario); mientras no lo haga, sigue apareciendo.
export default function TarjetaBienvenida() {
  const { sesion } = useAuth();
  const { abrirCentro, iniciarGuia } = useAyuda();
  const [oculta, setOculta] = useState(() => {
    try {
      return !!sesion && localStorage.getItem(clave(sesion.id)) === 'oculta';
    } catch {
      return false;
    }
  });

  if (!sesion || oculta) return null;

  function ocultar() {
    try {
      if (sesion) localStorage.setItem(clave(sesion.id), 'oculta');
    } catch {
      /* si el navegador no deja guardar, se oculta igual hasta que se recargue */
    }
    setOculta(true);
  }

  return (
    <div
      data-bienvenida
      className="mt-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-surface p-5 sm:p-6"
    >
      <div className="flex items-start gap-4">
        <Mascota tamanio="lg" murmura className="hidden shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-800">¿Es tu primera vez? Te enseño lo básico</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-600">
            Tocá lo que quieras aprender y te voy mostrando, paso a paso, sobre la pantalla. Y cuando necesites ayuda en
            cualquier momento, está el botón violeta <strong className="text-violet-700">Ayuda</strong>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => iniciarGuia('cobrar-venta')}>
              Cómo cobrar una venta
            </button>
            <button className="btn-secondary" onClick={() => iniciarGuia('vender-fiado')}>
              Cómo anotar un fiado
            </button>
            <button className="btn-secondary" onClick={() => iniciarGuia('producto-nuevo')}>
              Cómo cargar un producto
            </button>
            <button className="btn-secondary" onClick={() => abrirCentro('Panel')}>
              Ver toda la ayuda
            </button>
          </div>
          <button onClick={ocultar} className="mt-3 text-sm text-slate-400 underline hover:text-slate-600">
            Ya sé usarlo: no mostrar más esto
          </button>
        </div>
      </div>
    </div>
  );
}
