"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUERTO = void 0;
exports.obtenerIpsLan = obtenerIpsLan;
exports.iniciarServidorWeb = iniciarServidorWeb;
// Servidor HTTP para que los celulares de la misma red WiFi del local puedan
// usar la app entera desde el navegador (Chrome/Safari), conectándose a la
// PC donde corre esta app de escritorio. La PC tiene que estar prendida y la
// app abierta para que los celulares puedan entrar — no es un servidor en la
// nube, vive adentro de la app de escritorio.
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const types_1 = require("../../shared/types");
const juntarDatos_1 = require("../juntarDatos");
const backup_1 = require("../backup");
const imagenes_1 = require("../imagenes");
const cambiosEnVivo_1 = require("../cambiosEnVivo");
const replica_1 = require("../replica");
const aplicar_1 = require("../sync/aplicar");
const rutas_1 = require("../sync/rutas");
const nube_1 = require("../nube");
const limiteIntentos_1 = require("./limiteIntentos");
const tokenSessions_1 = require("./tokenSessions");
const mdns_1 = require("./mdns");
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
// La versión "en vivo" (desarrollo) usa un puerto distinto al de la app
// instalada de verdad — así se puede tener las dos abiertas a la vez sin que
// una le gane el puerto a la otra y la conexión del celular falle con
// "EADDRINUSE". (En desarrollo se puede elegir otro con MIS_AMORES_PUERTO,
// para probar dos "PCs" en la misma máquina.)
// En un servicio de internet (Render, etc.) el puerto lo da la variable PORT.
exports.PUERTO = Number(process.env.MIS_AMORES_PUERTO) ||
    (process.env.MIS_AMORES_MODO_SERVIDOR === '1' ? Number(process.env.PORT) : 0) ||
    (process.env.NODE_ENV === 'development' ? 4001 : 4000);
