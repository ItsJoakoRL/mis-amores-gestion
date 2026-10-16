"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarRutasSync = registrarRutasSync;
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
const express_1 = __importDefault(require("express"));
const mongodb_1 = require("mongodb");
const motor_1 = require("./motor");
const seguridad_1 = require("./seguridad");
const MAX_ESPERA_MS = 25000;
const MAX_LIMITE = 1000;
// Lo más que se acepta en un "empujar" (las PCs mandan de a 300).
const MAX_ITEMS_EMPUJE = 1000;
const MAX_CUERPO_EMPUJE = '40mb';
const ITEMS_PARA_CARGA_GRANDE = 50;
const MENSAJE_CLAVE = 'Esta PC no pertenece a la red (la clave no coincide).';
const MENSAJE_HORA = 'La fecha y la hora de la PC que pide no coinciden con las de esta (difieren más de un día): hay que ponerlas bien en esa PC.';
/** El rechazo de un pedido sin firma válida. Va con la hora de esta PC (X-Red-Hora)
 * para que la otra pueda corregir su reloj y repetir el pedido (ver pedidoFirmado.ts). */
function rechazar(req, res, clave, cuerpo) {
    const motivo = (0, seguridad_1.motivoDeRechazo)(clave, req.headers, req.method, req.originalUrl, cuerpo);
    res.set('X-Red-Hora', String(Date.now()));
    enviar(res, { ok: false, error: motivo === 'hora' ? MENSAJE_HORA : MENSAJE_CLAVE }, 401);
}
function enviar(res, cuerpo, estado = 200) {
    res.status(estado).type('application/json').send(mongodb_1.BSON.EJSON.stringify(cuerpo, { relaxed: false }));
}
function registrarRutasSync(app, deps) {
    // Envuelve cada ruta con el formato { ok, data } / { ok:false, error } del resto de la API.
    function ruta(requiereClave, fn) {
        return async (req, res) => {
            if (requiereClave) {
                const nonce = (0, seguridad_1.verificarPedido)(deps.claveRed(), req.headers, req.method, req.originalUrl);
                if (!nonce) {
                    rechazar(req, res, deps.claveRed());
                    return;
                }
                // La prueba de que quien contesta tiene la clave (ver seguridad.ts).
                res.set('X-Red-Prueba', (0, seguridad_1.pruebaDeRespuesta)(deps.claveRed(), nonce));
            }
            try {
                enviar(res, { ok: true, data: await fn(req) });
            }
            catch (err) {
                enviar(res, { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' });
            }
        };
    }
    app.get('/api/sync/hola', ruta(true, () => {
        const yo = deps.yo();
        return {
            app: 'mis-amores-gestion',
            idPc: yo.idPc,
            nombrePc: yo.nombrePc,
            idRed: (0, motor_1.idDeRed)(deps.claveRed()),
            version: yo.version,
            epoca: deps.diario.epoca,
            seq: deps.diario.seqActual(),
            pares: deps.pares(),
        };
    }));
    app.get('/api/sync/cambios', ruta(true, async (req) => {
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
            if (ip)
                deps.alUnirse({ idPc: yoPide, nombre, direccion: `${ip}:${puerto}` });
        }
        else if (yoPide) {
            deps.alVerPar(yoPide);
        }
        if (esperar > 0)
            await deps.diario.esperarCambios(desde, esperar);
        const { items, hasta, maxSeq } = await deps.diario.cambiosDesde(desde, limite);
        return { idPc: deps.yo().idPc, epoca: deps.diario.epoca, items, hasta, maxSeq };
    }));
    app.get('/api/sync/resumen', ruta(true, () => deps.motor.resumen()));
    // Otra PC (que no puede ser llamada desde acá) nos manda lo que cambió en
    // ella. Lleva su propia verificación porque la firma cubre el contenido
    // (hay que verla sobre el texto tal cual llegó, antes de interpretarlo).
    app.post('/api/sync/empujar', express_1.default.text({ type: () => true, limit: MAX_CUERPO_EMPUJE }), async (req, res) => {
        const cuerpo = typeof req.body === 'string' ? req.body : '';
        const nonce = (0, seguridad_1.verificarPedido)(deps.claveRed(), req.headers, req.method, req.originalUrl, cuerpo);
        if (!nonce) {
            rechazar(req, res, deps.claveRed(), cuerpo);
            return;
        }
        res.set('X-Red-Prueba', (0, seguridad_1.pruebaDeRespuesta)(deps.claveRed(), nonce));
        try {
            const datos = mongodb_1.BSON.EJSON.parse(cuerpo);
            if (!Array.isArray(datos.items))
                throw new Error('El pedido no trae cambios.');
            if (datos.items.length > MAX_ITEMS_EMPUJE)
                throw new Error('Demasiados cambios juntos.');
            const de = typeof datos.idPc === 'string' && datos.idPc ? datos.idPc : 'otra-pc';
            // Una carga grande (la primera vez, o después de que el servidor perdió su
            // base) recalcula el stock una sola vez al final del lote, no por cambio:
            // contra una base lejana, lo otro tardaría muchísimo.
            const r = await deps.aplicador.aplicar(datos.items, de, {
                alFinal: datos.items.length >= ITEMS_PARA_CARGA_GRANDE,
            });
            const salida = {
                epoca: deps.diario.epoca,
                aplicados: r.aplicados,
                sinCambio: r.sinCambio,
                errores: r.errores,
            };
            if (de !== deps.yo().idPc)
                deps.alVerPar(de);
            enviar(res, { ok: true, data: salida });
        }
        catch (err) {
            enviar(res, { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' });
        }
    });
    app.post('/api/sync/unirse', ruta(false, (req) => {
        deps.requiereAdmin(req);
        const { idPc, nombrePc, puerto } = (req.body ?? {});
        if (!idPc || typeof idPc !== 'string')
            throw new Error('Faltan los datos de la PC que se suma');
        const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
        const yo = deps.yo();
        if (idPc === yo.idPc)
            throw new Error('Esa es esta misma PC.');
        deps.alUnirse({
            idPc,
            nombre: typeof nombrePc === 'string' && nombrePc ? nombrePc : 'PC del negocio',
            direccion: `${ip}:${Number(puerto) || 4000}`,
        });
        const clave = deps.claveRed();
        return {
            claveRed: clave,
            idRed: (0, motor_1.idDeRed)(clave),
            idPc: yo.idPc,
            nombrePc: yo.nombrePc,
            pares: deps.pares().filter((p) => p.idPc !== idPc),
        };
    }));
}
