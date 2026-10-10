import { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { autoUpdater } from 'electron-updater';
import express from 'express';
import http from 'http';
import multicastDns from 'multicast-dns';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { initDatabase, closeDatabase } from './db/database';
import { respaldarSiCorresponde } from './backup';
import { registrarHandlers } from './ipc/handlers';
import { iniciarServidorWeb, obtenerIpsLan, PUERTO } from './server/httpServer';
import { iniciarMdns, NOMBRE_HOST } from './server/mdns';
import { cargarSesionesGuardadas } from './server/tokenSessions';
import { requiereAdmin } from './session';
import { guardarConfiguracion, leerConfiguracion } from './configuracion';
import { exportarDatosParaJuntar } from './juntarDatos';
import { escucharCambios } from './cambiosEnVivo';
import {
  cargarCopiaEnEstaPc,
  bajarCopia,
  claveDeCopia,
  esAdminDeLaCopia,
  estadoDeLaCopia,
  iniciarCopiaAutomatica,
  leerMetaCopia,
  listarCopias,
  pausarCopiaAutomatica,
  reanudarCopiaAutomatica,
} from './replica';
import { Channels } from '../shared/channels';
import type {
  ApiResult,
  ConexionPrincipalInput,
  CredencialesAdmin,
  EstadoActualizacion,
  EstadoCopia,
  HacerPrincipalInput,
  ResultadoHacerPrincipal,
  InfoActualizacion,
  InfoModoPc,
  InfoPc,
  InfoRed,
  PcEncontrada,
  ResumenJuntar,
} from '../shared/types';

// Diagnóstico temporal: si algo revienta antes de que haya ventana (y por lo
// tanto antes de tener DevTools para ver el error), lo dejamos anotado en un
// archivo de texto en la carpeta temporal de Windows.
const logCrash = (etiqueta: string, err: unknown) => {
  try {
    const linea = `[${new Date().toISOString()}] ${etiqueta}: ${err instanceof Error ? err.stack || err.message : String(err)}\n`;
    fs.appendFileSync(path.join(os.tmpdir(), 'mis-amores-crash.log'), linea);
  } catch {
    /* si ni esto funciona, no hay mucho más que hacer */
  }
};
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));
logCrash('arranque', `proceso iniciado, isPackaged=${app.isPackaged}, __dirname=${__dirname}`);

// La versión "en vivo" (npm run dev) usa su propia carpeta de datos: si
// compartiera la de la app instalada, también compartiría el candado de
// instancia única de abajo, y con la instalada abierta en la bandeja el modo
// desarrollo se cerraba solo, sin decir nada. (Con MIS_AMORES_CARPETA_DATOS
// se puede elegir otra, para probar dos "PCs" en la misma máquina.)
if (!app.isPackaged) {
  const carpeta = process.env.MIS_AMORES_CARPETA_DATOS;
  app.setPath('userData', carpeta ? path.resolve(carpeta) : path.join(app.getPath('appData'), 'mis-amores-gestion-dev'));
}

// Si esta PC es la principal (tiene la base de datos) o está conectada a la
// principal de otra PC (ver configuracion.ts). Cambiar de modo reinicia la app.
let config = leerConfiguracion();
const modoConectada = config.modo === 'conectada';

// Como la app se minimiza a la bandeja en vez de cerrarse de verdad, si
// alguien la abre de nuevo (doble click en el ícono) sin darse cuenta de que
// ya estaba corriendo, terminaría una segunda copia peleando por el mismo
// puerto 4000 del acceso desde el celular — y esa segunda ventana se rompe
// con "EADDRINUSE". Con el lock de instancia única, esa segunda apertura no
// crea nada nuevo: sólo le avisa a la que ya está corriendo que la muestre.
const esInstanciaUnica = app.requestSingleInstanceLock();
if (!esInstanciaUnica) {
  app.quit();
}

let infoServidorWeb: InfoRed = null;
let detenerMdns: (() => void) | null = null;
let detenerServidorWeb: (() => Promise<void>) | null = null;

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Se pone en true sólo cuando de verdad hay que cerrar todo (desde el menú
// de la bandeja). El resto del tiempo, cerrar la ventana la esconde nomás —
// así un click de más en la "X" no apaga el servidor que usa el celular.
let saliendoDeVerdad = false;
let avisoBandejaMostrado = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f2f7fd',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../build-assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // El preload compilado hace require() de archivos locales (shared/channels,
      // shared/types); con sandbox:true Electron restringe el preload a un
      // require() polyfillado que sólo resuelve módulos nativos de Node, así que
      // esos require() fallarían en silencio y window.api nunca se expondría.
      sandbox: false,
      // El preload lo lee para saber qué exponer: conectada, la pantalla
      // habla con la principal por la red (como un celular), no por IPC.
      additionalArguments: [`--mis-amores-modo=${config.modo}`],
    },
  });

  if (modoConectada) {
    cargarPrincipal();
    const ventana = mainWindow;
    // La pantalla viene de la otra PC: que no pueda abrir ventanas nuevas ni
    // irse a cualquier otra dirección.
    ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ventana.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(`http://${config.direccionPrincipal}/`) && !url.startsWith('data:')) e.preventDefault();
    });
    ventana.webContents.on('did-fail-load', (_e, codigo, _descripcion, _url, esPaginaPrincipal) => {
      // -3 es "cancelado" (ej. se recargó a mitad de camino): no es un error.
      if (esPaginaPrincipal && codigo !== -3) mostrarSinConexion();
    });
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
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
          content: modoConectada
            ? 'Se minimizó a la bandeja. Para cerrarla del todo, click derecho en el ícono de la bandeja y "Salir de verdad".'
            : 'Se minimizó a la bandeja para que el celular pueda seguir usándola. Para cerrarla del todo, click derecho en el ícono de la bandeja y "Salir de verdad".',
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
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function crearBandeja() {
  const icono = nativeImage.createFromPath(path.join(__dirname, '../../build-assets/icon.ico'));
  tray = new Tray(icono);
  tray.on('click', mostrarVentana);
  // Tocar el globito de aviso (ej. "hay una actualización nueva") abre la app.
  tray.on('balloon-click', mostrarVentana);
  actualizarMenuBandeja();
}

