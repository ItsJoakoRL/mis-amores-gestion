import type { PasoRecorrido } from './RecorridoAyuda';

// Las guías de la ayuda: una por cosa que se quiere HACER (no por botón). Están escritas con
// las palabras de todos los días, en pasos cortos, y cada una se puede ver como lista o como
// recorrido en la pantalla real ("Mostrame"): la guía lleva a la pantalla correcta, señala lo
// que hay que tocar y, cuando se lo pide, espera a que la persona lo toque.

export type GrupoGuia =
  | 'Vender y cobrar'
  | 'Productos y stock'
  | 'Clientes y fiados'
  | 'Precios'
  | 'Controlar el negocio'
  | 'Otras cosas';

export const GRUPOS_GUIAS: GrupoGuia[] = [
  'Vender y cobrar',
  'Productos y stock',
  'Clientes y fiados',
  'Precios',
  'Controlar el negocio',
  'Otras cosas',
];

export interface Guia {
  id: string;
  grupo: GrupoGuia;
  /** Lo que se quiere hacer, dicho como lo diría cualquiera. */
  titulo: string;
  resumen: string;
  /** Otras formas de nombrarlo, para que el buscador la encuentre ("vender", "caja"...). */
  palabras: string;
  /** Pantallas donde conviene mostrarla primero (los nombres de RECORRIDOS). */
  secciones: string[];
  soloAdmin?: boolean;
  /** Se usa en el celular (en la PC no se ve lo que se señala). */
  paraCelular?: boolean;
  pasos: PasoRecorrido[];
}

const ARMAR_CUENTA: PasoRecorrido = {
  ruta: '/articulos',
  selector: '[data-tour="art-armar-cuenta"]',
  tocar: true,
  titulo: 'Entrá a "Armar cuenta"',
  texto: 'Las ventas se hacen desde "Artículos y stock". Tocá el botón "Armar cuenta": ahí se arma lo que se lleva el cliente.',
};

const BUSCAR_PRODUCTO_EN_CUENTA: PasoRecorrido = {
  selector: 'input[placeholder^="Escaneá o buscá"]',
  titulo: 'Buscá el producto',
  texto:
    'Escribí un pedacito del nombre (por ejemplo "coca") y tocá el producto en la lista que aparece. Si tenés lectora de códigos, pasale el paquete y se agrega solo.',
};

const CANTIDAD_Y_AGREGAR: PasoRecorrido = {
  selector: '[data-tour="cuenta-cantidad"]',
  titulo: 'Cuántos se lleva',
  texto:
    'Si se lleva uno, dejá el 1. Si se lleva tres, escribí 3. Después tocá "Agregar". Si se lleva varios productos distintos, repetí estos dos pasos con cada uno.',
};

