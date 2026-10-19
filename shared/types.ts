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
  /** Quedan pocos pero hay: más que cero y hasta el stock mínimo (igual que "Con stock bajo" del Panel). */
  soloStockBajo?: boolean;
  /** Ya no queda (stock en cero o menos). */
  soloSinStock?: boolean;
  incluirInactivos?: boolean;
  /** Papelera: sólo artículos dados de baja, para poder revisarlos y restaurarlos. */
  soloInactivos?: boolean;
  /** Los que se vendieron sin stock registrado (stock en negativo): hay que
   * contarlos y corregirlos. */
  soloParaRevisar?: boolean;
}

/** Un producto de un cambio masivo de precios: el precio nuevo, y el que se vio al armar
 * el cambio (si alguien lo cambió en el medio, no se pisa). */
export interface CambioPrecioItem {
  articuloId: string;
  precioNuevo: number;
  precioVisto: number;
}

export interface ProductoOmitido {
  articuloId: string;
  descripcion: string | null;
  motivo: string;
}

export interface ResultadoCambioPrecios {
  loteId: string;
  cambiados: number;
  sinCambios: number;
  /** Los que no se pudieron cambiar (el resto sí se cambió). */
  omitidos: ProductoOmitido[];
}

/** Un cambio masivo de precios ya hecho (para poder deshacerlo). */
export interface LotePrecios {
  loteId: string;
  fecha: string;
  descripcion: string;
  cantidad: number;
  usuarioNombre: string | null;
  deshecho: boolean;
}

export interface ResultadoDeshacerPrecios {
  revertidos: number;
  /** Los que ya se habían vuelto a cambiar después: no se pisan. */
  omitidos: number;
}

/** Un costo de la planilla: el nuevo, y el que se vio (si alguien lo cambió en el medio, no se pisa). */
export interface CostoItem {
  articuloId: string;
  precioCosto: number;
  costoVisto: number;
}

export interface ResultadoCostos {
  cambiados: number;
  sinCambios: number;
  omitidos: ProductoOmitido[];
}

/** Un producto del conteo de inventario: cuánto se contó de verdad. */
export interface ItemConteo {
  articuloId: string;
  contado: number;
}

export interface ResultadoConteo {
  /** A cuántos productos se les cambió el stock (lo contado era distinto). */
  corregidos: number;
  /** Cuántos ya tenían justo ese stock. */
  sinCambios: number;
  /** Los que no se pudieron corregir (el resto sí se corrigió). */
  errores: { articuloId: string; descripcion: string | null; mensaje: string }[];
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
  /** Productos que se vendieron sin stock registrado (stock en negativo). */
  paraRevisarCount: number;
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

/** Lo que responde /api/sistema/info: con esto otra PC reconoce a ésta en la
 * red (y no se suma a sí misma). */
export interface InfoPc {
  app: 'mis-amores-gestion';
  idPc: string;
  nombrePc: string;
  version: string;
  /** Las versiones anteriores distinguían una PC "principal" de las
   * "conectadas": ahora todas son iguales, y acá siempre dice "principal"
   * para que esas versiones sigan reconociéndola. */
  modo: 'principal';
  /** Identifica la red de PCs del negocio: todas las PCs de la misma red lo
   * tienen igual. (Ausente en versiones anteriores.) */
  idRed?: string;
  generacion?: number;
  /** Cuánto lleva prendido el proceso. Sólo lo informa el servidor de internet
   * (si se durmiera y despertara, vuelve a cero). */
  segundosEncendido?: number;
}

/** Una PC encontrada en la red al buscar con cuál sumarse. */
export interface PcEncontrada {
  direccion: string;
  nombrePc: string | null;
  version: string | null;
  /** Responde, pero con una versión de la app que todavía no sabe sumarse. */
  versionVieja: boolean;
  /** Ya es parte de la misma red que esta PC. */
  enMiRed: boolean;
}

/** Cómo anda la sincronización con una de las otras PCs. */
export interface PcDeLaRed {
  idPc: string;
  nombrePc: string;
  direccion: string;
  /** Contesta en este momento. */
  enLinea: boolean;
  /** Última vez que se habló con ella (ISO). */
  ultimaVez: string | null;
  /** La versión de Mis Amores que tiene (null: todavía no se sabe). */
  version: string | null;
  /** Cambios que esa PC tiene y esta todavía no aplicó. */
  pendientes: number;
  error: string | null;
}

export interface AvisoDeRed {
  id: string;
  fecha: string;
  texto: string;
}

/** Todo lo que muestra la pantalla de Configuración sobre la red de PCs. */
export interface EstadoRed {
  idPc: string;
  nombrePc: string;
  versionApp: string;
  pcs: PcDeLaRed[];
  /** Hay cambios llegando o aplicándose ahora. */
  sincronizando: boolean;
  /** Esta PC está trayendo todos los datos de otra (primera vez). */
  poniendoseAlDia: boolean;
  progreso: { hecho: number; total: number } | null;
  /** Cosas que pasaron al unir cambios y que conviene que alguien revise. */
  avisos: AvisoDeRed[];
  /** La PC venía "conectada" a otra con la versión anterior y todavía no se
   * pudo sumar sola: acá está cuál era, para sumarla desde Configuración. */
  pendienteDeSumarse: { direccion: string; nombre: string | null } | null;
}

/** Lo que manda una PC para juntar sus datos con los de otra. */
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
  recordatoriosNuevos: number;
  avisos: string[];
}