// El menú de la bandeja cambia según la actualización: si hay una versión
// nueva ofrece bajarla, y si ya está bajada, instalarla — así también se
// puede actualizar sin tener que abrir la ventana.
function actualizarMenuBandeja() {
  if (!tray) return;
  const estado = estadoActualizacion;

  let itemActualizacion: Electron.MenuItemConstructorOptions;
  if (estado.tipo === 'disponible') {
    itemActualizacion = { label: `Descargar actualización (versión ${estado.version})`, click: descargarActualizacion };
  } else if (estado.tipo === 'descargando') {
    itemActualizacion = { label: 'Descargando actualización...', enabled: false };
  } else if (estado.tipo === 'lista') {
    itemActualizacion = {
      label: `Reiniciar e instalar actualización (versión ${estado.version})`,
      click: instalarActualizacion,
    };
  } else {
    itemActualizacion = {
      label: estado.tipo === 'buscando' ? 'Buscando actualizaciones...' : 'Buscar actualizaciones',
      enabled: estado.tipo !== 'buscando',
      click: buscarActualizacionesManual,
    };
  }

  const hayActualizacion = estado.tipo === 'disponible' || estado.tipo === 'lista';
  const nombre = modoConectada ? `Mis Amores - Gestión (conectada a ${config.nombrePrincipal ?? 'la PC principal'})` : 'Mis Amores - Gestión';
  tray.setToolTip(hayActualizacion ? `${nombre} — hay una actualización` : nombre);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Mis Amores', click: mostrarVentana },
      itemActualizacion,
      { type: 'separator' },
      {
        label: modoConectada ? 'Salir de verdad' : 'Salir de verdad (apaga el acceso desde el celular)',
        click: () => {
          saliendoDeVerdad = true;
          app.quit();
        },
      },
    ])
  );
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
const probandoActualizaciones = !app.isPackaged && process.env.MIS_AMORES_PROBAR_ACTUALIZACIONES === '1';
const actualizacionesActivas = app.isPackaged || probandoActualizaciones;

let estadoActualizacion: EstadoActualizacion = { tipo: 'al-dia' };
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
let ultimaVersionAvisada: string | null = null;

function infoActualizacion(): InfoActualizacion {
  return { versionActual: app.getVersion(), estado: estadoActualizacion };
}

function versionDe(estado: EstadoActualizacion): string | null {
  return 'version' in estado ? estado.version : null;
}

function setEstadoActualizacion(nuevo: EstadoActualizacion) {
  const anterior = estadoActualizacion;
  estadoActualizacion = nuevo;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(Channels.sistemaCambioActualizacion, infoActualizacion());
  }
  // El menú de la bandeja no muestra el porcentaje — sólo hace falta
  // rearmarlo cuando cambia de etapa, no en cada avance de la descarga.
  if (anterior.tipo !== nuevo.tipo || versionDe(anterior) !== versionDe(nuevo)) actualizarMenuBandeja();
}

// Antes de mostrar cualquier cartel de actualización, mostramos y
// enfocamos la ventana principal — si no, dialog.showMessageBox() sin una
// ventana "dueña" puede abrirse sin foco (a veces hasta detrás de la
// ventana principal en Windows), y parece que "no pasó nada" al tocar el
// botón aunque el cartel sí se haya abierto.
function traerVentanaAlFrente() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

// dialog.showMessageBox no acepta "undefined" como primer argumento (sólo
// una BrowserWindow real u omitirlo del todo) — esta función elige la
// variante correcta según si la ventana existe en ese momento. Se usa en vez
// de dialog.showErrorBox porque ése frena todo el proceso principal (también
// el servidor de los celulares) hasta que alguien lo cierre.
function mostrarMensaje(options: Electron.MessageBoxOptions) {
  return mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

// Si la ventana está a la vista ya alcanza con el cartel de adentro de la
// app; si está escondida en la bandeja, avisamos con el globito de Windows.
function avisarEnBandejaSiOculta(titulo: string, contenido: string) {
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) return;
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
  autoUpdater.checkForUpdates().catch(() => {});
}

function descargarActualizacion() {
  if (estadoActualizacion.tipo !== 'disponible') return;
  setEstadoActualizacion({ tipo: 'descargando', version: estadoActualizacion.version, porcentaje: 0 });
  // Mismo criterio que checkForUpdates: si falla, avisa el evento 'error'
  // (que vuelve a "disponible" con el motivo, para poder reintentar). Antes
  // un error acá no avisaba nada y parecía que la descarga nunca terminaba.
  autoUpdater.downloadUpdate().catch(() => {});
}

function instalarActualizacion() {
  if (estadoActualizacion.tipo !== 'lista') return;
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
  autoUpdater.quitAndInstall(false, true);
}

// El chequeo de fondo. Si ya hay una versión bajándose o lista para
// instalar, no vuelve a preguntar — antes, cada 2 horas, volvía a ofrecer
// bajar una actualización que ya estaba bajada.
function chequeoAutomatico() {
  if (estadoActualizacion.tipo === 'descargando' || estadoActualizacion.tipo === 'lista') return;
  autoUpdater.checkForUpdates().catch(() => {});
}

