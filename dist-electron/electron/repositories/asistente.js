"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizar = void 0;
exports.sugerirRubro = sugerirRubro;
exports.responderPregunta = responderPregunta;
// El asistente SIMPLE: no usa ningún servicio de IA externo — es reconocimiento de patrones (expresiones regulares)
// sobre la pregunta, que después busca la respuesta real en la base. Así funciona sin conexión a internet, sin clave
// de API y sin costo.
//
// Es el que contesta cuando no hay una clave de IA cargada, no hay internet, la IA falla o se llegó al tope de gasto
// (ver electron/asistenteIa.ts, el asistente con IA de verdad). Entiende:
//   - ventas de cualquier "cuándo" (hoy, ayer, la semana pasada, el lunes, el 15/10, septiembre, los últimos 15 días...),
//     por forma de pago, comparaciones ("¿vendí más que ayer?"), el mejor día, lo más vendido, qué se vendió, de un producto
//   - pagos de cuentas y fiados ("¿quién me pagó hoy?", "¿a quién le fié?"), deudas y clientes
//   - stock (qué falta, qué reponer), precios, códigos, recordatorios
//   - seguimientos de la charla: "¿cuánto vendí hoy?" … "¿y ayer?" … "¿y en efectivo?" (ver seguimiento.ts)
//   - errores de tipeo ("cuanto vedi"), saludos y cortesías
const mongodb_1 = require("mongodb");
const database_1 = require("../db/database");
const dashboard_1 = require("./dashboard");
const reportes_1 = require("./reportes");
const ventas_1 = require("./ventas");
const clientes_1 = require("./clientes");
const articulos_1 = require("./articulos");
const recordatorios_1 = require("./recordatorios");
const formato_1 = require("../../shared/formato");
const lenguaje_1 = require("../lenguaje");
Object.defineProperty(exports, "normalizar", { enumerable: true, get: function () { return lenguaje_1.normalizar; } });
const periodos_1 = require("../periodos");
const seguimiento_1 = require("../seguimiento");
function tokenizar(texto) {
    return (0, lenguaje_1.normalizar)(texto)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3);
}
// ---------- Sugerencia de rubro para artículos nuevos ----------
// Compara la descripción nueva contra los artículos YA categorizados y
// sugiere el rubro más frecuente entre los que comparten palabras — cuantos
// más productos catalogados tenga el rubro correcto, mejor va a acertar.
async function sugerirRubro(descripcion) {
    const tokensNuevo = tokenizar(descripcion);
    if (tokensNuevo.length === 0)
        return null;
    const db = (0, database_1.getDb)();
    const [articulos, familias] = await Promise.all([
        db
            .collection('articulos')
            .find({ familiaId: { $ne: null } }, { projection: { descripcion: 1, familiaId: 1 } })
            .toArray(),
        db.collection('familias').find().toArray(),
    ]);
    const nombrePorId = new Map(familias.map((f) => [f._id.toHexString(), f.nombre]));
    const puntajePorFamilia = new Map();
    for (const a of articulos) {
        if (!a.familiaId)
            continue;
        const tokensExistente = tokenizar(a.descripcion);
        const interseccion = tokensNuevo.filter((t) => tokensExistente.includes(t)).length;
        if (interseccion === 0)
            continue;
        const familiaId = a.familiaId.toHexString();
        puntajePorFamilia.set(familiaId, (puntajePorFamilia.get(familiaId) ?? 0) + interseccion);
    }
    if (puntajePorFamilia.size === 0)
        return null;
    const [mejorId, mejorPuntaje] = [...puntajePorFamilia.entries()].sort((a, b) => b[1] - a[1])[0];
    // Umbral bajo a propósito: mejor una sugerencia de baja confianza (que la
    // jefa puede ignorar con un click) que ninguna.
    if (mejorPuntaje < 1)
        return null;
    const familiaNombre = nombrePorId.get(mejorId);
    if (!familiaNombre)
        return null;
    return { familiaId: mejorId, familiaNombre };
}
const AYUDA = 'Te puedo contestar cosas como: "¿cuánto vendí hoy / ayer / esta semana / el mes pasado / el lunes?", "¿y en efectivo?" ' +
    '(me acuerdo de lo que veníamos hablando), "¿vendí más que ayer?", "¿qué día vendí más?", "¿qué se vendió hoy?", ' +
    '"¿cuántas [producto] vendí?", "¿quién me pagó hoy?", "¿a quién le fié?", "¿quién me debe?", "¿cuánto me debe [nombre]?", ' +
    '"¿qué tiene poco stock?", "¿qué tengo que reponer?", "¿cuánto cuesta [producto]?", "¿hay stock de [producto]?", ' +
    '"¿cuál es el producto más vendido?", "¿qué rubro vende más?" o "¿qué tengo pendiente?".';
