// La conversación entre PCs.
//
// Cada PC de la red mantiene, con cada una de las otras, un "pedido que
// espera": le dice "avisame cuando tengas algo después de la secuencia N" y la
// otra contesta apenas hay un cambio (o a los 20 segundos, para renovar). Con
// lo que llega se aplica (ver aplicar.ts) y se vuelve a pedir. Así un cambio
// aparece en las demás PCs en menos de un segundo, sin internet ni servidor
// central; y si una PC estaba apagada, al volver pide todo lo que se perdió.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BSON } from 'mongodb';
import type { Aplicador } from './aplicar';
import { esDireccionRemota, urlBase } from '../nube';
import { COL_META, COL_PARES, type Diario, type ItemCambio } from './diario';
import { COLECCIONES_REPLICADAS } from './modelo';
import { respuestaEsDeLaRed } from './seguridad';
import { pedirFirmado } from './pedidoFirmado';

export interface ParConfig {
  idPc: string;
  nombre: string;
  direccion: string;
}

/** Lo que cada PC contesta a "¿quién sos?" (con la clave de la red). */
export interface HolaSync {
  app: 'mis-amores-gestion';
  idPc: string;
  nombrePc: string;
  idRed: string;
  version: string;
  epoca: string;
  seq: number;
  pares: ParConfig[];
}

export interface RespuestaCambios {
  idPc: string;
  epoca: string;
  items: ItemCambio[];
  hasta: number;
  maxSeq: number;
}

/** Lo que contesta una PC cuando otra le empuja cambios (ver rutas.ts). */
export interface RespuestaEmpuje {
  epoca: string;
  aplicados: number;
  sinCambio: number;
  errores: number;
}

/** Todo lo que tiene otra PC, bajado y todavía sin aplicar. */
export interface Descarga {
  items: ItemCambio[];
  hasta: number;
  epoca: string;
}

export interface ResumenRed {
  [coleccion: string]: { vivos: number; borrados: number; huella: string };
}

export interface EstadoPar {
  idPc: string;
  nombre: string;
  direccion: string;
  enLinea: boolean;
  ultimaVez: string | null;
  pendientes: number;
  error: string | null;
}

export interface EstadoMotor {
  pares: EstadoPar[];
  /** Hay cambios en camino o recién aplicados. */
  sincronizando: boolean;
  /** Se está trayendo todo por primera vez de otra PC. */
  poniendoseAlDia: boolean;
  progreso: { hecho: number; total: number } | null;
}

export class ErrorDeSync extends Error {
  constructor(
    mensaje: string,
    readonly tipo: 'red' | 'clave' | 'version' | 'otro' = 'otro'
  ) {
    super(mensaje);
  }
}

export function idDeRed(claveRed: string): string {
  return crypto.createHash('sha256').update(`mis-amores-red:${claveRed}`).digest('hex').slice(0, 16);
}

const LIMITE_POR_PEDIDO = 500;
const LIMITE_POR_EMPUJE = 200;
const ESPERA_LARGA_MS = 20_000;
const ESPERA_MAX_FALLOS_MS = 30_000;
const CADA_BUSQUEDA_MS = 60_000;
const CADA_REVISION_MS = 15 * 60_000;

export interface OpcionesMotor {
  diario: Diario;
  aplicador: Aplicador;
  yo: () => { idPc: string; nombrePc: string; version: string };
  /** El puerto donde esta PC atiende a las otras (para que ellas la encuentren). */
  puerto: number;
  claveRed: () => string;
  pares: () => ParConfig[];
  guardarPares: (pares: ParConfig[]) => void;
  carpetaImagenes: string;
  /** Busca en la red las PCs con Mis Amores (con su dirección y su "hola"). */
  buscar: () => Promise<Array<{ direccion: string; hola: HolaSync }>>;
  registrar: (etiqueta: string, detalle: unknown) => void;
  /** El servidor de internet: no llama a nadie (no puede llegar a las PCs del
   * negocio, que están detrás de su router); sólo atiende a las que lo llaman y
   * le empujan sus cambios. */
  soloAtiende?: boolean;
}

interface Bucle {
  par: ParConfig;
  parar: boolean;
  controlador: AbortController | null;
  /** El pedido de "empujar" en curso (sólo con PCs remotas, ver `empujar`). */
  controladorEmpuje: AbortController | null;
  /** Corta la espera entre reintentos (la otra PC acaba de volver). */
  despertar: (() => void) | null;
  despertado: boolean;
}

