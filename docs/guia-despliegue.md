# Guía de despliegue en un VPS

Se escribió el 11/11/2026, antes de elegir proveedor: sirve para cualquier VPS con **Ubuntu 24.04**. Los archivos que se nombran están en `despliegue/`. Requisitos del servidor: `estado-fase7.md`, «Lo que falta para el lanzamiento», punto 1.

**Qué está probado y qué no.** En la Lenovo (11/11/2026, contra `evaristo_cms_dev`) se probaron el respaldo y la rotación (`respaldar.sh`), la prueba de restauración (`probar-restauracion.sh`: restaura bien y detecta una diferencia), el manifiesto de las imágenes y que la app arranca con `node --import tsx` (sin abrir puertos). El servicio, Caddy, MySQL en Ubuntu y el orden completo de los pasos **se prueban recién en el servidor**: al seguir la guía la primera vez, anotar acá lo que haya que corregir.

## Cómo queda armado

```
internet ──443──> Caddy (HTTPS, Let's Encrypt) ──> Node 127.0.0.1:3000 (sitio, panel y API, servicio «evaristo»)
                                                         │
                                                         └──> MySQL 8.4 en 127.0.0.1:3308 (base evaristo_cms)
```

| Ruta en el servidor | Qué hay | Dueño |
|---|---|---|
| `/srv/evaristo/app` | El repo (clonado de GitHub), compilado. El `.env` va en la raíz. | `evaristo` |
| `/srv/evaristo/datos/originales` | Los originales de las imágenes (`wordpress-2026-10-31\originales` de la Lenovo, ~2,3 GB). Solo lectura para la app. | `evaristo` |
| `/srv/evaristo/datos/subidas` | Lo que se sube desde el panel. | `evaristo` |
| `/srv/evaristo/datos/variantes` | Caché de las imágenes achicadas (se puede borrar; se regenera). | `evaristo` |
| `/var/backups/evaristo` | Respaldos diarios de la base y de las subidas (14 días). | `root` |
| `/etc/evaristo/respaldo.cnf` | Credenciales de MySQL del respaldo (permisos 600). | `root` |

**MySQL en el 3308 y no en el 3306:** las herramientas y las pruebas del repo exigen `127.0.0.1:3308` (las guardas de la migración, `test:humo`, `test:media-originales`), así que en el servidor funcionan igual que en la Lenovo. Y con la base en la misma máquina, Prisma vuelve solo después de un reinicio (decisión 91).

**Tres usuarios de MySQL** (`despliegue/usuarios-mysql.sql`): `evaristo_app` (la app: solo datos), `evaristo` (la carga inicial y las migraciones: estructura) y `evaristo_respaldo` (leer y probar la restauración). Si alguien entrara a la app, no podría borrar ni cambiar tablas.

En los comandos, `admin` es tu usuario con sudo en el servidor e `IP` su dirección.

## 1. Primer ingreso y seguridad básica

1. Entrar con lo que dé el proveedor (en general `ssh root@IP`, con la clave SSH que se cargó al crear el VPS).
2. Crear tu usuario y darle sudo y tu clave SSH:
   ```bash
   adduser admin
   usermod -aG sudo admin
   rsync --archive --chown=admin:admin ~/.ssh /home/admin
   ```
3. Desde otra terminal, comprobar que `ssh admin@IP` entra y que `sudo -v` funciona. **Recién ahí**, en `/etc/ssh/sshd_config` (o un archivo en `/etc/ssh/sshd_config.d/`): `PermitRootLogin no` y `PasswordAuthentication no`; después `sudo systemctl restart ssh`.
4. Cortafuegos: solo SSH, HTTP y HTTPS.
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443
   sudo ufw enable
   ```
5. Hora de Argentina (los respaldos corren de madrugada) y actualizaciones:
   ```bash
   sudo timedatectl set-timezone America/Argentina/Buenos_Aires
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git curl unattended-upgrades
   ```
   Ubuntu 24.04 trae activadas las actualizaciones de seguridad automáticas (`unattended-upgrades`); comprobarlo con `systemctl status unattended-upgrades`.

## 2. Node 24

La misma versión mayor que la Lenovo (Node 24; `engines` pide 22.12 o más). Con el repositorio de NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh          # mirarlo antes de correrlo
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version && npm --version
```

