import { ipcMain, BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import { seleccionarImagen } from '../imagenes';
import type { ApiResult, ArticuloInput, ArticulosFiltro, Genero, ItemConteo, Rol } from '../../shared/types';
import { getSesion, requiereAdmin, requiereSesion, setSesion } from '../session';
import { ocultarCostoSiNoAdmin, ocultarCostoSiNoAdminLista, sanitizarInputSegunRol } from '../reglasRol';
import {
  verificarCredenciales,
  listUsuarios,
  listCuentasPublicas,
  crearUsuario,
  actualizarUsuario,
  setUsuarioActivo,
  resetPassword,
  cambiarPasswordPropia,
  eliminarUsuario,
} from '../repositories/usuarios';
import {
  listArticulos,
  getArticulo,
  buscarPorCodigo,
  crearArticulo,
  actualizarArticulo,
  eliminarArticulo,
  restaurarArticulo,
  eliminarDefinitivo,
  vaciarPapelera,
  ajustarStock,
  aplicarConteo,
  historialPrecios,
  movimientosStock,
} from '../repositories/articulos';
import {
  listFamilias,
  crearFamilia,
  listMarcas,
  crearMarca,
  listProveedores,
  crearProveedor,
} from '../repositories/catalogos';
import { getDashboardStats } from '../repositories/dashboard';
import { getReporteVentas } from '../repositories/reportes';
import { sugerirRubro, responderPregunta } from '../repositories/asistente';
import {
  crearVenta,
  eliminarVenta,
  listVentasPorDia,
  resumenMes,
  resumenHoy,
  listUltimosFiados,
  marcarFiadoPagado,
} from '../repositories/ventas';
import {
  listClientes,
  crearCliente,
  setClienteActivo,
  historialCliente,
  registrarPago,
  eliminarPago,
  eliminarAjuste,
  estadoDeCuenta,
  registrarAjuste,
  actualizarCliente,
  pagosDelDia,
} from '../repositories/clientes';
import {
  listRecordatorios,
  resumenRecordatorios,
  crearRecordatorio,
  actualizarRecordatorio,
  marcarRecordatorioHecho,
  eliminarRecordatorio,
} from '../repositories/recordatorios';
import type {
  CambioPrecioItem,
  ClienteInput,
  CostoItem,
  EstadoCuenta,
  MetodoPago,
  RecordatorioInput,
  VentaInput,
} from '../../shared/types';
import { armarPdfEstado, crearEnlaceEstado } from '../estadoCuenta';
import { aplicarCambioPrecios, aplicarCostos, deshacerLotePrecios, lotesDePrecios } from '../repositories/precios';

// El estado de cuenta de un cliente, o un error claro si ya no está en la lista.
async function datosDelEstado(clienteId: string): Promise<EstadoCuenta> {
  const estado = await estadoDeCuenta(clienteId);
  if (!estado) throw new Error('Ese cliente ya no está en la lista.');
  return estado;
}

// Envuelve cada handler para devolver siempre { ok, data } o { ok:false, error },
// así el renderer nunca tiene que lidiar con excepciones sin capturar de IPC.
async function wrap<T>(fn: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export interface DepsHandlers {
  /** La clave de la red de PCs (con ella se firman los enlaces del estado de cuenta). */
  claveRed: () => string;
}

export function registrarHandlers(deps: DepsHandlers) {
  ipcMain.handle(Channels.authLogin, (_e, usuario: string, password: string) =>
    wrap(async () => {
      const user = await verificarCredenciales(usuario, password);
      if (!user) throw new Error('Usuario o contraseña incorrectos');
      setSesion(user);
      return user;
    })
  );

  ipcMain.handle(Channels.authLogout, () =>
    wrap(() => {
      setSesion(null);
      return true;
    })
  );

  ipcMain.handle(Channels.authSesion, () => wrap(() => getSesion()));

  // Sin requiereSesion a propósito: hace falta ANTES de loguearse, para
  // mostrar el selector de cuentas.
  ipcMain.handle(Channels.authCuentas, () => wrap(() => listCuentasPublicas()));

  // --- Artículos ---
  ipcMain.handle(Channels.articulosList, (_e, filtro: ArticulosFiltro) =>
    wrap(async () => {
      const sesion = requiereSesion();
      return ocultarCostoSiNoAdminLista(await listArticulos(filtro), sesion.rol);
    })
  );

  ipcMain.handle(Channels.articulosGet, (_e, id: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      const art = await getArticulo(id);
      return art ? ocultarCostoSiNoAdmin(art, sesion.rol) : null;
    })
  );

  ipcMain.handle(Channels.articulosBuscarPorCodigo, (_e, codigo: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      const art = await buscarPorCodigo(codigo);
      return art ? ocultarCostoSiNoAdmin(art, sesion.rol) : null;
    })
  );

  ipcMain.handle(Channels.articulosCreate, (_e, input: ArticuloInput) =>
    wrap(async () => {
      const sesion = requiereSesion();
      const saneado = sanitizarInputSegunRol(input, sesion.rol, 0);
      return ocultarCostoSiNoAdmin(await crearArticulo(saneado), sesion.rol);
    })
  );

  ipcMain.handle(Channels.articulosUpdate, (_e, id: string, input: ArticuloInput, original?: ArticuloInput) =>
    wrap(async () => {
      const sesion = requiereSesion();
      const actual = await getArticulo(id);
      if (!actual) throw new Error('El artículo no existe');
      const saneado = sanitizarInputSegunRol(input, sesion.rol, actual.precioCosto);
      return ocultarCostoSiNoAdmin(await actualizarArticulo(id, saneado, sesion.id, original), sesion.rol);
    })
  );

  ipcMain.handle(Channels.articulosDelete, (_e, id: string) =>
    wrap(async () => {
      requiereAdmin();
      await eliminarArticulo(id);
      return true;
    })
  );

  ipcMain.handle(Channels.articulosRestaurar, (_e, id: string) =>
    wrap(async () => {
      requiereAdmin();
      return restaurarArticulo(id);
    })
  );

  ipcMain.handle(Channels.articulosEliminarDefinitivo, (_e, ids: string[]) =>
    wrap(async () => {
      requiereAdmin();
      return eliminarDefinitivo(ids);
    })
  );

  ipcMain.handle(Channels.articulosVaciarPapelera, (_e, filtro?: ArticulosFiltro) =>
    wrap(async () => {
      requiereAdmin();
      return vaciarPapelera(filtro ?? {});
    })
  );

  ipcMain.handle(
    Channels.articulosAjustarStock,
    (_e, id: string, cantidad: number, tipo: 'ingreso' | 'egreso' | 'ajuste', motivo: string | null) =>
      wrap(async () => {
        const sesion = requiereSesion();
        return ocultarCostoSiNoAdmin(await ajustarStock(id, cantidad, tipo, motivo, sesion.id), sesion.rol);
      })
  );

  ipcMain.handle(Channels.articulosAplicarConteo, (_e, items: ItemConteo[]) =>
    wrap(() => {
      const sesion = requiereSesion();
      return aplicarConteo(items, sesion.id);
    })
  );

  // --- Precios y costos masivos (sólo la administradora) ---
  ipcMain.handle(Channels.preciosAplicar, (_e, items: CambioPrecioItem[], descripcion: string, loteId: string) =>
    wrap(() => {
      const sesion = requiereAdmin();
      return aplicarCambioPrecios(items, descripcion, loteId, sesion.id);
    })
  );
  ipcMain.handle(Channels.preciosLotes, () =>
    wrap(() => {
      requiereAdmin();
      return lotesDePrecios();
    })
  );
  ipcMain.handle(Channels.preciosDeshacer, (_e, loteId: string) =>
    wrap(() => {
      const sesion = requiereAdmin();
      return deshacerLotePrecios(loteId, sesion.id);
    })
  );
  ipcMain.handle(Channels.preciosAplicarCostos, (_e, items: CostoItem[]) =>
    wrap(() => {
      const sesion = requiereAdmin();
      return aplicarCostos(items, sesion.id);
    })
  );

  ipcMain.handle(Channels.articulosSugerirRubro, (_e, descripcion: string) =>
    wrap(() => {
      requiereSesion();
      return sugerirRubro(descripcion);
    })
  );

  ipcMain.handle(Channels.articulosHistorialPrecios, (_e, articuloId: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      const historial = await historialPrecios(articuloId);
      // Los cambios del precio de costo son sólo para la administradora.
      return sesion.rol === 'admin' ? historial : historial.filter((c) => c.tipo !== 'costo');
    })
  );

  ipcMain.handle(Channels.articulosMovimientosStock, (_e, articuloId: string) =>
    wrap(() => {
      requiereSesion();
      return movimientosStock(articuloId);
    })
  );

  // --- Catálogos ---
  ipcMain.handle(Channels.familiasList, () =>
    wrap(() => {
      requiereSesion();
      return listFamilias();
    })
  );
  ipcMain.handle(Channels.familiasCreate, (_e, nombre: string) =>
    wrap(() => {
      requiereSesion();
      return crearFamilia(nombre);
    })
  );

  ipcMain.handle(Channels.marcasList, () =>
    wrap(() => {
      requiereSesion();
      return listMarcas();
    })
  );
  ipcMain.handle(Channels.marcasCreate, (_e, nombre: string) =>
    wrap(() => {
      requiereSesion();
      return crearMarca(nombre);
    })
  );

  ipcMain.handle(Channels.proveedoresList, () =>
    wrap(() => {
      requiereSesion();
      return listProveedores();
    })
  );
  ipcMain.handle(Channels.proveedoresCreate, (_e, data) =>
    wrap(() => {
      requiereSesion();
      return crearProveedor(data);
    })
  );

  // --- Dashboard ---
  ipcMain.handle(Channels.dashboardStats, () =>
    wrap(async () => {
      const sesion = requiereSesion();
      const stats = await getDashboardStats();
      // El valor del inventario a costo es sólo para la administradora.
      return sesion.rol === 'admin' ? stats : { ...stats, valorInventarioCosto: 0 };
    })
  );

  // --- Reportes ---
  ipcMain.handle(Channels.reportesVentas, (_e, desde: string, hasta: string) =>
    wrap(() => {
      requiereSesion();
      return getReporteVentas(desde, hasta);
    })
  );

  // --- Asistente (sin IA externa, solo patrones + datos reales) ---
  ipcMain.handle(Channels.asistentePreguntar, (_e, pregunta: string) =>
    wrap(() => {
      requiereSesion();
      return responderPregunta(pregunta);
    })
  );

  // --- Usuarios (solo admin) ---
  ipcMain.handle(Channels.usuariosList, () =>
    wrap(() => {
      requiereAdmin();
      return listUsuarios();
    })
  );
  ipcMain.handle(
    Channels.usuariosCreate,
    (_e, nombre: string, usuario: string, password: string, rol: Rol, genero: Genero) =>
      wrap(() => {
        requiereAdmin();
        return crearUsuario(nombre, usuario, password, rol, genero);
      })
  );
  ipcMain.handle(
    Channels.usuariosUpdate,
    (_e, id: string, nombre: string, usuario: string, rol: Rol, genero: Genero) =>
      wrap(async () => {
        const sesion = requiereAdmin();
        const actualizado = await actualizarUsuario(id, nombre, usuario, rol, genero);
        // Si se editó a sí misma, la sesión de esta PC tiene que reflejarlo —
        // antes seguía mostrando el nombre viejo y, si se sacaba el rol de
        // admin, conservaba los permisos hasta cerrar sesión.
        if (sesion.id === id) {
          const { activo: _activo, ...datosSesion } = actualizado;
          setSesion(datosSesion);
        }
        return actualizado;
      })
  );
  ipcMain.handle(Channels.usuariosSetActivo, (_e, id: string, activo: boolean) =>
    wrap(async () => {
      const sesion = requiereAdmin();
      if (sesion.id === id && !activo) throw new Error('No podés desactivar tu propia cuenta mientras estás usándola.');
      await setUsuarioActivo(id, activo);
      return true;
    })
  );
  ipcMain.handle(Channels.usuariosResetPassword, (_e, id: string, password: string) =>
    wrap(async () => {
      requiereAdmin();
      await resetPassword(id, password);
      return true;
    })
  );
  ipcMain.handle(Channels.usuariosCambiarMiPassword, (_e, actual: string, nueva: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      await cambiarPasswordPropia(sesion.id, actual, nueva);
      return true;
    })
  );
  ipcMain.handle(Channels.usuariosEliminar, (_e, id: string) =>
    wrap(async () => {
      const sesion = requiereAdmin();
      if (sesion.id === id) throw new Error('No podés eliminar tu propia cuenta mientras estás usándola.');
      await eliminarUsuario(id);
      return true;
    })
  );

  // --- Ventas ---
  ipcMain.handle(Channels.ventasCrear, (_e, input: VentaInput) =>
    wrap(() => {
      const sesion = requiereSesion();
      return crearVenta(input, sesion.id);
    })
  );
  ipcMain.handle(Channels.ventasEliminar, (_e, id: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      await eliminarVenta(id, sesion.id);
      return true;
    })
  );
  ipcMain.handle(Channels.ventasListPorDia, (_e, fechaYMD: string) =>
    wrap(() => {
      requiereSesion();
      return listVentasPorDia(fechaYMD);
    })
  );
  ipcMain.handle(Channels.ventasResumenMes, (_e, anio: number, mesIndiceCero: number) =>
    wrap(() => {
      requiereSesion();
      return resumenMes(anio, mesIndiceCero);
    })
  );
  ipcMain.handle(Channels.ventasResumenHoy, () =>
    wrap(() => {
      requiereSesion();
      return resumenHoy();
    })
  );
  ipcMain.handle(Channels.ventasUltimosFiados, (_e, limite: number) =>
    wrap(() => {
      requiereSesion();
      return listUltimosFiados(limite);
    })
  );
  ipcMain.handle(Channels.ventasMarcarPagado, (_e, id: string, pagado: boolean) =>
    wrap(async () => {
      requiereSesion();
      await marcarFiadoPagado(id, pagado);
      return true;
    })
  );

  // --- Clientes / fiado ---
  ipcMain.handle(Channels.clientesList, () =>
    wrap(() => {
      requiereSesion();
      return listClientes();
    })
  );
  ipcMain.handle(
    Channels.clientesCrear,
    (_e, input: ClienteInput, deudaInicial: number, fechaInicial?: string, items?: unknown) =>
      wrap(() => {
        const sesion = requiereSesion();
        return crearCliente(input, deudaInicial, sesion.id, fechaInicial, items);
      })
  );
  ipcMain.handle(Channels.clientesSetActivo, (_e, id: string, activo: boolean) =>
    wrap(async () => {
      requiereAdmin();
      await setClienteActivo(id, activo);
      return true;
    })
  );
  ipcMain.handle(Channels.clientesHistorial, (_e, clienteId: string) =>
    wrap(() => {
      requiereSesion();
      return historialCliente(clienteId);
    })
  );
  ipcMain.handle(
    Channels.clientesAnotarDeuda,
    (_e, clienteId: string, monto: number, nota: string | null, fecha?: string, items?: unknown) =>
      wrap(async () => {
        const sesion = requiereSesion();
        await registrarAjuste(clienteId, monto, nota ?? null, sesion.id, fecha, items);
        return true;
      })
  );
  ipcMain.handle(Channels.clientesActualizar, (_e, id: string, input: ClienteInput) =>
    wrap(async () => {
      requiereSesion();
      await actualizarCliente(id, input);
      return true;
    })
  );
  ipcMain.handle(Channels.clientesPagosDelDia, (_e, fechaYMD: string) =>
    wrap(() => {
      requiereSesion();
      return pagosDelDia(fechaYMD);
    })
  );
  ipcMain.handle(Channels.clientesEstado, (_e, clienteId: string) =>
    wrap(async () => {
      requiereSesion();
      return datosDelEstado(clienteId);
    })
  );
  ipcMain.handle(Channels.clientesEnlaceEstado, (_e, clienteId: string) =>
    wrap(async () => {
      requiereSesion();
      await datosDelEstado(clienteId);
      return crearEnlaceEstado(deps.claveRed(), clienteId);
    })
  );
  ipcMain.handle(Channels.clientesEstadoPdf, (_e, clienteId: string) =>
    wrap(async () => {
      requiereSesion();
      return armarPdfEstado(await datosDelEstado(clienteId)).toString('base64');
    })
  );
  ipcMain.handle(
    Channels.clientesRegistrarPago,
    (_e, clienteId: string, monto: number, nota: string | null, metodoPago: MetodoPago) =>
      wrap(async () => {
        const sesion = requiereSesion();
        await registrarPago(clienteId, monto, sesion.id, nota, metodoPago);
        return true;
      })
  );
  // Para corregir un fiado, pago o saldo inicial cargado por error —
  // cualquiera con sesión puede borrar, igual que ya se puede anular una
  // venta desde Ventas (caja).
  ipcMain.handle(Channels.clientesEliminarMovimiento, (_e, tipo: 'venta' | 'pago' | 'ajuste', id: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      if (tipo === 'venta') await eliminarVenta(id, sesion.id);
      else if (tipo === 'pago') await eliminarPago(id);
      else await eliminarAjuste(id);
      return true;
    })
  );

  // --- Recordatorios (cualquiera con sesión los ve, los anota y los marca) ---
  ipcMain.handle(Channels.recordatoriosList, (_e, estado: 'pendientes' | 'hechos') =>
    wrap(() => {
      requiereSesion();
      return listRecordatorios(estado === 'hechos' ? 'hechos' : 'pendientes');
    })
  );
  ipcMain.handle(Channels.recordatoriosResumen, () =>
    wrap(() => {
      requiereSesion();
      return resumenRecordatorios();
    })
  );
  ipcMain.handle(Channels.recordatoriosCrear, (_e, input: RecordatorioInput) =>
    wrap(() => {
      const sesion = requiereSesion();
      return crearRecordatorio(input, sesion.id);
    })
  );
  ipcMain.handle(Channels.recordatoriosActualizar, (_e, id: string, input: RecordatorioInput) =>
    wrap(() => {
      requiereSesion();
      return actualizarRecordatorio(id, input);
    })
  );
  ipcMain.handle(Channels.recordatoriosMarcarHecho, (_e, id: string, hecho: boolean) =>
    wrap(async () => {
      const sesion = requiereSesion();
      await marcarRecordatorioHecho(id, hecho === true, sesion.id);
      return true;
    })
  );
  ipcMain.handle(Channels.recordatoriosEliminar, (_e, id: string) =>
    wrap(async () => {
      const sesion = requiereSesion();
      await eliminarRecordatorio(id, sesion.id, sesion.rol === 'admin');
      return true;
    })
  );

  // --- Imágenes ---
  ipcMain.handle(Channels.imagenesSeleccionar, () =>
    wrap(() => {
      requiereSesion();
      return seleccionarImagen(BrowserWindow.getFocusedWindow());
    })
  );
}
