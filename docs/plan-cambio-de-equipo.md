# Plan: pasar el trabajo a otro equipo

**Documento temporal.** Se escribió el 30/10/2026 con un inventario real de este equipo (Samsung Galaxy Book 3, Windows 11 Home). **El cambio se hace la semana del 2/11/2026.** **Borrarlo** (con `git rm`, sacando su fila del índice de `CLAUDE.md`) cuando el cambio esté hecho y verificado.

**Regla de oro:** este equipo **no se toca ni se vende** hasta que el equipo nuevo haya pasado la verificación de la Fase C **y** haya dos copias verificadas de lo que no está en git. Hasta entonces, este equipo es la fuente de verdad.

## 1. Decisiones y datos (30/10/2026)

**Resuelto**

- **Equipo nuevo:** Intel Core i5-12450HX (8 núcleos, 12 hilos), 24 GB de RAM DDR5, SSD NVMe de 512 GB, NVIDIA GeForce RTX 4050, pantalla de 15,6" a 144 Hz, **Windows 11 Home**. Sobra para el proyecto (no usa la GPU). El disco de 512 GB alcanza: hacen falta ~10 GB para traer lo de acá y ~10 GB para la descarga de WordPress.
- **Cuándo:** el cambio se hace **la semana del 2/11/2026**. Todo lo que sigue del proyecto (incluida la descarga de WordPress) se continúa **en el equipo nuevo**.
- **Orden con la descarga de WordPress:** primero el cambio de equipo y **después la descarga, directo en el equipo nuevo** (sección 8). Hay margen: el plazo es el 28/11.
- **Nombre del usuario de Windows en el equipo nuevo (Lenovo 83GS):** es `marea`, y la carpeta es `C:\Users\marea\Documents\Proyectos Frontend` (con F mayúscula). No es `Usuario`, así que hay que cambiar las rutas de la sección 10.

**Hecho en el equipo nuevo (30/10/2026)**

- `npm ci`, `db:generate`, `astro sync`, `typecheck` y `build`, sin errores. El Control Inteligente de Aplicaciones está activo y no bloquea Astro.
- MySQL **8.4.13** instalado (puerto 3308, servicio `MySQL84`, inicio manual, `lower_case_table_names=1`), sin bases ni usuarios del proyecto todavía. Se usa 8.4.13 en vez de 8.4.11 porque es la misma línea LTS. **Ojo al instalar:** la página de descargas ofrece por defecto una versión más nueva (26.10), que no sirve: hay que elegir la 8.4 LTS. El nombre del servicio no indica la versión.
- Fases A y B completas: el pendrive `backup2` y la copia en la Lenovo coinciden con el manifiesto (18.994 y 18.760 archivos; la diferencia es `_claude`, que no se copia entero). Bases, usuarios con claves nuevas, `.env` y dumps listos. De `_claude` se copió solo la memoria: el `settings.json` era del proyecto `ecommerce-epica` y los `skills\synced` los sincroniza la cuenta.
- Fase C: puntos 1 a 11 en verde (todas las suites, 200 nombres en `verificar:descarga`, y Mariano vio el sitio y entró al panel en el navegador). La prueba T20 de `test:migracion-db` fallaba desde el 30/10 porque no conocía `verificar-descarga.ts`, que es de solo lectura; se corrigió la prueba. Faltan los puntos 12 (el push) y 13 (abrir una sesión nueva de Claude Code y ver que carga la memoria).
- Las 3 rutas absolutas del código ya son relativas al repo. Los documentos que se siguen usando tienen las rutas nuevas; los dos `.cmd` de `CMS-EVARISTO(ASSETS)` (`iniciar-mariadb.cmd` y `fase-b-bases.cmd`) se abren con doble clic. `iniciar-mariadb.cmd` queda para el uso diario; `fase-b-bases.cmd` y `fase-b-bases.ps1` ya se usaron y no hay que repetirlos.
- **Sigue pendiente antes de la Fase D:** comprobar el otro pendrive con el manifiesto y borrar el dump sin cifrar `u728005081_evaristo.sql` de los dos pendrives al terminar.

**Pendiente (se resuelve al llegar al equipo nuevo)**

