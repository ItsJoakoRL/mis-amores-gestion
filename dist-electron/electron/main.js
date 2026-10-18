"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const multicast_dns_1 = __importDefault(require("multicast-dns"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = require("./db/database");
const backup_1 = require("./backup");
const handlers_1 = require("./ipc/handlers");
const httpServer_1 = require("./server/httpServer");
const mdns_1 = require("./server/mdns");
const tokenSessions_1 = require("./server/tokenSessions");
const session_1 = require("./session");
const usuarios_1 = require("./repositories/usuarios");
const configuracion_1 = require("./configuracion");
const juntarDatos_1 = require("./juntarDatos");
const cambiosEnVivo_1 = require("./cambiosEnVivo");
const replica_1 = require("./replica");
const imagenes_1 = require("./imagenes");
const recordatorios_1 = require("./repositories/recordatorios");
const diario_1 = require("./sync/diario");
const aplicar_1 = require("./sync/aplicar");
const motor_1 = require("./sync/motor");
const nube_1 = require("./nube");
const despertador_1 = require("./despertador");
const escaneoRed_1 = require("./escaneoRed");
const reloj_1 = require("./sync/reloj");
const channels_1 = require("../shared/channels");
// Diagnóstico temporal: si algo revienta antes de que haya ventana (y por lo
// tanto antes de tener DevTools para ver el error), lo dejamos anotado en un
// archivo de texto en la carpeta temporal de Windows.
const logCrash = (etiqueta, err) => {
    try {
        const linea = `[${new Date().toISOString()}] ${etiqueta}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
        fs_1.default.appendFileSync(path_1.default.join(os_1.default.tmpdir(), 'mis-amores-crash.log'), linea);
        // Como servidor no hay ventana: también va a la salida del servicio
        // (se lee con "journalctl -u mis-amores").
        if (process.env.MIS_AMORES_MODO_SERVIDOR === '1')
            process.stderr.write(linea);
    }
    catch {
        /* si ni esto funciona, no hay mucho más que hacer */
    }
};
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));
logCrash('arranque', `proceso iniciado, isPackaged=${electron_1.app.isPackaged}, __dirname=${__dirname}`);
// La versión "en vivo" (npm run dev) usa su propia carpeta de datos: si
// compartiera la de la app instalada, también compartiría el candado de
// instancia única de abajo, y con la instalada abierta en la bandeja el modo
// desarrollo se cerraba solo, sin decir nada. (Con MIS_AMORES_CARPETA_DATOS
// se puede elegir otra, para probar dos "PCs" en la misma máquina.)
if (!electron_1.app.isPackaged) {
    const carpeta = process.env.MIS_AMORES_CARPETA_DATOS;
    electron_1.app.setPath('userData', carpeta ? path_1.default.resolve(carpeta) : path_1.default.join(electron_1.app.getPath('appData'), 'mis-amores-gestion-dev'));
}
// Todas las PCs del negocio son iguales: cada una tiene su base completa y se
// mantiene al día con las otras (ver electron/sync). Esto lee con quiénes habla
// y la clave de la red (ver configuracion.ts).
let config = (0, configuracion_1.leerConfiguracion)();
// Para las pruebas automáticas: arranca todo (base, servidor, sincronización)
// sin abrir ventana ni ícono en la bandeja.
const sinVentana = process.env.MIS_AMORES_SIN_VENTANA === '1';
// Corriendo como servidor de internet (ver servidor.ts): no hay Electron, ni
// ventana, ni bandeja, ni actualizaciones automáticas.
const modoServidor = process.env.MIS_AMORES_MODO_SERVIDOR === '1';
// Como la app se minimiza a la bandeja en vez de cerrarse de verdad, si
// alguien la abre de nuevo (doble click en el ícono) sin darse cuenta de que
// ya estaba corriendo, terminaría una segunda copia peleando por el mismo
// puerto 4000 del acceso desde el celular — y esa segunda ventana se rompe
// con "EADDRINUSE". Con el lock de instancia única, esa segunda apertura no
// crea nada nuevo: sólo le avisa a la que ya está corriendo que la muestre.
const esInstanciaUnica = electron_1.app.requestSingleInstanceLock();
if (!esInstanciaUnica) {
    electron_1.app.quit();
}
let infoServidorWeb = null;
let detenerMdns = null;
let detenerDespertador = null;
let detenerServidorWeb = null;
const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
let tray = null;
// Se pone en true sólo cuando de verdad hay que cerrar todo (desde el menú
// de la bandeja). El resto del tiempo, cerrar la ventana la esconde nomás —
// así un click de más en la "X" no apaga el servidor que usa el celular ni la
// sincronización con las otras PCs.
let saliendoDeVerdad = false;
let avisoBandejaMostrado = false;
// 'esperando': esta PC todavía no tiene los datos de la red (ver
// primeraSincronizacion) y la ventana muestra un cartel en vez de la app.
let estadoArranque = 'iniciando';
function createWindow() {
    if (sinVentana)
        return;
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: '#f2f7fd',
        // (Para las pruebas automáticas que manejan la pantalla sin mostrarla.)
        show: process.env.MIS_AMORES_VENTANA_OCULTA !== '1',
        autoHideMenuBar: true,
        icon: path_1.default.join(__dirname, '../../build-assets/icon.png'),
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            // El preload compilado hace require() de archivos locales (shared/channels,
            // shared/types); con sandbox:true Electron restringe el preload a un
            // require() polyfillado que sólo resuelve módulos nativos de Node, así que
            // esos require() fallarían en silencio y window.api nunca se expondría.
            sandbox: false,
        },
    });
    if (estadoArranque === 'esperando') {
        mostrarEsperandoRed();
    }
    else if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
    // Cerrar la ventana no cierra la app: la esconde. El servidor para el
    // celular, la base y la sincronización siguen andando en segundo plano.
    mainWindow.on('close', (e) => {
        if (!saliendoDeVerdad) {
            e.preventDefault();
            mainWindow?.hide();
            if (!avisoBandejaMostrado) {
                avisoBandejaMostrado = true;
                tray?.displayBalloon({
                    title: 'Mis Amores sigue funcionando',
                    content: 'Se minimizó a la bandeja para que el celular y las otras PCs sigan al día. Para cerrarla del todo, click derecho en el ícono de la bandeja y "Salir de verdad".',
                });
            }
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function mostrarVentana() {
    if (mainWindow) {
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
    else {
        createWindow();
    }
}
function crearBandeja() {
    if (sinVentana)
        return;
    const icono = electron_1.nativeImage.createFromPath(path_1.default.join(__dirname, '../../build-assets/icon.ico'));
    tray = new electron_1.Tray(icono);
    tray.on('click', mostrarVentana);
    // Tocar el globito de aviso (ej. "hay una actualización nueva") abre la app.
    tray.on('balloon-click', mostrarVentana);
    actualizarMenuBandeja();
}
// El menú de la bandeja cambia según la actualización: si hay una versión
// nueva ofrece bajarla, y si ya está bajada, instalarla — así también se
// puede actualizar sin tener que abrir la ventana.
function actualizarMenuBandeja() {
    if (!tray)
        return;
    const estado = estadoActualizacion;
    let itemActualizacion;
    if (estado.tipo === 'disponible') {
        itemActualizacion = { label: `Descargar actualización (versión ${estado.version})`, click: descargarActualizacion };
    }
    else if (estado.tipo === 'descargando') {
        itemActualizacion = { label: 'Descargando actualización...', enabled: false };
    }
    else if (estado.tipo === 'lista') {
        itemActualizacion = {
            label: `Reiniciar e instalar actualización (versión ${estado.version})`,
            click: instalarActualizacion,
        };
    }
    else {
        itemActualizacion = {
            label: estado.tipo === 'buscando' ? 'Buscando actualizaciones...' : 'Buscar actualizaciones',
            enabled: estado.tipo !== 'buscando',
            click: buscarActualizacionesManual,
        };
    }
    const hayActualizacion = estado.tipo === 'disponible' || estado.tipo === 'lista';
    const nombre = 'Mis Amores - Gestión';
    tray.setToolTip(hayActualizacion ? `${nombre} — hay una actualización` : nombre);
    tray.setContextMenu(electron_1.Menu.buildFromTemplate([
        { label: 'Abrir Mis Amores', click: mostrarVentana },
        itemActualizacion,
        { type: 'separator' },
        {
            label: 'Salir de verdad (apaga el acceso desde el celular y la sincronización)',
            click: () => {
                saliendoDeVerdad = true;
                electron_1.app.quit();
            },
        },
    ]));
}
// --- Actualización automática ---
// Busca en GitHub (ver "publish" en package.json) si hay una versión más
// nueva de la app. Nunca baja ni instala nada sin que alguien lo pida: si
// encuentra una, lo avisa con el cartel de arriba de la pantalla y el botón
// del menú (y con un globito en la bandeja si la ventana está escondida),
// sin cortar lo que se esté haciendo. Antes era un cartel que tapaba todo en
// medio de una venta, y si se le decía "Ahora no" no quedaba ningún aviso de
// que seguía pendiente. Sólo la búsqueda manual ("Buscar actualizaciones")
// contesta con un cartel, porque ahí alguien está esperando la respuesta.
//
// Sólo funciona en la versión instalada — en desarrollo no existe el archivo
// que electron-updater necesita, salvo que se arranque con
// MIS_AMORES_PROBAR_ACTUALIZACIONES=1 (usa dev-app-update.yml), que sirve para
// probar todo el circuito sin instalar nada.
// (La app instalada lo ignora siempre, aunque herede esa variable de algún lado.)
const probandoActualizaciones = !electron_1.app.isPackaged && process.env.MIS_AMORES_PROBAR_ACTUALIZACIONES === '1';
const actualizacionesActivas = electron_1.app.isPackaged || probandoActualizaciones;
let estadoActualizacion = { tipo: 'al-dia' };
let buscandoManualmente = false;
// Justo después de publicar una versión, GitHub puede tardar varios segundos
// en tener el archivo latest.yml del todo disponible — si alguien busca
// actualizaciones en ese ratito le puede tocar un 404 pasajero. En vez de
// mostrar el error de una, reintentamos unas cuantas veces antes de avisar
// que algo realmente falló.
let reintentosBusqueda = 0;
const MAX_REINTENTOS_BUSQUEDA = 3;
const ESPERA_REINTENTO_MS = 5000;
// Para no repetir el globito de la bandeja cada 2 horas por la misma versión.
let ultimaVersionAvisada = null;
function infoActualizacion() {
    return { versionActual: electron_1.app.getVersion(), estado: estadoActualizacion };
}
function versionDe(estado) {
    return 'version' in estado ? estado.version : null;
}
function setEstadoActualizacion(nuevo) {
    const anterior = estadoActualizacion;
    estadoActualizacion = nuevo;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channels_1.Channels.sistemaCambioActualizacion, infoActualizacion());
    }
    // El menú de la bandeja no muestra el porcentaje — sólo hace falta
    // rearmarlo cuando cambia de etapa, no en cada avance de la descarga.
    if (anterior.tipo !== nuevo.tipo || versionDe(anterior) !== versionDe(nuevo))
        actualizarMenuBandeja();
}
// Antes de mostrar cualquier cartel de actualización, mostramos y
// enfocamos la ventana principal — si no, dialog.showMessageBox() sin una
// ventana "dueña" puede abrirse sin foco (a veces hasta detrás de la
// ventana principal en Windows), y parece que "no pasó nada" al tocar el
// botón aunque el cartel sí se haya abierto.
function traerVentanaAlFrente() {
    if (!mainWindow)
        return;
    mainWindow.show();
    mainWindow.focus();
}
// dialog.showMessageBox no acepta "undefined" como primer argumento (sólo
// una BrowserWindow real u omitirlo del todo) — esta función elige la
// variante correcta según si la ventana existe en ese momento. Se usa en vez
// de dialog.showErrorBox porque ése frena todo el proceso principal (también
// el servidor de los celulares) hasta que alguien lo cierre.
function mostrarMensaje(options) {
    return mainWindow ? electron_1.dialog.showMessageBox(mainWindow, options) : electron_1.dialog.showMessageBox(options);
}
// Si la ventana está a la vista ya alcanza con el cartel de adentro de la
// app; si está escondida en la bandeja, avisamos con el globito de Windows.
function avisarEnBandejaSiOculta(titulo, contenido) {
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized())
        return;
    tray?.displayBalloon({ title: titulo, content: contenido });
}
function buscarActualizacionesManual() {
    // Si ya hay una bajándose o lista para instalar, no tiene sentido buscar
    // de nuevo — mostramos la ventana, donde el cartel de arriba dice en qué anda.
    if (estadoActualizacion.tipo === 'descargando' || estadoActualizacion.tipo === 'lista') {
        traerVentanaAlFrente();
        return;
    }
    if (!actualizacionesActivas) {
        traerVentanaAlFrente();
        mostrarMensaje({
            type: 'info',
            message: 'Las actualizaciones sólo se buscan en la app instalada, no en el modo desarrollo.',
        });
        return;
    }
    buscandoManualmente = true;
    reintentosBusqueda = 0;
    setEstadoActualizacion({ tipo: 'buscando' });
    // Si checkForUpdates falla, dispara el evento 'error' (que reintenta y
    // avisa) y ADEMÁS rechaza esta promesa. Antes este rechazo mostraba su
    // propio cartel de error en el acto, así que los reintentos nunca llegaban
    // a servir y aparecía el error técnico crudo; ahora sólo avisa el evento.
    electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
}
function descargarActualizacion() {
    if (estadoActualizacion.tipo !== 'disponible')
        return;
    setEstadoActualizacion({ tipo: 'descargando', version: estadoActualizacion.version, porcentaje: 0 });
    // Mismo criterio que checkForUpdates: si falla, avisa el evento 'error'
    // (que vuelve a "disponible" con el motivo, para poder reintentar). Antes
    // un error acá no avisaba nada y parecía que la descarga nunca terminaba.
    electron_updater_1.autoUpdater.downloadUpdate().catch(() => { });
}
function instalarActualizacion() {
    if (estadoActualizacion.tipo !== 'lista')
        return;
    // En el modo de prueba (desarrollo) no se instala nada de verdad: correría
    // el instalador descargado sobre esta PC.
    if (probandoActualizaciones) {
        traerVentanaAlFrente();
        mostrarMensaje({
            type: 'info',
            message: `Modo prueba: acá la app se reiniciaría para instalar la versión ${estadoActualizacion.version}.`,
        });
        return;
    }
    saliendoDeVerdad = true;
    logCrash('quitAndInstall', `iniciando instalación de ${estadoActualizacion.version}`);
    // isSilent:false para que se vea la ventana del instalador (antes
    // quedaba en su modo silencioso por defecto y no se notaba nada);
    // isForceRunAfter:true para que la app vuelva a abrirse sola al
    // terminar, en vez de quedar cerrada esperando que alguien la abra.
    electron_updater_1.autoUpdater.quitAndInstall(false, true);
}
// El chequeo de fondo. Si ya hay una versión bajándose o lista para
// instalar, no vuelve a preguntar — antes, cada 2 horas, volvía a ofrecer
// bajar una actualización que ya estaba bajada.
function chequeoAutomatico() {
    if (estadoActualizacion.tipo === 'descargando' || estadoActualizacion.tipo === 'lista')
        return;
    electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
}
function configurarActualizaciones() {
    if (!actualizacionesActivas)
        return;
    if (probandoActualizaciones)
        electron_updater_1.autoUpdater.forceDevUpdateConfig = true;
    // No baja nada solo — recién arranca la descarga cuando alguien la pide.
    electron_updater_1.autoUpdater.autoDownload = false;
    // (En el modo de prueba tampoco instala al cerrar, por lo mismo que en
    // instalarActualizacion.)
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = !probandoActualizaciones;
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        const eraManual = buscandoManualmente;
        buscandoManualmente = false;
        reintentosBusqueda = 0;
        const actual = estadoActualizacion;
        if ((actual.tipo === 'descargando' || actual.tipo === 'lista') && actual.version === info.version)
            return;
        setEstadoActualizacion({ tipo: 'disponible', version: info.version });
        if (eraManual) {
            traerVentanaAlFrente();
            mostrarMensaje({
                type: 'info',
                title: 'Actualización disponible',
                message: `Hay una actualización nueva (versión ${info.version}). ¿Querés instalarla?`,
                detail: 'Se descarga en segundo plano y se puede seguir usando la app mientras tanto. Cuando esté lista, el cartel de arriba avisa para reiniciar.',
                buttons: ['Sí, descargar', 'Ahora no'],
                defaultId: 0,
                cancelId: 1,
            }).then(({ response }) => {
                if (response === 0)
                    descargarActualizacion();
            });
        }
        else if (ultimaVersionAvisada !== info.version) {
            avisarEnBandejaSiOculta('Hay una actualización de Mis Amores', `La versión ${info.version} está disponible. Abrí la app para descargarla.`);
        }
        ultimaVersionAvisada = info.version;
    });
    electron_updater_1.autoUpdater.on('download-progress', (progreso) => {
        const actual = estadoActualizacion;
        if (actual.tipo !== 'descargando')
            return;
        // El evento llega varias veces por segundo — sólo avisamos a la pantalla
        // cuando cambia el número entero del porcentaje.
        const porcentaje = Math.floor(progreso.percent);
        if (porcentaje === actual.porcentaje)
            return;
        setEstadoActualizacion({ tipo: 'descargando', version: actual.version, porcentaje });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        setEstadoActualizacion({ tipo: 'lista', version: info.version });
        avisarEnBandejaSiOculta('Actualización lista para instalar', `La versión ${info.version} ya se descargó. Abrí Mis Amores y tocá "Reiniciar y actualizar".`);
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        logCrash('autoUpdater', err);
        // Falló la descarga (se cortó internet, etc.): vuelve a "disponible" con
        // el motivo, así el cartel de arriba lo muestra y deja reintentar.
        const actual = estadoActualizacion;
        if (actual.tipo === 'descargando') {
            setEstadoActualizacion({
                tipo: 'disponible',
                version: actual.version,
                error: 'No se pudo terminar de descargar. Revisá que haya internet e intentá de nuevo.',
            });
            return;
        }
        if (buscandoManualmente && reintentosBusqueda < MAX_REINTENTOS_BUSQUEDA) {
            // Puede ser el 404 pasajero de recién publicada — reintentamos calladito
            // antes de asumir que es un error de verdad.
            reintentosBusqueda++;
            setTimeout(() => electron_updater_1.autoUpdater.checkForUpdates().catch(() => { }), ESPERA_REINTENTO_MS);
            return;
        }
        // Si el buscador manual fue el que disparó esto (y ya se agotaron los
        // reintentos), avisamos — si fue el chequeo automático de fondo, no
        // molestamos a nadie con un error que no pueden solucionar (lo más común:
        // esta PC no tiene internet en ese momento).
        if (buscandoManualmente) {
            traerVentanaAlFrente();
            mostrarMensaje({
                type: 'error',
                title: 'No se pudo buscar actualizaciones',
                message: 'No se pudo conectar para buscar actualizaciones.',
                detail: 'Revisá que esta PC tenga conexión a internet e intentá de nuevo.',
            });
        }
        buscandoManualmente = false;
        reintentosBusqueda = 0;
        if (estadoActualizacion.tipo === 'buscando')
            setEstadoActualizacion({ tipo: 'al-dia' });
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        const eraManual = buscandoManualmente;
        buscandoManualmente = false;
        reintentosBusqueda = 0;
        setEstadoActualizacion({ tipo: 'al-dia' });
        if (eraManual) {
            traerVentanaAlFrente();
            mostrarMensaje({
                type: 'info',
                title: 'Sin actualizaciones',
                message: 'Ya tenés la última versión instalada.',
                detail: `Versión ${electron_1.app.getVersion()}`,
            });
        }
    });
    // Primer chequeo al ratito de abrir (no de una, para no competir con el
    // arranque de la base y la ventana) y después cada 2 horas mientras quede
    // prendida.
    setTimeout(chequeoAutomatico, 15000);
    setInterval(chequeoAutomatico, 2 * 60 * 60 * 1000);
}
// --- Red de PCs ---
// En el negocio hay más de una PC y todas son iguales: cada una guarda todos
// los datos y trabaja sola (aunque no vea a las otras), y lo que se carga en
// cualquiera llega a las demás en vivo por el WiFi del local, sin internet ni
// PC "principal" (ver electron/sync). Si una estaba apagada, al volver se pone
// al día sola.
let diario = null;
let motor = null;
let aplicador = null;
let temporizadorMantenimiento = null;
// Mismo formato { ok, data } / { ok:false, error } que el resto de la app,
// así el preload desenvuelve el error con su mensaje tal cual.
async function wrapEscritorio(fn) {
    try {
        return { ok: true, data: await fn() };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
    }
}
function miIdRed() {
    return config.claveRed ? (0, motor_1.idDeRed)(config.claveRed) : null;
}
function infoPc() {
    return {
        app: 'mis-amores-gestion',
        idPc: config.idPc,
        nombrePc: os_1.default.hostname(),
        version: electron_1.app.getVersion(),
        // Las versiones anteriores distinguían "principal" de "conectada".
        modo: 'principal',
        idRed: miIdRed() ?? undefined,
        // Sólo en el servidor de internet: si se durmiera, el proceso arrancaría de
        // nuevo y esto volvería a cero (así se comprueba que no se duerme).
        segundosEncendido: (0, nube_1.esModoNube)() ? Math.round(process.uptime()) : undefined,
    };
}
// "192.168.1.50" -> "192.168.1.50:4000" (si no se escribió el puerto, va el de siempre).
function normalizarDireccion(texto) {
    const limpio = String(texto ?? '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '');
    if (!limpio)
        throw new Error('Escribí la dirección de la otra PC (por ejemplo 192.168.1.50).');
    return /:\d+$/.test(limpio) ? limpio : `${limpio}:4000`;
}
const MENSAJE_VERSION_VIEJA = 'Esa PC respondió, pero con una versión de Mis Amores que todavía no sabe sumarse a la red. Actualizala primero.';
async function pedirJson(url, opciones = {}) {
    let respuesta;
    try {
        respuesta = await fetch(url, {
            method: opciones.metodo ?? 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
            },
            body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
            signal: AbortSignal.timeout(opciones.esperaMs ?? 8000),
        });
    }
    catch {
        throw new Error('No se pudo conectar con esa PC. Fijate que esté prendida, con Mis Amores abierto y en el mismo WiFi.');
    }
    let json;
    try {
        json = (await respuesta.json());
    }
    catch {
        throw new Error(MENSAJE_VERSION_VIEJA);
    }
    if (!json.ok)
        throw new Error(json.error ?? 'La otra PC devolvió un error');
    return json.data;
}
async function obtenerInfoPc(direccion) {
    const info = await pedirJson(`http://${direccion}/api/sistema/info`, { esperaMs: 3000 });
    if (!info || info.app !== 'mis-amores-gestion' || !info.idPc)
        throw new Error(MENSAJE_VERSION_VIEJA);
    return info;
}
// Pregunta en la red quién es "misamores.local": lo contesta la app de cada
// PC con su IP (ver server/mdns.ts).
function consultarMdns(esperaMs) {
    return new Promise((resolve) => {
        const ips = new Set();
        let consulta;
        try {
            consulta = (0, multicast_dns_1.default)();
        }
        catch {
            resolve([]);
            return;
        }
        consulta.on('error', () => { });
        consulta.on('response', (respuesta) => {
            for (const r of [...respuesta.answers, ...(respuesta.additionals ?? [])]) {
                if (r.type === 'A' && r.name.toLowerCase() === mdns_1.NOMBRE_HOST && typeof r.data === 'string')
                    ips.add(r.data);
            }
        });
        const preguntar = () => {
            try {
                consulta.query({ questions: [{ name: mdns_1.NOMBRE_HOST, type: 'A' }] });
            }
            catch {
                // Sin red en este momento: no se encuentra nada, y listo.
            }
        };
        preguntar();
        const intervalo = setInterval(preguntar, 700);
        setTimeout(() => {
            clearInterval(intervalo);
            try {
                consulta.destroy();
            }
            catch {
                // ya estaba cerrada
            }
            resolve([...ips]);
        }, esperaMs);
    });
}
// Las direcciones donde puede haber otra PC con Mis Amores.
async function direccionesCandidatas() {
    // Dos caminos a la vez: el aviso "misamores.local" (rápido, pero muchos routers
    // y redes de escuela no lo dejan pasar) y preguntarle directo a cada dirección
    // de la red de la casa (ver escaneoRed.ts). Un servidor de internet no barre
    // nada: no tiene "la red de al lado".
    const [ips, barridas] = await Promise.all([
        consultarMdns(2500),
        modoServidor ? Promise.resolve([]) : (0, escaneoRed_1.escanearRedLocal)((0, httpServer_1.obtenerIpsLan)(), httpServer_1.PUERTO).catch(() => []),
    ]);
    const direcciones = new Set([...ips.map((ip) => `${ip}:4000`), ...barridas]);
    // En desarrollo, las PCs de prueba escuchan en otros puertos.
    if (!electron_1.app.isPackaged) {
        const extra = (process.env.MIS_AMORES_PUERTOS_BUSQUEDA ?? '')
            .split(',')
            .map((p) => Number(p))
            .filter((p) => p > 0);
        for (const ip of [...ips, '127.0.0.1'])
            for (const puerto of [4001, 4002, ...extra])
                direcciones.add(`${ip}:${puerto}`);
    }
    for (const p of config.pares)
        direcciones.add(p.direccion);
    // Una PC que venía "conectada" a otra la busca donde estaba.
    if (config.direccionAnterior)
        direcciones.add(config.direccionAnterior);
    return direcciones;
}
// Las PCs con Mis Amores que hay en la red (sin contar a esta), con su info.
async function buscarConInfo() {
    const direcciones = await direccionesCandidatas();
    const encontradas = await Promise.all([...direcciones].map(async (direccion) => {
        try {
            return { direccion, info: (await obtenerInfoPc(direccion)) };
        }
        catch (err) {
            // Contesta pero no sabe decir quién es: tiene una versión vieja.
            return err instanceof Error && err.message === MENSAJE_VERSION_VIEJA ? { direccion, info: null } : null;
        }
    }));
    const porPc = new Map();
    for (const e of encontradas) {
        if (!e)
            continue;
        if (e.info && e.info.idPc === config.idPc)
            continue;
        const clave = e.info?.idPc ?? e.direccion;
        // La misma PC puede aparecer por dos caminos: mejor la IP de la red que 127.0.0.1.
        if (!porPc.has(clave) || porPc.get(clave).direccion.startsWith('127.'))
            porPc.set(clave, e);
    }
    return [...porPc.values()];
}
async function buscarPcsParaSumar() {
    const mia = miIdRed();
    return (await buscarConInfo()).map(({ direccion, info }) => ({
        direccion,
        nombrePc: info?.nombrePc ?? null,
        version: info?.version ?? null,
        versionVieja: !info,
        enMiRed: !!info && !!mia && info.idRed === mia,
    }));
}
// Las PCs de MI red que contestan (con la clave): lo que usa el motor para
// encontrar de nuevo a una PC que cambió de dirección y para descubrir PCs
// nuevas.
async function buscarPcsConHola() {
    if (!motor)
        return [];
    const m = motor;
    const direcciones = await direccionesCandidatas();
    const lista = [];
    await Promise.all([...direcciones].map(async (direccion) => {
        try {
            const hola = await m.hola(direccion, 2500);
            if (hola.idPc !== config.idPc && hola.idRed === miIdRed())
                lista.push({ direccion, hola });
        }
        catch {
            // No es una PC de esta red (o no contesta): no cuenta.
        }
    }));
    return lista;
}
function reiniciarApp() {
    saliendoDeVerdad = true;
    electron_1.app.relaunch();
    electron_1.app.exit(0);
}
function marcaDeTiempo() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function pausa(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function guardarPares(pares) {
    (0, configuracion_1.guardarConfiguracion)({ ...config, pares });
    config = (0, configuracion_1.leerConfiguracion)();
    void guardarIdentidadEnBase();
}
// Una segunda copia de quién es esta PC en la red (su identificador, la clave y
// las otras PCs), en la propia base: si el archivo de configuración se pierde,
// la PC no se queda sin red ni obliga a volver a sumarla (lo que borraría sus
// datos). No se sincroniza con las otras PCs. Va atada a esta máquina: si la
// base se clona en otra PC (exportar / importar), la copia NO vale ahí, y las
// dos PCs no terminan con el mismo identificador.
function huellaDeEstaMaquina() {
    return crypto_1.default.createHash('sha1').update(`${os_1.default.hostname()}|${electron_1.app.getPath('userData')}`).digest('hex');
}
async function guardarIdentidadEnBase() {
    try {
        if (!config.claveRed)
            return;
        await (0, database_1.getDbCruda)()
            .collection('ajustes_sistema')
            .updateOne({ _id: 'red' }, {
            $set: {
                idPc: config.idPc,
                claveRed: config.claveRed,
                pares: config.pares,
                maquina: huellaDeEstaMaquina(),
            },
        }, { upsert: true });
    }
    catch (err) {
        logCrash('red', err);
    }
}
async function restaurarIdentidadDesdeBase() {
    // Sólo si la configuración parece recién creada: sin clave, sin otras PCs.
    if (config.claveRed || config.pares.length > 0 || config.inicial === 'traer')
        return;
    try {
        const doc = await (0, database_1.getDbCruda)()
            .collection('ajustes_sistema')
            .findOne({ _id: 'red' });
        if (doc &&
            doc.maquina === huellaDeEstaMaquina() &&
            typeof doc.idPc === 'string' &&
            typeof doc.claveRed === 'string' &&
            doc.claveRed) {
            (0, configuracion_1.guardarConfiguracion)({ ...config, idPc: doc.idPc, claveRed: doc.claveRed, pares: Array.isArray(doc.pares) ? doc.pares : [] });
            config = (0, configuracion_1.leerConfiguracion)();
            logCrash('red', 'se recuperó la identidad de la red desde la base (faltaba el archivo de configuración)');
        }
    }
    catch (err) {
        logCrash('red', err);
    }
}
// Deja esta PC con los datos de la red: respalda lo que tenía, lo reemplaza
// por lo que tiene la otra PC (que ya incluye lo que esta le pasó) y empieza
// a mantenerse al día.
async function adoptarRed(union, direccion) {
    if (!diario || !motor)
        throw new Error('La sincronización todavía no arrancó. Probá de nuevo en unos segundos.');
    const par = { idPc: union.idPc, nombre: union.nombrePc, direccion };
    // Primero se baja TODO de la otra PC (sin tocar nada de esta): si la red se
    // corta en el medio, esta PC queda exactamente como estaba.
    const clavePrevia = config.claveRed;
    (0, configuracion_1.guardarConfiguracion)({ ...config, claveRed: union.claveRed });
    config = (0, configuracion_1.leerConfiguracion)();
    let descarga;
    try {
        descarga = await motor.descargarTodo(par);
    }
    catch (err) {
        (0, configuracion_1.guardarConfiguracion)({ ...config, claveRed: clavePrevia });
        config = (0, configuracion_1.leerConfiguracion)();
        throw err;
    }
    // Con todo en mano: respaldo de lo que había, y se reemplaza.
    await (0, backup_1.respaldoExtra)(`antes-de-sumarse-a-la-red-${marcaDeTiempo()}`);
    motor.quitarTodos();
    await diario.vaciarTodo();
    (0, configuracion_1.guardarConfiguracion)({
        ...config,
        claveRed: union.claveRed,
        pares: [],
        inicial: 'listo',
        direccionAnterior: null,
        nombreAnterior: null,
    });
    config = (0, configuracion_1.leerConfiguracion)();
    await motor.aplicarDescarga(par, descarga);
    await diario.marcarBarrido();
    await guardarIdentidadEnBase();
    motor.agregarPar(par);
    for (const otro of union.pares)
        if (otro.idPc !== config.idPc)
            motor.agregarPar(otro);
    // Las cuentas y sesiones de antes ya no existen: hay que volver a entrar
    // (la pantalla lo avisa y ofrece el botón).
    (0, tokenSessions_1.invalidarTodasLasSesiones)();
    (0, session_1.setSesion)(null);
}
async function sumarPcALaRed(p) {
    (0, session_1.requiereAdmin)();
    const direccion = normalizarDireccion(p.direccion);
    const info = await obtenerInfoPc(direccion);
    if (info.idPc === config.idPc)
        throw new Error('Esa dirección es esta misma PC: tenés que elegir la otra.');
    if (!info.idRed)
        throw new Error(MENSAJE_VERSION_VIEJA);
    const mia = miIdRed();
    if (mia && info.idRed === mia && config.pares.some((x) => x.idPc === info.idPc)) {
        throw new Error('Esa PC ya forma parte de la misma red que esta.');
    }
    const base = `http://${direccion}`;
    const sesion = await pedirJson(`${base}/api/auth/login`, {
        metodo: 'POST',
        cuerpo: { usuario: String(p.usuario ?? '').trim(), password: String(p.password ?? '') },
    });
    try {
        if (sesion.rol !== 'admin')
            throw new Error('Hace falta entrar con una cuenta de administradora de la otra PC.');
        // Lo que esta PC tiene de propio se pasa a la otra primero (una sola vez).
        let resumen = null;
        if (!p.soloTraer) {
            const datos = await (0, juntarDatos_1.exportarDatosParaJuntar)(os_1.default.hostname());
            resumen = await pedirJson(`${base}/api/sistema/juntar-datos`, {
                metodo: 'POST',
                token: sesion.token,
                cuerpo: { datos, simular: p.simular === true },
                esperaMs: 10 * 60 * 1000,
            });
        }
        if (p.simular === true)
            return { resumen, nombrePc: info.nombrePc };
        const union = await pedirJson(`${base}/api/sync/unirse`, {
            metodo: 'POST',
            token: sesion.token,
            cuerpo: { idPc: config.idPc, nombrePc: os_1.default.hostname(), puerto: httpServer_1.PUERTO },
        });
        await adoptarRed(union, direccion);
        logCrash('red', `esta PC se sumó a la red de ${info.nombrePc} (${direccion})`);
        return { resumen, nombrePc: info.nombrePc };
    }
    finally {
        pedirJson(`${base}/api/auth/logout`, { metodo: 'POST', token: sesion.token }).catch(() => { });
    }
}
// Las contraseñas más obvias: en internet son lo primero que prueba cualquiera.
const CONTRASENAS_OBVIAS = [
    'admin123',
    'admin',
    '1234',
    '12345',
    '123456',
    '12345678',
    'password',
    'contraseña',
    'misamores',
    'qwerty',
];
// Cuentas activas que todavía usan una de esas contraseñas.
async function cuentasConContrasenaObvia() {
    const docs = await (0, database_1.getDbCruda)()
        .collection('usuarios')
        .find({ activo: true })
        .toArray();
    const malas = [];
    for (const d of docs) {
        if (!d.passwordHash || !d.usuario)
            continue;
        for (const clave of CONTRASENAS_OBVIAS) {
            // La versión asíncrona: no congela la ventana mientras compara.
            if (await bcryptjs_1.default.compare(clave, d.passwordHash)) {
                malas.push(d.usuario);
                break;
            }
        }
    }
    return malas;
}
// Conecta esta PC con el servidor de internet (ver SERVIDOR_RENDER.md). No
// reemplaza ningún dato de acá: sólo lo suma a la lista de PCs de la red. Desde
// ahí esta PC le manda lo suyo (él no puede llamarla) y recibe lo que se cargue
// desde los celulares.
async function conectarServidorNube(texto) {
    (0, session_1.requiereAdmin)();
    if (!motor)
        throw new Error('La sincronización todavía no arrancó. Probá de nuevo en unos segundos.');
    const direccion = (0, nube_1.normalizarUrlNube)(texto);
    const debiles = await cuentasConContrasenaObvia();
    if (debiles.length > 0) {
        throw new Error(`Antes de conectar con internet, cambiá la contraseña de: ${debiles.join(', ')}. ` +
            'Con una contraseña fácil (como la de fábrica), cualquiera en internet podría probarla y entrar a los datos del negocio.');
    }
    let hola;
    try {
        // Un servicio gratuito que estaba dormido tarda hasta un minuto en despertar.
        hola = await motor.hola(direccion, 90000);
    }
    catch (err) {
        if (err instanceof motor_1.ErrorDeSync && err.tipo === 'clave') {
            throw new Error('El servidor contestó, pero no tiene la misma clave de red que esta PC (o la fecha y la hora de alguno están mal puestas). ' +
                'Revisá que MIS_AMORES_CLAVE_RED en Render sea la de esta PC.');
        }
        const detalle = err instanceof Error ? err.message : 'sin respuesta';
        throw new Error(`No se pudo conectar con ${direccion}: ${detalle}`);
    }
    if (hola.idPc === config.idPc)
        throw new Error('Esa dirección es de esta misma PC.');
    motor.agregarPar({ idPc: hola.idPc, nombre: 'Servidor de internet', direccion });
    logCrash('red', `esta PC se conectó al servidor de internet (${direccion})`);
    return { direccion };
}
// ¿Anda el servidor de internet? Es una pregunta aparte de si ESTA PC está
// conectada con él para sincronizar: la página puede andar perfecto y aun así
// esta PC no poder hablar con ella (por ejemplo, si tiene otra clave de red).
async function probarServidorWeb(texto) {
    const direccion = (0, nube_1.normalizarUrlNube)(texto);
    try {
        const info = await pedirJson(`${direccion}/api/sistema/info`, { esperaMs: 25000 });
        const mia = miIdRed();
        return {
            funciona: true,
            version: typeof info.version === 'string' ? info.version : null,
            mismaRed: mia && info.idRed ? info.idRed === mia : null,
            error: null,
        };
    }
    catch (err) {
        return {
            funciona: false,
            version: null,
            mismaRed: null,
            error: err instanceof Error ? err.message : 'No contesta',
        };
    }
}
// Esta PC deja de sincronizar con las demás: se queda con sus datos, como
// una red de una sola PC (con una clave nueva, así las otras no la buscan).
async function salirDeLaRed() {
    (0, session_1.requiereAdmin)();
    if (!motor)
        throw new Error('La sincronización todavía no arrancó.');
    motor.quitarTodos();
    (0, configuracion_1.guardarConfiguracion)({
        ...config,
        claveRed: crypto_1.default.randomBytes(24).toString('hex'),
        pares: [],
        inicial: 'listo',
        direccionAnterior: null,
        nombreAnterior: null,
    });
    config = (0, configuracion_1.leerConfiguracion)();
    await guardarIdentidadEnBase();
    logCrash('red', 'esta PC salió de la red');
    return true;
}
async function estadoRed() {
    const m = motor?.estado();
    return {
        idPc: config.idPc,
        nombrePc: os_1.default.hostname(),
        versionApp: electron_1.app.getVersion(),
        pcs: (m?.pares ?? config.pares.map((p) => ({ ...p, enLinea: false, ultimaVez: null, version: null, pendientes: 0, error: null }))).map((p) => ({
            idPc: p.idPc,
            nombrePc: 'nombre' in p ? p.nombre : '',
            direccion: p.direccion,
            enLinea: p.enLinea,
            ultimaVez: p.ultimaVez,
            version: p.version,
            pendientes: p.pendientes,
            error: p.error,
        })),
        sincronizando: m?.sincronizando ?? false,
        poniendoseAlDia: m?.poniendoseAlDia ?? false,
        progreso: m?.progreso ?? null,
        avisos: diario ? await diario.avisos() : [],
        pendienteDeSumarse: config.pares.length === 0 && config.direccionAnterior
            ? { direccion: config.direccionAnterior, nombre: config.nombreAnterior }
            : null,
    };
}
// --- Del arranque ---
// Una PC que venía "conectada" a otra (versión anterior) no tiene datos
// propios que sirvan: al arrancar trae los de la red. Si la otra PC no está,
// usa la última copia que había guardado. Devuelve false si no pudo ninguna
// de las dos (entonces espera, con un cartel, a que la otra PC esté).
async function primeraSincronizacion() {
    if (config.inicial !== 'traer' || !motor || !diario)
        return true;
    const m = motor;
    const d = diario;
    let par = null;
    const limite = Date.now() + 25000;
    while (!par && Date.now() < limite) {
        for (const p of config.pares) {
            try {
                const h = await m.hola(p.direccion, 3000);
                par = { idPc: h.idPc, nombre: h.nombrePc, direccion: p.direccion };
                break;
            }
            catch {
                // No contesta en esa dirección.
            }
        }
        if (!par) {
            const h = (await buscarPcsConHola())[0];
            if (h)
                par = { idPc: h.hola.idPc, nombre: h.hola.nombrePc, direccion: h.direccion };
        }
        if (!par)
            await pausa(2000);
    }
    if (par) {
        // Se baja todo antes de tocar nada: si se corta, no se perdió nada y se
        // vuelve a intentar (esta PC sigue en "traer").
        let descarga;
        try {
            descarga = await m.descargarTodo(par);
        }
        catch (err) {
            logCrash('red', err);
            return false;
        }
        await (0, backup_1.respaldoExtra)(`antes-de-traer-los-datos-${marcaDeTiempo()}`);
        await d.vaciarTodo();
        await (0, database_1.getDbCruda)().collection('sesiones').deleteMany({});
        await m.aplicarDescarga(par, descarga);
        await d.marcarBarrido();
        (0, configuracion_1.guardarConfiguracion)({ ...config, pares: [par], inicial: 'listo', direccionAnterior: null, nombreAnterior: null });
        config = (0, configuracion_1.leerConfiguracion)();
        logCrash('red', `se trajeron los datos de ${par.nombre} (${par.direccion})`);
        return true;
    }
    if ((0, replica_1.leerMetaCopia)()) {
        await (0, replica_1.cargarCopiaEnEstaPc)();
        await (0, database_1.asegurarIndices)();
        // La copia reemplazó la base entera: el diario vuelve a leer su estado, y
        // lo cargado queda con la marca "de copia" (pierde contra lo de la otra PC).
        await d.iniciar();
        // Primero el "stock inicial" (que es parte de los datos de la copia) y
        // recién después se anota todo como "de copia".
        await (0, aplicar_1.completarStockBase)(d);
        await d.barrer({ marcaNuevos: 'copia' });
        await d.marcarBarrido();
        (0, configuracion_1.guardarConfiguracion)({ ...config, inicial: 'listo' });
        config = (0, configuracion_1.leerConfiguracion)();
        logCrash('red', 'la otra PC no estaba: se usó la última copia guardada');
        return true;
    }
    return false;
}
// Cuando otra PC cambia o desactiva a un usuario, la sesión abierta en esta PC
// tiene que reflejarlo: si no, quien estaba logueada seguía con su rol y sus
// permisos de antes hasta cerrar sesión (los celulares ya se cerraban solos).
// La pantalla se entera sola: al llegar el aviso de datos cambiados vuelve a
// pedir la sesión (ver AuthContext).
async function refrescarSesionDeEscritorio(idUsuario) {
    const sesion = (0, session_1.getSesion)();
    if (!sesion || sesion.id !== idUsuario)
        return;
    const actual = await (0, usuarios_1.getUsuario)(idUsuario);
    if (!actual || !actual.activo) {
        (0, session_1.setSesion)(null);
        return;
    }
    const { activo: _activo, ...datosSesion } = actual;
    (0, session_1.setSesion)(datosSesion);
}
// Arma el diario, el aplicador y el motor, y deja la base lista para
// sincronizar. Devuelve false si todavía no se pueden usar los datos.
async function prepararSincronizacion() {
    const db = (0, database_1.getDbCruda)();
    await restaurarIdentidadDesdeBase();
    diario = new diario_1.Diario(db, new reloj_1.Reloj(config.idPc), config.idPc);
    diario.alFallar = (etiqueta, err) => logCrash(etiqueta, err);
    await diario.iniciar();
    (0, database_1.instalarDiario)(diario);
    if (!config.claveRed) {
        // La primera PC de una red usa la clave que ya tenía para las copias (así
        // las PCs de la versión anterior que se conectaban a ella la reconocen).
        (0, configuracion_1.guardarConfiguracion)({ ...config, claveRed: await (0, replica_1.claveDeCopia)() });
        config = (0, configuracion_1.leerConfiguracion)();
    }
    const d = diario;
    aplicador = new aplicar_1.Aplicador(d, {
        carpetaImagenes: (0, imagenes_1.carpetaImagenes)(),
        alAvisar: (texto) => void d.avisar(texto).catch((err) => logCrash('aviso', err)),
        alCambiarUsuario: (id) => {
            (0, tokenSessions_1.invalidarTokensDeUsuario)(id);
            void refrescarSesionDeEscritorio(id).catch((err) => logCrash('sesion-escritorio', err));
        },
        alFallar: logCrash,
    });
    motor = new motor_1.Motor({
        diario: d,
        aplicador,
        yo: () => ({ idPc: config.idPc, nombrePc: os_1.default.hostname(), version: electron_1.app.getVersion() }),
        puerto: httpServer_1.PUERTO,
        claveRed: () => config.claveRed ?? '',
        pares: () => config.pares,
        guardarPares,
        carpetaImagenes: (0, imagenes_1.carpetaImagenes)(),
        buscar: buscarPcsConHola,
        registrar: logCrash,
        soloAtiende: (0, nube_1.esModoNube)(),
    });
    if (!(await primeraSincronizacion()))
        return false;
    // De la base de siempre a la base con sincronización: se completa el
    // "stock inicial" de los artículos y se anota lo que ya había (como "lo de
    // siempre" la primera vez; después, como cambios de este momento).
    const primera = !(await d.yaSeBarrio());
    if (primera) {
        // Es la primera vez con esta versión: un respaldo de cómo estaba todo, por las dudas.
        await (0, backup_1.respaldoExtra)(`antes-de-la-sincronizacion-${marcaDeTiempo()}`).catch((err) => logCrash('respaldo', err));
    }
    await (0, aplicar_1.completarStockBase)(d);
    await d.barrer({ marcaNuevos: primera ? 'base' : 'ahora' });
    await d.marcarBarrido();
    await (0, aplicar_1.recalcularTodoElStock)(d);
    await guardarIdentidadEnBase();
    return true;
}
// Cada tanto: encuentra lo que se haya cambiado sin pasar por el diario y
// deja el stock cerrando con los movimientos.
function iniciarMantenimiento() {
    let vuelta = 0;
    const tarea = async () => {
        if (!diario)
            return;
        try {
            vuelta += 1;
            await (0, aplicar_1.completarStockBase)(diario);
            await diario.barrer({ marcaNuevos: 'ahora' });
            await (0, recordatorios_1.limpiarRecordatoriosHechos)().catch(() => { });
            // Recalcular todo el stock es más pesado: una vez por hora alcanza (cada
            // cambio que llega o se hace acá ya deja su stock bien).
            if (vuelta % 2 === 1)
                await (0, aplicar_1.recalcularTodoElStock)(diario);
            await guardarIdentidadEnBase();
        }
        catch (err) {
            logCrash('mantenimiento', err);
        }
    };
    setTimeout(() => void tarea(), 2 * 60000);
    temporizadorMantenimiento = setInterval(() => void tarea(), 30 * 60000);
}
function escaparHtml(texto) {
    return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
// Lo que se ve cuando esta PC todavía no pudo traer los datos de la red.
function mostrarEsperandoRed() {
    if (!mainWindow)
        return;
    const nombre = escaparHtml(config.nombreAnterior ?? 'la otra PC');
    const direccion = escaparHtml(config.pares[0]?.direccion ?? config.direccionAnterior ?? '');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mis Amores</title><style>
    body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#f5f8fd;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px;max-width:460px;text-align:center}
    h1{font-size:20px;margin:12px 0 8px}p{color:#64748b;line-height:1.5;margin:6px 0}
    button{margin-top:18px;background:linear-gradient(90deg,#2a5cb3,#3b76d1);color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
    #estado{margin-top:14px;font-size:13px;color:#94a3b8;min-height:18px}
    .icono{font-size:40px}</style></head><body><div class="card">
    <div class="icono">📡</div>
    <h1>Falta traer los datos del negocio</h1>
    <p>Esta PC ahora guarda sus propios datos, y la primera vez los trae de <b>${nombre}</b>${direccion ? ` (${direccion})` : ''}.
    Prendé esa PC, con Mis Amores abierto y en el mismo WiFi, y tocá el botón.</p>
    <button id="reintentar">Reintentar ahora</button>
    <div id="estado">Se vuelve a probar sola cada 20 segundos.</div>
    </div><script>
    const estado = document.getElementById('estado');
    let probando = false;
    async function reintentar() {
      if (probando) return;
      probando = true;
      estado.textContent = 'Buscando la otra PC...';
      try {
        await window.escritorio.reintentar();
        estado.textContent = 'Listo: los datos se trajeron. La app se reinicia sola.';
      } catch (e) {
        estado.textContent = (e && e.message) || 'Todavía no aparece la otra PC.';
      }
      probando = false;
    }
    document.getElementById('reintentar').onclick = reintentar;
    setInterval(reintentar, 20000);
    </script></body></html>`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}
function registrarIpcEscritorio() {
    electron_1.ipcMain.handle(channels_1.Channels.sistemaBuscarActualizaciones, () => buscarActualizacionesManual());
    electron_1.ipcMain.handle(channels_1.Channels.sistemaEstadoActualizacion, () => infoActualizacion());
    electron_1.ipcMain.handle(channels_1.Channels.sistemaDescargarActualizacion, () => descargarActualizacion());
    electron_1.ipcMain.handle(channels_1.Channels.sistemaInstalarActualizacion, () => instalarActualizacion());
    electron_1.ipcMain.handle(channels_1.Channels.escritorioRed, () => wrapEscritorio(estadoRed));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioBuscarPcs, () => wrapEscritorio(buscarPcsParaSumar));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioSumarPc, (_e, p) => wrapEscritorio(() => sumarPcALaRed(p)));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioSalirDeLaRed, () => wrapEscritorio(salirDeLaRed));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioRevisarRed, () => wrapEscritorio(async () => {
        (0, session_1.requiereAdmin)();
        if (!motor)
            throw new Error('La sincronización todavía no arrancó.');
        return motor.revisarCoincidencia(true);
    }));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioOlvidarPc, (_e, idPc) => wrapEscritorio(async () => {
        (0, session_1.requiereAdmin)();
        motor?.quitarPar(String(idPc));
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioConectarNube, (_e, direccion) => wrapEscritorio(() => conectarServidorNube(String(direccion ?? ''))));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioProbarServidor, (_e, direccion) => wrapEscritorio(() => probarServidorWeb(String(direccion ?? ''))));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioBorrarAvisos, () => wrapEscritorio(async () => {
        await diario?.borrarAvisos();
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.Channels.escritorioReintentar, () => wrapEscritorio(async () => {
        if (estadoArranque !== 'esperando')
            return true;
        if (!(await primeraSincronizacion())) {
            throw new Error('Todavía no aparece la otra PC. Se vuelve a probar sola en unos segundos.');
        }
        // Con los datos ya traídos, se arranca de nuevo como siempre.
        setTimeout(reiniciarApp, 1500);
        return true;
    }));
}
// MongoDB arranca como servicio de Windows junto con la PC, pero puede
// tardar unos segundos más que esta app en estar lista — sobre todo recién
// después de prender la PC. En vez de mostrar un error de una, reintentamos
// unas cuantas veces antes de darnos por vencidos.
async function initDatabaseConReintentos(intentos = 8, esperaMs = 3000) {
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            await (0, database_1.initDatabase)();
            return;
        }
        catch (err) {
            if (intento === intentos)
                throw err;
            await new Promise((resolve) => setTimeout(resolve, esperaMs));
        }
    }
}
// Alguien intentó abrir una segunda copia (doble click estando la app ya
// corriendo, aunque esté escondida en la bandeja) — no dejamos que arranque
// otra instancia; sólo mostramos la que ya está viva.
electron_1.app.on('second-instance', mostrarVentana);
// Lo que hace cada PC al arrancar: conecta con su base, se pone al día con las
// otras PCs, atiende a los celulares y a las otras PCs, y hace los respaldos.
async function arrancar() {
    try {
        await initDatabaseConReintentos();
    }
    catch (err) {
        electron_1.dialog.showErrorBox('No se pudo conectar a la base de datos', (err instanceof Error ? err.message : 'Error desconocido al conectar con MongoDB.') +
            '\n\nOjo: todas las PCs del negocio guardan sus propios datos, así que cada una necesita ' +
            'MongoDB instalado y andando (servicio "MongoDB" de Windows).');
        electron_1.app.quit();
        return false;
    }
    let datosListos = true;
    try {
        datosListos = await prepararSincronizacion();
    }
    catch (err) {
        // La sincronización nunca tiene que impedir usar la app: si algo falla
        // al armarla, se sigue como una PC sola y queda anotado.
        logCrash('sync-arranque', err);
        (0, database_1.instalarDiario)(null);
        motor = null;
        diario = null;
        aplicador = null;
    }
    if (!datosListos) {
        estadoArranque = 'esperando';
        return true;
    }
    (0, handlers_1.registrarHandlers)({ claveRed: () => config.claveRed ?? '' });
    // Cuando alguien cambia datos (desde esta PC, otra PC o un celular), la
    // pantalla se vuelve a cargar sola; los celulares lo reciben por /api/eventos.
    (0, cambiosEnVivo_1.escucharCambios)(() => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send(channels_1.Channels.sistemaDatosCambio);
    });
    // Las sesiones de los celulares que ya estaban abiertas siguen valiendo
    // después de reiniciar (ver server/tokenSessions.ts).
    await (0, tokenSessions_1.cargarSesionesGuardadas)().catch((err) => logCrash('sesiones', err));
    // Respaldo automático de la base local (ver electron/backup.ts) — una vez
    // al arrancar, y de nuevo cada 6hs por si la app queda prendida días
    // seguidos en la bandeja sin reiniciarse. Si falla, sólo queda anotado en
    // el log de errores — nunca debe frenar el arranque de la app.
    if (!(0, nube_1.esModoNube)()) {
        (0, backup_1.respaldarSiCorresponde)().catch((err) => logCrash('respaldo', err));
        setInterval(() => (0, backup_1.respaldarSiCorresponde)().catch((err) => logCrash('respaldo', err)), 6 * 60 * 60 * 1000);
    }
    try {
        const sync = diario && motor
            ? {
                diario,
                motor,
                aplicador: aplicador,
                claveRed: () => config.claveRed ?? '',
                yo: () => ({ idPc: config.idPc, nombrePc: os_1.default.hostname(), version: electron_1.app.getVersion() }),
                // El servidor de internet no sabe (ni le sirve saber) dónde están las
                // PCs del negocio: son ellas las que lo llaman.
                pares: () => ((0, nube_1.esModoNube)() ? [] : config.pares),
                alUnirse: (par) => {
                    if (!(0, nube_1.esModoNube)())
                        motor?.agregarPar(par);
                },
                alVerPar: (idPc) => motor?.alVerPar(idPc),
            }
            : null;
        // Sin sincronización (falló al armarse) igual se atiende a los celulares.
        const { detener, ...infoParaRenderer } = await (0, httpServer_1.iniciarServidorWeb)(path_1.default.join(__dirname, '../../dist'), infoPc, sync);
        // infoServidorWeb se manda tal cual al renderer por IPC (ver
        // sistemaInfoRed más abajo) — "detener" no viaja ahí porque una función
        // no se puede mandar por IPC, y tampoco tiene sentido que el renderer la
        // llame; queda guardada acá aparte, sólo para usarla al cerrar la app.
        infoServidorWeb = infoParaRenderer;
        detenerServidorWeb = detener;
        // El aviso "misamores.local" es para el WiFi del local: en un servidor de
        // internet no sirve de nada.
        const primeraIp = (0, httpServer_1.obtenerIpsLan)()[0];
        if (primeraIp && !modoServidor)
            detenerMdns = (0, mdns_1.iniciarMdns)(primeraIp);
        // Por defecto el servidor se duerme a los 15 minutos sin visitas (Render
        // gratis) y despierta cuando entra alguien. Sólo si se pide a propósito
        // (MIS_AMORES_MANTENER_DESPIERTO=1) se visita solo para no dormirse.
        if ((0, nube_1.esModoNube)() && (0, despertador_1.mantenerDespiertoActivado)())
            detenerDespertador = (0, despertador_1.iniciarDespertador)({ registrar: (m) => logCrash('despertador', m) });
    }
    catch (err) {
        // Si el puerto está ocupado o falla por lo que sea, la app de escritorio
        // sigue funcionando igual — sólo no va a estar disponible desde el
        // celular (ni para las otras PCs) hasta que se reinicie.
        console.error('No se pudo iniciar el acceso desde el celular:', err);
        infoServidorWeb = { error: err instanceof Error ? err.message : 'No se pudo iniciar el acceso desde el celular' };
    }
    electron_1.ipcMain.handle(channels_1.Channels.sistemaInfoRed, () => infoServidorWeb);
    // Con el servidor ya atendiendo, se empieza a hablar con las otras PCs.
    motor?.iniciar();
    iniciarMantenimiento();
    estadoArranque = 'listo';
    return true;
}
electron_1.app.whenReady().then(async () => {
    if (!esInstanciaUnica)
        return;
    // Que la app se abra sola cuando arranca Windows (sin tener que buscar el
    // ícono cada vez). Sólo tiene sentido para la versión instalada — en
    // desarrollo apuntaría a un electron.exe temporal que no sirve de nada.
    if (electron_1.app.isPackaged) {
        electron_1.app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
    }
    registrarIpcEscritorio();
    if (!(await arrancar()))
        return;
    if (modoServidor) {
        // Sin ventana que muestre el cartel "falta traer los datos": si la primera
        // vez no apareció la PC de donde traerlos, se termina y el servicio
        // (systemd) lo vuelve a intentar en unos segundos.
        if (estadoArranque !== 'listo') {
            logCrash('servidor', 'Todavía no se pudieron traer los datos de la red: se vuelve a intentar en un rato.');
            electron_1.app.exit(3);
        }
        return;
    }
    crearBandeja();
    createWindow();
    configurarActualizaciones();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
        else
            mainWindow?.show();
    });
});
// Con el ícono en la bandeja, cerrar la ventana ya no cierra la app — así que
// no hace falta que "todas las ventanas cerradas" dispare app.quit(). Salir
// de verdad sólo pasa desde el menú de la bandeja.
electron_1.app.on('window-all-closed', () => {
    // No hacemos nada a propósito: seguimos vivos en la bandeja.
});
electron_1.app.on('before-quit', () => {
    saliendoDeVerdad = true;
    if (temporizadorMantenimiento)
        clearInterval(temporizadorMantenimiento);
    motor?.detener();
    detenerMdns?.();
    detenerDespertador?.();
    // Sin await a propósito: before-quit no espera promesas, y closeAllConnections
    // adentro de detenerServidorWeb ya corta las conexiones abiertas de una,
    // así el puerto no queda ocupado ni el cierre del proceso esperando a que
    // algún celular conectado se desconecte solo.
    detenerServidorWeb?.().catch(() => { });
    (0, database_1.closeDatabase)();
});
