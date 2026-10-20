# Mis Amores - Gestión

Sistema de gestión comercial (stock, ventas, reportes) para el negocio. Reemplazo del viejo sistema VP Sistemas.

## Stack

- **Electron + React + TypeScript** — app de escritorio para Windows.
- **MongoDB** — base de datos. Se conecta a un Mongo local (`mongodb://127.0.0.1:27017`, base `mis_amores_gestion`) salvo que se definan las variables de entorno `MONGODB_URI` / `MONGODB_DB_NAME`.
- **Tailwind CSS** para los estilos.

## Requisitos para desarrollar

1. **MongoDB Community Server instalado y corriendo** como servicio de Windows (Compass es solo el visor, no alcanza por sí solo — hace falta el motor de base de datos). Se puede confirmar que está corriendo con:
   ```
   sc query MongoDB
   ```
   (Tiene que estar en **cada** PC del negocio: cada una guarda su propia base completa.)
2. Node.js 20+.

## Cómo correr en desarrollo

```
npm install
npm run dev
```

Esto levanta Vite (renderer) y Electron juntos. Usuario inicial: `admin` / `admin123` (cambiarla desde la sección Usuarios una vez adentro).

## Cómo generar el instalador de Windows

```
npm run build:win
```

Genera un instalador `.exe` en `release/`. El acceso directo que crea en el escritorio se llama **MIS AMORES GESTION**, con el ícono de `build-assets/icon.ico`.

## Varias PCs: todas son iguales

Desde la versión 0.6.0 no hay una PC "principal". **Cada PC guarda todos los datos del negocio** en su propio MongoDB y trabaja sola (aunque las otras estén apagadas); lo que se carga en una llega a las demás **en vivo** por el WiFi/red del local, sin internet ni servidor central. Si una PC estaba apagada, al volver se pone al día sola. Los celulares siguen entrando por el navegador a cualquiera de las PCs.

Para sumar una PC: **Configuración → Sumar esta PC a otra**, con la cuenta de administradora de la otra PC (lo que la PC nueva ya tuviera cargado se junta con lo de la otra sin duplicar).

### Servidor en internet (opcional)

Para que los celulares anden aunque **todas las PCs estén apagadas**, la misma app puede correr como **servidor sin ventana** (`npm run servidor`, `electron/servidor.ts`) en una máquina prendida siempre —por ejemplo la gratuita de Oracle Cloud— y entrar por Tailscale. Es una PC más de la red: guarda todos los datos y se sincroniza con las demás. Guía paso a paso en [SERVIDOR.md](SERVIDOR.md); se prueba con `npm run probar:servidor`.

Si no se puede usar una tarjeta (Oracle la pide para verificar la cuenta), hay otra opción **gratis y sin tarjeta**: el **modo nube** en Render + MongoDB Atlas. Ahí el servidor no puede llamar a las PCs (están detrás del router): ellas lo llaman y le **empujan** sus cambios (`POST /api/sync/empujar`, firmado con la clave de la red incluyendo el contenido). No guarda nada en disco, no crea el usuario `admin` de fábrica y limita los intentos de entrada. Guía paso a paso en [SERVIDOR_RENDER.md](SERVIDOR_RENDER.md); se prueba con `npm run probar:nube`.

### Cómo funciona (electron/sync)

- **Diario de cambios** (`diario.ts`): cada escritura en una colección replicada (`modelo.ts`) queda anotada en `_sync_meta` con qué campos cambiaron y cuándo, con un número de secuencia local. `database.ts` engancha el diario a las escrituras.
- **Reloj híbrido** (`reloj.ts`): ordena los cambios aunque la hora de las PCs no coincida.
- **Motor** (`motor.ts`): cada PC mantiene con cada otra un pedido que espera (`GET /api/sync/cambios?desde=N`) y aplica lo que llega (`aplicar.ts`). Las PCs se encuentran por mDNS (`misamores.local`) y se reconocen con una clave de red que sólo tienen las que se sumaron con una cuenta de administradora: la clave nunca viaja, cada pedido va firmado con ella (HMAC, `seguridad.ts`) y la respuesta trae su prueba.
- **Reglas para que no se pisen** (`aplicar.ts`): documentos nuevos se agregan; dos cambios al mismo documento se combinan **campo por campo** (gana el más reciente); lo borrado queda borrado; el **stock se calcula** como `stockBase + suma de movimientos_stock` (así dos PCs que venden lo mismo a la vez descuentan las dos); rubros/marcas/clientes/usuarios repetidos se unifican y, si dos productos se cargan con el mismo código de barras, a uno se le saca el código y se avisa en Configuración.
- **Fotos**: la ruta guardada es del disco de cada PC; al llegar un producto se apunta a la carpeta local y la foto se baja de la otra PC.
- **Revisión**: cada tanto (y con el botón de Configuración) las PCs comparan una huella de sus datos; si no coinciden, se vuelve a traer todo.