## 3. El usuario `evaristo`, las carpetas y el código

```bash
sudo adduser --system --group --home /srv/evaristo --shell /usr/sbin/nologin evaristo
sudo mkdir -p /srv/evaristo/datos/{originales,subidas,variantes}
sudo chown -R evaristo:evaristo /srv/evaristo
```

El repo es privado: el servidor lo clona con una **clave de despliegue de solo lectura** (GitHub → el repo → Settings → Deploy keys):

```bash
sudo -u evaristo mkdir -p -m 700 /srv/evaristo/.ssh
sudo -u evaristo -H ssh-keygen -t ed25519 -N "" -f /srv/evaristo/.ssh/id_ed25519 -C "servidor evaristo"
sudo cat /srv/evaristo/.ssh/id_ed25519.pub     # pegarla en Deploy keys, sin «Allow write access»
sudo -u evaristo -H git clone git@github.com:<usuario>/<repo>.git /srv/evaristo/app
```

Instalar y compilar (con las dependencias de desarrollo: el servidor usa `tsx` y Prisma las necesita para generar el cliente):

```bash
cd /srv/evaristo/app
sudo -u evaristo -H npm ci
sudo -u evaristo -H npm run db:generate
sudo -u evaristo -H npm run build
sudo chmod +x despliegue/*.sh
```

`npm ci` avisa que no corrió los scripts de instalación de `@prisma/engines`, `esbuild` y `prisma` («install scripts not yet covered by allowScripts»): **es lo esperado**, en la Lenovo pasa lo mismo y todo funciona sin ellos.

## 4. MySQL 8.4

Ubuntu 24.04 trae MySQL 8.0 en sus paquetes; la 8.4 (la de la Lenovo) viene del repositorio de Oracle:

1. Bajar el paquete de configuración del repositorio desde https://dev.mysql.com/downloads/repo/apt/ (`mysql-apt-config_…_all.deb`), instalarlo con `sudo dpkg -i mysql-apt-config_*.deb` y, en el menú, elegir **mysql-8.4-lts**.
2. `sudo apt update && sudo apt install -y mysql-server`. Pide una clave para `root` de MySQL: una larga, guardada en tu gestor de claves.
3. `mysql --version` tiene que decir 8.4.
4. La configuración del proyecto (solo la misma máquina, puerto 3308, utf8mb4, intercalación española):
   ```bash
   sudo cp /srv/evaristo/app/despliegue/mysql-evaristo.cnf /etc/mysql/mysql.conf.d/evaristo.cnf
   sudo systemctl restart mysql
   sudo ss -ltnp | grep mysqld        # tiene que escuchar solo en 127.0.0.1:3308
   ```
5. La base y los usuarios: hacer una copia de `despliegue/usuarios-mysql.sql`, reemplazar las tres claves (por ejemplo, cada una con `openssl rand -hex 24`: solo letras y números, así no hay que codificarlas en la URL del `.env`), correrla y borrar la copia:
   ```bash
   cp /srv/evaristo/app/despliegue/usuarios-mysql.sql /tmp/usuarios.sql && chmod 600 /tmp/usuarios.sql && nano /tmp/usuarios.sql
   mysql --host=127.0.0.1 --port=3308 --user=root --password < /tmp/usuarios.sql
   shred -u /tmp/usuarios.sql
   ```
   Guardar las tres claves en tu gestor de claves: `CLAVE_APP` va en el `.env` (paso 5), `CLAVE_RESPALDO` en `/etc/evaristo/respaldo.cnf` (paso 9) y `CLAVE_ESQUEMA` se usa solo a mano (pasos 6 y 10).

