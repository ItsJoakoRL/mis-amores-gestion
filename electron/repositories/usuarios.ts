import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getDb } from '../db/database';
import { invalidarTokensDeUsuario } from '../server/tokenSessions';
import type { CuentaPublica, Genero, Rol, Usuario } from '../../shared/types';

const LARGO_MINIMO_PASSWORD = 4;

function validarLargoPassword(password: string): void {
  if (password.length < LARGO_MINIMO_PASSWORD) {
    throw new Error(`La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
  }
}

// Freno contra fuerza bruta: después de varios intentos fallidos seguidos
// para el mismo usuario, se bloquean los intentos siguientes un rato —
// aplica tanto al login de escritorio como al del celular (ambos pasan por
// acá). Vive en memoria nada más: si se reinicia la app, se resetea solo.
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const intentosFallidos = new Map<string, { cantidad: number; bloqueadoHasta: number }>();

interface UsuarioDoc {
  _id: ObjectId;
  nombre: string;
  usuario: string;
  passwordHash: string;
  rol: Rol;
  genero: Genero;
  activo: boolean;
}

function coleccion() {
  return getDb().collection<UsuarioDoc>('usuarios');
}

function mapDoc(doc: UsuarioDoc): Usuario {
  return {
    id: doc._id.toHexString(),
    nombre: doc.nombre,
    usuario: doc.usuario,
    rol: doc.rol,
    // Cuentas creadas antes de agregar este campo no lo tienen guardado —
    // "F" como default es sólo para no romper con datos viejos.
    genero: doc.genero ?? 'F',
    activo: doc.activo,
  };
}

function esErrorDuplicado(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export async function verificarCredenciales(usuario: string, password: string): Promise<Usuario | null> {
  const clave = usuario.trim().toLowerCase();
  const estado = intentosFallidos.get(clave);
  if (estado && estado.bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((estado.bloqueadoHasta - Date.now()) / 60000);
    throw new Error(`Demasiados intentos fallidos. Probá de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`);
  }

  const doc = await coleccion().findOne({ usuario });
  const ok = doc && doc.activo && bcrypt.compareSync(password, doc.passwordHash);

  if (!ok) {
    const cantidad = (estado?.cantidad ?? 0) + 1;
    intentosFallidos.set(clave, {
      cantidad,
      bloqueadoHasta: cantidad >= MAX_INTENTOS ? Date.now() + BLOQUEO_MS : 0,
    });
    return null;
  }

  intentosFallidos.delete(clave);
  return mapDoc(doc);
}

export async function getUsuario(id: string): Promise<Usuario | null> {
  if (!ObjectId.isValid(id)) return null;
  const doc = await coleccion().findOne({ _id: new ObjectId(id) });
  return doc ? mapDoc(doc) : null;
}

export async function listUsuarios(): Promise<Usuario[]> {
  const docs = await coleccion().find().sort({ nombre: 1 }).toArray();
  return docs.map(mapDoc);
}

// Se muestra en la pantalla de login, antes de iniciar sesión — por eso sólo
// devuelve lo justo para elegir la cuenta (nada de passwordHash) y sólo las
// activas.
export async function listCuentasPublicas(): Promise<CuentaPublica[]> {
  const docs = await coleccion().find({ activo: true }).sort({ nombre: 1 }).toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    nombre: doc.nombre,
    usuario: doc.usuario,
    rol: doc.rol,
    genero: doc.genero ?? 'F',
  }));
}

export async function crearUsuario(
  nombre: string,
  usuario: string,
  password: string,
  rol: Rol,
  genero: Genero
): Promise<Usuario> {
  validarLargoPassword(password);
  const nombreLimpio = nombre.trim();
  const usuarioLimpio = usuario.trim();
  const passwordHash = bcrypt.hashSync(password, 10);
  try {
    const result = await coleccion().insertOne({
      nombre: nombreLimpio,
      usuario: usuarioLimpio,
      passwordHash,
      rol,
      genero,
      activo: true,
    } as UsuarioDoc);
    return {
      id: result.insertedId.toHexString(),
      nombre: nombreLimpio,
      usuario: usuarioLimpio,
      rol,
      genero,
      activo: true,
    };
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un usuario con ese nombre de usuario');
    throw err;
  }
}

// Evita que la única admin activa se quede sin poder administrar usuarios
// (por sacarse el rol ella misma, o por desactivar su propia cuenta) — no
// habría forma de volver atrás desde la UI si eso pasara.
async function esUnicaAdminActiva(id: string): Promise<boolean> {
  const doc = await coleccion().findOne({ _id: new ObjectId(id) });
  if (!doc || doc.rol !== 'admin' || !doc.activo) return false;
  const otrasAdmins = await coleccion().countDocuments({
    _id: { $ne: new ObjectId(id) },
    rol: 'admin',
    activo: true,
  });
  return otrasAdmins === 0;
}

export async function actualizarUsuario(
  id: string,
  nombre: string,
  usuario: string,
  rol: Rol,
  genero: Genero
): Promise<Usuario> {
  if (rol !== 'admin' && (await esUnicaAdminActiva(id))) {
    throw new Error('No se le puede sacar el rol de administradora: es la única activa. Creá otra admin antes.');
  }
  const nombreLimpio = nombre.trim();
  const usuarioLimpio = usuario.trim();
  try {
    await coleccion().updateOne(
      { _id: new ObjectId(id) },
      { $set: { nombre: nombreLimpio, usuario: usuarioLimpio, rol, genero } }
    );
  } catch (err) {
    if (esErrorDuplicado(err)) throw new Error('Ya existe un usuario con ese nombre de usuario');
    throw err;
  }
  const doc = await coleccion().findOne({ _id: new ObjectId(id) });
  if (!doc) throw new Error('El usuario no existe');
  // Si le cambiaron el rol (u otro dato), cualquier sesión de celular que ya
  // tuviera abierta queda con datos viejos cacheados — se cierra para que
  // tenga que volver a entrar y traiga los datos nuevos.
  invalidarTokensDeUsuario(id);
  return mapDoc(doc);
}

export async function setUsuarioActivo(id: string, activo: boolean): Promise<void> {
  if (!activo && (await esUnicaAdminActiva(id))) {
    throw new Error('No se puede desactivar: es la única administradora activa.');
  }
  await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: { activo } });
  // Si se la desactivó, cualquier sesión de celular que ya tuviera abierta
  // (con el rol/acceso de cuando todavía estaba activa) deja de funcionar
  // de una, en vez de seguir funcionando hasta que se reinicie la app.
  if (!activo) invalidarTokensDeUsuario(id);
}

export async function resetPassword(id: string, password: string): Promise<void> {
  validarLargoPassword(password);
  const passwordHash = bcrypt.hashSync(password, 10);
  await coleccion().updateOne({ _id: new ObjectId(id) }, { $set: { passwordHash } });
}

// Borrado definitivo — a diferencia de desactivar (que sólo le bloquea el
// login), esto saca a la persona de la lista para siempre. Las ventas y
// pagos que ya registró quedan igual en el historial, sólo que sin poder
// mostrar su nombre (el mismo comportamiento que ya tenía un usuario
// desactivado al hacer los $lookup contra la colección de usuarios).
export async function eliminarUsuario(id: string): Promise<void> {
  if (await esUnicaAdminActiva(id)) {
    throw new Error('No se puede eliminar: es la única administradora activa. Creá otra admin antes.');
  }
  await coleccion().deleteOne({ _id: new ObjectId(id) });
  invalidarTokensDeUsuario(id);
}