### Pasar de la versión 0.5.0 (principal + conectada)

Es automático: la PC que era principal sigue como está (se anotan sus datos en el diario y se calcula el "stock inicial" de cada producto, con un respaldo antes); la PC que estaba "conectada" trae los datos de la otra (guardando antes un respaldo de lo que tuviera). Si la otra PC está apagada, usa la última copia guardada y se actualiza cuando la otra vuelve.

### Pruebas de la sincronización

Levantan copias reales de la app contra bases de prueba (`test_*`, sin tocar `mis_amores_gestion`) y necesitan MongoDB local:

```
npm run build               # (una vez, o cuando cambia el código)
npm run probar:sync         # escenarios: vivo, apagones, duplicados, migración desde 0.5.0, fotos...
npm run probar:union        # "Sumar esta PC" manejando la pantalla real
npm run probar:azar -- 42   # cientos de operaciones al azar con apagones (semilla opcional)
npm run probar:servidor     # servidor sin ventana (Oracle)
npm run probar:nube         # servidor en internet que no puede llamar a las PCs (Render)
npm run probar:nube-pantalla  # "Conectar con el servidor de internet" desde la pantalla real
npm run probar:inventario   # vender sin stock, conteo de inventario
npm run probar:estado-cuenta  # enlace firmado y PDF de los fiados
npm run probar:busqueda     # búsqueda tolerante de productos
npm run probar:fiados       # deuda anotada a mano, pagos en lo cobrado, antigüedad, teléfono
npm run probar:precios      # cambio masivo de precios con deshacer, costos
```

## Estructura

```
electron/           proceso principal de Electron (ventana, IPC, acceso a datos)
  db/                conexión a MongoDB, índices, seed inicial
  repositories/       consultas a cada colección (articulos, clientes, precios, ventas, reportes...)
  ipc/handlers.ts     expone las operaciones al renderer vía IPC, con control de permisos
  server/             servidor HTTP (celulares y otras PCs), sesiones, mDNS
  sync/               sincronización entre PCs (diario, reloj, motor, reglas, rutas)
shared/              tipos y nombres de canal IPC compartidos entre electron y react
src/                 la app React (login, dashboard, módulo de artículos, usuarios)
scripts/             herramientas (exportar/importar base, pruebas de sincronización)
build-assets/        ícono de la app
```

## Roles

- **admin** (la jefa): acceso total, incluyendo precio de costo, cambiar precios en masa, eliminar artículos y gestionar usuarios.
- **empleado**: puede cargar artículos y stock, pero no ve/edita precio de costo ni puede eliminar, cambiar precios en masa ni gestionar usuarios.

## Recordatorios

Pantalla común (en el menú, con el número de pendientes) para anotar lo que hay que hacer, cambiar, reponer o cobrar, con día opcional y marca de urgente, para que todas estén al tanto. Se anotan desde las PCs y los celulares, se sincronizan como el resto de los datos y queda registrado quién lo anotó y quién lo hizo. Cualquiera con sesión los ve y los marca; los borra quien los anotó o una administradora. Un recordatorio puede estar **atado a un producto o a un cliente**: en la lista tiene botones que llevan directo a ajustar su stock, editarlo, ver su cuenta o registrarle un pago (y al terminar pregunta si ya se puede marcar como hecho). También se puede anotar un recordatorio desde la fila de un producto o desde la cuenta de un cliente.

## Vender sin stock y contar el inventario

Muchos productos están cargados con un stock que no es el real (o en cero). Para poder usar el mostrador igual:

