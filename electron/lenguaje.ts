// Cómo se "limpia" lo que escribe la persona antes de entenderlo (lo usa el asistente simple, el de los patrones).
// Sin tildes, sin mayúsculas, sin signos de pregunta, y con los errores y abreviaturas más comunes arreglados.

/** Minúsculas y sin tildes: "¿Cuánto vendí?" → "¿cuanto vendi?". */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // saca tildes: "cuanto" queda sin acento
    .trim();
}

// Cómo se escribe de apuro (chat, celular).
const JERGA: Array<[RegExp, string]> = [
  [/\bq\b/g, 'que'],
  [/\bk\b/g, 'que'],
  [/\b(?:xq|pq|porq)\b/g, 'porque'],
  [/\bbend(i|io|imos|iste|ieron)\b/g, 'vend$1'],
  [/\b(?:stok|estok|estock|stoc)\b/g, 'stock'],
  [/\bhoi\b/g, 'hoy'],
  [/\b(?:ayr|aier|ayerr)\b/g, 'ayer'],
];

/** La pregunta lista para entender: normalizada, sin signos de pregunta, sin letras repetidas ("holaaa") y con la jerga arreglada. */
export function canonico(texto: string): string {
  let t = normalizar(texto)
    .replace(/[¿?¡!"“”«»]/g, ' ')
    .replace(/([a-z])\1{2,}/g, '$1'); // "holaaa" → "hola", "vendiii" → "vendi" (los números no se tocan)
  for (const [patron, cambio] of JERGA) t = t.replace(patron, cambio);
  return t.replace(/\s+/g, ' ').trim();
}

export const METODOS = /\b(efectivo|tarjeta|transferencia|fiado)\b/;
export const METODOS_GLOBAL = /(?:\b(?:en|con|por|a)\s+)?\b(?:efectivo|tarjeta|transferencia|fiado)\b/g;

// Palabras que dicen "se habla de ventas / plata que entró". Una pregunta con alguna de estas tiene tema propio.
export const DICE_VENTAS = '(?:vend|cobr|\\bentr(?:o|aron)\\b|factur|\\bhice\\b|recaud|\\bcaja\\b|\\bventas?\\b|\\bingres)';
export const RE_DICE_VENTAS = new RegExp(DICE_VENTAS);

// De qué se habla: si una pregunta no dice nada de esto, es un seguimiento ("¿y ayer?", "¿y en efectivo?", "¿y Marta?").
const TEMA = new RegExp(
  [
    DICE_VENTAS,
    'stock',
    '\\bdeb[eo]\\b|\\bdeben\\b|deuda|deudor|adeuda|\\bsaldo\\b',
    'precio|cuesta|cuanto (?:sale|vale|es|esta|tengo|queda)|a cuanto',
    '\\bquedan?\\b|\\bhay\\b|\\btenes\\b|\\btengo\\b|\\bfalta',
    'producto|articulo|rubro|cliente|fiad|recordatorio|pendiente',
    'resumen|como (?:estuvo|viene|va|me fue|nos fue|anduvo)',
    'promedio|ticket|compar|telefono|codigo|inventario|agot|reponer|se acabo',
    'mas vendid|mas car|mas barat|que dia',
    'gananc|margen|utilidad|\\bgane\\b',
    'gracias|hola|chau|ayuda|quien sos',
  ].join('|')
);

/** ¿La pregunta habla de algo propio? (Si no, depende de lo que se venía hablando.) */
export function tieneTema(preguntaCanonica: string): boolean {
  return TEMA.test(preguntaCanonica);
}

// ---------- Errores de tipeo ----------

const VOCABULARIO = [
  'vendi', 'vendiste', 'vendimos', 'vendio', 'vendido', 'vendidos', 'vendemos', 'cobre', 'cobraste', 'facture', 'recaude',
  'hoy', 'ayer', 'anteayer', 'semana', 'pasada', 'pasado', 'anterior', 'efectivo', 'tarjeta', 'transferencia', 'fiado', 'fiados',
  'stock', 'precio', 'precios', 'cuesta', 'cuanto', 'cuantos', 'cuantas', 'quien', 'quienes', 'debe', 'deben', 'deuda', 'deudas',
  'cliente', 'clientes', 'producto', 'productos', 'articulo', 'articulos', 'rubro', 'rubros', 'caro', 'barato', 'caros', 'baratos',
  'venta', 'ventas', 'caja', 'resumen', 'pendiente', 'pendientes', 'recordatorio', 'recordatorios', 'promedio', 'comparado',
  'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'telefono', 'codigo', 'inventario', 'quedan', 'queda',
  'tenemos', 'falta', 'faltan', 'reponer', 'agotado', 'agotados', 'mejor', 'peor', 'ganancia', 'ganancias', 'hicimos', 'pagaron',
];
// (Los meses no están: "entro" se parece a "enero" y una corrección de más es peor que ninguna.)

/** Las palabras que dicen "cuándo": con ellas se arreglan los errores de tipeo aunque la pregunta ya se haya entendido. */
export const PALABRAS_DE_CUANDO: ReadonlySet<string> = new Set([
  'hoy', 'ayer', 'anteayer', 'semana', 'pasada', 'pasado', 'anterior', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
]);
const ESVOCABULARIO = new Set(VOCABULARIO);

// Distancia de edición (con dos letras cambiadas de lugar), cortando apenas supera `max`.
function distancia(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Arregla palabras mal escritas ("cuanto vedi", "stok", "ayr") cambiándolas por la palabra conocida más parecida.
 * Sólo se usa cuando la pregunta no se entendió tal cual (así no se tocan los nombres de productos y clientes). */
export function corregirTipeos(preguntaCanonica: string, soloHacia?: ReadonlySet<string>): string {
  return preguntaCanonica
    .split(' ')
    .map((palabra) => {
      if (palabra.length < 4 || ESVOCABULARIO.has(palabra) || /\d/.test(palabra)) return palabra;
      const max = palabra.length >= 8 ? 2 : 1;
      let mejor: string | null = null;
      let mejorDistancia = max + 1;
      for (const conocida of VOCABULARIO) {
        if (soloHacia && !soloHacia.has(conocida)) continue;
        if (conocida[0] !== palabra[0]) continue; // casi nadie se equivoca en la primera letra
        const dist = distancia(palabra, conocida, max);
        if (dist < mejorDistancia) {
          mejor = conocida;
          mejorDistancia = dist;
        }
      }
      return mejor ?? palabra;
    })
    .join(' ');
}
