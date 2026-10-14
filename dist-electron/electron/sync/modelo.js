"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNIFICABLES = exports.REFERENCIAS = exports.COLECCIONES_REPLICADAS = void 0;
exports.esReplicada = esReplicada;
exports.camposPropios = camposPropios;
exports.referenciasA = referenciasA;
exports.hex = hex;
exports.claveDeMeta = claveDeMeta;
exports.huellaDeValor = huellaDeValor;
exports.camposReplicados = camposReplicados;
exports.cuerpoReplicado = cuerpoReplicado;
exports.huellaDeDoc = huellaDeDoc;
exports.esErrorDuplicado = esErrorDuplicado;
// Qué se replica entre las PCs y cómo se lo trata. Es la única parte que hay
// que tocar si se agrega una colección nueva con datos del negocio.
const crypto_1 = __importDefault(require("crypto"));
const mongodb_1 = require("mongodb");
exports.COLECCIONES_REPLICADAS = [
    'usuarios',
    'familias',
    'marcas',
    'proveedores',
    'articulos',
    'clientes',
    'ventas',
    'pagos_cuenta',
    'ajustes_cuenta',
    'movimientos_stock',
    'historial_precios',
    'recordatorios',
];
const REPLICADAS = new Set(exports.COLECCIONES_REPLICADAS);
function esReplicada(nombre) {
    return REPLICADAS.has(nombre);
}
// Campos que NO viajan porque cada PC los calcula con lo que tiene. El stock de
// un artículo es "stock inicial + suma de sus movimientos": si viajara el
// número, dos PCs que venden lo mismo a la vez se pisarían; en cambio los
// movimientos (ventas, ingresos, ajustes) se suman y el resultado es el mismo
// en todas (ver aplicar.ts: recalcularStock).
const CAMPOS_PROPIOS = {
    articulos: ['stock'],
};
function camposPropios(coleccion) {
    return CAMPOS_PROPIOS[coleccion] ?? [];
}
// A qué colección apunta cada campo que guarda el _id de otro documento.
exports.REFERENCIAS = {
    articulos: { familiaId: 'familias', marcaId: 'marcas', proveedorId: 'proveedores' },
    ventas: { articuloId: 'articulos', clienteId: 'clientes', usuarioId: 'usuarios' },
    pagos_cuenta: { clienteId: 'clientes', usuarioId: 'usuarios' },
    ajustes_cuenta: { clienteId: 'clientes', usuarioId: 'usuarios' },
    movimientos_stock: { articuloId: 'articulos', usuarioId: 'usuarios' },
    historial_precios: { articuloId: 'articulos', usuarioId: 'usuarios' },
    recordatorios: {
        creadoPorId: 'usuarios',
        hechoPorId: 'usuarios',
        articuloId: 'articulos',
        clienteId: 'clientes',
    },
};
// Colecciones donde dos documentos "iguales" cargados a la vez en PCs
// distintas se unifican en uno solo (la base los trata como duplicados: ver
// los índices únicos de db/database.ts).
exports.UNIFICABLES = {
    usuarios: { campo: 'usuario' },
    familias: { campo: 'nombre' },
    marcas: { campo: 'nombre' },
    clientes: { campo: 'nombre', soloActivos: true },
};
/** Las colecciones y campos que guardan el _id de un documento de `destino`. */
function referenciasA(destino) {
    const lista = [];
    for (const [coleccion, campos] of Object.entries(exports.REFERENCIAS)) {
        for (const [campo, apunta] of Object.entries(campos)) {
            if (apunta === destino)
                lista.push({ coleccion, campo });
        }
    }
    return lista;
}
function hex(id) {
    return id instanceof mongodb_1.ObjectId ? id.toHexString() : String(id);
}
function claveDeMeta(coleccion, id) {
    return `${coleccion}:${hex(id)}`;
}
// Para comparar sin que importe el orden de los campos de un documento.
function ordenado(valor) {
    if (Array.isArray(valor))
        return valor.map(ordenado);
    if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
        const salida = {};
        for (const k of Object.keys(valor).sort())
            salida[k] = ordenado(valor[k]);
        return salida;
    }
    return valor;
}
/** Huella corta de un valor cualquiera: dos valores iguales dan la misma. */
function huellaDeValor(valor) {
    if (valor === undefined)
        return '∅';
    const texto = mongodb_1.BSON.EJSON.stringify(ordenado(valor), { relaxed: false }) ?? '∅';
    return crypto_1.default.createHash('sha1').update(texto).digest('base64').slice(0, 16);
}
/** Los campos de un documento que se replican (sin _id ni los propios). */
function camposReplicados(coleccion, doc) {
    const propios = camposPropios(coleccion);
    return Object.keys(doc).filter((k) => k !== '_id' && !propios.includes(k));
}
/** Lo que viaja de un documento: todo menos _id y los campos propios. */
function cuerpoReplicado(coleccion, doc) {
    const cuerpo = {};
    for (const k of camposReplicados(coleccion, doc))
        cuerpo[k] = doc[k];
    return cuerpo;
}
function huellaDeDoc(coleccion, doc) {
    return huellaDeValor(cuerpoReplicado(coleccion, doc));
}
function esErrorDuplicado(err) {
    return typeof err === 'object' && err !== null && err.code === 11000;
}