- **Vender sin stock registrado.** Una venta se registra aunque el sistema diga que no queda (avisa en la cuenta, no la frena): el stock queda en negativo y el producto pasa a **"Para revisar"** (filtro en Artículos y tarjeta en el Panel) hasta que se lo cuenta. Sólo las ventas pasan en negativo: un egreso o un ajuste manual sigue sin poder dejar el stock bajo cero, y el valor del inventario no resta los negativos. Se sincroniza como cualquier stock (`stockBase` + movimientos).
- **Código de barras desconocido en el mostrador.** Si se escanea un código (7 a 14 números) que no está cargado, pregunta **a qué producto es** (buscándolo por nombre, con los que no tienen código primero), se lo asigna para siempre y lo suma a la cuenta; o permite cargarlo como producto nuevo con ese código. No se adivina el producto por un parecido de números.
- **Contar inventario** (menú, también en el celular). Se elige un rubro (o "Para revisar", o todos), se cuenta escribiendo o escaneando (cada escaneo suma 1; los productos por peso se escriben en kg) y se ve la diferencia de cada uno. Recién al apretar **Corregir el stock** el sistema deja cada producto en lo contado (un ajuste que queda en su historial como "Conteo de inventario (figuraba N)"). Lo contado se guarda en el aparato: se puede dejar y seguir después. Contar el mismo producto desde dos aparatos a la vez suma los dos ajustes: que cuente una sola persona por rubro. Prueba: `npm run probar:inventario`.

## Estado de cuenta de los fiados (código QR)

En **Clientes**, cada cliente tiene un botón con un código QR (en la lista y en su cuenta). Abre un cuadro con lo que debe y el **QR**: al escanearlo con el celular baja un **PDF** con el estado de cuenta (**qué productos tiene que pagar**, cada uno con su cantidad y su precio, lo que ya pagó y el total), listo para compartirlo y mandárselo. El cuadro muestra esa misma lista antes de mandarla. El mismo cuadro tiene un botón **Descargar PDF** para bajarlo desde la PC. Se ve igual en la PC y en el celular.

- **El enlace** (`/estado/<cliente>/<vence>/<firma>`, en `electron/estadoCuenta.ts`) se abre **sin usuario ni contraseña** (quien escanea no tiene cuenta), así que lo protege una firma: sale de la clave de la red del negocio, no se puede armar el enlace de otro cliente, la fecha de vencimiento va firmada (**30 días**) y un enlace malo, vencido o de un cliente que ya no está dice siempre lo mismo. Siempre muestra lo que debe **en ese momento** (no una foto). Lo atiende el servidor de internet (`URL_SERVIDOR_INTERNET`), igual que el celular: si estaba dormido, la primera vez tarda hasta 1 minuto.
- **Lo que cuenta:** lo anotado sin pagar (un fiado ya marcado como pagado a mano no cuenta) + saldos iniciales y ajustes − pagos: el mismo saldo que muestra la lista. En el PDF, lo que ya pagó se **descuenta de lo más viejo primero** (`repartirPagos`, en `shared/cuentaCorriente.ts`), así que figura sólo lo que de verdad sigue debiendo, producto por producto: un fiado viejo ya cubierto no aparece, y uno cubierto en parte dice "$X de $Y".
- **El PDF** lo arma `electron/pdfSimple.ts`, un generador mínimo sin librerías (texto Helvetica y rectángulos, varias páginas, tildes y ñ), así que no suma peso al instalador ni al servidor. Quien reciba el enlace puede ver el nombre y las compras fiadas de ese cliente hasta que venza: conviene mandarlo sólo a la persona.
- Prueba: `npm run probar:estado-cuenta`.

## Buscar productos

La búsqueda (en Artículos, en "Armar cuenta", en el conteo y en la papelera) no exige escribir el nombre exacto: se escriben **varias palabras en cualquier orden** ("almibar pina" encuentra "PIÑA EN ALMÍBAR 800G"), da igual **mayúsculas, tildes y ñ**, y los decimales valen con punto o coma ("1.5" y "1,5"). Se muestran primero los que mejor coinciden (el código exacto, el nombre igual a lo escrito, los que empiezan con eso, los que tienen cada palabra al principio de alguna palabra, y después el resto). Está en `electron/repositories/articulos.ts` (`construirMatchBusqueda`, `puntajeDeBusqueda`). Prueba: `npm run probar:busqueda`.

## Fiados: deuda a mano, pagos, antigüedad y teléfono

