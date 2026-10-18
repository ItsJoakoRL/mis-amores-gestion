// Un "electron" de mentira para correr la app como SERVIDOR, sin ventana: en un
// servidor de internet (Linux, sin pantalla) no hay Electron. La base, la
// sincronización y el acceso desde los celulares no lo necesitan; sólo lo
// piden la ventana, la bandeja y los avisos, que acá no hacen nada.
//
// Lo carga servidor.ts en lugar del módulo "electron" de verdad. En la app de
// escritorio no se usa para nada.
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

const carpetaDatos = path.resolve(process.env.MIS_AMORES_CARPETA_DATOS || path.join(os.homedir(), '.mis-amores-servidor'));

const rutas: Record<string, string> = {
  userData: carpetaDatos,
  appData: path.dirname(carpetaDatos),
  documents: path.join(carpetaDatos, 'respaldos'),
  temp: os.tmpdir(),
  home: os.homedir(),
};

function versionDeLaApp(): string {
  try {
    const paquete = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version?: string };
    return paquete.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

class AppFalsa extends EventEmitter {
  // Como la app instalada: los datos van a la carpeta "userData".
  readonly isPackaged = true;

  getPath(nombre: string): string {
    return rutas[nombre] ?? path.join(carpetaDatos, nombre);
  }

  setPath(nombre: string, valor: string): void {
    rutas[nombre] = valor;
  }

  getVersion(): string {
    return versionDeLaApp();
  }

  getName(): string {
    return 'mis-amores-gestion';
  }

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  requestSingleInstanceLock(): boolean {
    return true;
  }

  setLoginItemSettings(): void {
    // No aplica en un servidor.
  }

  // Un servicio (systemd) vuelve a levantar el proceso cuando termina.
  relaunch(): void {}

  quit(): void {
    this.emit('before-quit');
    // Un respiro para que se cierren la base y las conexiones.
    setTimeout(() => process.exit(0), 1500);
  }

  exit(codigo = 0): void {
    process.exit(codigo);
  }
}

export const app = new AppFalsa();

export const ipcMain = {
  handle(): void {},
  on(): void {},
  once(): void {},
  removeHandler(): void {},
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }

  static getFocusedWindow(): BrowserWindow | null {
    return null;
  }
}

export const dialog = {
  showErrorBox(titulo: string, contenido: string): void {
    console.error(`${titulo}\n${contenido}`);
  },
  showMessageBox(): Promise<{ response: number; checkboxChecked: boolean }> {
    return Promise.resolve({ response: 0, checkboxChecked: false });
  },
  showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return Promise.resolve({ canceled: true, filePaths: [] });
  },
};

export class Tray {}

export const Menu = {
  buildFromTemplate(): null {
    return null;
  },
};

export const nativeImage = {
  createFromPath(): null {
    return null;
  },
};
