"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const database_1 = require("./db/database");
const handlers_1 = require("./ipc/handlers");
const httpServer_1 = require("./server/httpServer");
const mdns_1 = require("./server/mdns");
const channels_1 = require("../shared/channels");
// Diagnóstico temporal: si algo revienta antes de que haya ventana (y por lo
// tanto antes de tener DevTools para ver el error), lo dejamos anotado en un
// archivo de texto en la carpeta temporal de Windows.
const logCrash = (etiqueta, err) => {
    try {
        const linea = `[${new Date().toISOString()}] ${etiqueta}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
        fs_1.default.appendFileSync(path_1.default.join(os_1.default.tmpdir(), 'mis-amores-crash.log'), linea);
    }
    catch {
        /* si ni esto funciona, no hay mucho más que hacer */
    }
};
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));
logCrash('arranque', `proceso iniciado, isPackaged=${electron_1.app.isPackaged}, __dirname=${__dirname}`);
let infoServidorWeb = null;
let detenerMdns = null;
const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
let tray = null;
// Se pone en true sólo cuando de verdad hay que cerrar todo (desde el menú
// de la bandeja). El resto del tiempo, cerrar la ventana la esconde nomás —
// así un click de más en la "X" no apaga el servidor que usa el celular.
let saliendoDeVerdad = false;
let avisoBandejaMostrado = false;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 640,
        backgroundColor: '#f2f7fd',
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
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
    // Cerrar la ventana no cierra la app: la esconde. El servidor para el
    // celular y la conexión a la base siguen andando en segundo plano.
    mainWindow.on('close', (e) => {
        if (!saliendoDeVerdad) {
            e.preventDefault();
            mainWindow?.hide();
            if (!avisoBandejaMostrado) {
                avisoBandejaMostrado = true;
                tray?.displayBalloon({
                    title: 'Mis Amores sigue funcionando',
                    content: 'Se minimizó a la bandeja para que el celular pueda seguir usándola. Para cerrarla del todo, click derecho en el ícono de la bandeja y "Salir de verdad".',
                });
            }
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function crearBandeja() {
    const icono = electron_1.nativeImage.createFromPath(path_1.default.join(__dirname, '../../build-assets/icon.ico'));
    tray = new electron_1.Tray(icono);
    tray.setToolTip('Mis Amores - Gestión');
    const menu = electron_1.Menu.buildFromTemplate([
        {
            label: 'Abrir Mis Amores',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
                else {
                    createWindow();
                }
            },
        },
        { type: 'separator' },
        {
            label: 'Salir de verdad (apaga el acceso desde el celular)',
            click: () => {
                saliendoDeVerdad = true;
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
        else {
            createWindow();
        }
    });
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
electron_1.app.whenReady().then(async () => {
    // Que la app se abra sola cuando arranca Windows (sin tener que buscar el
    // ícono cada vez). Sólo tiene sentido para la versión instalada — en
    // desarrollo apuntaría a un electron.exe temporal que no sirve de nada.
    if (electron_1.app.isPackaged) {
        electron_1.app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
    }
    try {
        await initDatabaseConReintentos();
    }
    catch (err) {
        electron_1.dialog.showErrorBox('No se pudo conectar a la base de datos', err instanceof Error ? err.message : 'Error desconocido al conectar con MongoDB.');
        electron_1.app.quit();
        return;
    }
    (0, handlers_1.registrarHandlers)();
    try {
        infoServidorWeb = await (0, httpServer_1.iniciarServidorWeb)(path_1.default.join(__dirname, '../../dist'));
        const primeraIp = (0, httpServer_1.obtenerIpsLan)()[0];
        if (primeraIp)
            detenerMdns = (0, mdns_1.iniciarMdns)(primeraIp);
    }
    catch (err) {
        // Si el puerto está ocupado o falla por lo que sea, la app de escritorio
        // sigue funcionando igual — sólo no va a estar disponible desde el
        // celular hasta que se reinicie.
        console.error('No se pudo iniciar el acceso desde el celular:', err);
        infoServidorWeb = { error: err instanceof Error ? err.message : 'No se pudo iniciar el acceso desde el celular' };
    }
    electron_1.ipcMain.handle(channels_1.Channels.sistemaInfoRed, () => infoServidorWeb);
    crearBandeja();
    createWindow();
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
    detenerMdns?.();
    (0, database_1.closeDatabase)();
});
