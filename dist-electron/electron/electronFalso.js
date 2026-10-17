"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeImage = exports.Menu = exports.Tray = exports.shell = exports.dialog = exports.BrowserWindow = exports.ipcMain = exports.app = void 0;
// Un "electron" de mentira para correr la app como SERVIDOR, sin ventana: en un
// servidor de internet (Linux, sin pantalla) no hay Electron. La base, la
// sincronización y el acceso desde los celulares no lo necesitan; sólo lo
// piden la ventana, la bandeja y los avisos, que acá no hacen nada.
//
// Lo carga servidor.ts en lugar del módulo "electron" de verdad. En la app de
// escritorio no se usa para nada.
const events_1 = require("events");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const carpetaDatos = path_1.default.resolve(process.env.MIS_AMORES_CARPETA_DATOS || path_1.default.join(os_1.default.homedir(), '.mis-amores-servidor'));
const rutas = {
    userData: carpetaDatos,
    appData: path_1.default.dirname(carpetaDatos),
    documents: path_1.default.join(carpetaDatos, 'respaldos'),
    temp: os_1.default.tmpdir(),
    home: os_1.default.homedir(),
};
function versionDeLaApp() {
    try {
        const paquete = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, '../../package.json'), 'utf-8'));
        return paquete.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
class AppFalsa extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        // Como la app instalada: los datos van a la carpeta "userData".
        this.isPackaged = true;
    }
    getPath(nombre) {
        return rutas[nombre] ?? path_1.default.join(carpetaDatos, nombre);
    }
    setPath(nombre, valor) {
        rutas[nombre] = valor;
    }
    getVersion() {
        return versionDeLaApp();
    }
    getName() {
        return 'mis-amores-gestion';
    }
    whenReady() {
        return Promise.resolve();
    }
    requestSingleInstanceLock() {
        return true;
    }
    setLoginItemSettings() {
        // No aplica en un servidor.
    }
    // Un servicio (systemd) vuelve a levantar el proceso cuando termina.
    relaunch() { }
    quit() {
        this.emit('before-quit');
        // Un respiro para que se cierren la base y las conexiones.
        setTimeout(() => process.exit(0), 1500);
    }
    exit(codigo = 0) {
        process.exit(codigo);
    }
}
exports.app = new AppFalsa();
exports.ipcMain = {
    handle() { },
    on() { },
    once() { },
    removeHandler() { },
};
class BrowserWindow {
    static getAllWindows() {
        return [];
    }
    static getFocusedWindow() {
        return null;
    }
}
exports.BrowserWindow = BrowserWindow;
exports.dialog = {
    showErrorBox(titulo, contenido) {
        console.error(`${titulo}\n${contenido}`);
    },
    showMessageBox() {
        return Promise.resolve({ response: 0, checkboxChecked: false });
    },
    showOpenDialog() {
        return Promise.resolve({ canceled: true, filePaths: [] });
    },
};
// En un servidor no hay navegador donde abrir nada (y nadie lo pide: no hay pantalla).
exports.shell = {
    openExternal() {
        return Promise.resolve();
    },
};
class Tray {
}
exports.Tray = Tray;
exports.Menu = {
    buildFromTemplate() {
        return null;
    },
};
exports.nativeImage = {
    createFromPath() {
        return null;
    },
};
