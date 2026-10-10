// Importa el catálogo viejo (scripts/catalogo-viejo-raw.txt, ~760 artículos
// exportados del sistema anterior) a la base de "Mis Amores Gestión".
//
// El .txt tiene una línea por artículo, con este formato:
//   [CODIGO DE BARRAS] DESCRIPCION [RUBRO] $ PRECIO $ 0.00 $ 0.00
// El código de barras y el rubro son opcionales (no todos los artículos
// viejos los tenían cargados). Los precios "Lista 2" y "Lista 3" vienen
// siempre en $0.00 en el archivo viejo, así que quedan en 0.
//
// Lo que NO trae el archivo viejo (costo, stock, marca) se deja en 0/vacío
// para completarlo a mano después, artículo por artículo, a medida que se
// va reponiendo mercadería.
//
// Uso:  node scripts/importar-catalogo-viejo.js
//       node scripts/importar-catalogo-viejo.js --dry-run   (sólo muestra el resumen, no toca la base)
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';
const RUTA_TXT = path.join(__dirname, 'catalogo-viejo-raw.txt');
const DRY_RUN = process.argv.includes('--dry-run');

// Rubros que aparecen como última palabra de la descripción en el archivo
// viejo. Si la última palabra no está acá, se asume que es parte del nombre
// del producto (ej. "DR LEMON LIMON") y el artículo queda sin rubro asignado.
const RUBROS_CONOCIDOS = new Set([
  'COMESTIBLE',
  'BEBIDAS',
  'LIMPIEZA',
  'PERFUMERIA',
  'VINOS',
  'DESCARTABLES',
  'PANIFICADOS',
  'VELAS',
  'FIAMBRE',
]);

const LINEA_RE = /^(?:(\d{5,14})\s+)?(.+?)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)\s*$/;

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (respuesta) => { rl.close(); resolve(respuesta); }));
}

function parsearPrecio(texto) {
  // El archivo viejo usa "3,500.00" (coma de miles, punto decimal).
  return Number(texto.replace(/,/g, ''));
}

function parsearLinea(lineaOriginal) {
  const linea = lineaOriginal.trim();
  if (!linea) return null;

  const m = linea.match(LINEA_RE);
  if (!m) return { error: `No coincide con el formato esperado: "${linea}"` };

  const [, codigoCrudo, descripcionCruda, precio1] = m;

  // Códigos tipo "000000" / "0000000" son placeholders del sistema viejo,
  // no códigos de barra reales — se descartan para no chocar contra el
  // índice único de códigos de barra.
  const codigoBarras = codigoCrudo && codigoCrudo.length >= 8 ? codigoCrudo : null;

  const palabras = descripcionCruda.trim().split(/\s+/);
  const ultima = palabras[palabras.length - 1];
  let rubroNombre = null;
  let descripcion = descripcionCruda.trim();
  if (RUBROS_CONOCIDOS.has(ultima)) {
    rubroNombre = ultima;
    descripcion = palabras.slice(0, -1).join(' ');
  }

  if (!descripcion) return { error: `Línea sin descripción: "${linea}"` };

  return {
    codigoBarras,
    descripcion,
    rubroNombre,
    precioVenta: parsearPrecio(precio1),
  };
}

