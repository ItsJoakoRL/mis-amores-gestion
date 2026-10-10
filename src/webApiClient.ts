// Cuando la app corre en el navegador de un celular (no dentro de Electron),
// window.api no existe — este archivo arma un reemplazo con exactamente la
// misma forma, pero hablando por HTTP con el servidor que abre la PC (ver
// electron/server/httpServer.ts). Así ninguna pantalla de la app tiene que
// enterarse de si está corriendo en la PC o en un celular.
import type { Api } from '../electron/preload';
import {
  MENSAJE_SIN_SESION,
  type ArticulosFiltro,
  type ArticuloInput,
  type ClienteInput,
  type Genero,
  type Proveedor,
  type Rol,
  type VentaInput,
} from '@shared/types';

const TOKEN_KEY = 'misAmores.token';

// Cuando la PC avisa que la sesión ya no vale (la cerraron desde otro lado,
// o le cambiaron el rol a esa persona), AuthContext escucha este evento y
// vuelve a la pantalla de login — antes quedaba todo "andando" pero cada
// cosa que se intentaba guardar fallaba.
export const EVENTO_SESION_VENCIDA = 'mis-amores:sesion-vencida';

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // si el navegador del celular bloquea localStorage (modo privado, etc.)
    // seguimos andando, pero habría que volver a loguearse en cada recarga.
  }
}

async function req<T>(method: string, ruta: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(ruta, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Antes salía "Failed to fetch", que no le dice nada a nadie.
    throw new Error('No hay conexión con la PC principal. Revisá el WiFi y que esa PC esté prendida con Mis Amores abierto.');
  }
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  } catch {
    throw new Error('La PC principal respondió algo inesperado. Probá de nuevo en un ratito.');
  }
  if (!json.ok) {
    if (json.error === MENSAJE_SIN_SESION && token) {
      setToken(null);
      window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
    }
    throw new Error(json.error ?? 'Ocurrió un error inesperado');
  }
  return json.data as T;
}

function query(params: Record<string, string | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') usp.set(clave, String(valor));
  }
  const texto = usp.toString();
  return texto ? `?${texto}` : '';
}

