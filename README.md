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
```

## Estructura

```
electron/           proceso principal de Electron (ventana, IPC, acceso a datos)
  db/                conexión a MongoDB, índices, seed inicial
  repositories/       consultas a cada colección (articulos, usuarios, catalogos, dashboard)
  ipc/handlers.ts     expone las operaciones al renderer vía IPC, con control de permisos
  server/             servidor HTTP (celulares y otras PCs), sesiones, mDNS
  sync/               sincronización entre PCs (diario, reloj, motor, reglas, rutas)
shared/              tipos y nombres de canal IPC compartidos entre electron y react
src/                 la app React (login, dashboard, módulo de artículos, usuarios)
scripts/             herramientas (exportar/importar base, pruebas de sincronización)
build-assets/        ícono de la app
```

## Roles

- **admin** (la jefa): acceso total, incluyendo precio de costo, eliminar artículos y gestionar usuarios.
- **empleado**: puede cargar artículos y stock, pero no ve/edita precio de costo ni puede eliminar ni gestionar usuarios.

## Recordatorios

Pantalla común (en el menú, con el número de pendientes) para anotar lo que hay que hacer, cambiar, reponer o cobrar, con día opcional y marca de urgente, para que todas estén al tanto. Se anotan desde las PCs y los celulares, se sincronizan como el resto de los datos y queda registrado quién lo anotó y quién lo hizo. Cualquiera con sesión los ve y los marca; los borra quien los anotó o una administradora. Un recordatorio puede estar **atado a un producto o a un cliente**: en la lista tiene botones que llevan directo a ajustar su stock, editarlo, ver su cuenta o registrarle un pago (y al terminar pregunta si ya se puede marcar como hecho). También se puede anotar un recordatorio desde la fila de un producto o desde la cuenta de un cliente.

## Vender sin stock y contar el inventario

Muchos productos están cargados con un stock que no es el real (o en cero). Para poder usar el mostrador igual:

- **Vender sin stock registrado.** Una venta se registra aunque el sistema diga que no queda (avisa en la cuenta, no la frena): el stock queda en negativo y el producto pasa a **"Para revisar"** (filtro en Artículos y tarjeta en el Panel) hasta que se lo cuenta. Sólo las ventas pasan en negativo: un egreso o un ajuste manual sigue sin poder dejar el stock bajo cero, y el valor del inventario no resta los negativos. Se sincroniza como cualquier stock (`stockBase` + movimientos).
- **Código de barras desconocido en el mostrador.** Si se escanea un código (7 a 14 números) que no está cargado, pregunta **a qué producto es** (buscándolo por nombre, con los que no tienen código primero), se lo asigna para siempre y lo suma a la cuenta; o permite cargarlo como producto nuevo con ese código. No se adivina el producto por un parecido de números.
- **Contar inventario** (menú, también en el celular). Se elige un rubro (o "Para revisar", o todos), se cuenta escribiendo o escaneando (cada escaneo suma 1; los productos por peso se escriben en kg) y se ve la diferencia de cada uno. Recién al apretar **Corregir el stock** el sistema deja cada producto en lo contado (un ajuste que queda en su historial como "Conteo de inventario (figuraba N)"). Lo contado se guarda en el aparato: se puede dejar y seguir después. Contar el mismo producto desde dos aparatos a la vez suma los dos ajustes: que cuente una sola persona por rubro. Prueba: `npm run probar:inventario`.

## Estado de cuenta de los fiados (código QR)

En **Clientes**, cada cliente tiene un botón con un código QR (en la lista y en su cuenta). Abre un cuadro con lo que debe y el **QR**: al escanearlo con el celular baja un **PDF** con el estado de cuenta (lo que quedó anotado sin pagar, los pagos que hizo y el total), listo para mandárselo. Desde el mismo cuadro se puede **descargar el PDF**, **mandarlo por WhatsApp** (abre WhatsApp con el mensaje y el enlace ya escritos; se elige a quién) o **copiar el enlace**. Se ve igual en la PC y en el celular.

- **El enlace** (`/estado/<cliente>/<vence>/<firma>`, en `electron/estadoCuenta.ts`) se abre **sin usuario ni contraseña** (quien escanea no tiene cuenta), así que lo protege una firma: sale de la clave de la red del negocio, no se puede armar el enlace de otro cliente, la fecha de vencimiento va firmada (**30 días**) y un enlace malo, vencido o de un cliente que ya no está dice siempre lo mismo. Siempre muestra lo que debe **en ese momento** (no una foto). Lo atiende el servidor de internet (`URL_SERVIDOR_INTERNET`), igual que el celular: si estaba dormido, la primera vez tarda hasta 1 minuto.
- **Lo que cuenta:** lo anotado sin pagar (un fiado ya marcado como pagado no cuenta) + saldos iniciales y ajustes − pagos: el mismo saldo que muestra la lista.
- **El PDF** lo arma `electron/pdfSimple.ts`, un generador mínimo sin librerías (texto Helvetica y rectángulos, varias páginas, tildes y ñ), así que no suma peso al instalador ni al servidor. Quien reciba el enlace puede ver el nombre y las compras fiadas de ese cliente hasta que venza: conviene mandarlo sólo a la persona.
- Prueba: `npm run probar:estado-cuenta`.

## Próximos módulos

Proveedores/Compras — pendiente de implementar sobre esta misma base de datos.
