"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Motor = exports.ErrorDeSync = void 0;
exports.idDeRed = idDeRed;
// La conversación entre PCs.
//
// Cada PC de la red mantiene, con cada una de las otras, un "pedido que
// espera": le dice "avisame cuando tengas algo después de la secuencia N" y la
// otra contesta apenas hay un cambio (o a los 20 segundos, para renovar). Con
// lo que llega se aplica (ver aplicar.ts) y se vuelve a pedir. Así un cambio
// aparece en las demás PCs en menos de un segundo, sin internet ni servidor
// central; y si una PC estaba apagada, al volver pide todo lo que se perdió.
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mongodb_1 = require("mongodb");
const nube_1 = require("../nube");
const diario_1 = require("./diario");
const modelo_1 = require("./modelo");
const seguridad_1 = require("./seguridad");
const pedidoFirmado_1 = require("./pedidoFirmado");
const versiones_1 = require("../../shared/versiones");
class ErrorDeSync extends Error {
    constructor(mensaje, tipo = 'otro') {
        super(mensaje);
        this.tipo = tipo;
    }
}
exports.ErrorDeSync = ErrorDeSync;
function idDeRed(claveRed) {
    return crypto_1.default.createHash('sha256').update(`mis-amores-red:${claveRed}`).digest('hex').slice(0, 16);
}
const LIMITE_POR_PEDIDO = 500;
const LIMITE_POR_EMPUJE = 200;
const ESPERA_LARGA_MS = 20000;
const ESPERA_MAX_FALLOS_MS = 30000;
const CADA_BUSQUEDA_MS = 60000;
const CADA_REVISION_MS = 15 * 60000;
class Motor {
    constructor(o) {
        this.o = o;
        this.bucles = new Map();
        this.estados = new Map();
        this.temporizadorBusqueda = null;
        this.temporizadorRevision = null;
        this.activo = false;
        this.aplicandoAhora = 0;
        this.progreso = null;
        this.trayendoTodo = 0;
        this.revisando = false;
        // Con qué PCs la revisión no logró dejar todo igual: cuándo volver a probar.
        this.sinResolver = new Map();
        this.fotosPendientes = new Map();
        // Cuándo se le preguntó por última vez la versión a cada PC.
        this.versionConsultada = new Map();
        // =================================================================
        // Encontrar PCs nuevas de la misma red
        // =================================================================
        this.buscandoNuevas = false;
    }
    // =================================================================
    // Vida del motor
    // =================================================================
    iniciar() {
        if (this.activo)
            return;
        this.activo = true;
        // El servidor de internet sólo atiende: no busca ni llama a nadie.
        if (this.o.soloAtiende)
            return;
        for (const par of this.o.pares())
            this.arrancarBucle(par);
        this.temporizadorBusqueda = setInterval(() => void this.buscarNuevas(), CADA_BUSQUEDA_MS);
        this.temporizadorRevision = setInterval(() => void this.revisarCoincidencia(), CADA_REVISION_MS);
        setTimeout(() => void this.buscarNuevas(), 3000);
    }
    detener() {
        this.activo = false;
        if (this.temporizadorBusqueda)
            clearInterval(this.temporizadorBusqueda);
        if (this.temporizadorRevision)
            clearInterval(this.temporizadorRevision);
        for (const b of this.bucles.values()) {
            b.parar = true;
            b.controlador?.abort();
            b.controladorEmpuje?.abort();
        }
        this.bucles.clear();
    }
    /** Suma una PC a la red (si ya estaba, actualiza su dirección). */
    agregarPar(par) {
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
        if (this.activo)
            this.arrancarBucle(par);
    }
    /** Deja de sincronizar con esa PC (por ejemplo, una que ya no existe). Si
     * sigue en la red con la misma clave, la búsqueda la vuelve a encontrar. */
    quitarPar(idPc) {
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
        void this.o.diario.db.collection(diario_1.COL_PARES).deleteOne({ _id: idPc });
    }
    /** Esta PC deja de sincronizar con las demás. */
    quitarTodos() {
        for (const b of this.bucles.values()) {
            b.parar = true;
            b.controlador?.abort();
            b.controladorEmpuje?.abort();
        }
        this.bucles.clear();
        this.estados.clear();
        this.o.guardarPares([]);
    }
    estado() {
        const pares = this.o.pares().map((p) => this.estados.get(p.idPc) ?? {
            idPc: p.idPc,
            nombre: p.nombre,
            direccion: p.direccion,
            enLinea: false,
            ultimaVez: null,
            version: null,
            pendientes: 0,
            error: null,
        });
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
    async hola(direccion, esperaMs = 4000) {
        return this.pedirJson(`${(0, nube_1.urlBase)(direccion)}/api/sync/hola`, esperaMs);
    }
    /** `cuerpo`: si se pasa, el pedido es un POST con ese texto (firmado junto con él). */
    async pedirJson(url, esperaMs, senal, cuerpo) {
        // El pedido va firmado con la clave (que no se manda); la respuesta tiene
        // que traer la prueba de que quien contesta también la tiene.
        const clave = this.o.claveRed();
        // Si el reloj de esta PC (o el de la otra) está corrido, el pedido se
        // repite solo con la hora corregida (ver pedidoFirmado.ts).
        let respuesta;
        let texto;
        let nonce;
        try {
            ({ respuesta, texto, nonce } = await (0, pedidoFirmado_1.pedirFirmado)({ clave, url, cuerpo, esperaMs, senal }));
        }
        catch (err) {
            if (senal?.aborted)
                throw err;
            throw new ErrorDeSync('No se pudo conectar con esa PC.', 'red');
        }
        let json;
        try {
            json = mongodb_1.BSON.EJSON.parse(texto);
        }
        catch {
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
        if (!(0, seguridad_1.respuestaEsDeLaRed)(clave, nonce, respuesta.headers.get('x-red-prueba'))) {
            throw new ErrorDeSync('Esa dirección contestó, pero no es una PC de esta red.', 'clave');
        }
        return json.data;
    }
    async pedirCambios(par, desde, esperarMs, senal) {
        // Con quién pide y dónde atiende, la otra PC (que ya sabe que tiene la
        // clave) puede devolver el pedido sin esperar a encontrarnos por la red.
        const yo = this.o.yo();
        const url = `${(0, nube_1.urlBase)(par.direccion)}/api/sync/cambios?desde=${desde}&limite=${LIMITE_POR_PEDIDO}` +
            `&esperar=${esperarMs}` +
            `&yo=${encodeURIComponent(yo.idPc)}&puerto=${this.o.puerto}&nombre=${encodeURIComponent(yo.nombrePc)}`;
        return this.pedirJson(url, esperarMs + 20000, senal);
    }
    // =================================================================
    // Cursores: hasta qué secuencia de cada PC ya se aplicó
    // =================================================================
    async leerCursor(idPc) {
        const doc = await this.o.diario.db.collection(diario_1.COL_PARES).findOne({ _id: idPc });
        return { seq: doc?.seq ?? 0, epoca: doc?.epoca ?? null };
    }
    async guardarCursor(idPc, seq, epoca) {
        await this.o.diario.db
            .collection(diario_1.COL_PARES)
            .updateOne({ _id: idPc }, { $set: { seq, epoca } }, { upsert: true });
    }
    // El cursor de lo que ESTA PC ya le empujó a una PC remota (ver `empujar`):
    // hasta qué secuencia del diario propio, y contra qué época de la otra.
    async leerCursorEmpuje(idPc) {
        const doc = await this.o.diario.db
            .collection(diario_1.COL_PARES)
            .findOne({ _id: idPc });
        return { push: doc?.push ?? 0, pushEpoca: doc?.pushEpoca ?? null, epoca: doc?.epoca ?? null };
    }
    async guardarCursorEmpuje(idPc, push, pushEpoca) {
        await this.o.diario.db
            .collection(diario_1.COL_PARES)
            .updateOne({ _id: idPc }, { $set: { push, pushEpoca } }, { upsert: true });
    }
    // =================================================================
    // El bucle de cada PC
    // =================================================================
    arrancarBucle(par) {
        if (this.o.soloAtiende)
            return;
        if (this.bucles.has(par.idPc) || par.idPc === this.o.yo().idPc)
            return;
        const bucle = { par, parar: false, controlador: null, controladorEmpuje: null, despertar: null, despertado: false };
        this.bucles.set(par.idPc, bucle);
        void this.correr(bucle);
        // Una PC de internet no puede llamarnos a nosotras (estamos detrás del
        // router): lo nuestro se lo empujamos.
        if ((0, nube_1.esDireccionRemota)(par.direccion))
            void this.empujar(bucle);
    }
    // =================================================================
    // Empujar: llevarle nuestros cambios a una PC de internet
    // =================================================================
    /** El servidor de internet no puede pedirnos cambios (no llega hasta esta
     * PC), así que se los mandamos: lo que haya en nuestro diario después de la
     * última secuencia que ya recibió. Aplicarlo es idempotente: lo que ya tenía
     * (por ejemplo, lo que él mismo nos mandó antes) lo ignora. */
    async empujar(bucle) {
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
                    const cuerpo = mongodb_1.BSON.EJSON.stringify({ idPc: this.o.yo().idPc, items }, {
                        relaxed: false,
                    });
                    const r = await this.pedirJson(`${(0, nube_1.urlBase)(bucle.par.direccion)}/api/sync/empujar`, 90000, bucle.controladorEmpuje.signal, cuerpo);
                    bucle.controladorEmpuje = null;
                    if (bucle.parar)
                        break;
                    if (r.errores > 0)
                        this.o.registrar('sync', `${r.errores} cambio(s) no se pudieron aplicar en ${bucle.par.nombre}`);
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
            }
            catch (err) {
                bucle.controladorEmpuje = null;
                if (bucle.parar || !this.activo)
                    break;
                fallos += 1;
                const mensaje = err instanceof Error ? err.message : 'No se pudo enviar';
                if (fallos === 1 || fallos % 20 === 0)
                    this.o.registrar('sync', `${bucle.par.nombre} (enviar): ${mensaje}`);
                await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** Math.min(fallos, 5), ESPERA_MAX_FALLOS_MS)));
            }
        }
    }
    /** Vuelve a mandarle todo a esa PC de internet (después de una revisión que
     * no coincidía). */
    async reiniciarEmpuje(idPc) {
        await this.o.diario.db.collection(diario_1.COL_PARES).updateOne({ _id: idPc }, { $set: { push: 0 } }, { upsert: true });
    }
    anotar(par, cambios) {
        const actual = this.estados.get(par.idPc) ?? {
            idPc: par.idPc,
            nombre: par.nombre,
            direccion: par.direccion,
            enLinea: false,
            ultimaVez: null,
            version: null,
            pendientes: 0,
            error: null,
        };
        this.estados.set(par.idPc, { ...actual, nombre: par.nombre, direccion: par.direccion, ...cambios });
    }
    /** Le pregunta a esa PC qué versión de Mis Amores tiene (así se ve en
     * Configuración cuando una quedó desactualizada). Sólo de a ratos. */
    async consultarVersion(par, forzar = false) {
        const ultima = this.versionConsultada.get(par.idPc) ?? 0;
        const sabida = this.estados.get(par.idPc)?.version ?? null;
        if (Date.now() - ultima < (0, versiones_1.esperaParaPreguntarVersion)(sabida, this.o.yo().version, forzar))
            return;
        this.versionConsultada.set(par.idPc, Date.now());
        try {
            const h = await this.hola(par.direccion, 10000);
            this.anotar(par, { version: typeof h.version === 'string' ? h.version : null });
        }
        catch {
            // Se vuelve a intentar en un rato.
        }
    }
    async correr(bucle) {
        let fallos = 0;
        let alDia = false;
        while (!bucle.parar && this.activo) {
            try {
                bucle.controlador = new AbortController();
                const cursor = await this.leerCursor(bucle.par.idPc);
                const r = await this.pedirCambios(bucle.par, cursor.seq, alDia ? ESPERA_LARGA_MS : 0, bucle.controlador.signal);
                if (bucle.parar)
                    break;
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
                        if (res.errores > 0)
                            this.o.registrar('sync', `${res.errores} cambio(s) de ${bucle.par.nombre} no se pudieron aplicar`);
                        this.pedirFotos(bucle.par, res.fotosFaltantes);
                    }
                    finally {
                        this.aplicandoAhora -= 1;
                    }
                }
                await this.guardarCursor(bucle.par.idPc, Math.max(r.hasta, cursor.seq), r.epoca);
                alDia = r.hasta >= r.maxSeq;
                // Si estaba caída o recién se la agregó, se acaba de (re)conectar: puede
                // haberse reiniciado para actualizarse, así que se le vuelve a preguntar la versión.
                const recienConectada = fallos > 0 || this.estados.get(bucle.par.idPc)?.enLinea !== true;
                fallos = 0;
                // Sin avance pero con algo todavía escribiéndose en la otra PC: un respiro.
                if (r.items.length === 0 && r.hasta <= cursor.seq && r.maxSeq > r.hasta)
                    await this.dormir(60, bucle);
                this.anotar(bucle.par, {
                    enLinea: true,
                    ultimaVez: new Date().toISOString(),
                    pendientes: Math.max(0, r.maxSeq - r.hasta),
                    error: null,
                });
                void this.consultarVersion(bucle.par, recienConectada);
                void this.bajarFotosPendientes();
            }
            catch (err) {
                if (bucle.parar || !this.activo)
                    break;
                fallos += 1;
                alDia = false;
                const mensaje = err instanceof Error ? err.message : 'No se pudo hablar con esa PC';
                this.anotar(bucle.par, { enLinea: false, error: mensaje });
                if (fallos === 1 || fallos % 20 === 0)
                    this.o.registrar('sync', `${bucle.par.nombre}: ${mensaje}`);
                // Si cambió de dirección (el router le dio otra IP), se la vuelve a buscar.
                // (Una PC de internet no se "encuentra" en la red del local.)
                if (fallos % 3 === 0 && !(0, nube_1.esDireccionRemota)(bucle.par.direccion))
                    await this.reencontrar(bucle).catch(() => { });
                await this.dormir(Math.min(1000 * 2 ** Math.min(fallos, 5), ESPERA_MAX_FALLOS_MS), bucle);
                if (bucle.despertado) {
                    bucle.despertado = false;
                    fallos = 0;
                }
            }
        }
    }
    dormir(ms, bucle) {
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
    alVerPar(idPc) {
        const bucle = this.bucles.get(idPc);
        if (!bucle || !bucle.despertar)
            return;
        bucle.despertado = true;
        bucle.despertar();
    }
    async reencontrar(bucle) {
        const hallazgos = await this.o.buscar();
        const hallada = hallazgos.find((h) => h.hola.idPc === bucle.par.idPc);
        if (hallada && hallada.direccion !== bucle.par.direccion) {
            this.o.registrar('sync', `${bucle.par.nombre} ahora está en ${hallada.direccion}`);
            const par = { idPc: bucle.par.idPc, nombre: hallada.hola.nombrePc, direccion: hallada.direccion };
            bucle.par = par;
            const lista = this.o.pares().map((p) => (p.idPc === par.idPc ? par : p));
            this.o.guardarPares(lista);
        }
    }
    async buscarNuevas() {
        if (!this.activo || this.o.soloAtiende || this.buscandoNuevas)
            return;
        this.buscandoNuevas = true;
        try {
            const yo = this.o.yo().idPc;
            const conocidas = new Set(this.o.pares().map((p) => p.idPc));
            for (const { direccion, hola } of await this.o.buscar()) {
                if (hola.idPc === yo)
                    continue;
                if (!conocidas.has(hola.idPc)) {
                    this.o.registrar('sync', `PC nueva en la red: ${hola.nombrePc} (${direccion})`);
                    this.agregarPar({ idPc: hola.idPc, nombre: hola.nombrePc, direccion });
                    conocidas.add(hola.idPc);
                }
                // Las PCs que esa PC conoce y yo no.
                for (const p of hola.pares ?? []) {
                    if (p.idPc === yo || conocidas.has(p.idPc))
                        continue;
                    try {
                        // Un servidor de internet gratuito que está dormido tarda hasta un
                        // minuto en despertar: con 3 segundos nunca se lo alcanzaba.
                        const h = await this.hola(p.direccion, (0, nube_1.esDireccionRemota)(p.direccion) ? 90000 : 3000);
                        if (h.idPc === p.idPc) {
                            this.agregarPar({ idPc: h.idPc, nombre: h.nombrePc, direccion: p.direccion });
                            conocidas.add(h.idPc);
                        }
                    }
                    catch {
                        // Todavía no se la alcanza: otra vuelta.
                    }
                }
            }
        }
        catch (err) {
            this.o.registrar('sync-buscar', err);
        }
        finally {
            this.buscandoNuevas = false;
        }
    }
    // =================================================================
    // Traer todo (primera vez, o cuando algo no coincide)
    // =================================================================
    /** Un pedido que aguanta un corte de red pasajero (unos reintentos). */
    async pedirCambiosConReintentos(par, desde) {
        let ultimo;
        for (let intento = 0; intento < 4; intento++) {
            try {
                return await this.pedirCambios(par, desde, 0);
            }
            catch (err) {
                ultimo = err;
                if (err instanceof ErrorDeSync && (err.tipo === 'clave' || err.tipo === 'version'))
                    throw err;
                await new Promise((r) => setTimeout(r, 1000 * 2 ** intento));
            }
        }
        throw ultimo;
    }
    /** Baja TODO lo que tiene esa PC (de la secuencia 0 en adelante) a memoria,
     * sin tocar nada de esta. Así, si se corta a la mitad, no se perdió nada:
     * recién con la descarga completa se reemplazan los datos de esta PC. */
    async descargarTodo(par) {
        this.trayendoTodo += 1;
        this.progreso = { hecho: 0, total: 0 };
        try {
            const items = [];
            let desde = 0;
            let epoca = '';
            for (let vueltas = 0; vueltas < 100000; vueltas++) {
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
        }
        finally {
            this.trayendoTodo -= 1;
            if (this.trayendoTodo === 0)
                this.progreso = null;
        }
    }
    /** Aplica una descarga completa en esta PC. */
    async aplicarDescarga(par, descarga) {
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
                }
                finally {
                    this.aplicandoAhora -= 1;
                }
            }
            const actual = await this.leerCursor(par.idPc);
            if (actual.epoca !== descarga.epoca || descarga.hasta > actual.seq) {
                await this.guardarCursor(par.idPc, descarga.hasta, descarga.epoca);
            }
            await this.bajarFotosPendientes();
            return { aplicados };
        }
        finally {
            this.trayendoTodo -= 1;
            if (this.trayendoTodo === 0)
                this.progreso = null;
        }
    }
    /** Pide a esa PC todo lo que tiene y lo aplica, página por página (sin
     * vaciar nada antes ni tener todo en memoria). */
    async traerTodo(par) {
        this.trayendoTodo += 1;
        this.progreso = { hecho: 0, total: 0 };
        let aplicados = 0;
        try {
            let desde = 0;
            let epoca = '';
            for (let vueltas = 0; vueltas < 100000; vueltas++) {
                const r = await this.pedirCambiosConReintentos(par, desde);
                epoca = r.epoca;
                if (r.items.length > 0) {
                    this.aplicandoAhora += 1;
                    try {
                        const res = await this.o.aplicador.aplicar(r.items, par.idPc, { alFinal: true });
                        aplicados += res.aplicados;
                        this.pedirFotos(par, res.fotosFaltantes);
                    }
                    finally {
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
            if (actual.epoca !== epoca || desde > actual.seq)
                await this.guardarCursor(par.idPc, desde, epoca);
            await this.bajarFotosPendientes();
            return { aplicados };
        }
        finally {
            this.trayendoTodo -= 1;
            if (this.trayendoTodo === 0)
                this.progreso = null;
        }
    }
    // =================================================================
    // Revisar que todas las PCs tengan lo mismo
    // =================================================================
    /** Una "foto" del estado de esta PC: cuántos documentos hay y una huella de
     * sus marcas. Dos PCs al día dan la misma. */
    async resumen() {
        const salida = {};
        for (const c of modelo_1.COLECCIONES_REPLICADAS) {
            const hash = crypto_1.default.createHash('sha1');
            let vivos = 0;
            let borrados = 0;
            const cursor = this.o.diario.db
                .collection(diario_1.COL_META)
                .find({ c }, { projection: { inc: 1, del: 1, clocks: 1 } })
                .sort({ _id: 1 });
            let hechos = 0;
            for await (const m of cursor) {
                const clocks = m.clocks;
                const marcas = clocks ? Object.keys(clocks).sort().map((k) => `${k}=${clocks[k]}`).join(',') : '';
                if (m.del)
                    borrados += 1;
                else
                    vivos += 1;
                hash.update(`${m._id}|${m.inc}|${m.del ?? ''}|${m.del ? '' : marcas}\n`);
                // Con muchos datos, de a ratos se le da el paso al resto de la app
                // (la pantalla y los celulares).
                hechos += 1;
                if (hechos % 2000 === 0)
                    await new Promise((r) => setImmediate(r));
            }
            salida[c] = { vivos, borrados, huella: hash.digest('hex').slice(0, 16) };
        }
        return salida;
    }
    iguales(a, b) {
        // Sólo lo que las dos conocen: una PC con una versión más vieja puede no
        // tener alguna colección nueva.
        return modelo_1.COLECCIONES_REPLICADAS.every((c) => !a[c] || !b[c] || (a[c].huella === b[c].huella && a[c].vivos === b[c].vivos));
    }
    /** Compara con cada PC en línea; si no coincide (y sigue sin coincidir un
     * momento después, por si había cambios en camino) vuelve a traer todo.
     * `forzar`: no espera ese momento ni respeta el "volver a probar más tarde". */
    async revisarCoincidencia(forzar = false) {
        if (this.revisando)
            return { revisadas: 0, corregidas: 0 };
        this.revisando = true;
        let revisadas = 0;
        let corregidas = 0;
        try {
            for (const par of this.o.pares()) {
                const estado = this.estados.get(par.idPc);
                if (!estado?.enLinea)
                    continue;
                const pendiente = this.sinResolver.get(par.idPc);
                if (!forzar && pendiente && Date.now() < pendiente.proxima)
                    continue;
                try {
                    const url = `${(0, nube_1.urlBase)(par.direccion)}/api/sync/resumen`;
                    const suyo = await this.pedirJson(url, 15000);
                    revisadas += 1;
                    if (this.iguales(await this.resumen(), suyo)) {
                        this.sinResolver.delete(par.idPc);
                        continue;
                    }
                    if (!forzar) {
                        await new Promise((r) => setTimeout(r, 20000));
                        const otraVez = await this.pedirJson(url, 15000);
                        if (this.iguales(await this.resumen(), otraVez)) {
                            this.sinResolver.delete(par.idPc);
                            continue;
                        }
                    }
                    this.o.registrar('sync', `Revisión: lo de ${par.nombre} no coincide, se vuelve a traer todo`);
                    await this.traerTodo(par);
                    // Si es el servidor de internet, también se le vuelve a mandar todo lo
                    // nuestro (puede ser lo que le falte a él).
                    if ((0, nube_1.esDireccionRemota)(par.direccion))
                        await this.reiniciarEmpuje(par.idPc);
                    // ¿Quedó resuelto? Si no (algo que no se puede aplicar), no se vuelve a
                    // bajar todo cada pocos minutos: se espera cada vez más.
                    const despues = await this.pedirJson(url, 15000);
                    if (this.iguales(await this.resumen(), despues)) {
                        this.sinResolver.delete(par.idPc);
                        corregidas += 1;
                    }
                    else {
                        const veces = (pendiente?.veces ?? 0) + 1;
                        this.sinResolver.set(par.idPc, {
                            veces,
                            proxima: Date.now() + Math.min(6 * 60 * 60000, 15 * 60000 * 2 ** (veces - 1)),
                        });
                        if (veces === 3) {
                            void this.o.diario
                                .avisar(`Esta PC y "${par.nombre}" siguen teniendo alguna diferencia que no se pudo resolver sola. ` +
                                'No se perdió nada de lo cargado; si ves algo raro, avisá.')
                                .catch(() => { });
                        }
                    }
                }
                catch (err) {
                    this.o.registrar('sync-revision', err);
                }
            }
        }
        finally {
            this.revisando = false;
        }
        return { revisadas, corregidas };
    }
    // =================================================================
    // Fotos de los productos
    // =================================================================
    pedirFotos(par, nombres) {
        for (const nombre of nombres) {
            if (!this.fotosPendientes.has(nombre))
                this.fotosPendientes.set(nombre, { par, intentos: 0 });
        }
    }
    async bajarFotosPendientes() {
        for (const [nombre, pedido] of [...this.fotosPendientes]) {
            const destino = path_1.default.join(this.o.carpetaImagenes, nombre);
            if (fs_1.default.existsSync(destino)) {
                this.fotosPendientes.delete(nombre);
                continue;
            }
            try {
                const r = await fetch(`${(0, nube_1.urlBase)(pedido.par.direccion)}/imagenes/${encodeURIComponent(nombre)}`, {
                    signal: AbortSignal.timeout(30000),
                });
                if (!r.ok)
                    throw new Error(`HTTP ${r.status}`);
                fs_1.default.mkdirSync(this.o.carpetaImagenes, { recursive: true });
                fs_1.default.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
                this.fotosPendientes.delete(nombre);
            }
            catch {
                pedido.intentos += 1;
                // Una foto que no está en ninguna PC no tiene que reintentarse para siempre.
                if (pedido.intentos >= 10)
                    this.fotosPendientes.delete(nombre);
            }
        }
    }
}
exports.Motor = Motor;