1. **Con qué se mueven los datos:** un **disco externo** (~1 GB). Ojo: este equipo y el nuevo son **Windows 11 Home**, que **no puede crear unidades BitLocker To Go** (solo desbloquearlas). Como el paquete lleva el dump de WordPress con datos personales, hay que protegerlo de otra forma: comprimir el dump con **7-Zip y clave (AES-256)** o usar **VeraCrypt**. Instalar cualquiera es decisión tuya. Alternativa sin instalar nada: llevar el dump por cable de red o por una unidad que no se preste a nadie, y borrarlo del disco externo al terminar.

## 2. Qué hay en este equipo y cómo se lleva

**Lo que ya está seguro en GitHub** (no hay nada que copiar): el código, las migraciones de Prisma, `README.md`, `CLAUDE.md`, `docs/`, `.env.example` y los otros repos de la carpeta. Verificar que no quede nada sin subir (Fase A, paso 1).

**Lo que NO está en git y se pierde si no se lleva:**

| Qué | Dónde | Tamaño | Cómo se lleva |
|---|---|---|---|
| Dump de WordPress del 5/10/2026 (`u728005081_evaristo.sql`). **Datos personales** (usuarios y hashes de contraseña) | `CMS-EVARISTO(ASSETS)\` | 146 MB | Copiar. Sensible: solo por disco cifrado. |
| MariaDB 11.8.9 portable con `evaristo_lectura` cargada (puerto 3307) | `CMS-EVARISTO(ASSETS)\mariadb-local\` | 761 MB (datos 373, binarios 297, `.zip` 93) | Apagar con `shutdown` y copiar **entera**. |
| 200 originales de la muestra y sus derivadas (`MEDIA_DIR`, tests y `--originales`) | `CMS-EVARISTO(ASSETS)\uploads-muestra\` | 49 MB | Copiar. |
| Imágenes subidas desde el panel en desarrollo (`MEDIA_DIR_SUBIDAS`) | `CMS-EVARISTO(ASSETS)\uploads-dev\` | 144 KB | Copiar (regenerable). |
| Respaldos de la base real | `CMS-EVARISTO(ASSETS)\respaldos\` | 52 KB | Copiar. |
| Vistas previas, logos y archivo del conversor | `CMS-EVARISTO(ASSETS)\previews-fase3`, `*.svg`, `conversor-wp-a-tiptap*` | ~2 MB | Copiar (baja prioridad; los SVG también están en el repo). |
| Salidas de la migración, baselines, informes y el **registro del cambio manual del 21/10** en la base real (`out\verif\bio-autor60-antes.json`) | `packages\compartido\out\` | 23 MB | Copiar. Ese JSON es el único registro del valor anterior. |
| Corpus de las 2.637 notas (`posts.json`); hoy ningún script lo regenera | `packages\compartido\posts.json` | 29 MB | Copiar. |
| Base real `evaristo_cms` (35 artículos y la bio corregida) | MySQL 8.4, puerto 3308 | 4 MB | `mysqldump --result-file` y restaurar. |
| Base de desarrollo `evaristo_cms_dev` (el usuario del panel y la configuración del sitio) | MySQL 8.4, puerto 3308 | 4 MB | `mysqldump --result-file` y restaurar. |
| `evaristo_cms_test` y `evaristo_cms_shadow` | MySQL 8.4 | — | **No se llevan:** se recrean vacías (los tests vacían la de pruebas; la shadow la usa Prisma). |
| Usuarios de MySQL (`evaristo`, `evaristo_migracion`) y sus claves | MySQL 8.4 | — | **No se llevan:** se recrean con **claves nuevas**. |
| `.env` | raíz del repo | — | **No se copia:** se rehace desde `.env.example` con rutas y claves nuevas. |
| Memoria de Claude Code (`MEMORY.md` y `preferencia-react-router.md`) y configuración global (`settings.json`, `skills\`) | `C:\Users\Usuario\.claude\` | KB | Copiar. **No copiar `.credentials.json`**: se vuelve a iniciar sesión. |
| Clave SSH de este equipo (`~\.ssh\id_ed25519`) | `C:\Users\Usuario\.ssh\` | — | **No copiar la clave privada:** se genera una nueva y se revoca la vieja. |

**Carpetas de `Proyectos frontend` que no son repositorios y se perderían** (no son de este proyecto, pero se van con el equipo): `Evaristo-autores` (un `index.html`), `Informes programacion` (guías y notas), `EpicaTurismo-MySQL` (un `.sql` y datos de MySQL), y los archivos sueltos `package-lock.json` y `tdb2.txt` de la raíz.

**Repos con cambios sin subir** (todos los demás están limpios y al día con `origin`): `Demo-estudio-katok` (`package-lock.json` modificado) y `tintayraices-landing` (`img/hero__mobile.png` sin versionar). **Hay que commitear y subir, o copiar, antes de entregar.**

**Bases de otros proyectos:** hay un servicio `MySQL80` detenido (de otros proyectos). No lo inspeccioné. Antes de borrar el equipo, ver si tiene bases que importen y exportarlas.

## 3. Versiones a instalar (las de este equipo)

| Programa | Versión | Notas |
|---|---|---|
| Git for Windows | 2.53.0 | Instalación por defecto (incluye el administrador de credenciales). Mantener `core.autocrlf=true`, como acá. |
| Node.js | **24.x** (acá, 24.14.0; `.nvmrc` dice `24`; `engines` pide `>=22.12`) | npm 11.9.0 viene con Node. |
| MySQL Server | **8.4.11** (en el equipo nuevo quedó 8.4.13, misma línea LTS) | Puerto **3308**, servicio **`MySQL84`**, inicio manual. Dejar `lower_case_table_names=1` (es el valor de Windows y **no se puede cambiar después** de inicializar). |
| MariaDB | 11.8.9 portable (se copia con `mariadb-local\`) | Puerto 3307, solo para leer WordPress. |
| Claude Code | la versión vigente | Iniciar sesión de nuevo. |
| WinSCP | cualquiera reciente | Para la descarga de WordPress (ver `guia-descarga-wordpress.md`). |
| MySQL Workbench | opcional | Las conexiones guardadas «Evaristo» y «Evaristo CMS (evaristo)» se recrean a mano (127.0.0.1:3308). |
| Python | no hace falta | Solo lo usé para scripts descartables; el proyecto no depende de él. |

## 4. Fase A: en este equipo (preparar y empacar)

1. **Que no quede nada sin subir.** En `evaristo-cultural-cms` y en `testing-tiptap`: `git status -sb` tiene que decir `main...origin/main` (o `integracion-conversor...origin/integracion-conversor`) **sin «ahead» ni cambios**. Después, `Demo-estudio-katok` y `tintayraices-landing` (ver la sección 2).
2. **Dumps de las dos bases** (con `--result-file`, nunca con `>` de PowerShell, que guarda en UTF-16). Pide la clave de `evaristo` por teclado:

   ```powershell
   $mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
   $paquete = "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\traslado-2026-MM-DD"
   New-Item -ItemType Directory -Force $paquete | Out-Null
   foreach ($b in 'evaristo_cms','evaristo_cms_dev') {
     & "$mysql\mysqldump.exe" --host=127.0.0.1 --port=3308 --user=evaristo --password --single-transaction --no-tablespaces --default-character-set=utf8mb4 --result-file="$paquete\$b.sql" $b
   }
   ```

3. **Apagar MariaDB (3307) de forma ordenada**, siempre con `shutdown` y nunca con `Stop-Process`:

   ```powershell
   & "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\mariadb-11.8.9-winx64\bin\mariadb-admin.exe" --host=127.0.0.1 --port=3307 --user=root shutdown
   ```

   Después, borrá `mariadb-local\mysqld.pid` (queda de la sesión anterior).
4. **Juntar todo en el disco externo**, conservando los nombres (con tildes y paréntesis): la carpeta `CMS-EVARISTO(ASSETS)` entera (incluye `mariadb-local`, los dumps y `traslado-…`), `packages\compartido\out\`, `packages\compartido\posts.json`, las tres carpetas sueltas de la sección 2 y los archivos de la raíz. Que el árbol del disco externo sea igual al de origen.
5. **Memoria y configuración de Claude Code:** copiar la carpeta `memory` de `C:\Users\Usuario\.claude\projects\C--Users-Usuario-Documents-Proyectos-frontend-evaristo-cultural-cms\` y, si existe, la de `...\C--Users-Usuario-Documents-Proyectos-frontend\` (`CLAUDE.md` dice que los prompts se pegan desde la carpeta padre), más `settings.json` y `skills\`. El historial de conversaciones (`projects\*\*.jsonl`, `history.jsonl`) es opcional. **No copiar `.credentials.json`.**
6. **Manifiesto de verificación** de lo que se copió (para comprobar en el equipo nuevo que llegó idéntico). En la carpeta raíz del disco externo:

   ```powershell
   Get-ChildItem -Recurse -File | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash)  $($_.FullName.Substring((Get-Location).Path.Length + 1))" } | Set-Content -Encoding utf8 manifiesto.sha256
   ```

7. **Anotar** (sin contraseñas): versiones de la sección 3, el usuario y los permisos de MySQL (`evaristo`: todo sobre las cuatro bases; `evaristo_migracion`: SELECT, INSERT, UPDATE y DELETE sobre `evaristo_cms` y `evaristo_cms_test`) y lo que tenga el `.env` (los nombres de variables: `DATABASE_URL`, `SHADOW_DATABASE_URL`, `DATABASE_URL_DEV`, `DATABASE_URL_MIGRACION`, `MEDIA_DIR`, `MEDIA_DIR_SUBIDAS`, `NODE_ENV`, `PORT`).

## 5. Fase B: en el equipo nuevo (instalar y restaurar)

1. **Windows al día**, usuario creado y, si es posible, **con el mismo nombre** (`Usuario`).
2. **Instalar** Git, Node 24, MySQL 8.4.11 (puerto 3308, servicio `MySQL84`, inicio manual; clave de `root` nueva) y Claude Code. Para Windows 11: revisar el **Control Inteligente de Aplicaciones** después de `npm ci` (README, «Windows 11: Control Inteligente de Aplicaciones»).
3. **Copiar y verificar el disco externo.** Poner `CMS-EVARISTO(ASSETS)`, `out\`, `posts.json` y las demás carpetas donde corresponden, y comprobar:

   ```powershell
   $ok = $true; Get-Content manifiesto.sha256 | ForEach-Object { $h,$ruta = $_ -split '  ',2; if ((Get-FileHash $ruta -Algorithm SHA256).Hash -ne $h) { "DIFIERE: $ruta"; $ok = $false } }; if ($ok) { "TODO IGUAL" }
   ```

   Disposición final (la estructura importa: `verificar-escritura` busca `CMS-EVARISTO(ASSETS)` **al lado** del repo):

   ```
   C:\Users\<usuario>\Documents\Proyectos frontend\
       evaristo-cultural-cms\        (clon)
       CMS-EVARISTO(ASSETS)\         (del disco externo)
       testing-tiptap\               (clon, archivo)
   ```

4. **Git y GitHub.** Configurar `user.name` y `user.email` como en este equipo (`git config --global user.name`, `user.email`). Clonar por HTTPS (los remotos son `https://github.com/mareanovazquez/...`); al primer `clone`/`push` el administrador de credenciales abre el navegador para iniciar sesión. No copiar claves ni tokens.
5. **Instalar dependencias:** en `evaristo-cultural-cms`, `npm ci`, `npm run db:generate` y, en `apps/sitio`, `npx astro sync`.
6. **Crear las bases y los usuarios** (README, «Crear las bases en MySQL» y «Recrear la base en otro equipo»; con un usuario administrador de MySQL, y claves nuevas). Las **cuatro** bases se crean con `utf8mb4_es_0900_ai_ci` **antes** de restaurar nada:

   ```sql
   CREATE DATABASE evaristo_cms         CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;
   CREATE DATABASE evaristo_cms_dev     CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;
   CREATE DATABASE evaristo_cms_test    CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;
   CREATE DATABASE evaristo_cms_shadow  CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;
   CREATE USER 'evaristo'@'localhost' IDENTIFIED BY '<clave nueva>';
   GRANT ALL PRIVILEGES ON evaristo_cms.*        TO 'evaristo'@'localhost';
   GRANT ALL PRIVILEGES ON evaristo_cms_dev.*    TO 'evaristo'@'localhost';
   GRANT ALL PRIVILEGES ON evaristo_cms_test.*   TO 'evaristo'@'localhost';
   GRANT ALL PRIVILEGES ON evaristo_cms_shadow.* TO 'evaristo'@'localhost';
   CREATE USER 'evaristo_migracion'@'localhost' IDENTIFIED BY '<otra clave nueva>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON evaristo_cms.*      TO 'evaristo_migracion'@'localhost';
   GRANT SELECT, INSERT, UPDATE, DELETE ON evaristo_cms_test.* TO 'evaristo_migracion'@'localhost';
   FLUSH PRIVILEGES;
   ```

