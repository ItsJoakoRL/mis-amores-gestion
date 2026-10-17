"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sugerirRubro = sugerirRubro;
exports.responderPregunta = responderPregunta;
const database_1 = require("../db/database");
const dashboard_1 = require("./dashboard");
const reportes_1 = require("./reportes");
const ventas_1 = require("./ventas");
const clientes_1 = require("./clientes");
const articulos_1 = require("./articulos");
const fechaLocal_1 = require("../fechaLocal");
const formato_1 = require("../../shared/formato");
function normalizar(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // saca tildes: "cuanto" queda sin acento
        .trim();
}
function tokenizar(texto) {
    return normalizar(texto)
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
// ---------- Chat de preguntas frecuentes ----------
const NOMBRES_METODO = {
    efectivo: 'efectivo',
    tarjeta: 'tarjeta',
    transferencia: 'transferencia',
    fiado: 'fiado',
};
async function buscarClientePorNombre(nombreBuscado) {
    const clientes = await (0, clientes_1.listClientes)();
    const buscado = normalizar(nombreBuscado);
    if (!buscado)
        return null;
    // Primero intenta un match exacto de algún nombre completo, después uno
    // parcial (por si preguntan solo el nombre de pila).
    return (clientes.find((c) => normalizar(c.nombre) === buscado) ??
        clientes.find((c) => normalizar(c.nombre).includes(buscado) || buscado.includes(normalizar(c.nombre))) ??
        null);
}
// Frase de ventas que separa lo cobrado (efectivo/tarjeta/transferencia) de
// lo fiado — nunca hay que sumarlos como si fuera la misma plata: un fiado
// es una deuda, no algo que entró en la caja.
function frasearVentas(cobrado, fiado, cantidad) {
    if (fiado === 0)
        return `${(0, formato_1.formatearMoneda)(cobrado)} cobrado en ${cantidad} venta(s)`;
    return `${(0, formato_1.formatearMoneda)(cobrado)} cobrado y ${(0, formato_1.formatearMoneda)(fiado)} fiado (sin cobrar) en ${cantidad} venta(s)`;
}
async function contarFiadosHoy() {
    const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocal)(0);
    return (0, database_1.getDb)()
        .collection('ventas')
        .countDocuments({ metodoPago: 'fiado', fecha: { $gte: desde, $lt: hasta } });
}
const AYUDA = 'Te puedo contestar cosas como: "¿cuánto vendí hoy?", "¿cuánto vendí ayer?", ' +
    '"¿cuánto vendí en efectivo hoy?", "¿qué tiene poco stock?", "¿cuánto cuesta [producto]?", ' +
    '"¿hay stock de [producto]?", "¿cuánto me debe [nombre]?", "¿quién me debe más?", ' +
    '"¿cuál es el producto más vendido?", "¿qué rubro vende más?", "¿cuál es el artículo más caro?" ' +
    'o "¿cómo estuvo el día?".';
