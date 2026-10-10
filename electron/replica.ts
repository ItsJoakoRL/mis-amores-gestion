// Copia de seguridad de los datos de la PC principal en las PCs conectadas, y
// lo necesario para pasar la principal a otra PC (porque se cambió de PC, o
// porque la principal se rompió).
//
// - La principal ofrece sus datos por /api/copia/... (ver server/httpServer.ts).
// - Cada PC conectada los baja sola cuando cambian (como mucho cada pocos
//   minutos) a una carpeta propia. Es sólo una copia en archivos: no toca la
//   base de esa PC.
// - Al "hacer principal" a una PC conectada, la copia (o una recién bajada, si
//   la principal contesta) se carga en su base y esa PC pasa a ser la
//   principal. Lo que tuviera en su base propia se respalda antes.
import { app } from 'electron';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BSON, MongoClient, type Document } from 'mongodb';
import { carpetaRespaldos, respaldarBase } from './backup';
import { versionDeLosDatos } from './cambiosEnVivo';
import { bloquearEscrituras, getDb, MONGODB_DB_NAME, MONGODB_URI } from './db/database';
import { carpetaImagenes } from './imagenes';
import type { CopiaDeOtraPc } from '../shared/types';

const EXTENSIONES_FOTO = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const COLECCION_AJUSTES = 'ajustes_sistema';
const SUFIJO_TEMPORAL = '__copia';
// Por más que cambie seguido (ventas todo el día), la copia no se baja más
// seguido que esto.
// (En desarrollo se pueden achicar con MIS_AMORES_COPIA_MIN_MS y
// MIS_AMORES_COPIA_CADA_MS, para probar sin esperar.)
const MIN_ENTRE_COPIAS_MS = Number(process.env.MIS_AMORES_COPIA_MIN_MS) || 3 * 60 * 1000;
const INTERVALO_REVISION_MS = Number(process.env.MIS_AMORES_COPIA_CADA_MS) || 30_000;
// Si el traspaso no termina en este tiempo (se apagó la otra PC a mitad de
// camino), la principal vuelve a aceptar cambios sola.
const LIMITE_TRASPASO_MS = 5 * 60 * 1000;

// =====================================================================
// Lado de la PC principal
// =====================================================================

interface DocAjuste {
  _id: string;
  clave: string;
}

// La clave con la que las PCs conectadas piden la copia sin tener que
// guardar ninguna contraseña. Vive en la base, así que viaja con los datos si
// la principal pasa a otra PC y las demás siguen andando.
export async function claveDeCopia(): Promise<string> {
  const col = getDb().collection<DocAjuste>(COLECCION_AJUSTES);
  const existente = await col.findOne({ _id: 'copia' });
  if (existente?.clave) return existente.clave;
  await col.updateOne(
    { _id: 'copia' },
    { $setOnInsert: { clave: crypto.randomBytes(24).toString('hex') } },
    { upsert: true }
  );
  const doc = await col.findOne({ _id: 'copia' });
  if (!doc?.clave) throw new Error('No se pudo crear la clave de copia');
  return doc.clave;
}

export async function claveEsValida(clave: unknown): Promise<boolean> {
  if (typeof clave !== 'string' || clave.length < 16) return false;
  const real = Buffer.from(await claveDeCopia());
  const recibida = Buffer.from(clave);
  return recibida.length === real.length && crypto.timingSafeEqual(recibida, real);
}

export interface ManifiestoCopia {
  /** Cambia cada vez que alguien carga algo en la principal. */
  version: string;
  fecha: string;
  idPc: string;
  nombrePc: string;
  generacion: number;
  colecciones: Array<{ nombre: string; cantidad: number }>;
  imagenes: Array<{ nombre: string; bytes: number }>;
}

async function nombresDeColecciones(): Promise<string[]> {
  const lista = await getDb().listCollections({}, { nameOnly: true }).toArray();
  return lista
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.') && !n.endsWith(SUFIJO_TEMPORAL))
    .sort();
}

function listarImagenes(): ManifiestoCopia['imagenes'] {
  const carpeta = carpetaImagenes();
  if (!fs.existsSync(carpeta)) return [];
  const fotos: ManifiestoCopia['imagenes'] = [];
  for (const nombre of fs.readdirSync(carpeta)) {
    if (!EXTENSIONES_FOTO.has(path.extname(nombre).toLowerCase())) continue;
    try {
      const datos = fs.statSync(path.join(carpeta, nombre));
      if (datos.isFile()) fotos.push({ nombre, bytes: datos.size });
    } catch {
      // Se borró justo ahora: no cuenta.
    }
  }
  return fotos;
}

