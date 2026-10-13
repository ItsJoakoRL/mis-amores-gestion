// Cómo se relaciona esta PC con las demás del negocio. Se guarda en un
// archivito en la carpeta de datos de la app, que las actualizaciones no tocan.
//
// Todas las PCs son iguales: cada una tiene su base completa y se mantiene al
// día con las otras (ver electron/sync). Lo único que hace falta saber acá es
// con quiénes se habla ("pares") y la clave de la red que los reconoce.
import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface ParGuardado {
  idPc: string;
  nombre: string;
  /** "192.168.1.50:4000" */
  direccion: string;
}

export interface ConfiguracionPc {
  /** Identificador propio de esta PC, para reconocerla en la red (y que no
   * se confunda de PC si le cambia la IP). */
  idPc: string;
  /** La clave que comparten las PCs del negocio. null: todavía no tiene (se
   * crea al arrancar, o se recibe al sumarse a la red de otra PC). */
  claveRed: string | null;
  /** Las otras PCs de la red. */
  pares: ParGuardado[];
  /** 'traer': esta PC venía "conectada" a otra con la versión anterior y su
   * base propia no sirve: al arrancar tiene que traer todos los datos de la red
   * (con un respaldo de lo que tuviera). */
  inicial: 'listo' | 'traer';
  /** Si venía conectada a otra PC (versión anterior), cuál: sirve para
   * ofrecer sumarse a su red si no se pudo hacer solo. */
  direccionAnterior: string | null;
  nombreAnterior: string | null;
}

function archivo(): string {
  return path.join(app.getPath('userData'), 'configuracion-pc.json');
}

let enMemoria: ConfiguracionPc | null = null;

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

export function leerConfiguracion(): ConfiguracionPc {
  if (enMemoria) return enMemoria;
  let leida: Record<string, unknown> = {};
  let existia = true;
  try {
    leida = JSON.parse(fs.readFileSync(archivo(), 'utf-8')) as Record<string, unknown>;
  } catch {
    existia = false;
  }

  const config: ConfiguracionPc = {
    idPc: esTexto(leida.idPc) ? leida.idPc : crypto.randomUUID(),
    claveRed: esTexto(leida.claveRed) ? leida.claveRed : null,
    pares: [],
    inicial: leida.inicial === 'traer' ? 'traer' : 'listo',
    direccionAnterior: esTexto(leida.direccionAnterior) ? leida.direccionAnterior : null,
    nombreAnterior: esTexto(leida.nombreAnterior) ? leida.nombreAnterior : null,
  };

  if (Array.isArray(leida.pares)) {
    for (const p of leida.pares as Array<Record<string, unknown>>) {
      if (p && esTexto(p.idPc) && esTexto(p.direccion)) {
        config.pares.push({ idPc: p.idPc, nombre: esTexto(p.nombre) ? p.nombre : 'PC del negocio', direccion: p.direccion });
      }
    }
  }

  // Versión anterior: la PC estaba "conectada" a una principal. Pasa a ser una
  // más de la red de esa PC; la clave de copia que tenía es la clave de la red.
  if (leida.modo === 'conectada' && esTexto(leida.direccionPrincipal)) {
    const nombre = esTexto(leida.nombrePrincipal) ? leida.nombrePrincipal : 'la otra PC';
    config.direccionAnterior = leida.direccionPrincipal;
    config.nombreAnterior = nombre;
    if (esTexto(leida.claveCopia)) {
      config.claveRed = leida.claveCopia;
      // Sin el identificador de la otra PC no se la puede anotar como par: se
      // la busca por su dirección anterior (ver direccionesCandidatas).
      if (esTexto(leida.idPrincipal)) {
        config.pares = [{ idPc: leida.idPrincipal, nombre, direccion: leida.direccionPrincipal }];
      }
      config.inicial = 'traer';
    }
  }

  enMemoria = config;
  const cambioDeFormato = 'modo' in leida || 'generacion' in leida || 'direccionPrincipal' in leida;
  if (!existia || !esTexto(leida.idPc) || cambioDeFormato) guardarConfiguracion(config);
  return config;
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
