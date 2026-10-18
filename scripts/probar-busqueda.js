// Prueba de la búsqueda de artículos: las palabras en cualquier orden, sin importar
// mayúsculas ni tildes, coma o punto en los decimales, el código de barras, y que lo
// más parecido salga primero.
//
//   npm run build:electron
//   node scripts/probar-busqueda.js
//
// Levanta un servidor (Node común, sin Electron) con su propia base de prueba
// "test_busqueda", su carpeta y su puerto: no toca la base real del negocio.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient } = require('mongodb');

const RAIZ = path.resolve(__dirname, '..');
const MONGO = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const PUERTO = 4185;
const BASE = `http://127.0.0.1:${PUERTO}`;
const DB = 'test_busqueda';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-amores-busqueda-'));
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

async function api(metodo, ruta, cuerpo, token) {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return r.json();
}

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
    env: { ...process.env, MONGODB_URI: MONGO, MONGODB_DB_NAME: DB, MIS_AMORES_PUERTO: String(PUERTO), MIS_AMORES_CARPETA_DATOS: path.join(TMP, 'datos') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    try {
      if ((await fetch(BASE + '/api/sistema/info')).ok) return;
    } catch {
      /* todavía no */
    }
    await esperar(300);
  }
  throw new Error('El servidor de prueba no arrancó');
}

function entradaArticulo(base) {
  return {
    codigoBarras: null, descripcion: 'X', marcaId: null, familiaId: null, proveedorId: null,
    precioCosto: 60, precioVenta: 100, precioLista2: 0, precioLista3: 0, utilidadPct: 0,
    stock: 10, stockMinimo: 1, stockIdeal: 5, unidad: 'unidad', imagenPath: null, nota: null, ...base,
  };
}

