import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  ChevronRight,
  Contact,
  LifeBuoy,
  MapPin,
  Package,
  PlayCircle,
  Search,
  Settings,
  ShoppingCart,
  Smartphone,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../modules/auth/AuthContext';
import { esTactil } from '../utils/dispositivo';
import { RECORRIDOS } from './recorridos';
import type { PasoRecorrido } from './RecorridoAyuda';
import {
  GRUPOS_GUIAS,
  GUIAS,
  PALABRAS_DEL_PROGRAMA,
  PARTES_DEL_MENU,
  buscarGuias,
  guiaPorId,
  type Guia,
  type GrupoGuia,
} from './guias';

const ICONO_GRUPO: Record<GrupoGuia, LucideIcon> = {
  'Vender y cobrar': ShoppingCart,
  'Productos y stock': Package,
  'Clientes y fiados': Contact,
  Precios: Tags,
  'Controlar el negocio': BarChart3,
  'Otras cosas': Settings,
};

interface Props {
  /** La pantalla desde donde se abrió ("Clientes (fiado)"): se muestra primero lo suyo. */
  seccion?: string;
  onCerrar: () => void;
  onIniciarGuia: (id: string) => void;
  onIniciarRecorrido: (pasos: PasoRecorrido[], titulo?: string) => void;
}

