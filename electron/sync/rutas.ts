// Lo que cada PC le ofrece a las otras PCs de la red por HTTP (las mismas que
// ya sirven a los celulares, en el mismo puerto):
//
//   GET  /api/sync/hola      quién soy y qué PCs conozco
//   GET  /api/sync/cambios   los cambios desde una secuencia (espera si no hay)
//   POST /api/sync/empujar   una PC le manda sus cambios a esta (la que está en
//                            internet y no puede llamarla a ella)
//   POST /api/sync/unirse    otra PC se suma a esta red (con cuenta de admin)
//
// Todo menos "unirse" va firmado con la clave de la red (ver seguridad.ts): sólo
// las PCs que se sumaron con una cuenta de administradora la tienen, y la
// clave misma nunca viaja por la red.
import express, { type Express, type Request, type Response } from 'express';
import { BSON } from 'mongodb';
import type { Aplicador } from './aplicar';
import type { Diario, ItemCambio } from './diario';
import { idDeRed, type HolaSync, type Motor, type ParConfig, type RespuestaEmpuje } from './motor';
import { pruebaDeRespuesta, verificarPedido } from './seguridad';

const MAX_ESPERA_MS = 25_000;
const MAX_LIMITE = 1000;
// Lo más que se acepta en un "empujar" (las PCs mandan de a 300).
const MAX_ITEMS_EMPUJE = 1000;
const MAX_CUERPO_EMPUJE = '40mb';
const ITEMS_PARA_CARGA_GRANDE = 50;

export interface DepsRutasSync {
  diario: Diario;
  motor: Motor;
  aplicador: Aplicador;
  claveRed: () => string;
  yo: () => { idPc: string; nombrePc: string; version: string };
  pares: () => ParConfig[];
  /** Tira un error si la petición no viene de una administradora con sesión. */
  requiereAdmin: (req: Request) => void;
  /** Una PC se sumó a la red: hay que empezar a sincronizar con ella. */
  alUnirse: (par: ParConfig) => void;
  /** Una PC de la red acaba de pedirnos cambios (está en línea). */
  alVerPar: (idPc: string) => void;
}

function enviar(res: Response, cuerpo: unknown, estado = 200): void {
  res.status(estado).type('application/json').send(BSON.EJSON.stringify(cuerpo as Record<string, unknown>, { relaxed: false }));
}

