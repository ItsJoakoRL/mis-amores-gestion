"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const channels_1 = require("../shared/channels");
// Desenvuelve el ApiResult del main process: si algo salió mal, tira una
// excepción normal para que el componente que llamó pueda hacer try/catch
// sin preocuparse por el wrapper de IPC.
async function invoke(channel, ...args) {
    const result = (await electron_1.ipcRenderer.invoke(channel, ...args));
    if (!result.ok) {
        throw new Error(result.error ?? 'Ocurrió un error inesperado');
    }
    return result.data;
}
const api = {
    auth: {
        login: (usuario, password) => invoke(channels_1.Channels.authLogin, usuario, password),
        logout: () => invoke(channels_1.Channels.authLogout),
        sesionActual: () => invoke(channels_1.Channels.authSesion),
        cuentas: () => invoke(channels_1.Channels.authCuentas),
    },
    articulos: {
        list: (filtro) => invoke(channels_1.Channels.articulosList, filtro ?? {}),
        get: (id) => invoke(channels_1.Channels.articulosGet, id),
        buscarPorCodigo: (codigo) => invoke(channels_1.Channels.articulosBuscarPorCodigo, codigo),
        crear: (input) => invoke(channels_1.Channels.articulosCreate, input),
        // `original`: cómo estaba el artículo al abrir el formulario — así no se pisa
        // lo que otra persona haya cambiado mientras tanto (ver actualizarArticulo).
        actualizar: (id, input, original) => invoke(channels_1.Channels.articulosUpdate, id, input, original),
        eliminar: (id) => invoke(channels_1.Channels.articulosDelete, id),
        restaurar: (id) => invoke(channels_1.Channels.articulosRestaurar, id),
        eliminarDefinitivo: (ids) => invoke(channels_1.Channels.articulosEliminarDefinitivo, ids),
        vaciarPapelera: (filtro) => invoke(channels_1.Channels.articulosVaciarPapelera, filtro ?? {}),
        ajustarStock: (id, cantidad, tipo, motivo) => invoke(channels_1.Channels.articulosAjustarStock, id, cantidad, tipo, motivo),
        historialPrecios: (articuloId) => invoke(channels_1.Channels.articulosHistorialPrecios, articuloId),
        sugerirRubro: (descripcion) => invoke(channels_1.Channels.articulosSugerirRubro, descripcion),
        movimientosStock: (articuloId) => invoke(channels_1.Channels.articulosMovimientosStock, articuloId),
    },
    familias: {
        list: () => invoke(channels_1.Channels.familiasList),
        crear: (nombre) => invoke(channels_1.Channels.familiasCreate, nombre),
    },
    marcas: {
        list: () => invoke(channels_1.Channels.marcasList),
        crear: (nombre) => invoke(channels_1.Channels.marcasCreate, nombre),
    },
    proveedores: {
        list: () => invoke(channels_1.Channels.proveedoresList),
        crear: (data) => invoke(channels_1.Channels.proveedoresCreate, data),
    },
    dashboard: {
        stats: () => invoke(channels_1.Channels.dashboardStats),
    },
    reportes: {
        ventas: (desde, hasta) => invoke(channels_1.Channels.reportesVentas, desde, hasta),
    },
    asistente: {
        preguntar: (pregunta) => invoke(channels_1.Channels.asistentePreguntar, pregunta),
    },
    ventas: {
        crear: (input) => invoke(channels_1.Channels.ventasCrear, input),
        eliminar: (id) => invoke(channels_1.Channels.ventasEliminar, id),
        listPorDia: (fechaYMD) => invoke(channels_1.Channels.ventasListPorDia, fechaYMD),
        resumenMes: (anio, mesIndiceCero) => invoke(channels_1.Channels.ventasResumenMes, anio, mesIndiceCero),
        resumenHoy: () => invoke(channels_1.Channels.ventasResumenHoy),
        ultimosFiados: (limite) => invoke(channels_1.Channels.ventasUltimosFiados, limite),
        marcarPagado: (id, pagado) => invoke(channels_1.Channels.ventasMarcarPagado, id, pagado),
    },
    clientes: {
        list: () => invoke(channels_1.Channels.clientesList),
        crear: (input, deudaInicial, fechaInicial) => invoke(channels_1.Channels.clientesCrear, input, deudaInicial, fechaInicial),
        setActivo: (id, activo) => invoke(channels_1.Channels.clientesSetActivo, id, activo),
        historial: (clienteId) => invoke(channels_1.Channels.clientesHistorial, clienteId),
        registrarPago: (clienteId, monto, nota, metodoPago) => invoke(channels_1.Channels.clientesRegistrarPago, clienteId, monto, nota, metodoPago),
        eliminarMovimiento: (tipo, id) => invoke(channels_1.Channels.clientesEliminarMovimiento, tipo, id),
    },
    recordatorios: {
        list: (estado = 'pendientes') => invoke(channels_1.Channels.recordatoriosList, estado),
        resumen: () => invoke(channels_1.Channels.recordatoriosResumen),
        crear: (input) => invoke(channels_1.Channels.recordatoriosCrear, input),
        actualizar: (id, input) => invoke(channels_1.Channels.recordatoriosActualizar, id, input),
        marcarHecho: (id, hecho) => invoke(channels_1.Channels.recordatoriosMarcarHecho, id, hecho),
        eliminar: (id) => invoke(channels_1.Channels.recordatoriosEliminar, id),
    },
    usuarios: {
        list: () => invoke(channels_1.Channels.usuariosList),
        crear: (nombre, usuario, password, rol, genero) => invoke(channels_1.Channels.usuariosCreate, nombre, usuario, password, rol, genero),
        actualizar: (id, nombre, usuario, rol, genero) => invoke(channels_1.Channels.usuariosUpdate, id, nombre, usuario, rol, genero),
        setActivo: (id, activo) => invoke(channels_1.Channels.usuariosSetActivo, id, activo),
        resetPassword: (id, password) => invoke(channels_1.Channels.usuariosResetPassword, id, password),
        cambiarMiPassword: (actual, nueva) => invoke(channels_1.Channels.usuariosCambiarMiPassword, actual, nueva),
        eliminar: (id) => invoke(channels_1.Channels.usuariosEliminar, id),
    },
    imagenes: {
        seleccionar: () => invoke(channels_1.Channels.imagenesSeleccionar),
    },
    sistema: {
        // Este canal no pasa por invoke() porque no usa el wrapper { ok, data } —
        // ya viene con su propia forma que distingue éxito de error.
        infoRed: () => electron_1.ipcRenderer.invoke(channels_1.Channels.sistemaInfoRed),
        // Avisa cuando alguien (esta PC, otra PC o un celular) cambió datos.
        // Devuelve la función para dejar de escuchar.
        onDatosCambio: (callback) => {
            const listener = () => callback();
            electron_1.ipcRenderer.on(channels_1.Channels.sistemaDatosCambio, listener);
            return () => {
                electron_1.ipcRenderer.removeListener(channels_1.Channels.sistemaDatosCambio, listener);
            };
        },
    },
    // true acá (app de escritorio con su base) / false en el cliente web
    // (celular) — sirve para mostrar cosas que sólo tienen sentido en la PC,
    // como el botón de "usar desde el celular" o elegir la foto de un producto
    // del disco.
    esElectron: true,
};
// Lo que es de "la app de escritorio" en sí (no de los datos): las
// actualizaciones de esta PC y cómo está sumada a la red de PCs del negocio.
const escritorio = {
    // Por si la pantalla viene de una PC con otra versión: para que pueda
    // fijarse qué sabe hacer este puente antes de usarlo.
    versionPuente: 3,
    // Las actualizaciones no pasan por invoke(): no hay nada que desenvolver —
    // en qué anda la actualización llega aparte, por onCambio, cada vez que cambia.
    actualizaciones: {
        estado: () => electron_1.ipcRenderer.invoke(channels_1.Channels.sistemaEstadoActualizacion),
        buscar: () => electron_1.ipcRenderer.invoke(channels_1.Channels.sistemaBuscarActualizaciones),
        descargar: () => electron_1.ipcRenderer.invoke(channels_1.Channels.sistemaDescargarActualizacion),
        instalar: () => electron_1.ipcRenderer.invoke(channels_1.Channels.sistemaInstalarActualizacion),
        // Devuelve la función para dejar de escuchar (para el cleanup del useEffect).
        onCambio: (callback) => {
            const listener = (_e, info) => callback(info);
            electron_1.ipcRenderer.on(channels_1.Channels.sistemaCambioActualizacion, listener);
            return () => {
                electron_1.ipcRenderer.removeListener(channels_1.Channels.sistemaCambioActualizacion, listener);
            };
        },
    },
    // Red de PCs: cómo anda la sincronización con las otras PCs.
    red: () => invoke(channels_1.Channels.escritorioRed),
    buscarPcs: () => invoke(channels_1.Channels.escritorioBuscarPcs),
    sumarPc: (input) => invoke(channels_1.Channels.escritorioSumarPc, input),
    salirDeLaRed: () => invoke(channels_1.Channels.escritorioSalirDeLaRed),
    revisarRed: () => invoke(channels_1.Channels.escritorioRevisarRed),
    borrarAvisos: () => invoke(channels_1.Channels.escritorioBorrarAvisos),
    olvidarPc: (idPc) => invoke(channels_1.Channels.escritorioOlvidarPc, idPc),
    conectarNube: (direccion) => invoke(channels_1.Channels.escritorioConectarNube, direccion),
    reintentar: () => invoke(channels_1.Channels.escritorioReintentar),
};
electron_1.contextBridge.exposeInMainWorld('escritorio', escritorio);
electron_1.contextBridge.exposeInMainWorld('api', api);
