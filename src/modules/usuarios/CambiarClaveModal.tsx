import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, KeyRound, X } from 'lucide-react';
import CampoContrasena from '../../components/CampoContrasena';

const LARGO_MINIMO = 4;

// Cada persona cambia su propia clave (antes sólo la podía cambiar una administradora). Pide la
// actual: si no, cualquiera con el celular de otra en la mano se la podría cambiar.
export default function CambiarClaveModal({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (nueva.length < LARGO_MINIMO) {
      setError(`La clave nueva tiene que tener al menos ${LARGO_MINIMO} letras o números.`);
      return;
    }
    if (nueva !== repetida) {
      setError('Las dos claves nuevas no son iguales: escribilas de nuevo.');
      return;
    }
    if (nueva === actual) {
      setError('La clave nueva tiene que ser distinta de la que tenés ahora.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await window.api.usuarios.cambiarMiPassword(actual, nueva);
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la clave');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl" data-cambiar-clave>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="flex items-center gap-2 font-semibold text-slate-800">
            <KeyRound className="h-5 w-5 text-brand-500" />
            Cambiar mi clave
          </h2>
          <button onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {listo ? (
          <div className="space-y-4 px-5 py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="text-base font-medium text-slate-800">Listo: tu clave cambió.</p>
            <p className="text-sm text-slate-500">
              Desde ahora entrá con la clave nueva. Si tenías el programa abierto en otro aparato, ahí te va a pedir
              la clave de nuevo.
            </p>
            <button className="btn-primary w-full justify-center" onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={guardar} className="space-y-4 px-5 py-4">
            <div data-tour="clave-actual">
              <label className="label">Tu clave de ahora</label>
              <CampoContrasena
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div data-tour="clave-nueva">
              <label className="label">La clave nueva</label>
              <CampoContrasena
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                autoComplete="new-password"
                minLength={LARGO_MINIMO}
                required
              />
              <p className="mt-1 text-xs text-slate-400">
                Mínimo {LARGO_MINIMO} letras o números. Tocá el ojito para verla y comprobar que quedó bien.
              </p>
            </div>
            <div>
              <label className="label">La clave nueva, otra vez</label>
              <CampoContrasena
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                autoComplete="new-password"
                minLength={LARGO_MINIMO}
                required
              />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-secondary" onClick={onCerrar}>
                Cancelar
              </button>
              <button data-tour="clave-guardar" type="submit" className="btn-primary" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Cambiar mi clave'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