function configurarActualizaciones() {
  if (!actualizacionesActivas) return;
  if (probandoActualizaciones) autoUpdater.forceDevUpdateConfig = true;

  // No baja nada solo — recién arranca la descarga cuando alguien la pide.
  autoUpdater.autoDownload = false;
  // (En el modo de prueba tampoco instala al cerrar, por lo mismo que en
  // instalarActualizacion.)
  autoUpdater.autoInstallOnAppQuit = !probandoActualizaciones;

  autoUpdater.on('update-available', (info) => {
    const eraManual = buscandoManualmente;
    buscandoManualmente = false;
    reintentosBusqueda = 0;
    const actual = estadoActualizacion;
    if ((actual.tipo === 'descargando' || actual.tipo === 'lista') && actual.version === info.version) return;
    setEstadoActualizacion({ tipo: 'disponible', version: info.version });

    if (eraManual) {
      traerVentanaAlFrente();
      mostrarMensaje({
        type: 'info',
        title: 'Actualización disponible',
        message: `Hay una actualización nueva (versión ${info.version}). ¿Querés instalarla?`,
        detail:
          'Se descarga en segundo plano y se puede seguir usando la app mientras tanto. Cuando esté lista, el cartel de arriba avisa para reiniciar.',
        buttons: ['Sí, descargar', 'Ahora no'],
        defaultId: 0,
        cancelId: 1,
      }).then(({ response }) => {
        if (response === 0) descargarActualizacion();
      });
    } else if (ultimaVersionAvisada !== info.version) {
      avisarEnBandejaSiOculta(
        'Hay una actualización de Mis Amores',
        `La versión ${info.version} está disponible. Abrí la app para descargarla.`
      );
    }
    ultimaVersionAvisada = info.version;
  });

  autoUpdater.on('download-progress', (progreso) => {
    const actual = estadoActualizacion;
    if (actual.tipo !== 'descargando') return;
    // El evento llega varias veces por segundo — sólo avisamos a la pantalla
    // cuando cambia el número entero del porcentaje.
    const porcentaje = Math.floor(progreso.percent);
    if (porcentaje === actual.porcentaje) return;
    setEstadoActualizacion({ tipo: 'descargando', version: actual.version, porcentaje });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setEstadoActualizacion({ tipo: 'lista', version: info.version });
    avisarEnBandejaSiOculta(
      'Actualización lista para instalar',
      `La versión ${info.version} ya se descargó. Abrí Mis Amores y tocá "Reiniciar y actualizar".`
    );
  });

  autoUpdater.on('error', (err) => {
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
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), ESPERA_REINTENTO_MS);
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
    if (estadoActualizacion.tipo === 'buscando') setEstadoActualizacion({ tipo: 'al-dia' });
  });

  autoUpdater.on('update-not-available', () => {
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
        detail: `Versión ${app.getVersion()}`,
      });
    }
  });

  // Primer chequeo al ratito de abrir (no de una, para no competir con el
  // arranque de la base y la ventana) y después cada 2 horas mientras quede
  // prendida.
  setTimeout(chequeoAutomatico, 15_000);
  setInterval(chequeoAutomatico, 2 * 60 * 60 * 1000);
}

// --- PC principal / PC conectada ---
// En el negocio hay más de una PC, y antes cada una tenía su propia base: lo
// que se cargaba en una no aparecía en la otra. Ahora una es la "principal"
// (tiene la base) y la otra se "conecta" a ella: abre la app de la principal
// por la red, igual que un celular, y así todo queda en un solo lugar.

// Mismo formato { ok, data } / { ok:false, error } que el resto de la app,
// así el preload desenvuelve el error con su mensaje tal cual.
async function wrapEscritorio<T>(fn: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

function infoPc(): InfoPc {
  return {
    app: 'mis-amores-gestion',
    idPc: config.idPc,
    nombrePc: os.hostname(),
    version: app.getVersion(),
    modo: config.modo,
    generacion: config.generacion,
  };
}

function infoModo(): InfoModoPc {
  return {
    modo: config.modo,
    direccionPrincipal: config.direccionPrincipal,
    nombrePrincipal: config.nombrePrincipal,
    idPc: config.idPc,
    nombrePc: os.hostname(),
    versionApp: app.getVersion(),
    copias: modoConectada ? [] : listarCopias(),
  };
}

// "192.168.1.50" -> "192.168.1.50:4000" (si no se escribió el puerto, va el de siempre).
function normalizarDireccion(texto: string): string {
  const limpio = String(texto ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!limpio) throw new Error('Escribí la dirección de la PC principal (por ejemplo 192.168.1.50).');
  return /:\d+$/.test(limpio) ? limpio : `${limpio}:4000`;
}

const MENSAJE_VERSION_VIEJA =
  'Esa PC respondió, pero con una versión de Mis Amores que todavía no sabe recibir otra PC. Actualizala primero.';

async function pedirJson<T>(
  url: string,
  opciones: { metodo?: string; token?: string; cuerpo?: unknown; esperaMs?: number } = {}
): Promise<T> {
  let respuesta: Response;
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
  } catch {
    throw new Error('No se pudo conectar con esa PC. Fijate que esté prendida, con Mis Amores abierto y en el mismo WiFi.');
  }
  let json: ApiResult<T>;
  try {
    json = (await respuesta.json()) as ApiResult<T>;
  } catch {
    throw new Error(MENSAJE_VERSION_VIEJA);
  }
  if (!json.ok) throw new Error(json.error ?? 'La otra PC devolvió un error');
  return json.data as T;
}

async function obtenerInfoPc(direccion: string): Promise<InfoPc> {
  const info = await pedirJson<InfoPc>(`http://${direccion}/api/sistema/info`, { esperaMs: 3000 });
  if (!info || info.app !== 'mis-amores-gestion' || !info.idPc) throw new Error(MENSAJE_VERSION_VIEJA);
  return info;
}

// Pregunta en la red quién es "misamores.local": lo contesta la app de cada
// PC principal con su IP (ver server/mdns.ts).
function consultarMdns(esperaMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();
    let consulta: ReturnType<typeof multicastDns>;
    try {
      consulta = multicastDns();
    } catch {
      resolve([]);
      return;
    }
    consulta.on('error', () => {});
    consulta.on('response', (respuesta) => {
      for (const r of [...respuesta.answers, ...(respuesta.additionals ?? [])]) {
        if (r.type === 'A' && r.name.toLowerCase() === NOMBRE_HOST && typeof r.data === 'string') ips.add(r.data);
      }
    });
    const preguntar = () => {
      try {
        consulta.query({ questions: [{ name: NOMBRE_HOST, type: 'A' }] });
      } catch {
        // Sin red en este momento: no se encuentra nada, y listo.
      }
    };
    preguntar();
    const intervalo = setInterval(preguntar, 700);
    setTimeout(() => {
      clearInterval(intervalo);
      try {
        consulta.destroy();
      } catch {
        // ya estaba cerrada
      }
      resolve([...ips]);
    }, esperaMs);
  });
}

