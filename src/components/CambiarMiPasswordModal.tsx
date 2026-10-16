import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2 } from 'lucide-react';
import CampoContrasena from './CampoContrasena';

// Cada persona cambia su propia contraseña. Tiene que escribir la actual: así
// nadie con el celular de otra en la mano se la puede cambiar.
export default function CambiarMiPasswordModal({ onCerrar }: { onCerrar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetida) {
      setError('Las dos contraseñas nuevas no coinciden.');
      return;
    }
    setGuardando(true);
    try {
      await window.api.usuarios.cambiarMiPassword(actual, nueva);
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-sm animate-scale-in overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Cambiar mi contraseña</h2>
        </div>

        {listo ? (
          <div className="space-y-4 px-5 py-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="text-sm text-slate-600">
              Listo, tu contraseña quedó cambiada. La próxima vez que entres, usá la nueva.
            </p>
            <button type="button" className="btn-primary w-full" onClick={onCerrar}>
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            <div>
              <label className="label">Tu contraseña de ahora</label>
              <CampoContrasena
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Contraseña nueva</label>
              <CampoContrasena
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                autoComplete="new-password"
                minLength={4}
                required
              />
            </div>
            <div>
              <label className="label">Repetí la contraseña nueva</label>
              <CampoContrasena
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
                autoComplete="new-password"
                minLength={4}
                required
              />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={onCerrar}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Cambiar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
