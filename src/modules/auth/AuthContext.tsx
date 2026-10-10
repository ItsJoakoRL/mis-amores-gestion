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
      .finally(() => setCargando(false));
  }, []);

  // En el celular (o la PC conectada), si la PC principal avisa que la
  // sesión ya no vale, se vuelve al login (ver webApiClient.ts).
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
      setSesion(await window.api.auth.sesionActual());
    } catch {
      // Si no se pudo consultar, sigue la sesión que había.
    }
  }, []);

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