export interface SumarPcInput {
  /** Dirección de la PC con la que se suma ("192.168.1.50" o con puerto). */
  direccion: string;
  /** Cuenta de administradora de esa PC. */
  usuario: string;
  password: string;
  /** true: sólo calcula qué se juntaría, sin tocar nada. */
  simular: boolean;
  /** Esta PC no tiene nada propio para pasar (venía conectada a la otra, o es
   * nueva): sólo trae los datos de la red, sin juntar los suyos. */
  soloTraer?: boolean;
}

export interface ResultadoSumarPc {
  /** Lo que se juntó de esta PC (null si sólo se trajo lo de la red). */
  resumen: ResumenJuntar | null;
  nombrePc: string;
}

/** Cómo está el servidor de internet visto desde afuera (aparte de si esta PC
 * está conectada con él para sincronizar). */
export interface EstadoServidorWeb {
  /** La página del servidor contesta. */
  funciona: boolean;
  version: string | null;
  /** Está en la misma red (misma clave) que esta PC; null si no se pudo saber. */
  mismaRed: boolean | null;
  error: string | null;
}

/** Lo que devuelve conectar esta PC con el servidor de internet. */
export interface ResultadoConectarNube {
  /** La dirección con la que quedó anotado ('https://...'). */
  direccion: string;
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
  /** El ticket (la compra) al que pertenece; null en ventas de antes de que existiera. */
  ticketId: string | null;
  /** Sólo en la lista de últimos fiados: cuánto falta pagar de este fiado, con los pagos
   * del cliente descontados de lo más viejo a lo más nuevo (0 = ya quedó cubierto). */
  resta?: number;
}

export interface VentaInput {
  articuloId: string;
  cantidad: number;
  metodoPago: MetodoPago;
  /** Obligatorio cuando metodoPago es 'fiado' — a quién se le anota la deuda. */
  clienteId?: string | null;
  /** Número que comparten todos los productos de una misma cuenta cobrada de una vez (24
   * letras/números): así se cuentan compras y no productos sueltos. Sin él, la venta cuenta sola. */
  ticketId?: string | null;
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
  /** Lo que clientes de cuenta corriente pagaron ese día (plata que entró aunque
   * no sea una venta de ese día). */
  totalPagos: number;
  cantidadPagos: number;
}

/** Para qué es el recordatorio (sólo para distinguirlos de un vistazo). */
export type TipoRecordatorio = 'hacer' | 'cambiar' | 'reponer' | 'cobrar' | 'otro';

