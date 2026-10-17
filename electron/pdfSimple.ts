// Un generador de PDF mínimo, sin librerías: páginas A4 con texto (Helvetica) y
// rectángulos. Alcanza para un estado de cuenta (un título, una tabla de líneas)
// y no agrega peso al instalador ni al servidor de internet.
//
// Las coordenadas son en puntos, con el origen arriba a la izquierda (como en
// una pantalla); `y` de un texto es su línea de base.

export type Color = readonly [number, number, number]; // cada uno de 0 a 1

export const ANCHO_PAGINA = 595.28;
export const ALTO_PAGINA = 841.89;

// Cuánto mide cada letra de Helvetica y de Helvetica-Bold (milésimas del tamaño
// de letra) desde el espacio (32) hasta "~" (126), para poder alinear y cortar
// renglones. Las letras con tilde miden lo mismo que su letra sin tilde.
const NORMAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];
const NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

const RANGO_DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

// Lo que no está en el alfabeto de Windows-1252 (el de "WinAnsiEncoding", el que
// se declara en el PDF) se reemplaza por algo parecido.
const PARECIDOS: Record<number, string> = {
  0x2212: '-', // −
  0x2013: '\x96', // –
  0x2014: '\x97', // —
  0x2022: '\x95', // •
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x20ac: '\x80', // €
};

function aWinAnsi(texto: string): string {
  let salida = '';
  for (const c of texto) {
    const codigo = c.codePointAt(0)!;
    if (codigo >= 0x20 && codigo <= 0xff) salida += c;
    else if (PARECIDOS[codigo] !== undefined) salida += PARECIDOS[codigo];
    else salida += '?';
  }
  return salida;
}

function anchoLetra(c: string, negrita: boolean): number {
  const codigo = c.charCodeAt(0);
  if (codigo === 0xa0) return 278; // espacio que no se corta
  const tabla = negrita ? NEGRITA : NORMAL;
  if (codigo >= 32 && codigo <= 126) return tabla[codigo - 32];
  const base = c.normalize('NFD').replace(RANGO_DIACRITICOS, '');
  if (base !== c && base.length === 1) return anchoLetra(base, negrita);
  return 556;
}

