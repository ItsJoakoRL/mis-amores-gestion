// Prueba del manejo de usuarios y contraseñas, y de las validaciones de datos que
// llegan por la API (celulares y servidor de internet):
//
//   npm run build:electron
//   node scripts/probar-usuarios.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_usuarios", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4181;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_usuarios';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-usuarios-'));
const SERVIDOR_JS = path.join(RAIZ, 'dist-electron/electron/servidor.js');

let fallas = 0;
let pasaron = 0;
const log = (...a) => console.log(...a);
function ok(condicion, mensaje) {
  if (condicion) {
    pasaron += 1;
    log('   ✓', mensaje);
  } else {
    fallas += 1;
    log('   ✗ FALLÓ:', mensaje);
  }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Devuelve { ok, data, error } sin tirar: así se prueban también los rechazos.
async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return r.json();
}
const rechazo = (r, texto) => r.ok === false && new RegExp(texto, 'i').test(r.error || '');

async function vaciarBase() {
  const c = new MongoClient(MONGO);
  await c.connect();
  await c.db(DB).dropDatabase();
  await c.close();
}

let servidor = null;
async function levantar() {
  await vaciarBase();
  servidor = spawn(process.execPath, [SERVIDOR_JS], {
    cwd: RAIZ,
    env: {
      ...process.env,
      MONGODB_URI: MONGO,
      MONGODB_DB_NAME: DB,
      MIS_AMORES_PUERTO: String(PUERTO),
      MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos'),
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    try {
      const r = await fetch(BASE + '/api/sistema/info');
      if (r.ok) return;
    } catch {
      /* todavía no */
    }
    await esperar(300);
  }
  throw new Error('El servidor de prueba no arrancó');
}

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();

    log('\n[1] Entrar con el usuario escrito como sale en un celular');
    let r = await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' });
    ok(r.ok && r.data.token, 'admin / admin123 entra');
    const tokenAdmin = r.data.token;
    const idAdmin = r.data.id;
    r = await api('POST', '/api/auth/login', { usuario: 'Admin', password: 'admin123' });
    ok(r.ok, 'con la primera letra en mayúscula ("Admin") también entra');
    r = await api('POST', '/api/auth/login', { usuario: '  ADMIN ', password: 'admin123' });
    ok(r.ok, 'con espacios y en mayúsculas ("  ADMIN ") también entra');
    r = await api('POST', '/api/auth/login', { usuario: 'admin', password: 'mal' });
    ok(rechazo(r, 'incorrectos'), 'una contraseña mal puesta sigue rechazada');
    r = await api('POST', '/api/auth/login', { usuario: 'admin', password: 'ADMIN123' });
    ok(rechazo(r, 'incorrectos'), 'la contraseña SÍ distingue mayúsculas');
    r = await api('POST', '/api/auth/login', { usuario: 123, password: { x: 1 } });
    ok(rechazo(r, 'incorrectos'), 'datos que no son texto no rompen nada');

    log('\n[2] Crear usuarios: se controla lo que llega');
    r = await api('POST', '/api/usuarios', { nombre: 'Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(r.ok, 'se crea una empleada');
    const idLucia = r.data?.id;
    r = await api('POST', '/api/usuarios', { nombre: 'X', usuario: 'x1', password: 'clave1234', rol: 'superadmin', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'rol'), 'un rol inventado se rechaza');
    r = await api('POST', '/api/usuarios', { nombre: 'X', usuario: 'x2', password: 'abc', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'al menos 4'), 'una contraseña corta se rechaza');
    r = await api('POST', '/api/usuarios', { nombre: '  ', usuario: 'x3', password: 'clave1234', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'nombre'), 'sin nombre se rechaza');
    r = await api('POST', '/api/usuarios', { nombre: 'Otra Lucía', usuario: 'lucia', password: 'clave1234', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'Ya existe'), 'un usuario repetido se rechaza');
    r = await api('POST', '/api/usuarios', { nombre: 'Otra Lucía', usuario: 'LUCIA', password: 'clave1234', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'Ya existe'), 'uno que sólo cambia en mayúsculas ("LUCIA") también se rechaza');
    r = await api('PUT', `/api/usuarios/${idLucia}`, { nombre: 'Lucía', usuario: 'ADMIN', rol: 'empleado', genero: 'F' }, tokenAdmin);
    ok(rechazo(r, 'Ya existe'), 'al editar, tampoco se puede dejar el nombre de otra cuenta');

    log('\n[3] Cada persona cambia su propia contraseña');
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' });
    const t1 = r.data.token;
    r = await api('POST', '/api/auth/login', { usuario: 'LUCIA', password: 'clave1234' });
    const t2 = r.data.token;
    ok(t1 && t2 && t1 !== t2, 'Lucía entra desde dos aparatos (dos sesiones)');
    r = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'x' });
    ok(rechazo(r, 'sesión'), 'sin sesión no se puede cambiar la contraseña');
    r = await api('POST', '/api/usuarios/mi-password', { actual: 'equivocada', nueva: 'nueva5678' }, t1);
    ok(rechazo(r, 'actual no es correcta'), 'con la actual equivocada se rechaza');
    r = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'clave1234' }, t1);
    ok(rechazo(r, 'distinta'), 'la nueva tiene que ser distinta de la actual');
    r = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'abc' }, t1);
    ok(rechazo(r, 'al menos 4'), 'la nueva no puede ser corta');
    r = await api('POST', '/api/usuarios/mi-password', { actual: 'clave1234', nueva: 'nueva5678' }, t1);
    ok(r.ok === true, 'con la actual bien puesta, se cambia');
    r = await api('GET', '/api/auth/sesion', undefined, t1);
    ok(r.ok && r.data && r.data.usuario === 'lucia', 'la sesión desde donde la cambió sigue abierta');
    r = await api('GET', '/api/auth/sesion', undefined, t2);
    ok(r.ok && !r.data, 'la sesión del otro aparato se cerró');
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'clave1234' });
    ok(rechazo(r, 'incorrectos'), 'la contraseña vieja ya no sirve');
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'nueva5678' });
    ok(r.ok, 'la nueva sirve');
    const t3 = r.data?.token;

    log('\n[4] La administradora le pone una contraseña nueva');
    r = await api('POST', `/api/usuarios/${idLucia}/reset-password`, { password: 'otra9999' }, t3);
    ok(rechazo(r, 'permisos'), 'una empleada no puede cambiarle la contraseña a nadie');
    r = await api('POST', `/api/usuarios/${idLucia}/reset-password`, { password: 'otra9999' }, tokenAdmin);
    ok(r.ok === true, 'la administradora sí');
    r = await api('GET', '/api/auth/sesion', undefined, t3);
    ok(r.ok && !r.data, 'las sesiones abiertas de Lucía se cierran (tiene que entrar con la nueva)');
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'otra9999' });
    ok(r.ok, 'entra con la contraseña que le pusieron');
    r = await api('POST', '/api/usuarios/000000000000000000000000/reset-password', { password: 'otra9999' }, tokenAdmin);
    ok(rechazo(r, 'no existe'), 'un usuario que no existe da un mensaje claro');
    r = await api('POST', '/api/usuarios/nada/reset-password', { password: 'otra9999' }, tokenAdmin);
    ok(rechazo(r, 'no existe'), 'un id roto da un mensaje claro (no un error técnico)');

    r = await api('POST', `/api/usuarios/${idAdmin}/reset-password`, { password: 'admin123' }, tokenAdmin);
    ok(r.ok === true, 'la administradora se cambia la suya desde el mismo aparato');
    r = await api('GET', '/api/auth/sesion', undefined, tokenAdmin);
    ok(r.ok && r.data && r.data.usuario === 'admin', 'y no se queda sin sesión');

    log('\n[5] Datos que llegan por la API');
    const art = {
      codigoBarras: '7799999',
      descripcion: 'Producto de prueba',
      marcaId: null,
      familiaId: null,
      proveedorId: null,
      precioCosto: 100,
      precioVenta: 150,
      precioLista2: 0,
      precioLista3: 0,
      utilidadPct: 50,
      stock: 10,
      stockMinimo: 2,
      stockIdeal: 6,
      unidad: 'unidad',
      imagenPath: null,
      nota: null,
    };
    r = await api('POST', '/api/articulos', { ...art, descripcion: '   ' }, tokenAdmin);
    ok(rechazo(r, 'descripción'), 'un artículo sin descripción se rechaza');
    r = await api('POST', '/api/articulos', { ...art, precioVenta: -5 }, tokenAdmin);
    ok(rechazo(r, 'precio de venta'), 'un precio negativo se rechaza');
    r = await api('POST', '/api/articulos', { ...art, precioVenta: 'mucho' }, tokenAdmin);
    ok(rechazo(r, 'precio de venta'), 'un precio que no es número se rechaza');
    r = await api('POST', '/api/articulos', { ...art, stock: -1 }, tokenAdmin);
    ok(rechazo(r, 'stock'), 'un stock negativo se rechaza');
    r = await api('POST', '/api/articulos', art, tokenAdmin);
    ok(r.ok && r.data.descripcion === 'Producto de prueba', 'un artículo bien armado se guarda');
    const idArt = r.data?.id;
    r = await api('GET', '/api/articulos/nada', undefined, tokenAdmin);
    ok(r.ok && r.data === null, 'pedir un artículo con un id roto no tira un error técnico');

    // Un artículo con un dato viejo mal guardado (stock negativo) tiene que poder
    // seguir editándose: el stock no se guarda al editar.
    {
      const c = new MongoClient(MONGO);
      await c.connect();
      const { ObjectId } = require('mongodb');
      await c.db(DB).collection('articulos').updateOne({ _id: new ObjectId(idArt) }, { $set: { stock: -3 } });
      await c.close();
    }
    r = await api('PUT', `/api/articulos/${idArt}`, { input: { ...art, stock: -3, descripcion: 'Nombre corregido' } }, tokenAdmin);
    ok(r.ok && r.data.descripcion === 'Nombre corregido', 'un artículo con el stock mal guardado se puede seguir editando');
    r = await api('PUT', `/api/articulos/${idArt}`, { input: { ...art, precioVenta: -1 } }, tokenAdmin);
    ok(rechazo(r, 'precio de venta'), 'pero un precio negativo nuevo igual se rechaza');
    await api('POST', `/api/articulos/${idArt}/ajustar-stock`, { cantidad: 10, tipo: 'ajuste', motivo: 'prueba' }, tokenAdmin);

    r = await api('POST', '/api/ventas', { articuloId: idArt, cantidad: 1, metodoPago: 'fiado', clienteId: '000000000000000000000000' }, tokenAdmin);
    ok(rechazo(r, 'cliente'), 'un fiado a un cliente que no existe se rechaza');
    r = await api('POST', '/api/ventas', { articuloId: idArt, cantidad: 1, metodoPago: 'fiado', clienteId: 'abc' }, tokenAdmin);
    ok(rechazo(r, 'cliente'), 'un fiado con un cliente roto se rechaza');
    r = await api('GET', `/api/articulos/${idArt}`, undefined, tokenAdmin);
    ok(r.ok && r.data.stock === 10, 'y el stock no se tocó');
    r = await api('POST', '/api/clientes/000000000000000000000000/pago', { monto: 100, nota: null, metodoPago: 'efectivo' }, tokenAdmin);
    ok(rechazo(r, 'cliente'), 'un pago a un cliente que no existe se rechaza');
    r = await api('POST', '/api/familias', { nombre: '   ' }, tokenAdmin);
    ok(rechazo(r, 'nombre'), 'un rubro sin nombre se rechaza');
    r = await api('POST', '/api/marcas', {}, tokenAdmin);
    ok(rechazo(r, 'nombre'), 'una marca sin nombre se rechaza');

    log('\n[6] Lo del costo es sólo de la administradora');
    r = await api('GET', '/api/dashboard/stats', undefined, tokenAdmin);
    ok(r.ok && r.data.valorInventarioCosto > 0, 'la administradora ve el valor del inventario a costo');
    r = await api('POST', '/api/auth/login', { usuario: 'lucia', password: 'otra9999' });
    const tLucia = r.data.token;
    r = await api('GET', '/api/dashboard/stats', undefined, tLucia);
    ok(r.ok && r.data.valorInventarioCosto === 0, 'una empleada no lo ve');
    r = await api('PUT', `/api/articulos/${idArt}`, { input: { ...art, precioCosto: 120, precioVenta: 170 } }, tokenAdmin);
    ok(r.ok, 'la administradora cambia costo y precio');
    r = await api('GET', `/api/articulos/${idArt}/historial-precios`, undefined, tokenAdmin);
    ok(r.ok && r.data.some((h) => h.tipo === 'costo') && r.data.some((h) => h.tipo === 'venta'), 'la administradora ve los dos historiales');
    r = await api('GET', `/api/articulos/${idArt}/historial-precios`, undefined, tLucia);
    ok(r.ok && r.data.length > 0 && r.data.every((h) => h.tipo === 'venta'), 'una empleada ve sólo los cambios del precio de venta');
  } catch (e) {
    fallas += 1;
    log('\n✗ ERROR EN LA PRUEBA:', e.message);
  } finally {
    try {
      servidor?.kill();
    } catch {
      /* ya terminó */
    }
    await esperar(500);
    try {
      await vaciarBase();
    } catch {
      /* nada */
    }
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* nada */
    }
  }
  log(`\n${pasaron} comprobaciones bien, ${fallas} mal.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