- **Anotar deuda** (botón en la cuenta de cada cliente): para pasar lo que figura en el cuaderno o dejar anotado un fiado que no pasó por el mostrador. Se anotan **los productos** (se eligen del catálogo, que trae el precio, o se escriben; cada uno con cantidad y precio) o, si no se sabe qué fue, sólo un monto. Lleva nota y fecha (puede ser de hace semanas, y desde ahí cuenta cuánto hace que debe). Es un ajuste del cliente: aparece en su historial y en el estado de cuenta con sus productos. **No toca el stock** (para lo que se lleva ahora, "Armar cuenta" con "Fiado"). Al **crear un cliente** que ya debe algo también se pueden anotar los productos (`ajustes_cuenta.items`).
- **Cobrar y marcar lo pagado.** Lo pagado se registra como **pago** (cuenta como cobrado y se descuenta de lo más viejo primero): cada deuda de la cuenta dice "Pagado", "Resta $X" o "Pendiente" según los pagos, y tocar una pendiente abre el pago con el monto que hace falta (incluye lo anterior que todavía se debe). "Paga todo" completa lo que debe, y el pago puede llevar una nota. Antes se podía marcar un fiado como "pagado" a mano, que lo sacaba de la deuda **sin sumar a lo cobrado**: ya no se ofrece, y los que quedaron marcados así se pueden volver a dejar pendientes. Si dos deudas tienen exactamente la misma fecha (la de lo anotado a mano llega hasta el minuto) se cubre primero la que se anotó antes (`compararAntiguedad`), igual en la PC, el servidor y el celular. Si alguien pagó de más, la pantalla dice "Saldo a favor".
- **Los pagos de cuentas cuentan como cobrado.** Lo que un cliente paga de su deuda entra en lo cobrado del día: Panel ("incluye $X de pagos de cuentas"), Calendario (el día muestra una sección "Pagos de cuentas recibidos" con quién pagó y quién lo recibió) y Reportes (tarjeta "Cobrado" y barra aparte de pagos). Un día en el que sólo hubo pagos también aparece.
- **Desde cuándo debe.** Cada cuenta con saldo muestra "debe hace N días": se calcula pagando primero lo más viejo (los pagos y los ajustes que restan cubren primero las deudas más antiguas), así que lo que queda es lo que realmente sigue sin pagar. La lista se puede **ordenar** (más deben primero, deuda más vieja primero, por nombre) y **filtrar** por "+30 / +60 / +90 días".
- **Teléfono** del cliente (opcional): se carga al crear o con **Editar**, se ve en la lista y se puede buscar por él.
- Al **sacar de la lista** a un cliente que todavía debe, avisa que esa deuda deja de aparecer en el total.
- Todo esto viaja entre las PCs y el celular como el resto de los datos (el teléfono, las deudas anotadas y sus productos replican por campo; no hay colecciones nuevas). Prueba: `npm run probar:fiados` (y las secciones 24 y 25 de `npm run probar:sync`).

## Precios y costos

Pantalla **Precios y costos** (sólo administradoras), con dos pestañas:

- **Cambiar precios.** Se elige a qué productos (un rubro, y/o los que contengan unas palabras), se sube o baja un **porcentaje o un monto fijo**, y se **redondea** (a $1, $5, $10, $50 o $100). Antes de aplicar muestra cada producto con su precio de antes y de después, deja destildar los que no se quieren tocar y pide confirmación. Si alguien cambió el precio de un producto mientras tanto, ese producto se saltea y se avisa (no se pisa un cambio ajeno).
- **Deshacer.** Cada cambio masivo queda en **Cambios anteriores**, con cuántos productos tocó y quién lo hizo, y se puede **deshacer** (también desde otra PC): cada producto vuelve a su precio de antes, salvo los que ya se cambiaron a mano después. Los cambios quedan en el historial de precios de cada producto, marcados con el cambio al que pertenecen.
- **Cargar costos.** Planilla con todos los productos y una casilla de costo; al lado se ve la ganancia en pesos y en porcentaje, y se avisa en rojo si algún costo supera al precio. Tab o Enter pasa al siguiente; el filtro "Sin costo" deja sólo los que faltan cargar. Se guarda todo junto.

Código en `shared/precios.ts` (la cuenta de redondeo) y `electron/repositories/precios.ts`; hasta 1000 productos por operación (la pantalla manda de a 300). Prueba: `npm run probar:precios`.

## Cámara del celular como lectora