// Para el nombre de la carpeta del respaldo previo a juntar datos, en hora local.
function marcaDeTiempo() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function tokenDesdeHeader(req) {
    const auth = req.headers.authorization;
    return auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
}
function requiereSesion(req) {
    const sesion = (0, tokenSessions_1.obtenerSesionPorToken)(tokenDesdeHeader(req));
    if (!sesion)
        throw new Error(types_1.MENSAJE_SIN_SESION);
    return sesion;
}
function requiereAdmin(req) {
    const sesion = requiereSesion(req);
    if (sesion.rol !== 'admin')
        throw new Error('Esta acción requiere permisos de administrador');
    return sesion;
}
function filtroDesdeQuery(query) {
    return {
        busqueda: typeof query.busqueda === 'string' && query.busqueda ? query.busqueda : undefined,
        familiaId: typeof query.familiaId === 'string' && query.familiaId ? query.familiaId : null,
        soloStockBajo: query.soloStockBajo === 'true',
        incluirInactivos: query.incluirInactivos === 'true',
        soloInactivos: query.soloInactivos === 'true',
    };
}
// Placas de red "de mentira" que crean programas como VirtualBox, VMware,
// Hyper-V/WSL o las VPN: tienen IP propia, pero un celular del local no
// puede llegar a ellas. Si la PC tenía alguna, su IP podía quedar primera —
// y como la primera es la que va en el código QR y en misamores.local, el
// celular no conectaba. Ahora quedan al final de la lista.
const ADAPTADOR_VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|radmin|vpn|tap-/i;
function obtenerIpsLan() {
    const interfaces = os_1.default.networkInterfaces();
    const candidatas = [];
    for (const nombre of Object.keys(interfaces)) {
        for (const info of interfaces[nombre] ?? []) {
            if (info.family !== 'IPv4' || info.internal)
                continue;
            // 169.254.x.x: la IP que se pone Windows solo cuando una placa no tiene
            // red de verdad. 192.168.137.x: la del "zona con cobertura inalámbrica
            // móvil" de Windows, que tampoco es la red del local.
            const sinRed = info.address.startsWith('169.254.');
            const secundaria = ADAPTADOR_VIRTUAL.test(nombre) || info.address.startsWith('192.168.137.');
            candidatas.push({ ip: info.address, prioridad: sinRed ? 2 : secundaria ? 1 : 0 });
        }
    }
    return candidatas.sort((a, b) => a.prioridad - b.prioridad).map((c) => c.ip);
}
async function iniciarServidorWeb(distDir, infoPc, 
// null: la sincronización no pudo arrancar; igual se atiende a los celulares.
sync) {
    const app = (0, express_1.default)();
    // En internet (ver nube.ts) la app está detrás del balanceador del servicio:
    // la dirección de quien pide viene en X-Forwarded-For.
    const enNube = (0, nube_1.esModoNube)();
    if (enNube)
        app.set('trust proxy', 1);
    app.use((0, cors_1.default)());
    // Envuelve cada ruta con el mismo formato { ok, data } / { ok:false, error }
    // que ya usa el canal IPC de la app de escritorio, para poder reusar el
    // mismo cliente de API del lado del navegador.
    function ruta(fn) {
        return async (req, res) => {
            try {
                const data = await fn(req);
                res.json({ ok: true, data });
            }
            catch (err) {
                res.json({ ok: false, error: err instanceof Error ? err.message : 'Error desconocido' });
            }
        };
    }
    // --- Red de PCs ---
    // Para que otra PC del negocio reconozca a esta en la red antes de
    // sumarse (sin sesión: hace falta para encontrarla).
    app.get('/api/sistema/info', ruta(() => infoPc()));
    // Recibe toda la base de otra PC y la junta con la de acá (ver
    // juntarDatos.ts): es lo que se hace una vez, al sumar a la red una PC que
    // ya tenía datos propios. Va antes del express.json() general porque los
    // datos pesan mucho más que el límite normal de un pedido.
    let juntandoAhora = false;
    // Pesa cientos de MB y se interpreta antes de mirar la sesión: en internet no
    // se ofrece (las PCs suben sus datos por la sincronización).
    if (enNube) {
        app.post('/api/sistema/juntar-datos', (_req, res) => {
            res.json({ ok: false, error: 'Esto no está disponible en el servidor de internet.' });
        });
    }
    app.post('/api/sistema/juntar-datos', express_1.default.json({ limit: '300mb' }), ruta(async (req) => {
        requiereAdmin(req);
        if (juntandoAhora)
            throw new Error('Ya se están juntando datos de otra PC. Esperá a que termine.');
        const { datos, simular } = req.body;
        juntandoAhora = true;
        try {
            const resumen = await (0, juntarDatos_1.juntarDatos)(datos, {
                // Si no se aclara, se simula: escribir tiene que ser a propósito.
                simular: simular !== false,
                carpetaImagenes: (0, imagenes_1.carpetaImagenes)(),
                antesDeEscribir: () => (0, backup_1.respaldoExtra)(`antes-de-juntar-${marcaDeTiempo()}`),
            });
            // Los productos que vinieron de una base anterior no tienen "stock
            // inicial": se les calcula para que el stock siga cerrando, y se anota
            // en el diario para que las otras PCs también lo reciban.
            if (simular === false && sync) {
                await (0, aplicar_1.completarStockBase)(sync.diario);
                await sync.diario.barrer({ colecciones: ['articulos'], marcaNuevos: 'ahora' });
            }
            return resumen;
        }
        finally {
            juntandoAhora = false;
        }
    }));
    app.use(express_1.default.json());
    // --- Compatibilidad con la versión anterior (ver replica.ts) ---
    // Una PC que todavía no se actualizó se "conecta" a ésta y guarda una copia
    // de sus datos: se le sigue dando hasta que se actualice.
    async function autorizarCopia(req) {
        // La copia de la versión anterior es sólo para PCs de la red del local: en
        // internet no se ofrece (entregaría colecciones enteras a quien tenga la clave).
        if (enNube)
            throw new Error('Esto no está disponible en el servidor de internet.');
        if (await (0, replica_1.claveEsValida)(req.headers['x-clave-copia']))
            return;
        requiereAdmin(req);
    }
    app.get('/api/copia/manifiesto', ruta(async (req) => {
        await autorizarCopia(req);
        const yo = infoPc();
        return (0, replica_1.armarManifiesto)(yo.idPc, yo.nombrePc, 0);
    }));
    app.get('/api/copia/coleccion/:nombre', async (req, res) => {
        try {
            await autorizarCopia(req);
            res.type('application/json').send(await (0, replica_1.coleccionComoTexto)(String(req.params.nombre)));
        }
        catch (err) {
            const mensaje = err instanceof Error ? err.message : 'Error desconocido';
            res.status(/sesión|permisos/i.test(mensaje) ? 401 : 500).json({ ok: false, error: mensaje });
        }
    });
    app.get('/api/copia/clave', ruta(async (req) => {
        if (enNube)
            throw new Error('Esto no está disponible en el servidor de internet.');
        requiereAdmin(req);
        return { clave: await (0, replica_1.claveDeCopia)() };
    }));
    // --- Sincronización entre PCs (ver sync/rutas.ts) ---
    if (sync) {
        (0, rutas_1.registrarRutasSync)(app, { ...sync, requiereAdmin: (req) => void requiereAdmin(req) });
    }
    else {
        // La sincronización de esta PC no pudo arrancar: que las otras PCs lo
        // sepan (en vez de creer que esta tiene una versión que no sabe sincronizar).
        app.all('/api/sync/*splat', (_req, res) => {
            res.json({ ok: false, error: 'La sincronización de esta PC no pudo arrancar. Reiniciá Mis Amores en esa PC.' });
        });
    }
    // --- Auth ---
    app.post('/api/auth/login', ruta(async (req) => {
        const { usuario, password } = req.body;
        // En internet cualquiera puede probar contraseñas: hay un límite de
        // intentos fallidos (ver limiteIntentos.ts).
        const ip = req.ip ?? '';
        if (enNube && (0, limiteIntentos_1.intentoBloqueado)(ip, String(usuario ?? ''))) {
            throw new Error('Demasiados intentos. Esperá un rato (hasta una hora) y probá de nuevo.');
        }
        const user = await (0, usuarios_1.verificarCredenciales)(usuario, password);
        if (!user) {
            if (enNube)
                (0, limiteIntentos_1.anotarFallo)(ip, String(usuario ?? ''));
            throw new Error('Usuario o contraseña incorrectos');
        }
        if (enNube)
            (0, limiteIntentos_1.limpiarFallos)(String(usuario ?? ''));
        const token = (0, tokenSessions_1.crearToken)(user);
        return { ...user, token };
    }));
    app.post('/api/auth/logout', ruta(async (req) => {
        (0, tokenSessions_1.eliminarToken)(tokenDesdeHeader(req));
        return true;
    }));
    app.get('/api/auth/sesion', ruta((req) => (0, tokenSessions_1.obtenerSesionPorToken)(tokenDesdeHeader(req))));
    app.get('/api/auth/cuentas', ruta(() => {
        // La lista de cuentas para "tocar y entrar" es cómoda en el local, pero
        // en internet le regalaría los nombres de usuario a cualquiera: ahí se
        // escribe el usuario (la pantalla de entrada ya sabe hacerlo).
        if (enNube)
            throw new Error('Escribí tu usuario y tu contraseña.');
        return (0, usuarios_1.listCuentasPublicas)();
    }));
    // --- Artículos ---
    app.get('/api/articulos', ruta(async (req) => {
        const sesion = requiereSesion(req);
        return (0, reglasRol_1.ocultarCostoSiNoAdminLista)(await (0, articulos_1.listArticulos)(filtroDesdeQuery(req.query)), sesion.rol);
    }));
    app.get('/api/articulos/codigo/:codigo', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const art = await (0, articulos_1.buscarPorCodigo)(req.params.codigo);
        return art ? (0, reglasRol_1.ocultarCostoSiNoAdmin)(art, sesion.rol) : null;
    }));
    app.post('/api/articulos/sugerir-rubro', ruta((req) => {
        requiereSesion(req);
        return (0, asistente_1.sugerirRubro)(req.body.descripcion);
    }));
    app.get('/api/articulos/:id/historial-precios', ruta((req) => {
        requiereSesion(req);
        return (0, articulos_1.historialPrecios)(req.params.id);
    }));
    app.get('/api/articulos/:id/movimientos-stock', ruta((req) => {
        requiereSesion(req);
        return (0, articulos_1.movimientosStock)(req.params.id);
    }));
    app.get('/api/articulos/:id', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const art = await (0, articulos_1.getArticulo)(req.params.id);
        return art ? (0, reglasRol_1.ocultarCostoSiNoAdmin)(art, sesion.rol) : null;
    }));
    app.post('/api/articulos/eliminar-definitivo', ruta((req) => {
        requiereAdmin(req);
        return (0, articulos_1.eliminarDefinitivo)(req.body.ids);
    }));
    app.post('/api/articulos/vaciar-papelera', ruta((req) => {
        requiereAdmin(req);
        return (0, articulos_1.vaciarPapelera)(filtroDesdeQuery(req.query));
    }));
    app.post('/api/articulos/:id/restaurar', ruta((req) => {
        requiereAdmin(req);
        return (0, articulos_1.restaurarArticulo)(req.params.id);
    }));
    app.post('/api/articulos/:id/ajustar-stock', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const { cantidad, tipo, motivo } = req.body;
        const art = await (0, articulos_1.ajustarStock)(req.params.id, cantidad, tipo, motivo, sesion.id);
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(art, sesion.rol);
    }));
    app.post('/api/articulos', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const saneado = (0, reglasRol_1.sanitizarInputSegunRol)(req.body, sesion.rol, 0);
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(await (0, articulos_1.crearArticulo)(saneado), sesion.rol);
    }));
    app.put('/api/articulos/:id', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const actual = await (0, articulos_1.getArticulo)(req.params.id);
        if (!actual)
            throw new Error('El artículo no existe');
        // Viene { input, original } (para no pisar lo que otra persona cambió
        // mientras tanto — ver actualizarArticulo) o, de versiones viejas, el
        // artículo solo.
        const cuerpo = req.body;
        const { input, original } = 'input' in cuerpo && typeof cuerpo.input === 'object' ? cuerpo : { input: cuerpo, original: undefined };
        const saneado = (0, reglasRol_1.sanitizarInputSegunRol)(input, sesion.rol, actual.precioCosto);
        const actualizado = await (0, articulos_1.actualizarArticulo)(req.params.id, saneado, sesion.id, original);
        return (0, reglasRol_1.ocultarCostoSiNoAdmin)(actualizado, sesion.rol);
    }));
    app.delete('/api/articulos/:id', ruta(async (req) => {
        requiereAdmin(req);
        await (0, articulos_1.eliminarArticulo)(req.params.id);
        return true;
    }));
    // --- Familias / marcas / proveedores ---
    app.get('/api/familias', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.listFamilias)();
    }));
    app.post('/api/familias', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.crearFamilia)(req.body.nombre);
    }));
    app.get('/api/marcas', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.listMarcas)();
    }));
    app.post('/api/marcas', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.crearMarca)(req.body.nombre);
    }));
    app.get('/api/proveedores', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.listProveedores)();
    }));
    app.post('/api/proveedores', ruta((req) => {
        requiereSesion(req);
        return (0, catalogos_1.crearProveedor)(req.body);
    }));
    // --- Dashboard ---
    app.get('/api/dashboard/stats', ruta((req) => {
        requiereSesion(req);
        return (0, dashboard_1.getDashboardStats)();
    }));
    // --- Reportes ---
    app.get('/api/reportes/ventas', ruta((req) => {
        requiereSesion(req);
        const { desde, hasta } = req.query;
        return (0, reportes_1.getReporteVentas)(desde, hasta);
    }));
    // --- Asistente ---
    app.post('/api/asistente/preguntar', ruta((req) => {
        requiereSesion(req);
        return (0, asistente_1.responderPregunta)(req.body.pregunta);
    }));
    // --- Ventas ---
    app.get('/api/ventas/resumen-mes', ruta((req) => {
        requiereSesion(req);
        return (0, ventas_1.resumenMes)(Number(req.query.anio), Number(req.query.mes));
    }));
    app.get('/api/ventas/resumen-hoy', ruta((req) => {
        requiereSesion(req);
        return (0, ventas_1.resumenHoy)();
    }));
    app.get('/api/ventas/ultimos-fiados', ruta((req) => {
        requiereSesion(req);
        const limite = req.query.limite ? Number(req.query.limite) : 20;
        return (0, ventas_1.listUltimosFiados)(limite);
    }));
    app.get('/api/ventas/dia/:fecha', ruta((req) => {
        requiereSesion(req);
        return (0, ventas_1.listVentasPorDia)(req.params.fecha);
    }));
    app.post('/api/ventas', ruta((req) => {
        const sesion = requiereSesion(req);
        return (0, ventas_1.crearVenta)(req.body, sesion.id);
    }));
    app.delete('/api/ventas/:id', ruta(async (req) => {
        const sesion = requiereSesion(req);
        await (0, ventas_1.eliminarVenta)(req.params.id, sesion.id);
        return true;
    }));
    app.post('/api/ventas/:id/pagado', ruta(async (req) => {
        requiereSesion(req);
        await (0, ventas_1.marcarFiadoPagado)(req.params.id, req.body.pagado);
        return true;
    }));
    // --- Clientes / fiado ---
    app.get('/api/clientes', ruta((req) => {
        requiereSesion(req);
        return (0, clientes_1.listClientes)();
    }));
    app.post('/api/clientes', ruta((req) => {
        const sesion = requiereSesion(req);
        const { deudaInicial, fechaInicial, ...input } = req.body;
        return (0, clientes_1.crearCliente)(input, deudaInicial, sesion.id, fechaInicial);
    }));
    app.get('/api/clientes/:id/historial', ruta((req) => {
        requiereSesion(req);
        return (0, clientes_1.historialCliente)(req.params.id);
    }));
    app.post('/api/clientes/:id/activo', ruta(async (req) => {
        requiereAdmin(req);
        await (0, clientes_1.setClienteActivo)(req.params.id, req.body.activo);
        return true;
    }));
    app.post('/api/clientes/:id/pago', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const { monto, nota, metodoPago } = req.body;
        await (0, clientes_1.registrarPago)(req.params.id, monto, sesion.id, nota ?? null, metodoPago);
        return true;
    }));
    app.delete('/api/clientes/movimientos/:tipo/:id', ruta(async (req) => {
        const sesion = requiereSesion(req);
        const tipo = req.params.tipo;
        const id = req.params.id;
        if (tipo === 'venta')
            await (0, ventas_1.eliminarVenta)(id, sesion.id);
        else if (tipo === 'pago')
            await (0, clientes_1.eliminarPago)(id);
        else
            await (0, clientes_1.eliminarAjuste)(id);
        return true;
    }));
    // --- Recordatorios ---
    app.get('/api/recordatorios/resumen', ruta((req) => {
        requiereSesion(req);
        return (0, recordatorios_1.resumenRecordatorios)();
    }));
    app.get('/api/recordatorios', ruta((req) => {
        requiereSesion(req);
        return (0, recordatorios_1.listRecordatorios)(req.query.estado === 'hechos' ? 'hechos' : 'pendientes');
    }));
    app.post('/api/recordatorios', ruta((req) => {
        const sesion = requiereSesion(req);
        return (0, recordatorios_1.crearRecordatorio)(req.body, sesion.id);
    }));
    app.put('/api/recordatorios/:id', ruta((req) => {
        requiereSesion(req);
        return (0, recordatorios_1.actualizarRecordatorio)(req.params.id, req.body);
    }));
    app.post('/api/recordatorios/:id/hecho', ruta(async (req) => {
        const sesion = requiereSesion(req);
        await (0, recordatorios_1.marcarRecordatorioHecho)(req.params.id, req.body.hecho === true, sesion.id);
        return true;
    }));
    app.delete('/api/recordatorios/:id', ruta(async (req) => {
        const sesion = requiereSesion(req);
        await (0, recordatorios_1.eliminarRecordatorio)(req.params.id, sesion.id, sesion.rol === 'admin');
        return true;
    }));
    // --- Usuarios (sólo admin) ---
    app.get('/api/usuarios', ruta((req) => {
        requiereAdmin(req);
        return (0, usuarios_1.listUsuarios)();
    }));
    app.post('/api/usuarios', ruta((req) => {
        requiereAdmin(req);
        const { nombre, usuario, password, rol, genero } = req.body;
        return (0, usuarios_1.crearUsuario)(nombre, usuario, password, rol, genero);
    }));
    app.put('/api/usuarios/:id', ruta((req) => {
        requiereAdmin(req);
        const { nombre, usuario, rol, genero } = req.body;
        return (0, usuarios_1.actualizarUsuario)(req.params.id, nombre, usuario, rol, genero);
    }));
    app.post('/api/usuarios/:id/activo', ruta(async (req) => {
        const sesion = requiereAdmin(req);
        const id = req.params.id;
        const activo = req.body.activo === true;
        if (sesion.id === id && !activo)
            throw new Error('No podés desactivar tu propia cuenta mientras estás usándola.');
        await (0, usuarios_1.setUsuarioActivo)(id, activo);
        return true;
    }));
    app.post('/api/usuarios/:id/reset-password', ruta(async (req) => {
        requiereAdmin(req);
        const password = req.body.password;
        await (0, usuarios_1.resetPassword)(req.params.id, password);
        return true;
    }));
    app.delete('/api/usuarios/:id', ruta(async (req) => {
        const sesion = requiereAdmin(req);
        const id = req.params.id;
        if (sesion.id === id)
            throw new Error('No podés eliminar tu propia cuenta mientras estás usándola.');
        await (0, usuarios_1.eliminarUsuario)(id);
        return true;
    }));
    // Nota: elegir una foto de producto abre el explorador de archivos de
    // Windows — eso no existe en un navegador de celular, así que ese botón
    // avisa que no se puede desde ahí (ver src/webApiClient.ts).
    // Las fotos de los productos: en esta PC se ven directo del disco, pero
    // los celulares y la PC conectada las piden por acá (antes no se veían).
    // Sin sesión porque una etiqueta <img> no puede mandar el token; igual
    // sólo se puede pedir un archivo de esa carpeta, por su nombre.
    app.get('/imagenes/:archivo', (req, res) => {
        const archivo = path_1.default.basename(String(req.params.archivo));
        res.sendFile(path_1.default.join((0, imagenes_1.carpetaImagenes)(), archivo), (err) => {
            if (err && !res.headersSent)
                res.status(404).end();
        });
    });
    // Aviso en vivo: la pantalla (en un celular) se vuelve a cargar sola cuando
    // alguien, desde cualquier PC o celular, cambia algo. No lleva datos, sólo
    // el aviso de que hay algo nuevo para pedir.
    app.get('/api/eventos', (req, res) => {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        res.write('retry: 3000\n\n');
        const latido = setInterval(() => res.write(': latido\n\n'), 25000);
        const parar = (0, cambiosEnVivo_1.escucharCambios)(() => res.write('event: cambio\ndata: 1\n\n'));
        req.on('close', () => {
            clearInterval(latido);
            parar();
        });
    });
    // --- Sirve la app ya compilada para que el celular la abra como una
    // página web normal, en la misma dirección que la API. ---
    app.use(express_1.default.static(distDir));
    // Express 5 exige que el comodín tenga nombre (ya no alcanza con '*' solo).
    app.get('/*splat', (_req, res) => {
        res.sendFile(path_1.default.join(distDir, 'index.html'));
    });
    const servidor = http_1.default.createServer(app);
    await new Promise((resolve, reject) => {
        servidor.once('error', reject);
        servidor.listen(exports.PUERTO, '0.0.0.0', () => resolve());
    });
    const ipsLan = obtenerIpsLan();
    // La IP va primero (y es la que se usa para el código QR): funciona en
    // cualquier celular sin importar el modelo. El nombre "misamores.local"
    // (resuelto por mdns.ts) queda como respaldo — es más fácil de recordar,
    // pero varios Android/Chrome no resuelven bien los nombres ".local" y
    // terminan con "no se puede acceder a este sitio" aunque estén en la
    // misma red.
    const urls = [...ipsLan.map((ip) => `http://${ip}:${exports.PUERTO}`), `http://${mdns_1.NOMBRE_HOST}:${exports.PUERTO}`];
    const detener = () => new Promise((resolve) => {
        // closeAllConnections (Node 18.2+) corta de una las conexiones ya
        // abiertas (ej. un celular con la app abierta) — si no, server.close()
        // espera a que se cierren solas y puede tardar o no completarse nunca
        // mientras alguien la sigue usando desde el celular.
        servidor.closeAllConnections?.();
        servidor.close(() => resolve());
    });
    return { puerto: exports.PUERTO, urls, detener };
}
