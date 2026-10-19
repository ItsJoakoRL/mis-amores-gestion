import type { PasoRecorrido } from './RecorridoAyuda';

// "Mostrame esta pantalla": una guía por pantalla que va señalando, una por una, sus partes
// y para qué sirven. Los `selector` apuntan a atributos data-tour puestos a mano en cada
// pantalla (y en Layout.tsx / AvisoActualizacion.tsx para "Buscar actualizaciones", que vive en
// el menú). Si algo no está en pantalla en ese momento (ej. un cuadro todavía cerrado), el paso
// se muestra igual en el centro y espera a que aparezca. Lo que se quiere HACER (cobrar, anotar
// un fiado...) está en guias.ts. Los textos van en palabras de todos los días a propósito.
export const RECORRIDOS: Record<string, PasoRecorrido[]> = {
  Panel: [
    {
      selector: '[data-tour="panel-resumen"]',
      titulo: 'El resumen del negocio',
      texto: 'Es lo primero que ves al entrar: cuántos productos tenés, cuántos tienen poco stock, cuántos se terminaron y cuánto vale todo lo que tenés.',
    },
    {
      selector: '[data-tour="panel-stock-bajo"]',
      titulo: 'Lo que se está por terminar',
      texto: 'Si algún producto tiene poco stock, te lo cuenta acá para que sepas qué hay que comprar.',
    },
    {
      selector: '[data-tour="panel-recordatorios"]',
      titulo: 'Recordatorios',
      texto: 'Lo que hay para hacer, comprar o cobrar, anotado entre todas. Tocá acá para ver la lista o anotar algo nuevo.',
    },
    {
      selector: '[data-tour="panel-ventas-hoy"]',
      titulo: 'Lo vendido hoy',
      texto: 'Tocá acá para ver lo que se vendió hoy. Si querés ver otro día, entrá al Calendario.',
    },
    {
      selector: '[data-tour="buscar-actualizaciones"]',
      titulo: 'Buscar actualizaciones',
      texto:
        'El programa se fija solo si hay una versión nueva. Cuando aparece, este botón se pone verde con un puntito rojo (y sale un cartel arriba): tocalo para bajarla y, cuando esté lista, para reiniciar e instalarla.',
    },
  ],
  'Artículos y stock': [
    {
      selector: '[data-tour="art-armar-cuenta"]',
      titulo: 'Acá se cobra: "Armar cuenta"',
      texto: 'Para vender, tocá este botón. Ahí armás lo que se lleva el cliente y lo cobrás. Si no sabés cómo, mirá la ayuda "Cobrar una venta".',
    },
    {
      selector: '[data-tour="art-nuevo"]',
      titulo: 'Nuevo artículo',
      texto: 'Con este botón cargás un producto nuevo: nombre, precio, cuántos hay y a qué rubro pertenece.',
    },
    {
      selector: '[data-tour="art-scan"]',
      titulo: 'Lector de código de barras',
      texto:
        'Si tenés lectora, pasale el paquete acá: si el producto ya está, te deja sumarle stock, y si es nuevo te deja cargarlo. En el celular podés usar el botón de la cámara.',
    },
    {
      selector: '[data-tour="art-buscar"]',
      titulo: 'Buscar un producto',
      texto: 'Escribí parte del nombre o el código y la lista se achica sola. No hace falta escribirlo exacto.',
    },
    {
      selector: '[data-tour="art-stock"], button[title="Ajustar stock"]',
      titulo: 'Cambiar cuántos hay',
      texto: 'Este botón cambia el stock de un producto (por ejemplo, cuando llega mercadería) sin tener que abrir toda la ficha.',
    },
    {
      selector: '[data-tour="art-stock-bajo-filtro"]',
      titulo: 'Los que se están por terminar',
      texto: 'Con este botón ves de una sólo los productos que tienen poco stock, que son los que hay que comprar.',
    },
    {
      selector: '[data-tour="art-contar"]',
      titulo: 'Contar inventario',
      texto:
        'Si lo que dice el programa no coincide con lo que hay de verdad, tocá acá: contás un rubro (escaneando o escribiendo) y el programa corrige el stock. Lo que vas contando queda guardado.',
    },
  ],
  'Armar cuenta': [
    {
      selector: 'input[placeholder^="Escaneá o buscá"]',
      titulo: 'Buscá o escaneá el producto',
      texto: 'Escribí parte del nombre y tocá el producto de la lista, o pasale la lectora (o la cámara del celular) por el código de barras.',
    },
    {
      selector: '[data-tour="cuenta-cantidad"]',
      titulo: 'Cuántos lleva',
      texto: 'Poné la cantidad (si es uno, dejá el 1) y tocá "Agregar".',
    },
    {
      selector: '[data-tour="cuenta-lista"]',
      titulo: 'Lo que lleva el cliente',
      texto:
        'Acá va quedando la cuenta. Cada producto dice cómo se paga (Efectivo, Tarjeta, Transferencia o Fiado) y lo podés cambiar en esa línea; si se lleva varias unidades y las paga distinto, tocá "Dividir". Para sacar algo que agregaste por error, tocá el tachito.',
    },
    {
      selector: '[data-tour="cuenta-pago"]',
      titulo: 'Cómo paga (todo junto)',
      texto:
        'Efectivo, Tarjeta o Transferencia para toda la cuenta de una vez. Si se lo lleva sin pagar ahora, elegí "Fiado": en cada línea fiada elegís el cliente (o tocás "Cliente nuevo") y queda anotado como deuda.',
    },
    {
      selector: '[data-tour="cuenta-cobrar"]',
      titulo: 'Cobrar',
      texto: 'Cuando el total esté bien, tocá "Cobrar". La venta queda anotada y se descuenta del stock.',
    },
  ],
  'Contar inventario': [
    {
      selector: '[data-tour="inv-rubros"]',
      titulo: 'Elegí qué vas a contar',
      texto:
        'Tocá un rubro (por ejemplo BEBIDAS) y contás sólo esos productos. Si hay uno que dice "Para revisar", empezá por ese: son productos que se vendieron cuando el programa decía que no había.',
    },
    {
      titulo: 'Después contás',
      texto: 'Al elegir un rubro aparece la lista de sus productos. Escaneás cada uno (suma 1) o escribís cuántos hay de verdad, y al final corregís el stock. Hasta ese momento no se cambia nada.',
    },
  ],
  'Contar inventario (contando)': [
    {
      selector: 'input[placeholder^="Escaneá un producto"]',
      titulo: 'Escaneá lo que contás',
      texto: 'Cada vez que pasás un producto por la lectora (o la cámara del celular), suma 1 a lo contado.',
    },
    {
      selector: '[id^="contado-"]',
      titulo: 'O escribí la cantidad',
      texto: 'En la casilla "Contado" de cada producto podés escribir cuántos hay de verdad. Se guarda solo: podés dejar y seguir otro día.',
    },
    {
      selector: '[data-tour="inv-corregir"]',
      titulo: 'Corregir el stock',
      texto: 'Cuando termines, tocá este botón: el programa cambia el stock de cada producto por lo que contaste. Antes de tocarlo no se cambia nada.',
    },
  ],
  'Precios y costos': [
    {
      selector: '[data-tour="precios-pestanas"]',
      titulo: 'Dos herramientas en una',
      texto:
        '"Cambiar precios" sube o baja los precios de muchos productos juntos. "Cargar costos" es una planilla para escribir cuánto te cuesta cada producto y ver cuánto ganás.',
    },
    {
      selector: '[data-tour="precios-productos"]',
      titulo: 'Primero elegís a cuáles',
      texto: 'Un rubro entero (por ejemplo GOLOSINAS), o los que tengan una palabra en el nombre.',
    },
    {
      selector: '[data-tour="precios-vista"]',
      titulo: 'Antes de cambiar, ves cómo queda',
      texto: 'Abajo ves el precio de antes y el de después de cada producto. Podés destildar los que no querés tocar. Recién cuando apretás el botón de abajo se cambia.',
    },
    {
      selector: '[data-tour="precios-aplicar"]',
      titulo: 'Si te equivocás, se deshace',
      texto: 'Cada cambio queda en "Cambios anteriores", con un botón para deshacerlo: los precios vuelven a como estaban.',
    },
  ],
  Calendario: [
    {
      selector: '[data-tour="cal-resumen-hoy"]',
      titulo: 'Resumen de hoy',
      texto: 'Acá arriba ves lo vendido hoy, sin tener que entrar al día.',
    },
    {
      selector: '[data-tour="cal-grid"]',
      titulo: 'El calendario',
      texto: 'Cada venta queda anotada en el día en que la hiciste. Los días con ventas muestran cuánto se vendió.',
    },
    {
      selector: '[data-tour="cal-hoy"]',
      titulo: 'Ver un día',
      texto: 'Tocá un día para ver todas las ventas, una por una. Si cargaste alguna por error, desde ahí la podés anular.',
    },
  ],
  Reportes: [
    {
      selector: '[data-tour="rep-presets"]',
      titulo: 'Elegí qué días mirar',
      texto: 'Hoy, los últimos días o todo el mes. Los números de abajo cambian según lo que elijas.',
    },
    {
      selector: '[data-tour="rep-stats"]',
      titulo: 'El resumen',
      texto: 'Cuánto cobraste (incluye lo que los clientes pagaron de su cuenta), cuánto quedó fiado, cuántas ventas hiciste y el promedio de cada una.',
    },
    {
      selector: '[data-tour="rep-grafico-dia"]',
      titulo: 'Ventas por día',
      texto: 'Este gráfico muestra cómo viene vendiendo el negocio, día por día.',
    },
  ],
  'Clientes (fiado)': [
    {
      selector: '[data-tour="cli-buscar"]',
      titulo: 'Buscar un cliente',
      texto:
        'Buscá por nombre o teléfono. Tildá "Solo con deuda" o elegí "+30 / +60 / +90 días" para ver enseguida a quién le tenés que cobrar hace rato.',
    },
    {
      selector: '[data-tour="cli-nuevo"]',
      titulo: 'Nuevo cliente',
      texto: 'Cargá acá a alguien que empieza a comprar fiado.',
    },
    {
      selector: '[data-tour="cli-tabla"]',
      titulo: 'La cuenta de cada cliente',
      texto:
        'Tocá un cliente para ver su cuenta completa. Ahí le registrás un pago cuando te paga, le anotás una deuda (por ejemplo, la del cuaderno, con los productos) o editás su teléfono. Cada deuda dice si está pagada, en parte o pendiente.',
    },
    {
      selector: '[data-tour="cli-ultimos-fiados"]',
      titulo: 'Últimos fiados',
      texto: 'Acá ves los últimos fiados de todos los clientes juntos, sin entrar uno por uno. Dice cuánto falta pagar de cada uno.',
    },
    {
      selector: '[data-tour="cli-estado"]',
      titulo: 'Mandarle lo que debe',
      texto:
        'Este botón de cada cliente muestra un código QR: lo escaneás con el celular y se baja un PDF con los productos que debe y lo que ya pagó, listo para mandárselo. También podés bajar el PDF directo desde ahí.',
    },
  ],
  Recordatorios: [
    {
      selector: '[data-tour="rec-nuevo"]',
      titulo: 'Anotar algo',
      texto: 'Escribí lo que hay que hacer o cambiar, elegí de qué se trata y, si corre apuro, poné un día o marcalo como urgente. Lo ven todas.',
    },
    {
      selector: '[data-tour="rec-lista"]',
      titulo: 'Pendientes y hechos',
      texto: 'Cuando alguien lo hace, toca el circulito para marcarlo como hecho: queda anotado quién lo hizo. En el menú de la izquierda se ve cuántos quedan pendientes.',
    },
  ],
  Configuración: [
    {
      selector: '[data-tour="conf-modo"]',
      titulo: 'Todas las computadoras son iguales',
      texto: 'Cada computadora guarda todos los datos y trabaja sola. Lo que se carga en una aparece en las demás al instante.',
    },
    {
      selector: '[data-tour="conf-pcs"]',
      titulo: 'Las otras computadoras',
      texto: 'Acá ves cuáles están prendidas y si están al día. Si una estaba apagada, se pone al día sola cuando vuelve.',
    },
    {
      selector: '[data-tour="conf-conectar"]',
      titulo: 'Sumar otra computadora',
      texto: 'Para que otra computadora comparta los datos del negocio, sumala desde acá con la cuenta de administradora.',
    },
  ],
  Usuarios: [
    {
      selector: '[data-tour="usr-nuevo"]',
      titulo: 'Nuevo usuario',
      texto: 'Creá acá una cuenta para cada empleada, con su usuario y su clave.',
    },
    {
      selector: '[data-tour="usr-lista"]',
      titulo: 'Cambiar datos o claves',
      texto:
        'Desde acá les cambiás la clave, editás sus datos o las das de baja. Las empleadas pueden vender y cargar productos, pero no ven el costo ni pueden borrar cosas.',
    },
  ],
};
