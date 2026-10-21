// Prueba de que nada queda apuntando a algo que se unificó con otro.
//
// Cuando dos PCs cargan a la vez el mismo cliente (o rubro, o marca), las dos
// fichas se unifican en una y la que pierde se borra. Si en ese momento esta PC
// estaba escribiendo algo que apuntaba a la ficha que perdió (el "Saldo inicial"
// de un cliente nuevo se guarda en un segundo paso, un pago de alguien que ya
// tenía la pantalla abierta...), antes quedaba apuntando a una ficha borrada: acá
// el cliente mostraba una deuda y en la otra PC otra distinta.
//
//   npm run build:electron
//   node scripts/probar-referencias.js
//
// No abre la app: usa el diario y el aplicador de cambios directamente, sobre la
// base "test_referencias" del Mongo local (no toca la base del negocio).
const crypto = require('crypto');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const { Diario } = require(path.join(RAIZ, 'dist-electron/electron/sync/diario.js'));
const { Reloj } = require(path.join(RAIZ, 'dist-electron/electron/sync/reloj.js'));
const { Aplicador } = require(path.join(RAIZ, 'dist-electron/electron/sync/aplicar.js'));
const { huellaDeDoc, cuerpoReplicado } = require(path.join(RAIZ, 'dist-electron/electron/sync/modelo.js'));

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
const mismo = (a, b) => !!a && !!b && String(a) === String(b);

// Dos ids: el primero es el que gana al unificar (el de menor valor).
function parDeIds() {
  const [ganador, perdedor] = [new ObjectId(), new ObjectId()].sort((x, y) => (x.toHexString() < y.toHexString() ? -1 : 1));
  return { ganador, perdedor };
}

