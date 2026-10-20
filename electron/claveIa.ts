// La clave de la IA del asistente (la cuenta de Anthropic que paga las preguntas).
//
// Se guarda en un archivito propio de la carpeta de datos de esta PC, aparte de la
// configuración de la red de PCs (configuracion.ts): así no se pisan entre sí. Cada
// PC tiene la suya. En el servidor de internet (Render) la clave sale de la variable
// MIS_AMORES_CLAVE_IA, porque ahí el disco no sobrevive a un reinicio.
//
// La clave nunca viaja a la pantalla: sólo se muestra una "pista" para reconocerla.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { esModoNube } from './nube';

export interface ClaveIa {
  clave: string;
  origen: 'archivo' | 'entorno';
}

function archivo(): string {
  return path.join(app.getPath('userData'), 'clave-ia.json');
}

// undefined: todavía no se leyó el archivo.
let delArchivo: string | null | undefined;

function leerArchivo(): string | null {
  try {
    const leido = JSON.parse(fs.readFileSync(archivo(), 'utf-8')) as { clave?: unknown };
    return typeof leido.clave === 'string' && leido.clave.trim() ? leido.clave.trim() : null;
  } catch {
    return null;
  }
}

function delEntorno(): string | null {
  return (process.env.MIS_AMORES_CLAVE_IA || process.env.ANTHROPIC_API_KEY || '').trim() || null;
}

/** La clave que hay que usar ahora, o null si no hay ninguna (entonces contesta el asistente simple). */
export function leerClaveIa(): ClaveIa | null {
  if (delArchivo === undefined) delArchivo = leerArchivo();
  if (delArchivo) return { clave: delArchivo, origen: 'archivo' };
  const entorno = delEntorno();
  return entorno ? { clave: entorno, origen: 'entorno' } : null;
}

/** "sk-ant-…a1b2": alcanza para reconocerla sin dejarla a la vista. */
export function pistaDeClave(clave: string): string {
  return clave.length <= 12 ? '…' : `${clave.slice(0, 7)}…${clave.slice(-4)}`;
}

/** Guarda la clave cargada en Configuración, o la saca si viene null. */
export function guardarClaveIa(clave: string | null): void {
  if (esModoNube()) {
    throw new Error('En el servidor de internet la clave se carga en Render (variable MIS_AMORES_CLAVE_IA), no desde acá.');
  }
  if (clave === null) {
    try {
      fs.rmSync(archivo(), { force: true });
    } catch {
      throw new Error('No se pudo borrar la clave guardada en esta PC.');
    }
    delArchivo = null;
    return;
  }
  const limpia = typeof clave === 'string' ? clave.trim() : '';
  if (!limpia) throw new Error('Pegá la clave en el casillero.');
  // Las claves de Anthropic empiezan con "sk-ant-". Una con espacios o saltos de línea adentro
  // es una copia cortada o mezclada con otro texto: mejor avisar ahora que fallar después.
  if (!/^sk-ant-\S{20,}$/.test(limpia)) {
    throw new Error('Esa clave no parece una clave de Anthropic: empieza con "sk-ant-" y no tiene espacios. Copiala entera desde platform.claude.com.');
  }
  try {
    const destino = archivo();
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    // Se escribe aparte y recién al final reemplaza al archivo: si se corta la luz a la mitad, no queda roto.
    const temporal = `${destino}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify({ clave: limpia }), { mode: 0o600 });
    fs.renameSync(temporal, destino);
  } catch {
    throw new Error('No se pudo guardar la clave en esta PC. Probá de nuevo.');
  }
  delArchivo = limpia;
}
