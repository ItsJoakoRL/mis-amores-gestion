# Servidor en internet (opcional): el celular anda con todas las PCs apagadas

Hoy el celular usa la app que corre en una PC: si todas las PCs están apagadas,
el celular no puede entrar. Con un **servidor** prendido siempre en internet, el
celular entra a ese servidor y puede hacer todo lo de siempre (modificar
artículos, ajustar stock, anotar recordatorios, ver cuánto se vendió) aunque no
haya ninguna PC prendida.

El servidor es **una "PC" más de la red**: guarda todos los datos, se
sincroniza con tus PCs cuando están prendidas y atiende a los celulares. Es la
misma app, sin ventana.

```
   celular (datos o WiFi)  ──Tailscale──▶  SERVIDOR (siempre prendido)
                                              ▲
   PC del negocio  ───────────Tailscale───────┘   (se sincronizan cuando la PC está prendida)
```

Es **gratis** (plan gratuito de Oracle Cloud + plan gratuito de Tailscale).
Antes de empezar, tené en cuenta que:

- Tus datos del negocio quedan también en ese servidor (protegido: sólo se entra
  con Tailscale y con tus usuarios; el servidor no queda abierto a internet).
- Oracle pide una **tarjeta** para verificar la identidad. En el plan gratuito
  ("Always Free") no cobra.
- Es una cosa más para mantener: cuando salga una versión nueva de Mis Amores,
  el servidor hay que actualizarlo aparte (ver "Actualizar" abajo).
- Las fotos de los productos se siguen cargando desde la PC (desde el celular
  no se pueden elegir, como hoy).

---

## Parte A. En la PC del negocio (la que tiene los datos)

La PC tiene que estar **prendida, con Mis Amores abierto** durante la
instalación (el servidor le trae los datos una vez).

1. Instalá **Tailscale** (tailscale.com/download), iniciá sesión y dejalo
   conectado. Anotá la dirección de esta PC, que empieza con `100.` (se ve
   haciendo clic en el ícono de Tailscale, al lado del reloj).
2. Abrí una terminal en la carpeta del proyecto y corré (cambiando la dirección
   por la tuya):

   ```
   node scripts/preparar-servidor.js --direccion 100.64.1.2
   ```

   Deja el archivo `servidor-config/configuracion-pc.json`. **Tiene la clave de
   tu red**: no lo compartas con nadie ni lo subas a ningún lado.
3. Armá el paquete del servidor:

   ```
   npm run armar:servidor
   ```

   Deja `release/mis-amores-servidor-<versión>.tar.gz`.

## Parte B. Crear el servidor gratis en Oracle Cloud

(Los nombres de los menús pueden variar un poco: la idea es esta.)

1. Creá una cuenta en **cloud.oracle.com** (plan "Always Free").
2. Creá una máquina virtual (en *Compute → Instances → Create instance*):
   - **Imagen:** Ubuntu 22.04.
   - **Forma:** una de las "Always Free". La mejor es **Ampere A1** (VM.Standard.A1.Flex)
     con **1 OCPU y 6 GB de memoria**. Si no hay lugar, probá otra región o más
     tarde: es normal que a veces esté llena.
   - **Llave SSH:** dejá que Oracle genere una y **descargá la llave privada**
     (es el archivo con el que vas a entrar; guardalo bien).
3. Cuando esté lista, anotá su **IP pública**. El usuario para entrar es
   `ubuntu`.
4. **No abras ningún puerto** para la app: el acceso va por Tailscale.

## Parte C. Instalar en el servidor

Desde tu PC, subí los dos archivos al servidor (cambiá las rutas y la IP):

```
scp -i C:\ruta\a\la-llave.key release\mis-amores-servidor-0.7.1.tar.gz ubuntu@IP_PUBLICA:~
scp -i C:\ruta\a\la-llave.key servidor-config\configuracion-pc.json ubuntu@IP_PUBLICA:~
```

Entrá al servidor y seguí los pasos de a uno:

```
ssh -i C:\ruta\a\la-llave.key ubuntu@IP_PUBLICA
```

**1. Node.js** (hace falta la versión 20.18 o más nueva):

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. MongoDB** (la base de datos):

```
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/8.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
```

