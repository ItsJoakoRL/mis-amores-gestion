"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leerConfiguracion = leerConfiguracion;
exports.guardarConfiguracion = guardarConfiguracion;
// Cómo se relaciona esta PC con las demás del negocio. Se guarda en un
// archivito en la carpeta de datos de la app, que las actualizaciones no tocan.
//
// Todas las PCs son iguales: cada una tiene su base completa y se mantiene al
// día con las otras (ver electron/sync). Lo único que hace falta saber acá es
// con quiénes se habla ("pares") y la clave de la red que los reconoce.
const electron_1 = require("electron");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const nube_1 = require("./nube");
function archivo() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'configuracion-pc.json');
}
let enMemoria = null;
function esTexto(valor) {
    return typeof valor === 'string' && valor.length > 0;
}
/** En la nube (ver nube.ts) el disco no sobrevive a un reinicio: la identidad
 * sale siempre de las variables de entorno y no se guarda ningún archivo. */
function configuracionNube(pares = []) {
    return {
        idPc: (0, nube_1.idPcNube)(),
        claveRed: (0, nube_1.claveRedNube)(),
        pares,
        inicial: 'listo',
        direccionAnterior: null,
        nombreAnterior: null,
    };
}
function leerConfiguracion() {
    if (enMemoria)
        return enMemoria;
    if ((0, nube_1.esModoNube)()) {
        enMemoria = configuracionNube();
        return enMemoria;
    }
    let leida = {};
    let existia = true;
    try {
        leida = JSON.parse(fs_1.default.readFileSync(archivo(), 'utf-8'));
    }
    catch {
        // Roto o a medio escribir (se cortó la luz): se prueba con la copia
        // anterior, que guardarConfiguracion deja al lado.
        try {
            leida = JSON.parse(fs_1.default.readFileSync(`${archivo()}.bak`, 'utf-8'));
        }
        catch {
            existia = false;
        }
    }
    const config = {
        idPc: esTexto(leida.idPc) ? leida.idPc : crypto_1.default.randomUUID(),
        claveRed: esTexto(leida.claveRed) ? leida.claveRed : null,
        pares: [],
        inicial: leida.inicial === 'traer' ? 'traer' : 'listo',
        direccionAnterior: esTexto(leida.direccionAnterior) ? leida.direccionAnterior : null,
        nombreAnterior: esTexto(leida.nombreAnterior) ? leida.nombreAnterior : null,
    };
    if (Array.isArray(leida.pares)) {
        for (const p of leida.pares) {
            if (p && esTexto(p.idPc) && esTexto(p.direccion)) {
                config.pares.push({ idPc: p.idPc, nombre: esTexto(p.nombre) ? p.nombre : 'PC del negocio', direccion: p.direccion });
            }
        }
    }
    // Versión anterior: la PC estaba "conectada" a una principal. Pasa a ser una
    // más de la red de esa PC; la clave de copia que tenía es la clave de la red.
    if (leida.modo === 'conectada' && esTexto(leida.direccionPrincipal)) {
        const nombre = esTexto(leida.nombrePrincipal) ? leida.nombrePrincipal : 'la otra PC';
        config.direccionAnterior = leida.direccionPrincipal;
        config.nombreAnterior = nombre;
        if (esTexto(leida.claveCopia)) {
            config.claveRed = leida.claveCopia;
            // Sin el identificador de la otra PC no se la puede anotar como par: se
            // la busca por su dirección anterior (ver direccionesCandidatas).
            if (esTexto(leida.idPrincipal)) {
                config.pares = [{ idPc: leida.idPrincipal, nombre, direccion: leida.direccionPrincipal }];
            }
            config.inicial = 'traer';
        }
    }
    enMemoria = config;
    const cambioDeFormato = 'modo' in leida || 'generacion' in leida || 'direccionPrincipal' in leida;
    if (!existia || !esTexto(leida.idPc) || cambioDeFormato)
        guardarConfiguracion(config);
    return config;
}
function guardarConfiguracion(config) {
    if ((0, nube_1.esModoNube)()) {
        enMemoria = configuracionNube(config.pares);
        return;
    }
    enMemoria = config;
    try {
        const destino = archivo();
        fs_1.default.mkdirSync(path_1.default.dirname(destino), { recursive: true });
        // Se escribe aparte y recién al final reemplaza al archivo: si se corta a
        // la mitad, el archivo de siempre queda entero (y la copia anterior al lado).
        const temporal = `${destino}.tmp`;
        fs_1.default.writeFileSync(temporal, JSON.stringify(config, null, 2));
        try {
            if (fs_1.default.existsSync(destino))
                fs_1.default.copyFileSync(destino, `${destino}.bak`);
        }
        catch {
            // Sin copia anterior no pasa nada.
        }
        fs_1.default.renameSync(temporal, destino);
    }
    catch {
        // Si no se pudo escribir, al menos queda en memoria hasta que se cierre la app.
    }
}
