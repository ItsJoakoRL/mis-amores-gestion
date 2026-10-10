// Qué rol tiene esta PC en el negocio: "principal" (tiene la base de datos,
// como siempre) o "conectada" (usa la de otra PC de la red). Se guarda en un
// archivito en la carpeta de datos de la app, que las actualizaciones no tocan.
import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ModoPc } from '../shared/types';

export interface ConfiguracionPc {
  /** Identificador propio de esta PC, para reconocerla en la red (y que no
   * se conecte a sí misma ni se confunda de PC si cambia la IP). */
  idPc: string;
  modo: ModoPc;
  /** Sólo en modo conectada: dónde está la PC principal ("192.168.1.50:4000"). */
  direccionPrincipal: string | null;
  /** El idPc de la principal — si cambia de IP, se la vuelve a encontrar por esto. */
  idPrincipal: string | null;
  nombrePrincipal: string | null;
}

function archivo(): string {
  return path.join(app.getPath('userData'), 'configuracion-pc.json');
}

let enMemoria: ConfiguracionPc | null = null;

export function leerConfiguracion(): ConfiguracionPc {
  if (enMemoria) return enMemoria;
  let leida: Partial<ConfiguracionPc> = {};
  try {
    leida = JSON.parse(fs.readFileSync(archivo(), 'utf-8')) as Partial<ConfiguracionPc>;
  } catch {
    // Primera vez (o archivo roto): arranca como principal, que es lo de siempre.
  }
  const conectada = leida.modo === 'conectada' && typeof leida.direccionPrincipal === 'string' && leida.direccionPrincipal;
  enMemoria = {
    idPc: typeof leida.idPc === 'string' && leida.idPc ? leida.idPc : crypto.randomUUID(),
    modo: conectada ? 'conectada' : 'principal',
    direccionPrincipal: conectada ? leida.direccionPrincipal! : null,
    idPrincipal: conectada && typeof leida.idPrincipal === 'string' ? leida.idPrincipal : null,
    nombrePrincipal: conectada && typeof leida.nombrePrincipal === 'string' ? leida.nombrePrincipal : null,
  };
  if (!leida.idPc) guardarConfiguracion(enMemoria);
  return enMemoria;
}

export function guardarConfiguracion(config: ConfiguracionPc): void {
  enMemoria = config;
  try {
    fs.mkdirSync(path.dirname(archivo()), { recursive: true });
    fs.writeFileSync(archivo(), JSON.stringify(config, null, 2));
  } catch {
    // Si no se pudo escribir, al menos queda en memoria hasta que se cierre la app.
  }
}