const NOMBRES_METODO = {
    efectivo: 'efectivo',
    tarjeta: 'tarjeta',
    transferencia: 'transferencia',
    fiado: 'fiado',
};
// Frase de ventas que separa lo cobrado (efectivo/tarjeta/transferencia) de
// lo fiado — nunca hay que sumarlos como si fuera la misma plata: un fiado
// es una deuda, no algo que entró en la caja.
function frasearVentas(cobrado, fiado, cantidad, pagos = 0) {
    const base = fiado === 0
        ? `${(0, formato_1.formatearMoneda)(cobrado)} cobrado en ${cantidad} venta(s)`
        : `${(0, formato_1.formatearMoneda)(cobrado)} cobrado y ${(0, formato_1.formatearMoneda)(fiado)} fiado (sin cobrar) en ${cantidad} venta(s)`;
    // Lo que los clientes pagaron de su cuenta también entró a la caja (el Panel lo cuenta aparte).
    return pagos > 0 ? `${base}, y recibiste ${(0, formato_1.formatearMoneda)(pagos)} de pagos de cuentas` : base;
}
// Cuando no hubo ventas pero sí pagos de cuentas, se aclara.
const avisoPagos = (pagos) => (pagos > 0 ? ` (igual recibiste ${(0, formato_1.formatearMoneda)(pagos)} de pagos de cuentas)` : '');
const escaparRegExp = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unaLinea = (lineas) => lineas.join('\n');
const plural = (n, uno, varios) => (n === 1 ? uno : varios);
// "A (2), B (1) y 3 más": los primeros y cuántos quedan afuera.
function enLista(items, max) {
    const resto = items.length - max;
    return items.slice(0, max).join(', ') + (resto > 0 ? ` y ${resto} más` : '');
}
// El nombre de un producto o cliente, sin "el/la/unidades de..." de adelante.
function limpiarSujeto(texto) {
    return texto
        .replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/, '')
        .replace(/^(?:unidades?|kilos?|paquetes?|cajas?|packs?|botellas?|bolsas?|latas?)\s+de\s+/, '')
        .replace(/^(?:el|la|los|las)\s+/, '')
        .trim();
}
// ----- "cuándo" -----
async function ventasDelPeriodo(p) {
    const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
    if (r.cantidadVentas === 0) {
        return p.etiqueta === 'Hoy'
            ? `Todavía no hay ventas registradas hoy${avisoPagos(r.totalPagos)}.`
            : `${p.etiqueta} no hubo ventas registradas${avisoPagos(r.totalPagos)}.`;
    }
    const promedio = p.tipo !== 'dia' ? ` Cada compra salió en promedio ${(0, formato_1.formatearMoneda)(r.ticketPromedio)}.` : '';
    return `${p.etiqueta} ${frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas, r.totalPagos)}.${promedio}`;
}
// Cuánto más o menos, y en porcentaje: "$ 500 más (+25 %)".
function diferencia(actual, referencia) {
    const dif = actual - referencia;
    if (Math.abs(dif) < 0.5)
        return 'prácticamente lo mismo';
    const pct = referencia > 0 ? ` (${dif > 0 ? '+' : '-'}${Math.round((Math.abs(dif) / referencia) * 100)} %)` : '';
    return `${(0, formato_1.formatearMoneda)(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'}${pct}`;
}
async function compararPeriodos(actual, referencia) {
    const [ra, rb] = await Promise.all([
        (0, reportes_1.getReporteVentas)(actual.desde, actual.hasta),
        (0, reportes_1.getReporteVentas)(referencia.desde, referencia.hasta),
    ]);
    const frase = (p, r) => r.totalVendido === 0 ? `${p.etiqueta} no hubo ventas` : `${p.etiqueta} vendiste ${(0, formato_1.formatearMoneda)(r.totalVendido)} (${(0, formato_1.formatearMoneda)(r.totalCobrado)} cobrados)`;
    const partes = [frase(actual, ra), frase(referencia, rb)];
    let cierre;
    if (ra.totalVendido === 0 && rb.totalVendido === 0)
        cierre = 'En los dos períodos no hubo ventas.';
    else if (rb.totalVendido === 0)
        cierre = 'No hay con qué comparar: en el otro período no hubo ventas.';
    else
        cierre = `Vendiste ${diferencia(ra.totalVendido, rb.totalVendido)} que ${(0, periodos_1.enMinuscula)(referencia.etiqueta.replace(/^En /, ''))}.`;
    const nota = actual.enCurso && actual.tipo === 'dia' ? ` Ojo: ${(0, periodos_1.enMinuscula)(actual.etiqueta)} todavía no terminó.` : '';
    return `${partes.join('. ')}. ${cierre}${nota}`;
}
// ----- la base: pagos de cuentas y fiados agrupados por cliente -----
async function pagosPorCliente(desde, hasta) {
    return (0, database_1.getDb)()
        .collection('pagos_cuenta')
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } },
        { $group: { _id: '$clienteId', nombre: { $first: { $arrayElemAt: ['$cliente.nombre', 0] } }, total: { $sum: '$monto' }, cantidad: { $sum: 1 } } },
        { $sort: { total: -1 } },
    ])
        .toArray();
}
async function fiadosPorCliente(desde, hasta) {
    return (0, database_1.getDb)()
        .collection('ventas')
        .aggregate([
        { $match: { metodoPago: 'fiado', fecha: { $gte: desde, $lt: hasta } } },
        { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } },
        {
            $group: {
                _id: '$clienteId',
                nombre: { $first: { $arrayElemAt: ['$cliente.nombre', 0] } },
                total: { $sum: '$total' },
                compras: { $addToSet: ventas_1.CLAVE_TICKET },
            },
        },
        { $sort: { total: -1 } },
    ])
        .toArray();
}
async function vendidoDe(ids, desde, hasta) {
    return (0, database_1.getDb)()
        .collection('ventas')
        .aggregate([
        { $match: { articuloId: { $in: ids }, fecha: { $gte: desde, $lt: hasta } } },
        { $group: { _id: '$articuloId', descripcion: { $last: '$articuloDescripcion' }, cantidad: { $sum: '$cantidad' }, total: { $sum: '$total' } } },
        { $sort: { cantidad: -1 } },
    ])
        .toArray();
}
// ----- clientes y productos -----
async function buscarClientes(nombreBuscado) {
    const clientes = await (0, clientes_1.listClientes)();
    const buscado = (0, lenguaje_1.normalizar)(nombreBuscado).trim();
    if (!buscado)
        return [];
    // Primero un match exacto de algún nombre completo; si no, parcial (por si preguntan sólo el nombre de pila).
    const exactos = clientes.filter((c) => (0, lenguaje_1.normalizar)(c.nombre) === buscado);
    if (exactos.length > 0)
        return exactos;
    return clientes.filter((c) => (0, lenguaje_1.normalizar)(c.nombre).includes(buscado) || buscado.includes((0, lenguaje_1.normalizar)(c.nombre)));
}
const fechaCorta = (iso) => {
    if (!iso)
        return null;
    const f = new Date(iso);
    return Number.isNaN(f.getTime()) ? null : `${f.getDate()}/${f.getMonth() + 1}${f.getFullYear() === new Date().getFullYear() ? '' : `/${f.getFullYear()}`}`;
};
// Un stock en negativo es un producto que se vendió sin stock registrado.
const textoDeStock = (a) => a.stock < 0
    ? `el sistema no tenía stock cargado y se vendió igual (figura ${(0, formato_1.formatearCantidad)(a.stock)}): conviene contarlo`
    : `stock ${(0, formato_1.formatearCantidad)(a.stock)}`;
// "aguas" → "agua", "panes" → "pan": se prueba la palabra en singular cuando en plural no aparece nada.
const enSingular = (texto, quitar) => texto
    .split(' ')
    .map((w) => (w.length > quitar.length + 2 && w.endsWith(quitar) ? w.slice(0, -quitar.length) : w))
    .join(' ');