export const GUIAS: Guia[] = [
  // ------------------------------------------------------------------ Vender y cobrar
  {
    id: 'cobrar-venta',
    grupo: 'Vender y cobrar',
    titulo: 'Cobrar una venta',
    resumen: 'Armar lo que se lleva el cliente y cobrarlo (efectivo, tarjeta o transferencia; cada cosa puede pagarse distinto).',
    palabras: 'vender venta cobrar caja cuenta ticket mostrador efectivo tarjeta transferencia plata cliente se lleva',
    secciones: ['Artículos y stock', 'Armar cuenta', 'Panel'],
    pasos: [
      ARMAR_CUENTA,
      BUSCAR_PRODUCTO_EN_CUENTA,
      CANTIDAD_Y_AGREGAR,
      {
        selector: '[data-tour="cuenta-lista"]',
        titulo: 'Lo que lleva el cliente',
        texto: 'Acá va quedando la cuenta, con el precio de cada cosa. Si te equivocás con algo, tocá el tachito de esa línea para sacarlo.',
      },
      {
        selector: '[data-tour="cuenta-opciones-linea"]',
        titulo: '¿Cómo paga cada cosa?',
        texto:
          'Cada producto dice cómo se paga: Efectivo, Tarjeta, Transferencia o Fiado. Si una parte va por transferencia y otra en efectivo, cambialo en esa línea. Si se lleva varias unidades y las paga distinto (2 en efectivo y 1 por transferencia), tocá "Dividir".',
      },
      {
        selector: '[data-tour="cuenta-pago"]',
        titulo: 'O todo junto',
        texto:
          'Si todo se paga igual, elegí acá la forma de pago de toda la cuenta de una vez. Si dice "Varias formas de pago" es porque en algún producto elegiste una distinta. (Si no paga ahora sino después, mirá la ayuda "Anotarle un fiado a un cliente".)',
      },
      {
        selector: '[data-tour="cuenta-cobrar"]',
        tocar: true,
        titulo: 'Cobrar',
        texto: 'Mirá que el total esté bien y tocá "Cobrar". Listo: la venta queda anotada y se descuenta del stock. Después la podés ver en el Calendario.',
      },
    ],
  },
  {
    id: 'vender-fiado',
    grupo: 'Vender y cobrar',
    titulo: 'Anotarle un fiado a un cliente',
    resumen: 'El cliente se lleva la mercadería y paga después: queda anotado a su nombre (todo o sólo una parte de la cuenta).',
    palabras: 'fiado fiar deuda debe cuenta corriente cuaderno anotar pagar despues se lleva sin pagar',
    secciones: ['Artículos y stock', 'Armar cuenta', 'Clientes (fiado)'],
    pasos: [
      ARMAR_CUENTA,
      { ...BUSCAR_PRODUCTO_EN_CUENTA, titulo: 'Agregá lo que se lleva', texto: 'Igual que en una venta común: buscá cada producto, poné cuántos son y tocá "Agregar".' },
      {
        selector: '[data-tour="cuenta-pago"]',
        titulo: 'Elegí "Fiado"',
        texto:
          'En "Forma de pago" elegí "Fiado": todo lo que se llevó se anota como deuda. Si sólo una parte es fiado, dejá la forma de pago como está y cambiala en la línea de ese producto (con "Dividir" si es una parte de las unidades).',
      },
      {
        selector: '[data-tour="cuenta-cliente"]',
        titulo: '¿A quién se lo anotás?',
        texto:
          'Elegí el cliente en la lista. Si todavía no está, tocá "Cliente nuevo": lo agregás ahí mismo, sin salir de la cuenta, y queda elegido.',
      },
      {
        selector: '[data-tour="cuenta-cobrar"]',
        tocar: true,
        titulo: 'Tocá "Cobrar"',
        texto: 'No se cobra plata: queda anotado en la cuenta del cliente. Lo ves en "Clientes (fiado)" y se cuenta aparte de lo cobrado.',
      },
    ],
  },
  {
    id: 'escanear-celular',
    grupo: 'Vender y cobrar',
    titulo: 'Escanear los productos con la cámara del celular',
    resumen: 'Usar el celular como lectora de códigos de barras (sólo en el celular).',
    palabras: 'camara celular escanear codigo barras lectora linterna flash zoom telefono',
    secciones: ['Armar cuenta'],
    paraCelular: true,
    pasos: [
      { ...ARMAR_CUENTA, texto: 'Desde el celular, entrá a "Artículos y stock" y tocá "Armar cuenta".' },
      {
        selector: '[data-tour="cuenta-camara"]',
        tocar: true,
        titulo: 'Tocá la cámara',
        texto: 'Tocá el dibujito de la cámara, al lado del buscador. La primera vez el celular te pide permiso: tocá "Permitir". (Esto sólo está en el celular.)',
      },
      {
        titulo: 'Apuntá al código de barras',
        texto: 'Apuntá al código del paquete: se lee solo y suma el producto a la cuenta. Podés ir escaneando uno tras otro sin cerrar la cámara.',
      },
      {
        titulo: 'Si no se lee bien',
        texto:
          'Si hay poca luz, tocá el botón de la linterna (si tu celular la tiene). Con el deslizador podés acercar la imagen. Cuando termines, tocá "Listo".',
      },
    ],
  },

  // ------------------------------------------------------------------ Productos y stock
  {
    id: 'producto-nuevo',
    grupo: 'Productos y stock',
    titulo: 'Cargar un producto nuevo',
    resumen: 'Agregar al sistema algo que todavía no está cargado.',
    palabras: 'agregar crear producto articulo alta nuevo cargar codigo precio',
    secciones: ['Artículos y stock'],
    pasos: [
      {
        ruta: '/articulos',
        selector: '[data-tour="art-nuevo"]',
        tocar: true,
        titulo: 'Tocá "Nuevo artículo"',
        texto: 'Está arriba a la derecha, en "Artículos y stock".',
      },
      { selector: '#descripcion', titulo: 'El nombre', texto: 'Escribí cómo se llama, de forma que lo reconozcas rápido (por ejemplo "COCA COLA 1.5L").' },
      {
        selector: '#codigoBarras',
        titulo: 'El código de barras (si tiene)',
        texto: 'Pasale la lectora por el paquete, o escribí los números de las rayitas. Si no tiene código, dejalo vacío.',
      },
      { selector: '#precioVenta', titulo: 'El precio', texto: 'Escribí cuánto se lo cobrás al cliente.' },
      {
        selector: '#stock',
        titulo: 'Cuántos hay',
        texto: 'Poné cuántas unidades tenés ahora. Después se va descontando solo con cada venta.',
      },
      {
        selector: 'button[form="articulo-form"]',
        tocar: true,
        titulo: 'Guardar',
        texto: 'Tocá "Guardar" y listo: ya lo podés vender.',
      },
    ],
  },
  {
    id: 'sumar-stock',
    grupo: 'Productos y stock',
    titulo: 'Sumar mercadería que llegó',
    resumen: 'Cambiar cuántas unidades hay de un producto (llegó mercadería, se rompió algo...).',
    palabras: 'stock ingreso llego mercaderia reponer sumar cantidad unidades egreso restar rotura perdida ajustar',
    secciones: ['Artículos y stock'],
    pasos: [
      {
        ruta: '/articulos',
        selector: '[data-tour="art-buscar"]',
        titulo: 'Buscá el producto',
        texto: 'Escribí parte del nombre o el código y esperá a que aparezca en la lista.',
      },
      {
        selector: '[data-tour="art-stock"], button[title="Ajustar stock"]',
        tocar: true,
        titulo: 'Tocá el botón de stock',
        texto: 'En la fila del producto, tocá el botón del paquete con un "+" (en el celular, el numerito de unidades). Se abre el cuadro para cambiar cuántos hay.',
      },
      {
        selector: '[data-tour="stock-tipo"]',
        interactuar: true,
        titulo: '¿Qué pasó?',
        texto: '"Ingreso" si llegó mercadería (suma). "Egreso" si se rompió o se perdió (resta). "Ajuste" para dejar un número exacto.',
      },
      { selector: '#cantidad', titulo: 'La cantidad', texto: 'Escribí cuántas unidades son.' },
      {
        selector: '[data-tour="stock-confirmar"]',
        tocar: true,
        titulo: 'Confirmar',
        texto: 'Tocá "Confirmar". El stock queda actualizado.',
      },
    ],
  },
  {
    id: 'cambiar-precio',
    grupo: 'Productos y stock',
    titulo: 'Cambiar el precio de un producto',
    resumen: 'Corregir lo que cuesta un producto (para cambiar muchos juntos, mirá la ayuda de "Precios").',
    palabras: 'precio cambiar modificar subir bajar editar corregir cuesta',
    secciones: ['Artículos y stock'],
    pasos: [
      {
        ruta: '/articulos',
        selector: '[data-tour="art-buscar"]',
        titulo: 'Buscá el producto',
        texto: 'Escribí parte del nombre y esperá a que aparezca en la lista.',
      },
      {
        selector: 'button[title="Editar"]',
        tocar: true,
        titulo: 'Tocá el lápiz',
        texto: 'En la fila del producto, tocá el lápiz ("Editar").',
      },
      { selector: '#precioVenta', titulo: 'El precio nuevo', texto: 'Borrá el precio de antes y escribí el nuevo.' },
      { selector: 'button[form="articulo-form"]', tocar: true, titulo: 'Guardar', texto: 'Tocá "Guardar". Desde ese momento se vende al precio nuevo.' },
    ],
  },
  {
    id: 'contar-inventario',
    grupo: 'Productos y stock',
    titulo: 'Contar lo que hay (inventario)',
    resumen: 'Contar la mercadería de verdad y corregir el stock del sistema.',
    palabras: 'contar inventario stock diferencia conteo revisar corregir deposito gondola',
    secciones: ['Contar inventario', 'Contar inventario (contando)', 'Artículos y stock'],
    pasos: [
      {
        ruta: '/inventario',
        selector: '[data-tour="inv-rubros"]',
        tocar: true,
        titulo: 'Elegí qué contar',
        texto: 'Tocá un rubro (por ejemplo "BEBIDAS"). Conviene contar de a un rubro por vez.',
      },
      {
        selector: 'input[placeholder^="Escaneá un producto"]',
        titulo: 'Escaneá lo que contás',
        texto: 'Cada vez que escaneás un producto, suma 1 a lo contado. También podés escribir las cantidades a mano.',
      },
      {
        selector: '[id^="contado-"]',
        titulo: 'Escribí lo que contaste',
        texto: 'En la casilla "Contado" de cada producto escribí cuántos hay de verdad. Lo que escribís queda guardado: podés dejar y seguir otro día.',
      },
      {
        selector: '[data-tour="inv-corregir"]',
        titulo: 'Corregir el stock',
        texto: 'Recién cuando tocás este botón el sistema cambia el stock por lo que contaste. Antes de eso no se toca nada.',
      },
    ],
  },
  {
    id: 'stock-bajo',
    grupo: 'Productos y stock',
    titulo: 'Ver qué se está por terminar',
    resumen: 'Saber qué productos hay que reponer.',
    palabras: 'stock bajo reponer comprar terminar poco falta pedir',
    secciones: ['Panel', 'Artículos y stock'],
    pasos: [
      {
        ruta: '/',
        selector: '[data-tour="panel-stock-bajo"]',
        titulo: 'En el Panel',
        texto: 'Acá ves cuántos productos tienen poco stock. Si tocás la tarjeta, te lleva directo a esos productos.',
      },
      {
        ruta: '/articulos',
        selector: '[data-tour="art-stock-bajo-filtro"]',
        tocar: true,
        titulo: 'Tocá "Stock bajo"',
        texto: 'En "Artículos y stock", este botón deja sólo los productos que se están por terminar. Al lado hay otro, "Sin stock", para los que ya no quedan.',
      },
      {
        titulo: 'Esos son los que hay que reponer',
        texto: 'La lista que ves son los productos que conviene comprar. Para anotarte algo que no querés olvidar, usá "Recordatorios".',
      },
    ],
  },

  // ------------------------------------------------------------------ Clientes y fiados
  {
    id: 'cliente-nuevo',
    grupo: 'Clientes y fiados',
    titulo: 'Agregar un cliente nuevo',
    resumen: 'Cargar a una persona que compra fiado.',
    palabras: 'cliente nuevo agregar crear alta persona fiado telefono',
    secciones: ['Clientes (fiado)'],
    pasos: [
      {
        ruta: '/clientes',
        selector: '[data-tour="cli-nuevo"]',
        tocar: true,
        titulo: 'Tocá "Nuevo cliente"',
        texto: 'Está arriba a la derecha, en "Clientes (fiado)".',
      },
      { selector: 'form input[required]', titulo: 'El nombre', texto: 'Escribí nombre y apellido. Si hay dos personas con el mismo nombre, agregale algo para distinguirlas (el apellido o un apodo).' },
      {
        selector: '[data-tour="cli-form-debe"]',
        titulo: 'Si ya te debe plata',
        texto: 'Si ya te debía algo de antes (por ejemplo, del cuaderno), poné el monto, o tocá "O anotá qué productos son" para anotarlos uno por uno. Si no debe nada, dejalo vacío.',
      },
      { selector: 'form button[type="submit"]', tocar: true, titulo: 'Crear', texto: 'Tocá "Crear". El cliente queda en la lista y ya le podés anotar fiados.' },
    ],
  },
  {
    id: 'anotar-deuda',
    grupo: 'Clientes y fiados',
    titulo: 'Anotar lo que un cliente ya me debía (cuaderno)',
    resumen: 'Pasar al sistema una deuda que estaba en el cuaderno, con los productos.',
    palabras: 'deuda cuaderno anotar debe saldo viejo productos fiado pasar sistema',
    secciones: ['Clientes (fiado)'],
    pasos: [
      {
        ruta: '/clientes',
        selector: '[data-tour="cli-tabla"]',
        tocar: true,
        titulo: 'Entrá a la cuenta del cliente',
        texto: 'Tocá el nombre del cliente en la lista: se abre su cuenta.',
      },
      {
        selector: '[data-tour="cli-anotar-deuda"]',
        tocar: true,
        titulo: 'Tocá "Anotar deuda"',
        texto: 'Es el botón con el cuadernito.',
      },
      {
        selector: 'input[placeholder^="Producto"]',
        titulo: 'Qué se llevó',
        texto:
          'Escribí el producto (o elegilo de la lista, que trae el precio) y poné cuántos y a cuánto. Con "Agregar otro producto" sumás más. Así, en su estado de cuenta se ve qué productos debe. Si no sabés qué fue, elegí arriba "Sólo un monto".',
      },
      {
        selector: 'input[type="datetime-local"]',
        titulo: '¿Desde cuándo lo debe?',
        texto: 'Poné la fecha en que se lo llevó. Sirve para saber hace cuánto tiempo debe.',
      },
      { selector: 'form button[type="submit"]', tocar: true, titulo: 'Anotar', texto: 'Tocá "Anotar". Queda en su cuenta y se suma a lo que debe.' },
    ],
  },
  {
    id: 'registrar-pago',
    grupo: 'Clientes y fiados',
    titulo: 'Cobrarle a un cliente que viene a pagar',
    resumen: 'Anotar la plata que un cliente entrega de lo que debe.',
    palabras: 'pago pagar cobrar cliente deuda entrega abono plata debe saldo registrar',
    secciones: ['Clientes (fiado)'],
    pasos: [
      {
        ruta: '/clientes',
        selector: '[data-tour="cli-tabla"]',
        tocar: true,
        titulo: 'Entrá a la cuenta del cliente',
        texto: 'Tocá el nombre del cliente en la lista.',
      },
      {
        selector: '[data-tour="cli-pago"]',
        tocar: true,
        titulo: 'Tocá "Registrar pago"',
        texto: 'Es el botón azul.',
      },
      {
        selector: '[data-tour="pago-monto"]',
        titulo: '¿Cuánto paga?',
        texto: 'Escribí cuánto entrega. Si paga todo lo que debe, tocá "Paga todo". Lo que paga se descuenta primero de lo más viejo.',
      },
      { selector: '[data-tour="pago-metodo"]', titulo: '¿Con qué paga?', texto: 'Elegí Efectivo, Tarjeta o Transferencia.' },
      { selector: 'form button[type="submit"]', tocar: true, titulo: 'Registrar', texto: 'Tocá "Registrar". Se descuenta de lo que debe y suma a lo cobrado del día.' },
    ],
  },
  {
    id: 'estado-cuenta',
    grupo: 'Clientes y fiados',
    titulo: 'Mandarle a un cliente lo que debe (PDF o QR)',
    resumen: 'Sacar un papel con los productos que debe, para mandárselo o imprimirlo.',
    palabras: 'estado cuenta pdf qr mandar enviar whatsapp imprimir deuda cliente papel resumen',
    secciones: ['Clientes (fiado)'],
    pasos: [
      {
        ruta: '/clientes',
        selector: '[data-tour="cli-estado"]',
        tocar: true,
        titulo: 'Tocá el botón del QR',
        texto: 'En la fila del cliente hay un botón con un cuadradito de QR. Tocalo.',
      },
      {
        selector: '[data-tour="estado-lista"]',
        titulo: 'Esto es lo que va a ver',
        texto: 'Los productos que debe y cuánto falta pagar de cada uno. Lo que ya pagó se descontó de lo más viejo.',
      },
      {
        selector: '[data-tour="estado-qr"]',
        titulo: 'El código QR',
        texto: 'Escaneá este código con el celular y se baja un PDF con todo eso, listo para mandárselo.',
      },
      {
        selector: '[data-tour="estado-pdf"]',
        titulo: '"Descargar PDF"',
        texto: 'O tocá este botón para bajarlo en esta computadora y mandarlo por WhatsApp, o imprimirlo.',
      },
    ],
  },
  {
    id: 'corregir-cuenta',
    grupo: 'Clientes y fiados',
    titulo: 'Corregir un pago o una deuda mal anotada',
    resumen: 'Sacar algo que se anotó por error en la cuenta de un cliente.',
    palabras: 'corregir borrar error equivocado equivoque pago deuda cuenta sacar anular tacho',
    secciones: ['Clientes (fiado)'],
    pasos: [
      {
        ruta: '/clientes',
        selector: '[data-tour="cli-tabla"]',
        tocar: true,
        titulo: 'Entrá a la cuenta del cliente',
        texto: 'Tocá el nombre del cliente en la lista.',
      },
      {
        selector: 'button[title^="Borrar"]',
        tocar: true,
        titulo: 'Buscá la línea y tocá el tachito',
        texto: 'Cada línea de la cuenta tiene un tachito a la derecha. Tocá el de la que está mal: se saca y el saldo se arregla solo. Ojo: borrar es definitivo.',
      },
      {
        titulo: 'Y anotalo bien',
        texto: 'Después volvé a anotar lo correcto con "Registrar pago" o "Anotar deuda".',
      },
    ],
  },

  // ------------------------------------------------------------------ Precios
  {
    id: 'subir-precios',
    grupo: 'Precios',
    titulo: 'Subir o bajar los precios de muchos productos juntos',
    resumen: 'Por ejemplo, subir un 10% todas las golosinas. Se puede deshacer.',
    palabras: 'precios subir bajar aumento porcentaje rubro masivo inflacion cambiar muchos',
    secciones: ['Precios y costos'],
    soloAdmin: true,
    pasos: [
      {
        ruta: '/precios',
        selector: '[data-tour="precios-pestanas"]',
        interactuar: true,
        titulo: 'Precios y costos',
        texto: 'Acá hay dos herramientas: "Cambiar precios" (esta) y "Cargar costos". Elegí "Cambiar precios".',
      },
      {
        selector: '[data-tour="precios-productos"]',
        titulo: '1. ¿A qué productos?',
        texto: 'Elegí un rubro (por ejemplo GOLOSINAS), o escribí una palabra para que queden sólo los que la tienen.',
      },
      {
        selector: '[data-tour="precios-cuanto"]',
        titulo: '2. ¿Cuánto?',
        texto: 'Elegí si sube o baja, y cuánto (en porcentaje o en pesos). También podés redondear los precios (por ejemplo a $10).',
      },
      {
        selector: '[data-tour="precios-vista"]',
        titulo: '3. Mirá cómo queda',
        texto: 'Acá ves el precio de antes y el de después de cada producto. Destildá los que no querés cambiar.',
      },
      {
        selector: '[data-tour="precios-aplicar"]',
        titulo: 'Cambiar los precios',
        texto: 'Recién cuando tocás este botón se cambian. Si te equivocás, abajo en "Cambios anteriores" hay un botón para deshacerlo.',
      },
    ],
  },

  // ------------------------------------------------------------------ Controlar el negocio
  {
    id: 'cuanto-vendi',
    grupo: 'Controlar el negocio',
    titulo: 'Ver cuánto se vendió',
    resumen: 'Saber lo que se vendió hoy, otro día o en el mes.',
    palabras: 'vendi ventas hoy ayer mes total ganancia reporte calendario dia cuanto',
    secciones: ['Panel', 'Calendario', 'Reportes'],
    pasos: [
      {
        ruta: '/',
        selector: '[data-tour="panel-ventas-hoy"]',
        titulo: 'Hoy, en el Panel',
        texto: 'En el Panel ves lo que se vendió hoy. Tocá esta tarjeta para ver el detalle.',
      },
      {
        ruta: '/ventas',
        selector: '[data-tour="cal-grid"]',
        titulo: 'Cualquier día, en el Calendario',
        texto: 'Cada día muestra lo vendido. Tocá un día para ver todo lo que se vendió, producto por producto.',
      },
      {
        ruta: '/reportes',
        selector: '[data-tour="rep-presets"]',
        titulo: 'Varios días juntos, en Reportes',
        texto: 'Elegí "Hoy", "Esta semana" o "Este mes" y mirá los totales, el gráfico y qué se vendió más.',
      },
    ],
  },
  {
    id: 'anular-venta',
    grupo: 'Controlar el negocio',
    titulo: 'Anular una venta que me equivoqué',
    resumen: 'Sacar una venta cargada por error (se devuelve el stock).',
    palabras: 'anular venta error equivoque borrar devolver sacar cancelar',
    secciones: ['Calendario'],
    pasos: [
      {
        ruta: '/ventas',
        selector: '[data-tour="cal-grid"]',
        tocar: true,
        titulo: 'Tocá el día de la venta',
        texto: 'En el Calendario, tocá el día en que se hizo la venta.',
      },
      {
        selector: 'button[title="Anular venta"]',
        tocar: true,
        titulo: 'Tocá el tachito de esa venta',
        texto: 'Buscá la venta en la lista y tocá el tachito de la derecha. Te pide que confirmes: al hacerlo, la venta se saca y el stock vuelve a sumarse.',
      },
    ],
  },
  {
    id: 'recordatorio',
    grupo: 'Controlar el negocio',
    titulo: 'Anotar algo para no olvidarme',
    resumen: 'Dejar un recordatorio para todas: algo que hay que hacer, comprar o cobrar.',
    palabras: 'recordatorio anotar acordar tarea pendiente hacer comprar cobrar nota aviso',
    secciones: ['Recordatorios', 'Panel'],
    pasos: [
      {
        ruta: '/recordatorios',
        selector: '[data-tour="rec-nuevo"]',
        tocar: true,
        titulo: 'Tocá el botón para anotar',
        texto: 'Está arriba, en "Recordatorios".',
      },
      {
        titulo: 'Escribí qué hay que hacer',
        texto: 'Elegí de qué se trata, escribí el recordatorio y, si corre apuro, poné un día o marcalo como urgente. Lo ven todas las que usan el programa.',
      },
      {
        ruta: '/recordatorios',
        selector: '[data-tour="rec-lista"]',
        titulo: 'Cuando alguien lo hace',
        texto: 'Tocá el circulito para marcarlo como hecho. Queda anotado quién lo hizo.',
      },
    ],
  },

  // ------------------------------------------------------------------ Otras cosas
  {
    id: 'cambiar-clave',
    grupo: 'Otras cosas',
    titulo: 'Cambiar mi clave',
    resumen: 'Poner una clave nueva para entrar al programa (cada una cambia la suya).',
    palabras: 'clave contrasena password cambiar mia mi cuenta usuario entrar olvide',
    secciones: [],
    pasos: [
      {
        selector: '[data-tour="menu-cambiar-clave"]',
        tocar: true,
        titulo: 'Tocá la llavecita',
        texto: 'Está abajo en el menú, al lado de tu nombre. (En el celular, primero abrí el menú con las tres rayitas de arriba.)',
      },
      {
        selector: '[data-tour="clave-actual"]',
        titulo: 'Tu clave de ahora',
        texto: 'Escribí la clave con la que entrás hoy. Se la pide para estar segura de que sos vos.',
      },
      {
        selector: '[data-tour="clave-nueva"]',
        titulo: 'La clave nueva',
        texto: 'Escribí la que quieras (mínimo 4 letras o números) y repetila abajo. Tocá el ojito para verla y comprobar que la escribiste bien. Anotala en un lugar seguro.',
      },
      {
        selector: '[data-tour="clave-guardar"]',
        tocar: true,
        titulo: 'Guardar',
        texto: 'Tocá "Cambiar mi clave". Desde ese momento entrás con la nueva.',
      },
    ],
  },
  {
    id: 'usuario-nuevo',
    grupo: 'Otras cosas',
    titulo: 'Darle usuario a una empleada',
    resumen: 'Que cada una entre con su nombre y su clave.',
    palabras: 'usuario empleada empleado clave contrasena password cuenta acceso agregar persona',
    secciones: ['Usuarios'],
    soloAdmin: true,
    pasos: [
      {
        ruta: '/usuarios',
        selector: '[data-tour="usr-nuevo"]',
        tocar: true,
        titulo: 'Tocá "Nuevo usuario"',
        texto: 'Está arriba, en "Usuarios".',
      },
      {
        titulo: 'Nombre, usuario y clave',
        texto: 'Escribí el nombre de la persona, el nombre con el que va a entrar y una clave (que se la pueda acordar). Las empleadas pueden vender y cargar productos, pero no ven los costos ni pueden borrar cosas.',
      },
    ],
  },
];

