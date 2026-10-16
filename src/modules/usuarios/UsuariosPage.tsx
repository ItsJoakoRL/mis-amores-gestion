import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, Pencil, Trash2, Info, Wand2, Copy, Check, CheckCircle2 } from 'lucide-react';
import { etiquetaRol, type Genero, type Rol, type Usuario } from '@shared/types';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';
import CampoContrasena from '../../components/CampoContrasena';
import { copiarAlPortapapeles, generarClave } from '../../utils/claves';

export default function UsuariosPage() {
  const { sesion, refrescarSesion } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [error, setError] = useState<string | null>(null);

  function cargar() {
    window.api.usuarios.list().then(setUsuarios).catch((err) => setError(err.message));
  }

  useEffect(cargar, []);

  async function eliminar(u: Usuario) {
    const confirmado = confirm(
      `¿Eliminar a ${u.nombre} para siempre?\n\nEsto no se puede deshacer. Las ventas y pagos que ya registró quedan en el historial, pero sin poder mostrar su nombre.`
    );
    if (!confirmado) return;
    try {
      await window.api.usuarios.eliminar(u.id);
      cargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar el usuario');
    }
  }

  return (
    <div className="mx-auto max-w-3xl animate-slide-up p-4 pb-24 sm:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            Usuarios
            <BotonAyuda seccion="Usuarios" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Quién puede entrar al sistema y con qué rol.</p>
        </div>
        <button data-tour="usr-nuevo" className="btn-primary shrink-0" onClick={() => setMostrarForm(true)}>
          <UserPlus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      <p className="mb-5 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>
          Las contraseñas se guardan cifradas, así que <strong>no se pueden ver</strong> (ni siquiera desde acá). Para
          ponerle una nueva a alguien, tocá <strong>Editar</strong> y escribila (o generala) en el campo de contraseña.
        </span>
      </p>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div data-tour="usr-lista" className="card divide-y divide-slate-100">
        {usuarios.map((u) => (
          <div
            key={u.id}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 font-medium text-slate-800">
                {u.nombre}
                {u.id === sesion?.id && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600">
                    Sos vos
                  </span>
                )}
                {!u.activo && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    Desactivada
                  </span>
                )}
              </p>
              <p className="break-all text-xs text-slate-400">
                @{u.usuario} · {etiquetaRol(u.rol, u.genero)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                onClick={() => setEditando(u)}
                className="flex items-center gap-1.5 py-1 text-sm text-slate-500 hover:text-brand-600"
                title="Editar datos"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </button>
              <label
                className="flex items-center gap-2 py-1 text-sm text-slate-500"
                title={u.id === sesion?.id ? 'No podés desactivar tu propia cuenta mientras la estás usando' : undefined}
              >
                <input
                  type="checkbox"
                  checked={u.activo}
                  disabled={u.id === sesion?.id}
                  onChange={async (e) => {
                    try {
                      await window.api.usuarios.setActivo(u.id, e.target.checked);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
                    } finally {
                      cargar();
                    }
                  }}
                />
                Activo
              </label>
              {u.id !== sesion?.id && (
                <button
                  onClick={() => eliminar(u)}
                  className="flex items-center gap-1.5 py-1 text-sm text-slate-400 hover:text-red-600"
                  title="Eliminar usuario"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sm:hidden">Eliminar</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {mostrarForm && (
        <NuevoUsuarioModal
          onCerrar={() => setMostrarForm(false)}
          onCreado={() => {
            setMostrarForm(false);
            cargar();
          }}
        />
      )}

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            // Si se editó a sí misma, el nombre y el rol del menú tienen que actualizarse.
            if (editando.id === sesion?.id) refrescarSesion();
            setEditando(null);
            cargar();
          }}
        />
      )}

    </div>
  );
}

// Los cuadros de esta pantalla: se pueden desplazar si el teclado del celular
// les saca lugar.
const CAJA_MODAL =
  'max-h-[90dvh] w-full max-w-sm animate-scale-in overflow-y-auto rounded-xl bg-white shadow-xl';

// "Generar una" + cómo queda a la vista: para no tener que inventar una
// contraseña, y poder leerla o copiarla antes de pasársela a la persona.
function GeneradorDeClave({ valor, onGenerar }: { valor: string; onGenerar: (clave: string) => void }) {
  const [generada, setGenerada] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    if (!generada) return;
    setCopiada(await copiarAlPortapapeles(generada));
    setTimeout(() => setCopiada(false), 2000);
  }

  const mostrar = generada !== null && valor === generada;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => {
          const nueva = generarClave();
          setGenerada(nueva);
          onGenerar(nueva);
        }}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
      >
        <Wand2 className="h-3.5 w-3.5" />
        Generar una contraseña
      </button>
      {mostrar && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
          <code className="select-all font-mono text-base font-semibold tracking-wide text-brand-800">{generada}</code>
          <button
            type="button"
            onClick={copiar}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-white"
          >
            {copiada ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiada ? 'Copiada' : 'Copiar'}
          </button>
        </div>
      )}
    </div>
  );
}

