"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONGODB_DB_NAME = exports.MONGODB_URI = void 0;
exports.instalarDiario = instalarDiario;
exports.enTransaccion = enTransaccion;
exports.getDb = getDb;
exports.getDbCruda = getDbCruda;
exports.initDatabase = initDatabase;
exports.asegurarIndices = asegurarIndices;
exports.closeDatabase = closeDatabase;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const mongodb_1 = require("mongodb");
const cambiosEnVivo_1 = require("../cambiosEnVivo");
const nube_1 = require("../nube");
const modelo_1 = require("../sync/modelo");
// Se puede apuntar a otro servidor (por ej. si el negocio abre otro local y
// quiere compartir el catálogo entre PCs en red) definiendo estas variables de
// entorno antes de abrir la app; si no están definidas, usa un Mongo local.
exports.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
exports.MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';
let client = null;
let db = null;
// La misma base, pero con cada escritura pasando por el diario de cambios (ver
// sync/diario.ts): así lo que se carga en esta PC viaja a las demás.
let dbProtegida = null;
let diario = null;
const METODOS_DE_ESCRITURA = new Set([
    'insertOne',
    'insertMany',
    'updateOne',
    'updateMany',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'findOneAndUpdate',
    'findOneAndReplace',
    'findOneAndDelete',
    'bulkWrite',
    'createIndex',
    'createIndexes',
    'dropIndex',
    'drop',
    'rename',
]);
/** Desde que se instala el diario, las escrituras de las colecciones que se
 * replican entre PCs quedan anotadas (ver sync/diario.ts). */
function instalarDiario(nuevo) {
    diario = nuevo;
}
/** Varias escrituras seguidas que tienen que quedar juntas: ningún cambio que
 * llegue de otra PC se mete en el medio (ej. descontar el stock y anotar el
 * movimiento que lo explica). */
function enTransaccion(tarea) {
    return diario ? diario.conLlave(tarea) : tarea();
}
function protegerColeccion(coleccion) {
    return new Proxy(coleccion, {
        get(objetivo, propiedad) {
            const valor = Reflect.get(objetivo, propiedad, objetivo);
            if (typeof valor !== 'function')
                return valor;
            if (typeof propiedad === 'string' && METODOS_DE_ESCRITURA.has(propiedad)) {
                return (...args) => diario && (0, modelo_1.esReplicada)(objetivo.collectionName)
                    ? diario.envolver(objetivo, propiedad, args)
                    : valor.apply(objetivo, args);
            }
            return valor.bind(objetivo);
        },
    });
}
function protegerBase(base) {
    return new Proxy(base, {
        get(objetivo, propiedad) {
            const valor = Reflect.get(objetivo, propiedad, objetivo);
            if (typeof valor !== 'function')
                return valor;
            if (propiedad === 'collection') {
                return (...args) => protegerColeccion(objetivo.collection(...args));
            }
            return valor.bind(objetivo);
        },
    });
}
function getDb() {
    if (!dbProtegida) {
        throw new Error('La base de datos todavía no fue inicializada');
    }
    return dbProtegida;
}
/** La base sin pasar por el diario: sólo para el propio motor de sincronización. */
function getDbCruda() {
    if (!db) {
        throw new Error('La base de datos todavía no fue inicializada');
    }
    return db;
}
// Los comandos de Mongo que escriben, para avisar "algo cambió" a las
// pantallas abiertas (ver cambiosEnVivo.ts).
const COMANDOS_DE_ESCRITURA = new Set(['insert', 'update', 'delete', 'findAndModify']);
async function initDatabase() {
    client = new mongodb_1.MongoClient(exports.MONGODB_URI, {
        // Un Atlas gratuito a veces tarda en contestar la primera vez.
        serverSelectionTimeoutMS: Number(process.env.MIS_AMORES_MONGO_ESPERA_MS) || 5000,
        monitorCommands: true,
    });
    const coleccionPorPedido = new Map();
    client.on('commandStarted', (evento) => {
        if (!COMANDOS_DE_ESCRITURA.has(evento.commandName))
            return;
        const coleccion = evento.command[evento.commandName];
        if (typeof coleccion === 'string')
            coleccionPorPedido.set(evento.requestId, coleccion);
    });
    client.on('commandSucceeded', (evento) => {
        const coleccion = coleccionPorPedido.get(evento.requestId);
        if (coleccion === undefined)
            return;
        coleccionPorPedido.delete(evento.requestId);
        (0, cambiosEnVivo_1.notificarEscritura)(coleccion);
    });
    client.on('commandFailed', (evento) => {
        coleccionPorPedido.delete(evento.requestId);
    });
    try {
        await client.connect();
    }
    catch (err) {
        throw new Error(`No se pudo conectar a MongoDB en ${exports.MONGODB_URI}. ¿Está corriendo el servicio de MongoDB? ` +
            `(${err instanceof Error ? err.message : String(err)})`);
    }
    db = client.db(exports.MONGODB_DB_NAME);
    dbProtegida = protegerBase(db);
    await crearIndices(db);
    // En el servidor de internet NO se crea el usuario "admin" de fábrica (con
    // una contraseña conocida): los usuarios llegan desde las PCs del negocio.
    if (!(0, nube_1.esModoNube)())
        await seedIfEmpty(db);
    await migrarCodigosBarraNulos(db);
    return dbProtegida;
}
/** Vuelve a crear los índices (por ejemplo, después de cargar una copia que
 * reemplazó las colecciones y se llevó los índices con ellas). */