export async function armarManifiesto(idPc: string, nombrePc: string, generacion: number): Promise<ManifiestoCopia> {
  const colecciones: ManifiestoCopia['colecciones'] = [];
  for (const nombre of await nombresDeColecciones()) {
    colecciones.push({ nombre, cantidad: await getDb().collection(nombre).countDocuments() });
  }
  return {
    version: versionDeLosDatos(),
    fecha: new Date().toISOString(),
    idPc,
    nombrePc,
    generacion,
    colecciones,
    imagenes: listarImagenes(),
  };
}

// Una colección entera como EJSON "canónico" (conserva los tipos exactos:
// ObjectId, fechas, enteros y decimales), para cargarla igual en otra base.
export async function coleccionComoTexto(nombre: string): Promise<string> {
  if (!(await nombresDeColecciones()).includes(nombre)) throw new Error('Esa colección no existe');
  const docs = await getDb().collection(nombre).find().toArray();
  return BSON.EJSON.stringify(docs, { relaxed: false });
}

// Las PCs conectadas que copian los datos (para mostrarlas en Configuración).
const copias = new Map<string, { idPc: string; nombrePc: string; ultimaVez: string; ultimaCopia: string | null; version: string | null }>();

export function registrarCopia(datos: {
  idPc: string;
  nombrePc: string;
  copiaFecha?: string | null;
  copiaVersion?: string | null;
}): void {
  const previa = copias.get(datos.idPc);
  copias.set(datos.idPc, {
    idPc: datos.idPc,
    nombrePc: datos.nombrePc || previa?.nombrePc || 'PC conectada',
    ultimaVez: new Date().toISOString(),
    ultimaCopia: datos.copiaFecha ?? previa?.ultimaCopia ?? null,
    version: datos.copiaVersion ?? previa?.version ?? null,
  });
}

export function listarCopias(): CopiaDeOtraPc[] {
  const actual = versionDeLosDatos();
  return [...copias.values()]
    .sort((a, b) => a.nombrePc.localeCompare(b.nombrePc))
    .map(({ version, ...resto }) => ({ ...resto, alDia: version === actual }));
}

// --- Traspaso de la principal a otra PC ---
// Mientras dura, esta PC no acepta cambios (ni de su pantalla, ni de los
// celulares): lo que se cargara entre que la otra PC se lleva los datos y
// esta deja de ser la principal se perdería.
let traspaso: { por: string; limite: NodeJS.Timeout } | null = null;

export function iniciarTraspaso(por: string): void {
  if (traspaso) throw new Error('Ya hay un traspaso de la PC principal en curso. Esperá unos minutos e intentá de nuevo.');
  bloquearEscrituras(true);
  traspaso = { por, limite: setTimeout(cancelarTraspaso, LIMITE_TRASPASO_MS) };
}

export function cancelarTraspaso(): void {
  if (traspaso) clearTimeout(traspaso.limite);
  traspaso = null;
  bloquearEscrituras(false);
}

// =====================================================================
// Lado de la PC conectada
// =====================================================================

export interface MetaCopia {
  version: string;
  fecha: string;
  idPrincipal: string;
  nombrePrincipal: string;
  generacion: number;
  direccion: string;
  resumen: { articulos: number; clientes: number; ventas: number };
}

export function carpetaCopia(): string {
  return path.join(app.getPath('userData'), 'copia-principal');
}

export function leerMetaCopia(): MetaCopia | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(carpetaCopia(), 'meta.json'), 'utf-8')) as MetaCopia;
    return typeof meta.fecha === 'string' && typeof meta.version === 'string' ? meta : null;
  } catch {
    return null;
  }
}

export interface Credencial {
  clave?: string;
  token?: string;
}

export class ErrorDeCopia extends Error {
  constructor(
    mensaje: string,
    /** La principal no aceptó la clave o la sesión. */
    readonly deAutorizacion = false
  ) {
    super(mensaje);
  }
}

function cabecerasDe(cred: Credencial): Record<string, string> {
  if (cred.clave) return { 'X-Clave-Copia': cred.clave };
  if (cred.token) return { Authorization: `Bearer ${cred.token}` };
  return {};
}

