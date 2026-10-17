"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nombreArchivoEstado = exports.VIGENCIA_ENLACE_SEGUNDOS = void 0;
exports.urlBase = urlBase;
exports.crearEnlaceEstado = crearEnlaceEstado;
exports.verificarEnlaceEstado = verificarEnlaceEstado;
exports.armarPdfEstado = armarPdfEstado;
// El estado de cuenta de un cliente: un PDF con lo que debe, para descargarlo o
// mandárselo, y el enlace firmado que va en el código QR.
//
// El enlace se puede abrir sin usuario ni contraseña (la persona que lo escanea
// no tiene cuenta en Mis Amores), así que lo protege una firma: sin ella, no hay
// forma de armar el enlace de otro cliente, y vence a los 30 días. La firma sale
// de la clave de la red del negocio (la misma que tienen las PCs y el servidor
// de internet), así que sirve en cualquiera de ellos.
const crypto_1 = __importDefault(require("crypto"));
const formato_1 = require("../shared/formato");
const servidor_1 = require("../shared/servidor");
const despertador_1 = require("./despertador");
const pdfSimple_1 = require("./pdfSimple");
/** Cuánto sirve un enlace desde que se arma. */
exports.VIGENCIA_ENLACE_SEGUNDOS = 30 * 24 * 60 * 60;
// ---------------------------------------------------------------------------
// El enlace firmado
// ---------------------------------------------------------------------------
function firmar(claveRed, clienteId, expiraSegundos) {
    // Una llave aparte para esto (no la clave de la red tal cual): una firma de
    // estado de cuenta nunca puede servir para otra cosa, ni al revés.
    const llave = crypto_1.default.createHmac('sha256', claveRed).update('mis-amores:estado-de-cuenta').digest();
    return crypto_1.default.createHmac('sha256', llave).update(`${clienteId}.${expiraSegundos}`).digest('base64url').slice(0, 27);
}
/** La dirección de la página de internet: la que usa el celular. En un servidor
 * de internet la da el servicio (RENDER_EXTERNAL_URL); en una PC, la de siempre. */