/** Algo que hay que hacer o cambiar, anotado para que todas estén al tanto. */
export interface Recordatorio {
  id: string;
  texto: string;
  tipo: TipoRecordatorio;
  urgente: boolean;
  /** 'YYYY-MM-DD' (para qué día), o null si no tiene fecha. */
  paraFecha: string | null;
  /** Producto al que se refiere (para ir directo a ajustar su stock o editarlo). */
  articuloId: string | null;
  /** Cliente al que se refiere (para ir directo a su cuenta o a cobrarle). */
  clienteId: string | null;
  /** Nombre del producto o cliente, para mostrarlo. */
  vinculoNombre: string | null;
  /** El producto o cliente todavía existe (si no, el atajo no se ofrece). */
  vinculoExiste: boolean;
  hecho: boolean;
  creadoEn: string;
  creadoPorId: string | null;
  creadoPorNombre: string | null;
  hechoEn: string | null;
  hechoPorNombre: string | null;
}

export interface RecordatorioInput {
  texto: string;
  tipo: TipoRecordatorio;
  urgente: boolean;
  paraFecha: string | null;
  /** Como mucho uno de los dos: a qué producto o cliente se refiere. */
  articuloId?: string | null;
  clienteId?: string | null;
}

export interface ResumenRecordatorios {
  pendientes: number;
  urgentes: number;
  /** Con fecha de un día que ya pasó y sin hacer. */
  vencidos: number;
  paraHoy: number;
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
  /** Teléfono, tal como se anotó (opcional). */
  telefono: string | null;
  /** Desde cuándo debe: la fecha de lo más viejo que sigue sin cubrirse con sus
   * pagos (los pagos se descuentan de lo más viejo primero). null si no debe. */
  deudaDesde: string | null;
}

export type ClienteInput = Omit<Cliente, 'id' | 'activo' | 'saldo' | 'ultimoFiado' | 'deudaDesde'>;

/** Un pago que recibió un cliente de cuenta corriente (para verlo en el día). */
export interface PagoCuentaDelDia {
  id: string;
  fecha: string;
  monto: number;
  metodoPago: MetodoPago | null;
  clienteId: string;
  clienteNombre: string | null;
  usuarioNombre: string | null;
  nota: string | null;
}

/** Un producto de los que debe un cliente: lo que se anotó a mano (el cuaderno) o lo que
 * salió de una venta fiada. El subtotal es cantidad por precio unitario. */
export interface ItemDeuda {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

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
  /** Qué productos son (null en un pago, o en una deuda anotada sólo con un monto). */
  items: ItemDeuda[] | null;
  /** Cuánto falta pagar de esto, descontando los pagos del cliente de lo más viejo a lo
   * más nuevo: 0 si ya quedó cubierto. null en un pago, en un fiado marcado como pagado
   * a mano y en un descuento. */
  resta: number | null;
}

/** Una línea del estado de cuenta (algo que quedó anotado, o un pago). */
export interface LineaEstadoCuenta {
  fecha: string;
  descripcion: string;
  /** Lo que valía en total (de un pago, lo que pagó). */
  monto: number;
  /** Sólo en lo pendiente: lo que todavía falta pagar de esto (puede ser menos que
   * `monto` si ya pagó una parte). */
  resta?: number;
  /** Qué productos son, si se sabe. */
  items?: ItemDeuda[];
}

/** Lo que debe un cliente, listo para mostrar o armar el PDF: lo que quedó
 * anotado sin pagar, los pagos que hizo y el saldo que resulta. */
export interface EstadoCuenta {
  clienteId: string;
  nombre: string;
  /** Cuándo se armó (ISO). */
  fecha: string;
  /** Lo que debe hoy: lo pendiente menos lo que pagó (negativo = saldo a favor). */
  saldo: number;
  /** Lo que todavía tiene que pagar, producto por producto (ya descontados sus pagos de
   * lo más viejo a lo más nuevo). */
  pendientes: LineaEstadoCuenta[];
  pagos: LineaEstadoCuenta[];
  /** Cuánto pagó en total. */
  totalPagado: number;
}

/** El enlace para descargar el estado de cuenta (el que va en el código QR). */
export interface EnlaceEstadoCuenta {
  url: string;
  /** Hasta cuándo sirve (ISO). */
  expira: string;
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
  /** Pagos de cuentas corrientes recibidos en el período (plata que también entró). */
  totalPagos: number;
  cantidadPagos: number;
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
