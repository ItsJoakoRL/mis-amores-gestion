"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Arranca Mis Amores como SERVIDOR: la misma base, la misma sincronización con
// las otras PCs y el mismo acceso desde los celulares, pero sin ventana, sin
// ícono en la bandeja y sin Electron. Sirve para dejarlo prendido en un
// servidor de internet (ver SERVIDOR.md), así los celulares andan aunque todas
// las PCs del negocio estén apagadas.
//
//   node dist-electron/electron/servidor.js
//
// Por dentro es la misma app (main.ts): acá sólo se le cambia el módulo
// "electron" por uno que no hace nada (ver electronFalso.ts).
const module_1 = __importDefault(require("module"));
process.env.MIS_AMORES_MODO_SERVIDOR = '1';
// Los "días" del negocio (ventas del día, reportes) se cortan a medianoche de
// la hora de este proceso (ver fechaLocal.ts): un servidor de internet suele
// estar en UTC, y las ventas de la noche caerían en el día siguiente. Tiene que
// quedar fijado antes de que se cree cualquier fecha.
if (!process.env.TZ)
    process.env.TZ = 'America/Argentina/Buenos_Aires';
const internos = module_1.default;
const cargarOriginal = internos._load;
internos._load = function (pedido, ...resto) {
    if (pedido === 'electron')
        return require('./electronFalso');
    return cargarOriginal.call(this, pedido, ...resto);
};
const { app } = require('./electronFalso');
// Que un "systemctl stop" o Ctrl+C cierre la base y las conexiones como
// corresponde.
for (const senal of ['SIGINT', 'SIGTERM']) {
    process.on(senal, () => app.quit());
}
require('./main');
