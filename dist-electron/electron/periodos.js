"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enMinuscula = void 0;
exports.periodoDeUnDia = periodoDeUnDia;
exports.leerPeriodos = leerPeriodos;
exports.leerPeriodo = leerPeriodo;
exports.periodoAnterior = periodoAnterior;
// "Cuándo": los períodos de tiempo que se entienden en una pregunta del asistente simple.
//   hoy, ayer, anteayer · esta semana (desde el lunes), la semana pasada · este mes, el mes pasado, septiembre ·
//   este año, el año pasado · los últimos 15 días, la última semana · el lunes, el 15/10, el 3 de septiembre
// Todo en la hora del negocio (la de este equipo, ver fechaLocal.ts). Son funciones puras: se prueban sin base de datos.
const fechaLocal_1 = require("./fechaLocal");
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const DIAS_CON_TILDE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const NUMEROS = {
    un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30,
};
const medianoche = (anio, mes, dia) => new Date(anio, mes, dia);
const inicioDelDia = (f) => medianoche(f.getFullYear(), f.getMonth(), f.getDate());
const sumarDias = (f, n) => medianoche(f.getFullYear(), f.getMonth(), f.getDate() + n);
const diasEntre = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
// Argentina: la semana empieza el lunes.
const lunesDe = (f) => sumarDias(inicioDelDia(f), -((f.getDay() + 6) % 7));
const fechaCorta = (f, ahora) => `${f.getDate()}/${f.getMonth() + 1}${f.getFullYear() === ahora.getFullYear() ? '' : `/${f.getFullYear()}`}`;
function armar(tipo, desde, hasta, etiqueta, texto, ahora, unDia = false) {
    return {
        tipo,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        etiqueta,
        dias: Math.max(1, diasEntre(desde, hasta)),
        texto,
        unDia: unDia ? (0, fechaLocal_1.ymdLocal)(desde) : null,
        enCurso: hasta.getTime() > inicioDelDia(ahora).getTime(),
    };
}
/** Un día puntual con su nombre natural: "Hoy", "Ayer", "Anteayer" o "El lunes 12/10". Con `porNombre` (la persona pidió "el
 * lunes" o "el 15/10") se dice siempre por su nombre, aunque justo sea ayer: así se entiende de qué día se habla. */
