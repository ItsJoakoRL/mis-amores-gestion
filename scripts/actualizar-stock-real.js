// Actualiza precios, stock y rubro con datos reales del sistema viejo,
// exportados a "stocks excel.xlsx" (Detalle, Familia, P.Venta, IVA, Stock,
// Stock Min, Stock Ideal — sin código de barras).
//
// Para cada fila del Excel:
//   - Si ya existe un artículo con la misma descripción (viene del import
//     anterior de scripts/importar-catalogo-viejo.js, que sí tenía código de
//     barras), se actualiza: precio de venta, stock, stock mínimo, stock
//     ideal y rubro. El código de barras existente NO se toca.
//   - Si no existe, se crea un artículo nuevo sin código de barras.
//
// El stock negativo del sistema viejo (quedaban artículos "vendidos de más")
// se deja en 0, no tiene sentido stock físico negativo.
//
// Uso:
//   node scripts/actualizar-stock-real.js --dry-run   (sólo resumen, no toca la base)
//   node scripts/actualizar-stock-real.js              (aplica los cambios)
const { MongoClient } = require('mongodb');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'mis_amores_gestion';
const RUTA_ITEMS = 'C:/Users/joako/AppData/Local/Temp/stocks_excel_extracted/items.json';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const items = JSON.parse(fs.readFileSync(RUTA_ITEMS, 'utf-8'));

  const familiasNecesarias = [...new Set(items.map((i) => i.familia).filter(Boolean))].sort();
  const sinFamilia = items.filter((i) => !i.familia).length;
  const stockNegativoCount = items.filter((i) => i.stock < 0).length;

  console.log(`Artículos en el Excel: ${items.length}`);
  console.log(`  sin rubro: ${sinFamilia}`);
  console.log(`  con stock negativo (se pasa a 0): ${stockNegativoCount}`);
  console.log(`Rubros usados: ${familiasNecesarias.join(', ')}`);

  if (DRY_RUN) {
    console.log('\n(--dry-run: todavía no se conecta a la base)');
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const articulosCol = db.collection('articulos');
  const familiasCol = db.collection('familias');

  // Familias: reusar las que ya existen, crear las que falten.
  const familiasExistentes = await familiasCol.find().toArray();
  const familiaIdPorNombre = new Map(familiasExistentes.map((f) => [f.nombre, f._id]));
  for (const nombre of familiasNecesarias) {
    if (!familiaIdPorNombre.has(nombre)) {
      if (!DRY_RUN) {
        const result = await familiasCol.insertOne({ nombre });
        familiaIdPorNombre.set(nombre, result.insertedId);
      }
      console.log(`Rubro nuevo: ${nombre}`);
    }
  }

  // Índice por descripción (en minúscula) de los artículos ya cargados.
  const existentes = await articulosCol.find({}).toArray();
  const porDescripcion = new Map();
  for (const a of existentes) {
    const k = a.descripcion.trim().toLowerCase();
    if (!porDescripcion.has(k)) porDescripcion.set(k, []);
    porDescripcion.get(k).push(a);
  }

  const ahora = new Date().toISOString();
  let actualizados = 0;
  let creados = 0;
  let ambiguos = 0;
  const ambiguosDetalle = [];

  for (const item of items) {
    const stock = Math.max(0, item.stock);
    const familiaId = item.familia ? familiaIdPorNombre.get(item.familia) ?? null : null;
    const key = item.descripcion.trim().toLowerCase();
    const candidatos = porDescripcion.get(key) ?? [];

    if (candidatos.length === 1) {
      const actual = candidatos[0];
      if (!DRY_RUN) {
        await articulosCol.updateOne(
          { _id: actual._id },
          {
            $set: {
              precioVenta: item.precioVenta,
              stock,
              stockMinimo: item.stockMinimo,
              stockIdeal: item.stockIdeal,
              familiaId,
              actualizadoEn: ahora,
            },
          }
        );
      }
      actualizados++;
    } else if (candidatos.length > 1) {
      ambiguos++;
      if (ambiguosDetalle.length < 15) ambiguosDetalle.push(item.descripcion);
    } else {
      const doc = {
        descripcion: item.descripcion,
        marcaId: null,
        familiaId,
        proveedorId: null,
        precioCosto: 0,
        precioVenta: item.precioVenta,
        precioLista2: 0,
        precioLista3: 0,
        utilidadPct: 0,
        stock,
        stockMinimo: item.stockMinimo,
        stockIdeal: item.stockIdeal,
        unidad: 'unidad',
        imagenPath: null,
        nota: null,
        activo: true,
        creadoEn: ahora,
        actualizadoEn: ahora,
      };
      if (!DRY_RUN) {
        const result = await articulosCol.insertOne(doc);
        // Para que filas repetidas del Excel con la misma descripción no
        // vuelvan a insertar de nuevo, sino que actualicen esta.
        doc._id = result.insertedId;
      }
      if (!porDescripcion.has(key)) porDescripcion.set(key, []);
      porDescripcion.get(key).push(doc);
      creados++;
    }
  }

  console.log(`\nActualizados (ya existían por descripción): ${actualizados}`);
  console.log(`Creados nuevos: ${creados}`);
  console.log(`Ambiguos (más de un artículo con la misma descripción, no se tocaron): ${ambiguos}`);
  if (ambiguosDetalle.length > 0) {
    console.log('  ejemplos:');
    ambiguosDetalle.forEach((d) => console.log('   - ' + d));
  }

  if (DRY_RUN) console.log('\n(--dry-run: no se escribió nada en la base)');

  await client.close();
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
