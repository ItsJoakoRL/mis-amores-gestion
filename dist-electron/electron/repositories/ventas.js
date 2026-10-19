"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crearVenta = crearVenta;
exports.marcarFiadoPagado = marcarFiadoPagado;
exports.eliminarVenta = eliminarVenta;
exports.listVentasPorDia = listVentasPorDia;
exports.resumenMes = resumenMes;
exports.listUltimosFiados = listUltimosFiados;
exports.resumenHoy = resumenHoy;
const crypto_1 = __importDefault(require("crypto"));
const mongodb_1 = require("mongodb");
const database_1 = require("../db/database");
const articulos_1 = require("./articulos");
const clientes_1 = require("./clientes");
const fechaLocal_1 = require("../fechaLocal");
const formato_1 = require("../../shared/formato");
const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia', 'fiado'];
function coleccion() {
    return (0, database_1.getDb)().collection('ventas');
}
function mapDoc(doc) {
    return {
        id: doc._id.toHexString(),
        articuloId: doc.articuloId.toHexString(),
        articuloDescripcion: doc.articuloDescripcion,
        cantidad: doc.cantidad,
        precioUnitario: doc.precioUnitario,
        total: doc.total,
        metodoPago: doc.metodoPago,
        clienteId: doc.clienteId ? doc.clienteId.toHexString() : null,
        clienteNombre: doc.cliente?.[0]?.nombre ?? null,
        usuarioId: doc.usuarioId.toHexString(),
        usuarioNombre: doc.usuario?.[0]?.nombre ?? null,
        fecha: doc.fecha,
        pagado: doc.pagado ?? false,
    };
}
const JOIN_USUARIO = { $lookup: { from: 'usuarios', localField: 'usuarioId', foreignField: '_id', as: 'usuario' } };
const JOIN_CLIENTE = { $lookup: { from: 'clientes', localField: 'clienteId', foreignField: '_id', as: 'cliente' } };
// Registrar una venta descuenta el stock del artículo (como un egreso más, así
// queda también en su historial de movimientos) y guarda una "foto" del
// nombre y precio del momento — si después cambian el precio o el artículo,
// esta venta vieja no se altera.
async function crearVenta(input, usuarioId) {
    // "!(x > 0)" en vez de "x <= 0": así también frena un NaN o algo que ni
    // siquiera es un número (con "<= 0" un NaN pasaba y dejaba el stock en NaN).
    if (typeof input.cantidad !== 'number' || !(input.cantidad > 0) || !Number.isFinite(input.cantidad)) {
        throw new Error('La cantidad tiene que ser mayor a cero');
    }
    if (!METODOS_PAGO.includes(input.metodoPago)) {
        throw new Error('La forma de pago no es válida');
    }
    if (input.metodoPago === 'fiado' && !input.clienteId) {
        throw new Error('Para una venta fiada hay que elegir a qué cliente se le anota');
    }
    if (input.metodoPago === 'fiado' && !(await (0, clientes_1.existeClienteActivo)(input.clienteId))) {
        throw new Error('Ese cliente ya no está en la lista: elegí otro');
    }
    const articulo = await (0, articulos_1.getArticulo)(input.articuloId);
    if (!articulo) {
        throw new Error('El artículo no existe');
    }
    // Un artículo en la papelera conserva su código de barras: sin esta
    // revisión se lo podía escanear y vender como si siguiera activo.
    if (!articulo.activo) {
        throw new Error(`"${articulo.descripcion}" está en la papelera: no se puede vender`);
    }
    if (articulo.unidad !== 'peso' && !Number.isInteger(input.cantidad)) {
        throw new Error(`"${articulo.descripcion}" se vende por unidad: la cantidad tiene que ser un número entero`);
    }
    const cantidad = (0, formato_1.redondearCantidad)(input.cantidad);
    // El descuento de stock va primero, así nunca se registra una venta de algo
    // que no se pudo descontar. Si el sistema dice que no queda stock se vende
    // igual (el producto está en la mano: el que se equivocó es el stock cargado):
    // queda en negativo y aparece en "Para revisar" hasta que se lo cuente.
    await (0, articulos_1.ajustarStock)(input.articuloId, cantidad, 'egreso', 'Venta', usuarioId, undefined, { permitirNegativo: true });
    const doc = {
        articuloId: new mongodb_1.ObjectId(input.articuloId),
        articuloDescripcion: articulo.descripcion,
        cantidad,
        precioUnitario: articulo.precioVenta,
        total: Math.round(articulo.precioVenta * cantidad * 100) / 100,
        metodoPago: input.metodoPago,
        clienteId: input.clienteId ? new mongodb_1.ObjectId(input.clienteId) : null,
        usuarioId: new mongodb_1.ObjectId(usuarioId),
        fecha: new Date().toISOString(),
    };
    try {
        const result = await coleccion().insertOne(doc);
        const guardada = await coleccion()
            .aggregate([{ $match: { _id: result.insertedId } }, JOIN_USUARIO, JOIN_CLIENTE])
            .toArray();
        return mapDoc(guardada[0]);
    }
    catch (err) {
        // El stock ya se había descontado para esta venta — si no se pudo
        // guardar el registro (ej. se cortó la conexión a la base a mitad de
        // camino), lo reponemos para no dejar el inventario corto sin ninguna
        // venta que lo explique.
        await (0, articulos_1.ajustarStock)(input.articuloId, cantidad, 'ingreso', 'Venta no se pudo guardar, stock repuesto', usuarioId).catch(() => { });
        throw err;
    }
}
// Marca (o desmarca) un fiado puntual como pagado — deja de contar para la
// deuda del cliente (ver listClientes en clientes.ts), pero el registro
// sigue en el historial para que quede memoria de qué se compró.
async function marcarFiadoPagado(id, pagado) {
    const result = await coleccion().updateOne({ _id: new mongodb_1.ObjectId(id), metodoPago: 'fiado' }, { $set: { pagado: pagado === true } });
    if (result.matchedCount === 0) {
        throw new Error('No se encontró ese fiado');
    }
}
// Deshacer una venta: borra el registro y repone el stock (como un ingreso,
// a nombre de quien la anuló). El borrado va primero y es atómico: si dos
// personas anulan la misma venta casi a la vez, sólo una la encuentra — antes
// las dos reponían el stock y quedaba inflado.
async function eliminarVenta(id, usuarioId) {
    const venta = await coleccion().findOneAndDelete({ _id: new mongodb_1.ObjectId(id) });
    if (!venta)
        return;
    try {
        const articuloId = venta.articuloId.toHexString();
        if (await (0, articulos_1.getArticulo)(articuloId)) {
            // El movimiento de reposición tiene un _id que sale de la venta: si dos
            // PCs anulan la misma venta a la vez (antes de enterarse una de la otra),
            // las dos generan el MISMO movimiento y el stock se repone una sola vez.
            const idMovimiento = new mongodb_1.ObjectId(crypto_1.default.createHash('sha1').update(`anulacion:${id}`).digest().subarray(0, 12));
            await (0, articulos_1.ajustarStock)(articuloId, venta.cantidad, 'ingreso', 'Venta anulada', usuarioId, idMovimiento);
        }
    }
    catch (err) {
        // No se pudo reponer el stock: se vuelve a guardar la venta tal cual
        // estaba, mejor que una venta borrada sin su stock devuelto.
        await coleccion()
            .insertOne(venta)
            .catch(() => { });
        throw err;
    }
}
async function listVentasPorDia(fechaYMD) {
    const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocalYMD)(fechaYMD);
    const docs = await coleccion()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        JOIN_USUARIO,
        JOIN_CLIENTE,
        { $sort: { fecha: 1 } },
    ])
        .toArray();
    return docs.map(mapDoc);
}
// Suma condicional: separa lo que fue fiado (no es plata en la caja) de lo
// que sí se cobró (efectivo, tarjeta o transferencia) — se reusa en cada
// agregación que resume ventas por día, para no repetir el $cond.
const SUMA_COBRADO = { $cond: [{ $ne: ['$metodoPago', 'fiado'] }, '$total', 0] };
const SUMA_FIADO = { $cond: [{ $eq: ['$metodoPago', 'fiado'] }, '$total', 0] };
// Un total y una cantidad de ventas por cada día del mes pedido — lo que
// necesita el calendario para pintar cada casillero sin traer cada venta.
async function resumenMes(anio, mesIndiceCero) {
    const { desde, hasta } = (0, fechaLocal_1.limitesMesLocal)(anio, mesIndiceCero);
    // Los pagos que clientes de cuenta corriente hicieron ese mes también son plata
    // que entró: se suman al día en que se recibieron (aunque ese día no haya ventas).
    const pagos = await (0, clientes_1.pagosPorDia)(desde, hasta);
    const docs = await coleccion()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        {
            $group: {
                _id: fechaLocal_1.DIA_LOCAL_EXPR,
                total: { $sum: '$total' },
                totalCobrado: { $sum: SUMA_COBRADO },
                totalFiado: { $sum: SUMA_FIADO },
                cantidadVentas: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ])
        .toArray();
    const filas = new Map(docs.map((d) => [
        d._id,
        {
            fecha: d._id,
            total: d.total,
            totalCobrado: d.totalCobrado,
            totalFiado: d.totalFiado,
            cantidadVentas: d.cantidadVentas,
            totalPagos: pagos.get(d._id)?.total ?? 0,
            cantidadPagos: pagos.get(d._id)?.cantidad ?? 0,
        },
    ]));
    for (const [dia, p] of pagos) {
        if (!filas.has(dia)) {
            filas.set(dia, { fecha: dia, total: 0, totalCobrado: 0, totalFiado: 0, cantidadVentas: 0, totalPagos: p.total, cantidadPagos: p.cantidad });
        }
    }
    return [...filas.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}
// Los fiados más recientes de TODOS los clientes, de una — pensado para que
// cualquiera (esté en el celular o en la PC) vea de un vistazo quién le fió
// qué a quién sin tener que entrar cliente por cliente.
async function listUltimosFiados(limite) {
    const docs = await coleccion()
        .aggregate([
        { $match: { metodoPago: 'fiado' } },
        JOIN_USUARIO,
        JOIN_CLIENTE,
        { $sort: { fecha: -1 } },
        { $limit: limite },
    ])
        .toArray();
    // A cada fiado se le agrega cuánto falta pagar (con los pagos del cliente descontados de
    // lo más viejo a lo más nuevo): uno que ya quedó cubierto figura como pagado.
    const clientes = [...new Set(docs.map((d) => d.clienteId?.toHexString()).filter((id) => !!id))];
    const restas = await (0, clientes_1.restasDeFiados)(clientes.map((id) => new mongodb_1.ObjectId(id)));
    return docs.map((d) => {
        const v = mapDoc(d);
        return { ...v, resta: v.pagado ? 0 : restas.get(v.id) ?? v.total };
    });
}
async function resumenHoy() {
    const { desde, hasta } = (0, fechaLocal_1.limitesDiaLocal)(0);
    const pagos = [...(await (0, clientes_1.pagosPorDia)(desde, hasta)).values()].reduce((acc, p) => ({ total: acc.total + p.total, cantidad: acc.cantidad + p.cantidad }), { total: 0, cantidad: 0 });
    const docs = await coleccion()
        .aggregate([
        { $match: { fecha: { $gte: desde, $lt: hasta } } },
        {
            $group: {
                _id: null,
                total: { $sum: '$total' },
                totalCobrado: { $sum: SUMA_COBRADO },
                totalFiado: { $sum: SUMA_FIADO },
                cantidadVentas: { $sum: 1 },
            },
        },
    ])
        .toArray();
    return {
        fecha: (0, fechaLocal_1.ymdLocal)(),
        total: docs[0]?.total ?? 0,
        totalCobrado: docs[0]?.totalCobrado ?? 0,
        totalFiado: docs[0]?.totalFiado ?? 0,
        cantidadVentas: docs[0]?.cantidadVentas ?? 0,
        totalPagos: pagos.total,
        cantidadPagos: pagos.cantidad,
    };
}
