import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Crown, DatabaseBackup, Loader2, X } from 'lucide-react';
import type { CopiaDeOtraPc, EstadoCopia, ResultadoHacerPrincipal } from '@shared/types';
import { useAuth } from '../auth/AuthContext';

// "hace 3 min", "hace 2 h", "ayer 14:30"...
function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 1) return 'recién';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'long', timeStyle: 'short' });
}

// Lo que ve la PC principal: qué PCs conectadas guardan una copia de sus datos.
export function ListaDeCopias({ copias }: { copias: CopiaDeOtraPc[] }) {
  return (
    <div className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        <DatabaseBackup className="h-4 w-4 text-brand-500" />
        Otras PCs y sus copias de los datos
      </h2>
      {copias.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">
          Todavía no hay otra PC conectada. Cada PC que conectes guarda sola una copia de los datos: si cambiás de PC o
          esta se rompe, cualquiera de ellas puede pasar a ser la principal sin perder lo cargado.
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {copias.map((c) => (
              <li key={c.idPc} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-800">{c.nombrePc}</span>
                  <span className="block text-xs text-slate-400">visto {hace(c.ultimaVez)}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    c.alDia
                      ? 'bg-emerald-50 text-emerald-700'
                      : c.ultimaCopia
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {c.alDia ? 'Copia al día' : c.ultimaCopia ? `Copia de ${hace(c.ultimaCopia)}` : 'Sin copia todavía'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            Para cambiar de PC principal: abrí Mis Amores en la PC que va a ser la principal, entrá a Configuración y
            tocá "Hacer que esta PC sea la principal".
          </p>
        </>
      )}
    </div>
  );
}

type Pedido = 'activar' | 'principal' | null;

// Lo que ve una PC conectada: cómo anda su copia de los datos y el botón para
// pasar a ser la principal.
export function CopiaYPrincipal() {
  const [estado, setEstado] = useState<EstadoCopia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido>(null);
  const puenteNuevo = (window.escritorio?.versionPuente ?? 0) >= 2;

  const cargar = useCallback(() => {
    window.escritorio
      ?.estadoCopia()
      .then((e) => {
        setEstado(e);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer el estado de la copia'));
  }, []);

  useEffect(() => {
    if (!puenteNuevo) return;
    cargar();
    const t = setInterval(cargar, 10_000);
    return () => clearInterval(t);
  }, [cargar, puenteNuevo]);

  if (!puenteNuevo) {
    return (
      <div className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <DatabaseBackup className="h-4 w-4 text-brand-500" />
          Copia de los datos
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Esta PC tiene que actualizarse para guardar la copia de los datos y poder pasar a ser la principal. Buscá
          actualizaciones desde el menú de la izquierda.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-800">
          <DatabaseBackup className="h-4 w-4 text-brand-500" />
          Copia de los datos en esta PC
        </h2>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {estado && !estado.activa && (
          <>
            <p className="mt-1 text-sm text-slate-500">
              Esta PC todavía no guarda una copia de los datos de la principal. Activala con una cuenta de
              administradora: queda andando sola, sin volver a pedir contraseñas.
            </p>
            <button className="btn-primary mt-4" onClick={() => setPedido('activar')}>
              <DatabaseBackup className="h-4 w-4" />
              Activar la copia de los datos
            </button>
          </>
        )}

        {estado?.activa && (
          <>
            <p className="mt-1 text-sm text-slate-500">
              {estado.copiando ? (
                'Actualizando la copia...'
              ) : estado.ultimaCopia ? (
                <>
                  {estado.alDia ? (
                    <b className="text-emerald-700">La copia está al día con la principal.</b>
                  ) : (
                    <>
                      Última copia: <b className="text-slate-700">{hace(estado.ultimaCopia)}</b>.
                    </>
                  )}
                  {estado.resumen && (
                    <>
                      {' '}
                      Tiene {estado.resumen.articulos} productos, {estado.resumen.clientes} clientes y{' '}
                      {estado.resumen.ventas} ventas.
                    </>
                  )}{' '}
                  Se actualiza sola cada vez que se carga algo.
                </>
              ) : (
                'Todavía no se hizo la primera copia: se hace sola en un momento.'
              )}
            </p>
            {estado.error && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {estado.error}
              </p>
            )}
          </>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-500">
            ¿Cambiaste de PC o la principal ya no está? Esta PC puede pasar a guardar los datos y ser la principal.
          </p>
          <button className="btn-secondary mt-3" onClick={() => setPedido('principal')} disabled={!estado}>
            <Crown className="h-4 w-4" />
            Hacer que esta PC sea la principal
          </button>
        </div>
      </div>

      {pedido === 'activar' && (
        <ModalCredenciales
          titulo="Activar la copia de los datos"
          textoBoton="Activar"
          onCerrar={() => setPedido(null)}
          onConfirmar={async (usuario, password) => {
            setEstado(await window.escritorio!.activarCopia({ usuario, password }));
            setPedido(null);
          }}
        >
          <p className="text-sm text-slate-600">
            Escribí la cuenta de administradora de <b>{estado?.nombrePrincipal ?? 'la PC principal'}</b>. Se usa una sola
            vez para dejar la copia andando.
          </p>
        </ModalCredenciales>
      )}

      {pedido === 'principal' && estado && (
        <ModalHacerPrincipal estado={estado} onCerrar={() => setPedido(null)} />
      )}
    </>
  );
}

function ModalCredenciales({
  titulo,
  textoBoton,
  onCerrar,
  onConfirmar,
  children,
  deshabilitarSi,
}: {
  titulo: string;
  textoBoton: string;
  onCerrar: () => void;
  onConfirmar: (usuario: string, password: string) => Promise<void>;
  children: ReactNode;
  deshabilitarSi?: boolean;
}) {
  const { sesion } = useAuth();
  const [usuario, setUsuario] = useState(sesion?.usuario ?? '');
  const [password, setPassword] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setTrabajando(true);
    try {
      await onConfirmar(usuario, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo completar');
      setTrabajando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <form
        onSubmit={enviar}
        className="flex max-h-[90vh] w-full max-w-md animate-scale-in flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">{titulo}</h2>
          <button type="button" onClick={onCerrar} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" disabled={trabajando}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {children}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              className="input"
              placeholder="Usuario"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="off"
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" className="btn-secondary" onClick={onCerrar} disabled={trabajando}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={trabajando || deshabilitarSi}>
            {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
            {trabajando ? 'Trabajando...' : textoBoton}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function ModalHacerPrincipal({ estado, onCerrar }: { estado: EstadoCopia; onCerrar: () => void }) {
  const [acepta, setAcepta] = useState(false);
  const [resultado, setResultado] = useState<ResultadoHacerPrincipal | null>(null);
  const nombre = estado.nombrePrincipal ?? 'la PC principal';
  const sinCopia = !estado.principalAlcanzable && !estado.ultimaCopia;

  if (resultado) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md animate-scale-in space-y-4 rounded-xl bg-white p-6 text-center shadow-xl">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <div>
            <p className="font-semibold text-slate-800">¡Listo! Esta PC ya es la principal.</p>
            <p className="mt-1 text-sm text-slate-500">La app se reinicia sola en unos segundos.</p>
          </div>
          {resultado.usoCopia ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
              Se usó la copia del {resultado.fechaCopia ? fechaLarga(resultado.fechaCopia) : 'último momento guardado'}.
              Si <b>{resultado.nombreOtraPc ?? 'la otra PC'}</b> vuelve a prenderse, hay que conectarla a esta desde
              Configuración (lo que cargó después de esa fecha se junta en ese paso).
            </p>
          ) : (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-800">
              <b>{resultado.nombreOtraPc ?? 'La otra PC'}</b> quedó conectada a esta y los datos están al día. Los
              celulares que usaban la dirección anterior pasan solos a esta.
            </p>
          )}
        </div>
      </div>,
      document.body
    );
  }

  return (
    <ModalCredenciales
      titulo="Hacer que esta PC sea la principal"
      textoBoton="Pasar la principal a esta PC"
      onCerrar={onCerrar}
      deshabilitarSi={sinCopia || (!estado.principalAlcanzable && !acepta)}
      onConfirmar={async (usuario, password) => {
        setResultado(
          await window.escritorio!.hacerPrincipal({
            usuario,
            password,
            aceptaCopiaVieja: !estado.principalAlcanzable && acepta,
          })
        );
      }}
    >
      {estado.principalAlcanzable ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            <b>{nombre}</b> contesta. Se pasan sus datos más recientes a esta PC (no se pierde nada) y <b>{nombre}</b>{' '}
            queda conectada a esta.
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Mientras se pasan los datos, {nombre} no acepta cambios: son unos segundos. Lo que esta PC tenía en su base
            propia se guarda en "Documentos\Mis Amores - Respaldos".
          </p>
        </div>
      ) : sinCopia ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {nombre} no contesta y esta PC todavía no tiene una copia de los datos, así que no se puede pasar la principal.
        </p>
      ) : (
        <div className="space-y-3 text-sm text-slate-600">
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <b>{nombre}</b> no contesta. Se va a usar la última copia de los datos, del{' '}
              <b>{estado.ultimaCopia ? fechaLarga(estado.ultimaCopia) : '?'}</b>. Lo que se cargó después no va a estar.
            </span>
          </p>
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
            Entiendo que se usa esa copia y no los últimos datos.
          </label>
        </div>
      )}
    </ModalCredenciales>
  );
}