function periodoDeUnDia(dia, ahora = new Date(), texto = '', porNombre = false) {
    const d = inicioDelDia(dia);
    const hace = diasEntre(d, inicioDelDia(ahora));
    const etiqueta = !porNombre && hace === 0 ? 'Hoy' : !porNombre && hace === 1 ? 'Ayer' : !porNombre && hace === 2 ? 'Anteayer' : `El ${DIAS_CON_TILDE[d.getDay()]} ${fechaCorta(d, ahora)}`;
    return armar('dia', d, sumarDias(d, 1), etiqueta, texto, ahora, true);
}
// Una fecha de verdad (que el día exista).
function fechaValida(anio, mes, dia) {
    const f = medianoche(anio, mes, dia);
    return f.getFullYear() === anio && f.getMonth() === mes && f.getDate() === dia ? f : null;
}
const NOMBRE_MES = MESES.join('|');
const PREPOSICION = '(?:(?:en|de|del|durante|desde|para)\\s+)?';
// El orden importa: lo más específico primero ("la semana pasada" antes que "la semana"; las fechas antes que los meses).
const REGLAS = [
    {
        // los últimos 15 días, las últimas 2 semanas, el último mes, la última semana
        re: new RegExp(`\\b${PREPOSICION}(?:los\\s+|las\\s+|el\\s+|la\\s+)?ultim[oa]s?\\s+(?:(\\d{1,3}|${Object.keys(NUMEROS).join('|')})\\s+)?(dias?|semanas?|mes(?:es)?)\\b`),
        armar: (m, ahora) => {
            const cantidad = m[1] === undefined ? 1 : /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1]];
            const unidad = m[2].startsWith('dia') ? 1 : m[2].startsWith('semana') ? 7 : 30;
            const dias = cantidad * unidad;
            if (dias < 1 || dias > 366)
                return null;
            const hoy = inicioDelDia(ahora);
            return armar('ultimos', sumarDias(hoy, -(dias - 1)), sumarDias(hoy, 1), `En los últimos ${dias} días`, m[0], ahora);
        },
    },
    { re: /\b(?:anteayer|antes de ayer|antier)\b/, armar: (m, ahora) => periodoDeUnDia(sumarDias(inicioDelDia(ahora), -2), ahora, m[0]) },
    { re: /\bayer\b/, armar: (m, ahora) => periodoDeUnDia(sumarDias(inicioDelDia(ahora), -1), ahora, m[0]) },
    { re: /\bhoy\b/, armar: (m, ahora) => periodoDeUnDia(inicioDelDia(ahora), ahora, m[0]) },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:la\\s+)?semana\\s+(?:pasada|anterior)\\b`),
        armar: (m, ahora) => {
            const lunes = sumarDias(lunesDe(ahora), -7);
            return armar('semana-pasada', lunes, sumarDias(lunes, 7), 'La semana pasada', m[0], ahora);
        },
    },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:el\\s+)?mes\\s+(?:pasado|anterior)\\b`),
        armar: (m, ahora) => {
            const desde = medianoche(ahora.getFullYear(), ahora.getMonth() - 1, 1);
            return armar('mes-pasado', desde, medianoche(ahora.getFullYear(), ahora.getMonth(), 1), `El mes pasado (${MESES[desde.getMonth()]})`, m[0], ahora);
        },
    },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:el\\s+)?ano\\s+(?:pasado|anterior)\\b`),
        armar: (m, ahora) => armar('anio-pasado', medianoche(ahora.getFullYear() - 1, 0, 1), medianoche(ahora.getFullYear(), 0, 1), 'El año pasado', m[0], ahora),
    },
    {
        // el 3 de septiembre, 15 de octubre de 2025
        re: new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${NOMBRE_MES}|setiembre)(?:\\s+de\\s+(\\d{4}))?\\b`),
        armar: (m, ahora) => {
            const mes = m[2] === 'setiembre' ? 8 : MESES.indexOf(m[2]);
            let anio = m[3] ? Number(m[3]) : ahora.getFullYear();
            let f = fechaValida(anio, mes, Number(m[1]));
            if (f && !m[3] && f.getTime() > inicioDelDia(ahora).getTime())
                f = fechaValida(--anio, mes, Number(m[1])); // todavía no pasó: es del año pasado
            return f && f.getTime() <= inicioDelDia(ahora).getTime() ? periodoDeUnDia(f, ahora, m[0], true) : null;
        },
    },
    {
        // 15/10, 15-10-2025
        re: /\b(?:el\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/,
        armar: (m, ahora) => {
            let anio = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ahora.getFullYear();
            let f = fechaValida(anio, Number(m[2]) - 1, Number(m[1]));
            if (f && !m[3] && f.getTime() > inicioDelDia(ahora).getTime())
                f = fechaValida(--anio, Number(m[2]) - 1, Number(m[1]));
            return f && f.getTime() <= inicioDelDia(ahora).getTime() ? periodoDeUnDia(f, ahora, m[0], true) : null;
        },
    },
    {
        // el lunes, el martes pasado: el último que ya pasó (si hoy es lunes, "el lunes" es el de la semana pasada)
        re: new RegExp(`\\b(?:el\\s+)?(${DIAS.join('|')})(?:\\s+pasado)?\\b`),
        armar: (m, ahora) => {
            const hoy = inicioDelDia(ahora);
            const hace = ((hoy.getDay() - DIAS.indexOf(m[1]) + 6) % 7) + 1; // de 1 a 7
            return periodoDeUnDia(sumarDias(hoy, -hace), ahora, m[0], true);
        },
    },
    {
        // en septiembre: el último septiembre que ya empezó
        re: new RegExp(`\\b${PREPOSICION}(?:el\\s+mes\\s+de\\s+)?(${NOMBRE_MES}|setiembre)\\b`),
        armar: (m, ahora) => {
            const mes = m[1] === 'setiembre' ? 8 : MESES.indexOf(m[1]);
            const anio = mes > ahora.getMonth() ? ahora.getFullYear() - 1 : ahora.getFullYear();
            const desde = medianoche(anio, mes, 1);
            const hasta = medianoche(anio, mes + 1, 1);
            const enCurso = mes === ahora.getMonth() && anio === ahora.getFullYear();
            return armar('mes-nombre', desde, enCurso ? sumarDias(inicioDelDia(ahora), 1) : hasta, `En ${MESES[mes]}${anio === ahora.getFullYear() ? '' : ` de ${anio}`}`, m[0], ahora);
        },
    },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:esta\\s+|la\\s+)?semana\\b`),
        armar: (m, ahora) => armar('semana', lunesDe(ahora), sumarDias(inicioDelDia(ahora), 1), 'En lo que va de la semana', m[0], ahora),
    },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:este\\s+|el\\s+)?mes\\b`),
        armar: (m, ahora) => armar('mes', medianoche(ahora.getFullYear(), ahora.getMonth(), 1), sumarDias(inicioDelDia(ahora), 1), 'En lo que va del mes', m[0], ahora),
    },
    {
        re: new RegExp(`\\b${PREPOSICION}(?:este\\s+|el\\s+)?ano\\b`),
        armar: (m, ahora) => armar('anio', medianoche(ahora.getFullYear(), 0, 1), sumarDias(inicioDelDia(ahora), 1), 'En lo que va del año', m[0], ahora),
    },
    {
        // "el 15": ese día del mes (de este mes, o del anterior si todavía no llegó)
        re: /\bel\s+(\d{1,2})\b(?![/\-.,]\d|\s*%|\s+de\s)/,
        armar: (m, ahora) => {
            const dia = Number(m[1]);
            const hoy = inicioDelDia(ahora);
            const f = fechaValida(hoy.getFullYear(), hoy.getMonth(), dia);
            const elegido = f && f.getTime() <= hoy.getTime() ? f : fechaValida(hoy.getFullYear(), hoy.getMonth() - 1, dia);
            return elegido ? periodoDeUnDia(elegido, ahora, m[0], true) : null;
        },
    },
];
/** Todos los períodos que nombra la pregunta (ya normalizada, ver lenguaje.ts), en el orden en que aparecen. */
function leerPeriodos(preguntaCanonica, ahora = new Date()) {
    let resto = preguntaCanonica;
    const hallados = [];
    for (const regla of REGLAS) {
        for (;;) {
            const m = resto.match(regla.re);
            if (!m || m.index === undefined)
                break;
            const posicion = m.index;
            const largo = m[0].length;
            // Se tapa lo ya leído para que otra regla no lo lea de nuevo ("la semana pasada" no es también "la semana").
            resto = resto.slice(0, posicion) + ' '.repeat(largo) + resto.slice(posicion + largo);
            const periodo = regla.armar(m, ahora);
            if (periodo)
                hallados.push({ posicion, periodo: { ...periodo, texto: m[0].trim() } });
        }
    }
    return hallados.sort((a, b) => a.posicion - b.posicion).map((h) => h.periodo);
}
function leerPeriodo(preguntaCanonica, ahora = new Date()) {
    return leerPeriodos(preguntaCanonica, ahora)[0] ?? null;
}
/** El período "equivalente" anterior, para comparar: ayer contra anteayer, esta semana contra la pasada (hasta el mismo día), etc. */
function periodoAnterior(p, ahora = new Date()) {
    const desde = new Date(p.desde);
    switch (p.tipo) {
        case 'dia':
            return periodoDeUnDia(sumarDias(desde, -1), ahora);
        case 'semana': {
            const lunes = sumarDias(desde, -7);
            const etiqueta = p.enCurso && p.dias < 7 ? 'La semana pasada (hasta el mismo día)' : 'La semana pasada';
            return armar('semana-pasada', lunes, sumarDias(lunes, p.dias), etiqueta, '', ahora);
        }
        case 'semana-pasada': {
            const lunes = sumarDias(desde, -7);
            return armar('semana-pasada', lunes, sumarDias(lunes, 7), 'La semana anterior', '', ahora);
        }
        case 'mes':
        case 'mes-nombre': {
            const inicio = medianoche(desde.getFullYear(), desde.getMonth() - 1, 1);
            const finMes = medianoche(desde.getFullYear(), desde.getMonth(), 1);
            if (p.enCurso) {
                const hasta = new Date(Math.min(sumarDias(inicio, p.dias).getTime(), finMes.getTime()));
                return armar('mes-pasado', inicio, hasta, `El mes pasado (${MESES[inicio.getMonth()]}, hasta el día ${diasEntre(inicio, hasta)})`, '', ahora);
            }
            return armar('mes-pasado', inicio, finMes, `El mes anterior (${MESES[inicio.getMonth()]})`, '', ahora);
        }
        case 'mes-pasado': {
            const inicio = medianoche(desde.getFullYear(), desde.getMonth() - 1, 1);
            return armar('mes-pasado', inicio, desde, `El mes anterior (${MESES[inicio.getMonth()]})`, '', ahora);
        }
        case 'anio':
            return armar('anio-pasado', medianoche(desde.getFullYear() - 1, 0, 1), sumarDias(medianoche(desde.getFullYear() - 1, 0, 1), p.dias), 'El año pasado (hasta la misma fecha)', '', ahora);
        case 'anio-pasado':
            return armar('anio-pasado', medianoche(desde.getFullYear() - 1, 0, 1), desde, 'El año anterior', '', ahora);
        case 'ultimos':
            return armar('ultimos', sumarDias(desde, -p.dias), desde, `Los ${p.dias} días anteriores`, '', ahora);
    }
}
/** Cómo decirlo en medio de una frase: "La semana pasada" → "la semana pasada". */
const enMinuscula = (etiqueta) => etiqueta.charAt(0).toLowerCase() + etiqueta.slice(1);
exports.enMinuscula = enMinuscula;
