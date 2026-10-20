import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X, Send } from 'lucide-react';
import Mascota from './Mascota';

interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
}

const PREGUNTAS_SUGERIDAS = [
  '¿Cuánto vendí hoy?',
  '¿Cuánto vendí ayer?',
  '¿Qué tiene poco stock?',
  '¿Quién me debe más?',
  '¿Cuál es el producto más vendido?',
  '¿Qué rubro vende más?',
  '¿Cómo estuvo el día?',
  '¿Cuánto vendí en efectivo hoy?',
];

// El asistente NO usa ningún servicio de IA externo — reconoce preguntas
// comunes por patrones y responde con datos reales de la base (ver
// electron/repositories/asistente.ts). Cero costo, cero conexión externa.
export default function AsistenteChat() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, pensando]);

  async function enviarPregunta(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || pensando) return;
    setMensajes((m) => [...m, { rol: 'usuario', texto: limpia }]);
    setTexto('');
    setPensando(true);
    try {
      const respuesta = await window.api.asistente.preguntar(limpia);
      setMensajes((m) => [...m, { rol: 'asistente', texto: respuesta.texto }]);
    } catch (err) {
      setMensajes((m) => [
        ...m,
        { rol: 'asistente', texto: err instanceof Error ? err.message : 'No pude responder eso, probá de nuevo.' },
      ]);
    } finally {
      setPensando(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    enviarPregunta(texto);
  }

  return (
    <>
      {abierto && (
        <div className="fixed bottom-24 right-6 z-40 flex h-[30rem] w-full max-w-sm animate-scale-in flex-col overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-2xl sm:right-6">
          <div className="flex items-center justify-between border-b border-slate-200 bg-brand-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <Mascota tamanio="sm" className="shrink-0" />
              <div>
                <p className="text-sm font-semibold leading-tight">Asistente</p>
                <p className="text-[11px] leading-tight text-white/80">Responde con tus datos, sin IA externa</p>
              </div>
            </div>
            <button
              onClick={() => setAbierto(false)}
              className="rounded-lg p-1 text-white/80 hover:bg-surface/10 hover:text-white"
              aria-label="Cerrar asistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {mensajes.length === 0 && (
              <div className="flex items-start gap-2">
                <Mascota tamanio="sm" quieto className="mt-0.5 shrink-0" />
                <p className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-600">
                  ¡Hola! Preguntame algo sobre el negocio — ventas, stock, clientes o precios.
                </p>
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex items-end gap-2 ${m.rol === 'usuario' ? 'justify-end' : 'justify-start'}`}>
                {m.rol === 'asistente' && <Mascota tamanio="sm" quieto className="mb-0.5 shrink-0" />}
                <div
                  className={`max-w-[80%] animate-slide-up rounded-2xl px-3 py-2 text-sm ${
                    m.rol === 'usuario'
                      ? 'rounded-br-sm bg-brand-600 text-white'
                      : 'rounded-bl-sm bg-slate-100 text-slate-700'
                  }`}
                >
                  {m.texto}
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
        onClick={() => setAbierto((v) => !v)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl active:scale-95"
        title="Asistente"
        aria-label={abierto ? 'Cerrar asistente' : 'Abrir asistente'}
      >
        {abierto ? <X className="h-6 w-6 text-white" /> : <Mascota tamanio="lg" />}
      </button>
    </>
  );
}
