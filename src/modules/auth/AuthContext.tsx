import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SesionActual } from '@shared/types';
import { EVENTO_SESION_VENCIDA } from '../../webApiClient';

interface AuthContextValue {
  sesion: SesionActual | null;
  cargando: boolean;
  login: (usuario: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Vuelve a pedir la sesión (ej. después de que la admin editó sus propios datos). */
  refrescarSesion: () => Promise<void>;
  esAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<SesionActual | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    window.api.auth
      .sesionActual()
      .then(setSesion)
      .catch(() => setSesion(null))
      .finally(() => setCargando(false));
  }, []);

  // En el celular, si la PC avisa que la sesión ya no vale, se vuelve al
  // login (ver webApiClient.ts).
  useEffect(() => {
    const alVencer = () => setSesion(null);
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer);
  }, []);

  const login = useCallback(async (usuario: string, password: string) => {
    const nuevaSesion = await window.api.auth.login(usuario, password);
    setSesion(nuevaSesion);
  }, []);

  const logout = useCallback(async () => {
    await window.api.auth.logout();
    setSesion(null);
  }, []);

  const refrescarSesion = useCallback(async () => {
    try {
      const nueva = await window.api.auth.sesionActual();
      // Si no cambió nada se deja el mismo objeto: esto corre con cada aviso
      // de datos cambiados y no tiene que volver a dibujar toda la app.
      setSesion((actual) => (JSON.stringify(actual) === JSON.stringify(nueva) ? actual : nueva));
    } catch {
      // Si no se pudo consultar, sigue la sesión que había.
    }
  }, []);

  // Si otra PC desactiva o le cambia el rol a quien está usando esta, la PC ya
  // lo sabe (ver refrescarSesionDeEscritorio en main.ts): acá se vuelve a
  // pedir la sesión para que se vea — la pantalla de ingreso, o los permisos
  // nuevos — en vez de seguir como si nada hasta cerrar sesión a mano. Sólo en
  // la PC: el celular ya vuelve al login solo (EVENTO_SESION_VENCIDA) y no
  // conviene abrirle una conexión en vivo más.
  const haySesion = sesion !== null;
  useEffect(() => {
    if (!haySesion || !/Electron/i.test(navigator.userAgent)) return;
    const dejarDeEscuchar = window.api.sistema.onDatosCambio?.(() => void refrescarSesion());
    return () => dejarDeEscuchar?.();
  }, [haySesion, refrescarSesion]);

  return (
    <AuthContext.Provider
      value={{ sesion, cargando, login, logout, refrescarSesion, esAdmin: sesion?.rol === 'admin' }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return ctx;
}