## 5. El `.env` del servidor

```bash
sudo -u evaristo cp /srv/evaristo/app/despliegue/env-produccion.ejemplo /srv/evaristo/app/.env
sudo chmod 600 /srv/evaristo/app/.env
sudo -u evaristo nano /srv/evaristo/app/.env
```

Completar `CLAVE_APP` en `DATABASE_URL` y, cuando estén, los datos del SMTP (`SMTP_*`, `CONTACTO_DESTINO`, `CORREO_REMITENTE`; ver el README). Sin `SMTP_HOST`, el formulario de contacto responde «No pudimos enviar el mensaje» (en producción no hay envío a la consola). **Una configuración del SMTP a medias impide arrancar el servicio**, con un mensaje que dice qué falta.

## 6. Los datos: la base y las imágenes

**La base.** En la Lenovo, en PowerShell (pide la clave de `evaristo` del `.env` de la Lenovo; usar `--result-file`, no `>`):

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe" --host=127.0.0.1 --port=3308 --user=evaristo --password --single-transaction --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 --result-file="C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\respaldos\evaristo_cms-para-servidor.sql" evaristo_cms
scp "C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\respaldos\evaristo_cms-para-servidor.sql" admin@IP:/tmp/
```

En el servidor (pide `CLAVE_ESQUEMA`):

```bash
mysql --host=127.0.0.1 --port=3308 --user=evaristo --password --default-character-set=utf8mb4 evaristo_cms < /tmp/evaristo_cms-para-servidor.sql
cd /srv/evaristo/app && sudo -u evaristo -H npm run db:estado        # «Database schema is up to date!»
mysql --host=127.0.0.1 --port=3308 --user=evaristo --password -e "SELECT estado, COUNT(*) FROM evaristo_cms.articulos GROUP BY estado"
rm /tmp/evaristo_cms-para-servidor.sql
```

Tiene que dar 2.637 publicados y 17 borradores (más lo que se haya cargado en la Lenovo después del 11/11/2026).

Si `db:estado` dice que hay migraciones sin aplicar (una creada después del volcado), aplicarlas ahora con `db:deploy` y el usuario de estructura, como en el paso 10.

**Las imágenes.** En la Lenovo, primero el manifiesto (huellas SHA-256 de cada archivo) y después la carpeta:

```powershell
cd "C:\Users\marea\Documents\Proyectos Frontend\evaristo-cultural-cms"
$O = "C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\originales"
node despliegue\manifiesto.mjs $O "$env:TEMP\originales.sha256"
scp "$env:TEMP\originales.sha256" admin@IP:/tmp/
scp -r $O admin@IP:/tmp/originales
```

En el servidor:

```bash
sudo cp -a /tmp/originales/. /srv/evaristo/datos/originales/
sudo chown -R evaristo:evaristo /srv/evaristo/datos/originales
cd /srv/evaristo/datos/originales && sha256sum --check --quiet /tmp/originales.sha256 && echo "Imágenes: todas iguales"
sudo rm -rf /tmp/originales /tmp/originales.sha256
```

Si `sha256sum` nombra algún archivo, volver a copiar ese (los nombres con tildes son los más delicados). **No** usar el `tar` de Windows para pasarlas: altera los nombres con tildes.

## 7. El servicio

```bash
sudo cp /srv/evaristo/app/despliegue/evaristo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evaristo
systemctl status evaristo                       # «active (running)»
curl -s http://127.0.0.1:3000/api/salud         # {"estado":"ok",...}
journalctl -u evaristo -n 50                    # el registro, si algo falla
```

**Probarlo antes de tocar el DNS**, desde la Lenovo, con un túnel SSH (el sitio todavía no está en internet):

```powershell
ssh -L 3000:127.0.0.1:3000 admin@IP
```

y con esa terminal abierta, abrir http://127.0.0.1:3000 en el navegador: la portada, algunas notas viejas con imágenes, `/contacto/`, `/admin/`.

**Pruebas del repo, en el servidor** (solo leen la base; tardan unos minutos):

```bash
cd /srv/evaristo/app
sudo -u evaristo -H npm run test:humo -- --originales=/srv/evaristo/datos/originales
sudo -u evaristo -H npm run test:articulos -- --originales=/srv/evaristo/datos/originales
```

## 8. Caddy, HTTPS y el dominio

1. Instalar Caddy desde su repositorio oficial (instrucciones en https://caddyserver.com/docs/install, «Debian, Ubuntu, Raspbian»).
2. `sudo cp /srv/evaristo/app/despliegue/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
3. **El DNS:** unos días antes, bajar el TTL de los registros del dominio (por ejemplo a 300 s). El día del cambio, apuntar `evaristocultural.com.ar` y `www` (registros A, y AAAA si el VPS tiene IPv6) a la IP del servidor. Apenas el DNS llega, Caddy pide el certificado solo (`journalctl -u caddy -f` muestra cuando lo obtiene).
4. Comprobar `https://evaristocultural.com.ar` y que `http://` y `www` redirigen ahí.

