// El estado de cuenta de un cliente: un PDF con lo que debe, para descargarlo o
// mandárselo, y el enlace firmado que va en el código QR.
//
// El enlace se puede abrir sin usuario ni contraseña (la persona que lo escanea
// no tiene cuenta en Mis Amores), así que lo protege una firma: sin ella, no hay
// forma de armar el enlace de otro cliente, y vence a los 30 días. La firma sale
// de la clave de la red del negocio (la misma que tienen las PCs y el servidor
// de internet), así que sirve en cualquiera de ellos.
import crypto from 'crypto';
import { formatearMonedaConCentavos, nombreArchivoEstadoCuenta } from '../shared/formato';
import { URL_SERVIDOR_INTERNET } from '../shared/servidor';
import type { EnlaceEstadoCuenta, EstadoCuenta, LineaEstadoCuenta } from '../shared/types';
import { direccionPublica } from './despertador';
import { ALTO_PAGINA, ANCHO_PAGINA, PdfSimple, type Color } from './pdfSimple';

/** Cuánto sirve un enlace desde que se arma. */
export const VIGENCIA_ENLACE_SEGUNDOS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// El enlace firmado
// ---------------------------------------------------------------------------

function firmar(claveRed: string, clienteId: string, expiraSegundos: number): string {
  // Una llave aparte para esto (no la clave de la red tal cual): una firma de
  // estado de cuenta nunca puede servir para otra cosa, ni al revés.
  const llave = crypto.createHmac('sha256', claveRed).update('mis-amores:estado-de-cuenta').digest();
  return crypto.createHmac('sha256', llave).update(`${clienteId}.${expiraSegundos}`).digest('base64url').slice(0, 27);
}

/** La dirección de la página de internet: la que usa el celular. En un servidor
 * de internet la da el servicio (RENDER_EXTERNAL_URL); en una PC, la de siempre. */
export function urlBase(): string {
  return direccionPublica() ?? URL_SERVIDOR_INTERNET;
}

export function crearEnlaceEstado(claveRed: string, clienteId: string, ahoraMs = Date.now()): EnlaceEstadoCuenta {
  if (!claveRed) throw new Error('Todavía no se puede armar el enlace: falta la clave de la red de PCs.');
  const expira = Math.floor(ahoraMs / 1000) + VIGENCIA_ENLACE_SEGUNDOS;
  return {
    url: `${urlBase()}/estado/${clienteId}/${expira}/${firmar(claveRed, clienteId, expira)}`,
    expira: new Date(expira * 1000).toISOString(),
  };
}

/** 'ok', 'vencido' (firma buena pero pasó la fecha) o 'invalido' (cualquier otra cosa). */
export function verificarEnlaceEstado(
  claveRed: string,
  clienteId: string,
  expira: string,
  firma: string,
  ahoraMs = Date.now()
): 'ok' | 'vencido' | 'invalido' {
  if (!claveRed || !/^[0-9a-f]{24}$/.test(clienteId) || !/^\d{1,12}$/.test(expira)) return 'invalido';
  const esperada = Buffer.from(firmar(claveRed, clienteId, Number(expira)));
  const recibida = Buffer.from(String(firma));
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return 'invalido';
  return Number(expira) * 1000 < ahoraMs ? 'vencido' : 'ok';
}

export const nombreArchivoEstado = nombreArchivoEstadoCuenta;

// ---------------------------------------------------------------------------
// El PDF
// ---------------------------------------------------------------------------