En el celular y las tablets (no en la PC, donde está la lectora de códigos) aparece un botón de cámara en **Armar cuenta**, en **Contar inventario** y en **Artículos**. La cámara queda abierta y lee los códigos de barras uno tras otro: en la cuenta suma el producto, en el conteo suma 1 al contado, y si el código no está cargado se cierra sola y pregunta a qué producto pertenece. Un mismo código visto varias veces seguidas cuenta una sola vez.

- Usa el lector que trae el celular (`BarcodeDetector`, Android) y, si no lo tiene (iPhone), la librería ZXing, que se descarga sólo en ese momento (no pesa para el resto).
- **Linterna y zoom.** Si el celular los ofrece (los Android con Chrome suelen; el iPhone **no deja prender la linterna desde una página de internet**), debajo de la imagen aparecen un botón de linterna y un zoom de 1x en adelante, para etiquetas chicas o con poca luz. La linterna se acuerda mientras dure la sesión (se escanean muchos productos seguidos). Si la imagen se ve oscura varias veces seguidas, avisa "Se ve oscuro" y sugiere prender la linterna, o buscar más luz si no hay. Si no hay linterna ni zoom, no aparece ningún botón que no ande.
- El navegador sólo deja usar la cámara en una página segura: anda con la dirección https del servidor de internet, no con la dirección de la red local (http).
- Está en `src/components/LectorCamara.tsx`. Se probó manejando Chrome con una cámara falsa que muestra un código de barras.

## Ayuda para quien recién empieza

El programa es nuevo para quienes lo usan, así que la ayuda está pensada para guiar **qué se quiere hacer**, no para explicar botones sueltos:

- **Botón "Ayuda"** violeta, con texto, al lado del título de cada pantalla (antes era un "?" chiquito y gris), y otro siempre a la vista en el menú de la izquierda (también en el celular).
- Abre el **centro de ayuda** (`src/components/CentroDeAyuda.tsx`): "¿Qué querés hacer?" con guías por tarea en palabras de todos los días (cobrar una venta, anotar un fiado, cargar un producto, sumar mercadería, contar el inventario, cobrarle a un cliente, mandarle lo que debe en PDF/QR, subir precios, anular una venta, etc.), un **buscador** (da igual mayúsculas y tildes, y busca por palabras como "plata" o "cuaderno"), "¿qué hay en cada parte del menú?" y "¿qué significa cada palabra?" (stock, fiado, rubro...). Primero se muestra lo de la pantalla en la que se está. A las empleadas no se les muestran las guías de administradora.
- **"Mostrame paso a paso"** (`RecorridoAyuda.tsx`): la guía lleva sola a la pantalla correcta, espera a que se abra el cuadro, marca lo que hay que tocar con letra grande y, cuando dice "Tocá lo que está marcado", **sigue sola al tocarlo** (se aprende haciendo). El resto de la pantalla queda bloqueado para no tocar otra cosa por error; Escape o la X la cierran, y "Seguir sin tocar" evita quedarse trabada.
- **"Mostrame esta pantalla"**: la guía de cada pantalla señala para qué sirve cada parte (también "Armar cuenta" y "Contar inventario", que antes no tenían ayuda).
- **Tarjeta de bienvenida** en el Panel con "Cómo cobrar una venta", "Cómo anotar un fiado" y "Cómo cargar un producto"; cada persona la saca con "Ya sé usarlo" (se acuerda por usuario en ese aparato).
- El contenido está en `src/components/guias.ts` (por tarea) y `recorridos.ts` (por pantalla); lo que se señala son atributos `data-tour` puestos en cada pantalla (o un `id`). Para sumar una guía alcanza con agregarla a `GUIAS`.

## Armar cuenta: cada producto con su forma de pago

**Dónde está (0.8.19):** "Armar cuenta" es una parte del menú de la izquierda (`/armar-cuenta`, debajo de "Panel"), con su pantalla propia, igual que Artículos o Clientes; antes era un botón dentro de "Artículos y stock" que abría un cuadro. La ayuda paso a paso ("Cobrar una venta", "Anotarle un fiado", la de la cámara) ahora arranca marcando ese botón del menú (en el celular hay que abrir el menú primero), y en "Armar cuenta" el celular ya no abre el teclado solo al entrar.

En "Armar cuenta" (caja y celular) cada renglón dice **cómo se paga**: Efectivo, Tarjeta, Transferencia o Fiado (selector al lado del producto). Sirve para el cliente que paga una parte de una forma y el resto de otra.