// Las PCs principales que hay en la red (sin contar a esta), con su info.
async function buscarConInfo(): Promise<Array<{ direccion: string; info: InfoPc | null }>> {
  const ips = await consultarMdns(2500);
  const direcciones = new Set(ips.map((ip) => `${ip}:4000`));
  // En desarrollo, la principal de prueba escucha en otro puerto.
  if (!app.isPackaged) for (const ip of [...ips, '127.0.0.1']) for (const puerto of [4001, 4002]) direcciones.add(`${ip}:${puerto}`);
  if (config.direccionPrincipal) direcciones.add(config.direccionPrincipal);

  const encontradas = await Promise.all(
    [...direcciones].map(async (direccion) => {
      try {
        return { direccion, info: await obtenerInfoPc(direccion) as InfoPc | null };
      } catch (err) {
        // Contesta pero no sabe decir quién es: tiene una versión vieja.
        return err instanceof Error && err.message === MENSAJE_VERSION_VIEJA ? { direccion, info: null } : null;
      }
    })
  );
  const porPc = new Map<string, { direccion: string; info: InfoPc | null }>();
  for (const e of encontradas) {
    if (!e) continue;
    if (e.info && (e.info.idPc === config.idPc || e.info.modo !== 'principal')) continue;
    const clave = e.info?.idPc ?? e.direccion;
    // La misma PC puede aparecer por dos caminos: mejor la IP de la red que 127.0.0.1.
    if (!porPc.has(clave) || porPc.get(clave)!.direccion.startsWith('127.')) porPc.set(clave, e);
  }
  return [...porPc.values()];
}

async function buscarPcsPrincipales(): Promise<PcEncontrada[]> {
  return (await buscarConInfo()).map(({ direccion, info }) => ({
    direccion,
    nombrePc: info?.nombrePc ?? null,
    version: info?.version ?? null,
    versionVieja: !info,
  }));
}

function reiniciarApp() {
  saliendoDeVerdad = true;
  app.relaunch();
  app.exit(0);
}

// Pasa los datos de esta PC a la principal y, si no es una simulación, deja
// esta PC conectada a esa (y se reinicia en ese modo).
async function conectarAPrincipal(p: ConexionPrincipalInput): Promise<{ resumen: ResumenJuntar; nombrePrincipal: string }> {
  requiereAdmin();
  if (modoConectada) throw new Error('Esta PC ya está conectada a una PC principal.');
  const direccion = normalizarDireccion(p.direccion);
  const info = await obtenerInfoPc(direccion);
  if (info.idPc === config.idPc) throw new Error('Esa dirección es esta misma PC: tenés que elegir la otra.');
  if (info.modo !== 'principal') throw new Error('Esa PC está conectada a otra: la principal es la que guarda los datos.');

  const base = `http://${direccion}`;
  const sesion = await pedirJson<{ token: string; rol: string }>(`${base}/api/auth/login`, {
    metodo: 'POST',
    cuerpo: { usuario: String(p.usuario ?? '').trim(), password: String(p.password ?? '') },
  });
  try {
    if (sesion.rol !== 'admin') throw new Error('Hace falta entrar con una cuenta de administradora de la PC principal.');
    const datos = await exportarDatosParaJuntar(os.hostname());
    const resumen = await pedirJson<ResumenJuntar>(`${base}/api/sistema/juntar-datos`, {
      metodo: 'POST',
      token: sesion.token,
      cuerpo: { datos, simular: p.simular === true },
      esperaMs: 10 * 60 * 1000,
    });
    if (p.simular !== true) {
      // Con esta clave la PC conectada guarda una copia de los datos de la
      // principal (ver replica.ts). Si la principal es de una versión que
      // todavía no la da, queda sin copia hasta que se la active desde
      // Configuración.
      const claveCopia = await pedirJson<{ clave: string }>(`${base}/api/copia/clave`, { token: sesion.token })
        .then((r) => r.clave)
        .catch(() => null);
      guardarConfiguracion({
        ...config,
        modo: 'conectada',
        direccionPrincipal: direccion,
        idPrincipal: info.idPc,
        nombrePrincipal: info.nombrePc,
        claveCopia,
      });
      config = leerConfiguracion();
      logCrash('modo', `esta PC pasa a estar conectada a ${info.nombrePc} (${direccion})`);
      // Un toque después, para que la pantalla alcance a mostrar el resultado.
      setTimeout(reiniciarApp, 4000);
    }
    return { resumen, nombrePrincipal: info.nombrePc };
  } finally {
    pedirJson(`${base}/api/auth/logout`, { metodo: 'POST', token: sesion.token }).catch(() => {});
  }
}

// Vuelve a usar la base propia de esta PC (la que quedó como estaba el día
// que se conectó a la principal).
function desconectar(): boolean {
  if (!modoConectada) return false;
  guardarConfiguracion({ ...config, modo: 'principal', direccionPrincipal: null, idPrincipal: null, nombrePrincipal: null, claveCopia: null });
  config = leerConfiguracion();
  logCrash('modo', 'esta PC vuelve a usar su base propia');
  setTimeout(reiniciarApp, 500);
  return true;
}

// --- Copia de seguridad y cambio de PC principal ---
// Las PCs conectadas guardan sola una copia de los datos de la principal
// (ver replica.ts). Con eso, si se cambia de PC o la principal se rompe, una
// PC conectada se puede convertir en la principal sin perder lo cargado.
let copiaAutomatica: { detener: () => void; revisarYa: () => void } | null = null;
let traspasoEnCurso = false;

function iniciarCopiaEnSegundoPlano() {
  copiaAutomatica = iniciarCopiaAutomatica({
    configuracion: () => config,
    quienSoy: () => ({ idPc: config.idPc, nombrePc: os.hostname() }),
    registrar: logCrash,
    // Si la principal cambió de dirección (el router le dio otra IP, o se
    // pasó a otra PC), se la vuelve a buscar por su identificador.
    reencontrarPrincipal: async () => {
      if (traspasoEnCurso || !config.idPrincipal) return;
      const hallada = (await buscarConInfo()).find((e) => e.info?.idPc === config.idPrincipal);
      if (!hallada?.info || hallada.direccion === config.direccionPrincipal) return;
      guardarConfiguracion({ ...config, direccionPrincipal: hallada.direccion, nombrePrincipal: hallada.info.nombrePc });
      config = leerConfiguracion();
      logCrash('copia', `la PC principal ahora está en ${hallada.direccion}`);
      if (mainWindow && !mainWindow.isDestroyed()) cargarPrincipal();
    },
  });
}

