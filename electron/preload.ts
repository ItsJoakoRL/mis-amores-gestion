import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { Channels } from '../shared/channels';
import type {
  ApiResult,
  Articulo,
  ArticuloInput,
  ArticulosFiltro,
  Familia,
  HistorialPrecio,
  Marca,
  MovimientoStock,
  Proveedor,
  Rol,
  Genero,
  SesionActual,
  CuentaPublica,
  Usuario,
  DashboardStats,
  ReporteVentas,
  SugerenciaRubro,
  RespuestaAsistente,
  Venta,
  VentaInput,
  MetodoPago,
  ResumenDiaVentas,
  Cliente,
  ClienteInput,
  MovimientoCuenta,
  InfoRed,
  InfoActualizacion,
  InfoModoPc,
  PcEncontrada,
  ConexionPrincipalInput,
  ResumenJuntar,
} from '../shared/types';

// Desenvuelve el ApiResult del main process: si algo salió mal, tira una
// excepción normal para que el componente que llamó pueda hacer try/catch
// sin preocuparse por el wrapper de IPC.
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as ApiResult<T>;
  if (!result.ok) {
    throw new Error(result.error ?? 'Ocurrió un error inesperado');
  }
  return result.data as T;
}

const api = {
  auth: {
    login: (usuario: string, password: string) =>
      invoke<SesionActual>(Channels.authLogin, usuario, password),
    logout: () => invoke<boolean>(Channels.authLogout),
    sesionActual: () => invoke<SesionActual | null>(Channels.authSesion),
    cuentas: () => invoke<CuentaPublica[]>(Channels.authCuentas),
  },
  articulos: {
    list: (filtro?: ArticulosFiltro) => invoke<Articulo[]>(Channels.articulosList, filtro ?? {}),
    get: (id: string) => invoke<Articulo | null>(Channels.articulosGet, id),
    buscarPorCodigo: (codigo: string) => invoke<Articulo | null>(Channels.articulosBuscarPorCodigo, codigo),
    crear: (input: ArticuloInput) => invoke<Articulo>(Channels.articulosCreate, input),
    // `original`: cómo estaba el artículo al abrir el formulario — así no se pisa
    // lo que otra persona haya cambiado mientras tanto (ver actualizarArticulo).
    actualizar: (id: string, input: ArticuloInput, original?: ArticuloInput) =>
      invoke<Articulo>(Channels.articulosUpdate, id, input, original),
    eliminar: (id: string) => invoke<boolean>(Channels.articulosDelete, id),
    restaurar: (id: string) => invoke<Articulo>(Channels.articulosRestaurar, id),
    eliminarDefinitivo: (ids: string[]) => invoke<number>(Channels.articulosEliminarDefinitivo, ids),
    vaciarPapelera: (filtro?: ArticulosFiltro) => invoke<number>(Channels.articulosVaciarPapelera, filtro ?? {}),
    ajustarStock: (id: string, cantidad: number, tipo: 'ingreso' | 'egreso' | 'ajuste', motivo: string | null) =>
      invoke<Articulo>(Channels.articulosAjustarStock, id, cantidad, tipo, motivo),
    historialPrecios: (articuloId: string) =>
      invoke<HistorialPrecio[]>(Channels.articulosHistorialPrecios, articuloId),
    sugerirRubro: (descripcion: string) =>
      invoke<SugerenciaRubro | null>(Channels.articulosSugerirRubro, descripcion),
    movimientosStock: (articuloId: string) =>
      invoke<MovimientoStock[]>(Channels.articulosMovimientosStock, articuloId),
  },
  familias: {
    list: () => invoke<Familia[]>(Channels.familiasList),
    crear: (nombre: string) => invoke<Familia>(Channels.familiasCreate, nombre),
  },
  marcas: {
    list: () => invoke<Marca[]>(Channels.marcasList),
    crear: (nombre: string) => invoke<Marca>(Channels.marcasCreate, nombre),
  },
  proveedores: {
    list: () => invoke<Proveedor[]>(Channels.proveedoresList),
    crear: (data: Omit<Proveedor, 'id'>) => invoke<Proveedor>(Channels.proveedoresCreate, data),
  },
  dashboard: {
    stats: () => invoke<DashboardStats>(Channels.dashboardStats),
  },
  reportes: {
    ventas: (desde: string, hasta: string) => invoke<ReporteVentas>(Channels.reportesVentas, desde, hasta),
  },
  asistente: {
    preguntar: (pregunta: string) => invoke<RespuestaAsistente>(Channels.asistentePreguntar, pregunta),
  },
  ventas: {
    crear: (input: VentaInput) => invoke<Venta>(Channels.ventasCrear, input),
    eliminar: (id: string) => invoke<boolean>(Channels.ventasEliminar, id),
    listPorDia: (fechaYMD: string) => invoke<Venta[]>(Channels.ventasListPorDia, fechaYMD),
    resumenMes: (anio: number, mesIndiceCero: number) =>
      invoke<ResumenDiaVentas[]>(Channels.ventasResumenMes, anio, mesIndiceCero),
    resumenHoy: () => invoke<ResumenDiaVentas>(Channels.ventasResumenHoy),
    ultimosFiados: (limite: number) => invoke<Venta[]>(Channels.ventasUltimosFiados, limite),
    marcarPagado: (id: string, pagado: boolean) => invoke<boolean>(Channels.ventasMarcarPagado, id, pagado),
  },
  clientes: {
    list: () => invoke<Cliente[]>(Channels.clientesList),
    crear: (input: ClienteInput, deudaInicial: number, fechaInicial?: string) =>
      invoke<Cliente>(Channels.clientesCrear, input, deudaInicial, fechaInicial),
    setActivo: (id: string, activo: boolean) => invoke<boolean>(Channels.clientesSetActivo, id, activo),
    historial: (clienteId: string) => invoke<MovimientoCuenta[]>(Channels.clientesHistorial, clienteId),
    registrarPago: (clienteId: string, monto: number, nota: string | null, metodoPago: MetodoPago) =>
      invoke<boolean>(Channels.clientesRegistrarPago, clienteId, monto, nota, metodoPago),
    eliminarMovimiento: (tipo: 'venta' | 'pago' | 'ajuste', id: string) =>
      invoke<boolean>(Channels.clientesEliminarMovimiento, tipo, id),
  },
  usuarios: {
    list: () => invoke<Usuario[]>(Channels.usuariosList),
    crear: (nombre: string, usuario: string, password: string, rol: Rol, genero: Genero) =>
      invoke<Usuario>(Channels.usuariosCreate, nombre, usuario, password, rol, genero),
    actualizar: (id: string, nombre: string, usuario: string, rol: Rol, genero: Genero) =>
      invoke<Usuario>(Channels.usuariosUpdate, id, nombre, usuario, rol, genero),
    setActivo: (id: string, activo: boolean) => invoke<boolean>(Channels.usuariosSetActivo, id, activo),
    resetPassword: (id: string, password: string) =>
      invoke<boolean>(Channels.usuariosResetPassword, id, password),
    eliminar: (id: string) => invoke<boolean>(Channels.usuariosEliminar, id),
  },
  imagenes: {
    seleccionar: () => invoke<string | null>(Channels.imagenesSeleccionar),
  },
  sistema: {
    // Este canal no pasa por invoke() porque no usa el wrapper { ok, data } —
    // ya viene con su propia forma que distingue éxito de error.
    infoRed: () => ipcRenderer.invoke(Channels.sistemaInfoRed) as Promise<InfoRed>,
    // Avisa cuando alguien (esta PC, otra PC o un celular) cambió datos.
    // Devuelve la función para dejar de escuchar.
    onDatosCambio: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on(Channels.sistemaDatosCambio, listener);
      return () => {
        ipcRenderer.removeListener(Channels.sistemaDatosCambio, listener);
      };
    },
  },
  // true acá (app de escritorio con su base) / false en el cliente web
  // (celular, o la PC conectada a la principal) — sirve para mostrar cosas
  // que sólo tienen sentido en la PC que tiene los datos, como el botón de
  // "usar desde el celular" o elegir la foto de un producto del disco.
  esElectron: true,
  // Puerto del servidor de esta PC: de ahí se ven las fotos de los productos.
  puertoLocal: Number(process.argv.find((a) => a.startsWith('--mis-amores-puerto='))?.split('=')[1]) || 4000,
};

