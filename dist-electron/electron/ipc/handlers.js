"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarHandlers = registrarHandlers;
const electron_1 = require("electron");
const channels_1 = require("../../shared/channels");
const imagenes_1 = require("../imagenes");
const session_1 = require("../session");
const reglasRol_1 = require("../reglasRol");
const usuarios_1 = require("../repositories/usuarios");
const articulos_1 = require("../repositories/articulos");
const catalogos_1 = require("../repositories/catalogos");
const dashboard_1 = require("../repositories/dashboard");
const reportes_1 = require("../repositories/reportes");
const asistente_1 = require("../repositories/asistente");
const ventas_1 = require("../repositories/ventas");
const clientes_1 = require("../repositories/clientes");
const recordatorios_1 = require("../repositories/recordatorios");
const estadoCuenta_1 = require("../estadoCuenta");
// El estado de cuenta de un cliente, o un error claro si ya no está en la lista.
async function datosDelEstado(clienteId) {
    const estado = await (0, clientes_1.estadoDeCuenta)(clienteId);
    if (!estado)
        throw new Error('Ese cliente ya no está en la lista.');
    return estado;
}
// Envuelve cada handler para devolver siempre { ok, data } o { ok:false, error },
// así el renderer nunca tiene que lidiar con excepciones sin capturar de IPC.
async function wrap(fn) {
    try {
        const data = await fn();
        return { ok: true, data };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
    }
}
function registrarHandlers(deps) {
    electron_1.ipcMain.handle(channels_1.Channels.authLogin, (_e, usuario, password) => wrap(async () => {
        const user = await (0, usuarios_1.verificarCredenciales)(usuario, password);
        if (!user)
            throw new Error('Usuario o contraseña incorrectos');
        (0, session_1.setSesion)(user);
        return user;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.authLogout, () => wrap(() => {
        (0, session_1.setSesion)(null);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.authSesion, () => wrap(() => (0, session_1.getSesion)()));
    // Sin requiereSesion a propósito: hace falta ANTES de loguearse, para
    // mostrar el selector de cuentas.
    electron_1.ipcMain.handle(channels_1.Channels.authCuentas, () => wrap(() => (0, usuarios_1.listCuentasPublicas)()));
    // --- Artículos ---
    electron_1.ipcMain.handle(channels_1.Channels.articulosList, (_e, filtro) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, reglasRol_1.ocultarCostoSiNoAdminLista)(await (0, articulos_1.listArticulos)(filtro), sesion.rol);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosGet, (_e, id) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const art = await (0, articulos_1.getArticulo)(id);
        return art ? (0, reglasRol_1.ocultarCostoSiNoAdmin)(art, sesion.rol) : null;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosBuscarPorCodigo, (_e, codigo) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const art = await (0, articulos_1.buscarPorCodigo)(codigo);
        return art ? (0, reglasRol_1.ocultarCostoSiNoAdmin)(art, sesion.rol) : null;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosCreate, (_e, input) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const saneado = (0, reglasRol_1.sanitizarInputSegunRol)(input, sesion.rol, 0);
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(await (0, articulos_1.crearArticulo)(saneado), sesion.rol);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosUpdate, (_e, id, input, original) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const actual = await (0, articulos_1.getArticulo)(id);
        if (!actual)
            throw new Error('El artículo no existe');
        const saneado = (0, reglasRol_1.sanitizarInputSegunRol)(input, sesion.rol, actual.precioCosto);
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(await (0, articulos_1.actualizarArticulo)(id, saneado, sesion.id, original), sesion.rol);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosDelete, (_e, id) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        await (0, articulos_1.eliminarArticulo)(id);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosRestaurar, (_e, id) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        return (0, articulos_1.restaurarArticulo)(id);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosEliminarDefinitivo, (_e, ids) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        return (0, articulos_1.eliminarDefinitivo)(ids);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosVaciarPapelera, (_e, filtro) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        return (0, articulos_1.vaciarPapelera)(filtro ?? {});
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosAjustarStock, (_e, id, cantidad, tipo, motivo) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(await (0, articulos_1.ajustarStock)(id, cantidad, tipo, motivo, sesion.id), sesion.rol);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosAplicarConteo, (_e, items) => wrap(() => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, articulos_1.aplicarConteo)(items, sesion.id);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosSugerirRubro, (_e, descripcion) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, asistente_1.sugerirRubro)(descripcion);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosHistorialPrecios, (_e, articuloId) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const historial = await (0, articulos_1.historialPrecios)(articuloId);
        // Los cambios del precio de costo son sólo para la administradora.
        return sesion.rol === 'admin' ? historial : historial.filter((c) => c.tipo !== 'costo');
    }));
    electron_1.ipcMain.handle(channels_1.Channels.articulosMovimientosStock, (_e, articuloId) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, articulos_1.movimientosStock)(articuloId);
    }));
    // --- Catálogos ---
    electron_1.ipcMain.handle(channels_1.Channels.familiasList, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.listFamilias)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.familiasCreate, (_e, nombre) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.crearFamilia)(nombre);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.marcasList, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.listMarcas)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.marcasCreate, (_e, nombre) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.crearMarca)(nombre);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.proveedoresList, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.listProveedores)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.proveedoresCreate, (_e, data) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, catalogos_1.crearProveedor)(data);
    }));
    // --- Dashboard ---
    electron_1.ipcMain.handle(channels_1.Channels.dashboardStats, () => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        const stats = await (0, dashboard_1.getDashboardStats)();
        // El valor del inventario a costo es sólo para la administradora.
        return sesion.rol === 'admin' ? stats : { ...stats, valorInventarioCosto: 0 };
    }));
    // --- Reportes ---
    electron_1.ipcMain.handle(channels_1.Channels.reportesVentas, (_e, desde, hasta) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, reportes_1.getReporteVentas)(desde, hasta);
    }));
    // --- Asistente (sin IA externa, solo patrones + datos reales) ---
    electron_1.ipcMain.handle(channels_1.Channels.asistentePreguntar, (_e, pregunta) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, asistente_1.responderPregunta)(pregunta);
    }));
    // --- Usuarios (solo admin) ---
    electron_1.ipcMain.handle(channels_1.Channels.usuariosList, () => wrap(() => {
        (0, session_1.requiereAdmin)();
        return (0, usuarios_1.listUsuarios)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosCreate, (_e, nombre, usuario, password, rol, genero) => wrap(() => {
        (0, session_1.requiereAdmin)();
        return (0, usuarios_1.crearUsuario)(nombre, usuario, password, rol, genero);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosUpdate, (_e, id, nombre, usuario, rol, genero) => wrap(async () => {
        const sesion = (0, session_1.requiereAdmin)();
        const actualizado = await (0, usuarios_1.actualizarUsuario)(id, nombre, usuario, rol, genero);
        // Si se editó a sí misma, la sesión de esta PC tiene que reflejarlo —
        // antes seguía mostrando el nombre viejo y, si se sacaba el rol de
        // admin, conservaba los permisos hasta cerrar sesión.
        if (sesion.id === id) {
            const { activo: _activo, ...datosSesion } = actualizado;
            (0, session_1.setSesion)(datosSesion);
        }
        return actualizado;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosSetActivo, (_e, id, activo) => wrap(async () => {
        const sesion = (0, session_1.requiereAdmin)();
        if (sesion.id === id && !activo)
            throw new Error('No podés desactivar tu propia cuenta mientras estás usándola.');
        await (0, usuarios_1.setUsuarioActivo)(id, activo);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosResetPassword, (_e, id, password) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        await (0, usuarios_1.resetPassword)(id, password);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosCambiarMiPassword, (_e, actual, nueva) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        await (0, usuarios_1.cambiarPasswordPropia)(sesion.id, actual, nueva);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.usuariosEliminar, (_e, id) => wrap(async () => {
        const sesion = (0, session_1.requiereAdmin)();
        if (sesion.id === id)
            throw new Error('No podés eliminar tu propia cuenta mientras estás usándola.');
        await (0, usuarios_1.eliminarUsuario)(id);
        return true;
    }));
    // --- Ventas ---
    electron_1.ipcMain.handle(channels_1.Channels.ventasCrear, (_e, input) => wrap(() => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, ventas_1.crearVenta)(input, sesion.id);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasEliminar, (_e, id) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        await (0, ventas_1.eliminarVenta)(id, sesion.id);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasListPorDia, (_e, fechaYMD) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, ventas_1.listVentasPorDia)(fechaYMD);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasResumenMes, (_e, anio, mesIndiceCero) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, ventas_1.resumenMes)(anio, mesIndiceCero);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasResumenHoy, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, ventas_1.resumenHoy)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasUltimosFiados, (_e, limite) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, ventas_1.listUltimosFiados)(limite);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.ventasMarcarPagado, (_e, id, pagado) => wrap(async () => {
        (0, session_1.requiereSesion)();
        await (0, ventas_1.marcarFiadoPagado)(id, pagado);
        return true;
    }));
    // --- Clientes / fiado ---
    electron_1.ipcMain.handle(channels_1.Channels.clientesList, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, clientes_1.listClientes)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesCrear, (_e, input, deudaInicial, fechaInicial) => wrap(() => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, clientes_1.crearCliente)(input, deudaInicial, sesion.id, fechaInicial);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesSetActivo, (_e, id, activo) => wrap(async () => {
        (0, session_1.requiereAdmin)();
        await (0, clientes_1.setClienteActivo)(id, activo);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesHistorial, (_e, clienteId) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, clientes_1.historialCliente)(clienteId);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesEstado, (_e, clienteId) => wrap(async () => {
        (0, session_1.requiereSesion)();
        return datosDelEstado(clienteId);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesEnlaceEstado, (_e, clienteId) => wrap(async () => {
        (0, session_1.requiereSesion)();
        await datosDelEstado(clienteId);
        return (0, estadoCuenta_1.crearEnlaceEstado)(deps.claveRed(), clienteId);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesEstadoPdf, (_e, clienteId) => wrap(async () => {
        (0, session_1.requiereSesion)();
        return (0, estadoCuenta_1.armarPdfEstado)(await datosDelEstado(clienteId)).toString('base64');
    }));
    electron_1.ipcMain.handle(channels_1.Channels.clientesRegistrarPago, (_e, clienteId, monto, nota, metodoPago) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        await (0, clientes_1.registrarPago)(clienteId, monto, sesion.id, nota, metodoPago);
        return true;
    }));
    // Para corregir un fiado, pago o saldo inicial cargado por error —
    // cualquiera con sesión puede borrar, igual que ya se puede anular una
    // venta desde Ventas (caja).
    electron_1.ipcMain.handle(channels_1.Channels.clientesEliminarMovimiento, (_e, tipo, id) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        if (tipo === 'venta')
            await (0, ventas_1.eliminarVenta)(id, sesion.id);
        else if (tipo === 'pago')
            await (0, clientes_1.eliminarPago)(id);
        else
            await (0, clientes_1.eliminarAjuste)(id);
        return true;
    }));
    // --- Recordatorios (cualquiera con sesión los ve, los anota y los marca) ---
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosList, (_e, estado) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, recordatorios_1.listRecordatorios)(estado === 'hechos' ? 'hechos' : 'pendientes');
    }));
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosResumen, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, recordatorios_1.resumenRecordatorios)();
    }));
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosCrear, (_e, input) => wrap(() => {
        const sesion = (0, session_1.requiereSesion)();
        return (0, recordatorios_1.crearRecordatorio)(input, sesion.id);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosActualizar, (_e, id, input) => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, recordatorios_1.actualizarRecordatorio)(id, input);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosMarcarHecho, (_e, id, hecho) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        await (0, recordatorios_1.marcarRecordatorioHecho)(id, hecho === true, sesion.id);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.recordatoriosEliminar, (_e, id) => wrap(async () => {
        const sesion = (0, session_1.requiereSesion)();
        await (0, recordatorios_1.eliminarRecordatorio)(id, sesion.id, sesion.rol === 'admin');
        return true;
    }));
    // --- Imágenes ---
    electron_1.ipcMain.handle(channels_1.Channels.imagenesSeleccionar, () => wrap(() => {
        (0, session_1.requiereSesion)();
        return (0, imagenes_1.seleccionarImagen)(electron_1.BrowserWindow.getFocusedWindow());
    }));
}
