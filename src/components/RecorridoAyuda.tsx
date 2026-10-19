import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Hand, Loader2, X } from 'lucide-react';

export interface PasoRecorrido {
  /** Selector CSS de lo que se señala. Si no aparece en pantalla, el paso se muestra igual
   * en el centro y sigue esperando: apenas aparece (por ejemplo, al abrirse un cuadro) lo
   * señala. Si hay varios, se señala el primero que se ve. */
  selector?: string;
  titulo: string;
  texto: string;
  /** Pantalla a la que hay que ir para este paso (por ejemplo '/articulos'): si no se está
   * ahí, la guía lleva sola. */
  ruta?: string;
  /** El paso le pide a la persona que toque lo señalado: al tocarlo, la guía sigue sola. */
  tocar?: boolean;
}

interface Props {
  pasos: PasoRecorrido[];
  /** De qué es la guía ("Cobrar una venta"): se ve arriba del globito. */
  titulo?: string;
  onCerrar: () => void;
}

const MARGEN_RESALTE = 8;
const MARGEN_PANTALLA = 16;

interface Caja {
  top: number;
  left: number;
  width: number;
  height: number;
}

const igualCaja = (a: Caja | null, b: Caja | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

const aCaja = (r: DOMRect): Caja => ({
  top: Math.round(r.top),
  left: Math.round(r.left),
  width: Math.round(r.width),
  height: Math.round(r.height),
});

// Un elemento "se ve" si ocupa lugar en pantalla (los escondidos con display:none, como la
// lista del celular cuando se está en la PC, no cuentan).
function seVe(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function buscarVisible(selector: string): Element | null {
  try {
    return [...document.querySelectorAll(selector)].find(seVe) ?? null;
  } catch {
    return null; // un selector mal escrito no tiene que romper la pantalla
  }
}

// Dónde va el globito: debajo de lo señalado si entra, si no arriba, y si tampoco (algo muy
// grande) abajo de todo de la pantalla.
function calcularPosicion(caja: Caja | null, ancho: number, alto: number) {
  const pantallaAncho = window.innerWidth;
  const pantallaAlto = window.innerHeight;
  if (!caja) {
    return { top: Math.max(MARGEN_PANTALLA, (pantallaAlto - alto) / 2), left: (pantallaAncho - ancho) / 2, flecha: null, flechaX: 0 };
  }
  const centroX = caja.left + caja.width / 2;
  const left = Math.min(Math.max(centroX - ancho / 2, MARGEN_PANTALLA), pantallaAncho - ancho - MARGEN_PANTALLA);
  const abajo = caja.top + caja.height + MARGEN_RESALTE + 14;
  const arriba = caja.top - MARGEN_RESALTE - 14 - alto;
  const flechaX = Math.min(Math.max(centroX - left, 28), ancho - 28);
  if (abajo + alto <= pantallaAlto - MARGEN_PANTALLA) return { top: abajo, left, flecha: 'arriba' as const, flechaX };
  if (arriba >= MARGEN_PANTALLA) return { top: arriba, left, flecha: 'abajo' as const, flechaX };
  return { top: Math.max(MARGEN_PANTALLA, pantallaAlto - alto - MARGEN_PANTALLA), left, flecha: null, flechaX };
}

// Guía paso a paso: oscurece la pantalla, deja "un agujero" de luz alrededor de lo que se
// está explicando y muestra un globito con letra grande y botones para ir avanzando. Puede
// llevar a la persona a otra pantalla, esperar a que se abra un cuadro y pedirle que toque
// el botón de verdad (así aprende haciéndolo). Se ve sobre la pantalla real, no en una lista
// aparte, para que quede clarísimo de qué botón se habla.
export default function RecorridoAyuda({ pasos, titulo, onCerrar }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [paso, setPaso] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [alto, setAlto] = useState(200);
  const globoRef = useRef<HTMLDivElement>(null);
  const navegadoPara = useRef(-1);

  const actual = pasos[paso];
  const esUltimo = paso === pasos.length - 1;
  const ancho = Math.min(360, window.innerWidth - MARGEN_PANTALLA * 2);

  function avanzar() {
    if (esUltimo) onCerrar();
    else setPaso((p) => p + 1);
  }

  // 1) Ir a la pantalla del paso, una sola vez por paso (si la pantalla cambia después por
  //    otra razón no se vuelve a mandar).
  useEffect(() => {
    if (!actual?.ruta || navegadoPara.current === paso) return;
    navegadoPara.current = paso;
    const [rutaSola] = actual.ruta.split('?');
    if (location.pathname !== rutaSola) navigate(actual.ruta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, actual?.ruta]);

  // 2) Buscar lo que se señala. Si todavía no está (la pantalla está cargando o falta abrir un
  //    cuadro) se sigue buscando: apenas aparece, la guía lo marca.
  useEffect(() => {
    if (!actual) return;
    let ultimoEncontrado: Element | null = null;
    const medir = () => {
      const el = actual.selector ? buscarVisible(actual.selector) : null;
      if (el && el !== ultimoEncontrado) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      ultimoEncontrado = el;
      const nueva = el ? aCaja(el.getBoundingClientRect()) : null;
      setCaja((vieja) => (igualCaja(vieja, nueva) ? vieja : nueva));
    };
    medir();
    // Seguido (cada 120 ms), porque la pantalla se acomoda sola un instante después de
    // mostrarse (carga datos, se abre un cuadro con animación) y el marcado tiene que seguirla.
    const intervalo = setInterval(medir, 120);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [actual]);

  // 3) En un paso de "tocá acá", al tocar lo señalado se sigue solo (un instante después, para
  //    que se vea qué pasó).
  useEffect(() => {
    if (!actual?.tocar || !actual.selector) return;
    const selector = actual.selector;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const alTocar = (e: Event) => {
      const el = buscarVisible(selector);
      if (el && e.target instanceof Node && el.contains(e.target)) {
        clearTimeout(timer);
        timer = setTimeout(avanzar, 450);
      }
    };
    document.addEventListener('click', alTocar, true);
    return () => {
      document.removeEventListener('click', alTocar, true);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, actual]);

  // 4) Con Escape se cierra.
  useEffect(() => {
    const alApretar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    document.addEventListener('keydown', alApretar);
    return () => document.removeEventListener('keydown', alApretar);
  }, [onCerrar]);

  // El alto real del globito (depende del texto) para ubicarlo bien.
  useLayoutEffect(() => {
    const h = globoRef.current?.offsetHeight;
    if (h && Math.abs(h - alto) > 1) setAlto(h);
  });

  if (!actual) return null;

  const pos = calcularPosicion(caja, ancho, alto);
  const hueco: Caja | null = caja
    ? {
        top: caja.top - MARGEN_RESALTE,
        left: caja.left - MARGEN_RESALTE,
        width: caja.width + MARGEN_RESALTE * 2,
        height: caja.height + MARGEN_RESALTE * 2,
      }
    : null;
  const esperando = !!actual.selector && !caja;
  // En un paso de "tocá acá" el hueco deja pasar los toques; en los demás, no (para no apretar
  // un botón por error mientras se lee).
  const dejaTocar = !!actual.tocar && !!hueco;

  const estiloLuz: React.CSSProperties = hueco
    ? { ...hueco, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.68)' }
    : { inset: 0, background: 'rgba(15, 23, 42, 0.68)' };
  const bloqueo = 'absolute pointer-events-auto';

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100]" data-recorrido-ayuda data-paso={paso + 1} data-encontrado={caja ? 'si' : 'no'}>
      {/* La luz: lo señalado queda iluminado y el resto oscuro. Sólo se ve, no bloquea. */}
      <div
        className="pointer-events-none absolute rounded-xl ring-4 ring-amber-300 transition-all duration-300 ease-out"
        style={estiloLuz}
      />

      {/* Lo que bloquea los toques: todo menos (si el paso lo pide) lo señalado. */}
      {hueco ? (
        <>
          <div className={bloqueo} style={{ top: 0, left: 0, right: 0, height: Math.max(0, hueco.top) }} />
          <div className={bloqueo} style={{ top: hueco.top + hueco.height, left: 0, right: 0, bottom: 0 }} />
          <div className={bloqueo} style={{ top: hueco.top, left: 0, width: Math.max(0, hueco.left), height: hueco.height }} />
          <div className={bloqueo} style={{ top: hueco.top, left: hueco.left + hueco.width, right: 0, height: hueco.height }} />
          {!dejaTocar && <div className={bloqueo} style={hueco} />}
        </>
      ) : (
        <div className={`${bloqueo} inset-0`} />
      )}

      <div
        ref={globoRef}
        className="pointer-events-auto absolute rounded-2xl bg-white p-5 shadow-2xl transition-[top,left] duration-300 ease-out"
        style={{ top: pos.top, left: pos.left, width: ancho }}
        role="dialog"
        aria-label={actual.titulo}
      >
        {pos.flecha && (
          <div
            className="absolute h-4 w-4 rotate-45 bg-white"
            style={pos.flecha === 'arriba' ? { top: -8, left: pos.flechaX - 8 } : { bottom: -8, left: pos.flechaX - 8 }}
          />
        )}

        <div className="relative flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-violet-600">
            {titulo ?? 'Ayuda'}
          </p>
          <button
            onClick={onCerrar}
            className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Cerrar la ayuda"
            title="Cerrar la ayuda"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <h3 className="relative mt-1 text-lg font-semibold leading-snug text-slate-800">{actual.titulo}</h3>
        <p className="relative mt-1.5 text-base leading-relaxed text-slate-600">{actual.texto}</p>

        {actual.tocar && (
          <p className="relative mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            <Hand className="h-5 w-5 shrink-0" />
            {caja ? 'Tocá lo que está marcado y seguimos.' : 'Cuando aparezca, tocá lo que está marcado.'}
          </p>
        )}
        {esperando && !actual.tocar && (
          <p className="relative mt-3 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Esperando que aparezca en la pantalla...
          </p>
        )}

        <div className="relative mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-label={`Paso ${paso + 1} de ${pasos.length}`}>
            {pasos.length <= 10 ? (
              pasos.map((_, i) => (
                <span
                  key={i}
                  className={`h-2 rounded-full transition-all ${
                    i === paso ? 'w-5 bg-violet-500' : i < paso ? 'w-2 bg-violet-300' : 'w-2 bg-slate-200'
                  }`}
                />
              ))
            ) : (
              <span className="text-xs text-slate-400">
                {paso + 1} de {pasos.length}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {paso > 0 && (
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                onClick={() => setPaso((p) => p - 1)}
              >
                Atrás
              </button>
            )}
            {actual.tocar ? (
              <button
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
                onClick={avanzar}
                title="Si no podés tocarlo, seguí igual"
              >
                {esUltimo ? 'Listo' : 'Seguir sin tocar'}
              </button>
            ) : (
              <button
                className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                onClick={avanzar}
              >
                {esUltimo ? 'Listo' : 'Siguiente'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