7. **`.env`** a partir de `.env.example`, con las claves nuevas y las rutas absolutas del equipo nuevo en `MEDIA_DIR` (`...\uploads-muestra\originales`) y `MEDIA_DIR_SUBIDAS` (`...\uploads-dev`). `DATABASE_URL_MIGRACION` (que el ejemplo no trae) solo hace falta para `migrar:escribir` en la fase 7; definirla entonces.
8. **Restaurar los dumps** (el cliente `mysql.exe` está en `C:\Program Files\MySQL\MySQL Server 8.4\bin`, que no está en el PATH):

   ```powershell
   $mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
   & $mysql --host=127.0.0.1 --port=3308 --user=evaristo --password --default-character-set=utf8mb4 --database=evaristo_cms     --execute="source <carpeta con barras>/evaristo_cms.sql"
   & $mysql --host=127.0.0.1 --port=3308 --user=evaristo --password --default-character-set=utf8mb4 --database=evaristo_cms_dev --execute="source <carpeta con barras>/evaristo_cms_dev.sql"
   ```

   Los dumps traen `_prisma_migrations`, así que no hace falta `db:deploy`. Para `evaristo_cms_test`, `npm run db:deploy` con `DATABASE_URL` apuntando a ella solo por esa vez (como se hizo siempre; ver `glosario-comandos-bases.md`, «Migraciones y la base de desarrollo»). Después: `npm run db:verificar`.