function TarjetaDeGuia({ guia, onElegir }: { guia: Guia; onElegir: () => void }) {
  const Icono = ICONO_GRUPO[guia.grupo];
  return (
    <button
      onClick={onElegir}
      data-guia={guia.id}
      className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
        <Icono className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-snug text-slate-800">{guia.titulo}</span>
        <span className="mt-0.5 block text-sm leading-snug text-slate-500">{guia.resumen}</span>
        {guia.paraCelular && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
            <Smartphone className="h-3 w-3" />
            Para el celular
          </span>
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

// El centro de ayuda: en vez de explicar botón por botón, se elige QUÉ SE QUIERE HACER ("Cobrar
// una venta", "Anotar un fiado"...) y se ve cómo, en pasos cortos, o se le pide a la guía que
// lo muestre sobre la pantalla real ("Mostrame paso a paso"). También tiene un buscador, qué
// hay en cada parte del menú y qué significan las palabras que usa el programa.
export default function CentroDeAyuda({ seccion, onCerrar, onIniciarGuia, onIniciarRecorrido }: Props) {
  const { esAdmin } = useAuth();
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  const guias = useMemo(() => GUIAS.filter((g) => !g.soloAdmin || esAdmin), [esAdmin]);
  const recorridoDeLaPantalla = seccion ? RECORRIDOS[seccion] : undefined;
  const deEstaPantalla = seccion ? guias.filter((g) => g.secciones.includes(seccion)) : [];
  const resultados = texto.trim() ? buscarGuias(texto, guias) : null;
  const guia = abierta ? guiaPorId(abierta) : undefined;
  const partesDelMenu = PARTES_DEL_MENU.filter((p) => (!p.soloAdmin || esAdmin) && (!p.soloEscritorio || window.escritorio));

  useEffect(() => {
    const alApretar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (abierta) setAbierta(null);
      else onCerrar();
    };
    document.addEventListener('keydown', alApretar);
    return () => document.removeEventListener('keydown', alApretar);
  }, [abierta, onCerrar]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex animate-fade-in items-end justify-center bg-slate-900/50 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
      data-centro-ayuda
    >
      <div className="flex max-h-[94dvh] w-full max-w-2xl animate-slide-up flex-col overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          {guia ? (
            <button
              onClick={() => setAbierta(null)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50"
            >
              <ArrowLeft className="h-5 w-5" />
              Volver
            </button>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
              <LifeBuoy className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-800">{guia ? guia.titulo : 'Ayuda'}</h2>
            {!guia && <p className="text-sm text-slate-500">¿Qué querés hacer? Elegí y te explico paso a paso.</p>}
          </div>
          <button
            onClick={onCerrar}
            className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar la ayuda"
            title="Cerrar"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {guia ? (
            // ------------------------------------------------------------ una guía
            <div>
              <p className="text-base text-slate-600">{guia.resumen}</p>
              {guia.paraCelular && (
                <p className="mt-2 flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  <Smartphone className="h-4 w-4 shrink-0" />
                  Esto se usa desde el celular: en la compu no se ve lo que te voy señalando.
                </p>
              )}
              <button
                onClick={() => onIniciarGuia(guia.id)}
                data-mostrame
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-4 text-lg font-semibold text-white shadow-sm hover:bg-violet-700"
              >
                <PlayCircle className="h-6 w-6" />
                Mostrame paso a paso
              </button>
              <p className="mt-1.5 text-center text-xs text-slate-400">
                Te llevo a la pantalla y te voy marcando lo que tenés que tocar.
              </p>

              <h3 className="mt-7 text-sm font-semibold uppercase tracking-wide text-slate-400">O leelo acá</h3>
              <ol className="mt-3 space-y-4">
                {guia.pasos.map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-slate-800">{p.titulo}</p>
                      <p className="mt-0.5 text-base leading-relaxed text-slate-600">{p.texto}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            // ------------------------------------------------------------ la lista
            <div className="space-y-6">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  className="input !py-3 !pl-12 !text-base"
                  placeholder="Escribí lo que querés hacer (cobrar, deuda, precio...)"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  autoFocus={!esTactil()}
                  aria-label="Buscar en la ayuda"
                />
              </label>

              {resultados ? (
                resultados.length > 0 ? (
                  <div className="space-y-2">
                    {resultados.map((g) => (
                      <TarjetaDeGuia key={g.id} guia={g} onElegir={() => setAbierta(g.id)} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-white px-4 py-6 text-center text-base text-slate-500">
                    No encontré nada con esa palabra. Probá con otra (por ejemplo: <em>cobrar</em>, <em>deuda</em>,{' '}
                    <em>stock</em>, <em>precio</em>) o mirá la lista de abajo.
                  </p>
                )
              ) : (
                <>
                  {recorridoDeLaPantalla && (
                    <button
                      onClick={() => onIniciarRecorrido(recorridoDeLaPantalla, `Esta pantalla: ${seccion}`)}
                      data-recorrer-pantalla
                      className="flex w-full items-center gap-3 rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-4 text-left transition-colors hover:bg-violet-100"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
                        <MapPin className="h-6 w-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-violet-900">Mostrame esta pantalla</span>
                        <span className="block text-sm text-violet-700">
                          Te señalo para qué sirve cada parte de «{seccion}».
                        </span>
                      </span>
                      <PlayCircle className="h-6 w-6 shrink-0 text-violet-600" />
                    </button>
                  )}

                  {deEstaPantalla.length > 0 && (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
                        Lo más común en esta pantalla
                      </h3>
                      <div className="space-y-2">
                        {deEstaPantalla.map((g) => (
                          <TarjetaDeGuia key={g.id} guia={g} onElegir={() => setAbierta(g.id)} />
                        ))}
                      </div>
                    </section>
                  )}

                  {GRUPOS_GUIAS.map((grupo) => {
                    const delGrupo = guias.filter((g) => g.grupo === grupo && !deEstaPantalla.includes(g));
                    if (delGrupo.length === 0) return null;
                    return (
                      <section key={grupo}>
                        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{grupo}</h3>
                        <div className="space-y-2">
                          {delGrupo.map((g) => (
                            <TarjetaDeGuia key={g.id} guia={g} onElegir={() => setAbierta(g.id)} />
                          ))}
                        </div>
                      </section>
                    );
                  })}

                  <section className="space-y-2">
                    <details className="group rounded-2xl border border-slate-200 bg-white">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-base font-semibold text-slate-700">
                        <MapPin className="h-5 w-5 text-violet-500" />
                        <span className="flex-1">¿Qué hay en cada parte del menú?</span>
                        <ChevronRight className="h-5 w-5 text-slate-300 transition-transform group-open:rotate-90" />
                      </summary>
                      <ul className="divide-y divide-slate-100 border-t border-slate-100">
                        {partesDelMenu.map((p) => (
                          <li key={p.ruta} className="flex items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-semibold text-slate-800">{p.nombre}</p>
                              <p className="text-sm leading-snug text-slate-500">{p.sirve}</p>
                            </div>
                            <button
                              onClick={() => {
                                navigate(p.ruta);
                                onCerrar();
                              }}
                              className="shrink-0 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Ir
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>

                    <details className="group rounded-2xl border border-slate-200 bg-white">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-base font-semibold text-slate-700">
                        <BookOpen className="h-5 w-5 text-violet-500" />
                        <span className="flex-1">¿Qué significa cada palabra?</span>
                        <ChevronRight className="h-5 w-5 text-slate-300 transition-transform group-open:rotate-90" />
                      </summary>
                      <dl className="divide-y divide-slate-100 border-t border-slate-100">
                        {PALABRAS_DEL_PROGRAMA.map((p) => (
                          <div key={p.palabra} className="px-4 py-3">
                            <dt className="text-base font-semibold text-slate-800">{p.palabra}</dt>
                            <dd className="text-sm leading-snug text-slate-500">{p.significa}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </section>

                  <p className="rounded-2xl bg-white px-4 py-3 text-sm leading-relaxed text-slate-500">
                    <strong className="text-slate-700">¿Querés saber algo de tu negocio?</strong> (cuánto vendiste, quién te
                    debe, qué tiene poco stock...) Preguntale al asistente: es el dibujito redondo que está abajo a la
                    derecha.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
