import type { PasoRecorrido } from './RecorridoAyuda';

// El contenido de cada recorrido guiado, uno por sección del menú. Los
// `selector` apuntan a atributos data-tour puestos a mano en cada pantalla
// (y en Layout.tsx para "Buscar actualizaciones", que vive en el menú
// lateral). Si un selector no aparece en pantalla en ese momento (ej. un
// gráfico sin datos todavía), RecorridoAyuda lo muestra igual pero centrado.
export const RECORRIDOS: Record<string, PasoRecorrido[]> = {
  Panel: [
    {
      selector: '[data-tour="panel-resumen"]',
      titulo: 'Resumen del negocio',
      texto: 'Es lo primero que ves al entrar: artículos activos, con poco stock, sin stock y el valor del inventario.',
    },
    {
      selector: '[data-tour="panel-stock-bajo"]',
      titulo: 'Stock bajo',
      texto: 'Si algún producto se está por terminar, te lo marca acá para que sepas qué reponer.',
    },
    {
      selector: '[data-tour="panel-ventas-hoy"]',
      titulo: 'Ventas de hoy',
      texto: 'Tocá acá para ver el detalle de lo que se vendió hoy, o entrá al Calendario para ver otros días.',
    },
    {
      selector: '[data-tour="buscar-actualizaciones"]',
      titulo: 'Buscar actualizaciones',
      texto:
        'La app se fija sola si hay una versión nueva. Cuando aparece, este botón se pone verde con un puntito rojo (y sale un cartel arriba): tocalo para bajarla y, cuando esté lista, para reiniciar e instalarla.',
    },
  ],
  'Artículos y stock': [
    {
      selector: '[data-tour="art-nuevo"]',
      titulo: 'Nuevo artículo',
      texto: 'Con este botón cargás un producto nuevo: nombre, precio, stock y rubro.',
    },
    {
      selector: '[data-tour="art-scan"]',
      titulo: 'Lector de código de barras',
      texto: 'Si tenés lector, escaneá acá directo: si el producto ya existe te lleva a sumarle stock, y si es nuevo te deja crearlo.',
    },
    {
      selector: '[data-tour="art-stock"]',
      titulo: 'Ajustar stock',
      texto: 'Este botón ajusta el stock de un producto sin tener que abrir toda la ficha.',
    },
    {
      selector: '[data-tour="art-stock-bajo-filtro"]',
      titulo: 'Filtrar por stock bajo',
      texto: 'Con este filtro ves de una sólo los productos que se están por terminar.',
    },
  ],
  Calendario: [
    {
      selector: '[data-tour="cal-resumen-hoy"]',
      titulo: 'Resumen de hoy',
      texto: 'Acá arriba ves un resumen de lo vendido hoy, sin tener que entrar al día.',
    },
    {
      selector: '[data-tour="cal-grid"]',
      titulo: 'El calendario',
      texto: 'Cada venta que cargás queda anotada en el día en que la hiciste.',
    },
    {
      selector: '[data-tour="cal-hoy"]',
      titulo: 'Ver un día',
      texto: 'Tocá un día para ver el detalle de las ventas, o anular alguna si la cargaste por error.',
    },
  ],
  Reportes: [
    {
      selector: '[data-tour="rep-presets"]',
      titulo: 'Elegir el período',
      texto: 'Elegí el rango de fechas que querés mirar: hoy, los últimos días o este mes.',
    },
    {
      selector: '[data-tour="rep-stats"]',
      titulo: 'Resumen del período',
      texto: 'Cuánto cobraste, cuánto quedó fiado, cuántas ventas hiciste y el ticket promedio.',
    },
    {
      selector: '[data-tour="rep-grafico-dia"]',
      titulo: 'Ventas por día',
      texto: 'Este gráfico muestra cómo vino vendiendo el negocio día por día en el período elegido.',
    },
  ],
  'Clientes (fiado)': [
    {
      selector: '[data-tour="cli-buscar"]',
      titulo: 'Buscar cliente',
      texto: 'Buscá por nombre o tildá "Solo con deuda" para ver de una a quién le tenés que cobrar.',
    },
    {
      selector: '[data-tour="cli-nuevo"]',
      titulo: 'Nuevo cliente',
      texto: 'Cargá acá a alguien nuevo que te empieza a comprar fiado.',
    },
    {
      selector: '[data-tour="cli-tabla"]',
      titulo: 'La cuenta de cada cliente',
      texto: 'Tocá un cliente de la lista para ver su cuenta completa y registrarle un pago cuando te paga.',
    },
    {
      selector: '[data-tour="cli-ultimos-fiados"]',
      titulo: 'Últimos fiados',
      texto: 'Acá ves los últimos fiados de todos los clientes juntos, sin entrar uno por uno.',
    },
  ],
  Configuración: [
    {
      selector: '[data-tour="conf-modo"]',
      titulo: 'El rol de esta PC',
      texto: 'Acá ves si esta PC es la principal (la que guarda todos los datos) o si está conectada a la principal.',
    },
    {
      selector: '[data-tour="conf-conectar"]',
      titulo: 'Conectar a la principal',
      texto: 'Si esta PC no va a ser la principal, conectala a la que sí: sus datos se pasan a la principal y desde ahí trabajan las dos con lo mismo.',
    },
  ],
  Usuarios: [
    {
      selector: '[data-tour="usr-nuevo"]',
      titulo: 'Nuevo usuario',
      texto: 'Creá acá una cuenta para cada empleada, con su usuario y contraseña.',
    },
    {
      selector: '[data-tour="usr-lista"]',
      titulo: 'Editar usuarios',
      texto: 'Desde acá les cambiás la contraseña, editás sus datos o las das de baja. Las empleadas pueden cargar artículos y ventas, pero no ven el precio de costo ni pueden borrar cosas.',
    },
  ],
};
