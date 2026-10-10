import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { UserPlus, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { etiquetaRol, type Genero, type Rol, type Usuario } from '@shared/types';
import { useAuth } from '../auth/AuthContext';
import BotonAyuda from '../../components/BotonAyuda';

export default function UsuariosPage() {
  const { sesion, refrescarSesion } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [reseteando, setReseteando] = useState<Usuario | null>(null);
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
    <div className="mx-auto max-w-3xl animate-slide-up p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold text-slate-800">
            Usuarios
            <BotonAyuda seccion="Usuarios" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Quién puede entrar al sistema y con qué rol.</p>
        </div>
        <button data-tour="usr-nuevo" className="btn-primary" onClick={() => setMostrarForm(true)}>
          <UserPlus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div data-tour="usr-lista" className="card divide-y divide-slate-100">
        {usuarios.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="font-medium text-slate-800">{u.nombre}</p>
              <p className="text-xs text-slate-400">
                @{u.usuario} · {etiquetaRol(u.rol, u.genero)}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEditando(u)}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600"
                title="Editar datos"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </button>
              <button
                onClick={() => setReseteando(u)}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600"
                title="Cambiar contraseña"
              >
                <KeyRound className="h-4 w-4" />
                Contraseña
              </button>
              <label
                className="flex items-center gap-2 text-sm text-slate-500"
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
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-600"
                  title="Eliminar usuario"
                >
                  <Trash2 className="h-4 w-4" />
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

      {reseteando && (
        <ResetPasswordModal
          usuario={reseteando}
          onCerrar={() => setReseteando(null)}
          onListo={() => setReseteando(null)}
        />
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
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await window.api.usuarios.actualizar(usuario.id, nombre.trim(), nombreUsuario.trim(), rol, genero);
      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los cambios');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Editar usuario</h2>
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
              value={nombreUsuario}
              onChange={(e) => setNombreUsuario(e.target.value)}
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

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={onCerrar}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function ResetPasswordModal({
  usuario,
  onCerrar,
  onListo,
}: {
  usuario: Usuario;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await window.api.usuarios.resetPassword(usuario.id, password);
      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña');
    } finally {
      setGuardando(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-800">Nueva contraseña para {usuario.nombre}</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label">Contraseña nueva</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
              required
              autoFocus
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
      <div className="w-full max-w-sm animate-scale-in rounded-xl bg-white shadow-xl">
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
            <input className="input" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={4}
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