export class Motor {
  private readonly bucles = new Map<string, Bucle>();
  private readonly estados = new Map<string, EstadoPar>();
  private temporizadorBusqueda: NodeJS.Timeout | null = null;
  private temporizadorRevision: NodeJS.Timeout | null = null;
  private activo = false;
  private aplicandoAhora = 0;
  private progreso: { hecho: number; total: number } | null = null;
  private trayendoTodo = 0;
  private revisando = false;
  // Con qué PCs la revisión no logró dejar todo igual: cuándo volver a probar.
  private readonly sinResolver = new Map<string, { veces: number; proxima: number }>();
  private readonly fotosPendientes = new Map<string, { par: ParConfig; intentos: number }>();

  constructor(private readonly o: OpcionesMotor) {}

  // =================================================================
  // Vida del motor
  // =================================================================

  iniciar(): void {
    if (this.activo) return;
    this.activo = true;
    // El servidor de internet sólo atiende: no busca ni llama a nadie.
    if (this.o.soloAtiende) return;
    for (const par of this.o.pares()) this.arrancarBucle(par);
    this.temporizadorBusqueda = setInterval(() => void this.buscarNuevas(), CADA_BUSQUEDA_MS);
    this.temporizadorRevision = setInterval(() => void this.revisarCoincidencia(), CADA_REVISION_MS);
    setTimeout(() => void this.buscarNuevas(), 3000);
  }

  detener(): void {
    this.activo = false;
    if (this.temporizadorBusqueda) clearInterval(this.temporizadorBusqueda);
    if (this.temporizadorRevision) clearInterval(this.temporizadorRevision);
    for (const b of this.bucles.values()) {
      b.parar = true;
      b.controlador?.abort();
      b.controladorEmpuje?.abort();
    }
    this.bucles.clear();
  }

  /** Suma una PC a la red (si ya estaba, actualiza su dirección). */
  agregarPar(par: ParConfig): void {
    const lista = this.o.pares().filter((p) => p.idPc !== par.idPc);
    lista.push(par);
    this.o.guardarPares(lista);
    const viejo = this.bucles.get(par.idPc);
    if (viejo && viejo.par.direccion !== par.direccion) {
      viejo.parar = true;
      viejo.controlador?.abort();
      viejo.controladorEmpuje?.abort();
      this.bucles.delete(par.idPc);
    }
    if (this.activo) this.arrancarBucle(par);
  }

  /** Deja de sincronizar con esa PC (por ejemplo, una que ya no existe). Si
   * sigue en la red con la misma clave, la búsqueda la vuelve a encontrar. */
  quitarPar(idPc: string): void {
    const bucle = this.bucles.get(idPc);
    if (bucle) {
      bucle.parar = true;
      bucle.controlador?.abort();
      bucle.controladorEmpuje?.abort();
      bucle.despertar?.();
      this.bucles.delete(idPc);
    }
    this.estados.delete(idPc);
    this.o.guardarPares(this.o.pares().filter((p) => p.idPc !== idPc));
    void this.o.diario.db.collection(COL_PARES).deleteOne({ _id: idPc as never });
  }

  /** Esta PC deja de sincronizar con las demás. */
  quitarTodos(): void {
    for (const b of this.bucles.values()) {
      b.parar = true;
      b.controlador?.abort();
      b.controladorEmpuje?.abort();
    }
    this.bucles.clear();
    this.estados.clear();
    this.o.guardarPares([]);
  }

  estado(): EstadoMotor {
    const pares = this.o.pares().map<EstadoPar>(
      (p) =>
        this.estados.get(p.idPc) ?? {
          idPc: p.idPc,
          nombre: p.nombre,
          direccion: p.direccion,
          enLinea: false,
          ultimaVez: null,
          pendientes: 0,
          error: null,
        }
    );
    return {
      pares,
      sincronizando: this.aplicandoAhora > 0 || pares.some((p) => p.enLinea && p.pendientes > 0),
      poniendoseAlDia: this.trayendoTodo > 0,
      progreso: this.progreso,
    };
  }

  // =================================================================
  // El pedido a una PC
  // =================================================================