Lo que sigue al cambio de DNS (revisión final, seguimiento de los 404, `tareas-con-el-sitio-corriendo.md`) está en `estado-fase7.md`, puntos 8 y siguientes.

## 9. Respaldos

**Qué se respalda y dónde:**

| Qué | Cómo | Dónde | Cuánto se guarda |
|---|---|---|---|
| La base | `respaldar.sh`, todos los días a las 4:15, y al principio de cada actualización | `/var/backups/evaristo/base` | 14 días |
| Las imágenes subidas desde el panel | Ídem (`.tar.gz`) | `/var/backups/evaristo/subidas` | 14 días |
| Que el respaldo de la base se puede restaurar | `probar-restauracion.sh`, después de cada respaldo diario: lo carga en `evaristo_cms_restauracion`, compara tabla por tabla y la borra | — | — |
| Los originales migrados | No cambian: ya tienen tres copias fuera del servidor (Lenovo, `backup2` y el `.tar` de WordPress en Drive) | — | — |
| Todo el servidor | **Snapshots del proveedor** (requisito del hosting), automáticos | En el proveedor | Según el plan |

**Instalarlos:**

```bash
sudo mkdir -p /etc/evaristo && sudo chmod 700 /etc/evaristo
sudo tee /etc/evaristo/respaldo.cnf > /dev/null <<'EOF'
[client]
user=evaristo_respaldo
password=CLAVE_RESPALDO
host=127.0.0.1
port=3308
EOF
sudo chmod 600 /etc/evaristo/respaldo.cnf
sudo nano /etc/evaristo/respaldo.cnf            # poner la clave real
sudo cp /srv/evaristo/app/despliegue/evaristo-respaldo.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evaristo-respaldo.timer
sudo systemctl start evaristo-respaldo          # la primera vez, a mano
journalctl -u evaristo-respaldo -n 20           # tiene que terminar en «Restauración probada: … tablas iguales»
systemctl list-timers evaristo-respaldo         # cuándo corre la próxima
```

**Copia fuera del servidor:** los respaldos diarios están en el mismo disco que la base; si se pierde el servidor, se pierden con él. Además de los snapshots del proveedor, **una vez por semana** (o al menos por mes) bajar a la Lenovo el último respaldo de la base y de las subidas, y copiarlos a `backup2`. Los respaldos son solo de root: `preparar-descarga.sh` deja una copia de los dos últimos en tu carpeta y después se bajan con `scp`:

```powershell
ssh -t admin@IP "sudo /srv/evaristo/app/despliegue/preparar-descarga.sh"
scp "admin@IP:respaldos-para-bajar/*" "C:UsersmareaDocumentsProyectos FrontendCMS-EVARISTO(ASSETS)espaldosservidor\"
ssh admin@IP "rm -rf respaldos-para-bajar"
```

**Volver a un respaldo** (si se rompió algo en la base):

```bash
sudo systemctl stop evaristo
mysql --host=127.0.0.1 --port=3308 --user=evaristo --password -e "DROP DATABASE evaristo_cms; CREATE DATABASE evaristo_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci"
gzip -dc /var/backups/evaristo/base/evaristo_cms-<fecha>.sql.gz | mysql --host=127.0.0.1 --port=3308 --user=evaristo --password --default-character-set=utf8mb4 evaristo_cms
sudo systemctl start evaristo
```

(`DROP DATABASE` necesita que `evaristo` tenga permiso sobre la base, que lo tiene; los permisos de `evaristo_app` y `evaristo_respaldo` sobreviven porque están dados por nombre de base.) Las subidas: `sudo tar -xzf /var/backups/evaristo/subidas/subidas-<fecha>.tar.gz -C /srv/evaristo/datos/subidas`.

**Si se pierde el servidor entero:** un VPS nuevo, esta guía de nuevo, con el último respaldo de la base (en lugar del volcado de la Lenovo del paso 6), el último `.tar.gz` de subidas y los originales de la Lenovo.

## 10. Actualizar el sitio

Cada vez que haya cambios en `main` (después del push):

```bash
sudo /srv/evaristo/app/despliegue/actualizar.sh
```

Respalda la base, trae los cambios, instala las dependencias, compila, reinicia y comprueba que el sitio responda. **Si hay migraciones de Prisma nuevas, se corta antes de reiniciar** (el sitio sigue con la versión anterior). Para aplicarlas, con el respaldo que el script acaba de hacer y la aprobación correspondiente:

```bash
cd /srv/evaristo/app
read -rs -p "Clave de evaristo (CLAVE_ESQUEMA): " C && echo
sudo -u evaristo -H env DATABASE_URL="mysql://evaristo:$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$C")@127.0.0.1:3308/evaristo_cms" npm run db:deploy
unset C
sudo /srv/evaristo/app/despliegue/actualizar.sh      # ahora sí sigue hasta el final
```

(`db:deploy` usa la URL que se le pasa en el entorno: el `.env` no se toca y la app sigue con el usuario sin permisos de estructura.)

## 11. Primer administrador del panel

```bash
cd /srv/evaristo/app
sudo -u evaristo -H npm run usuario:crear -- --base-real --email=<correo> --nombre="<Nombre>" --rol=ADMINISTRADOR
```

Pide la contraseña por teclado. Después, desde el panel, los usuarios de la editorial.

## Problemas comunes

- **El servicio no arranca:** `journalctl -u evaristo -n 50`. Lo más común: una variable del `.env` (por ejemplo, el SMTP a medias), las carpetas `subidas` o `variantes` que no existen (systemd no lo deja arrancar sin ellas) o el sitio sin compilar (`npm run build`).
- **«pool timeout» o el sitio sin datos después de reiniciar MySQL:** no debería pasar (decisión 91). Revisar que `DATABASE_URL` apunte a `127.0.0.1:3308`.
- **Caddy no consigue el certificado:** el DNS todavía no apunta a la IP, o los puertos 80 y 443 están cerrados (en `ufw` o en el cortafuegos del proveedor). `journalctl -u caddy -n 50`.
- **El respaldo falla:** `journalctl -u evaristo-respaldo -n 30`. Si la prueba de restauración dice que hay tablas distintas, puede ser que alguien estuviera editando en ese momento: correr `sudo systemctl start evaristo-respaldo` de nuevo.
- **Disco:** `df -h`. La caché de variantes se puede borrar entera (`sudo rm -rf /srv/evaristo/datos/variantes/*`); se regenera sola.