- **Dividir un mismo producto.** Con 2 o más unidades (o cualquier peso) aparece **"Dividir"**: "de 3 unidades, ¿cuántas se pagan de otra forma?" → el renglón queda con las que quedan y aparece otro con las que se separaron (se puede dividir por kilos también). Si dos renglones quedan iguales (mismo producto, misma forma de pago y mismo cliente) se juntan solos.
- **Fiado con su cliente.** Cuando un renglón pasa a Fiado, en ese mismo renglón aparece la lista de clientes y **"Cliente nuevo"** (abre un cuadro con nombre y teléfono, lo crea y lo deja elegido, sin salir de la cuenta; `NuevoClienteRapido.tsx`). Cada renglón fiado tiene su cliente (se puede anotar una parte a Marta y otra a Pedro); el cliente que se elige primero se copia a los otros fiados que todavía no tenían. Un fiado que sale de dividir otro fiado arranca sin cliente. Mientras falte algún cliente, "Cobrar" queda apagado y lo avisa.
- **"Forma de pago de todo"** (abajo) cambia todos los renglones de una vez y es con la que arrancan los productos que se agreguen después; si hay formas distintas dice "Varias formas de pago". Abajo se lee el detalle ("Efectivo $ 5.000 · Transferencia $ 2.500") y, si hay fiado, cuánto se cobra ahora y cuánto queda fiado.
- Al cobrar, **cada renglón es una venta** con su forma de pago y su cliente, y todas comparten el mismo número de compra (`ticketId`): el Panel y los Reportes la cuentan como **una** compra. La cuenta a medias se guarda por usuario y se recupera al recargar; la que quedó guardada con el formato anterior (una sola forma de pago para todo) se entiende sola.
- No cambió nada en el servidor ni en la sincronización: `ventas.crear` ya recibía forma de pago y cliente por venta.

## Revisión general (0.8.18): cuentas, stock y mensajes

Lo que salió de revisar toda la aplicación (con pruebas que arman una base aparte y la maltratan: `npm run probar:ventas`):

- **Una compra es una compra.** Cada producto de una cuenta se guarda como una venta aparte, así que "cuántas ventas hubo" y el ticket promedio contaban de más. Ahora cada cobro lleva un número de compra (`ticketId`, que arma `src/utils/ticket.ts` y que comparten todos los productos de ese cobro) y el Panel, los Reportes, el Calendario y el asistente cuentan **compras**. Las ventas de antes, que no tienen número, se agrupan por persona, cliente y minuto (`CLAVE_TICKET` en `electron/repositories/ventas.ts`). La plata no cambia: sólo cuánto es "una venta". Un número mal armado se ignora (la venta se hace igual).
- **Un producto sin precio no se vende.** El mostrador no lo deja agregar ("No tiene precio cargado") y el servidor tampoco (antes quedaba una venta de $0 que ensuciaba los totales). El formulario del producto ya no ofrece las listas de precio 2 y 3 si no tenían valores, porque todavía no se usan al vender.
- **Stock bajo, Sin stock y Para revisar dicen lo mismo en todos lados.** "Stock bajo" = quedan pocos pero hay (más de 0 y hasta el mínimo), "Sin stock" = 0 o menos, "Para revisar" = negativo. Las tarjetas del Panel ahora se tocan y llevan al filtro correspondiente (`/articulos?stock=bajo`, `?stock=sin`, `?revisar=1`), y el asistente manda al botón que corresponde. Antes el Panel y el filtro daban números distintos.
- **El asistente entiende más formas de preguntar** ("cuánto entró", "facturé", "la caja de hoy"), aclara los pagos de cuentas que se recibieron y contesta "el producto más vendido del mes" con el producto (antes contestaba el total del mes).
- **Cada persona cambia su propia clave** (botón de la llave en el cuadro del usuario, abajo en el menú), pidiendo la actual. Antes sólo podía una administradora.
- **Los errores se entienden.** Un pedido con datos mal armados, un número inventado o un error técnico se traduce a una frase clara (`electron/mensajesError.ts`); el servidor contesta con un mensaje (y no con una página de error) si le llega un JSON roto.
- La guía paso a paso ya no se confunde con el menú del celular cuando está cerrado (se ignoran los elementos que están fuera de la pantalla).
- **"No me deja escribir" con la ayuda abierta (era un defecto de la 0.8.17).** La guía paso a paso oscurecía y bloqueaba todo menos lo marcado en los pasos de "tocá acá", así que en los pasos que dicen "Escribí el precio / cuántas unidades son / el nombre" el campo marcado estaba tapado. Ahora, si lo señalado es un campo (o tiene uno adentro) se puede escribir ahí, el paso lo avisa ("Probalo ahí mismo") y se sigue con "Siguiente"; los pasos que dicen "Tocá Guardar / Confirmar / Crear / Cobrar..." dejan tocar el botón de verdad y la guía sigue sola (`tocar: true`), y los que usan botones sin campos pueden marcarse `interactuar: true`. El recuadro de lo señalado incluye las listas desplegables (`data-desborda`: la lista de resultados del buscador).
- **Formulario del artículo.** Los precios ahora son campos de texto que se ven como se escriben ("0,75" ya no pierde el cero: antes quedaba ",75"), con aviso si se escribe "1.500" (se lee como 1,5). El stock actual de un artículo ya cargado dejó de ser un cuadro gris sin explicación: se ve el número con un botón **"Cambiar el stock"** (abre el mismo cuadro de Ajustar stock sin perder lo que se estaba editando). El precio de venta no puede quedar en 0.
- **Foco de la ventana de la PC.** En Windows, después de un cuadro nativo (`confirm`/`alert`: dar de baja, anular, vaciar...) Electron deja la ventana sin el foco del teclado y los campos dejan de aceptar texto hasta hacer clic afuera. Después de cada uno se le devuelve el foco (`window.confirm`/`alert` se envuelven en `src/main.tsx` y le piden al proceso principal `blur()`+`focus()`).
- El cartel verde de "Venta registrada" ya no bloquea los clics de lo que tiene debajo (duraba 2 segundos tapando el centro de la pantalla).
- Una dirección `/api/...` que no existe contesta un mensaje en JSON (404) en vez de la página de la aplicación.

