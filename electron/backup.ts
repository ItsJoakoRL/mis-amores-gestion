// Respaldo automático de la base local: una vez por día, guarda una copia de
// todas las colecciones en JSON (mismo formato que scripts/exportar-base.js,
// para poder restaurar con scripts/importar-base.js si hiciera falta). Cada
// PC respalda su propia base — no reemplaza tener los datos reales
// sincronizados entre PCs, pero evita perder todo si algo le pasa a esta.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { EJSON } from 'bson';
import type { Db } from 'mongodb';
import { getDb } from './db/database';

const DIAS_A_CONSERVAR = 14;

// (Con MIS_AMORES_CARPETA_RESPALDOS se puede elegir otra, para que las pruebas
// no escriban en los respaldos reales.)
export function carpetaRespaldos(): string {
  const otra = process.env.MIS_AMORES_CARPETA_RESPALDOS;
  return otra ? path.resolve(otra) : path.join(app.getPath('documents'), 'Mis Amores - Respaldos');
}

function hoyYMD(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

// Guarda cada colección de una base en un .json dentro de la carpeta. Recibe
// la base porque a veces hay que respaldar una que esta app no tiene abierta
// (ej. al cargar una copia guardada; ver replica.ts).
export async function respaldarBase(db: Db, carpetaDestino: string): Promise<number> {
  fs.mkdirSync(carpetaDestino, { recursive: true });

  // El diario de sincronización (_sync_*) no es un dato del negocio: se
  // rearma solo, y en un respaldo sólo estorbaría al restaurar.
  const colecciones = (await db.listCollections().toArray()).filter((c) => !c.name.startsWith('_sync_'));
  let totalDocs = 0;
  for (const { name } of colecciones) {
    const docs = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(carpetaDestino, `${name}.json`), EJSON.stringify(docs));
    totalDocs += docs.length;
  }
  return totalDocs;
}

async function hacerRespaldo(carpetaDestino: string): Promise<number> {
  return respaldarBase(getDb(), carpetaDestino);
}

// Borra las carpetas de fecha más viejas que DIAS_A_CONSERVAR — sin esto, los
// respaldos se acumularían para siempre.
function limpiarRespaldosViejos(carpetaBase: string) {
  if (!fs.existsSync(carpetaBase)) return;
  const carpetas = fs
    .readdirSync(carpetaBase, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  const aBorrar = carpetas.slice(0, Math.max(0, carpetas.length - DIAS_A_CONSERVAR));
  for (const nombre of aBorrar) {
    fs.rmSync(path.join(carpetaBase, nombre), { recursive: true, force: true });
  }
}

// Un respaldo fuera del diario, con nombre propio (ej. justo antes de juntar
// los datos de otra PC) — no lo borra la limpieza de los 14 días, que sólo
// toca las carpetas con nombre de fecha.
export async function respaldoExtra(nombre: string): Promise<string> {
  const carpeta = path.join(carpetaRespaldos(), nombre);
  await hacerRespaldo(carpeta);
  return carpeta;
}

// Si hoy todavía no se hizo el respaldo diario, lo hace. Pensado para llamar
// una vez al arrancar la app y, para las que quedan prendidas muchas horas
// (la de la bandeja), también cada tanto — ver main.ts.
export async function respaldarSiCorresponde(): Promise<void> {
  const base = carpetaRespaldos();
  const carpetaHoy = path.join(base, hoyYMD());
  if (fs.existsSync(carpetaHoy)) return;

  // Se arma en una carpeta temporal y recién al final se le pone el nombre
  // del día: antes, si algo cortaba el respaldo a la mitad (se apagó la PC,
  // disco lleno), la carpeta de hoy quedaba creada con la mitad de los datos
  // y como "ya existía", no se volvía a intentar hasta el día siguiente.
  const carpetaTemporal = `${carpetaHoy}.incompleto`;
  fs.rmSync(carpetaTemporal, { recursive: true, force: true });
  await hacerRespaldo(carpetaTemporal);
  fs.renameSync(carpetaTemporal, carpetaHoy);
  limpiarRespaldosViejos(base);
}