async function main() {
  const cliente = new MongoClient(MONGO);
  await cliente.connect();
  const db = cliente.db('test_referencias');
  await db.dropDatabase();
  // Los mismos índices de la app: son los que hacen "chocar" a dos clientes repetidos.
  await db.collection('clientes').createIndex({ nombre: 1 }, { unique: true, partialFilterExpression: { activo: true } });
  await db.collection('familias').createIndex({ nombre: 1 }, { unique: true });

  const idPc = crypto.randomUUID();
  const diario = new Diario(db, new Reloj(idPc), idPc);
  await diario.iniciar();
  const avisos = [];
  const aplicador = new Aplicador(diario, { carpetaImagenes: process.env.TEMP || '.', alAvisar: (t) => avisos.push(t), alFallar: (e, err) => log('   (falla interna)', e, err && err.message) });

  const escribir = (coleccion, metodo, ...args) => diario.envolver(db.collection(coleccion), metodo, args);
  const metaDe = (coleccion, id) => db.collection('_sync_meta').findOne({ _id: `${coleccion}:${id.toHexString()}` });
  const usuarioId = new ObjectId();
  const hoy = () => new Date().toISOString();

  // Lo que mandaría otra PC al cargar una ficha nueva.
  const relojOtro = new Reloj('otra-pc');
  function llegaDeOtraPc(coleccion, id, doc) {
    const marca = relojOtro.nueva();
    const clocks = {};
    for (const k of Object.keys(cuerpoReplicado(coleccion, doc))) clocks[k] = marca;
    return { c: coleccion, id, seq: 1, inc: 0, del: null, clocks, doc: cuerpoReplicado(coleccion, doc) };
  }

  // ------------------------------------------------------------------
  log('\n1) El caso real: el "Saldo inicial" se escribe DESPUÉS de que se unificó el cliente');
  const { ganador, perdedor } = parDeIds();
  await escribir('clientes', 'insertOne', { _id: perdedor, nombre: 'MARIA', nota: null, telefono: null, activo: true, creadoEn: hoy() });
  const llegada = await aplicador.aplicar([llegaDeOtraPc('clientes', ganador, { nombre: 'MARIA', nota: null, telefono: null, activo: true, creadoEn: hoy() })], 'otra-pc');
  ok(llegada.errores === 0, 'la ficha repetida que llega de la otra PC se aplica sin errores');
  ok((await db.collection('clientes').countDocuments({ nombre: 'MARIA' })) === 1, 'quedó una sola MARIA');
  ok(mismo((await db.collection('clientes').findOne({ nombre: 'MARIA' }))._id, ganador), 'y es la de menor id (la que gana en todas las PCs)');
  ok(mismo(diario.aliasDe('clientes', perdedor), ganador), 'se anotó que la ficha local se unificó con la ganadora');
  ok(avisos.length === 1 && /MARIA/.test(avisos[0]), 'la administradora recibe el aviso de que se unificaron');

  const insertado = await escribir('ajustes_cuenta', 'insertOne', { clienteId: perdedor, monto: 100, fecha: hoy(), usuarioId, nota: 'Saldo inicial' });
  let ajuste = await db.collection('ajustes_cuenta').findOne({ _id: insertado.insertedId });
  ok(mismo(ajuste.clienteId, ganador), 'el saldo inicial escrito a último momento apunta a la ficha que quedó (no a la borrada)');
  let meta = await metaDe('ajustes_cuenta', ajuste._id);
  ok(!!meta && meta.h === huellaDeDoc('ajustes_cuenta', ajuste), 'y el diario lo anotó ya corregido');
  ok(!!meta && typeof meta.clocks.clienteId === 'string', 'con marca de reloj propia en el campo corregido (viaja a las otras PCs)');
  const cambios = await diario.cambiosDesde(0, 1000);
  const enviado = cambios.items.find((i) => i.c === 'ajustes_cuenta' && mismo(i.id, ajuste._id));
  ok(!!enviado && mismo(enviado.doc.clienteId, ganador), 'lo que se ofrece a la otra PC también apunta a la ficha que quedó');

  // ------------------------------------------------------------------
  log('\n2) Una modificación que apunta a la ficha que se unificó');
  const pago = await escribir('pagos_cuenta', 'insertOne', { clienteId: ganador, monto: 40, metodo: 'efectivo', fecha: hoy(), usuarioId });
  await escribir('pagos_cuenta', 'updateOne', { _id: pago.insertedId }, { $set: { clienteId: perdedor } });
  const pagoDespues = await db.collection('pagos_cuenta').findOne({ _id: pago.insertedId });
  ok(mismo(pagoDespues.clienteId, ganador), 'un updateOne que lo apunta a la ficha vieja queda apuntando a la ganadora');
  await escribir('pagos_cuenta', 'updateMany', { _id: pago.insertedId }, { $set: { clienteId: perdedor, monto: 45 } });
  const pagoMas = await db.collection('pagos_cuenta').findOne({ _id: pago.insertedId });
  ok(mismo(pagoMas.clienteId, ganador) && pagoMas.monto === 45, 'igual con updateMany, y el resto del cambio (el monto) se conserva');
  meta = await metaDe('pagos_cuenta', pago.insertedId);
  ok(meta.h === huellaDeDoc('pagos_cuenta', pagoMas), 'el diario tiene la huella del documento corregido');

  // ------------------------------------------------------------------
  log('\n3) Varios documentos a la vez');
  const otroCliente = new ObjectId();
  await escribir('clientes', 'insertOne', { _id: otroCliente, nombre: 'JUANA', nota: null, telefono: null, activo: true, creadoEn: hoy() });
  const varios = await escribir('ventas', 'insertMany', [
    { fecha: hoy(), clienteId: perdedor, total: 10, metodoPago: 'fiado' },
    { fecha: hoy(), clienteId: otroCliente, total: 20, metodoPago: 'fiado' },
    { fecha: hoy(), clienteId: null, total: 30, metodoPago: 'efectivo' },
  ]);
  const ids = Object.values(varios.insertedIds);
  const ventas = await db.collection('ventas').find({ _id: { $in: ids } }).sort({ total: 1 }).toArray();
  ok(mismo(ventas[0].clienteId, ganador), 'la venta que apuntaba a la ficha vieja pasó a la ganadora');
  ok(mismo(ventas[1].clienteId, otroCliente), 'la de otro cliente quedó como estaba');
  ok(ventas[2].clienteId === null, 'y la venta sin cliente sigue sin cliente');

  // ------------------------------------------------------------------
  log('\n4) Unificaciones encadenadas y otras colecciones (rubros, usuarios)');
  const c1 = new ObjectId();
  const c2 = new ObjectId();
  const c3 = new ObjectId();
  await diario.guardarAlias('clientes', c1, c2);
  await diario.guardarAlias('clientes', c2, c3);
  const enCadena = await escribir('pagos_cuenta', 'insertOne', { clienteId: c1, monto: 5, metodo: 'efectivo', fecha: hoy(), usuarioId });
  ok(mismo((await db.collection('pagos_cuenta').findOne({ _id: enCadena.insertedId })).clienteId, c3), 'si la ficha se unificó dos veces seguidas, llega hasta la última');

  const u1 = new ObjectId();
  const u2 = new ObjectId();
  await diario.guardarAlias('usuarios', u1, u2);
  const conUsuario = await escribir('pagos_cuenta', 'insertOne', { clienteId: otroCliente, monto: 6, metodo: 'efectivo', fecha: hoy(), usuarioId: u1 });
  const docUsuario = await db.collection('pagos_cuenta').findOne({ _id: conUsuario.insertedId });
  ok(mismo(docUsuario.usuarioId, u2) && mismo(docUsuario.clienteId, otroCliente), 'un usuario unificado también se corrige (y el cliente, que no cambió, no se toca)');

  const f1 = new ObjectId();
  const f2 = new ObjectId();
  await diario.guardarAlias('familias', f1, f2);
  const art = await escribir('articulos', 'insertOne', { descripcion: 'PRODUCTO DE PRUEBA', familiaId: f1, marcaId: null, precioVenta: 10, stock: 0 });
  ok(mismo((await db.collection('articulos').findOne({ _id: art.insertedId })).familiaId, f2), 'un producto cargado con el rubro que se unificó queda con el rubro que quedó');

  // ------------------------------------------------------------------
  log('\n5) Lo que no se escribió por el diario: lo repara la revisión general');
  const huerfano = await db.collection('pagos_cuenta').insertOne({ clienteId: perdedor, monto: 7, metodo: 'efectivo', fecha: hoy(), usuarioId });
  const anotados = await diario.barrer({ marcaNuevos: 'ahora' });
  const reparado = await db.collection('pagos_cuenta').findOne({ _id: huerfano.insertedId });
  ok(anotados >= 1, `la revisión general lo encontró (${anotados} anotado/s)`);
  ok(mismo(reparado.clienteId, ganador), 'y lo pasó a apuntar a la ficha que quedó');
  meta = await metaDe('pagos_cuenta', huerfano.insertedId);
  ok(!!meta && meta.h === huellaDeDoc('pagos_cuenta', reparado), 'quedó anotado en el diario, así viaja a las otras PCs');
  const seqAntes = (await db.collection('_sync_meta').find({}).sort({ seq: -1 }).limit(1).toArray())[0].seq;
  const otraVez = await diario.barrer({ marcaNuevos: 'ahora' });
  const seqDespues = (await db.collection('_sync_meta').find({}).sort({ seq: -1 }).limit(1).toArray())[0].seq;
  ok(otraVez === 0 && seqAntes === seqDespues, 'una segunda revisión no encuentra nada más ni anota cambios de más');

  // ------------------------------------------------------------------
  log('\n6) Que no se rompa lo de siempre');
  const normal = await escribir('ajustes_cuenta', 'insertOne', { clienteId: otroCliente, monto: 15, fecha: hoy(), usuarioId, nota: 'Saldo inicial' });
  const docNormal = await db.collection('ajustes_cuenta').findOne({ _id: normal.insertedId });
  ok(mismo(docNormal.clienteId, otroCliente), 'una escritura a un cliente que sigue vivo no se modifica');
  const sinReferencias = await escribir('clientes', 'insertOne', { nombre: 'ROSA', nota: null, telefono: null, activo: true, creadoEn: hoy() });
  ok(!!(await db.collection('clientes').findOne({ _id: sinReferencias.insertedId })), 'y una colección sin referencias (clientes) se escribe como siempre');

  await db.dropDatabase();
  await cliente.close();
  log(`\n${fallas === 0 ? '✓ TODO BIEN' : '✗ HAY FALLAS'}: ${pasaron} pasaron, ${fallas} fallaron.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Se cortó la prueba:', err);
  process.exit(1);
});