async function pedirTexto(url: string, cred: Credencial, esperaMs: number): Promise<string> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, { headers: cabecerasDe(cred), signal: AbortSignal.timeout(esperaMs) });
  } catch {
    throw new ErrorDeCopia('No se pudo conectar con la PC principal.');
  }
  if (!respuesta.ok) {
    let mensaje = `La PC principal respondió con un error (${respuesta.status}).`;
    try {
      const json = (await respuesta.json()) as { error?: string };
      if (json?.error) mensaje = json.error;
    } catch {
      // Sin detalle: queda el mensaje de arriba.
    }
    throw new ErrorDeCopia(mensaje, respuesta.status === 401 || respuesta.status === 403);
  }
  return respuesta.text();
}

async function pedirManifiesto(
  direccion: string,
  cred: Credencial,
  quien: { idPc: string; nombrePc: string },
  meta: MetaCopia | null
): Promise<ManifiestoCopia> {
  const parametros = new URLSearchParams({ pc: quien.idPc, nombre: quien.nombrePc });
  if (meta) {
    parametros.set('copia', meta.fecha);
    parametros.set('version', meta.version);
  }
  const texto = await pedirTexto(`http://${direccion}/api/copia/manifiesto?${parametros}`, cred, 10_000);
  let json: { ok: boolean; data?: ManifiestoCopia; error?: string };
  try {
    json = JSON.parse(texto);
  } catch {
    throw new ErrorDeCopia('La PC principal tiene una versión de Mis Amores que todavía no sabe dar copias. Actualizala primero.');
  }
  if (!json.ok || !json.data) {
    const mensaje = json.error ?? 'La PC principal devolvió un error';
    throw new ErrorDeCopia(mensaje, /sesión|permisos/i.test(mensaje));
  }
  return json.data;
}

// Baja a una carpeta propia todo lo de la principal. Se arma aparte y recién
// al final reemplaza a la copia anterior, para no quedarse sin copia si algo
// se corta a la mitad.
export async function bajarCopia(
  direccion: string,
  cred: Credencial,
  quien: { idPc: string; nombrePc: string },
  alAvanzar?: (texto: string) => void
): Promise<MetaCopia> {
  const manifiesto = await pedirManifiesto(direccion, cred, quien, leerMetaCopia());
  const base = `http://${direccion}`;
  const destino = carpetaCopia();
  const temporal = `${destino}.tmp`;
  fs.rmSync(temporal, { recursive: true, force: true });
  fs.mkdirSync(path.join(temporal, 'imagenes'), { recursive: true });
  try {
    for (const col of manifiesto.colecciones) {
      alAvanzar?.(`Copiando ${col.nombre}...`);
      const texto = await pedirTexto(`${base}/api/copia/coleccion/${encodeURIComponent(col.nombre)}`, cred, 3 * 60 * 1000);
      fs.writeFileSync(path.join(temporal, `${col.nombre}.json`), texto);
    }
    alAvanzar?.('Copiando las fotos...');
    for (const foto of manifiesto.imagenes) {
      const aca = path.join(temporal, 'imagenes', foto.nombre);
      const anterior = path.join(destino, 'imagenes', foto.nombre);
      try {
        if (fs.statSync(anterior).size === foto.bytes) {
          fs.copyFileSync(anterior, aca);
          continue;
        }
      } catch {
        // No estaba en la copia anterior: se baja.
      }
      try {
        const r = await fetch(`${base}/imagenes/${encodeURIComponent(foto.nombre)}`, { signal: AbortSignal.timeout(30_000) });
        if (r.ok) fs.writeFileSync(aca, Buffer.from(await r.arrayBuffer()));
      } catch {
        // Una foto que no baja no impide la copia de los datos.
      }
    }
    const cantidad = (nombre: string) => manifiesto.colecciones.find((c) => c.nombre === nombre)?.cantidad ?? 0;
    const meta: MetaCopia = {
      version: manifiesto.version,
      fecha: new Date().toISOString(),
      idPrincipal: manifiesto.idPc,
      nombrePrincipal: manifiesto.nombrePc,
      generacion: manifiesto.generacion ?? 0,
      direccion,
      resumen: { articulos: cantidad('articulos'), clientes: cantidad('clientes'), ventas: cantidad('ventas') },
    };
    fs.writeFileSync(path.join(temporal, 'meta.json'), JSON.stringify(meta));
    fs.rmSync(destino, { recursive: true, force: true });
    fs.renameSync(temporal, destino);
    return meta;
  } catch (err) {
    fs.rmSync(temporal, { recursive: true, force: true });
    throw err;
  }
}

// --- La copia automática en segundo plano ---
export interface OpcionesCopiaAutomatica {
  configuracion: () => { direccionPrincipal: string | null; idPrincipal: string | null; claveCopia: string | null };
  quienSoy: () => { idPc: string; nombrePc: string };
  /** Después de varios intentos seguidos sin poder hablar con la principal:
   * por si cambió de dirección, que la vuelva a buscar en la red. */
  reencontrarPrincipal: () => Promise<unknown>;
  registrar: (etiqueta: string, detalle: unknown) => void;
}