function urlBase() {
    return (0, despertador_1.direccionPublica)() ?? servidor_1.URL_SERVIDOR_INTERNET;
}
function crearEnlaceEstado(claveRed, clienteId, ahoraMs = Date.now()) {
    if (!claveRed)
        throw new Error('Todavía no se puede armar el enlace: falta la clave de la red de PCs.');
    const expira = Math.floor(ahoraMs / 1000) + exports.VIGENCIA_ENLACE_SEGUNDOS;
    return {
        url: `${urlBase()}/estado/${clienteId}/${expira}/${firmar(claveRed, clienteId, expira)}`,
        expira: new Date(expira * 1000).toISOString(),
    };
}
/** 'ok', 'vencido' (firma buena pero pasó la fecha) o 'invalido' (cualquier otra cosa). */
function verificarEnlaceEstado(claveRed, clienteId, expira, firma, ahoraMs = Date.now()) {
    if (!claveRed || !/^[0-9a-f]{24}$/.test(clienteId) || !/^\d{1,12}$/.test(expira))
        return 'invalido';
    const esperada = Buffer.from(firmar(claveRed, clienteId, Number(expira)));
    const recibida = Buffer.from(String(firma));
    if (esperada.length !== recibida.length || !crypto_1.default.timingSafeEqual(esperada, recibida))
        return 'invalido';
    return Number(expira) * 1000 < ahoraMs ? 'vencido' : 'ok';
}
exports.nombreArchivoEstado = formato_1.nombreArchivoEstadoCuenta;
// ---------------------------------------------------------------------------
// El PDF
// ---------------------------------------------------------------------------
const MARGEN = 42;
const ZONA = 'America/Argentina/Buenos_Aires';
const MARCA = [0.16, 0.3, 0.74];
const TEXTO = [0.1, 0.12, 0.16];
const GRIS = [0.45, 0.5, 0.57];
const LINEA = [0.88, 0.9, 0.93];
const FONDO = [0.96, 0.97, 0.99];
const AMBAR = [0.71, 0.35, 0.04];
const VERDE = [0.02, 0.45, 0.31];
function fechaCorta(iso) {
    return new Date(iso).toLocaleDateString('es-AR', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function armarPdfEstado(estado) {
    const pdf = new pdfSimple_1.PdfSimple();
    const derecha = pdfSimple_1.ANCHO_PAGINA - MARGEN;
    const anchoDetalle = 300;
    const limite = pdfSimple_1.ALTO_PAGINA - 70; // más abajo va el pie de página
    // --- Encabezado ---
    pdf.rect(0, 0, pdfSimple_1.ANCHO_PAGINA, 92, MARCA);
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
    pdf.texto(MARGEN + 16, 220, debe || aFavor ? (0, formato_1.formatearMonedaConCentavos)(Math.abs(estado.saldo)) : 'No debe nada', {
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
    const seccion = (titulo, lineas, vacio, signo) => {
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
            pdf.texto(derecha - 8, y + 15, `${signo === '-' ? '-' : ''}${(0, formato_1.formatearMonedaConCentavos)(l.monto)}`, {
                tam: 10,
                negrita: true,
                alinear: 'der',
                color: signo === '-' ? VERDE : TEXTO,
            });
            y += alto;
            pdf.linea(MARGEN, y, derecha, y, LINEA, 0.6);
        }
        const suma = lineas.reduce((acc, l) => acc + l.monto, 0);
        pdf.texto(derecha - 8, y + 20, `${signo === '-' ? '-' : ''}${(0, formato_1.formatearMonedaConCentavos)(suma)}`, {
            tam: 11,
            negrita: true,
            alinear: 'der',
            color: signo === '-' ? VERDE : TEXTO,
        });
        pdf.texto(derecha - 8 - pdf.ancho((0, formato_1.formatearMonedaConCentavos)(suma), 11, true) - 14, y + 20, 'Suma', {
            tam: 9,
            color: GRIS,
            alinear: 'der',
        });
        y += 42;
    };
    seccion('Lo que quedó anotado y todavía no se pagó', estado.pendientes, 'No hay nada anotado sin pagar.', '+');
    if (estado.pagos.length > 0)
        seccion('Pagos que ya hizo', estado.pagos, '', '-');
    // --- Cierre ---
    if (y + 40 > limite) {
        pdf.nuevaPagina();
        y = 60;
    }
    pdf.linea(MARGEN, y, derecha, y, TEXTO, 1);
    pdf.texto(MARGEN, y + 24, debe ? 'TOTAL QUE DEBE' : aFavor ? 'SALDO A FAVOR' : 'TOTAL', { tam: 12, negrita: true });
    pdf.texto(derecha, y + 24, debe || aFavor ? (0, formato_1.formatearMonedaConCentavos)(Math.abs(estado.saldo)) : '$ 0,00', {
        tam: 16,
        negrita: true,
        color: colorTotal,
        alinear: 'der',
    });
    // --- Pie de cada página ---
    const total = pdf.cantidadDePaginas;
    for (let i = 0; i < total; i++) {
        pdf.linea(MARGEN, pdfSimple_1.ALTO_PAGINA - 46, derecha, pdfSimple_1.ALTO_PAGINA - 46, LINEA, 0.6, i);
        pdf.texto(MARGEN, pdfSimple_1.ALTO_PAGINA - 30, `Mis Amores · Estado de cuenta de ${estado.nombre}`, { tam: 8, color: GRIS }, i);
        pdf.texto(derecha, pdfSimple_1.ALTO_PAGINA - 30, `Página ${i + 1} de ${total}`, { tam: 8, color: GRIS, alinear: 'der' }, i);
    }
    return pdf.generar(`Estado de cuenta - ${estado.nombre}`);
}