// Lo que es de "la app de escritorio" en sí (no de los datos): las
// actualizaciones de esta PC y si es la principal o está conectada a otra.
// Está siempre — también en la PC conectada, donde la pantalla viene de la
// principal pero las actualizaciones son las de esta PC.
const escritorio = {
  // Por si la pantalla viene de una PC con otra versión: para que pueda
  // fijarse qué sabe hacer este puente antes de usarlo.
  versionPuente: 1,
  modo: () => invoke<InfoModoPc>(Channels.escritorioModo),
  // Las actualizaciones no pasan por invoke(): no hay nada que desenvolver —
  // en qué anda la actualización llega aparte, por onCambio, cada vez que cambia.
  actualizaciones: {
    estado: () => ipcRenderer.invoke(Channels.sistemaEstadoActualizacion) as Promise<InfoActualizacion | null>,
    buscar: () => ipcRenderer.invoke(Channels.sistemaBuscarActualizaciones) as Promise<void>,
    descargar: () => ipcRenderer.invoke(Channels.sistemaDescargarActualizacion) as Promise<void>,
    instalar: () => ipcRenderer.invoke(Channels.sistemaInstalarActualizacion) as Promise<void>,
    // Devuelve la función para dejar de escuchar (para el cleanup del useEffect).
    onCambio: (callback: (info: InfoActualizacion) => void) => {
      const listener = (_e: IpcRendererEvent, info: InfoActualizacion) => callback(info);
      ipcRenderer.on(Channels.sistemaCambioActualizacion, listener);
      return () => {
        ipcRenderer.removeListener(Channels.sistemaCambioActualizacion, listener);
      };
    },
  },
  buscarPcsPrincipales: () => invoke<PcEncontrada[]>(Channels.escritorioBuscarPrincipales),
  conectarAPrincipal: (input: ConexionPrincipalInput) =>
    invoke<{ resumen: ResumenJuntar; nombrePrincipal: string }>(Channels.escritorioConectar, input),
  desconectar: () => invoke<boolean>(Channels.escritorioDesconectar),
  reintentarConexion: () => invoke<{ ok: boolean; mensaje?: string }>(Channels.escritorioReintentar),
};

// Conectada a otra PC, la pantalla usa los datos de la principal por la red
// (como un celular): por eso acá no se expone la API local.
const modoConectada = process.argv.includes('--mis-amores-modo=conectada');
contextBridge.exposeInMainWorld('escritorio', escritorio);
if (!modoConectada) contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
export type Escritorio = typeof escritorio;
