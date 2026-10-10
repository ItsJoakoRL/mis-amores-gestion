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

## Estructura

```
electron/           proceso principal de Electron (ventana, IPC, acceso a datos)
  db/                conexión a MongoDB, índices, seed inicial
  repositories/       consultas a cada colección (articulos, usuarios, catalogos, dashboard)
  ipc/handlers.ts     expone las operaciones al renderer vía IPC, con control de permisos
shared/              tipos y nombres de canal IPC compartidos entre electron y react
src/                 la app React (login, dashboard, módulo de artículos, usuarios)
build-assets/        ícono de la app
```

## Roles

- **admin** (la jefa): acceso total, incluyendo precio de costo, eliminar artículos y gestionar usuarios.
- **empleado**: puede cargar artículos y stock, pero no ve/edita precio de costo ni puede eliminar ni gestionar usuarios.

## Próximos módulos

Proveedores/Compras — pendiente de implementar sobre esta misma base de datos.