export function registrarRutasSync(app: Express, deps: DepsRutasSync): void {
  // Envuelve cada ruta con el formato { ok, data } / { ok:false, error } del resto de la API.
  function ruta(
    requiereClave: boolean,
    fn: (req: Request) => Promise<unknown> | unknown
  ): (req: Request, res: Response) => Promise<void> {
    return async (req, res) => {
      if (requiereClave) {
        const nonce = verificarPedido(deps.claveRed(), req.headers, req.method, req.originalUrl);
        if (!nonce) {
          enviar(
            res,
            { ok: false, error: 'Esta PC no pertenece a la red (clave incorrecta, o tiene la fecha y la hora mal puestas).' },
            401
          );
          return;
        }
        // La prueba de que quien contesta tiene la clave (ver seguridad.ts).
        res.set('X-Red-Prueba', pruebaDeRespuesta(deps.claveRed(), nonce));
      }
      try {
        enviar(res, { ok: true, data: await fn(req) });
      } catch (err) {
        enviar(res, { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' });
      }
    };
  }

  app.get(
    '/api/sync/hola',
    ruta(true, (): HolaSync => {
      const yo = deps.yo();
      return {
        app: 'mis-amores-gestion',
        idPc: yo.idPc,
        nombrePc: yo.nombrePc,
        idRed: idDeRed(deps.claveRed()),
        version: yo.version,
        epoca: deps.diario.epoca,
        seq: deps.diario.seqActual(),
        pares: deps.pares(),
      };
    })
  );

  app.get(
    '/api/sync/cambios',
    ruta(true, async (req) => {
      const desde = Math.max(0, Math.floor(Number(req.query.desde) || 0));
      const limite = Math.min(MAX_LIMITE, Math.max(1, Math.floor(Number(req.query.limite) || 500)));
      const esperar = Math.min(MAX_ESPERA_MS, Math.max(0, Math.floor(Number(req.query.esperar) || 0)));

      // Quien pide con la clave de la red es una PC de la red: si no la
      // conocíamos, se la anota para empezar a pedirle también.
      const yoPide = typeof req.query.yo === 'string' ? req.query.yo : '';
      const puerto = Math.floor(Number(req.query.puerto) || 0);
      if (yoPide && puerto > 0 && yoPide !== deps.yo().idPc && !deps.pares().some((p) => p.idPc === yoPide)) {
        const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
        const nombre = typeof req.query.nombre === 'string' && req.query.nombre ? req.query.nombre : 'PC del negocio';
        if (ip) deps.alUnirse({ idPc: yoPide, nombre, direccion: `${ip}:${puerto}` });
      } else if (yoPide) {
        deps.alVerPar(yoPide);
      }

      if (esperar > 0) await deps.diario.esperarCambios(desde, esperar);
      const { items, hasta, maxSeq } = await deps.diario.cambiosDesde(desde, limite);
      return { idPc: deps.yo().idPc, epoca: deps.diario.epoca, items, hasta, maxSeq };
    })
  );

  app.get(
    '/api/sync/resumen',
    ruta(true, () => deps.motor.resumen())
  );

  // Otra PC (que no puede ser llamada desde acá) nos manda lo que cambió en
  // ella. Lleva su propia verificación porque la firma cubre el contenido
  // (hay que verla sobre el texto tal cual llegó, antes de interpretarlo).
  app.post('/api/sync/empujar', express.text({ type: () => true, limit: MAX_CUERPO_EMPUJE }), async (req, res) => {
    const cuerpo = typeof req.body === 'string' ? req.body : '';
    const nonce = verificarPedido(deps.claveRed(), req.headers, req.method, req.originalUrl, cuerpo);
    if (!nonce) {
      enviar(
        res,
        { ok: false, error: 'Esta PC no pertenece a la red (clave incorrecta, o tiene la fecha y la hora mal puestas).' },
        401
      );
      return;
    }
    res.set('X-Red-Prueba', pruebaDeRespuesta(deps.claveRed(), nonce));
    try {
      const datos = BSON.EJSON.parse(cuerpo) as { idPc?: unknown; items?: unknown };
      if (!Array.isArray(datos.items)) throw new Error('El pedido no trae cambios.');
      if (datos.items.length > MAX_ITEMS_EMPUJE) throw new Error('Demasiados cambios juntos.');
      const de = typeof datos.idPc === 'string' && datos.idPc ? datos.idPc : 'otra-pc';
      // Una carga grande (la primera vez, o después de que el servidor perdió su
      // base) recalcula el stock una sola vez al final del lote, no por cambio:
      // contra una base lejana, lo otro tardaría muchísimo.
      const r = await deps.aplicador.aplicar(datos.items as ItemCambio[], de, {
        alFinal: datos.items.length >= ITEMS_PARA_CARGA_GRANDE,
      });
      const salida: RespuestaEmpuje = {
        epoca: deps.diario.epoca,
        aplicados: r.aplicados,
        sinCambio: r.sinCambio,
        errores: r.errores,
      };
      if (de !== deps.yo().idPc) deps.alVerPar(de);
      enviar(res, { ok: true, data: salida });
    } catch (err) {
      enviar(res, { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' });
    }
  });

  app.post(
    '/api/sync/unirse',
    ruta(false, (req) => {
      deps.requiereAdmin(req);
      const { idPc, nombrePc, puerto } = (req.body ?? {}) as { idPc?: string; nombrePc?: string; puerto?: number };
      if (!idPc || typeof idPc !== 'string') throw new Error('Faltan los datos de la PC que se suma');
      const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      const yo = deps.yo();
      if (idPc === yo.idPc) throw new Error('Esa es esta misma PC.');
      deps.alUnirse({
        idPc,
        nombre: typeof nombrePc === 'string' && nombrePc ? nombrePc : 'PC del negocio',
        direccion: `${ip}:${Number(puerto) || 4000}`,
      });
      const clave = deps.claveRed();
      return {
        claveRed: clave,
        idRed: idDeRed(clave),
        idPc: yo.idPc,
        nombrePc: yo.nombrePc,
        pares: deps.pares().filter((p) => p.idPc !== idPc),
      };
    })
  );
}