async function main() {
  if (!fs.existsSync(RUTA_TXT)) {
    console.error(`No encontré ${RUTA_TXT}`);
    process.exit(1);
  }

  const lineas = fs.readFileSync(RUTA_TXT, 'utf-8').split(/\r?\n/);
  const items = [];
  const errores = [];

  for (const linea of lineas) {
    const resultado = parsearLinea(linea);
    if (!resultado) continue;
    if (resultado.error) {
      errores.push(resultado.error);
      continue;
    }
    items.push(resultado);
  }

  const conCodigo = items.filter((i) => i.codigoBarras).length;
  const sinRubro = items.filter((i) => !i.rubroNombre).length;
  const rubrosNecesarios = [...new Set(items.map((i) => i.rubroNombre).filter(Boolean))].sort();

  console.log(`Artículos parseados del .txt: ${items.length}`);
  console.log(`  con código de barras: ${conCodigo}`);
  console.log(`  sin código de barras: ${items.length - conCodigo}`);
  console.log(`  sin rubro (quedan para asignar a mano): ${sinRubro}`);
  console.log(`Rubros que va a usar: ${rubrosNecesarios.join(', ')}`);
  if (errores.length > 0) {
    console.log(`\nLíneas que no se pudieron interpretar (${errores.length}):`);
    errores.forEach((e) => console.log('  ' + e));
  }

  if (DRY_RUN) {
    console.log('\n(--dry-run: no se tocó la base de datos)');
    return;
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const articulosCol = db.collection('articulos');
  const familiasCol = db.collection('familias');

  const existentesCount = await articulosCol.countDocuments();
  if (existentesCount > 0) {
    const respuesta = await preguntar(
      `Ya hay ${existentesCount} artículo(s) cargados en la base. Este script no va a duplicar códigos de barra repetidos, ` +
        'pero los artículos sin código no se pueden verificar. ¿Seguir de todos modos? (escribí "si" para continuar): '
    );
    if (respuesta.trim().toLowerCase() !== 'si') {
      console.log('Cancelado.');
      await client.close();
      return;
    }
  }

  // Familias: reusar las que ya existen, crear las que falten.
  const familiasExistentes = await familiasCol.find().toArray();
  const familiaIdPorNombre = new Map(familiasExistentes.map((f) => [f.nombre, f._id]));
  for (const nombre of rubrosNecesarios) {
    if (!familiaIdPorNombre.has(nombre)) {
      const result = await familiasCol.insertOne({ nombre });
      familiaIdPorNombre.set(nombre, result.insertedId);
      console.log(`Rubro nuevo creado: ${nombre}`);
    }
  }

  // Para no duplicar si el script se corre dos veces: códigos de barra que
  // ya están en la base, y descripciones ya existentes (para los artículos
  // sin código, que no se pueden identificar de otra forma).
  const existentes = await articulosCol.find({}, { projection: { codigoBarras: 1, descripcion: 1 } }).toArray();
  const codigosExistentes = new Set(existentes.filter((a) => a.codigoBarras).map((a) => a.codigoBarras));
  const descripcionesExistentes = new Set(existentes.map((a) => a.descripcion.trim().toLowerCase()));

  const ahora = new Date().toISOString();
  const aInsertar = [];
  let omitidosPorDuplicado = 0;

  for (const item of items) {
    if (item.codigoBarras && codigosExistentes.has(item.codigoBarras)) {
      omitidosPorDuplicado++;
      continue;
    }
    if (!item.codigoBarras && descripcionesExistentes.has(item.descripcion.toLowerCase())) {
      omitidosPorDuplicado++;
      continue;
    }

    const doc = {
      descripcion: item.descripcion,
      marcaId: null,
      familiaId: item.rubroNombre ? familiaIdPorNombre.get(item.rubroNombre) : null,
      proveedorId: null,
      precioCosto: 0,
      precioVenta: item.precioVenta,
      precioLista2: 0,
      precioLista3: 0,
      utilidadPct: 0,
      stock: 0,
      stockMinimo: 0,
      stockIdeal: 0,
      unidad: 'unidad',
      imagenPath: null,
      nota: null,
      activo: true,
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    // Mismo criterio que el resto de la app: sin código de barras, el campo
    // directamente no se manda (el índice único es "sparse").
    if (item.codigoBarras) doc.codigoBarras = item.codigoBarras;

    aInsertar.push(doc);
  }

  if (aInsertar.length > 0) {
    await articulosCol.insertMany(aInsertar);
  }

  console.log(`\nListo. ${aInsertar.length} artículo(s) creado(s).`);
  if (omitidosPorDuplicado > 0) {
    console.log(`${omitidosPorDuplicado} se omitieron por ya existir (mismo código o misma descripción).`);
  }
  if (sinRubro > 0) {
    console.log(`${sinRubro} artículo(s) quedaron sin rubro asignado — conviene revisarlos desde la pantalla de Artículos.`);
  }

  await client.close();
}

main().catch((err) => {
  console.error('ERROR al importar:', err.message);
  process.exit(1);
});
