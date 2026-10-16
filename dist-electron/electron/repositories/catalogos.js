"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFamilias = listFamilias;
exports.crearFamilia = crearFamilia;
exports.listMarcas = listMarcas;
exports.crearMarca = crearMarca;
exports.listProveedores = listProveedores;
exports.crearProveedor = crearProveedor;
const database_1 = require("../db/database");
function esErrorDuplicado(err) {
    return typeof err === 'object' && err !== null && err.code === 11000;
}
// Un nombre vacío (o algo que no es texto) no puede quedar guardado: después no
// se vería en las listas.
function nombreValido(nombre, deQue) {
    if (typeof nombre !== 'string' || !nombre.trim())
        throw new Error(`Escribí el nombre ${deQue}`);
    return nombre.trim();
}
function textoOpcional(valor) {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}
async function listFamilias() {
    const docs = await (0, database_1.getDb)().collection('familias').find().sort({ nombre: 1 }).toArray();
    return docs.map((d) => ({ id: d._id.toHexString(), nombre: d.nombre }));
}
async function crearFamilia(nombre) {
    const nombreLimpio = nombreValido(nombre, 'del rubro');
    try {
        const result = await (0, database_1.getDb)().collection('familias').insertOne({ nombre: nombreLimpio });
        return { id: result.insertedId.toHexString(), nombre: nombreLimpio };
    }
    catch (err) {
        if (esErrorDuplicado(err))
            throw new Error('Ya existe un rubro con ese nombre');
        throw err;
    }
}
async function listMarcas() {
    const docs = await (0, database_1.getDb)().collection('marcas').find().sort({ nombre: 1 }).toArray();
    return docs.map((d) => ({ id: d._id.toHexString(), nombre: d.nombre }));
}
async function crearMarca(nombre) {
    const nombreLimpio = nombreValido(nombre, 'de la marca');
    try {
        const result = await (0, database_1.getDb)().collection('marcas').insertOne({ nombre: nombreLimpio });
        return { id: result.insertedId.toHexString(), nombre: nombreLimpio };
    }
    catch (err) {
        if (esErrorDuplicado(err))
            throw new Error('Ya existe una marca con ese nombre');
        throw err;
    }
}
async function listProveedores() {
    const docs = await (0, database_1.getDb)().collection('proveedores').find().sort({ nombre: 1 }).toArray();
    return docs.map((d) => ({
        id: d._id.toHexString(),
        nombre: d.nombre,
        contacto: d.contacto ?? null,
        telefono: d.telefono ?? null,
        email: d.email ?? null,
    }));
}
async function crearProveedor(data) {
    // Sólo los campos conocidos, ya limpios: antes se guardaba el pedido tal cual.
    const limpio = {
        nombre: nombreValido(data?.nombre, 'del proveedor'),
        contacto: textoOpcional(data?.contacto),
        telefono: textoOpcional(data?.telefono),
        email: textoOpcional(data?.email),
    };
    const result = await (0, database_1.getDb)()
        .collection('proveedores')
        .insertOne({ ...limpio });
    return { id: result.insertedId.toHexString(), ...limpio };
}
