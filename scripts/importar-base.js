// El opuesto de exportar-base.js: lee los JSON de la carpeta
// "backup-mis-amores" y los carga en la base local de ESTA PC. Pensado para
// correr en la PC de destino, después de instalar MongoDB ahí, para tener
// exactamente los mismos usuarios / artículos / ventas / clientes que ya se
// habían cargado antes.
//
// Uso:  node scripts/importar-base.js
// Espera encontrar la carpeta "backup-mis-amores/" al lado de este script
// (copiala junto con el proyecto, o pegá su contenido ahí).
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';
const CARPETA_ENTRADA = path.join(__dirname, '..', 'backup-mis-amores');

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (respuesta) => { rl.close(); resolve(respuesta); }));
}

async function main() {
  if (!fs.existsSync(CARPETA_ENTRADA)) {
    console.error(`No encontré la carpeta ${CARPETA_ENTRADA}.\nCopiá ahí el backup exportado antes de importar.`);
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const existentes = await db.listCollections().toArray();
  const yaHayDatos = (await Promise.all(existentes.map((c) => db.collection(c.name).countDocuments()))).some(
    (n) => n > 0
  );
  if (yaHayDatos) {
    const respuesta = await preguntar(
      'Esta base ya tiene datos cargados. Importar puede duplicar cosas si ya corriste este script antes.\n¿Seguir de todos modos? (escribí "si" para continuar): '
    );
    if (respuesta.trim().toLowerCase() !== 'si') {
      console.log('Cancelado.');
      await client.close();
      return;
    }
  }

  const archivos = fs.readdirSync(CARPETA_ENTRADA).filter((f) => f.endsWith('.json'));
  let totalDocs = 0;

  for (const archivo of archivos) {
    const nombreColeccion = archivo.replace(/\.json$/, '');
    const docs = EJSON.parse(fs.readFileSync(path.join(CARPETA_ENTRADA, archivo), 'utf-8'));
    if (docs.length > 0) {
      await db.collection(nombreColeccion).insertMany(docs);
    }
    console.log(`  ${nombreColeccion}: ${docs.length} documento(s) importado(s)`);
    totalDocs += docs.length;
  }

  await client.close();
  console.log(`\nListo. ${totalDocs} documentos importados en "${DB_NAME}".`);
}

main().catch((err) => {
  console.error('ERROR al importar:', err.message);
  process.exit(1);
});
