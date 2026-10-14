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
import Module from 'module';

process.env.MIS_AMORES_MODO_SERVIDOR = '1';

type Cargador = (this: unknown, pedido: string, ...resto: unknown[]) => unknown;
const internos = Module as unknown as { _load: Cargador };
const cargarOriginal = internos._load;
internos._load = function (this: unknown, pedido: string, ...resto: unknown[]) {
  if (pedido === 'electron') return require('./electronFalso');
  return cargarOriginal.call(this, pedido, ...resto);
};

const { app } = require('./electronFalso') as typeof import('./electronFalso');

// Que un "systemctl stop" o Ctrl+C cierre la base y las conexiones como
// corresponde.
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => app.quit());
}

require('./main');
