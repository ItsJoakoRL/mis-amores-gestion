import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, Send, RotateCcw } from 'lucide-react';
import type { RespuestaAsistente } from '@shared/types';
import Mascota from './Mascota';

interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
  /** Una aclaración aparte (ej. "no pude consultar a la IA, te contesto con el asistente simple"). */
  aviso?: string;
  /** Mientras la respuesta "se escribe" (la carita habla en silencio). */
  escribiendo?: boolean;
}

// Quien tiene activado "reducir movimientos" (Windows, celular) ve el texto entero de una vez y la carita quieta.
const sinMovimiento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// Muestra el texto "escribiéndose" de a poco (~2 segundos como mucho). El texto ENTERO está siempre en la página (lo que
// todavía no se escribió es transparente): la burbuja no cambia de tamaño mientras tanto y quien usa un lector de pantalla
// lo recibe completo. Usa un temporizador y no animationFrame: en una ventana escondida o minimizada igual termina.
function TextoQueSeEscribe({ texto, activo, onFin }: { texto: string; activo: boolean; onFin: () => void }) {
  const [escritos, setEscritos] = useState(activo ? 0 : texto.length);
  const alTerminar = useRef(onFin);
  alTerminar.current = onFin;

  useEffect(() => {
    if (!activo) {
      setEscritos(texto.length);
      return;
    }
    const total = texto.length;
    const duracion = Math.min(2400, Math.max(700, total * 20));
    const inicio = Date.now();
    const reloj = setInterval(() => {
      const avance = Math.min(1, (Date.now() - inicio) / duracion);
      setEscritos(Math.ceil(avance * total));
      if (avance >= 1) {
        clearInterval(reloj);
        alTerminar.current();
      }
    }, 30);
    return () => clearInterval(reloj);
  }, [activo, texto]);

  return (
    <>
      <span>{texto.slice(0, escritos)}</span>
      <span className="select-none text-transparent">{texto.slice(escritos)}</span>
    </>
  );
}

const SUBTITULO: Record<NonNullable<RespuestaAsistente['modo']> | 'nuevo', string> = {
  nuevo: 'Preguntale lo que quieras sobre el negocio',
  ia: 'Contesta una IA con los datos de tu negocio',
  simple: 'Asistente simple (sin IA)',
};

const PREGUNTAS_SUGERIDAS = [
  '¿Cuánto vendí hoy?',
  '¿Vendí más que ayer?',
  '¿Qué se vendió hoy?',
  '¿Quién me debe?',
  '¿Qué tengo que reponer?',
  '¿Qué día vendí más?',
  '¿Cuál es el producto más vendido?',
  '¿Qué tengo pendiente?',
];