  async hola(direccion: string, esperaMs = 4000): Promise<HolaSync> {
    return this.pedirJson<HolaSync>(`${urlBase(direccion)}/api/sync/hola`, esperaMs);
  }

  /** `cuerpo`: si se pasa, el pedido es un POST con ese texto (firmado junto con él). */
  private async pedirJson<T>(url: string, esperaMs: number, senal?: AbortSignal, cuerpo?: string): Promise<T> {
    // El pedido va firmado con la clave (que no se manda); la respuesta tiene
    // que traer la prueba de que quien contesta también la tiene.
    const clave = this.o.claveRed();
    // Si el reloj de esta PC (o el de la otra) está corrido, el pedido se
    // repite solo con la hora corregida (ver pedidoFirmado.ts).
    let respuesta: Response;
    let texto: string;
    let nonce: string;
    try {
      ({ respuesta, texto, nonce } = await pedirFirmado({ clave, url, cuerpo, esperaMs, senal }));
    } catch (err) {
      if (senal?.aborted) throw err;
      throw new ErrorDeSync('No se pudo conectar con esa PC.', 'red');
    }
    let json: { ok: boolean; data?: T; error?: string };
    try {
      json = BSON.EJSON.parse(texto) as typeof json;
    } catch {
      // Un servicio de internet que está despertando (o reiniciándose) contesta
      // con una página de error: no es una versión vieja, hay que esperar.
      if (respuesta.status >= 500) {
        throw new ErrorDeSync('El servidor no contestó bien (puede estar despertando). Se vuelve a intentar.', 'red');
      }
      throw new ErrorDeSync('Esa PC tiene una versión de Mis Amores que todavía no sabe sincronizar. Actualizala.', 'version');
    }
    if (!json.ok) {
      throw new ErrorDeSync(json.error ?? 'La otra PC devolvió un error', respuesta.status === 401 ? 'clave' : 'otro');
    }
    if (!respuestaEsDeLaRed(clave, nonce, respuesta.headers.get('x-red-prueba'))) {
      throw new ErrorDeSync('Esa dirección contestó, pero no es una PC de esta red.', 'clave');
    }
    return json.data as T;
  }

  private async pedirCambios(
    par: ParConfig,
    desde: number,
    esperarMs: number,
    senal?: AbortSignal
  ): Promise<RespuestaCambios> {
    // Con quién pide y dónde atiende, la otra PC (que ya sabe que tiene la
    // clave) puede devolver el pedido sin esperar a encontrarnos por la red.
    const yo = this.o.yo();
    const url =
      `${urlBase(par.direccion)}/api/sync/cambios?desde=${desde}&limite=${LIMITE_POR_PEDIDO}` +
      `&esperar=${esperarMs}` +
      `&yo=${encodeURIComponent(yo.idPc)}&puerto=${this.o.puerto}&nombre=${encodeURIComponent(yo.nombrePc)}`;
    return this.pedirJson<RespuestaCambios>(url, esperarMs + 20_000, senal);
  }

  // =================================================================
  // Cursores: hasta qué secuencia de cada PC ya se aplicó
  // =================================================================

  private async leerCursor(idPc: string): Promise<{ seq: number; epoca: string | null }> {
    const doc = await this.o.diario.db.collection<{ _id: string; seq: number; epoca: string }>(COL_PARES).findOne({ _id: idPc });
    return { seq: doc?.seq ?? 0, epoca: doc?.epoca ?? null };
  }

  private async guardarCursor(idPc: string, seq: number, epoca: string): Promise<void> {
    await this.o.diario.db
      .collection<{ _id: string; seq: number; epoca: string }>(COL_PARES)
      .updateOne({ _id: idPc }, { $set: { seq, epoca } }, { upsert: true });
  }

  // El cursor de lo que ESTA PC ya le empujó a una PC remota (ver `empujar`):
  // hasta qué secuencia del diario propio, y contra qué época de la otra.
  private async leerCursorEmpuje(idPc: string): Promise<{ push: number; pushEpoca: string | null; epoca: string | null }> {
    const doc = await this.o.diario.db
      .collection<{ _id: string; push?: number; pushEpoca?: string | null; epoca?: string | null }>(COL_PARES)
      .findOne({ _id: idPc });
    return { push: doc?.push ?? 0, pushEpoca: doc?.pushEpoca ?? null, epoca: doc?.epoca ?? null };
  }

