# Servidor en internet con Render (gratis y sin tarjeta)

Con un servidor en internet, el celular puede **modificar artículos, ajustar
stock, anotar recordatorios y ver lo que se vendió aunque todas las PCs estén
apagadas**. Es la alternativa a `SERVIDOR.md` (Oracle) para quien no puede o no
quiere cargar una tarjeta.

```
   celular ───https───▶  SERVIDOR en Render  ◀───https───  PC del negocio
                              │                  (le manda lo suyo y
                              ▼                   recibe lo del celular)
                       MongoDB Atlas
                       (guarda los datos)
```

El servidor es **una "PC" más de la red**, pero con una diferencia: él no puede
llamar a tus PCs (están detrás del router). Son ellas las que lo llaman y le
mandan sus cambios. Por eso, para que algo cargado en la PC llegue al servidor,
**la PC tiene que estar prendida con Mis Amores abierto** (igual que hasta
ahora), pero para el celular ya no hace falta.

## Antes de empezar, tené en cuenta

- **Gratis.** Render, MongoDB Atlas y GitHub tienen planes gratuitos que no
  piden tarjeta (los planes cambian: si en algún paso te pide una, mirá bien
  qué estás eligiendo).
- **No se duerme (a propósito).** El plan gratuito de Render apaga el servidor
  si pasan 15 minutos sin visitas, y entonces el celular tardaría hasta 1 minuto
  en entrar. Para que ande 24 hs con todas las PCs apagadas hay dos "despertadores"
  que lo visitan solos: el propio servidor se visita cada 4 minutos por su
  dirección pública (`electron/despertador.ts`) y, por si alguna vez se cayera,
  GitHub lo visita cada 5 minutos (`.github/workflows/despertar-servidor.yml`,
  gratis porque el repositorio es público). Para comprobar que no se durmió:
  abrí `https://tu-servidor.onrender.com/api/sistema/info` y mirá
  `segundosEncendido`: si va creciendo día tras día, nunca se durmió (si se
  durmiera, vuelve a empezar de cero).
- **Las 750 horas gratis alcanzan para UN solo servicio prendido todo el mes.**
  Render da 750 horas por mes **por cuenta** (no por servicio) y un servicio que
  nunca se duerme gasta unas 744. Si en la misma cuenta de Render hay otros
  servicios gratuitos que también están prendidos, se pasan de las 750 y Render
  **suspende todos hasta el mes siguiente**. Mantené sólo Mis Amores prendido
  (los demás pueden dormirse) o usá otra cuenta de Render para los otros.
- **Está en internet.** Cualquiera que tenga el link ve la pantalla de entrada.
  Lo que protege tus datos son los **usuarios y contraseñas**: por eso la app
  **no te deja conectar** mientras alguna cuenta tenga una contraseña obvia
  (como `admin123`). Usá contraseñas largas, que no sean una palabra común.
- **Las fotos de los productos no se ven en el celular** cuando se usa este
  servidor (las PCs sí las siguen mostrando). Todo lo demás sí.
- **Respaldos.** El plan gratuito de Atlas no hace copias automáticas. Tus PCs
  tienen cada una una copia completa de los datos, que es el respaldo de
  verdad: no dejes de usar los respaldos de las PCs.
- Cuando salga una versión nueva de Mis Amores, el servidor se actualiza aparte
  (ver "Actualizar" al final).

---

## Parte A. En la PC del negocio

La PC tiene que tener Mis Amores **versión 0.8.0 o más nueva** (esa trae la
conexión con el servidor de internet).

1. **Cambiá las contraseñas fáciles.** En Mis Amores, entrá a *Usuarios* y
   ponele a cada cuenta una contraseña larga y que no sea obvia. Es lo único
   que separa tus datos de internet.
2. **Preparar la clave de la red.** Abrí una terminal en la carpeta del
   proyecto y corré:

   ```
   npm run preparar:nube
   ```

   Deja el archivo `servidor-config\variables-render.txt` con una línea
   `MIS_AMORES_CLAVE_RED=...`. **Esa clave es la llave de tu red**: no la
   compartas ni la subas a ningún lado. Es la que hace que el servidor
   reconozca a tus PCs.