9. **MariaDB:** levantar con el comando de `glosario-comandos-bases.md` (ajustando la ruta si el usuario cambió) y comprobar con `ping`.
10. **Claude Code:** iniciar sesión, abrir una sesión **una vez** en `evaristo-cultural-cms` (crea su carpeta en `~\.claude\projects\`), cerrarla y copiar ahí las carpetas `memory` y, en el nivel superior, `settings.json` y `skills\`. En la primera conversación: «Leé `CLAUDE.md`, `docs/plan-proximos-pasos.md` y `docs/plan-cambio-de-equipo.md` y corré la verificación de la Fase C».

## 6. Fase C: verificar (el criterio de «listo»)

Todo en el equipo nuevo. **Cada paso tiene que dar lo mismo que en este equipo.**

| # | Comprobación | Resultado esperado |
|---|---|---|
| 1 | `node -v` y `npm -v` | Node 24.x, npm 11.x |
| 2 | `git log -1` | El mismo commit que en este equipo |
| 3 | `Test-NetConnection 127.0.0.1 -Port 3308` y `-Port 3307` | `True` las dos |
| 4 | `npm run typecheck` | Sin errores |
| 5 | `npm run db:verificar` | Sin diferencias de intercalación |
| 6 | `npm run test:conversor`, `test:migracion`, `test:render`, `test:media`, `test:redirecciones` | Todas verdes (39 de taxonomía, 16 de verificar-descarga, etc.) |
| 7 | `npm run test:pantalla` | 92 pruebas ok |
| 8 | Las suites con base: `test:admin-articulos`, `test:admin-edicion`, `test:admin-clasificacion`, `test:admin-revision`, `test:portada`, `test:novedades`, `test:busqueda`, `test:editor` y las demás de `pendientes.md` | Verdes (con el sitio compilado: `npm run build:sitio`) |
| 9 | `npm run test:fase3` | Verde (necesita `MEDIA_DIR`) |
| 10 | Con la 3307 arriba: `npm run verificar:descarga -- --uploads="<...>\uploads-muestra\originales"` | Dice «un nombre que la migración reconoce: 200». Los demás figuran como faltantes y sale con 1: es lo esperable, la carpeta es solo la muestra. |
| 11 | `npm run build` y `npm run dev:desarrollo -w @evaristo/api`; abrir `http://127.0.0.1:3000/` y `/admin/` | El sitio con el menú nuevo; el panel deja ingresar con el usuario que ya existía en `evaristo_cms_dev` |
| 12 | Un commit real y su `git push` desde el equipo nuevo | Llega a GitHub |
| 13 | Claude Code abre el proyecto | Lee `CLAUDE.md` y carga la memoria (`MEMORY.md`) |

Con los 13 en verde, **trabajar uno o dos días normales en el equipo nuevo** antes de pasar a la Fase D. Si algo falla, este equipo sigue intacto.

## 7. Fase D: dejar este equipo listo para entregar

Solo cuando la Fase C esté completa **y** exista una copia del disco externo en un segundo lugar, verificada con el manifiesto:

1. **Revocar accesos** a nombre de este equipo: en GitHub, Configuración → Claves SSH y GPG (borrar la de este equipo) y Aplicaciones/credenciales autorizadas; salir de Hostinger y de cualquier sesión del navegador; cerrar sesión en Claude Code.
2. **Cambiar** las contraseñas que estuvieran guardadas en navegadores o gestores locales (GitHub, Hostinger, correo del proyecto).
3. **Borrar a mano lo sensible** (los datos de los usuarios de la revista no pueden quedar en un equipo ajeno): el dump `u728005081_evaristo.sql`, `mariadb-local\`, los `respaldos\` y `traslado-…`, el `.env`, la memoria y las credenciales de `.claude`, y los datos de otros clientes (`EpicaTurismo-MySQL` y las bases de `MySQL80`).
4. **Restablecer el equipo** de fábrica: Configuración → Sistema → Recuperación → «Restablecer este PC» → «Quitar todo» → **«Limpiar la unidad»**. Desvincular la cuenta Microsoft y la de Samsung del equipo antes de entregarlo.

## 8. Relación con la descarga de WordPress (28/11/2026)

La descarga (`guia-descarga-wordpress.md`) baja ~8 GB y **tiene fecha límite**. Hay dos órdenes posibles:

- **Si el cambio de equipo se puede completar con tiempo de sobra antes del 28/11:** primero el cambio (esta guía) y **después la descarga, directo en el equipo nuevo**. Así no se mueven ~8 GB dos veces.
- **Si la entrega de este equipo es antes, o el cambio se demora:** bajar primero en este equipo y sumar esa carpeta al disco externo (suma ~10 GB), o hacer el cambio cuanto antes y bajar en el nuevo. Lo que **no** conviene es entregar este equipo sin tener ya el nuevo andando y la descarga hecha: el plan de Hostinger vence el 28/11 y lo que no se baje se pierde.

## 9. Si el equipo nuevo no es Windows

No está cubierto al detalle. Cambia casi todo lo operativo: los comandos de PowerShell y las reglas de `CLAUDE.md` (que están escritas para Windows/PowerShell), MariaDB portable para Windows (habría que instalar MariaDB 11.8 con el paquete del sistema y reimportar el dump de WordPress), el servicio `MySQL84` y `lower_case_table_names` (en Linux el valor por defecto es 0; las tablas de Prisma van en minúscula, pero conviene probarlo), y las tres rutas absolutas del código (sección 10). Si es el caso, avisame y adapto el plan.

## 10. Riesgos y qué hacer

| Riesgo | Qué hacer |
|---|---|
| Datos personales de WordPress en el disco externo | Windows 11 Home no crea unidades BitLocker To Go: proteger el dump con 7-Zip (clave, AES-256) o VeraCrypt, y borrarlo del disco externo y de este equipo al final. |
| El usuario de Windows cambia y se rompen rutas | Hay **3 rutas absolutas en el código** (`scripts/render/vista-previa-35.ts`, y `scripts/migracion/corrida-en-seco.ts` en dos constantes), más `.env`, `glosario-comandos-bases.md`, `guia-descarga-wordpress.md` y la línea 12 de `CLAUDE.md`. Ver «Cosas de código» abajo. |
| MySQL con otra intercalación o `lower_case_table_names` | Crear las bases con `utf8mb4_es_0900_ai_ci` antes de restaurar; correr `db:verificar`; no tocar `lower_case_table_names`. |
| MariaDB no arranca tras copiar | Se apagó con `shutdown` y se borró `mysqld.pid`; si aun así falla, instalar el `.zip` (`mariadb-11.8.9-winx64.zip`, ya está en la carpeta) y reimportar el dump a una base `evaristo_lectura`. |
| Se pierde el cambio manual del 21/10 en la real | Está en el dump de `evaristo_cms` **y** en `out\verif\bio-autor60-antes.json`. |
| Control Inteligente de Aplicaciones bloquea Astro | Comprobarlo justo después de `npm ci` (README). |
| El dump de MariaDB (3307) y el de `uploads-muestra` quedan solo en el disco externo | Hacer **dos** copias verificadas con el manifiesto antes de la Fase D. |

**Cosas de código que conviene arreglar antes de mudarse** (opcional, chicas, las puedo hacer si me lo pedís): reemplazar las 3 rutas absolutas por rutas relativas al repo (como ya hace `verificar-escritura.ts`, que busca `CMS-EVARISTO(ASSETS)` junto al repo), y sumar `DATABASE_URL_MIGRACION` comentada al `.env.example`.
