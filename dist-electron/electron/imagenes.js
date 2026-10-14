"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.carpetaImagenes = carpetaImagenes;
exports.seleccionarImagen = seleccionarImagen;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
// Dónde quedan guardadas las fotos de los productos en esta PC. El servidor
// para celulares también las sirve desde acá (ver /imagenes en httpServer.ts).
function carpetaImagenes() {
    return path_1.default.join(electron_1.app.getPath('userData'), 'data', 'imagenes');
}
// Copia la imagen elegida a la carpeta de datos de la app y devuelve la ruta
// absoluta guardada, para no depender de que el archivo original no se mueva
// o se borre desde donde el usuario lo tenía.
async function seleccionarImagen(win) {
    const result = await electron_1.dialog.showOpenDialog(win ?? undefined, {
        title: 'Elegir imagen del artículo',
        filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    const origen = result.filePaths[0];
    const imagenesDir = carpetaImagenes();
    if (!fs_1.default.existsSync(imagenesDir))
        fs_1.default.mkdirSync(imagenesDir, { recursive: true });
    const extension = path_1.default.extname(origen);
    const nombreDestino = `${crypto_1.default.randomUUID()}${extension}`;
    const destino = path_1.default.join(imagenesDir, nombreDestino);
    fs_1.default.copyFileSync(origen, destino);
    return destino;
}