async function estadoCopia(): Promise<EstadoCopia> {
  if (!modoConectada) throw new Error('La copia de los datos sólo corresponde a una PC conectada.');
  const meta = leerMetaCopia();
  const estado = estadoDeLaCopia();
  const direccion = config.direccionPrincipal;
  const alcanzable = direccion ? await obtenerInfoPc(direccion).then(() => true, () => false) : false;
  return {
    activa: config.claveCopia !== null,
    ultimaCopia: meta?.fecha ?? null,
    alDia: estado.alDia && meta !== null,
    copiando: estado.copiando,
    error: config.claveCopia ? estado.error : null,
    principalAlcanzable: alcanzable,
    nombrePrincipal: config.nombrePrincipal,
    resumen: meta?.resumen ?? null,
  };
}

// Para las PCs que se conectaron antes de que existiera la copia: se le pide
// la clave a la principal con una cuenta de administradora.
async function activarCopia(p: CredencialesAdmin): Promise<EstadoCopia> {
  if (!modoConectada || !config.direccionPrincipal) throw new Error('Esta PC no está conectada a una PC principal.');
  const base = `http://${config.direccionPrincipal}`;
  const sesion = await pedirJson<{ token: string; rol: string }>(`${base}/api/auth/login`, {
    metodo: 'POST',
    cuerpo: { usuario: String(p.usuario ?? '').trim(), password: String(p.password ?? '') },
  });
  try {
    if (sesion.rol !== 'admin') throw new Error('Hace falta entrar con una cuenta de administradora.');
    const { clave } = await pedirJson<{ clave: string }>(`${base}/api/copia/clave`, { token: sesion.token });
    guardarConfiguracion({ ...config, claveCopia: clave });
    config = leerConfiguracion();
  } finally {
    pedirJson(`${base}/api/auth/logout`, { metodo: 'POST', token: sesion.token }).catch(() => {});
  }
  copiaAutomatica?.revisarYa();
  return estadoCopia();
}

// La dirección con la que las otras PCs y los celulares encuentran a esta.
function direccionDeEstaPc(): string {
  return `${obtenerIpsLan()[0] ?? '127.0.0.1'}:${PUERTO}`;
}

// Esta PC pasa a ser la principal.
// - Si la principal contesta: se llevan sus datos más recientes (mientras
//   tanto no acepta cambios, para no perder nada) y esa PC queda conectada
//   a esta.
// - Si no contesta (se rompió, o ya no está): se usa la última copia
//   guardada, y hay que aceptar que lo cargado después no va a estar.
// En los dos casos esta PC toma el identificador de la principal anterior,
// así las otras PCs la encuentran sola. Lo que había en la base propia de
// esta PC se respalda antes de reemplazarla.
async function hacerPrincipalEstaPc(p: HacerPrincipalInput): Promise<ResultadoHacerPrincipal> {
  if (!modoConectada) throw new Error('Esta PC ya es la principal.');
  if (traspasoEnCurso) throw new Error('Ya se está pasando la principal a esta PC. Esperá a que termine.');
  const usuario = String(p.usuario ?? '').trim();
  const password = String(p.password ?? '');
  if (!usuario || !password) throw new Error('Escribí el usuario y la contraseña de una cuenta de administradora.');

  traspasoEnCurso = true;
  let terminado = false;
  try {
    await pausarCopiaAutomatica();

    // ¿La principal contesta? Si cambió de dirección se la busca por su identificador.
    let direccion = config.direccionPrincipal;
    let info = direccion ? await obtenerInfoPc(direccion).catch(() => null) : null;
    if (!info || (config.idPrincipal && info.idPc !== config.idPrincipal)) {
      const hallada = (await buscarConInfo()).find((e) => e.info && (!config.idPrincipal || e.info.idPc === config.idPrincipal));
      direccion = hallada?.direccion ?? null;
      info = hallada?.info ?? null;
    }
    const idHeredado = config.idPrincipal ?? config.idPc;
    const nombreAnterior = info?.nombrePc ?? config.nombrePrincipal;
    // Un número más que el de la principal anterior (o el de la copia): así,
    // si la anterior vuelve a prenderse, se sabe cuál es la verdadera.
    const generacionNueva = Math.max(info?.generacion ?? 0, leerMetaCopia()?.generacion ?? 0, config.generacion) + 1;

    let resultado: ResultadoHacerPrincipal;
    if (info && direccion) {
      const base = `http://${direccion}`;
      const sesion = await pedirJson<{ token: string; rol: string }>(`${base}/api/auth/login`, {
        metodo: 'POST',
        cuerpo: { usuario, password },
      });
      let traspasoAbierto = false;
      try {
        if (sesion.rol !== 'admin') throw new Error('Hace falta entrar con una cuenta de administradora.');
        // Si la principal es de una versión vieja, esto falla con un mensaje
        // claro (hay que actualizarla primero).
        await pedirJson(`${base}/api/copia/traspaso/iniciar`, { metodo: 'POST', token: sesion.token });
        traspasoAbierto = true;
        await bajarCopia(direccion, { token: sesion.token }, { idPc: config.idPc, nombrePc: os.hostname() });
        await cargarCopiaEnEstaPc();
        // La principal anterior deja de serlo y queda conectada a esta.
        await pedirJson(`${base}/api/copia/traspaso/terminar`, {
          metodo: 'POST',
          token: sesion.token,
          cuerpo: { direccion: direccionDeEstaPc(), idPrincipal: idHeredado, nombrePrincipal: os.hostname() },
        });
        traspasoAbierto = false;
      } catch (err) {
        if (traspasoAbierto) {
          await pedirJson(`${base}/api/copia/traspaso/cancelar`, { metodo: 'POST', token: sesion.token }).catch(() => {});
        }
        throw err;
      } finally {
        pedirJson(`${base}/api/auth/logout`, { metodo: 'POST', token: sesion.token }).catch(() => {});
      }
      resultado = { usoCopia: false, fechaCopia: null, otraPcAvisada: true, nombreOtraPc: nombreAnterior };
    } else {
      const meta = leerMetaCopia();
      if (!meta) {
        throw new Error(
          'La PC principal no contesta y esta PC todavía no tiene una copia de sus datos, así que no hay con qué seguir.'
        );
      }
      if (p.aceptaCopiaVieja !== true) {
        throw new Error('La PC principal no contesta. Para seguir hay que aceptar usar la última copia de los datos.');
      }
      if (!esAdminDeLaCopia(usuario, password)) {
        throw new Error('Usuario o contraseña incorrectos, o la cuenta no es de administradora.');
      }
      await cargarCopiaEnEstaPc();
      resultado = { usoCopia: true, fechaCopia: meta.fecha, otraPcAvisada: false, nombreOtraPc: nombreAnterior };
    }

    guardarConfiguracion({
      ...config,
      idPc: idHeredado,
      modo: 'principal',
      direccionPrincipal: null,
      idPrincipal: null,
      nombrePrincipal: null,
      claveCopia: null,
      generacion: generacionNueva,
    });
    config = leerConfiguracion();
    terminado = true;
    logCrash('modo', `esta PC pasa a ser la principal (${resultado.usoCopia ? 'con la última copia' : 'con los datos al día'})`);
    setTimeout(reiniciarApp, 3000);
    return resultado;
  } finally {
    if (!terminado) {
      traspasoEnCurso = false;
      reanudarCopiaAutomatica();
    }
  }
}