function EditarUsuarioModal({
  usuario,
  onCerrar,
  onGuardado,
}: {
  usuario: Usuario;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(usuario.nombre);
  const [nombreUsuario, setNombreUsuario] = useState(usuario.usuario);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [genero, setGenero] = useState<Genero>(usuario.genero);
  // Opcional: si se escribe una, se le cambia la contraseña junto con los datos.
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Los datos ya quedaron guardados (por si falla recién lo de la contraseña).
  const [datosGuardados, setDatosGuardados] = useState(false);
  // Cuando se cambió la contraseña: queda a la vista para pasársela a la persona.
  const [contrasenaNueva, setContrasenaNueva] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await window.api.usuarios.actualizar(usuario.id, nombre.trim(), nombreUsuario.trim(), rol, genero);
      setDatosGuardados(true);
      if (password) {
        await window.api.usuarios.resetPassword(usuario.id, password);
        setContrasenaNueva(password);
      } else {
        onGuardado();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios');
    } finally {
      setGuardando(false);
    }
  }

  async function copiar() {
    if (!contrasenaNueva) return;
    setCopiada(await copiarAlPortapapeles(contrasenaNueva));
    setTimeout(() => setCopiada(false), 2000);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className={CAJA_MODAL}>
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">
            {contrasenaNueva ? 'Cambios guardados' : 'Editar usuario'}
          </h2>
        </div>

        {contrasenaNueva ? (
          <div className="space-y-4 px-5 py-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <div>
              <p className="text-sm text-slate-500">La contraseña nueva de {nombre.trim() || usuario.nombre} es:</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-brand-50 px-3 py-3">
                <code className="select-all break-all text-left font-mono text-lg font-semibold tracking-wide text-brand-800">
                  {contrasenaNueva}
                </code>
                <button
                  type="button"
                  onClick={copiar}
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-white"
                >
                  {copiada ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiada ? 'Copiada' : 'Copiar'}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Anotala o pasásela ahora: queda guardada cifrada y no se puede volver a ver. Si estaba con la sesión
              abierta en algún lado, va a tener que entrar de nuevo.
            </p>
            <button type="button" className="btn-primary w-full" onClick={onGuardado}>
              Listo
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            <div>
              <label className="label">Nombre y apellido</label>
              <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="label">Usuario (para iniciar sesión)</label>
              <input
                className="input"
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Rol</label>
                <select className="input" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                  <option value="empleado">{etiquetaRol('empleado', genero)}</option>
                  <option value="admin">{etiquetaRol('admin', genero)}</option>
                </select>
              </div>
              <div>
                <label className="label">Género</label>
                <select className="input" value={genero} onChange={(e) => setGenero(e.target.value as Genero)}>
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                </select>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="label">Contraseña nueva (si no la querés cambiar, dejala vacía)</label>
              <CampoContrasena
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={4}
                placeholder="Dejala vacía para no cambiarla"
              />
              <GeneradorDeClave valor={password} onGenerar={setPassword} />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={datosGuardados ? onGuardado : onCerrar}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={guardando}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

function NuevoUsuarioModal({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: () => void }) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<Rol>('empleado');
  const [genero, setGenero] = useState<Genero>('F');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await window.api.usuarios.crear(nombre.trim(), usuario.trim(), password, rol, genero);
      onCreado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className={CAJA_MODAL}>
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Nuevo usuario</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label">Nombre y apellido</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Usuario (para iniciar sesión)</label>
            <input
              className="input"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <CampoContrasena
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={4}
              required
            />
            <GeneradorDeClave valor={password} onGenerar={setPassword} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Rol</label>
              <select className="input" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
                <option value="empleado">{etiquetaRol('empleado', genero)}</option>
                <option value="admin">{etiquetaRol('admin', genero)}</option>
              </select>
            </div>
            <div>
              <label className="label">Género</label>
              <select className="input" value={genero} onChange={(e) => setGenero(e.target.value as Genero)}>
                <option value="F">Femenino</option>
                <option value="M">Masculino</option>
              </select>
            </div>
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