async function articulosParecidos(sujeto) {
    let encontrados = await (0, articulos_1.listArticulos)({ busqueda: sujeto });
    for (const quitar of ['s', 'es']) {
        if (encontrados.length > 0)
            break;
        const singular = enSingular(sujeto, quitar);
        if (singular !== sujeto)
            encontrados = await (0, articulos_1.listArticulos)({ busqueda: singular });
    }
    // Si uno se llama exactamente como se pidió, es ése.
    const exacto = encontrados.filter((a) => (0, lenguaje_1.normalizar)(a.descripcion) === (0, lenguaje_1.normalizar)(sujeto));
    return exacto.length === 1 ? exacto : encontrados;
}
async function datosDeProducto(sujetoCrudo) {
    const sujeto = limpiarSujeto(sujetoCrudo);
    const encontrados = await articulosParecidos(sujeto);
    if (encontrados.length === 0)
        return `No encontré ningún artículo que coincida con "${sujeto}".`;
    if (encontrados.length === 1) {
        const a = encontrados[0];
        return `"${a.descripcion}": ${(0, formato_1.formatearMoneda)(a.precioVenta)}, ${textoDeStock(a)}.`;
    }
    const lineas = encontrados.slice(0, 5).map((a) => `- "${a.descripcion}": ${(0, formato_1.formatearMoneda)(a.precioVenta)}, ${textoDeStock(a)}`);
    const resto = encontrados.length - lineas.length;
    return unaLinea([`Encontré ${encontrados.length} artículos que coinciden con "${sujeto}":`, ...lineas, ...(resto > 0 ? [`... y ${resto} más (probá con un nombre más completo).`] : [])]);
}
// ---------- Las intenciones, en orden: gana la primera que coincide ----------
const RE_SALUDO = /^(?:hola|holis|buenas(?: tardes| noches| dias)?|buen dia|buenos dias|hey|ey)\b/;
const RE_DE_RESUMEN = /\bresumen\b|\bcomo (?:estuvo|viene|va|me fue|nos fue|anduvo)\b/;
const RE_COMPARA = /\bcompar|\bvs\b|\brespecto\b|\b(?:mas|menos|mejor|peor|igual)\b.{0,30}\b(?:que|a|con)\b/;
const RE_MAS_VENDIDO = /mas vendid|(?:producto|articulo).*vend\w* mas|que se vende mas|producto estrella|top.*producto|que mas (?:se )?vend|lo que mas (?:se )?vend|el que mas (?:se )?vend/;
const RE_RUBRO = /\b(?:rubros?|categorias?)\b/;
const RE_QUE_VENDI = /\bque (?:vendi|vendimos|se vendio|se vendieron|vendio|salio|salieron)\b|\bdetalle de (?:ventas|lo vendido)\b|\blo que (?:vendi|se vendio)\b/;
const RE_MEJOR_DIA = /\bque dia\b.*\b(?:mas|menos|mejor|peor)\b|\b(?:mejor|peor) dia\b|\bdia (?:que )?(?:mas|menos) (?:vendi|vendimos|se vendio)/;
const RE_TICKET = /ticket promedio|promedio (?:por|de) (?:compra|venta|cliente)|compra promedio|cuanto gasta (?:cada|en promedio)/;
const RE_PAGOS = /\bme pag(?:o|aron)\b|\bquien(?:es)? (?:me )?pag(?:o|aron)\b|\bpagos? de (?:cuentas?|clientes?)\b|\bcuanto (?:me )?pag(?:o|aron)\b|\bque clientes? pag(?:o|aron)\b|\bcobre de cuentas\b/;
const RE_FIADOS = /\ba quien (?:le )?fie\b|\bquien(?:es)? (?:se llevo|llevo) fiado\b|\bfiados? (?:de|del|en|hoy|ayer)\b|\bcuantos fiados\b|\bventas fiadas\b/;
const RE_DEBE_MAS = /quien.*(?:debe mas|mayor deuda)|mayor deudor|(?:el|la) que mas debe|quien es el que mas debe/;
const RE_QUIENES_DEBEN = /\bquien(?:es)?\b.*\bdeb(?:e|en)\b|\bdeudores\b|\bque clientes? deb(?:e|en)\b|\ba quien (?:le )?(?:tengo que )?cobr|\blista de deudores\b/;
const RE_CUANTOS_DEBEN = /\bcuant(?:os|as)\b.*\b(?:clientes|personas|gente)\b.*\bdeb(?:e|en)\b|\bcuanta gente\b.*\bdeb/;
const RE_DEUDA_TOTAL = /deuda total|total.*deuda|cuanto me deben en total|^cuanto (?:me )?deben$|\bme falta cobrar\b|\bfalta(?:n)? cobrar\b|\bpor cobrar\b/;
const RE_CAJA = /\b(?:hay|tengo|queda|deberia haber|tenemos) en (?:la )?caja\b|\bcuanto hay en caja\b/;
const RE_DESDE_CUANDO = /(?:desde cuando|hace cuanto(?: que)?)\s+(?:esta debiendo|debe)\s+(.+)$/;
const RE_MAS_ANTIGUA = /quien debe hace mas|deuda mas (?:vieja|antigua)|el que debe hace mas|mas tiempo debiendo|debe desde hace mas/;
const RE_TELEFONO = /(?:telefono|celular|numero|whatsapp)\s+de\s+(.+)$/;
const RE_MAS_CARO = /(?:articulo|producto).*mas car|mas car.*(?:articulo|producto)|\blo mas caro\b/;
const RE_MAS_BARATO = /(?:articulo|producto).*mas barat|mas barat.*(?:articulo|producto)|\blo mas barato\b/;
const RE_SIN_STOCK = /sin stock|se acab|agotad|\bno queda\b|\bno hay mas\b/;
const RE_STOCK_BAJO = /stock bajo|poco stock|falta.*stock|que falta|\bquedan? poco|por acabarse|a punto de acabarse/;
const RE_REPONER = /\breponer\b|\bque (?:hay que |tengo que |debo |tendria que )?(?:comprar|pedir|reponer)\b|\bque pedir\b/;
const RE_PARA_REVISAR = /para (?:revisar|contar)|stock negativo|\bnegativo|\bhay que (?:contar|revisar)\b|\bque (?:tengo|debo|hay) (?:que )?(?:contar|revisar)\b/;
const RE_VALOR_INVENTARIO = /valor.*inventario|cuanto vale.*(?:inventario|stock|mercaderia)/;
const RE_TOTAL_ARTICULOS = /cuantos (?:articulos|productos)|total.*(?:articulos|productos)|articulos cargados/;
const RE_CUANTOS_CLIENTES = /cuantos clientes|total.*clientes/;
const RE_CODIGO = /\bcodigo(?: de barras)?\s+de\s+(.+)$/;
const RE_QUEDAN = /^cuant[oa]s?\s+(.+?)\s+(?:quedan|tengo|tenemos|hay)$/;
const RE_TENES = /^(?:tenes|tienen|tienes|hay)\s+(.+)$/;
const RE_PRECIO_SIMPLE = /^precio\s+(.+)$/;
const RE_RECORDATORIOS = /\brecordatorios?\b|\bque tengo pendiente\b|\bpendientes\b|\btareas\b|\bque hay que hacer\b|\bque tengo que hacer\b/;
const RE_GANANCIAS = /gananc|\bmargen\b|\butilidad\b|\bgane\b|\bcuanto gano\b/;
// El nombre de lo que se vendió ("cuántas coca vendí hoy" → "coca"), sacando el "cuándo" de la pregunta.
function productoVendido(t, periodos) {
    let s = t;
    for (const p of periodos)
        s = s.replace(p.texto, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    const m = s.match(/^(?:cuant[oa]s?|que cantidad de)\s+(.+?)\s+(?:vendi|vendimos|vendiste|vendio|se vendieron|se vendio)(?:\s.*)?$/) ?? s.match(/\bvendi(?:mos)?\s+(?:de|del)\s+(.+)$/);
    if (!m)
        return null;
    const sujeto = limpiarSujeto(m[1]);
    // "cuánto vendí en total / en efectivo / de plata": eso no es un producto.
    if (!sujeto || /^(?:en total|total|plata|mercaderia|todo|de todo|en efectivo|en tarjeta|en transferencia|fiado|en fiado|por rubro)$/.test(sujeto) || lenguaje_1.METODOS.test(sujeto))
        return null;
    return sujeto;
}
const INTENCIONES = [
    // ----- charla -----
    {
        cuando: (t) => /\b(?:ayuda|que sabes hacer|que podes hacer|que puedes hacer|que (?:te )?puedo preguntar|como te uso|que haces)\b/.test(t),
        responder: async () => AYUDA,
    },
    {
        cuando: (t) => t.split(' ').length <= 5 &&
            /\b(?:gracias|genial|perfecto|buenisimo|excelente|joya|dale)\b/.test(t) &&
            !(0, lenguaje_1.tieneTema)(t.replace(/\b(?:gracias|genial|perfecto|buenisimo|excelente|joya|dale|muchas)\b/g, ' ')),
        responder: async () => '¡De nada! 😊 Para eso estoy. Si necesitás algo más del negocio, preguntame.',
    },
    {
        cuando: (t) => /^(?:chau|chao|adios|hasta luego|nos vemos|hasta manana)\b/.test(t),
        responder: async (_t, c) => `¡Chau${c.nombre ? `, ${c.nombre}` : ''}! Que tengas un lindo día. 👋`,
    },
    {
        cuando: (t) => /\bcomo (?:estas|andas|te va|va todo)\b/.test(t) && !(0, lenguaje_1.tieneTema)(t.replace(/\bcomo (?:estas|andas|te va|va todo)\b/, '')),
        responder: async () => '¡Muy bien, gracias por preguntar! 😊 ¿Qué querés saber del negocio?',
    },
    {
        cuando: (t) => /\bquien sos\b|\bcomo te llamas\b|\bque sos\b|\bquien eres\b/.test(t),
        responder: async () => 'Soy el asistente de Mis Amores. Miro los datos del negocio (ventas, stock, clientes, deudas) y te cuento lo que quieras saber. No puedo vender ni cambiar nada: sólo mirar.',
    },
    {
        cuando: (t) => RE_GANANCIAS.test(t) && !lenguaje_1.RE_DICE_VENTAS.test(t.replace(RE_GANANCIAS, '')),
        responder: async () => 'Las ganancias todavía no las calculo: dependen de los costos, que ve sólo la administradora en "Precios y costos". Lo que sí te puedo decir es cuánto vendiste: preguntame "¿cuánto vendí hoy?".',
    },
    // ----- comparaciones y resumen (comparar va primero: "comparado con ayer, ¿cómo me fue hoy?" es una comparación) -----
    {
        cuando: (t, c) => /\bcompar|\bvs\b|\brespecto\b/.test(t) || (c.periodos.length >= 1 && RE_COMPARA.test(t)),
        responder: async (t, c) => {
            // Con qué se compara: lo que viene después de "que", "con", "contra", "comparado con"...
            const esReferencia = (p) => new RegExp(`(?:\\bque|\\bcon|\\bcontra|\\bvs|\\brespecto (?:a|de)|\\bcomparad[oa] (?:con|a))\\s+(?:el |la |los |las )?${escaparRegExp(p.texto)}`).test(t);
            if (c.periodos.length >= 2) {
                const [p0, p1] = c.periodos;
                return esReferencia(p0) && !esReferencia(p1) ? compararPeriodos(p1, p0) : compararPeriodos(p0, p1);
            }
            const p = c.p ?? c.hoy;
            if (!esReferencia(p))
                return compararPeriodos(p, (0, periodos_1.periodoAnterior)(p, c.ahora));
            // "vendí más que AYER": el período nombrado es con lo que se compara, y se mira "hoy" (o el período en curso equivalente).
            const actual = (0, periodos_1.leerPeriodos)({ dia: 'hoy', 'semana-pasada': 'esta semana', 'mes-pasado': 'este mes', 'anio-pasado': 'este ano' }[p.tipo] ?? 'hoy', c.ahora)[0];
            return compararPeriodos(actual, p);
        },
    },
    {
        cuando: (t) => RE_DE_RESUMEN.test(t),
        responder: async (_t, c) => {
            const p = c.p ?? c.hoy;
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            if (p.etiqueta === 'Hoy') {
                const stats = await (0, dashboard_1.getDashboardStats)();
                const partes = [r.cantidadVentas === 0 ? `todavía no hay ventas hoy${avisoPagos(r.totalPagos)}` : frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas, r.totalPagos)];
                if (stats.sinStockCount > 0)
                    partes.push(`${stats.sinStockCount} artículo(s) sin stock`);
                if (stats.stockBajoCount > 0)
                    partes.push(`${stats.stockBajoCount} con stock bajo`);
                return `Hoy ${partes.join(', ')}.`;
            }
            const base = await ventasDelPeriodo(p);
            const anterior = (0, periodos_1.periodoAnterior)(p, c.ahora);
            const ra = await (0, reportes_1.getReporteVentas)(anterior.desde, anterior.hasta);
            if (r.totalVendido === 0 || ra.totalVendido === 0)
                return base;
            return `${base} Comparado con ${(0, periodos_1.enMinuscula)(anterior.etiqueta)}: ${diferencia(r.totalVendido, ra.totalVendido)}.`;
        },
    },
    // ----- ventas: más vendido, rubros, qué se vendió, mejor día, ticket -----
    {
        cuando: (t) => RE_MAS_VENDIDO.test(t) && !RE_RUBRO.test(t),
        responder: async (t, c) => {
            const p = c.p ?? (0, periodos_1.leerPeriodos)('ultimos 30 dias', c.ahora)[0];
            const [r, porUnidades] = await Promise.all([(0, reportes_1.getReporteVentas)(p.desde, p.hasta), (0, reportes_1.productosMasVendidos)(p.desde, p.hasta, 10, 'cantidad')]);
            if (r.topProductos.length === 0)
                return `No hay ventas ${(0, periodos_1.enMinuscula)(p.etiqueta)} para calcular esto.`;
            // "los 5 más vendidos": una lista.
            const cantidad = t.match(/\b(\d{1,2}|tres|cinco|diez)\b.*mas vendid|top\s+(\d{1,2})/);
            if (cantidad) {
                const n = Math.min(10, Number({ tres: 3, cinco: 5, diez: 10 }[cantidad[1]] ?? cantidad[1] ?? cantidad[2]) || 5);
                return unaLinea([
                    `${p.etiqueta}, lo más vendido por unidades:`,
                    ...porUnidades.slice(0, n).map((x, i) => `${i + 1}. ${x.descripcion}: ${(0, formato_1.formatearCantidad)(x.cantidad)} unidad(es) por ${(0, formato_1.formatearMoneda)(x.total)}`),
                ]);
            }
            // "Lo más vendido" son las unidades; el que más plata dejó puede ser otro (uno caro que se vendió poco).
            const masUnidades = porUnidades[0] ?? r.topProductos[0];
            const masPlata = r.topProductos[0];
            return (`${p.etiqueta}, lo más vendido fue "${masUnidades.descripcion}": ${(0, formato_1.formatearCantidad)(masUnidades.cantidad)} unidad(es) por ${(0, formato_1.formatearMoneda)(masUnidades.total)}.` +
                (masPlata.articuloId !== masUnidades.articuloId
                    ? ` El que más plata dejó fue "${masPlata.descripcion}": ${(0, formato_1.formatearMoneda)(masPlata.total)} (${(0, formato_1.formatearCantidad)(masPlata.cantidad)} unidad(es)).`
                    : ''));
        },
    },
    {
        cuando: (t) => RE_RUBRO.test(t) && (lenguaje_1.RE_DICE_VENTAS.test(t) || /\bmas\b/.test(t) || /por (?:rubro|categoria)/.test(t)),
        responder: async (t, c) => {
            const p = c.p ?? (0, periodos_1.leerPeriodos)('ultimos 30 dias', c.ahora)[0];
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            if (r.porRubro.length === 0)
                return `No hay ventas ${(0, periodos_1.enMinuscula)(p.etiqueta)} para calcular esto.`;
            if (/(?:rubro|categoria).*(?:mas vend|vend\w* mas|estrella)|que (?:rubro|categoria) (?:vende|vendio|se vende) mas/.test(t)) {
                const top = r.porRubro[0];
                return `${p.etiqueta}, el rubro que más vendió fue "${top.familiaNombre}", con ${(0, formato_1.formatearMoneda)(top.total)}.`;
            }
            return unaLinea([`${p.etiqueta}, ventas por rubro:`, ...r.porRubro.slice(0, 8).map((x) => `- ${x.familiaNombre}: ${(0, formato_1.formatearMoneda)(x.total)}`)]);
        },
    },
    {
        cuando: (t, c) => RE_QUE_VENDI.test(t) && !/\bmas\b/.test(t) && !productoVendido(t, c.periodos),
        responder: async (_t, c) => {
            const p = c.p ?? c.hoy;
            const lista = await (0, reportes_1.productosMasVendidos)(p.desde, p.hasta, 8, 'cantidad');
            if (lista.length === 0)
                return p.etiqueta === 'Hoy' ? 'Todavía no se vendió nada hoy.' : `${p.etiqueta} no se vendió nada.`;
            return unaLinea([`${p.etiqueta} se vendió:`, ...lista.map((x) => `- ${(0, formato_1.formatearCantidad)(x.cantidad)} × ${x.descripcion} (${(0, formato_1.formatearMoneda)(x.total)})`)]);
        },
    },
    {
        cuando: (t) => RE_MEJOR_DIA.test(t),
        responder: async (t, c) => {
            const p = c.p ?? (0, periodos_1.leerPeriodos)('ultimos 30 dias', c.ahora)[0];
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            const dias = r.porDia.filter((d) => d.cantidadVentas > 0);
            if (dias.length === 0)
                return `No hay ventas ${(0, periodos_1.enMinuscula)(p.etiqueta)}.`;
            const peor = /\bmenos\b|\bpeor\b/.test(t);
            const elegido = [...dias].sort((a, b) => (peor ? a.total - b.total : b.total - a.total))[0];
            const dia = (0, periodos_1.periodoDeUnDia)(new Date(`${elegido.fecha}T12:00:00`), c.ahora);
            return `${p.etiqueta}, el día que ${peor ? 'menos' : 'más'} vendiste fue ${(0, periodos_1.enMinuscula)(dia.etiqueta)}: ${(0, formato_1.formatearMoneda)(elegido.total)} en ${elegido.cantidadVentas} venta(s).`;
        },
    },
    {
        cuando: (t) => RE_TICKET.test(t),
        responder: async (_t, c) => {
            const p = c.p ?? (0, periodos_1.leerPeriodos)('ultimos 30 dias', c.ahora)[0];
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            if (r.cantidadVentas === 0)
                return `No hay ventas ${(0, periodos_1.enMinuscula)(p.etiqueta)}.`;
            return `${p.etiqueta}, cada compra salió en promedio ${(0, formato_1.formatearMoneda)(r.ticketPromedio)} (${r.cantidadVentas} compra(s)).`;
        },
    },
    {
        // Ventas por forma de pago
        cuando: (t) => (lenguaje_1.METODOS.test(t) && /vend|cobr|entr|ingres|recaud/.test(t)) || /metodo de pago|forma de pago|como vienen los pagos|por metodo/.test(t),
        responder: async (t, c) => {
            const p = c.p ?? c.hoy;
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            const metodo = t.match(lenguaje_1.METODOS)?.[1];
            if (metodo) {
                const fila = r.porMetodoPago.find((m) => m.metodoPago === metodo);
                if (!fila || fila.cantidad === 0)
                    return `${p.etiqueta} no hubo ventas en ${NOMBRES_METODO[metodo]}.`;
                return `${p.etiqueta} vendiste ${(0, formato_1.formatearMoneda)(fila.total)} en ${NOMBRES_METODO[metodo]} (${fila.cantidad} venta(s)).`;
            }
            if (r.porMetodoPago.length === 0)
                return p.etiqueta === 'Hoy' ? 'Todavía no hay ventas registradas hoy.' : `${p.etiqueta} no hubo ventas registradas.`;
            const detalle = r.porMetodoPago.map((m) => `${NOMBRES_METODO[m.metodoPago] ?? m.metodoPago}: ${(0, formato_1.formatearMoneda)(m.total)}`).join(', ');
            return `${p.etiqueta} por método de pago — ${detalle}.`;
        },
    },
    // ----- pagos de cuentas y fiados -----
    {
        cuando: (t) => RE_PAGOS.test(t),
        responder: async (_t, c) => {
            const p = c.p ?? c.hoy;
            const pagos = await pagosPorCliente(p.desde, p.hasta);
            const total = pagos.reduce((s, x) => s + x.total, 0);
            if (pagos.length === 0)
                return p.etiqueta === 'Hoy' ? 'Hoy todavía no te pagó nadie de su cuenta.' : `${p.etiqueta} no hubo pagos de cuentas.`;
            const cantidad = pagos.reduce((s, x) => s + x.cantidad, 0);
            return unaLinea([
                `${p.etiqueta} recibiste ${(0, formato_1.formatearMoneda)(total)} de pagos de cuentas (${cantidad} pago(s)):`,
                ...pagos.slice(0, 8).map((x) => `- ${x.nombre ?? 'Un cliente que ya no está'}: ${(0, formato_1.formatearMoneda)(x.total)}`),
            ]);
        },
    },
    {
        cuando: (t) => RE_FIADOS.test(t),
        responder: async (t, c) => {
            const p = c.p ?? c.hoy;
            const fiados = await fiadosPorCliente(p.desde, p.hasta);
            if (fiados.length === 0)
                return p.etiqueta === 'Hoy' ? 'Todavía no anotaron ningún fiado hoy.' : `${p.etiqueta} no se anotó ningún fiado.`;
            const compras = fiados.reduce((s, x) => s + x.compras.length, 0);
            const total = fiados.reduce((s, x) => s + x.total, 0);
            if (/cuantos/.test(t))
                return `${p.etiqueta} anotaron ${compras} venta(s) fiada(s), por ${(0, formato_1.formatearMoneda)(total)}.`;
            return unaLinea([
                `${p.etiqueta} le fiaste a ${fiados.length} ${plural(fiados.length, 'cliente', 'clientes')} (${(0, formato_1.formatearMoneda)(total)} en total):`,
                ...fiados.slice(0, 8).map((x) => `- ${x.nombre ?? 'Un cliente que ya no está'}: ${(0, formato_1.formatearMoneda)(x.total)}`),
            ]);
        },
    },
    // ----- deudas -----
    {
        cuando: (t) => RE_DEBE_MAS.test(t),
        responder: async () => {
            const deben = (await (0, clientes_1.listClientes)()).filter((c) => c.saldo > 0); // ya viene ordenado por saldo
            if (deben.length === 0)
                return 'Nadie tiene deuda pendiente ahora mismo. 🎉';
            const siguientes = deben.slice(1, 3).map((c) => `${c.nombre} (${(0, formato_1.formatearMoneda)(c.saldo)})`);
            return `El que más debe es ${deben[0].nombre}, con ${(0, formato_1.formatearMoneda)(deben[0].saldo)}.${siguientes.length > 0 ? ` Le siguen ${siguientes.join(' y ')}.` : ''}`;
        },
    },
    {
        cuando: (t) => RE_CUANTOS_DEBEN.test(t),
        responder: async () => {
            const deben = (await (0, clientes_1.listClientes)()).filter((c) => c.saldo > 0);
            if (deben.length === 0)
                return 'Nadie tiene deuda pendiente ahora mismo. 🎉';
            return `Te deben ${deben.length} ${plural(deben.length, 'cliente', 'clientes')}, por ${(0, formato_1.formatearMoneda)(deben.reduce((s, c) => s + c.saldo, 0))} en total.`;
        },
    },
    {
        cuando: (t) => RE_MAS_ANTIGUA.test(t),
        responder: async () => {
            const deben = (await (0, clientes_1.listClientes)()).filter((c) => c.saldo > 0 && c.deudaDesde);
            if (deben.length === 0)
                return 'Nadie tiene deuda pendiente ahora mismo. 🎉';
            const vieja = [...deben].sort((a, b) => (a.deudaDesde < b.deudaDesde ? -1 : 1))[0];
            return `El que debe hace más tiempo es ${vieja.nombre}: ${(0, formato_1.formatearMoneda)(vieja.saldo)}, desde el ${fechaCorta(vieja.deudaDesde)}.`;
        },
    },
    {
        cuando: (t) => RE_DEUDA_TOTAL.test(t),
        responder: async () => {
            const total = (await (0, clientes_1.listClientes)()).reduce((acc, c) => acc + Math.max(c.saldo, 0), 0);
            return `Entre todos los clientes te deben ${(0, formato_1.formatearMoneda)(total)} en total.`;
        },
    },
    {
        cuando: (t) => RE_QUIENES_DEBEN.test(t) && !seguimiento_1.RE_DEUDA_DE.test(t),
        responder: async () => {
            const deben = (await (0, clientes_1.listClientes)()).filter((c) => c.saldo > 0);
            if (deben.length === 0)
                return 'Nadie tiene deuda pendiente ahora mismo. 🎉';
            return unaLinea([
                `Te deben ${(0, formato_1.formatearMoneda)(deben.reduce((s, c) => s + c.saldo, 0))} entre ${deben.length} ${plural(deben.length, 'cliente', 'clientes')}:`,
                ...deben.slice(0, 8).map((c) => `- ${c.nombre}: ${(0, formato_1.formatearMoneda)(c.saldo)}${c.deudaDesde ? ` (desde el ${fechaCorta(c.deudaDesde)})` : ''}`),
                ...(deben.length > 8 ? [`... y ${deben.length - 8} más (están todos en Clientes (fiado)).`] : []),
            ]);
        },
    },
    {
        cuando: (t) => RE_DESDE_CUANDO.test(t),
        responder: async (t) => {
            const nombre = t.match(RE_DESDE_CUANDO)[1].trim();
            const clientes = await buscarClientes(nombre);
            if (clientes.length === 0)
                return `No encontré ningún cliente que se llame "${nombre}".`;
            return clientes
                .slice(0, 3)
                .map((c) => (c.saldo > 0 ? `${c.nombre} debe ${(0, formato_1.formatearMoneda)(c.saldo)}${c.deudaDesde ? ` desde el ${fechaCorta(c.deudaDesde)}` : ''}.` : `${c.nombre} no tiene deuda pendiente.`))
                .join('\n');
        },
    },
    {
        cuando: (t) => RE_TELEFONO.test(t) && !seguimiento_1.RE_PRODUCTO.test(t),
        responder: async (t) => {
            const nombre = t.match(RE_TELEFONO)[1].trim();
            const clientes = await buscarClientes(nombre);
            if (clientes.length === 0)
                return `No encontré ningún cliente que se llame "${nombre}".`;
            return clientes.slice(0, 3).map((c) => (c.telefono ? `El teléfono de ${c.nombre} es ${c.telefono}.` : `${c.nombre} no tiene un teléfono anotado.`)).join('\n');
        },
    },
    {
        cuando: (t) => seguimiento_1.RE_DEUDA_DE.test(t),
        responder: async (t) => {
            const nombreBuscado = t.match(seguimiento_1.RE_DEUDA_DE)[1].trim();
            const clientes = await buscarClientes(nombreBuscado);
            if (clientes.length === 0)
                return `No encontré ningún cliente que se llame "${nombreBuscado}".`;
            if (clientes.length > 1) {
                return unaLinea([`Encontré ${clientes.length} clientes que coinciden con "${nombreBuscado}":`, ...clientes.slice(0, 5).map((c) => `- ${c.nombre}: ${c.saldo > 0 ? `debe ${(0, formato_1.formatearMoneda)(c.saldo)}` : 'no tiene deuda pendiente'}`)]);
            }
            const cliente = clientes[0];
            if (cliente.saldo <= 0)
                return `${cliente.nombre} no tiene deuda pendiente.`;
            return `${cliente.nombre} debe ${(0, formato_1.formatearMoneda)(cliente.saldo)}.`;
        },
    },
    // ----- cuántas unidades de un producto se vendieron -----
    {
        cuando: (t, c) => productoVendido(t, c.periodos) !== null,
        responder: async (t, c) => {
            const p = c.p ?? c.hoy;
            const sujeto = productoVendido(t, c.periodos);
            const productos = await articulosParecidos(sujeto);
            if (productos.length === 0)
                return `No encontré ningún artículo que coincida con "${sujeto}".`;
            const vendidos = await vendidoDe(productos.slice(0, 30).map((a) => new mongodb_1.ObjectId(a.id)), p.desde, p.hasta);
            if (vendidos.length === 0)
                return `${p.etiqueta} no vendiste ${productos.length === 1 ? `"${productos[0].descripcion}"` : `nada que coincida con "${sujeto}"`}.`;
            if (vendidos.length === 1)
                return `${p.etiqueta} vendiste ${(0, formato_1.formatearCantidad)(vendidos[0].cantidad)} unidad(es) de "${vendidos[0].descripcion}" (${(0, formato_1.formatearMoneda)(vendidos[0].total)}).`;
            return unaLinea([`${p.etiqueta} vendiste, de lo que coincide con "${sujeto}":`, ...vendidos.slice(0, 6).map((v) => `- ${(0, formato_1.formatearCantidad)(v.cantidad)} × ${v.descripcion} (${(0, formato_1.formatearMoneda)(v.total)})`)]);
        },
    },
    {
        // "¿cuánto hay en la caja?": lo que entró en efectivo (lo que había antes en la caja no se registra).
        cuando: (t) => RE_CAJA.test(t),
        responder: async (_t, c) => {
            const p = c.p ?? c.hoy;
            const r = await (0, reportes_1.getReporteVentas)(p.desde, p.hasta);
            const efectivo = r.porMetodoPago.find((m) => m.metodoPago === 'efectivo')?.total ?? 0;
            const otros = r.totalCobrado - efectivo;
            return (`${p.etiqueta} entró ${(0, formato_1.formatearMoneda)(efectivo)} en efectivo` +
                (otros > 0 ? ` (y ${(0, formato_1.formatearMoneda)(otros)} por tarjeta o transferencia, que no está en la caja)` : '') +
                (r.totalPagos > 0 ? `; además recibiste ${(0, formato_1.formatearMoneda)(r.totalPagos)} de pagos de cuentas` : '') +
                '. La plata que ya había en la caja de antes no la registro.');
        },
    },
    // ----- ventas de un "cuándo" (la pregunta más común) -----
    {
        cuando: (t, c) => lenguaje_1.RE_DICE_VENTAS.test(t) || (c.p !== null && !(0, lenguaje_1.tieneTema)(t)),
        responder: async (_t, c) => ventasDelPeriodo(c.p ?? c.hoy),
        debil: (c) => c.p === null, // sin decir cuándo se supone que es hoy
    },
    // ----- productos y stock -----
    {
        cuando: (t) => RE_MAS_CARO.test(t),
        responder: async () => {
            const doc = await (0, database_1.getDb)().collection('articulos').find({ activo: true, precioVenta: { $gt: 0 } }).sort({ precioVenta: -1 }).limit(1).toArray();
            return doc.length === 0 ? 'No encontré artículos con precio cargado.' : `El más caro es "${doc[0].descripcion}", a ${(0, formato_1.formatearMoneda)(doc[0].precioVenta)}.`;
        },
    },
    {
        cuando: (t) => RE_MAS_BARATO.test(t),
        responder: async () => {
            const doc = await (0, database_1.getDb)().collection('articulos').find({ activo: true, precioVenta: { $gt: 0 } }).sort({ precioVenta: 1 }).limit(1).toArray();
            return doc.length === 0 ? 'No encontré artículos con precio cargado.' : `El más barato es "${doc[0].descripcion}", a ${(0, formato_1.formatearMoneda)(doc[0].precioVenta)}.`;
        },
    },
    {
        cuando: (t) => RE_REPONER.test(t),
        responder: async () => {
            const [sin, bajo] = await Promise.all([(0, articulos_1.listArticulos)({ soloSinStock: true }), (0, articulos_1.listArticulos)({ soloStockBajo: true })]);
            if (sin.length === 0 && bajo.length === 0)
                return 'No hay nada para reponer por ahora: ningún artículo sin stock ni con poco. 🎉';
            const lineas = [];
            if (sin.length > 0)
                lineas.push(`Sin stock (${sin.length}): ${enLista(sin.map((a) => a.descripcion), 8)}.`);
            if (bajo.length > 0)
                lineas.push(`Con poco stock (${bajo.length}): ${enLista([...bajo].sort((a, b) => a.stock - b.stock).map((a) => `${a.descripcion} (${(0, formato_1.formatearCantidad)(a.stock)})`), 8)}.`);
            return unaLinea(['Para reponer:', ...lineas, 'Los ves completos en Artículos y stock, con los botones "Sin stock" y "Stock bajo".']);
        },
    },
    {
        cuando: (t) => RE_SIN_STOCK.test(t),
        responder: async () => {
            const sin = await (0, articulos_1.listArticulos)({ soloSinStock: true });
            if (sin.length === 0)
                return 'No hay ningún artículo sin stock ahora mismo. 🎉';
            return `Tenés ${sin.length} artículo(s) sin stock: ${enLista(sin.map((a) => a.descripcion), 10)}. Los ves en Artículos y stock, con el botón "Sin stock".`;
        },
    },
    {
        cuando: (t) => RE_STOCK_BAJO.test(t),
        responder: async () => {
            const bajo = await (0, articulos_1.listArticulos)({ soloStockBajo: true });
            if (bajo.length === 0)
                return 'No hay artículos con stock bajo ahora mismo. 🎉';
            const nombres = [...bajo].sort((a, b) => a.stock - b.stock).map((a) => `${a.descripcion} (${(0, formato_1.formatearCantidad)(a.stock)})`);
            return `Tenés ${bajo.length} artículo(s) con stock bajo (quedan pocos): ${enLista(nombres, 10)}. Los podés ver en Artículos y stock, con el botón "Stock bajo".`;
        },
    },
    {
        cuando: (t) => RE_PARA_REVISAR.test(t),
        responder: async () => {
            const revisar = await (0, articulos_1.listArticulos)({ soloParaRevisar: true });
            if (revisar.length === 0)
                return 'No hay ningún artículo para contar: ninguno se vendió sin tener stock cargado. 🎉';
            return `Hay ${revisar.length} artículo(s) para contar (se vendieron sin stock cargado): ${enLista(revisar.map((a) => `${a.descripcion} (${(0, formato_1.formatearCantidad)(a.stock)})`), 10)}. Los corregís en Contar inventario.`;
        },
    },
    {
        cuando: (t) => RE_VALOR_INVENTARIO.test(t),
        responder: async () => `El inventario vale ${(0, formato_1.formatearMoneda)((await (0, dashboard_1.getDashboardStats)()).valorInventarioVenta)} a precio de venta.`,
    },
    {
        cuando: (t) => RE_TOTAL_ARTICULOS.test(t),
        responder: async () => `Tenés ${(await (0, dashboard_1.getDashboardStats)()).totalArticulos} artículo(s) activos cargados.`,
    },
    {
        cuando: (t) => RE_CUANTOS_CLIENTES.test(t),
        responder: async () => `Tenés ${(await (0, clientes_1.listClientes)()).length} cliente(s) cargado(s).`,
    },
    {
        cuando: (t) => RE_CODIGO.test(t),
        responder: async (t) => {
            const sujeto = limpiarSujeto(t.match(RE_CODIGO)[1]);
            const encontrados = await articulosParecidos(sujeto);
            if (encontrados.length === 0)
                return `No encontré ningún artículo que coincida con "${sujeto}".`;
            return unaLinea(encontrados.slice(0, 4).map((a) => (a.codigoBarras ? `"${a.descripcion}": código de barras ${a.codigoBarras}.` : `"${a.descripcion}" todavía no tiene código de barras.`)));
        },
    },
    {
        // Precio / stock de un producto puntual — se deja cerca del final para no taparle el paso a las preguntas más específicas.
        cuando: (t) => seguimiento_1.RE_PRODUCTO.test(t) || RE_QUEDAN.test(t) || RE_TENES.test(t) || RE_PRECIO_SIMPLE.test(t),
        responder: async (t) => {
            const m = t.match(seguimiento_1.RE_PRODUCTO) ?? t.match(RE_QUEDAN) ?? t.match(RE_TENES) ?? t.match(RE_PRECIO_SIMPLE);
            return datosDeProducto(m[1]);
        },
    },
    {
        cuando: (t) => RE_RECORDATORIOS.test(t),
        responder: async () => {
            const lista = await (0, recordatorios_1.listRecordatorios)('pendientes');
            if (lista.length === 0)
                return 'No tenés recordatorios pendientes. 🎉';
            const orden = [...lista].sort((a, b) => Number(b.urgente) - Number(a.urgente));
            return unaLinea([
                `Tenés ${lista.length} recordatorio(s) pendiente(s):`,
                ...orden.slice(0, 6).map((r) => `- ${r.urgente ? '(urgente) ' : ''}${r.texto.length > 90 ? `${r.texto.slice(0, 90)}…` : r.texto}${r.paraFecha ? ` — para el ${fechaCorta(`${r.paraFecha}T12:00:00`)}` : ''}`),
                ...(lista.length > 6 ? [`... y ${lista.length - 6} más (están en Recordatorios).`] : []),
            ]);
        },
    },
];
function saludar(c) {
    const hora = c.ahora.getHours();
    const saludo = hora >= 5 && hora < 12 ? '¡Buen día' : hora < 20 ? '¡Buenas tardes' : '¡Buenas noches';
    return `${saludo}${c.nombre ? `, ${c.nombre}` : ''}! 😊 ${AYUDA}`;
}
// Entiende UNA pregunta (ya normalizada): el texto de la respuesta (y si es una suposición), o null si no la entendió.
async function entender(q, base) {
    let t = q;
    const saludo = t.match(RE_SALUDO);
    if (saludo) {
        t = t
            .slice(saludo[0].length)
            .replace(/^[\s,.:;]+/, '')
            .replace(/^(?:que tal|como (?:estas|andas|va))\b/, '')
            .replace(/^[\s,.:;]+/, '')
            .trim();
        if (!t)
            return { texto: saludar(base), debil: false };
    }
    const periodos = (0, periodos_1.leerPeriodos)(t, base.ahora);
    const ctx = { ...base, periodos, p: periodos[0] ?? null, hoy: (0, periodos_1.periodoDeUnDia)(new Date(base.ahora), base.ahora) };
    for (const intencion of INTENCIONES) {
        if (intencion.cuando(t, ctx))
            return { texto: await intencion.responder(t, ctx), debil: intencion.debil?.(ctx) === true };
    }
    return null;
}
// Los "cuándo" de una pregunta, en una sola cadena (para ver si dos versiones de la pregunta entienden lo mismo).
const cuandos = (q, ahora) => (0, periodos_1.leerPeriodos)(q, ahora)
    .map((p) => `${p.tipo}|${p.desde}|${p.hasta}`)
    .join(';');