// Si esta PC estuvo apagada (o rota) y otra pasó a ser la principal, al
// volver se cree la principal otra vez — y lo que se cargue acá quedaría
// separado de lo de la verdadera. Al arrancar se fija si hay otra PC con el
// mismo identificador y un número de generación mayor.
async function avisarSiOtraPcOcupoMiLugar() {
  if (modoConectada) return;
  try {
    const ips = await consultarMdns(2500);
    const propias = new Set([...obtenerIpsLan(), '127.0.0.1']);
    const direcciones = new Set<string>();
    for (const ip of ips) direcciones.add(`${ip}:4000`);
    if (!app.isPackaged) for (const ip of [...ips, '127.0.0.1']) for (const puerto of [4001, 4002]) direcciones.add(`${ip}:${puerto}`);
    for (const ip of propias) direcciones.delete(`${ip}:${PUERTO}`);

    for (const direccion of direcciones) {
      const info = await obtenerInfoPc(direccion).catch(() => null);
      if (!info || info.modo !== 'principal' || info.idPc !== config.idPc) continue;
      if ((info.generacion ?? 0) <= config.generacion) continue;

      logCrash('modo', `otra PC (${info.nombrePc}, ${direccion}) ocupa el lugar de la principal`);
      traerVentanaAlFrente();
      const { response } = await mostrarMensaje({
        type: 'warning',
        title: 'Esta PC ya no es la principal',
        message: `Mientras esta PC estaba apagada, ${info.nombrePc} pasó a ser la principal.`,
        detail:
          'Si seguís cargando ventas acá, van a quedar separadas de las de la principal. Lo mejor es conectar esta PC a la principal ahora: lo que se cargó acá se junta con sus datos.',
        buttons: ['Conectar esta PC ahora', 'Ahora no'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        // Con un identificador propio, la otra PC ya no se confunde con esta
        // y se puede elegir de la lista al conectar.
        guardarConfiguracion({ ...config, idPc: crypto.randomUUID() });
        config = leerConfiguracion();
        mainWindow?.webContents.executeJavaScript("location.hash = '#/configuracion'").catch(() => {});
      }
      return;
    }
  } catch (err) {
    logCrash('modo', err);
  }
}

// Otra PC pidió ser la principal: esta pasa a estar conectada a ella.
async function cederPrincipal(nueva: { direccion: string; idPrincipal: string; nombrePrincipal: string }): Promise<void> {
  if (modoConectada) throw new Error('Esta PC ya no es la principal.');
  // La misma clave de copia sigue valiendo: viaja con los datos.
  const claveCopia = await claveDeCopia().catch(() => null);
  guardarConfiguracion({
    ...config,
    // Esta PC toma un identificador nuevo: el de la principal pasó a la otra.
    idPc: crypto.randomUUID(),
    modo: 'conectada',
    direccionPrincipal: nueva.direccion,
    idPrincipal: nueva.idPrincipal,
    nombrePrincipal: nueva.nombrePrincipal,
    claveCopia,
  });
  config = leerConfiguracion();
  logCrash('modo', `esta PC deja de ser la principal: ahora lo es ${nueva.nombrePrincipal} (${nueva.direccion})`);
  setTimeout(reiniciarApp, 1500);
}

function cargarPrincipal() {
  mainWindow?.loadURL(`http://${config.direccionPrincipal}/`);
}

// Si la principal no responde donde estaba, se la vuelve a buscar en la red
// por su identificador — así, si el router le cambió la IP, se reconecta sola.
async function reintentarConexion(): Promise<{ ok: boolean; mensaje?: string }> {
  if (!modoConectada || traspasoEnCurso) return { ok: false };
  const direccion = config.direccionPrincipal;
  const info = direccion ? await obtenerInfoPc(direccion).catch(() => null) : null;
  if (!info || (config.idPrincipal && info.idPc !== config.idPrincipal)) {
    const encontrada = (await buscarConInfo()).find(
      (e) => e.info && (!config.idPrincipal || e.info.idPc === config.idPrincipal)
    );
    if (!encontrada?.info) {
      return { ok: false, mensaje: 'Todavía no aparece la PC principal. Se vuelve a probar sola en unos segundos.' };
    }
    guardarConfiguracion({ ...config, direccionPrincipal: encontrada.direccion, nombrePrincipal: encontrada.info.nombrePc });
    config = leerConfiguracion();
  }
  cargarPrincipal();
  return { ok: true };
}

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Lo que se ve en esta PC (conectada) cuando la principal no responde.
function mostrarSinConexion() {
  if (!mainWindow) return;
  const nombre = escaparHtml(config.nombrePrincipal ?? 'la PC principal');
  const direccion = escaparHtml(config.direccionPrincipal ?? '');
  // Si esta PC tiene una copia de los datos, puede pasar a ser la principal.
  const meta = leerMetaCopia();
  const bloquePrincipal = meta
    ? `<div class="bloque">
    <p>Esta PC tiene una copia de los datos del <b>${escaparHtml(new Date(meta.fecha).toLocaleString('es-AR'))}</b>
    (${meta.resumen.articulos} productos, ${meta.resumen.clientes} clientes, ${meta.resumen.ventas} ventas).</p>
    <button id="hacerPrincipal" class="sec">Hacer que esta PC sea la principal</button>
    <form id="formPrincipal" style="display:none;text-align:left;margin-top:14px">
      <p style="font-size:12px">Esta PC va a guardar los datos usando esa copia. Lo que se cargó en <b>${nombre}</b> después de esa fecha no va a estar.</p>
      <input id="usr" placeholder="Usuario de administradora" autocomplete="off">
      <input id="pwd" type="password" placeholder="Contraseña">
      <label class="chk"><input type="checkbox" id="acepto"> Entiendo que se usa la copia y no los últimos datos</label>
      <button type="submit" id="confirmarPrincipal">Pasar la principal a esta PC</button>
    </form>
  </div>`
    : `<div class="bloque"><p style="font-size:12px">Esta PC todavía no tiene una copia de los datos de la principal, así que no puede ocupar su lugar.</p></div>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mis Amores</title><style>
    body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#f5f8fd;color:#1e293b;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px;max-width:460px;text-align:center}
    h1{font-size:20px;margin:12px 0 8px}p{color:#64748b;line-height:1.5;margin:6px 0}
    button{margin-top:18px;background:linear-gradient(90deg,#2a5cb3,#3b76d1);color:#fff;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
    #estado{margin-top:14px;font-size:13px;color:#94a3b8;min-height:18px}
    a{display:inline-block;margin-top:22px;font-size:12px;color:#94a3b8;cursor:pointer;text-decoration:underline}
    .icono{font-size:40px}
    .bloque{margin-top:22px;border-top:1px solid #e2e8f0;padding-top:16px}
    button.sec{background:#fff;color:#2a5cb3;border:1px solid #b9cdee;margin-top:6px}
    input{width:100%;box-sizing:border-box;margin-top:8px;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}
    input[type=checkbox]{width:auto;margin:0 6px 0 0}
    .chk{display:block;margin-top:10px;font-size:12px;color:#475569}</style></head><body><div class="card">
    <div class="icono">📡</div>
    <h1>No se encuentra la PC principal</h1>
    <p>Esta PC guarda todo en <b>${nombre}</b>${direccion ? ` (${direccion})` : ''}. Fijate que esa PC esté prendida, con Mis Amores abierto y conectada al mismo WiFi.</p>
    <button id="reintentar">Reintentar ahora</button>
    <div id="estado">Se vuelve a probar sola cada 15 segundos.</div>
    <a id="desconectar">La PC principal no va a volver…</a>
    ${bloquePrincipal}
    </div><script>
    const estado = document.getElementById('estado');
    let probando = false;
    let pasandoAPrincipal = false;
    async function reintentar() {
      if (probando || pasandoAPrincipal) return;
      probando = true;
      estado.textContent = 'Buscando la PC principal...';
      try {
        const r = await window.escritorio.reintentarConexion();
        if (!r.ok) estado.textContent = r.mensaje || 'Todavía no aparece.';
      } catch (e) { estado.textContent = 'Todavía no aparece.'; }
      probando = false;
    }
    document.getElementById('reintentar').onclick = reintentar;
    document.getElementById('desconectar').onclick = async () => {
      if (!confirm('Sólo si la PC principal no va a volver (ej. se rompió): esta PC deja de estar conectada y vuelve a usar sus datos propios, que quedaron como estaban el día que se conectó. ¿Seguro?')) return;
      if (!confirm('Lo que se cargó en la PC principal desde ese día NO va a aparecer acá. ¿Desconectar igual?')) return;
      await window.escritorio.desconectar();
    };
    const botonPrincipal = document.getElementById('hacerPrincipal');
    if (botonPrincipal) {
      const formulario = document.getElementById('formPrincipal');
      botonPrincipal.onclick = () => { formulario.style.display = 'block'; botonPrincipal.style.display = 'none'; };
      formulario.onsubmit = async (e) => {
        e.preventDefault();
        if (!document.getElementById('acepto').checked) { estado.textContent = 'Tenés que aceptar que se usa la copia.'; return; }
        pasandoAPrincipal = true;
        document.getElementById('confirmarPrincipal').disabled = true;
        estado.textContent = 'Cargando los datos en esta PC... puede tardar un minuto.';
        try {
          await window.escritorio.hacerPrincipal({
            usuario: document.getElementById('usr').value,
            password: document.getElementById('pwd').value,
            aceptaCopiaVieja: true,
          });
          estado.textContent = 'Listo: esta PC ya es la principal. La app se reinicia sola.';
        } catch (err) {
          pasandoAPrincipal = false;
          document.getElementById('confirmarPrincipal').disabled = false;
          estado.textContent = (err && err.message) || 'No se pudo pasar la principal a esta PC.';
        }
      };
    }
    setInterval(reintentar, 15000);
    </script></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// Esta PC (conectada) ya no atiende a los celulares: si alguno todavía tiene
// guardada su dirección, lo manda a la principal en vez de no contestar.
function iniciarRedireccionALaPrincipal() {
  const redireccion = express();
  redireccion.use((req, res) => {
    if (!config.direccionPrincipal) {
      res.status(503).send('Esta PC está conectada a la PC principal.');
      return;
    }
    res.redirect(307, `http://${config.direccionPrincipal}${req.originalUrl}`);
  });
  const servidor = http.createServer(redireccion);
  servidor.on('error', (err) => logCrash('redireccion', err));
  servidor.listen(PUERTO, '0.0.0.0');
  detenerServidorWeb = () =>
    new Promise<void>((resolve) => {
      servidor.closeAllConnections?.();
      servidor.close(() => resolve());
    });
}

