import type React from 'react';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface PasoRecorrido {
  /** Selector CSS del elemento a señalar. Si no se encuentra en la pantalla
   * (por ejemplo, un gráfico que todavía no cargó datos), el paso se
   * muestra igual pero centrado, sin el marco resaltado. */
  selector?: string;
  titulo: string;
  texto: string;
}

interface Props {
  pasos: PasoRecorrido[];
  activo: boolean;
  onCerrar: () => void;
}

const MARGEN_RESALTE = 8;
const ANCHO_GLOBO = 288;
const ALTO_GLOBO_ESTIMADO = 170;
const MARGEN_PANTALLA = 16;

function calcularPosicion(rect: DOMRect | null): {
  top: number;
  left: number;
  flechaArriba: boolean;
  flechaX: number;
} {
  if (!rect) {
    return {
      top: window.innerHeight / 2 - ALTO_GLOBO_ESTIMADO / 2,
      left: window.innerWidth / 2 - ANCHO_GLOBO / 2,
      flechaArriba: false,
      flechaX: ANCHO_GLOBO / 2,
    };
  }
  const centroX = rect.left + rect.width / 2;
  const left = Math.min(
    Math.max(centroX - ANCHO_GLOBO / 2, MARGEN_PANTALLA),
    window.innerWidth - ANCHO_GLOBO - MARGEN_PANTALLA
  );
  const espacioAbajo = window.innerHeight - rect.bottom;
  const vaAbajo = espacioAbajo > ALTO_GLOBO_ESTIMADO + 24 || rect.top < ALTO_GLOBO_ESTIMADO;
  const top = vaAbajo ? rect.bottom + 16 : rect.top - ALTO_GLOBO_ESTIMADO - 16;
  const flechaX = Math.min(Math.max(centroX - left, 24), ANCHO_GLOBO - 24);
  return { top, left, flechaArriba: vaAbajo, flechaX };
}

// Recorrido guiado paso a paso: oscurece la pantalla, deja "un agujero" de
// luz alrededor del elemento que se está explicando (con la técnica del
// box-shadow gigante, en vez de un SVG con máscara) y muestra un globito con
// flecha apuntándolo, con botones para ir avanzando. Se arma con la misma
// idea que un tour de onboarding, pero sobre la pantalla real en vez de una
// lista de texto — así se ve clarísimo de qué botón se está hablando.
export default function RecorridoAyuda({ pasos, activo, onCerrar }: Props) {
  const [paso, setPaso] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (activo) setPaso(0);
  }, [activo]);

  useLayoutEffect(() => {
    if (!activo) return;
    const actual = pasos[paso];
    const el = actual?.selector ? document.querySelector(actual.selector) : null;
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const medir = () => setRect(el.getBoundingClientRect());
    medir();
    // El scroll suave tarda un rato — volvemos a medir cuando termina para
    // que la flecha no quede apuntando a donde estaba el elemento antes de
    // moverse.
    const timer = setTimeout(medir, 350);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [activo, paso, pasos]);

  if (!activo || pasos.length === 0) return null;

  const actual = pasos[paso];
  const esUltimo = paso === pasos.length - 1;
  const { top, left, flechaArriba, flechaX } = calcularPosicion(rect);

  const estiloResalte: React.CSSProperties = rect
    ? {
        top: rect.top - MARGEN_RESALTE,
        left: rect.left - MARGEN_RESALTE,
        width: rect.width + MARGEN_RESALTE * 2,
        height: rect.height + MARGEN_RESALTE * 2,
        boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.65)',
      }
    : { inset: 0, background: 'rgba(15, 23, 42, 0.65)' };

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute rounded-xl ring-4 ring-brand-400 transition-all duration-300 ease-out pointer-events-none"
        style={estiloResalte}
      />

      <div
        className="absolute animate-scale-in rounded-xl bg-white p-4 shadow-2xl transition-all duration-300 ease-out"
        style={{ top, left, width: ANCHO_GLOBO }}
      >
        {rect && (
          <div
            className="absolute h-3 w-3 rotate-45 bg-white"
            style={
              flechaArriba
                ? { top: -6, left: flechaX - 6 }
                : { bottom: -6, left: flechaX - 6 }
            }
          />
        )}

        <div className="relative flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-800">{actual.titulo}</h3>
          <button
            onClick={onCerrar}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar recorrido"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="relative mt-1 text-sm text-slate-600">{actual.texto}</p>
        <div className="relative mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {paso + 1} de {pasos.length}
          </p>
          <div className="flex gap-2">
            {paso > 0 && (
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setPaso((p) => p - 1)}
              >
                Atrás
              </button>
            )}
            <button
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              onClick={() => (esUltimo ? onCerrar() : setPaso((p) => p + 1))}
            >
              {esUltimo ? 'Listo' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
