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
  type CuentaPublica,
  type Genero,
  type Proveedor,
  type Rol,
  type VentaInput,
} from '@shared/types';

const TOKEN_KEY = 'misAmores.token';

// En internet la lista de cuentas no se ofrece (se la regalaría a cualquiera que
// abra la dirección). En su lugar, cada aparato se acuerda de las cuentas que
// ya usaron en él: la primera vez se escribe el usuario, y de ahí en más
// aparecen para tocar y entrar, como en la PC. Sólo quedan en este navegador.
const CUENTAS_KEY = 'misAmores.cuentas';

export function cuentasRecordadas(): CuentaPublica[] {
  try {
    const crudo = localStorage.getItem(CUENTAS_KEY);
    const lista = crudo ? (JSON.parse(crudo) as unknown) : [];
    if (!Array.isArray(lista)) return [];
    return lista.filter(
      (c): c is CuentaPublica =>
        !!c && typeof c.id === 'string' && typeof c.nombre === 'string' && typeof c.usuario === 'string'
    );
  } catch {
    return [];
  }
}

function guardarCuentas(lista: CuentaPublica[]) {
  try {
    localStorage.setItem(CUENTAS_KEY, JSON.stringify(lista.slice(0, 8)));
  } catch {
    // Si el navegador no deja guardar, sólo no se recuerda.
  }
}

function recordarCuenta(cuenta: CuentaPublica) {
  // La última que entró queda primera.
  guardarCuentas([cuenta, ...cuentasRecordadas().filter((c) => c.usuario !== cuenta.usuario)]);
}

export function olvidarCuenta(usuario: string): CuentaPublica[] {
  const restantes = cuentasRecordadas().filter((c) => c.usuario !== usuario);
  guardarCuentas(restantes);
  return restantes;
}

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
    throw new Error(
      'No hay conexión con el servidor. Revisá que tengas internet o WiFi (y, si usás la dirección del local, que la PC esté prendida con Mis Amores abierto).'
    );
  }
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  } catch {
    throw new Error(
      'El servidor no respondió bien. Si hace rato que nadie lo usa, puede tardar hasta un minuto en despertar: probá de nuevo en un ratito.'
    );
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
        const s = sesion as unknown as CuentaPublica;
        if (s && typeof s.id === 'string' && typeof s.usuario === 'string') {
          recordarCuenta({ id: s.id, nombre: s.nombre, usuario: s.usuario, rol: s.rol, genero: s.genero });
        }
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
              soloParaRevisar: filtro?.soloParaRevisar,
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
      aplicarConteo: (items) => req('POST', '/api/articulos/aplicar-conteo', { items }),
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
      estado: (clienteId) => req('GET', `/api/clientes/${clienteId}/estado`),
      enlaceEstado: (clienteId) => req('POST', `/api/clientes/${clienteId}/enlace-estado`),
      estadoPdf: (clienteId) => req('GET', `/api/clientes/${clienteId}/estado-pdf`),
      registrarPago: (clienteId, monto, nota, metodoPago) =>
        req('POST', `/api/clientes/${clienteId}/pago`, { monto, nota, metodoPago }),
      eliminarMovimiento: (tipo, id) => req('DELETE', `/api/clientes/movimientos/${tipo}/${id}`),
    },
    recordatorios: {
      list: (estado = 'pendientes') => req('GET', `/api/recordatorios${query({ estado })}`),
      resumen: () => req('GET', '/api/recordatorios/resumen'),
      crear: (input) => req('POST', '/api/recordatorios', input),
      actualizar: (id, input) => req('PUT', `/api/recordatorios/${id}`, input),
      marcarHecho: (id, hecho) => req('POST', `/api/recordatorios/${id}/hecho`, { hecho }),
      eliminar: (id) => req('DELETE', `/api/recordatorios/${id}`),
    },
    usuarios: {
      list: () => req('GET', '/api/usuarios'),
      crear: (nombre, usuario, password, rol: Rol, genero: Genero) =>
        req('POST', '/api/usuarios', { nombre, usuario, password, rol, genero }),
      actualizar: (id, nombre, usuario, rol: Rol, genero: Genero) =>
        req('PUT', `/api/usuarios/${id}`, { nombre, usuario, rol, genero }),
      setActivo: (id, activo) => req('POST', `/api/usuarios/${id}/activo`, { activo }),
      resetPassword: (id, password) => req('POST', `/api/usuarios/${id}/reset-password`, { password }),
      cambiarMiPassword: (actual, nueva) => req('POST', '/api/usuarios/mi-password', { actual, nueva }),
      eliminar: (id) => req('DELETE', `/api/usuarios/${id}`),
    },
    imagenes: {
      // Elegir una foto abre el explorador de archivos de Windows de la PC:
      // desde un celular no se puede.
      seleccionar: async () => {
        throw new Error('Las fotos de los productos se eligen desde una PC.');
      },
    },
    sistema: {
      infoRed: async () => null,
      // El servidor de la PC avisa por /api/eventos cuando alguien cambia algo.
      onDatosCambio: (callback: () => void) => {
        if (typeof EventSource === 'undefined') return () => {};
        let fuente: EventSource | null = null;
        let reintento: ReturnType<typeof setTimeout> | null = null;
        let cerrado = false;
        const conectar = () => {
          if (cerrado) return;
          fuente = new EventSource('/api/eventos');
          fuente.addEventListener('cambio', () => callback());
          // Si el servidor rechazó la conexión (está dormido, o tiene el tope de
          // conexiones) el navegador la da por cerrada y no vuelve a intentar sola.
          fuente.onerror = () => {
            if (cerrado || !fuente || fuente.readyState !== EventSource.CLOSED) return;
            fuente.close();
            reintento = setTimeout(conectar, 10_000);
          };
        };
        conectar();
        return () => {
          cerrado = true;
          if (reintento) clearTimeout(reintento);
          fuente?.close();
        };
      },
    },
    esElectron: false,
  };
}