// Hay una revisión en curso (preguntarle a la principal y, si hace falta,
// bajar la copia). Evita que dos revisiones se pisen la carpeta temporal.
let revisando = false;

const estado = {
  copiando: false,
  pausada: false,
  alDia: false,
  error: null as string | null,
  principalAlcanzable: false,
  fallosSeguidos: 0,
  ultimaBajada: 0,
};

export function estadoDeLaCopia() {
  return { ...estado };
}

// Mientras se pasa a ser la principal, la copia automática no tiene que
// tocar la carpeta de la copia: espera a que termine la que esté en curso.
export async function pausarCopiaAutomatica(): Promise<void> {
  estado.pausada = true;
  const limite = Date.now() + 3 * 60 * 1000;
  while ((estado.copiando || revisando) && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function reanudarCopiaAutomatica(): void {
  estado.pausada = false;
}

export function iniciarCopiaAutomatica(op: OpcionesCopiaAutomatica): { detener: () => void; revisarYa: () => void } {
  let ultimoErrorAnotado: string | null = null;
  const revisar = async () => {
    if (revisando || estado.copiando || estado.pausada) return;
    const c = op.configuracion();
    if (!c.claveCopia || !c.direccionPrincipal) return;
    const quien = op.quienSoy();
    revisando = true;
    try {
      const meta = leerMetaCopia();
      const manifiesto = await pedirManifiesto(c.direccionPrincipal, { clave: c.claveCopia }, quien, meta);
      if (c.idPrincipal && manifiesto.idPc !== c.idPrincipal) {
        throw new ErrorDeCopia('Esa dirección ya no es la de la PC principal.');
      }
      estado.principalAlcanzable = true;
      estado.fallosSeguidos = 0;
      estado.error = null;
      ultimoErrorAnotado = null;

      const hayNovedad = !meta || meta.version !== manifiesto.version || meta.idPrincipal !== manifiesto.idPc;
      estado.alDia = !hayNovedad;
      const pasoElMinimo = Date.now() - estado.ultimaBajada >= MIN_ENTRE_COPIAS_MS;
      if (hayNovedad && (pasoElMinimo || !meta)) {
        estado.copiando = true;
        try {
          await bajarCopia(c.direccionPrincipal, { clave: c.claveCopia }, quien);
          estado.ultimaBajada = Date.now();
          estado.alDia = true;
        } finally {
          estado.copiando = false;
        }
      }
    } catch (err) {
      estado.principalAlcanzable = false;
      estado.error = err instanceof Error ? err.message : 'No se pudo copiar los datos';
      estado.fallosSeguidos += 1;
      if (err instanceof ErrorDeCopia && err.deAutorizacion) {
        estado.error = 'La PC principal no aceptó la clave de copia. Volvé a activar la copia desde Configuración.';
      }
      // Se anota una vez por cada motivo distinto, no en cada intento.
      if (estado.error !== ultimoErrorAnotado) {
        ultimoErrorAnotado = estado.error;
        op.registrar('copia', err);
      }
      if (estado.fallosSeguidos % 4 === 3) await op.reencontrarPrincipal().catch(() => {});
    } finally {
      revisando = false;
    }
  };

  const primera = setTimeout(revisar, 5000);
  const intervalo = setInterval(revisar, INTERVALO_REVISION_MS);
  return {
    detener: () => {
      clearTimeout(primera);
      clearInterval(intervalo);
    },
    revisarYa: () => {
      revisar().catch(() => {});
    },
  };
}

// --- Pasar a ser la principal ---

function marcaDeTiempo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Para poder dejar pasar a una administradora cuando la principal no
// contesta: se verifica contra los usuarios que hay en la última copia.
export function esAdminDeLaCopia(usuario: string, password: string): boolean {
  try {
    const archivo = path.join(carpetaCopia(), 'usuarios.json');
    if (!fs.existsSync(archivo)) return false;
    const docs = BSON.EJSON.parse(fs.readFileSync(archivo, 'utf-8')) as Array<{
      usuario?: string;
      passwordHash?: string;
      rol?: string;
      activo?: boolean;
    }>;
    const doc = docs.find((d) => d.usuario === usuario.trim());
    return (
      !!doc && doc.activo !== false && doc.rol === 'admin' && typeof doc.passwordHash === 'string' && bcrypt.compareSync(password, doc.passwordHash)
    );
  } catch {
    return false;
  }
}

// Carga la copia guardada en la base de esta PC, reemplazando lo que tenga.
// Va de a pasos para que, si algo falla a la mitad, la base siga como estaba:
// primero se carga todo en colecciones temporales, y sólo cuando está todo
// cargado se reemplazan. Antes de tocar nada, lo que había se respalda en
// "Documentos\Mis Amores - Respaldos".
export async function cargarCopiaEnEstaPc(
  carpeta: string = carpetaCopia(),
  alAvanzar?: (texto: string) => void
): Promise<{ respaldo: string | null }> {
  if (!fs.existsSync(carpeta)) throw new Error('No hay una copia de los datos guardada en esta PC.');
  const archivos = fs.readdirSync(carpeta).filter((n) => n.endsWith('.json') && n !== 'meta.json');
  if (archivos.length === 0) throw new Error('La copia guardada en esta PC está vacía.');

  const cliente = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await cliente.connect();
  } catch {
    throw new Error('No se pudo abrir la base de datos de esta PC. ¿Está corriendo MongoDB?');
  }
  try {
    const db = cliente.db(MONGODB_DB_NAME);
    const existentes = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'));

    let respaldo: string | null = null;
    if (existentes.length > 0) {
      alAvanzar?.('Guardando un respaldo de lo que había en esta PC...');
      respaldo = path.join(carpetaRespaldos(), `antes-de-ser-principal-${marcaDeTiempo()}`);
      await respaldarBase(db, respaldo);
    }

    const nombres: string[] = [];
    for (const archivo of archivos) {
      const nombre = path.basename(archivo, '.json');
      alAvanzar?.(`Cargando ${nombre}...`);
      const docs = BSON.EJSON.parse(fs.readFileSync(path.join(carpeta, archivo), 'utf-8'), { relaxed: false }) as Document[];
      const temporal = `${nombre}${SUFIJO_TEMPORAL}`;
      await db.collection(temporal).drop().catch(() => {});
      if (docs.length === 0) {
        await db.createCollection(temporal);
      } else {
        for (let i = 0; i < docs.length; i += 500) {
          await db.collection(temporal).insertMany(docs.slice(i, i + 500), { ordered: true });
        }
      }
      nombres.push(nombre);
    }

    // Las fotos, antes de reemplazar: así las rutas de los productos se
    // pueden apuntar a la carpeta de esta PC (la que traen es la del disco de
    // la principal anterior).
    const carpetaFotos = path.join(carpeta, 'imagenes');
    const destinoFotos = carpetaImagenes();
    const fotosCopiadas = new Set<string>();
    if (fs.existsSync(carpetaFotos)) {
      fs.mkdirSync(destinoFotos, { recursive: true });
      for (const nombre of fs.readdirSync(carpetaFotos)) {
        const origen = path.join(carpetaFotos, nombre);
        const aca = path.join(destinoFotos, nombre);
        try {
          if (!fs.existsSync(aca) || fs.statSync(aca).size !== fs.statSync(origen).size) fs.copyFileSync(origen, aca);
          fotosCopiadas.add(nombre);
        } catch {
          // Esa foto no se pudo copiar: el producto queda sin foto.
        }
      }
    }
    if (nombres.includes('articulos')) {
      const articulos = db.collection(`articulos${SUFIJO_TEMPORAL}`);
      const conFoto = await articulos
        .find({ imagenPath: { $type: 'string', $ne: '' } }, { projection: { imagenPath: 1 } })
        .toArray();
      const cambios = conFoto
        .map((a) => ({ id: a._id, nombre: path.win32.basename(String(a.imagenPath)) }))
        .filter((a) => fotosCopiadas.has(a.nombre))
        .map((a) => ({
          updateOne: { filter: { _id: a.id }, update: { $set: { imagenPath: path.join(destinoFotos, a.nombre) } } },
        }));
      if (cambios.length > 0) await articulos.bulkWrite(cambios, { ordered: false });
    }

    alAvanzar?.('Reemplazando los datos de esta PC...');
    for (const nombre of existentes) {
      if (!nombres.includes(nombre) && !nombre.endsWith(SUFIJO_TEMPORAL)) {
        await db.collection(nombre).drop().catch(() => {});
      }
    }
    for (const nombre of nombres) {
      await db.collection(`${nombre}${SUFIJO_TEMPORAL}`).rename(nombre, { dropTarget: true });
    }
    return { respaldo };
  } finally {
    await cliente.close().catch(() => {});
  }
}