function escapar(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const numero = (n: number) => (Math.round(n * 100) / 100).toString();
const colorPdf = (c: Color) => `${numero(c[0])} ${numero(c[1])} ${numero(c[2])}`;

export interface OpcionesTexto {
  tam?: number;
  negrita?: boolean;
  color?: Color;
  /** A qué lado de `x` se escribe: 'izq' (empieza en x), 'der' (termina en x) o 'centro'. */
  alinear?: 'izq' | 'der' | 'centro';
}

export class PdfSimple {
  private readonly paginas: string[][] = [[]];

  get cantidadDePaginas(): number {
    return this.paginas.length;
  }

  nuevaPagina(): void {
    this.paginas.push([]);
  }

  /** Cuánto mide un texto escrito con ese tamaño, en puntos. */
  ancho(texto: string, tam: number, negrita = false): number {
    let suma = 0;
    for (const c of aWinAnsi(texto)) suma += anchoLetra(c, negrita);
    return (suma * tam) / 1000;
  }

  /** Parte un texto en renglones que entren en `anchoMax` (corta por palabras). */
  envolver(texto: string, tam: number, anchoMax: number, negrita = false): string[] {
    const renglones: string[] = [];
    let actual = '';
    for (const palabra of texto.split(/\s+/).filter(Boolean)) {
      let candidata = actual ? `${actual} ${palabra}` : palabra;
      if (this.ancho(candidata, tam, negrita) <= anchoMax) {
        actual = candidata;
        continue;
      }
      if (actual) renglones.push(actual);
      // Una palabra más larga que el renglón: se corta donde no entra.
      candidata = palabra;
      while (this.ancho(candidata, tam, negrita) > anchoMax && candidata.length > 1) {
        let n = candidata.length - 1;
        while (n > 1 && this.ancho(candidata.slice(0, n), tam, negrita) > anchoMax) n -= 1;
        renglones.push(candidata.slice(0, n));
        candidata = candidata.slice(n);
      }
      actual = candidata;
    }
    if (actual) renglones.push(actual);
    return renglones.length > 0 ? renglones : [''];
  }

  /** Escribe un texto en la página `pagina` (por defecto, la última). */
  texto(x: number, y: number, texto: string, opciones: OpcionesTexto = {}, pagina = this.paginas.length - 1): void {
    const tam = opciones.tam ?? 10;
    const negrita = opciones.negrita ?? false;
    let xi = x;
    if (opciones.alinear === 'der') xi = x - this.ancho(texto, tam, negrita);
    else if (opciones.alinear === 'centro') xi = x - this.ancho(texto, tam, negrita) / 2;
    const color = colorPdf(opciones.color ?? [0.1, 0.12, 0.16]);
    this.paginas[pagina].push(
      `BT /${negrita ? 'F2' : 'F1'} ${numero(tam)} Tf ${color} rg ${numero(xi)} ${numero(ALTO_PAGINA - y)} Td (${escapar(aWinAnsi(texto))}) Tj ET`
    );
  }

  /** Un rectángulo lleno; (x, y) es su esquina de arriba a la izquierda. */
  rect(x: number, y: number, ancho: number, alto: number, color: Color, pagina = this.paginas.length - 1): void {
    this.paginas[pagina].push(
      `${colorPdf(color)} rg ${numero(x)} ${numero(ALTO_PAGINA - y - alto)} ${numero(ancho)} ${numero(alto)} re f`
    );
  }

  linea(x1: number, y1: number, x2: number, y2: number, color: Color, grosor = 0.5, pagina = this.paginas.length - 1): void {
    this.paginas[pagina].push(
      `${numero(grosor)} w ${colorPdf(color)} RG ${numero(x1)} ${numero(ALTO_PAGINA - y1)} m ${numero(x2)} ${numero(ALTO_PAGINA - y2)} l S`
    );
  }

  /** El archivo PDF terminado. Todo el texto va en Windows-1252, un byte por letra. */
  generar(titulo = 'Documento'): Buffer {
    const cuerpos: string[] = [];
    // 1: catálogo, 2: páginas, 3 y 4: las dos fuentes, 5: datos del documento.
    // Después, de a dos por página: la página y su contenido.
    const idPagina = (i: number) => 6 + i * 2;
    cuerpos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    cuerpos[2] = `<< /Type /Pages /Count ${this.paginas.length} /Kids [${this.paginas
      .map((_, i) => `${idPagina(i)} 0 R`)
      .join(' ')}] >>`;
    cuerpos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    cuerpos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    cuerpos[5] = `<< /Title (${escapar(aWinAnsi(titulo))}) /Producer (Mis Amores) >>`;
    this.paginas.forEach((comandos, i) => {
      const contenido = comandos.join('\n');
      cuerpos[idPagina(i)] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_PAGINA} ${ALTO_PAGINA}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idPagina(i) + 1} 0 R >>`;
      cuerpos[idPagina(i) + 1] = `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`;
    });

    let salida = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const posiciones: number[] = [];
    for (let id = 1; id < cuerpos.length; id++) {
      posiciones[id] = salida.length;
      salida += `${id} 0 obj\n${cuerpos[id]}\nendobj\n`;
    }
    const inicioTabla = salida.length;
    salida += `xref\n0 ${cuerpos.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < cuerpos.length; id++) salida += `${String(posiciones[id]).padStart(10, '0')} 00000 n \n`;
    salida += `trailer\n<< /Size ${cuerpos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${inicioTabla}\n%%EOF\n`;
    return Buffer.from(salida, 'latin1');
  }
}