export function crearWebApiClient(): Api {
  return {
    auth: {
      login: async (usuario, password) => {
        const data = await req<Record<string, unknown> & { token: string }>('POST', '/api/auth/login', {
          usuario,
          password,
        });
        setToken(data.token);
        const { token: _token, ...sesion } = data;
        return sesion as never;
      },
      logout: async () => {
        const resultado = await req<boolean>('POST', '/api/auth/logout');
        setToken(null);
        return resultado;
      },
      sesionActual: async () => {
        if (!getToken()) return null;
        try {
          return await req('GET', '/api/auth/sesion');
        } catch {
          setToken(null);
          return null;
        }
      },
      cuentas: () => req('GET', '/api/auth/cuentas'),
    },
    articulos: {
      list: (filtro?: ArticulosFiltro) =>
        req(
          'GET',
          '/api/articulos' +
            query({
              busqueda: filtro?.busqueda,
              familiaId: filtro?.familiaId,
              soloStockBajo: filtro?.soloStockBajo,
              incluirInactivos: filtro?.incluirInactivos,
              soloInactivos: filtro?.soloInactivos,
            })
        ),
      get: (id) => req('GET', `/api/articulos/${id}`),
      buscarPorCodigo: (codigo) => req('GET', `/api/articulos/codigo/${encodeURIComponent(codigo)}`),
      crear: (input: ArticuloInput) => req('POST', '/api/articulos', input),
      actualizar: (id, input: ArticuloInput, original?: ArticuloInput) =>
        req('PUT', `/api/articulos/${id}`, { input, original }),
      eliminar: (id) => req('DELETE', `/api/articulos/${id}`),
      restaurar: (id) => req('POST', `/api/articulos/${id}/restaurar`),
      eliminarDefinitivo: (ids) => req('POST', '/api/articulos/eliminar-definitivo', { ids }),
      vaciarPapelera: (filtro?: ArticulosFiltro) =>
        req(
          'POST',
          '/api/articulos/vaciar-papelera' + query({ busqueda: filtro?.busqueda, familiaId: filtro?.familiaId })
        ),
      ajustarStock: (id, cantidad, tipo, motivo) =>
        req('POST', `/api/articulos/${id}/ajustar-stock`, { cantidad, tipo, motivo }),
      historialPrecios: (articuloId) => req('GET', `/api/articulos/${articuloId}/historial-precios`),
      sugerirRubro: (descripcion) => req('POST', '/api/articulos/sugerir-rubro', { descripcion }),
      movimientosStock: (articuloId) => req('GET', `/api/articulos/${articuloId}/movimientos-stock`),
    },
    familias: {
      list: () => req('GET', '/api/familias'),
      crear: (nombre) => req('POST', '/api/familias', { nombre }),
    },
    marcas: {
      list: () => req('GET', '/api/marcas'),
      crear: (nombre) => req('POST', '/api/marcas', { nombre }),
    },
    proveedores: {
      list: () => req('GET', '/api/proveedores'),
      crear: (data: Omit<Proveedor, 'id'>) => req('POST', '/api/proveedores', data),
    },
    dashboard: {
      stats: () => req('GET', '/api/dashboard/stats'),
    },
    reportes: {
      ventas: (desde, hasta) => req('GET', `/api/reportes/ventas${query({ desde, hasta })}`),
    },
    asistente: {
      preguntar: (pregunta) => req('POST', '/api/asistente/preguntar', { pregunta }),
    },
    ventas: {
      crear: (input: VentaInput) => req('POST', '/api/ventas', input),
      eliminar: (id) => req('DELETE', `/api/ventas/${id}`),
      listPorDia: (fechaYMD) => req('GET', `/api/ventas/dia/${fechaYMD}`),
      resumenMes: (anio, mesIndiceCero) =>
        req('GET', `/api/ventas/resumen-mes${query({ anio: String(anio), mes: String(mesIndiceCero) })}`),
      resumenHoy: () => req('GET', '/api/ventas/resumen-hoy'),
      ultimosFiados: (limite) => req('GET', `/api/ventas/ultimos-fiados${query({ limite: String(limite) })}`),
      marcarPagado: (id, pagado) => req('POST', `/api/ventas/${id}/pagado`, { pagado }),
    },
    clientes: {
      list: () => req('GET', '/api/clientes'),
      crear: (input: ClienteInput, deudaInicial: number, fechaInicial?: string) =>
        req('POST', '/api/clientes', { ...input, deudaInicial, fechaInicial }),
      setActivo: (id, activo) => req('POST', `/api/clientes/${id}/activo`, { activo }),
      historial: (clienteId) => req('GET', `/api/clientes/${clienteId}/historial`),
      registrarPago: (clienteId, monto, nota, metodoPago) =>
        req('POST', `/api/clientes/${clienteId}/pago`, { monto, nota, metodoPago }),
      eliminarMovimiento: (tipo, id) => req('DELETE', `/api/clientes/movimientos/${tipo}/${id}`),
    },
    usuarios: {
      list: () => req('GET', '/api/usuarios'),
      crear: (nombre, usuario, password, rol: Rol, genero: Genero) =>
        req('POST', '/api/usuarios', { nombre, usuario, password, rol, genero }),
      actualizar: (id, nombre, usuario, rol: Rol, genero: Genero) =>
        req('PUT', `/api/usuarios/${id}`, { nombre, usuario, rol, genero }),
      setActivo: (id, activo) => req('POST', `/api/usuarios/${id}/activo`, { activo }),
      resetPassword: (id, password) => req('POST', `/api/usuarios/${id}/reset-password`, { password }),
      eliminar: (id) => req('DELETE', `/api/usuarios/${id}`),
    },
    imagenes: {
      // Elegir una foto abre el explorador de archivos de Windows de la PC
      // que tiene los datos: desde un celular (o la PC conectada) no se puede.
      seleccionar: async () => {
        throw new Error('Las fotos de los productos se eligen desde la PC principal.');
      },
    },
    sistema: {
      infoRed: async () => null,
      // El servidor de la PC avisa por /api/eventos cuando alguien cambia algo.
      onDatosCambio: (callback: () => void) => {
        if (typeof EventSource === 'undefined') return () => {};
        const fuente = new EventSource('/api/eventos');
        fuente.addEventListener('cambio', () => callback());
        return () => fuente.close();
      },
    },
    esElectron: false,
    puertoLocal: 0,
  };
}
