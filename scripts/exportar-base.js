// Exporta todas las colecciones de la base a archivos JSON (uno por
// colección), preservando los ObjectId y fechas correctamente (con EJSON,
// el "JSON extendido" de Mongo) para poder restaurarlos tal cual en la PC
// de destino sin romper las referencias entre artículos, ventas y clientes.
//
// Uso:  node scripts/exportar-base.js
// Genera una carpeta "backup-mis-amores/" al lado de este script.
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';
const CARPETA_SALIDA = path.join(__dirname, '..', 'backup-mis-amores');

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  fs.mkdirSync(CARPETA_SALIDA, { recursive: true });

  // El diario de sincronización (_sync_*) es propio de cada PC: no se exporta
  // (la PC de destino arma el suyo sola al arrancar).
  const colecciones = (await db.listCollections().toArray()).filter((c) => !c.name.startsWith('_sync_'));
  let totalDocs = 0;

  for (const { name } of colecciones) {
    const docs = await db.collection(name).find({}).toArray();
    fs.writeFileSync(path.join(CARPETA_SALIDA, `${name}.json`), EJSON.stringify(docs, null, 2));
    console.log(`  ${name}: ${docs.length} documento(s)`);
    totalDocs += docs.length;
  }

  await client.close();
  console.log(`\nListo. ${totalDocs} documentos guardados en:\n${CARPETA_SALIDA}`);
}

main().catch((err) => {
  console.error('ERROR al exportar:', err.message);
  process.exit(1);
});