  private async guardarCursorEmpuje(idPc: string, push: number, pushEpoca: string | null): Promise<void> {
    await this.o.diario.db
      .collection<{ _id: string; push: number; pushEpoca: string | null }>(COL_PARES)
      .updateOne({ _id: idPc }, { $set: { push, pushEpoca } }, { upsert: true });
  }

  // =================================================================
  // El bucle de cada PC
  // =================================================================

  private arrancarBucle(par: ParConfig): void {
    if (this.o.soloAtiende) return;
    if (this.bucles.has(par.idPc) || par.idPc === this.o.yo().idPc) return;
    const bucle: Bucle = { par, parar: false, controlador: null, controladorEmpuje: null, despertar: null, despertado: false };
    this.bucles.set(par.idPc, bucle);
    void this.correr(bucle);
    // Una PC de internet no puede llamarnos a nosotras (estamos detrás del
    // router): lo nuestro se lo empujamos.
    if (esDireccionRemota(par.direccion)) void this.empujar(bucle);
  }

  // =================================================================
  // Empujar: llevarle nuestros cambios a una PC de internet
  // =================================================================

  /** El servidor de internet no puede pedirnos cambios (no llega hasta esta
   * PC), así que se los mandamos: lo que haya en nuestro diario después de la
   * última secuencia que ya recibió. Aplicarlo es idempotente: lo que ya tenía
   * (por ejemplo, lo que él mismo nos mandó antes) lo ignora. */
  private async empujar(bucle: Bucle): Promise<void> {
    let fallos = 0;
    while (!bucle.parar && this.activo) {
      try {
        const idPar = bucle.par.idPc;
        let cursor = await this.leerCursorEmpuje(idPar);
        // El servidor empezó de cero (otra época): hay que mandarle todo de nuevo.
        if (cursor.epoca && cursor.pushEpoca && cursor.epoca !== cursor.pushEpoca) {
          await this.guardarCursorEmpuje(idPar, 0, cursor.epoca);
          cursor = { ...cursor, push: 0, pushEpoca: cursor.epoca };
        }

        if (this.o.diario.seqActual() <= cursor.push) {
          await this.o.diario.esperarCambios(cursor.push, ESPERA_LARGA_MS);
          continue;
        }

        const { items, hasta } = await this.o.diario.cambiosDesde(cursor.push, LIMITE_POR_EMPUJE);
        let epocaPar = cursor.pushEpoca ?? cursor.epoca;
        if (items.length > 0) {
          bucle.controladorEmpuje = new AbortController();
          const cuerpo = BSON.EJSON.stringify({ idPc: this.o.yo().idPc, items } as unknown as Record<string, unknown>, {
            relaxed: false,
          });
          const r = await this.pedirJson<RespuestaEmpuje>(
            `${urlBase(bucle.par.direccion)}/api/sync/empujar`,
            90_000,
            bucle.controladorEmpuje.signal,
            cuerpo
          );
          bucle.controladorEmpuje = null;
          if (bucle.parar) break;
          if (r.errores > 0) this.o.registrar('sync', `${r.errores} cambio(s) no se pudieron aplicar en ${bucle.par.nombre}`);
          // Si el servidor cambió de época justo ahora, lo que se mandó cayó en
          // una base nueva: se vuelve a mandar todo desde el principio.
          if (cursor.pushEpoca && r.epoca !== cursor.pushEpoca) {
            await this.guardarCursorEmpuje(idPar, 0, r.epoca);
            continue;
          }
          epocaPar = r.epoca;
        }
        await this.guardarCursorEmpuje(idPar, Math.max(hasta, cursor.push), epocaPar);
        fallos = 0;
      } catch (err) {
        bucle.controladorEmpuje = null;
        if (bucle.parar || !this.activo) break;
        fallos += 1;
        const mensaje = err instanceof Error ? err.message : 'No se pudo enviar';
        if (fallos === 1 || fallos % 20 === 0) this.o.registrar('sync', `${bucle.par.nombre} (enviar): ${mensaje}`);
        await new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** Math.min(fallos, 5), ESPERA_MAX_FALLOS_MS)));
      }
    }
  }

  /** Vuelve a mandarle todo a esa PC de internet (después de una revisión que
   * no coincidía). */
  private async reiniciarEmpuje(idPc: string): Promise<void> {
    await this.o.diario.db.collection(COL_PARES).updateOne({ _id: idPc as never }, { $set: { push: 0 } }, { upsert: true });
  }

  private anotar(par: ParConfig, cambios: Partial<EstadoPar>): void {
    const actual = this.estados.get(par.idPc) ?? {
      idPc: par.idPc,
      nombre: par.nombre,
      direccion: par.direccion,
      enLinea: false,
      ultimaVez: null,
      pendientes: 0,
      error: null,
    };
    this.estados.set(par.idPc, { ...actual, nombre: par.nombre, direccion: par.direccion, ...cambios });
  }

  private async correr(bucle: Bucle): Promise<void> {
    let fallos = 0;
    let alDia = false;
    while (!bucle.parar && this.activo) {
      try {
        bucle.controlador = new AbortController();
        const cursor = await this.leerCursor(bucle.par.idPc);
        const r = await this.pedirCambios(bucle.par, cursor.seq, alDia ? ESPERA_LARGA_MS : 0, bucle.controlador.signal);
        if (bucle.parar) break;

        // Primero, que conteste la PC que se esperaba (si el router le dio esa
        // dirección a otra, no hay que tocar nada de lo anotado de la primera).
        if (r.idPc !== bucle.par.idPc) {
          throw new ErrorDeSync('Esa dirección ahora es de otra PC.', 'otro');
        }
        // La otra PC empezó de cero (se volvió a sumar a la red): se pide todo de nuevo.
        if (cursor.epoca !== null && cursor.epoca !== r.epoca) {
          await this.guardarCursor(bucle.par.idPc, 0, r.epoca);
          alDia = false;
          continue;
        }

        if (r.items.length > 0) {
          this.aplicandoAhora += 1;
          try {
            const res = await this.o.aplicador.aplicar(r.items, bucle.par.idPc);
            if (res.errores > 0) this.o.registrar('sync', `${res.errores} cambio(s) de ${bucle.par.nombre} no se pudieron aplicar`);
            this.pedirFotos(bucle.par, res.fotosFaltantes);
          } finally {
            this.aplicandoAhora -= 1;
          }
        }
        await this.guardarCursor(bucle.par.idPc, Math.max(r.hasta, cursor.seq), r.epoca);
        alDia = r.hasta >= r.maxSeq;
        fallos = 0;
        // Sin avance pero con algo todavía escribiéndose en la otra PC: un respiro.
        if (r.items.length === 0 && r.hasta <= cursor.seq && r.maxSeq > r.hasta) await this.dormir(60, bucle);
        this.anotar(bucle.par, {
          enLinea: true,
          ultimaVez: new Date().toISOString(),
          pendientes: Math.max(0, r.maxSeq - r.hasta),
          error: null,
        });
        void this.bajarFotosPendientes();
      } catch (err) {
        if (bucle.parar || !this.activo) break;
        fallos += 1;
        alDia = false;
        const mensaje = err instanceof Error ? err.message : 'No se pudo hablar con esa PC';
        this.anotar(bucle.par, { enLinea: false, error: mensaje });
        if (fallos === 1 || fallos % 20 === 0) this.o.registrar('sync', `${bucle.par.nombre}: ${mensaje}`);
        // Si cambió de dirección (el router le dio otra IP), se la vuelve a buscar.
        // (Una PC de internet no se "encuentra" en la red del local.)
        if (fallos % 3 === 0 && !esDireccionRemota(bucle.par.direccion)) await this.reencontrar(bucle).catch(() => {});
        await this.dormir(Math.min(1000 * 2 ** Math.min(fallos, 5), ESPERA_MAX_FALLOS_MS), bucle);
        if (bucle.despertado) {
          bucle.despertado = false;
          fallos = 0;
        }
      }
    }
  }

  private dormir(ms: number, bucle: Bucle): Promise<void> {
    return new Promise((resolve) => {
      const listo = () => {
        clearTimeout(t);
        bucle.despertar = null;
        bucle.controlador = null;
        resolve();
      };
      const t = setTimeout(listo, ms);
      bucle.despertar = listo;
      bucle.controlador = new AbortController();
      bucle.controlador.signal.addEventListener('abort', listo);
    });
  }

  /** Esa PC acaba de pedirnos cambios: si la dábamos por caída, se le vuelve
   * a hablar ya, sin esperar el próximo reintento. */
  alVerPar(idPc: string): void {
    const bucle = this.bucles.get(idPc);
    if (!bucle || !bucle.despertar) return;
    bucle.despertado = true;
    bucle.despertar();
  }

  private async reencontrar(bucle: Bucle): Promise<void> {
    const hallazgos = await this.o.buscar();
    const hallada = hallazgos.find((h) => h.hola.idPc === bucle.par.idPc);
    if (hallada && hallada.direccion !== bucle.par.direccion) {
      this.o.registrar('sync', `${bucle.par.nombre} ahora está en ${hallada.direccion}`);
      const par: ParConfig = { idPc: bucle.par.idPc, nombre: hallada.hola.nombrePc, direccion: hallada.direccion };
      bucle.par = par;
      const lista = this.o.pares().map((p) => (p.idPc === par.idPc ? par : p));
      this.o.guardarPares(lista);
    }
  }

  // =================================================================
  // Encontrar PCs nuevas de la misma red
  // =================================================================

  private buscandoNuevas = false;

  async buscarNuevas(): Promise<void> {
    if (!this.activo || this.o.soloAtiende || this.buscandoNuevas) return;
    this.buscandoNuevas = true;
    try {
      const yo = this.o.yo().idPc;
      const conocidas = new Set(this.o.pares().map((p) => p.idPc));
      for (const { direccion, hola } of await this.o.buscar()) {
        if (hola.idPc === yo) continue;
        if (!conocidas.has(hola.idPc)) {
          this.o.registrar('sync', `PC nueva en la red: ${hola.nombrePc} (${direccion})`);
          this.agregarPar({ idPc: hola.idPc, nombre: hola.nombrePc, direccion });
          conocidas.add(hola.idPc);
        }
        // Las PCs que esa PC conoce y yo no.
        for (const p of hola.pares ?? []) {
          if (p.idPc === yo || conocidas.has(p.idPc)) continue;
          try {
            // Un servidor de internet gratuito que está dormido tarda hasta un
            // minuto en despertar: con 3 segundos nunca se lo alcanzaba.
            const h = await this.hola(p.direccion, esDireccionRemota(p.direccion) ? 90_000 : 3000);
            if (h.idPc === p.idPc) {
              this.agregarPar({ idPc: h.idPc, nombre: h.nombrePc, direccion: p.direccion });
              conocidas.add(h.idPc);
            }
          } catch {
            // Todavía no se la alcanza: otra vuelta.
          }
        }
      }
    } catch (err) {
      this.o.registrar('sync-buscar', err);
    } finally {
      this.buscandoNuevas = false;
    }
  }

  // =================================================================
  // Traer todo (primera vez, o cuando algo no coincide)
  // =================================================================

  /** Un pedido que aguanta un corte de red pasajero (unos reintentos). */
  private async pedirCambiosConReintentos(par: ParConfig, desde: number): Promise<RespuestaCambios> {
    let ultimo: unknown;
    for (let intento = 0; intento < 4; intento++) {
      try {
        return await this.pedirCambios(par, desde, 0);
      } catch (err) {
        ultimo = err;
        if (err instanceof ErrorDeSync && (err.tipo === 'clave' || err.tipo === 'version')) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** intento));
      }
    }
    throw ultimo;
  }

  /** Baja TODO lo que tiene esa PC (de la secuencia 0 en adelante) a memoria,
   * sin tocar nada de esta. Así, si se corta a la mitad, no se perdió nada:
   * recién con la descarga completa se reemplazan los datos de esta PC. */
  async descargarTodo(par: ParConfig): Promise<Descarga> {
    this.trayendoTodo += 1;
    this.progreso = { hecho: 0, total: 0 };
    try {
      const items: ItemCambio[] = [];
      let desde = 0;
      let epoca = '';
      for (let vueltas = 0; vueltas < 100_000; vueltas++) {
        const r = await this.pedirCambiosConReintentos(par, desde);
        epoca = r.epoca;
        items.push(...r.items);
        this.progreso = { hecho: r.hasta, total: r.maxSeq };
        if (r.hasta === desde || r.hasta >= r.maxSeq) {
          desde = Math.max(desde, r.hasta);
          break;
        }
        desde = r.hasta;
      }
      return { items, hasta: desde, epoca };
    } finally {
      this.trayendoTodo -= 1;
      if (this.trayendoTodo === 0) this.progreso = null;
    }
  }

  /** Aplica una descarga completa en esta PC. */
  async aplicarDescarga(par: ParConfig, descarga: Descarga): Promise<{ aplicados: number }> {
    this.trayendoTodo += 1;
    let aplicados = 0;
    try {
      const total = descarga.items.length;
      for (let i = 0; i < total; i += LIMITE_POR_PEDIDO) {
        this.progreso = { hecho: i, total };
        this.aplicandoAhora += 1;
        try {
          const res = await this.o.aplicador.aplicar(descarga.items.slice(i, i + LIMITE_POR_PEDIDO), par.idPc, {
            alFinal: true,
          });
          aplicados += res.aplicados;
          this.pedirFotos(par, res.fotosFaltantes);
        } finally {
          this.aplicandoAhora -= 1;
        }
      }
      const actual = await this.leerCursor(par.idPc);
      if (actual.epoca !== descarga.epoca || descarga.hasta > actual.seq) {
        await this.guardarCursor(par.idPc, descarga.hasta, descarga.epoca);
      }
      await this.bajarFotosPendientes();
      return { aplicados };
    } finally {
      this.trayendoTodo -= 1;
      if (this.trayendoTodo === 0) this.progreso = null;
    }
  }

  /** Pide a esa PC todo lo que tiene y lo aplica, página por página (sin
   * vaciar nada antes ni tener todo en memoria). */
  async traerTodo(par: ParConfig): Promise<{ aplicados: number }> {
    this.trayendoTodo += 1;
    this.progreso = { hecho: 0, total: 0 };
    let aplicados = 0;
    try {
      let desde = 0;
      let epoca = '';
      for (let vueltas = 0; vueltas < 100_000; vueltas++) {
        const r = await this.pedirCambiosConReintentos(par, desde);
        epoca = r.epoca;
        if (r.items.length > 0) {
          this.aplicandoAhora += 1;
          try {
            const res = await this.o.aplicador.aplicar(r.items, par.idPc, { alFinal: true });
            aplicados += res.aplicados;
            this.pedirFotos(par, res.fotosFaltantes);
          } finally {
            this.aplicandoAhora -= 1;
          }
        }
        this.progreso = { hecho: r.hasta, total: r.maxSeq };
        if (r.hasta === desde || r.hasta >= r.maxSeq) {
          desde = Math.max(desde, r.hasta);
          break;
        }
        desde = r.hasta;
      }
      const actual = await this.leerCursor(par.idPc);
      if (actual.epoca !== epoca || desde > actual.seq) await this.guardarCursor(par.idPc, desde, epoca);
      await this.bajarFotosPendientes();
      return { aplicados };
    } finally {
      this.trayendoTodo -= 1;
      if (this.trayendoTodo === 0) this.progreso = null;
    }
  }

  // =================================================================
  // Revisar que todas las PCs tengan lo mismo
  // =================================================================

  /** Una "foto" del estado de esta PC: cuántos documentos hay y una huella de
   * sus marcas. Dos PCs al día dan la misma. */
  async resumen(): Promise<ResumenRed> {
    const salida: ResumenRed = {};
    for (const c of COLECCIONES_REPLICADAS) {
      const hash = crypto.createHash('sha1');
      let vivos = 0;
      let borrados = 0;
      const cursor = this.o.diario.db
        .collection(COL_META)
        .find({ c }, { projection: { inc: 1, del: 1, clocks: 1 } })
        .sort({ _id: 1 });
      let hechos = 0;
      for await (const m of cursor) {
        const clocks = m.clocks as Record<string, string> | undefined;
        const marcas = clocks ? Object.keys(clocks).sort().map((k) => `${k}=${clocks[k]}`).join(',') : '';
        if (m.del) borrados += 1;
        else vivos += 1;
        hash.update(`${m._id}|${m.inc}|${m.del ?? ''}|${m.del ? '' : marcas}\n`);
        // Con muchos datos, de a ratos se le da el paso al resto de la app
        // (la pantalla y los celulares).
        hechos += 1;
        if (hechos % 2000 === 0) await new Promise<void>((r) => setImmediate(r));
      }
      salida[c] = { vivos, borrados, huella: hash.digest('hex').slice(0, 16) };
    }
    return salida;
  }

  private iguales(a: ResumenRed, b: ResumenRed): boolean {
    // Sólo lo que las dos conocen: una PC con una versión más vieja puede no
    // tener alguna colección nueva.
    return COLECCIONES_REPLICADAS.every(
      (c) => !a[c] || !b[c] || (a[c].huella === b[c].huella && a[c].vivos === b[c].vivos)
    );
  }

  /** Compara con cada PC en línea; si no coincide (y sigue sin coincidir un
   * momento después, por si había cambios en camino) vuelve a traer todo.
   * `forzar`: no espera ese momento ni respeta el "volver a probar más tarde". */
  async revisarCoincidencia(forzar = false): Promise<{ revisadas: number; corregidas: number }> {
    if (this.revisando) return { revisadas: 0, corregidas: 0 };
    this.revisando = true;
    let revisadas = 0;
    let corregidas = 0;
    try {
      for (const par of this.o.pares()) {
        const estado = this.estados.get(par.idPc);
        if (!estado?.enLinea) continue;
        const pendiente = this.sinResolver.get(par.idPc);
        if (!forzar && pendiente && Date.now() < pendiente.proxima) continue;
        try {
          const url = `${urlBase(par.direccion)}/api/sync/resumen`;
          const suyo = await this.pedirJson<ResumenRed>(url, 15_000);
          revisadas += 1;
          if (this.iguales(await this.resumen(), suyo)) {
            this.sinResolver.delete(par.idPc);
            continue;
          }
          if (!forzar) {
            await new Promise((r) => setTimeout(r, 20_000));
            const otraVez = await this.pedirJson<ResumenRed>(url, 15_000);
            if (this.iguales(await this.resumen(), otraVez)) {
              this.sinResolver.delete(par.idPc);
              continue;
            }
          }
          this.o.registrar('sync', `Revisión: lo de ${par.nombre} no coincide, se vuelve a traer todo`);
          await this.traerTodo(par);
          // Si es el servidor de internet, también se le vuelve a mandar todo lo
          // nuestro (puede ser lo que le falte a él).
          if (esDireccionRemota(par.direccion)) await this.reiniciarEmpuje(par.idPc);
          // ¿Quedó resuelto? Si no (algo que no se puede aplicar), no se vuelve a
          // bajar todo cada pocos minutos: se espera cada vez más.
          const despues = await this.pedirJson<ResumenRed>(url, 15_000);
          if (this.iguales(await this.resumen(), despues)) {
            this.sinResolver.delete(par.idPc);
            corregidas += 1;
          } else {
            const veces = (pendiente?.veces ?? 0) + 1;
            this.sinResolver.set(par.idPc, {
              veces,
              proxima: Date.now() + Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** (veces - 1)),
            });
            if (veces === 3) {
              void this.o.diario
                .avisar(
                  `Esta PC y "${par.nombre}" siguen teniendo alguna diferencia que no se pudo resolver sola. ` +
                    'No se perdió nada de lo cargado; si ves algo raro, avisá.'
                )
                .catch(() => {});
            }
          }
        } catch (err) {
          this.o.registrar('sync-revision', err);
        }
      }
    } finally {
      this.revisando = false;
    }
    return { revisadas, corregidas };
  }

  // =================================================================
  // Fotos de los productos
  // =================================================================

  private pedirFotos(par: ParConfig, nombres: string[]): void {
    for (const nombre of nombres) {
      if (!this.fotosPendientes.has(nombre)) this.fotosPendientes.set(nombre, { par, intentos: 0 });
    }
  }

  private async bajarFotosPendientes(): Promise<void> {
    for (const [nombre, pedido] of [...this.fotosPendientes]) {
      const destino = path.join(this.o.carpetaImagenes, nombre);
      if (fs.existsSync(destino)) {
        this.fotosPendientes.delete(nombre);
        continue;
      }
      try {
        const r = await fetch(`${urlBase(pedido.par.direccion)}/imagenes/${encodeURIComponent(nombre)}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        fs.mkdirSync(this.o.carpetaImagenes, { recursive: true });
        fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
        this.fotosPendientes.delete(nombre);
      } catch {
        pedido.intentos += 1;
        // Una foto que no está en ninguna PC no tiene que reintentarse para siempre.
        if (pedido.intentos >= 10) this.fotosPendientes.delete(nombre);
      }
    }
  }
}
