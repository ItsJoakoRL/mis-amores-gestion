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
      selector: '[data-tour="panel-recordatorios"]',
      titulo: 'Recordatorios',
      texto: 'Lo que hay para hacer o cambiar, anotado entre todas. Tocá acá para ver la lista completa o anotar algo.',
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
      texto: 'Si tenés lector, escaneá acá directo: si el producto ya existe te lleva a sumarle stock, y si es nuevo te deja crearlo. En el celular también podés usar el botón de la cámara.',
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
    {
      selector: '[data-tour="art-contar"]',
      titulo: 'Contar inventario',
      texto:
        'Si el stock cargado no coincide con lo que hay de verdad, elegí un rubro, contá (escaneando o escribiendo) y el sistema corrige el stock a lo que contaste. Lo que vas contando queda guardado. Si vendés algo que figura sin stock, igual se vende y queda en "Para revisar" hasta que lo cuentes.',
    },
  ],
  'Precios y costos': [
    {
      selector: '[data-tour="precios-pestanas"]',
      titulo: 'Dos herramientas en una',
      texto:
        '"Cambiar precios" sube o baja los precios de muchos productos juntos (por rubro, por porcentaje o por pesos, con redondeo). "Cargar costos" es una planilla para completar lo que te cuesta cada producto y ver cuánto ganás.',
    },
    {
      selector: '[data-tour="precios-pestanas"]',
      titulo: 'Primero ves cómo queda',
      texto:
        'En "Cambiar precios" elegís a cuáles, cuánto y a cuánto redondear, y abajo ves el precio de antes y el de después de cada producto (podés destildar los que no querés tocar). Recién cuando apretás el botón de abajo se cambia.',
    },
    {
      selector: '[data-tour="precios-pestanas"]',
      titulo: 'Si te equivocás, se deshace',
      texto:
        'Cada cambio queda en "Cambios anteriores" con un botón "Deshacer": los precios vuelven a como estaban (menos los que ya cambiaste a mano después).',
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
      texto: 'Cuánto cobraste (incluye lo que los clientes pagaron de su cuenta), cuánto quedó fiado, cuántas ventas hiciste y el ticket promedio.',
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
      texto: 'Buscá por nombre o teléfono, tildá "Solo con deuda" o elegí "+30 / +60 / +90 días" para ver de una a quién le tenés que cobrar hace rato. La lista también se puede ordenar por la deuda más vieja.',
    },
    {
      selector: '[data-tour="cli-nuevo"]',
      titulo: 'Nuevo cliente',
      texto: 'Cargá acá a alguien nuevo que te empieza a comprar fiado.',
    },
    {
      selector: '[data-tour="cli-tabla"]',
      titulo: 'La cuenta de cada cliente',
      texto: 'Tocá un cliente de la lista para ver su cuenta completa, registrarle un pago cuando te paga, anotarle una deuda a mano (por ejemplo, la del cuaderno) o editar sus datos y su teléfono.',
    },
    {
      selector: '[data-tour="cli-ultimos-fiados"]',
      titulo: 'Últimos fiados',
      texto: 'Acá ves los últimos fiados de todos los clientes juntos, sin entrar uno por uno.',
    },
    {
      selector: '[data-tour="cli-estado"]',
      titulo: 'Estado de cuenta con código QR',
      texto:
        'Con este botón de cada cliente aparece un código QR: lo escaneás con el celular y baja un PDF con lo que debe, listo para compartirlo y mandárselo. También podés bajar el PDF directo desde ahí.',
    },
  ],
  Recordatorios: [
    {
      selector: '[data-tour="rec-nuevo"]',
      titulo: 'Anotar algo',
      texto:
        'Escribí lo que hay que hacer o cambiar, elegí para qué es y, si corre apuro, ponele un día o marcalo como urgente. Lo ven todas, en las PCs y en los celulares.',
    },
    {
      selector: '[data-tour="rec-lista"]',
      titulo: 'Pendientes y hechos',
      texto:
        'Cuando alguien lo hace, toca el círculo para marcarlo como hecho: queda anotado quién lo hizo. En el menú de la izquierda aparece cuántos quedan pendientes.',
    },
  ],
  Configuración: [
    {
      selector: '[data-tour="conf-modo"]',
      titulo: 'Todas las PCs son iguales',
      texto: 'Cada PC guarda todos los datos y trabaja sola. Lo que se carga en una aparece en las demás al instante.',
    },
    {
      selector: '[data-tour="conf-pcs"]',
      titulo: 'Las otras PCs',
      texto: 'Acá ves cuáles están en línea y si están al día. Si una estaba apagada, se pone al día sola cuando vuelve.',
    },
    {
      selector: '[data-tour="conf-conectar"]',
      titulo: 'Sumar otra PC',
      texto: 'Para que otra PC comparta los datos del negocio, sumala desde acá con la cuenta de administradora.',
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