(async () => {
  try {
    log('Levantando un servidor de prueba...');
    await levantar();
    const token = (await api('POST', '/api/auth/login', { usuario: 'admin', password: 'admin123' })).data.token;
    const descripciones = [
      ['COCA COLA 1.5L', '7790895000010'],
      ['COCA COLA ZERO 2.25L', '7790895000027'],
      ['COCA COLA LATA 354ML', null],
      ['COCADA DE DULCE DE LECHE', null],
      ['Café Último Molido 250g', '7791234500011'],
      ['PIÑA EN ALMÍBAR 800G', null],
      ['PINA COLADA PREMEZCLA', null],
      ['ALFAJOR TRIPLE CHOCOLATE', '7791111111111'],
      ['GALLETITAS CHOCOLATE (x3)', null],
      ['AGUA MINERAL SIN GAS 1,5L', null],
    ];
    for (const [descripcion, codigoBarras] of descripciones) {
      const r = await api('POST', '/api/articulos', entradaArticulo({ descripcion, codigoBarras }), token);
      if (!r.ok) throw new Error(`no se pudo crear "${descripcion}": ${r.error}`);
    }
    const buscar = async (texto, extra = '') => {
      const r = await api('GET', `/api/articulos?busqueda=${encodeURIComponent(texto)}${extra}`, undefined, token);
      if (!r.ok) throw new Error(`búsqueda "${texto}": ${r.error}`);
      return r.data.map((a) => a.descripcion);
    };

    log('\n[1] Las palabras, en cualquier orden');
    let r = await buscar('coca 1,5');
    ok(r.length === 1 && r[0] === 'COCA COLA 1.5L', `"coca 1,5" encuentra la Coca de 1.5L, aunque se escriba con coma (${JSON.stringify(r)})`);
    r = await buscar('1.5 coca');
    ok(r.length === 1 && r[0] === 'COCA COLA 1.5L', '"1.5 coca" (al revés) también');
    r = await buscar('cola coca');
    ok(r.length === 3, `"cola coca" encuentra las 3 Coca Cola (${r.length})`);
    r = await buscar('chocolate alfajor');
    ok(r.length === 1 && r[0].startsWith('ALFAJOR'), '"chocolate alfajor" encuentra sólo el alfajor');
    r = await buscar('galletitas x3');
    ok(r.length === 1, 'un paréntesis en la descripción no molesta ("galletitas x3")');
    r = await buscar('coca zero 2,25');
    ok(r.length === 1 && r[0].includes('ZERO'), 'tres palabras, una con coma: encuentra la Coca Zero');
    r = await buscar('agua 1.5');
    ok(r.length === 1 && r[0].startsWith('AGUA'), 'un decimal escrito con punto encuentra uno cargado con coma ("1,5L")');

    log('\n[2] Sin importar mayúsculas ni tildes');
    r = await buscar('cafe ultimo');
    ok(r.length === 1 && r[0].startsWith('Café'), '"cafe ultimo" encuentra "Café Último"');
    r = await buscar('CAFÉ');
    ok(r.length === 1, '"CAFÉ" con tilde y mayúsculas también');
    r = await buscar('pina');
    ok(r.length === 2, `"pina" encuentra "PIÑA" y "PINA" (${r.length})`);
    r = await buscar('piña almibar');
    ok(r.length === 1 && r[0].startsWith('PIÑA EN'), '"piña almibar" (con ñ y sin tilde) encuentra la piña en almíbar');
    r = await buscar('almíbar');
    ok(r.length === 1, 'escribir con tilde lo que está cargado con tilde también anda');

    log('\n[3] Por código de barras');
    r = await buscar('7790895000027');
    ok(r.length === 1 && r[0].includes('ZERO'), 'el código completo encuentra su producto');
    r = await buscar('7790895');
    ok(r.length === 2, 'un pedazo del código encuentra los que lo comparten');
    r = await buscar('coca 779089500001');
    ok(r.length === 1 && r[0] === 'COCA COLA 1.5L', 'una palabra y un pedazo de código juntos se combinan');

    log('\n[4] Lo más parecido primero');
    r = await buscar('coca');
    ok(r[0].startsWith('COCA COLA') && r[r.length - 1] === 'COCADA DE DULCE DE LECHE', `con "coca", las Coca Cola van antes que la cocada (${r.join(' | ')})`);
    r = await buscar('chocolate');
    ok(r.length === 2, '"chocolate" encuentra los 2 productos con chocolate');
    r = await buscar('pina');
    ok(r[0] === 'PINA COLADA PREMEZCLA' || r[0].startsWith('PIÑA'), 'entre iguales, el orden alfabético de siempre');

    log('\n[5] Lo que no tiene que encontrar, y lo raro');
    r = await buscar('coca pizza');
    ok(r.length === 0, '"coca pizza": si una de las palabras no aparece, no trae nada');
    r = await buscar('coca 3');
    ok(r.length === 1 && r[0].includes('354ML'), '"coca 3" encuentra sólo la lata (un pedazo de "354"): las palabras valen por partes');
    r = await buscar('zzzz');
    ok(r.length === 0, 'una palabra que no está no trae nada');
    r = await buscar('');
    ok(r.length === 10, 'sin escribir nada trae todo');
    r = await buscar('   ');
    ok(r.length === 10, 'con sólo espacios también');
    r = await buscar('.*');
    ok(r.length === 0, 'los símbolos de las expresiones regulares no se interpretan (".*")');
    r = await buscar('(');
    ok(r.length === 1 && r[0].includes('(x3)'), 'un paréntesis suelto no rompe la búsqueda: se busca tal cual (sólo está en una descripción)');
    r = await buscar('coca\\');
    ok(Array.isArray(r), 'una barra invertida no rompe la búsqueda');
    r = await buscar('a'.repeat(300));
    ok(r.length === 0, 'una palabra larguísima no rompe nada');

    log('\n[6] Con los otros filtros');
    const rubro = (await api('POST', '/api/familias', { nombre: 'BEBIDAS PRUEBA' }, token)).data;
    const cocaLata = (await api('GET', '/api/articulos?busqueda=lata', undefined, token)).data[0];
    await api('PUT', `/api/articulos/${cocaLata.id}`, { input: { ...entradaArticulo({ descripcion: cocaLata.descripcion }), familiaId: rubro.id }, original: undefined }, token);
    r = await buscar('coca', `&familiaId=${rubro.id}`);
    ok(r.length === 1 && r[0].includes('LATA'), 'la búsqueda se combina con el rubro');
    const papelera = (await api('GET', '/api/articulos?busqueda=cocada', undefined, token)).data[0];
    await api('DELETE', `/api/articulos/${papelera.id}`, undefined, token);
    r = await buscar('coca');
    ok(r.length === 3, 'un artículo de la papelera no aparece');
    r = await buscar('cocada', '&soloInactivos=true');
    ok(r.length === 1, 'en la papelera sí se encuentra (también con la búsqueda nueva)');
    // "Vaciar papelera" borra exactamente lo que muestra la búsqueda (usa el mismo criterio).
    r = await api('POST', '/api/articulos/vaciar-papelera?busqueda=' + encodeURIComponent('cocada dulce'), undefined, token);
    ok(r.ok && r.data === 1, 'vaciar la papelera con la búsqueda "cocada dulce" borra 1 (el mismo criterio que la lista)');
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