// Con la clave de la IA cargada (Configuración) contesta una IA de verdad con los datos
// reales del negocio; si no hay clave o no hay internet, contesta el asistente simple, que
// reconoce preguntas comunes por patrones (ver electron/asistenteIa.ts y
// electron/repositories/asistente.ts).
// La carita sonríe y, cuando contesta, "habla en silencio": mueve la boca mientras la respuesta se va escribiendo.
export default function AsistenteChat() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [modo, setModo] = useState<NonNullable<RespuestaAsistente['modo']> | 'nuevo'>('nuevo');
  // La carita saluda (habla en silencio) un ratito al abrir el chat vacío.
  const [saludando, setSaludando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  // Cuenta las charlas: si se empieza una nueva mientras la IA piensa, su respuesta tardía no se mete en la nueva.
  const charlaRef = useRef(0);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, pensando]);

  // Al cerrar el panel se corta lo que se estaba "escribiendo" (al volver a abrirlo está todo el texto).
  useEffect(() => {
    if (abierto) return;
    setSaludando(false);
    setMensajes((ms) => (ms.some((m) => m.escribiendo) ? ms.map((m) => (m.escribiendo ? { ...m, escribiendo: false } : m)) : ms));
  }, [abierto]);

  const hablando = saludando || mensajes.some((m) => m.escribiendo);

  function alternar() {
    if (!abierto && !sinMovimiento()) setSaludando(true);
    setAbierto(!abierto);
  }

  function dejarDeEscribir(indice: number) {
    setMensajes((ms) => ms.map((m, i) => (i === indice && m.escribiendo ? { ...m, escribiendo: false } : m)));
  }

  async function enviarPregunta(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || pensando) return;
    // Lo que ya se habló (sin la pregunta nueva): así la IA se acuerda de "¿y ayer?".
    const anteriores = mensajes.map(({ rol, texto: t }) => ({ rol, texto: t }));
    const charla = charlaRef.current;
    // Si la carita todavía estaba "hablando", se calla: ahora le toca escuchar.
    setSaludando(false);
    setMensajes((m) => [...m.map((x) => (x.escribiendo ? { ...x, escribiendo: false } : x)), { rol: 'usuario', texto: limpia }]);
    setTexto('');
    setPensando(true);
    try {
      const respuesta = await window.api.asistente.preguntar(limpia, anteriores);
      if (charla !== charlaRef.current) return;
      if (respuesta.modo) setModo(respuesta.modo);
      setMensajes((m) => [...m, { rol: 'asistente', texto: respuesta.texto, aviso: respuesta.aviso, escribiendo: !sinMovimiento() }]);
    } catch (err) {
      if (charla !== charlaRef.current) return;
      setMensajes((m) => [
        ...m,
        { rol: 'asistente', texto: err instanceof Error ? err.message : 'No pude responder eso, probá de nuevo.' },
      ]);
    } finally {
      if (charla === charlaRef.current) setPensando(false);
    }
  }

  function charlaNueva() {
    charlaRef.current++;
    setMensajes([]);
    setModo('nuevo');
    setPensando(false);
    setSaludando(!sinMovimiento());
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    enviarPregunta(texto);
  }

  return (
    <>
      {abierto && (
        // En el celular el panel se estira entre dos márgenes (antes, con `w-full max-w-sm` y `right-6`, se salía de la pantalla
        // por la izquierda); desde `sm` queda a la derecha con ancho fijo. El alto máximo evita que se corte con el celular acostado.
        <div className="fixed bottom-24 left-3 right-3 z-40 flex h-[30rem] max-h-[calc(100dvh-7rem)] animate-scale-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl sm:left-auto sm:right-6 sm:w-full sm:max-w-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-brand-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <Mascota tamanio="sm" habla={hablando} className="shrink-0" />
              <div>
                <p className="text-sm font-semibold leading-tight">Asistente</p>
                <p className="text-[11px] leading-tight text-white/80">{SUBTITULO[modo]}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {mensajes.length > 0 && (
                <button
                  onClick={charlaNueva}
                  className="rounded-lg p-1 text-white/80 hover:bg-surface/10 hover:text-white"
                  aria-label="Empezar una charla nueva"
                  title="Charla nueva"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={alternar}
                className="rounded-lg p-1 text-white/80 hover:bg-surface/10 hover:text-white"
                aria-label="Cerrar asistente"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {mensajes.length === 0 && (
              <div className="flex items-start gap-2">
                <Mascota tamanio="sm" quieto habla={saludando} className="mt-0.5 shrink-0" />
                <p className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-600">
                  <TextoQueSeEscribe
                    texto="¡Hola! Preguntame algo sobre el negocio — ventas, stock, clientes o precios."
                    activo={saludando}
                    onFin={() => setSaludando(false)}
                  />
                </p>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex items-end gap-2 ${m.rol === 'usuario' ? 'justify-end' : 'justify-start'}`}>
                {m.rol === 'asistente' && <Mascota tamanio="sm" quieto habla={m.escribiendo === true} className="mb-0.5 shrink-0" />}
                <div
                  className={`max-w-[80%] animate-slide-up whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                    m.rol === 'usuario'
                      ? 'rounded-br-sm bg-brand-600 text-white'
                      : 'rounded-bl-sm bg-slate-100 text-slate-700'
                  }`}
                >
                  {m.rol === 'asistente' ? (
                    <TextoQueSeEscribe texto={m.texto} activo={m.escribiendo === true} onFin={() => dejarDeEscribir(i)} />
                  ) : (
                    m.texto
                  )}
                  {m.aviso && <p className="mt-1.5 border-t border-slate-200 pt-1.5 text-xs text-slate-500">{m.aviso}</p>}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex items-end gap-2">
                <Mascota tamanio="sm" pensando className="mb-0.5 shrink-0" />
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-400">
                  Pensando...
                </div>
              </div>
            )}
            <div ref={finRef} />
          </div>

          {/* Franja de sugerencias, siempre visible (no sólo al abrir el chat
              por primera vez) — así siempre hay algo para tocar sin tener
              que acordarse qué se le puede preguntar. */}
          <div className="flex gap-1.5 overflow-x-auto border-t border-slate-100 px-3 py-2">
            {PREGUNTAS_SUGERIDAS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => enviarPregunta(p)}
                disabled={pensando}
                className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-200 p-3">
            <input
              className="input"
              placeholder="Escribí tu pregunta..."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-primary !px-3" disabled={!texto.trim() || pensando}>
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        onClick={alternar}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95"
        title="Asistente"
        aria-label={abierto ? 'Cerrar asistente' : 'Abrir asistente'}
      >
        {abierto ? <X className="h-6 w-6 text-white" /> : <Mascota tamanio="lg" murmura />}
      </button>
    </>
  );
}