Quedó sin cambiar a propósito, para decidirlo con calma: cualquier empleada puede anular una venta o borrar un pago; no hay forma de recuperar un cliente que se sacó de la lista; los rubros y las marcas no se pueden renombrar ni borrar.

## Segunda revisión general (0.8.20)

Revisión con pruebas nuevas: un "mono" que arma y cobra cuentas apretando cosas al azar (`recorrido-mono-cuenta`: después de cada cobro revisa que el total, el stock, los fiados y el número de compra cierren), una auditoría de pantallas en 6 tamaños (de 360 px a 1920 px) con administradora y empleada, y una prueba de escala con el catálogo real (3.087 productos: la lista entera tarda ~0,3 s y cualquier búsqueda menos de 0,1 s).

- **Cobrar de nuevo después de un error no parte la compra en dos.** Si un cobro falla a mitad de camino (se cortó internet en el celular), lo ya cobrado queda registrado y lo que falta sigue en la cuenta; al volver a tocar "Cobrar" los productos que faltan llevan el **mismo número de compra** que los primeros (`ticketActual` en `ArmarCuenta.tsx`), así que el Panel y los Reportes la siguen contando como una sola compra.
- **Un cliente que ya no existe no se cobra.** La cuenta guardada puede traer un cliente que se sacó de la lista: ese renglón vuelve a pedir cliente. Y si la lista de clientes todavía no llegó, el renglón dice "Cargando cliente..." (antes el cuadro se veía vacío con "Cobrar" ya habilitado).
- **La lectora de códigos no se pierde.** Si el foco quedó en un botón o en un desplegable (se tocó la forma de pago), el primer número que "tipea" la lectora vuelve solo al buscador (`Armar cuenta`, sólo en la PC).
- **El Calendario de Ventas cuenta compras**, igual que el Panel y los Reportes: "3 ventas (7 productos)" en vez de contar cada producto como una venta.
- **"Lo más vendido" del asistente** ahora es el producto del que más unidades se vendieron (y aclara cuál fue el que más plata dejó, si es otro); antes contestaba el de más plata. El gráfico de Reportes dice que ordena por plata.
- **La cuenta de un cliente no muestra "Debe $0" si no pudo cargar** el historial (internet lento en el celular): se ve el saldo de la lista y un aviso para volver a abrirla.
- Los pedidos de datos que no manejaban el error (listas de rubros y marcas, el calendario, el buscador del mostrador, la sesión) ya no dejan errores sueltos ni pantallas a medias si la red falla.

## Próximos módulos

Proveedores/Compras — pendiente de implementar sobre esta misma base de datos.
