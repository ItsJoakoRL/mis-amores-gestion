// Nombres de canales IPC compartidos entre preload y los handlers del main process.
export const Channels = {
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authSesion: 'auth:sesion',
  authCuentas: 'auth:cuentas',

  articulosList: 'articulos:list',
  articulosGet: 'articulos:get',
  articulosBuscarPorCodigo: 'articulos:buscarPorCodigo',
  articulosCreate: 'articulos:create',
  articulosUpdate: 'articulos:update',
  articulosDelete: 'articulos:delete',
  articulosRestaurar: 'articulos:restaurar',
  articulosEliminarDefinitivo: 'articulos:eliminarDefinitivo',
  articulosVaciarPapelera: 'articulos:vaciarPapelera',
  articulosAjustarStock: 'articulos:ajustarStock',
  articulosHistorialPrecios: 'articulos:historialPrecios',
  articulosMovimientosStock: 'articulos:movimientosStock',

  familiasList: 'familias:list',
  familiasCreate: 'familias:create',

  marcasList: 'marcas:list',
  marcasCreate: 'marcas:create',

  proveedoresList: 'proveedores:list',
  proveedoresCreate: 'proveedores:create',

  dashboardStats: 'dashboard:stats',

  reportesVentas: 'reportes:ventas',

  articulosSugerirRubro: 'articulos:sugerirRubro',
  asistentePreguntar: 'asistente:preguntar',

  ventasCrear: 'ventas:crear',
  ventasEliminar: 'ventas:eliminar',
  ventasListPorDia: 'ventas:listPorDia',
  ventasResumenMes: 'ventas:resumenMes',
  ventasResumenHoy: 'ventas:resumenHoy',
  ventasUltimosFiados: 'ventas:ultimosFiados',
  ventasMarcarPagado: 'ventas:marcarPagado',

  clientesList: 'clientes:list',
  clientesCrear: 'clientes:crear',
  clientesSetActivo: 'clientes:setActivo',
  clientesHistorial: 'clientes:historial',
  clientesRegistrarPago: 'clientes:registrarPago',
  clientesEliminarMovimiento: 'clientes:eliminarMovimiento',

  usuariosList: 'usuarios:list',
  usuariosCreate: 'usuarios:create',
  usuariosUpdate: 'usuarios:update',
  usuariosSetActivo: 'usuarios:setActivo',
  usuariosResetPassword: 'usuarios:resetPassword',
  usuariosEliminar: 'usuarios:eliminar',

  imagenesSeleccionar: 'imagenes:seleccionar',

  sistemaInfoRed: 'sistema:infoRed',
  sistemaBuscarActualizaciones: 'sistema:buscarActualizaciones',
  sistemaEstadoActualizacion: 'sistema:estadoActualizacion',
  sistemaDescargarActualizacion: 'sistema:descargarActualizacion',
  sistemaInstalarActualizacion: 'sistema:instalarActualizacion',
  // Este va al revés que el resto: lo manda el proceso principal a la
  // pantalla (webContents.send) cada vez que cambia el estado de la actualización.
  sistemaCambioActualizacion: 'sistema:cambioActualizacion',

  // PC principal / PC conectada (ver electron/main.ts)
  escritorioModo: 'escritorio:modo',
  escritorioBuscarPrincipales: 'escritorio:buscarPrincipales',
  escritorioConectar: 'escritorio:conectar',
  escritorioDesconectar: 'escritorio:desconectar',
  escritorioReintentar: 'escritorio:reintentar',
  // Copia de seguridad en la PC conectada y traspaso de la principal (ver electron/replica.ts)
  escritorioEstadoCopia: 'escritorio:estadoCopia',
  escritorioActivarCopia: 'escritorio:activarCopia',
  escritorioHacerPrincipal: 'escritorio:hacerPrincipal',

  // Lo manda el proceso principal a la pantalla cuando alguien cambió datos.
  sistemaDatosCambio: 'sistema:datosCambio',
} as const;
