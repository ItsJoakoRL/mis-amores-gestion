"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claveDeCopia = claveDeCopia;
exports.claveEsValida = claveEsValida;
exports.armarManifiesto = armarManifiesto;
exports.coleccionComoTexto = coleccionComoTexto;
exports.carpetaCopia = carpetaCopia;
exports.leerMetaCopia = leerMetaCopia;
exports.cargarCopiaEnEstaPc = cargarCopiaEnEstaPc;
// Lo que quedó de la época de la "PC principal" y las "PCs conectadas":
//
// - La clave de copia (claveDeCopia). Ahora es la clave de la red: la usan las
//   PCs para reconocerse entre sí (ver sync/rutas.ts). Vive en la base de la PC
//   que la creó; al sumarse a una red, las otras la guardan en su configuración.
// - Las rutas /api/copia/... que sigue ofreciendo cada PC para que una PC con la
//   versión anterior (que todavía se conecta a una "principal") siga andando
//   hasta que se actualice.
// - Cargar en la base de esta PC la última copia guardada por la versión
//   anterior (carpeta "copia-principal"): sólo se usa una vez, al pasar de la
//   versión anterior a ésta, si la otra PC no está para traer los datos.
const electron_1 = require("electron");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mongodb_1 = require("mongodb");
const backup_1 = require("./backup");
const cambiosEnVivo_1 = require("./cambiosEnVivo");
const database_1 = require("./db/database");
const imagenes_1 = require("./imagenes");
const EXTENSIONES_FOTO = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const COLECCION_AJUSTES = 'ajustes_sistema';
const SUFIJO_TEMPORAL = '__copia';
// La clave que comparten las PCs del negocio, para pedirse datos sin tener
// que guardar ninguna contraseña. La crea la primera PC que la necesita.
async function claveDeCopia() {
    const col = (0, database_1.getDb)().collection(COLECCION_AJUSTES);
    const existente = await col.findOne({ _id: 'copia' });
    if (existente?.clave)
        return existente.clave;
    await col.updateOne({ _id: 'copia' }, { $setOnInsert: { clave: crypto_1.default.randomBytes(24).toString('hex') } }, { upsert: true });
    const doc = await col.findOne({ _id: 'copia' });
    if (!doc?.clave)
        throw new Error('No se pudo crear la clave de copia');
    return doc.clave;
}
async function claveEsValida(clave) {
    if (typeof clave !== 'string' || clave.length < 16)
        return false;
    const real = Buffer.from(await claveDeCopia());
    const recibida = Buffer.from(clave);
    return recibida.length === real.length && crypto_1.default.timingSafeEqual(recibida, real);
}
async function nombresDeColecciones() {
    const lista = await (0, database_1.getDb)().listCollections({}, { nameOnly: true }).toArray();
    return lista
        .map((c) => c.name)
        .filter((n) => !n.startsWith('system.') && !n.startsWith('_sync_') && !n.endsWith(SUFIJO_TEMPORAL))
        .sort();
}
function listarImagenes() {
    const carpeta = (0, imagenes_1.carpetaImagenes)();
    if (!fs_1.default.existsSync(carpeta))
        return [];
    const fotos = [];
    for (const nombre of fs_1.default.readdirSync(carpeta)) {
        if (!EXTENSIONES_FOTO.has(path_1.default.extname(nombre).toLowerCase()))
            continue;
        try {
            const datos = fs_1.default.statSync(path_1.default.join(carpeta, nombre));
            if (datos.isFile())
                fotos.push({ nombre, bytes: datos.size });
        }
        catch {
            // Se borró justo ahora: no cuenta.
        }
    }
    return fotos;
}
async function armarManifiesto(idPc, nombrePc, generacion) {
    const colecciones = [];
    for (const nombre of await nombresDeColecciones()) {
        colecciones.push({ nombre, cantidad: await (0, database_1.getDb)().collection(nombre).countDocuments() });
    }
    return {
        version: (0, cambiosEnVivo_1.versionDeLosDatos)(),
        fecha: new Date().toISOString(),
        idPc,
        nombrePc,
        generacion,
        colecciones,
        imagenes: listarImagenes(),
    };
}
// Una colección entera como EJSON "canónico" (conserva los tipos exactos:
// ObjectId, fechas, enteros y decimales), para cargarla igual en otra base.
async function coleccionComoTexto(nombre) {
    if (!(await nombresDeColecciones()).includes(nombre))
        throw new Error('Esa colección no existe');
    const docs = await (0, database_1.getDb)().collection(nombre).find().toArray();
    return mongodb_1.BSON.EJSON.stringify(docs, { relaxed: false });
}
function carpetaCopia() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'copia-principal');
}
function leerMetaCopia() {
    try {
        const meta = JSON.parse(fs_1.default.readFileSync(path_1.default.join(carpetaCopia(), 'meta.json'), 'utf-8'));
        return typeof meta.fecha === 'string' && typeof meta.version === 'string' ? meta : null;
    }
    catch {
        return null;
    }
}
function marcaDeTiempo() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
// Carga la copia guardada en la base de esta PC, reemplazando lo que tenga.
// Va de a pasos para que, si algo falla a la mitad, la base siga como estaba:
// primero se carga todo en colecciones temporales, y sólo cuando está todo
// cargado se reemplazan. Antes de tocar nada, lo que había se respalda en
// "Documentos\Mis Amores - Respaldos".
async function cargarCopiaEnEstaPc(carpeta = carpetaCopia(), alAvanzar) {
    if (!fs_1.default.existsSync(carpeta))
        throw new Error('No hay una copia de los datos guardada en esta PC.');
    const archivos = fs_1.default.readdirSync(carpeta).filter((n) => n.endsWith('.json') && n !== 'meta.json');
    if (archivos.length === 0)
        throw new Error('La copia guardada en esta PC está vacía.');
    const cliente = new mongodb_1.MongoClient(database_1.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    try {
        await cliente.connect();
    }
    catch {
        throw new Error('No se pudo abrir la base de datos de esta PC. ¿Está corriendo MongoDB?');
    }
    try {
        const db = cliente.db(database_1.MONGODB_DB_NAME);
        const existentes = (await db.listCollections({}, { nameOnly: true }).toArray())
            .map((c) => c.name)
            .filter((n) => !n.startsWith('system.'));
        let respaldo = null;
        if (existentes.length > 0) {
            alAvanzar?.('Guardando un respaldo de lo que había en esta PC...');
            respaldo = path_1.default.join((0, backup_1.carpetaRespaldos)(), `antes-de-cargar-copia-${marcaDeTiempo()}`);
            await (0, backup_1.respaldarBase)(db, respaldo);
        }
        const nombres = [];
        for (const archivo of archivos) {
            const nombre = path_1.default.basename(archivo, '.json');
            alAvanzar?.(`Cargando ${nombre}...`);
            const docs = mongodb_1.BSON.EJSON.parse(fs_1.default.readFileSync(path_1.default.join(carpeta, archivo), 'utf-8'), { relaxed: false });
            const temporal = `${nombre}${SUFIJO_TEMPORAL}`;
            await db.collection(temporal).drop().catch(() => { });
            if (docs.length === 0) {
                await db.createCollection(temporal);
            }
            else {
                for (let i = 0; i < docs.length; i += 500) {
                    await db.collection(temporal).insertMany(docs.slice(i, i + 500), { ordered: true });
                }
            }
            nombres.push(nombre);
        }
        // Las fotos, antes de reemplazar: así las rutas de los productos se
        // pueden apuntar a la carpeta de esta PC (la que traen es la del disco de
        // la principal anterior).
        const carpetaFotos = path_1.default.join(carpeta, 'imagenes');
        const destinoFotos = (0, imagenes_1.carpetaImagenes)();
        const fotosCopiadas = new Set();
        if (fs_1.default.existsSync(carpetaFotos)) {
            fs_1.default.mkdirSync(destinoFotos, { recursive: true });
            for (const nombre of fs_1.default.readdirSync(carpetaFotos)) {
                const origen = path_1.default.join(carpetaFotos, nombre);
                const aca = path_1.default.join(destinoFotos, nombre);
                try {
                    if (!fs_1.default.existsSync(aca) || fs_1.default.statSync(aca).size !== fs_1.default.statSync(origen).size)
                        fs_1.default.copyFileSync(origen, aca);
                    fotosCopiadas.add(nombre);
                }
                catch {
                    // Esa foto no se pudo copiar: el producto queda sin foto.
                }
            }
        }
        if (nombres.includes('articulos')) {
            const articulos = db.collection(`articulos${SUFIJO_TEMPORAL}`);
            const conFoto = await articulos
                .find({ imagenPath: { $type: 'string', $ne: '' } }, { projection: { imagenPath: 1 } })
                .toArray();
            const cambios = conFoto
                .map((a) => ({ id: a._id, nombre: path_1.default.win32.basename(String(a.imagenPath)) }))
                .filter((a) => fotosCopiadas.has(a.nombre))
                .map((a) => ({
                updateOne: { filter: { _id: a.id }, update: { $set: { imagenPath: path_1.default.join(destinoFotos, a.nombre) } } },
            }));
            if (cambios.length > 0)
                await articulos.bulkWrite(cambios, { ordered: false });
        }
        alAvanzar?.('Reemplazando los datos de esta PC...');
        for (const nombre of existentes) {
            if (!nombres.includes(nombre) && !nombre.endsWith(SUFIJO_TEMPORAL)) {
                await db.collection(nombre).drop().catch(() => { });
            }
        }
        for (const nombre of nombres) {
            await db.collection(`${nombre}${SUFIJO_TEMPORAL}`).rename(nombre, { dropTarget: true });
        }
        return { respaldo };
    }
    finally {
        await cliente.close().catch(() => { });
    }
}