async function responderPregunta(preguntaOriginal) {
    const pregunta = normalizar(preguntaOriginal);
    if (!pregunta) {
        return { texto: AYUDA, reconocida: false };
    }
    try {
        // Resumen del día — antes de las preguntas puntuales de "ventas hoy",
        // porque si no la frase "como estuvo el dia" también contiene "dia" y
        // podría confundirse con otra cosa.
        if (/como (estuvo|viene|va) el dia|resumen del dia|resumen de hoy/.test(pregunta)) {
            const [r, stats] = await Promise.all([(0, ventas_1.resumenHoy)(), (0, dashboard_1.getDashboardStats)()]);
            const partes = [
                r.cantidadVentas === 0 ? 'todavía no hay ventas hoy' : frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas),
            ];
            if (stats.sinStockCount > 0)
                partes.push(`${stats.sinStockCount} artículo(s) sin stock`);
            if (stats.stockBajoCount > 0)
                partes.push(`${stats.stockBajoCount} con stock bajo`);
            return { texto: `Hoy ${partes.join(', ')}.`, reconocida: true };
        }
        // Ventas por método de pago — se revisa antes que "ventas de hoy" a
        // secas, porque "cuánto vendí en efectivo hoy" también matchearía esa
        // otra regla si la dejáramos pasar primero.
        const matchMetodo = pregunta.match(/(efectivo|tarjeta|transferencia|fiado)/);
        if (matchMetodo && /vend|cobr|entr/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocal)(0);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            const metodo = matchMetodo[1];
            const fila = r.porMetodoPago.find((m) => m.metodoPago === metodo);
            if (!fila || fila.cantidad === 0) {
                return { texto: `Hoy no hubo ventas en ${NOMBRES_METODO[metodo]}.`, reconocida: true };
            }
            return {
                texto: `Hoy vendiste ${(0, formato_1.formatearMoneda)(fila.total)} en ${NOMBRES_METODO[metodo]} (${fila.cantidad} venta(s)).`,
                reconocida: true,
            };
        }
        if (/metodo de pago|como vienen los pagos|por metodo/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocal)(0);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.porMetodoPago.length === 0) {
                return { texto: 'Todavía no hay ventas registradas hoy.', reconocida: true };
            }
            const detalle = r.porMetodoPago
                .map((m) => `${NOMBRES_METODO[m.metodoPago] ?? m.metodoPago}: ${(0, formato_1.formatearMoneda)(m.total)}`)
                .join(', ');
            return { texto: `Hoy por método de pago — ${detalle}.`, reconocida: true };
        }
        // Ventas de ayer
        if (/vend.*ayer|ayer.*vend/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocal)(1);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.cantidadVentas === 0)
                return { texto: 'Ayer no hubo ventas registradas.', reconocida: true };
            return {
                texto: `Ayer ${frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas)}.`,
                reconocida: true,
            };
        }
        // Ventas de hoy
        if (/vend.*hoy|hoy.*vend|ventas de hoy/.test(pregunta)) {
            const r = await (0, ventas_1.resumenHoy)();
            if (r.cantidadVentas === 0)
                return { texto: 'Todavía no hay ventas registradas hoy.', reconocida: true };
            return {
                texto: `Hoy ${frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas)}.`,
                reconocida: true,
            };
        }
        // Ventas de la semana
        if (/vend.*semana|semana.*vend/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesUltimosDiasLocal)(7);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.cantidadVentas === 0)
                return { texto: 'No hay ventas registradas en los últimos 7 días.', reconocida: true };
            return {
                texto: `En los últimos 7 días ${frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas)}. Ticket promedio: ${(0, formato_1.formatearMoneda)(r.ticketPromedio)}.`,
                reconocida: true,
            };
        }
        // Ventas del mes
        if (/vend.*mes|mes.*vend/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesUltimosDiasLocal)(30);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.cantidadVentas === 0)
                return { texto: 'No hay ventas registradas en los últimos 30 días.', reconocida: true };
            return {
                texto: `En los últimos 30 días ${frasearVentas(r.totalCobrado, r.totalFiado, r.cantidadVentas)}. Ticket promedio: ${(0, formato_1.formatearMoneda)(r.ticketPromedio)}.`,
                reconocida: true,
            };
        }
        // Producto más vendido
        if (/mas vendid|top.*producto|que se vende mas|producto estrella/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesUltimosDiasLocal)(30);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.topProductos.length === 0) {
                return { texto: 'Todavía no hay ventas en los últimos 30 días para calcular esto.', reconocida: true };
            }
            const top = r.topProductos[0];
            return {
                texto: `En los últimos 30 días, lo más vendido fue "${top.descripcion}": ${(0, formato_1.formatearCantidad)(top.cantidad)} unidad(es) por ${(0, formato_1.formatearMoneda)(top.total)}.`,
                reconocida: true,
            };
        }
        // Rubro que más vende
        if (/rubro.*(mas vend|estrella)|que rubro vende mas|categoria.*mas vend/.test(pregunta)) {
            const { desde, hasta } = (0, fechaLocal_1.limitesUltimosDiasLocal)(30);
            const r = await (0, reportes_1.getReporteVentas)(desde, hasta);
            if (r.porRubro.length === 0) {
                return { texto: 'Todavía no hay ventas en los últimos 30 días para calcular esto.', reconocida: true };
            }
            const top = r.porRubro[0];
            return {
                texto: `En los últimos 30 días, el rubro que más vendió fue "${top.familiaNombre}", con ${(0, formato_1.formatearMoneda)(top.total)}.`,
                reconocida: true,
            };
        }
        // Artículo más caro / más barato
        if (/(articulo|producto).*mas car|mas car.*(articulo|producto)/.test(pregunta)) {
            const doc = await (0, database_1.getDb)().collection('articulos').find({ activo: true, precioVenta: { $gt: 0 } }).sort({ precioVenta: -1 }).limit(1).toArray();
            if (doc.length === 0)
                return { texto: 'No encontré artículos con precio cargado.', reconocida: true };
            return {
                texto: `El más caro es "${doc[0].descripcion}", a ${(0, formato_1.formatearMoneda)(doc[0].precioVenta)}.`,
                reconocida: true,
            };
        }
        if (/(articulo|producto).*mas barat|mas barat.*(articulo|producto)/.test(pregunta)) {
            const doc = await (0, database_1.getDb)().collection('articulos').find({ activo: true, precioVenta: { $gt: 0 } }).sort({ precioVenta: 1 }).limit(1).toArray();
            if (doc.length === 0)
                return { texto: 'No encontré artículos con precio cargado.', reconocida: true };
            return {
                texto: `El más barato es "${doc[0].descripcion}", a ${(0, formato_1.formatearMoneda)(doc[0].precioVenta)}.`,
                reconocida: true,
            };
        }
        // Sin stock
        if (/sin stock|se acab|agotad/.test(pregunta)) {
            const stats = await (0, dashboard_1.getDashboardStats)();
            if (stats.sinStockCount === 0)
                return { texto: 'No hay ningún artículo sin stock ahora mismo. 🎉', reconocida: true };
            return {
                texto: `Tenés ${stats.sinStockCount} artículo(s) sin stock. Fijate en Artículos y stock, filtrando por "Stock bajo".`,
                reconocida: true,
            };
        }
        // Stock bajo
        if (/stock bajo|poco stock|falta.*stock|que falta/.test(pregunta)) {
            const stats = await (0, dashboard_1.getDashboardStats)();
            if (stats.stockBajoCount === 0)
                return { texto: 'No hay artículos con stock bajo ahora mismo. 🎉', reconocida: true };
            return {
                texto: `Tenés ${stats.stockBajoCount} artículo(s) con stock bajo o mínimo. Los podés ver en Artículos y stock, con el filtro "Stock bajo".`,
                reconocida: true,
            };
        }
        // Valor del inventario
        if (/valor.*inventario|cuanto vale.*(inventario|stock|mercaderia)/.test(pregunta)) {
            const stats = await (0, dashboard_1.getDashboardStats)();
            return {
                texto: `El inventario vale ${(0, formato_1.formatearMoneda)(stats.valorInventarioVenta)} a precio de venta.`,
                reconocida: true,
            };
        }
        // Total de artículos
        if (/cuantos articulos|total.*articulos|articulos cargados/.test(pregunta)) {
            const stats = await (0, dashboard_1.getDashboardStats)();
            return { texto: `Tenés ${stats.totalArticulos} artículo(s) activos cargados.`, reconocida: true };
        }
        // Cuántos clientes
        if (/cuantos clientes|total.*clientes/.test(pregunta)) {
            const clientes = await (0, clientes_1.listClientes)();
            return { texto: `Tenés ${clientes.length} cliente(s) cargado(s).`, reconocida: true };
        }
        // Quién debe más
        if (/quien.*(debe mas|mayor deuda)|mayor deudor/.test(pregunta)) {
            const clientes = await (0, clientes_1.listClientes)();
            const conDeuda = clientes.filter((c) => c.saldo > 0);
            if (conDeuda.length === 0)
                return { texto: 'Nadie tiene deuda pendiente ahora mismo. 🎉', reconocida: true };
            const top = conDeuda[0]; // listClientes ya viene ordenado por saldo desc
            return {
                texto: `El que más debe es ${top.nombre}, con ${(0, formato_1.formatearMoneda)(top.saldo)}.`,
                reconocida: true,
            };
        }
        // Deuda total
        if (/deuda total|total.*deuda|cuanto me deben en total/.test(pregunta)) {
            const clientes = await (0, clientes_1.listClientes)();
            const total = clientes.reduce((acc, c) => acc + Math.max(c.saldo, 0), 0);
            return { texto: `Entre todos los clientes te deben ${(0, formato_1.formatearMoneda)(total)} en total.`, reconocida: true };
        }
        // Cuánto debe [nombre] / deuda de [nombre]
        const matchDeuda = pregunta.match(/(?:cuanto.*debe|deuda de|debe)\s+([a-z\s]+)\??$/);
        if (matchDeuda) {
            const nombreBuscado = matchDeuda[1].trim();
            const cliente = await buscarClientePorNombre(nombreBuscado);
            if (!cliente) {
                return { texto: `No encontré ningún cliente que se llame "${nombreBuscado}".`, reconocida: true };
            }
            if (cliente.saldo <= 0) {
                return { texto: `${cliente.nombre} no tiene deuda pendiente.`, reconocida: true };
            }
            return { texto: `${cliente.nombre} debe ${(0, formato_1.formatearMoneda)(cliente.saldo)}.`, reconocida: true };
        }
        // Cuántos fiados hoy
        if (/cuantos fiados|fiados de hoy|fiados hoy/.test(pregunta)) {
            const cantidad = await contarFiadosHoy();
            if (cantidad === 0)
                return { texto: 'Todavía no anotaron ningún fiado hoy.', reconocida: true };
            return { texto: `Hoy anotaron ${cantidad} venta(s) fiada(s).`, reconocida: true };
        }
        // Precio / stock de un producto puntual — se deja cerca del final para
        // no taparle el paso a las preguntas más específicas de arriba.
        const matchProducto = pregunta.match(/(?:precio de|cuanto cuesta|cuanto sale|cuanto vale|stock de|hay stock de)\s+(.+?)\??$/);
        if (matchProducto) {
            const nombreBuscado = matchProducto[1].trim();
            const encontrados = await (0, articulos_1.listArticulos)({ busqueda: nombreBuscado });
            if (encontrados.length === 0) {
                return { texto: `No encontré ningún artículo que coincida con "${nombreBuscado}".`, reconocida: true };
            }
            const a = encontrados[0];
            const aviso = encontrados.length > 1 ? ` (encontré ${encontrados.length} parecidos, te paso el primero)` : '';
            // Un stock en negativo es un producto que se vendió sin stock registrado.
            const stockTexto = a.stock < 0
                ? `el sistema no tenía stock cargado y se vendió igual (figura ${(0, formato_1.formatearCantidad)(a.stock)}): conviene contarlo`
                : `stock ${(0, formato_1.formatearCantidad)(a.stock)}`;
            return {
                texto: `"${a.descripcion}": ${(0, formato_1.formatearMoneda)(a.precioVenta)}, ${stockTexto}.${aviso}`,
                reconocida: true,
            };
        }
        // Saludo / ayuda
        if (/^(hola|buenas|ayuda|que podes hacer|help|hey)/.test(pregunta)) {
            return { texto: `¡Hola! ${AYUDA}`, reconocida: true };
        }
        return { texto: `No entendí esa pregunta. ${AYUDA}`, reconocida: false };
    }
    catch (err) {
        return {
            texto: 'Uy, algo falló buscando esa info. Probá de nuevo en un toque.',
            reconocida: false,
        };
    }
}
