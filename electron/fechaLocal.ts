// Los "días" del negocio se cortan en horario de Argentina, no en UTC — si no,
// las ventas de la noche (después de las 21:00 hora local) quedan registradas
// como si hubieran pasado al día siguiente, y aparecen en el casillero
// equivocado del calendario y de los reportes. Offset fijo (no el nombre de
// la zona horaria) porque Argentina no tiene horario de verano desde 2009, y
// así no depende de que el proceso de Mongo tenga cargada la base de husos
// horarios.
const OFFSET_ARGENTINA = '-03:00';

function medianocheLocal(anio: number, mesIndiceCero: number, dia: number): Date {
  return new Date(anio, mesIndiceCero, dia);
}

// Límites [desde, hasta) de UN día calendario de Argentina, desplazado
// `offsetDias` hacia atrás desde `fecha` (0 = ese día, 1 = el anterior...).
export function limitesDiaLocal(offsetDias = 0, fecha: Date = new Date()): { desde: string; hasta: string } {
  const dia = fecha.getDate() - offsetDias;
  const desde = medianocheLocal(fecha.getFullYear(), fecha.getMonth(), dia);
  const hasta = medianocheLocal(fecha.getFullYear(), fecha.getMonth(), dia + 1);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

// Límites de los últimos `dias` días calendario de Argentina, hoy incluido
// (ej. dias=7 → desde hace 6 días hasta el final de hoy).
export function limitesUltimosDiasLocal(dias: number, fecha: Date = new Date()): { desde: string; hasta: string } {
  const hasta = medianocheLocal(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1);
  const desde = medianocheLocal(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() - dias + 1);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

// Límites de un mes calendario de Argentina (mesIndiceCero: 0 = enero).
export function limitesMesLocal(anio: number, mesIndiceCero: number): { desde: string; hasta: string } {
  return {
    desde: medianocheLocal(anio, mesIndiceCero, 1).toISOString(),
    hasta: medianocheLocal(anio, mesIndiceCero + 1, 1).toISOString(),
  };
}

// Límites del día calendario de Argentina "yyyy-MM-dd" (el que arma, por
// ejemplo, el calendario del frontend con date-fns — ya en hora local).
export function limitesDiaLocalYMD(ymd: string): { desde: string; hasta: string } {
  const [anio, mes, dia] = ymd.split('-').map(Number);
  return {
    desde: medianocheLocal(anio, mes - 1, dia).toISOString(),
    hasta: medianocheLocal(anio, mes - 1, dia + 1).toISOString(),
  };
}

// "yyyy-MM-dd" del día calendario de Argentina de `fecha`.
export function ymdLocal(fecha: Date = new Date()): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

// Expresión de Mongo para agrupar ventas por día calendario de Argentina (no
// UTC) a partir del campo `fecha`, guardado como ISO string.
export const DIA_LOCAL_EXPR = {
  $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$fecha' }, timezone: OFFSET_ARGENTINA },
};