function registrarIpcEscritorio() {
  ipcMain.handle(Channels.sistemaBuscarActualizaciones, () => buscarActualizacionesManual());
  ipcMain.handle(Channels.sistemaEstadoActualizacion, () => infoActualizacion());
  ipcMain.handle(Channels.sistemaDescargarActualizacion, () => descargarActualizacion());
  ipcMain.handle(Channels.sistemaInstalarActualizacion, () => instalarActualizacion());
  ipcMain.handle(Channels.escritorioModo, () => wrapEscritorio(infoModo));
  ipcMain.handle(Channels.escritorioBuscarPrincipales, () => wrapEscritorio(buscarPcsPrincipales));
  ipcMain.handle(Channels.escritorioConectar, (_e, p: ConexionPrincipalInput) => wrapEscritorio(() => conectarAPrincipal(p)));
  ipcMain.handle(Channels.escritorioDesconectar, () => wrapEscritorio(desconectar));
  ipcMain.handle(Channels.escritorioReintentar, () => wrapEscritorio(reintentarConexion));
  ipcMain.handle(Channels.escritorioEstadoCopia, () => wrapEscritorio(estadoCopia));
  ipcMain.handle(Channels.escritorioActivarCopia, (_e, p: CredencialesAdmin) => wrapEscritorio(() => activarCopia(p)));
  ipcMain.handle(Channels.escritorioHacerPrincipal, (_e, p: HacerPrincipalInput) =>
    wrapEscritorio(() => hacerPrincipalEstaPc(p))
  );
}