// Cuando no se entendió: tres ejemplos del tema que parece (o los de siempre).
function noEntendi(q) {
    const ejemplos = [];
    const sugerir = (patron, lista) => {
        if (patron.test(q))
            ejemplos.push(...lista);
    };
    sugerir(/stock|queda|falta|repon|agot|mercader/, ['"¿Qué tiene poco stock?"', '"¿Qué tengo que reponer?"', '"¿Hay stock de [producto]?"']);
    sugerir(/deb|deuda|fiad|cuenta|cobrar|cliente/, ['"¿Quién me debe?"', '"¿Cuánto me debe [cliente]?"', '"¿A quién le fié hoy?"']);
    sugerir(/vend|venta|cobr|caja|plata|dinero|factur|gan/, ['"¿Cuánto vendí hoy?"', '"¿Cuánto vendí la semana pasada?"', '"¿Vendí más que ayer?"']);
    sugerir(/precio|cuesta|vale|caro|barato|sale/, ['"¿Cuánto cuesta [producto]?"', '"¿Cuál es el producto más caro?"']);
    const parecidos = ejemplos.length > 0 ? ` Quizás querías preguntar algo como: ${[...new Set(ejemplos)].slice(0, 3).join(', ')}.` : '';
    return `No entendí esa pregunta.${parecidos} ${AYUDA}`;
}
/**
 * Contesta una pregunta en lenguaje natural con los datos de la base.
 * `historial`: lo que ya se habló (para entender "¿y ayer?" o "¿y en efectivo?").
 */