export function guiaPorId(id: string): Guia | undefined {
  return GUIAS.find((g) => g.id === id);
}

// Para que "cobrar", "Cobrár" o "COBRAR" sean lo mismo en el buscador.
const RANGO_TILDES = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');
export function normalizarBusqueda(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(RANGO_TILDES, '');
}

/** Las guías que contienen todas las palabras escritas (en el título, el resumen o las
 * otras formas de nombrarlas). */
export function buscarGuias(texto: string, lista: Guia[]): Guia[] {
  const palabras = normalizarBusqueda(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return lista;
  return lista.filter((g) => {
    const pajar = normalizarBusqueda(`${g.titulo} ${g.resumen} ${g.palabras}`);
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Lo que significan las palabras que se usan en el programa. */
export const PALABRAS_DEL_PROGRAMA: Array<{ palabra: string; significa: string }> = [
  { palabra: 'Artículo / producto', significa: 'Cada cosa que vendés (una gaseosa, un alfajor, un kilo de fiambre...).' },
  { palabra: 'Stock', significa: 'Cuántas unidades hay de un producto. "Stock bajo" es que quedan pocas; "sin stock", que no quedan.' },
  { palabra: 'Para revisar', significa: 'Productos que se vendieron cuando el sistema decía que no había. Conviene contarlos para corregir el stock.' },
  { palabra: 'Rubro', significa: 'El grupo al que pertenece un producto (bebidas, golosinas, limpieza...).' },
  { palabra: 'Cuenta (Armar cuenta)', significa: 'Lo que se lleva el cliente, antes de cobrarlo.' },
  { palabra: 'Fiado', significa: 'El cliente se lleva la mercadería y la paga después: queda anotado a su nombre.' },
  { palabra: 'Saldo / "Debe"', significa: 'Lo que un cliente todavía tiene que pagar.' },
  { palabra: 'Pago de cuenta', significa: 'La plata que un cliente entrega de lo que debe. Se descuenta de lo más viejo primero.' },
  { palabra: 'Estado de cuenta', significa: 'Un papel (PDF) con los productos que debe un cliente y cuánto falta pagar.' },
  { palabra: 'Código de barras', significa: 'Las rayitas del paquete. Se escanean con la lectora, o con la cámara del celular, y suman el producto solo.' },
  { palabra: 'Costo y precio', significa: 'El costo es lo que pagás vos por el producto; el precio, lo que le cobrás al cliente.' },
  { palabra: 'Recordatorio', significa: 'Una nota para que no se olvide algo (comprar, cobrar, cambiar). La ven todas las que usan el programa.' },
];

/** Qué hay en cada parte del menú, en una frase. */
export const PARTES_DEL_MENU: Array<{ nombre: string; ruta: string; sirve: string; soloAdmin?: boolean; soloEscritorio?: boolean }> = [
  { nombre: 'Panel', ruta: '/', sirve: 'El resumen del día: cuánto se vendió, qué se está por terminar, qué hay para hacer.' },
  { nombre: 'Artículos y stock', ruta: '/articulos', sirve: 'Los productos y cuántos hay. Desde acá también se cobra ("Armar cuenta") y se cargan productos nuevos.' },
  { nombre: 'Contar inventario', ruta: '/inventario', sirve: 'Contar lo que hay de verdad y corregir el stock.' },
  { nombre: 'Precios y costos', ruta: '/precios', sirve: 'Cambiar los precios de muchos productos juntos y cargar cuánto te cuesta cada uno.', soloAdmin: true },
  { nombre: 'Calendario', ruta: '/ventas', sirve: 'Lo que se vendió cada día. Desde acá se anula una venta.' },
  { nombre: 'Reportes', ruta: '/reportes', sirve: 'Los totales de varios días, qué se vendió más y cómo viene el negocio.' },
  { nombre: 'Clientes (fiado)', ruta: '/clientes', sirve: 'Las cuentas de los que compran fiado: lo que deben, sus pagos y el papel para mandárselo.' },
  { nombre: 'Recordatorios', ruta: '/recordatorios', sirve: 'Notas para no olvidarse de algo. Las ven todas.' },
  { nombre: 'Usuarios', ruta: '/usuarios', sirve: 'Quiénes pueden entrar al programa, cada una con su clave.', soloAdmin: true },
  { nombre: 'Configuración', ruta: '/configuracion', sirve: 'Cómo se conectan las computadoras entre sí y con el servidor de internet.', soloAdmin: true, soloEscritorio: true },
];
