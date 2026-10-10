// Tipos compartidos entre el proceso principal (Electron) y el renderer (React).
// Mantenerlos acá evita duplicar interfaces y que se desincronicen.

export type Rol = 'admin' | 'empleado';
export type Genero = 'F' | 'M';

export interface Usuario {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
  genero: Genero;
  activo: boolean;
}

export interface SesionActual {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
  genero: Genero;
}

// Lo mínimo para mostrar el selector de cuentas en la pantalla de login,
// antes de que haya ninguna sesión — por eso no lleva nada sensible.
export interface CuentaPublica {
  id: string;
  nombre: string;
  usuario: string;
  rol: Rol;
  genero: Genero;
}

// "Administrador/a" o "Empleado/a" según corresponda — se usa en el
// selector de login, la barra lateral y el listado de Usuarios.
export function etiquetaRol(rol: Rol, genero: Genero): string {
  if (rol === 'admin') return genero === 'M' ? 'Administrador' : 'Administradora';
  return genero === 'M' ? 'Empleado' : 'Empleada';
}

export interface Familia {
  id: string;
  nombre: string;
}

export interface Marca {
  id: string;
  nombre: string;
}

export interface Proveedor {
  id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
}

export type UnidadVenta = 'unidad' | 'peso';

export interface Articulo {
  id: string;
  codigoBarras: string | null;
  descripcion: string;
  marcaId: string | null;
  marcaNombre: string | null;
  familiaId: string | null;
  familiaNombre: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  precioCosto: number;
  precioVenta: number;
  precioLista2: number;
  precioLista3: number;
  utilidadPct: number;
  stock: number;
  stockMinimo: number;
  stockIdeal: number;
  unidad: UnidadVenta;
  imagenPath: string | null;
  nota: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export type ArticuloInput = Omit<
  Articulo,
  'id' | 'marcaNombre' | 'familiaNombre' | 'proveedorNombre' | 'activo' | 'creadoEn' | 'actualizadoEn'
>;

export interface ArticulosFiltro {
  busqueda?: string;
  familiaId?: string | null;
  soloStockBajo?: boolean;
  incluirInactivos?: boolean;
  /** Papelera: sólo artículos dados de baja, para poder revisarlos y restaurarlos. */
  soloInactivos?: boolean;
}

export interface MovimientoStock {
  id: string;
  articuloId: string;
  tipo: 'ingreso' | 'egreso' | 'ajuste';
  cantidad: number;
  stockResultante: number;
  motivo: string | null;
  usuarioNombre: string | null;
  fecha: string;
}

export interface HistorialPrecio {
  id: string;
  articuloId: string;
  tipo: 'costo' | 'venta';
  precioAnterior: number;
  precioNuevo: number;
  usuarioNombre: string | null;
  fecha: string;
}

export interface DashboardStats {
  totalArticulos: number;
  stockBajoCount: number;
  sinStockCount: number;
  valorInventarioCosto: number;
  valorInventarioVenta: number;
  totalFamilias: number;
}

/** Datos para que el celular se conecte a esta PC por WiFi: el puerto y las
 * direcciones de red donde está escuchando. Si algo falló al arrancar el
 * servidor, viene el motivo en `error` en vez de las urls. */
export type InfoRed = { puerto: number; urls: string[] } | { error: string } | null;

/** En qué anda la actualización automática de la app de escritorio. Lo lleva
 * el proceso principal (electron/main.ts) y se lo avisa a la pantalla cada vez
 * que cambia, para que el botón del menú y el cartel de arriba muestren si hay
 * una versión nueva, cuánto lleva bajada o si ya está lista para instalar. */
export type EstadoActualizacion =
  | { tipo: 'al-dia' }
  | { tipo: 'buscando' }
  /** `error` viene cuando se intentó bajarla y falló — para poder reintentar. */
  | { tipo: 'disponible'; version: string; error?: string }
  | { tipo: 'descargando'; version: string; porcentaje: number }
  | { tipo: 'lista'; version: string };

export interface InfoActualizacion {
  versionActual: string;
  estado: EstadoActualizacion;
}

/** Con qué mensaje avisa el servidor que la sesión ya no vale (se cerró o
 * venció) — el cliente web lo reconoce para volver a la pantalla de login. */
export const MENSAJE_SIN_SESION = 'No hay una sesión iniciada';

/** "principal": esta PC tiene la base de datos (como siempre). "conectada":
 * esta PC no guarda nada propio — muestra y guarda todo en la PC principal,
 * igual que un celular. */
export type ModoPc = 'principal' | 'conectada';

/** Lo que responde /api/sistema/info: con esto otra PC reconoce a la
 * principal en la red (y no se confunde conectándose a sí misma). */
export interface InfoPc {
  app: 'mis-amores-gestion';
  idPc: string;
  nombrePc: string;
  version: string;
  modo: ModoPc;
}

/** Una PC encontrada en la red al buscar la principal desde otra PC. */
export interface PcEncontrada {
  direccion: string;
  nombrePc: string | null;
  version: string | null;
  /** Responde, pero con una versión de la app que todavía no sabe recibir otra PC. */
  versionVieja: boolean;
}

/** En qué modo está esta PC (para la pantalla de Configuración). */
export interface InfoModoPc {
  modo: ModoPc;
  direccionPrincipal: string | null;
  nombrePrincipal: string | null;
  idPc: string;
  nombrePc: string;
  versionApp: string;
}

/** Lo que manda una PC para juntar sus datos en la principal. */
export interface DatosParaJuntar {
  nombrePc: string;
  /** Cada colección como EJSON (así viajan tal cual los ObjectId). */
  colecciones: Record<string, string>;
  imagenes: Array<{ articuloId: string; nombre: string; base64: string }>;
}

/** Qué pasó (o qué pasaría, si es una simulación) al juntar los datos. */
export interface ResumenJuntar {
  usuariosNuevos: number;
  rubrosNuevos: number;
  marcasNuevas: number;
  proveedoresNuevos: number;
  clientesNuevos: number;
  clientesUnidos: number;
  articulosNuevos: number;
  articulosActualizados: number;
  preciosActualizados: number;
  codigosAsignados: number;
  stockAjustado: number;
  ventasNuevas: number;
  pagosNuevos: number;
  ajustesNuevos: number;
  movimientosNuevos: number;
  historialNuevo: number;
  imagenesCopiadas: number;
  avisos: string[];
}

export interface ConexionPrincipalInput {
  direccion: string;
  usuario: string;
  password: string;
  /** true: sólo calcula qué se juntaría, sin tocar nada. */
  simular: boolean;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type MetodoPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'fiado';

export interface Venta {
  id: string;
  articuloId: string;
  articuloDescripcion: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
  metodoPago: MetodoPago;
  clienteId: string | null;
  clienteNombre: string | null;
  usuarioId: string;
  usuarioNombre: string | null;
  fecha: string;
  /** Sólo tiene sentido cuando metodoPago es 'fiado' — si ya lo pagó, deja
   * de contar para la deuda del cliente aunque siga en el historial. */
  pagado: boolean;
}

export interface VentaInput {
  articuloId: string;
  cantidad: number;
  metodoPago: MetodoPago;
  /** Obligatorio cuando metodoPago es 'fiado' — a quién se le anota la deuda. */
  clienteId?: string | null;
}

/** Totales de un día puntual, para pintar el calendario sin traer cada venta.
 * `total` incluye todo (fiado también); `totalCobrado` es sólo lo que
 * efectivamente entró (efectivo + tarjeta + transferencia) y `totalFiado` lo
 * que se anotó a cuenta corriente — un fiado no es plata en la caja todavía. */
export interface ResumenDiaVentas {
  fecha: string; // 'YYYY-MM-DD'
  total: number;
  totalCobrado: number;
  totalFiado: number;
  cantidadVentas: number;
}

export interface Cliente {
  id: string;
  nombre: string;
  nota: string | null;
  activo: boolean;
  /** Cuánto debe hoy (ventas fiadas menos pagos recibidos). */
  saldo: number;
  /** Fecha de la última venta fiada, o null si nunca fio nada. */
  ultimoFiado: string | null;
}

export type ClienteInput = Omit<Cliente, 'id' | 'activo' | 'saldo' | 'ultimoFiado'>;

/** Un movimiento en la cuenta corriente de un cliente: una compra fiada (suma
 * deuda) o un pago que hizo (la resta). */
export interface MovimientoCuenta {
  id: string;
  /** 'ajuste' es una deuda cargada a mano (ej. el saldo que ya tenía el
   * cliente antes de empezar a usar la app) — no viene de una venta real. */
  tipo: 'venta' | 'pago' | 'ajuste';
  fecha: string;
  monto: number;
  descripcion: string;
  usuarioNombre: string | null;
  /** Con qué pagó — sólo tiene sentido para tipo 'pago' (efectivo/tarjeta/
   * transferencia); null en 'venta' y 'ajuste'. */
  metodoPago: MetodoPago | null;
  /** Si ese fiado puntual ya se pagó — sólo tiene sentido para tipo 'venta';
   * null en 'pago' y 'ajuste'. */
  pagado: boolean | null;
}

export interface TopProducto {
  articuloId: string;
  descripcion: string;
  cantidad: number;
  total: number;
}

export interface VentasPorMetodoPago {
  metodoPago: MetodoPago;
  cantidad: number;
  total: number;
}

export interface VentasPorRubro {
  familiaNombre: string;
  total: number;
}

/** Todo lo que necesita la pantalla de Reportes para un rango de fechas, en
 * un solo viaje — evita que el renderer tenga que pedir cada gráfico por separado. */
export interface ReporteVentas {
  desde: string;
  hasta: string;
  totalVendido: number;
  /** Lo que efectivamente entró (efectivo + tarjeta + transferencia). */
  totalCobrado: number;
  /** Lo que se anotó a cuenta corriente — no es plata cobrada. */
  totalFiado: number;
  cantidadVentas: number;
  ticketPromedio: number;
  porDia: ResumenDiaVentas[];
  topProductos: TopProducto[];
  porMetodoPago: VentasPorMetodoPago[];
  porRubro: VentasPorRubro[];
}

/** Sugerencia de rubro para un artículo nuevo, calculada localmente
 * comparando la descripción contra los artículos ya cargados — no usa
 * ningún servicio de IA externo. */
export interface SugerenciaRubro {
  familiaId: string;
  familiaNombre: string;
}

/** Respuesta del asistente a una pregunta en lenguaje natural — reconoce
 * patrones comunes y contesta con datos reales de la base, sin IA externa. */
export interface RespuestaAsistente {
  texto: string;
  reconocida: boolean;
}