async function asegurarIndices() {
    if (!db)
        throw new Error('La base de datos todavía no fue inicializada');
    await crearIndices(db);
    await migrarCodigosBarraNulos(db);
}
async function closeDatabase() {
    await client?.close();
}
async function crearIndices(database) {
    await database.collection('usuarios').createIndex({ usuario: 1 }, { unique: true });
    await database.collection('familias').createIndex({ nombre: 1 }, { unique: true });
    await database.collection('marcas').createIndex({ nombre: 1 }, { unique: true });
    // sparse: permite muchos artículos sin código de barras sin chocar contra
    // el índice único — pero sólo si el campo directamente no existe en el
    // documento (ver migrarCodigosBarraNulos: si quedara guardado como "null"
    // en vez de ausente, sí cuenta como valor duplicado para el índice).
    await database
        .collection('articulos')
        .createIndex({ codigoBarras: 1 }, { unique: true, sparse: true });
    await database.collection('articulos').createIndex({ descripcion: 1 });
    await database.collection('articulos').createIndex({ familiaId: 1 });
    await database.collection('movimientos_stock').createIndex({ articuloId: 1 });
    await database.collection('historial_precios').createIndex({ articuloId: 1 });
    await database.collection('ventas').createIndex({ fecha: 1 });
    await database.collection('ventas').createIndex({ clienteId: 1 });
    await migrarIndiceNombreClientes(database);
    await database.collection('pagos_cuenta').createIndex({ clienteId: 1 });
}
// El índice único de nombre de cliente antes no distinguía activo/inactivo:
// una vez que se "sacaba" un cliente de la lista (baja lógica, no se borra
// de la base), ese nombre quedaba bloqueado para siempre y no se podía usar
// de nuevo ni para el mismo cliente ni para uno nuevo que se llame igual.
// Lo migramos a un índice parcial que sólo exige nombres únicos entre los
// clientes activos — hay que borrar el índice viejo primero porque Mongo no
// deja crear uno con las mismas claves pero opciones distintas encima.
async function migrarIndiceNombreClientes(database) {
    // Si nunca se cargó un cliente en esta base, la colección "clientes" ni
    // existe todavía — listar sus índices tira "ns does not exist" en vez de
    // una lista vacía. En ese caso no hay nada que migrar.
    const indiceViejo = await database
        .collection('clientes')
        .indexes()
        .then((indices) => indices.find((i) => i.name === 'nombre_1' && !i.partialFilterExpression))
        .catch(() => undefined);
    if (indiceViejo) {
        await database.collection('clientes').dropIndex('nombre_1');
    }
    await database
        .collection('clientes')
        .createIndex({ nombre: 1 }, { unique: true, partialFilterExpression: { activo: true } });
}
async function seedIfEmpty(database) {
    const usuarios = database.collection('usuarios');
    if ((await usuarios.countDocuments()) === 0) {
        const passwordHash = bcryptjs_1.default.hashSync('admin123', 10);
        await usuarios.insertOne({
            nombre: 'Administradora',
            usuario: 'admin',
            passwordHash,
            rol: 'admin',
            activo: true,
            creadoEn: new Date().toISOString(),
        });
    }
    const familias = database.collection('familias');
    if ((await familias.countDocuments()) === 0) {
        const familiasBase = ['COMESTIBLE', 'BEBIDAS', 'LIMPIEZA', 'PERFUMERIA', 'VARIOS'];
        await familias.insertMany(familiasBase.map((nombre) => ({ nombre })));
    }
}
// Corrige artículos viejos que hayan quedado con codigoBarras guardado como
// "null" en vez de directamente sin el campo — con el índice sparse, un
// "null" explícito cuenta como valor y sólo un artículo podría tener eso a la
// vez. Sacarles el campo del todo los deja bien para el índice sparse.
async function migrarCodigosBarraNulos(database) {
    await database.collection('articulos').updateMany({ codigoBarras: null }, { $unset: { codigoBarras: '' } });
}