async function responderPregunta(preguntaOriginal, historial = [], opciones = {}) {
    const q0 = (0, lenguaje_1.canonico)(typeof preguntaOriginal === 'string' ? preguntaOriginal : '');
    if (!q0)
        return { texto: AYUDA, reconocida: false };
    try {
        const ahora = opciones.ahora ?? new Date();
        const base = { ahora, nombre: opciones.nombre };
        const anteriores = (Array.isArray(historial) ? historial : [])
            .filter((m) => !!m && m.rol === 'usuario' && typeof m.texto === 'string')
            .slice(-6)
            .map((m) => (0, lenguaje_1.canonico)(m.texto))
            .filter(Boolean);
        const completa = (0, seguimiento_1.resolverSeguimiento)(q0, anteriores, ahora);
        // Primero la pregunta tal cual (completada si era un seguimiento); si no se entiende, con los errores de tipeo arreglados.
        const intentos = [completa, q0, completa ? (0, lenguaje_1.corregirTipeos)(completa) : null, (0, lenguaje_1.corregirTipeos)(q0)].filter((x) => !!x);
        const probados = new Set();
        let suposicion = null;
        for (const q of intentos) {
            if (probados.has(q))
                continue;
            probados.add(q);
            const respuesta = await entender(q, base);
            if (respuesta === null)
                continue;
            if (!respuesta.debil) {
                // Si arreglar un error de tipeo cambia el "cuándo" ("el mes pasdo" se leía como "el mes"), vale la versión arreglada.
                const arreglada = (0, lenguaje_1.corregirTipeos)(q, lenguaje_1.PALABRAS_DE_CUANDO);
                if (arreglada !== q && cuandos(arreglada, ahora) !== cuandos(q, ahora)) {
                    const mejor = await entender(arreglada, base);
                    if (mejor && !mejor.debil)
                        return { texto: mejor.texto, reconocida: true };
                }
                return { texto: respuesta.texto, reconocida: true };
            }
            suposicion ?? (suposicion = respuesta.texto); // una suposición ("cuánto vendí" → hoy) vale si con el tipeo arreglado no se entiende algo mejor
        }
        if (suposicion !== null)
            return { texto: suposicion, reconocida: true };
        return { texto: noEntendi(q0), reconocida: false };
    }
    catch (err) {
        console.error('[asistente simple]', err);
        return { texto: 'Uy, algo falló buscando esa info. Probá de nuevo en un toque.', reconocida: false };
    }
}