(Si algún paso falla, seguí la guía oficial "Install MongoDB Community on
Ubuntu" de mongodb.com.)

**3. Tailscale** (con la misma cuenta que en la PC):

```
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Te muestra un link: abrilo en tu PC e iniciá sesión. Después probá que ve a tu
PC: `tailscale ping 100.64.1.2` (la dirección de tu PC).

**4. La app:**

```
sudo mkdir -p /opt/mis-amores /var/lib/mis-amores
sudo chown ubuntu:ubuntu /opt/mis-amores /var/lib/mis-amores
tar -xzf ~/mis-amores-servidor-0.7.1.tar.gz -C /opt/mis-amores
cd /opt/mis-amores && npm ci --omit=dev
mv ~/configuracion-pc.json /var/lib/mis-amores/
chmod 600 /var/lib/mis-amores/configuracion-pc.json
```

**5. Que arranque solo y se reinicie si falla:**

```
sudo tee /etc/systemd/system/mis-amores.service > /dev/null <<'EOF'
[Unit]
Description=Mis Amores (servidor)
After=network-online.target mongod.service tailscaled.service
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/opt/mis-amores
Environment=MIS_AMORES_CARPETA_DATOS=/var/lib/mis-amores
ExecStart=/usr/bin/node dist-electron/electron/servidor.js
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now mis-amores
```

**6. Ver que anda:**

```
journalctl -u mis-amores -n 30 --no-pager
```

Tendría que mostrar que "se trajeron los datos de ..." (nombre de tu PC). La
primera vez tarda un momento según cuántos productos tengas.

Y **borrá el archivo de la clave de tu PC** (la carpeta `servidor-config`),
porque ya no hace falta.

## Parte D. Usarlo desde el celular

1. En el celular, instalá **Tailscale** e iniciá sesión con la misma cuenta.
2. Averiguá la dirección del servidor (en el servidor: `tailscale ip -4`).
3. En el navegador del celular abrí `http://100.x.x.x:4000` (la del servidor) y
   entrá con tu usuario de siempre. Guardalo como acceso directo.

En la pantalla **Configuración** de tu PC, el servidor aparece en la lista de
PCs de la red, "En línea" cuando está sincronizando.

---

## Actualizar el servidor

Cuando salga una versión nueva de Mis Amores, en tu PC:

```
npm run armar:servidor
scp -i C:\ruta\a\la-llave.key release\mis-amores-servidor-<versión>.tar.gz ubuntu@IP_PUBLICA:~
```

y en el servidor:

```
sudo systemctl stop mis-amores
tar -xzf ~/mis-amores-servidor-<versión>.tar.gz -C /opt/mis-amores
cd /opt/mis-amores && npm ci --omit=dev
sudo systemctl start mis-amores
```

Los datos no se tocan: viven en MongoDB y en `/var/lib/mis-amores`.

## Si algo no anda

- **Ver qué pasa:** `journalctl -u mis-amores -n 50 --no-pager`
- **"Todavía no se pudieron traer los datos":** la primera vez la PC tiene que
  estar prendida, con Mis Amores abierto y Tailscale conectado. El servicio lo
  vuelve a intentar solo cada 30 segundos.
- **El celular no conecta aunque Tailscale diga conectado:** el firewall de la
  imagen de Oracle puede estar frenando. En el servidor:
  `sudo iptables -I INPUT -i tailscale0 -j ACCEPT` y después
  `sudo netfilter-persistent save`.
- **Reiniciar la app:** `sudo systemctl restart mis-amores`
- **Respaldos:** el servidor guarda copias en `/var/lib/mis-amores/respaldos`,
  y tus PCs tienen cada una una copia completa de los datos.

## Para quien desarrolla

- El servidor es `electron/servidor.ts`: carga la misma app (`main.ts`) con un
  módulo `electron` que no hace nada (`electron/electronFalso.ts`) y
  `MIS_AMORES_MODO_SERVIDOR=1`, que apaga la ventana, la bandeja, las
  actualizaciones automáticas y el aviso `misamores.local`.
- Variables útiles: `MIS_AMORES_CARPETA_DATOS` (dónde guarda todo),
  `MIS_AMORES_PUERTO` (por defecto 4000), `MONGODB_URI` y `MONGODB_DB_NAME`.
- Si la primera sincronización no encuentra a la otra PC, termina con el código
  3 para que el servicio lo reintente.
- Prueba: `npm run build:electron` y `npm run probar:servidor` (usa bases
  `test_srv_*`, no toca la real).