const MARGEN = 42;
const ZONA = 'America/Argentina/Buenos_Aires';
const MARCA: Color = [0.16, 0.3, 0.74];
const TEXTO: Color = [0.1, 0.12, 0.16];
const GRIS: Color = [0.45, 0.5, 0.57];
const LINEA: Color = [0.88, 0.9, 0.93];
const FONDO: Color = [0.96, 0.97, 0.99];
const AMBAR: Color = [0.71, 0.35, 0.04];
const VERDE: Color = [0.02, 0.45, 0.31];

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function armarPdfEstado(estado: EstadoCuenta): Buffer {
  const pdf = new PdfSimple();
  const derecha = ANCHO_PAGINA - MARGEN;
  const anchoDetalle = 300;
  const limite = ALTO_PAGINA - 70; // más abajo va el pie de página

  // --- Encabezado ---
  pdf.rect(0, 0, ANCHO_PAGINA, 92, MARCA);
  pdf.texto(MARGEN, 50, 'Mis Amores', { tam: 24, negrita: true, color: [1, 1, 1] });
  pdf.texto(MARGEN, 71, 'Estado de cuenta', { tam: 12, color: [0.85, 0.9, 1] });
  pdf.texto(derecha, 50, fechaCorta(estado.fecha), { tam: 11, color: [1, 1, 1], alinear: 'der' });
  pdf.texto(derecha, 71, 'Fecha del resumen', { tam: 9, color: [0.85, 0.9, 1], alinear: 'der' });

  pdf.texto(MARGEN, 126, 'CLIENTE', { tam: 8, negrita: true, color: GRIS });
  const nombre = pdf.envolver(estado.nombre, 20, derecha - MARGEN, true)[0];
  pdf.texto(MARGEN, 148, nombre, { tam: 20, negrita: true });

  // --- El total ---
  const aFavor = estado.saldo < 0;
  const debe = estado.saldo > 0;
  const colorTotal = debe ? AMBAR : VERDE;
  pdf.rect(MARGEN, 168, derecha - MARGEN, 66, debe ? [1, 0.97, 0.88] : [0.9, 0.98, 0.94]);
  pdf.texto(MARGEN + 16, 190, debe ? 'TOTAL QUE DEBE' : aFavor ? 'SALDO A FAVOR' : 'ESTADO', {
    tam: 9,
    negrita: true,
    color: colorTotal,
  });
  pdf.texto(MARGEN + 16, 220, debe || aFavor ? formatearMonedaConCentavos(Math.abs(estado.saldo)) : 'No debe nada', {
    tam: 26,
    negrita: true,
    color: colorTotal,
  });
  pdf.texto(derecha - 16, 220, `al ${fechaCorta(estado.fecha)}`, { tam: 10, color: GRIS, alinear: 'der' });

  let y = 262;

  const encabezadoTabla = () => {
    pdf.rect(MARGEN, y, derecha - MARGEN, 20, FONDO);
    pdf.texto(MARGEN + 8, y + 14, 'FECHA', { tam: 8, negrita: true, color: GRIS });
    pdf.texto(MARGEN + 86, y + 14, 'DETALLE', { tam: 8, negrita: true, color: GRIS });
    pdf.texto(derecha - 8, y + 14, 'MONTO', { tam: 8, negrita: true, color: GRIS, alinear: 'der' });
    y += 20;
  };

  // Cada sección: un título, una tabla de líneas (fecha, detalle, monto) y su suma.
  const seccion = (titulo: string, lineas: LineaEstadoCuenta[], vacio: string, signo: '+' | '-') => {
    if (y + 60 > limite) {
      pdf.nuevaPagina();
      y = 60;
    }
    pdf.texto(MARGEN, y, titulo, { tam: 12, negrita: true });
    y += 12;
    encabezadoTabla();
    if (lineas.length === 0) {
      pdf.texto(MARGEN + 8, y + 18, vacio, { tam: 10, color: GRIS });
      y += 30;
      return;
    }
    for (const l of lineas) {
      const renglones = pdf.envolver(l.descripcion, 10, anchoDetalle);
      const alto = renglones.length * 13 + 9;
      if (y + alto > limite) {
        pdf.nuevaPagina();
        y = 60;
        encabezadoTabla(); // la tabla sigue en la página nueva: se repite el encabezado
      }
      pdf.texto(MARGEN + 8, y + 15, fechaCorta(l.fecha), { tam: 10, color: GRIS });
      renglones.forEach((r, i) => pdf.texto(MARGEN + 86, y + 15 + i * 13, r, { tam: 10 }));
      pdf.texto(derecha - 8, y + 15, `${signo === '-' ? '-' : ''}${formatearMonedaConCentavos(l.monto)}`, {
        tam: 10,
        negrita: true,
        alinear: 'der',
        color: signo === '-' ? VERDE : TEXTO,
      });
      y += alto;
      pdf.linea(MARGEN, y, derecha, y, LINEA, 0.6);
    }
    const suma = lineas.reduce((acc, l) => acc + l.monto, 0);
    pdf.texto(derecha - 8, y + 20, `${signo === '-' ? '-' : ''}${formatearMonedaConCentavos(suma)}`, {
      tam: 11,
      negrita: true,
      alinear: 'der',
      color: signo === '-' ? VERDE : TEXTO,
    });
    pdf.texto(derecha - 8 - pdf.ancho(formatearMonedaConCentavos(suma), 11, true) - 14, y + 20, 'Suma', {
      tam: 9,
      color: GRIS,
      alinear: 'der',
    });
    y += 42;
  };

  seccion('Lo que quedó anotado y todavía no se pagó', estado.pendientes, 'No hay nada anotado sin pagar.', '+');
  if (estado.pagos.length > 0) seccion('Pagos que ya hizo', estado.pagos, '', '-');

  // --- Cierre ---
  if (y + 40 > limite) {
    pdf.nuevaPagina();
    y = 60;
  }
  pdf.linea(MARGEN, y, derecha, y, TEXTO, 1);
  pdf.texto(MARGEN, y + 24, debe ? 'TOTAL QUE DEBE' : aFavor ? 'SALDO A FAVOR' : 'TOTAL', { tam: 12, negrita: true });
  pdf.texto(derecha, y + 24, debe || aFavor ? formatearMonedaConCentavos(Math.abs(estado.saldo)) : '$ 0,00', {
    tam: 16,
    negrita: true,
    color: colorTotal,
    alinear: 'der',
  });

  // --- Pie de cada página ---
  const total = pdf.cantidadDePaginas;
  for (let i = 0; i < total; i++) {
    pdf.linea(MARGEN, ALTO_PAGINA - 46, derecha, ALTO_PAGINA - 46, LINEA, 0.6, i);
    pdf.texto(MARGEN, ALTO_PAGINA - 30, `Mis Amores · Estado de cuenta de ${estado.nombre}`, { tam: 8, color: GRIS }, i);
    pdf.texto(derecha, ALTO_PAGINA - 30, `Página ${i + 1} de ${total}`, { tam: 8, color: GRIS, alinear: 'der' }, i);
  }
  return pdf.generar(`Estado de cuenta - ${estado.nombre}`);
}