// MongoDB arranca como servicio de Windows junto con la PC, pero puede
// tardar unos segundos más que esta app en estar lista — sobre todo recién
// después de prender la PC. En vez de mostrar un error de una, reintentamos
// unas cuantas veces antes de darnos por vencidos.
async function initDatabaseConReintentos(intentos = 8, esperaMs = 3000) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await initDatabase();
      return;
    } catch (err) {
      if (intento === intentos) throw err;
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }
  }
}

// Alguien intentó abrir una segunda copia (doble click estando la app ya
// corriendo, aunque esté escondida en la bandeja) — no dejamos que arranque
// otra instancia; sólo mostramos la que ya está viva.
app.on('second-instance', mostrarVentana);

// Lo que hace la PC principal al arrancar (es lo de siempre): conecta con su
// base, atiende a los celulares y a la PC conectada, y hace los respaldos.
async function arrancarComoPrincipal(): Promise<boolean> {
  try {
    await initDatabaseConReintentos();
  } catch (err) {
    dialog.showErrorBox(
      'No se pudo conectar a la base de datos',
      err instanceof Error ? err.message : 'Error desconocido al conectar con MongoDB.'
    );
    app.quit();
    return false;
  }

  registrarHandlers();
  // Cuando alguien cambia datos (desde esta PC, la PC conectada o un celular),
  // la pantalla se vuelve a cargar sola; la PC conectada y los celulares lo
  // reciben por /api/eventos.
  escucharCambios(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(Channels.sistemaDatosCambio);
  });
  // Las sesiones de los celulares que ya estaban abiertas siguen valiendo
  // después de reiniciar (ver server/tokenSessions.ts).
  await cargarSesionesGuardadas().catch((err) => logCrash('sesiones', err));

  // Respaldo automático de la base local (ver electron/backup.ts) — una vez
  // al arrancar, y de nuevo cada 6hs por si la app queda prendida días
  // seguidos en la bandeja sin reiniciarse. Si falla, sólo queda anotado en
  // el log de errores — nunca debe frenar el arranque de la app.
  respaldarSiCorresponde().catch((err) => logCrash('respaldo', err));
  setInterval(() => respaldarSiCorresponde().catch((err) => logCrash('respaldo', err)), 6 * 60 * 60 * 1000);

  try {
    const { detener, ...infoParaRenderer } = await iniciarServidorWeb(path.join(__dirname, '../../dist'), infoPc, { cederPrincipal });
    // infoServidorWeb se manda tal cual al renderer por IPC (ver
    // sistemaInfoRed más abajo) — "detener" no viaja ahí porque una función
    // no se puede mandar por IPC, y tampoco tiene sentido que el renderer la
    // llame; queda guardada acá aparte, sólo para usarla al cerrar la app.
    infoServidorWeb = infoParaRenderer;
    detenerServidorWeb = detener;
    const primeraIp = obtenerIpsLan()[0];
    if (primeraIp) detenerMdns = iniciarMdns(primeraIp);
  } catch (err) {
    // Si el puerto está ocupado o falla por lo que sea, la app de escritorio
    // sigue funcionando igual — sólo no va a estar disponible desde el
    // celular hasta que se reinicie.
    console.error('No se pudo iniciar el acceso desde el celular:', err);
    infoServidorWeb = { error: err instanceof Error ? err.message : 'No se pudo iniciar el acceso desde el celular' };
  }
  ipcMain.handle(Channels.sistemaInfoRed, () => infoServidorWeb);
  // Un rato después de abrir, cuando ya hay ventana para mostrar el aviso.
  setTimeout(() => void avisarSiOtraPcOcupoMiLugar(), 8000);
  return true;
}

app.whenReady().then(async () => {
  if (!esInstanciaUnica) return;

  // Que la app se abra sola cuando arranca Windows (sin tener que buscar el
  // ícono cada vez). Sólo tiene sentido para la versión instalada — en
  // desarrollo apuntaría a un electron.exe temporal que no sirve de nada.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  }

  registrarIpcEscritorio();
  if (modoConectada) {
    // Esta PC no usa su base: abre la app de la principal (ver createWindow).
    iniciarRedireccionALaPrincipal();
    iniciarCopiaEnSegundoPlano();
  } else if (!(await arrancarComoPrincipal())) {
    return;
  }

  crearBandeja();
  createWindow();
  configurarActualizaciones();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

// Con el ícono en la bandeja, cerrar la ventana ya no cierra la app — así que
// no hace falta que "todas las ventanas cerradas" dispare app.quit(). Salir
// de verdad sólo pasa desde el menú de la bandeja.
app.on('window-all-closed', () => {
  // No hacemos nada a propósito: seguimos vivos en la bandeja.
});

app.on('before-quit', () => {
  saliendoDeVerdad = true;
  detenerMdns?.();
  // Sin await a propósito: before-quit no espera promesas, y closeAllConnections
  // adentro de detenerServidorWeb ya corta las conexiones abiertas de una,
  // así el puerto no queda ocupado ni el cierre del proceso esperando a que
  // algún celular conectado se desconecte solo.
  detenerServidorWeb?.().catch(() => {});
  closeDatabase();
});