## Parte B. La base de datos gratis (MongoDB Atlas)

(Los nombres de los menús pueden variar un poco: la idea es esta.)

1. Entrá a **cloud.mongodb.com** y creá una cuenta (sirve entrar con Google o
   GitHub).
2. Creá un cluster gratuito: **M0 (Free)**. En proveedor elegí **AWS** y la
   región **N. Virginia (us-east-1)**: tiene que ser la misma zona que el
   servidor de Render (parte D, "Virginia"). Entre sí se hablan en
   milisegundos; con regiones lejanas, la primera carga de datos tardaría
   horas. Ponele de nombre `mis-amores`.
3. En **Database Access**, creá un usuario de base de datos (por ejemplo
   `misamores`) con una contraseña **de letras y números** (sin símbolos, así
   no hay que codificarla). Rol: *Read and write to any database*. Anotá la
   contraseña.
4. En **Network Access**, agregá una dirección: **"Allow access from
   anywhere"** (`0.0.0.0/0`). Hace falta porque el Render gratuito no tiene una
   IP fija; la base igual pide usuario y contraseña.
5. En el cluster tocá **Connect → Drivers** y copiá la dirección que empieza
   con `mongodb+srv://...`. Cambiá `<password>` por la contraseña del paso 3.
   Esa dirección es tu `MONGODB_URI`.

## Parte C. Publicar el servidor para Render

Render no compila la app (el plan gratuito es muy justo): lee la app ya
compilada de una rama de tu repositorio de GitHub llamada `servidor-nube`.

En la terminal, en la carpeta del proyecto:

```
npm run publicar:nube
```

Compila la app (uno o dos minutos), arma la carpeta y la sube a la rama
`servidor-nube`. Necesita tener la sesión de GitHub abierta como cuando subís
cambios del proyecto. Si querés ver qué arma antes de subir:
`npm run publicar:nube -- --sin-subir` (la deja en `release\nube`).

La rama `servidor-nube` **no es el código**: es sólo la app compilada. Cada vez
que publicás se le agrega un cambio con la versión nueva.

## Parte D. Crear el servidor en Render

1. Entrá a **render.com** y creá una cuenta con tu GitHub.
2. Tocá **New + → Blueprint** y elegí el repositorio `mis-amores-gestion`.
   Cuando pida la rama, poné `servidor-nube`. Render lee el archivo
   `render.yaml` y arma todo solo.
3. Te pide dos valores secretos:
   - `MONGODB_URI`: la dirección de Atlas de la parte B.
   - `MIS_AMORES_CLAVE_RED`: el valor del archivo `variables-render.txt`.
4. Tocá **Apply** y esperá unos minutos a que diga **Live**. (La región tiene
   que quedar en **Virginia**, la misma que Atlas.)
5. Copiá la dirección que te da (algo como
   `https://mis-amores-xxxx.onrender.com`).

(Si preferís armarlo a mano: *New + → Web Service* → el repositorio → rama
`servidor-nube` → Build Command `npm ci --omit=dev` → Start Command
`node dist-electron/electron/servidor.js` → región **Virginia (US East)** →
 plan **Free** → y las variables
`MONGODB_URI`, `MIS_AMORES_CLAVE_RED`, `MONGODB_DB_NAME=mis_amores_gestion`,
`NODE_VERSION=22` y `TZ=America/Argentina/Buenos_Aires`.)

Probalo: abrí esa dirección en el navegador. Tiene que aparecer la pantalla de
entrada de Mis Amores. **Todavía no vas a poder entrar**: es normal, el
servidor arranca vacío y recibe los usuarios y los datos de la PC en el
siguiente paso.

## Parte E. Conectar la PC con el servidor

1. En la PC, abrí Mis Amores y andá a **Configuración**.
2. En la tarjeta **"Servidor en internet (para el celular)"**, pegá la
   dirección de Render y tocá **Conectar con el servidor**. Si el servidor
   estaba dormido puede tardar hasta un minuto.
3. Si te dice que cambies una contraseña, cambiala y volvé a probar.
4. Listo: la PC le va mandando todos los datos (productos, ventas, clientes,
   usuarios). Con unos pocos miles de productos tarda de segundos a unos
   minutos. En la misma pantalla ves **"Conectado"**.

