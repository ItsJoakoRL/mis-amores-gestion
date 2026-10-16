// Sesiones para los clientes que se conectan por HTTP (celulares en la misma
// red WiFi, y la PC "conectada"). A diferencia de la app de escritorio — que
// asume un solo puesto usándose a la vez y guarda la sesión en una sola
// variable (ver electron/session.ts) — acá puede haber varios celulares y
// PCs conectados al mismo tiempo, cada uno con su propio usuario. Por eso
// cada login genera un token random que el cliente guarda y manda en cada pedido.
//
// Las sesiones también se guardan en la base: antes vivían sólo en memoria, y
// cada vez que se reiniciaba la app de la PC (al prenderla, o al instalar una
// actualización) todos los celulares quedaban sin sesión y lo que intentaban
// guardar fallaba con "No hay una sesión iniciada". En la base sólo queda un
// hash del token, nunca el token mismo.
import crypto from 'crypto';
import { getDb } from '../db/database';
import type { SesionActual } from '../../shared/types';

// Una sesión que no se usa en todo este tiempo vence sola (Mongo la borra).
const DIAS_VIGENCIA = 30;
// Para no escribir en la base en cada pedido: la marca de "último uso" se
// actualiza como mucho una vez por día por sesión.
const REFRESCO_USO_MS = 24 * 60 * 60 * 1000;

interface SesionDoc {
  _id: string; // hash del token
  sesion: SesionActual;
  usadoEn: Date;
}

const sesionesPorHash = new Map<string, { sesion: SesionActual; usadoEn: number }>();

function hashDe(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function coleccion() {
  return getDb().collection<SesionDoc>('sesiones');
}

function guardarSinEsperar(promesa: Promise<unknown>) {
  // Si la base no responde justo en ese momento, la sesión igual sigue
  // andando en memoria; sólo se perdería si además se reinicia la app.
  promesa.catch(() => {});
}

// Se llama una vez al arrancar, después de conectar con la base.
export async function cargarSesionesGuardadas(): Promise<void> {
  await coleccion().createIndex({ usadoEn: 1 }, { expireAfterSeconds: DIAS_VIGENCIA * 24 * 60 * 60 });
  const limite = Date.now() - DIAS_VIGENCIA * 24 * 60 * 60 * 1000;
  for (const doc of await coleccion().find().toArray()) {
    const usadoEn = doc.usadoEn instanceof Date ? doc.usadoEn.getTime() : 0;
    if (usadoEn > limite && doc.sesion?.id) sesionesPorHash.set(doc._id, { sesion: doc.sesion, usadoEn });
  }
}

export function crearToken(sesion: SesionActual): string {
  const token = crypto.randomBytes(24).toString('hex');
  const hash = hashDe(token);
  const ahora = new Date();
  sesionesPorHash.set(hash, { sesion, usadoEn: ahora.getTime() });
  guardarSinEsperar(coleccion().insertOne({ _id: hash, sesion, usadoEn: ahora }));
  return token;
}

export function obtenerSesionPorToken(token: string | undefined | null): SesionActual | null {
  if (!token) return null;
  const hash = hashDe(token);
  const guardada = sesionesPorHash.get(hash);
  if (!guardada) return null;
  const ahora = Date.now();
  if (ahora - guardada.usadoEn > REFRESCO_USO_MS) {
    guardada.usadoEn = ahora;
    guardarSinEsperar(coleccion().updateOne({ _id: hash }, { $set: { usadoEn: new Date(ahora) } }));
  }
  return guardada.sesion;
}

export function eliminarToken(token: string | undefined | null): void {
  if (!token) return;
  const hash = hashDe(token);
  sesionesPorHash.delete(hash);
  guardarSinEsperar(coleccion().deleteOne({ _id: hash }));
}

// Se llama desde electron/repositories/usuarios.ts cuando a alguien lo
// desactivan, le cambian el rol o lo borran — para que cualquier sesión de
// celular que ya tuviera abierta deje de funcionar de una, en vez de seguir
// con los datos viejos.
//
// "conservarToken": la sesión desde la que se hizo el cambio (ej. alguien que
// se cambia su propia contraseña) sigue abierta; las demás se cierran.
export function invalidarTokensDeUsuario(usuarioId: string, conservarToken?: string | null): void {
  const conservar = conservarToken ? hashDe(conservarToken) : null;
  for (const [hash, guardada] of sesionesPorHash) {
    if (guardada.sesion.id === usuarioId && hash !== conservar) sesionesPorHash.delete(hash);
  }
  const filtro: Record<string, unknown> = { 'sesion.id': usuarioId };
  if (conservar) filtro._id = { $ne: conservar };
  guardarSinEsperar(coleccion().deleteMany(filtro));
}

// Al sumarse a la red de otra PC, las cuentas de antes dejan de existir: no
// puede quedar ninguna sesión abierta con una cuenta que ya no está.
export function invalidarTodasLasSesiones(): void {
  sesionesPorHash.clear();
  guardarSinEsperar(coleccion().deleteMany({}));
}
