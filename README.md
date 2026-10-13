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

### Cómo funciona (electron/sync)

- **Diario de cambios** (`diario.ts`): cada escritura en una colección replicada (`modelo.ts`) queda anotada en `_sync_meta` con qué campos cambiaron y cuándo, con un número de secuencia local. `database.ts` engancha el diario a las escrituras.
- **Reloj híbrido** (`reloj.ts`): ordena los cambios aunque la hora de las PCs no coincida.
- **Motor** (`motor.ts`): cada PC mantiene con cada otra un pedido que espera (`GET /api/sync/cambios?desde=N`) y aplica lo que llega (`aplicar.ts`). Las PCs se encuentran por mDNS (`misamores.local`) y se reconocen con una clave de red (`X-Clave-Red`) que sólo tienen las que se sumaron con una cuenta de administradora.
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

## Próximos módulos

Proveedores/Compras — pendiente de implementar sobre esta misma base de datos.