Si tenés una segunda PC en el local, no hace falta hacer nada: se entera sola
del servidor a través de la primera.

## Parte F. Usarlo desde el celular

1. Abrí la dirección de Render en el navegador del celular.
2. Entrá escribiendo **tu usuario y tu contraseña** de siempre. (A diferencia
   del local, acá no hay una lista de cuentas para tocar: es a propósito, para
   no regalar los nombres de usuario a internet.)
3. Agregá la página a la pantalla de inicio para tenerla como una app.

---

## Actualizar el servidor

Cuando salga una versión nueva de Mis Amores, en la PC:

```
npm run publicar:nube
```

Render detecta la rama nueva y se actualiza solo (un par de minutos). Los datos
no se tocan: viven en Atlas.

## Si algo no anda

- **En Configuración dice "Sin conexión por ahora":** si hace rato que nadie lo
  usa, está despertando. Esperá un minuto. Si sigue, mirá los *Logs* del
  servicio en Render.
- **"El servidor contestó, pero no tiene la misma clave de red":** el valor de
  `MIS_AMORES_CLAVE_RED` en Render no es el de esta PC (o a alguna de las dos le
  falta la fecha y la hora bien puestas). Volvé a correr `npm run preparar:nube`
  y corregí la variable en *Environment* de Render. Ojo: si en algún momento
  usaste "Dejar de compartir datos con las otras PCs", la clave de la PC cambió.
- **El celular no te deja entrar y es la primera vez:** la PC todavía no le
  mandó los usuarios. Mirá que en Configuración diga **Conectado** y esperá un
  momento.
- **"Demasiados intentos":** el servidor frena las contraseñas equivocadas
  seguidas. Esperá un rato (hasta una hora) y probá de nuevo.
- **Atlas no conecta (en los Logs):** revisá que en *Network Access* esté
  `0.0.0.0/0` y que la contraseña de `MONGODB_URI` sea la correcta.
- **El celular tardó un minuto en entrar:** estaba dormido. Mirá que el
  servicio de Render esté en **Live** y que en la pestaña *Actions* del
  repositorio de GitHub el "Despertar el servidor de internet" esté corriendo
  (GitHub lo apaga solo si el repositorio pasa 60 días sin ningún cambio). Un
  tercer despertador, opcional y que además te avisa por mail si el servidor se
  cae: UptimeRobot (gratis), apuntando a
  `https://tu-servidor.onrender.com/api/sistema/info` cada 5 minutos.
- **Render dice que el servicio está "Suspended":** casi seguro se acabaron las
  750 horas gratis del mes (ver arriba). No se arregla despertándolo: hay que
  esperar al mes siguiente o pasar ese servicio a un plan pago.

## Para quien desarrolla

- Es el mismo código de siempre (`electron/servidor.ts`, `main.ts`) en "modo
  nube": se activa cuando existe `MIS_AMORES_CLAVE_RED` (ver `electron/nube.ts`).
- Variables: `MIS_AMORES_CLAVE_RED` (clave de la red; de ahí sale también el
  identificador del servidor, o se fija con `MIS_AMORES_ID_PC`), `MONGODB_URI`,
  `MONGODB_DB_NAME`, `PORT` (lo pone Render), `MIS_AMORES_MONGO_ESPERA_MS`, `TZ`.
- Qué cambia en modo nube: no guarda nada en disco (identidad por variables de
  entorno, sin respaldos locales), no crea el usuario `admin` de fábrica, no
  llama a nadie (sólo atiende), tiene límite de intentos al entrar
  (`electron/server/limiteIntentos.ts`) y cierra `/api/copia/*`,
  `/api/sistema/juntar-datos` y la lista de cuentas.
- La sincronización: una PC con una dirección completa (`https://...`) no se
  "pide", se le **empuja** (`POST /api/sync/empujar`, firmado con la clave
  incluyendo el contenido). Ver `empujar()` en `electron/sync/motor.ts`.
- Prueba: `npm run build:electron` y `npm run probar:nube` (usa bases
  `test_nube_*`, no toca la real).
