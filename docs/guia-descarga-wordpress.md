# Guía: descarga de WordPress (imágenes y base)

Fase 7, etapa 0. Se escribió el 30/10/2026. **Fecha límite: 28/11/2026**, cuando vence el plan de Hostinger: lo que no se baje antes se pierde. La migración se hace otro día; esto no puede esperar.

Todo lo que se descarga queda **fuera del repositorio**, en `CMS-EVARISTO(ASSETS)`. **Las contraseñas no pasan por el chat ni se guardan en ningún documento**: se escriben en la terminal cuando las pide.

## Qué se baja

| Qué | Tamaño aprox. | Para qué |
|---|---|---|
| `wp-content/uploads`, sin los nombres que chocan | ~7,9 GB, ~10.900 archivos | Los originales de las imágenes que va a buscar la migración. |
| `colisiones.tar` | unos pocos MB | Los 78 archivos que Windows no puede guardar en una misma carpeta (ver «Las dos trampas»). Se guarda tal cual, sin extraer. |
| `colisiones.txt` y `lista-servidor.tsv` | KB | Qué se apartó y qué había en el servidor, para verificar. |
| `wordpress.sql` | ~150 MB | El dump nuevo de la base (el de este 5/10 tenía 152 MB). |

Espacio: el disco `C:` tiene ~250 GB libres (30/10/2026); sobra. Se necesitan unos 10 GB para la descarga y otros tantos para el segundo respaldo.

## Antes de empezar: preguntas abiertas (resolver primero)

**Estado al 30/10/2026: sin responder.** Son lo primero que hay que cerrar al retomar; sin estas respuestas no se puede empezar a bajar. Anotá cada respuesta acá mismo, con la fecha.

1. ☐ **¿El plan de Hostinger se renueva, y tenés acceso a hPanel?** ¿Quién es el dueño del plan? Si no se renueva, esta descarga es la última oportunidad y hay que hacerla **antes del 28/11/2026**.
   - Respuesta: _______________
2. ☐ **¿Instalamos WinSCP o usamos `scp`?** Este equipo tiene `ssh`, `scp` y `sftp` (OpenSSH), pero **no tiene `rsync` ni WinSCP**. WinSCP (gratis) **reanuda** una descarga cortada sin volver a bajar lo ya bajado; `scp` no reanuda. Instalar software es decisión tuya.
   - Respuesta: _______________
3. ☐ **¿Dónde va el segundo respaldo?** Otro disco físico o un servicio. El hosting desaparece el 28/11 y la descarga pasa a ser la única copia, así que tiene que haber dos. (El disco `C:` tiene ~250 GB libres, el espacio de la descarga no es problema; la pregunta es la copia en *otro* lugar.)
   - Respuesta: _______________

Además, al conectarte por primera vez hay que confirmar con hPanel (no son preguntas para mí, son datos que se leen ahí):

- **Acceso SSH habilitado** (en Hostinger suele estar en «Avanzado → Acceso SSH»; el puerto habitual es **65002**, confirmalo ahí). Anotá usuario, dirección y puerto. **La contraseña no se anota en ningún documento ni se pasa por el chat.** Sin SSH se puede igual, con más pasos (ver «Si no hay SSH»).

Carpeta de destino sugerida (se crea una por descarga):

```
C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-MM-DD\
    uploads\            (los originales)
    colisiones.tar
    colisiones.txt
    lista-servidor.tsv
    wordpress.sql
```

## Las dos trampas (por qué los pasos son como son)

1. **Los nombres con tildes se alteran** si se usan herramientas que no manejan bien Unicode. El `tar` de Windows ya lo hizo. Por eso **no se arma un `.tar` de todo para extraerlo en Windows**: se baja carpeta a carpeta con WinSCP o `scp`, y se verifica nombre por nombre al final.
2. **En WordPress hay nombres que solo difieren en las mayúsculas** (`TAPA.jpg` y `tapa.jpg` son dos adjuntos distintos). Linux los distingue; Windows no: en una carpeta de Windows **uno pisaría al otro y se perdería sin avisar**. Son **39 grupos (78 archivos)**; además hay 6 grupos que difieren en una tilde (`Perón.jpg` / `peron.jpg`), que en Windows conviven bien. Medido con la base del 5/10/2026 y con `npm run verificar:descarga`.

   La solución: en el servidor se **aparta** a esos 78 en un `colisiones.tar` (que no se extrae en Windows) y se baja el resto sin ellos. Nada se pierde.

   **Esto además es un problema del CMS, que hay que resolver antes de la migración** (etapa 1 del plan): `imagenes.clave` es única y su colación (`utf8mb4_es_0900_ai_ci`) no distingue mayúsculas ni tildes; los 45 grupos chocarían. No se arregla en la descarga: acá solo se guarda todo sin perder nada.

## Paso 1: conectarse al servidor

En PowerShell (los datos son los de hPanel; `<...>` se reemplaza):

```powershell
ssh -p 65002 <usuario>@<dirección>
```

La primera vez pregunta si confiás en el servidor: respondé `yes`. Pide la contraseña (no se ve al escribirla). Todo lo que sigue, hasta el paso 4, se escribe **dentro de esa sesión** (la terminal del servidor, Linux).

## Paso 2: ubicar y medir las imágenes

```bash
find ~ -maxdepth 6 -type d -name uploads 2>/dev/null     # suele ser ~/domains/<dominio>/public_html/wp-content/uploads
cd <la ruta que apareció>
find . -type f | wc -l       # cuántos archivos: esperá unos 10.975 (algo más si hay derivadas sueltas)
du -sb . | cut -f1           # cuántos bytes en total: unos 7,9 GB
```

Anotá los dos números. Si no se parecen a los de arriba, **detenete y preguntá**: puede ser otra carpeta o que el sitio haya cambiado desde el 5/10.

## Paso 3: preparar la descarga en el servidor

Una carpeta de trabajo `~/descarga` (la única que se crea en el servidor, y la única que se borra al final). Los comandos se corren **desde la carpeta `uploads`**:

```bash
mkdir -p ~/descarga
cd <ruta de uploads>

# 3a. Todo lo que hay, con su tamaño: la referencia para verificar
find . -type f -printf '%s\t%P\n' | LC_ALL=C sort > ~/descarga/lista-completa.tsv

# 3b. Los nombres que solo difieren en las mayúsculas (los dos de cada par)
cut -f2 ~/descarga/lista-completa.tsv | sort -f | uniq -iD > ~/descarga/colisiones.txt
wc -l ~/descarga/colisiones.txt      # esperá unos 78

# 3c. Esos archivos, juntos y apartados
tar -cf ~/descarga/colisiones.tar -T ~/descarga/colisiones.txt

# 3d. El resto, en una carpeta de trabajo: copia con enlaces duros (no ocupa espacio) sin los apartados
cp -al . ~/descarga/uploads-sin-colisiones
cd ~/descarga/uploads-sin-colisiones && while IFS= read -r f; do rm -- "$f"; done < ~/descarga/colisiones.txt
```

- El `rm` de 3d borra **solo dentro de `uploads-sin-colisiones`**, que son enlaces duros a los originales: los originales de `uploads` no se tocan. El `&&` hace que no corra si el `cd` falla. Aun así, **no lo corras desde otra carpeta**.
- Si `cp -al` da `Invalid cross-device link`, la carpeta de trabajo está en otro disco del servidor: usá `cp -a` (ocupa ~8 GB de tu cuota) o poné `~/descarga` dentro del mismo directorio que `uploads`.

```bash
# 3e. Controles
find ~/descarga/uploads-sin-colisiones -type f | wc -l        # = (total del paso 2) - (líneas de colisiones.txt)
cd ~/descarga/uploads-sin-colisiones
find . -type f -printf '%s\t%P\n' | LC_ALL=C sort > ~/descarga/lista-servidor.tsv
sha256sum ~/descarga/colisiones.tar        # anotá el resultado
```

## Paso 4: exportar la base

Dos caminos; elegí el que ya hayas usado (el del 5/10 fue por phpMyAdmin).

**A. phpMyAdmin (hPanel → Bases de datos):** elegí la base (`u728005081_evaristo`), «Exportar», método **personalizado**, formato **SQL**, conjunto de caracteres **utf8mb4**, y guardá el archivo.

**B. Por SSH:** el usuario y el nombre de la base están en `wp-config.php` (`DB_USER`, `DB_NAME`); **no abras ni muestres la contraseña**, `mysqldump` la pide.

```bash
mysqldump --single-transaction --no-tablespaces --default-character-set=utf8mb4 --user=<DB_USER> --password <DB_NAME> > ~/descarga/wordpress.sql
sha256sum ~/descarga/wordpress.sql      # anotá el resultado
ls -l ~/descarga/wordpress.sql          # tiene que pesar del orden de 150 MB
```

Ahora salí de la sesión: `exit`.

## Paso 5: descargar

Creá la carpeta de destino (la de arriba, con la fecha de hoy) y bajá **de `~/descarga`**: `uploads-sin-colisiones`, `colisiones.tar`, `colisiones.txt`, `lista-servidor.tsv` y `wordpress.sql`. La carpeta `uploads-sin-colisiones` se guarda localmente como **`uploads`**.

**Con WinSCP (recomendado).** Protocolo SFTP, el mismo servidor, puerto y usuario. En las preferencias de transferencia, que **no modifique los nombres de archivo**. Sincronizá en dirección «remoto → local». Es **reanudable**: si se corta, se vuelve a correr y baja solo lo que falta o cambió. Desde la línea de comandos de WinSCP (`winscp.com` está en la carpeta donde se instaló WinSCP; si no está en el PATH, se escribe la ruta completa):

```powershell
winscp.com /command "open sftp://<usuario>@<dirección>:65002/" "synchronize local ""C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-MM-DD\uploads"" /home/<usuario>/descarga/uploads-sin-colisiones" "exit"
```

**Con `scp` (ya instalado, no reanuda).** Si se corta, hay que repetir; lo ya bajado se vuelve a bajar.

```powershell
scp -r -P 65002 <usuario>@<dirección>:descarga/uploads-sin-colisiones "C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-MM-DD\"
```

Eso crea `uploads-sin-colisiones` dentro de esa carpeta: renombrala a `uploads`. Para los archivos sueltos: `scp -P 65002 <usuario>@<dirección>:descarga/colisiones.tar <destino>` (igual para los otros cuatro).

Tiempo estimado: 8 GB a 50 Mbps son unos 25 minutos; a 10 Mbps, más de 1 hora. Dejalo corriendo.

## Paso 6: verificar

**6a. Los dos archivos sueltos** (comparar con lo anotado en el servidor):

```powershell
Get-FileHash -Algorithm SHA256 "<carpeta>\colisiones.tar", "<carpeta>\wordpress.sql"
```

Tienen que ser **idénticos** a los `sha256sum` del servidor. Si no, se bajaron mal: repetí esa descarga.

**6b. Las imágenes contra la lista del servidor** (no necesita la base; detecta descargas cortadas y nombres alterados):

```powershell
npm run verificar:descarga -- --uploads="<carpeta>\uploads" --lista-servidor="<carpeta>\lista-servidor.tsv" --sin-base
```

Tiene que decir `OK`: 0 faltantes, 0 nombres alterados, 0 tamaños distintos, 0 sobrantes. Cualquier otra cosa: mirá la lista y repetí la descarga (con WinSCP basta con volver a sincronizar).

**6c. Las imágenes contra la base de WordPress** (lo que la migración va a buscar). Primero hay que cargar el dump nuevo **en una base aparte** en la 3307 (levantala vos, ver `glosario-comandos-bases.md`; **no reemplaces `evaristo_lectura`**: los tests y la migración de la muestra dependen de ella):

```powershell
$mariadb = "C:\Users\marea\Documents\Proyectos Frontend\CMS-EVARISTO(ASSETS)\mariadb-local\mariadb-11.8.9-winx64\bin\mariadb.exe"
& $mariadb --host=127.0.0.1 --port=3307 --user=root --execute="CREATE DATABASE evaristo_lectura_nueva CHARACTER SET utf8mb4"
& $mariadb --host=127.0.0.1 --port=3307 --user=root --default-character-set=utf8mb4 --database=evaristo_lectura_nueva --execute="source <carpeta con barras>/wordpress.sql"
```

(Antes mirá que el dump no traiga `USE` ni `CREATE DATABASE`: `Select-String -Path "<carpeta>\wordpress.sql" -Pattern '^(USE|CREATE DATABASE)' -List`. Si los trae, avisame.) Después:

```powershell
npm run verificar:descarga -- --uploads="<carpeta>\uploads" --lista-servidor="<carpeta>\lista-servidor.tsv" --apartados="<carpeta>\colisiones.txt" --base=evaristo_lectura_nueva
```

**Resultado esperado:** `Apartados a propósito: 78`, 0 nombres alterados, 0 tamaños cero y 0 tamaños distintos. Pueden aparecer «sobrantes» que son **derivadas** (miniaturas que genera WordPress; el relevamiento contó 10.975 archivos y 10.975 adjuntos, así que debería haber pocas o ninguna) o archivos sueltos que ninguna fila de la base pide: se anotan, no son un error. Pueden seguir apareciendo como faltantes `escanear0006.jpg` y `mankell.jpg` si ya no están en el servidor (ya faltaban en la muestra). Cualquier otro faltante: avisame con la lista.

El informe completo queda en `packages/compartido/out/descarga/` (ignorado por git).

## Paso 7: respaldar y limpiar

1. **Copiá toda la carpeta `wordpress-AAAA-MM-DD` al segundo lugar** y verificá allí los mismos `Get-FileHash` del paso 6a.
2. Recién con las dos copias verificadas: en el servidor, borrá **solo** la carpeta de trabajo. **Nunca toques `uploads` ni nada de WordPress** (el sitio sigue en línea hasta el 28/11):

```bash
ssh -p 65002 <usuario>@<dirección>
rm -rf ~/descarga
```

3. Anotá en `pendientes.md` la fecha de la descarga y los resultados de 6a, 6b y 6c.

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| `Permission denied` al conectar | Usuario, puerto o contraseña equivocados; en hPanel, revisá que el SSH esté habilitado. |
| `cp: ... Invalid cross-device link` | Ver el paso 3d. |
| El paso 6b da `TAMAÑO DISTINTO` | La descarga se cortó a mitad de un archivo: volver a sincronizar con WinSCP, o repetir `scp`. |
| El paso 6b da `NOMBRE ALTERADO` | Una herramienta cambió el nombre: bajá ese archivo suelto (`scp` o WinSCP) y repetí. Si pasa con muchos, no uses esa herramienta. |
| El paso 6c da `NO SON DE ESTA BASE` | `colisiones.txt` es de otra descarga o el dump es de otra fecha. Los dos tienen que ser del mismo día. |
| Tiene muchos `FALTANTES` y la lista del servidor da `OK` | El dump y la carpeta no son de la misma fecha, o se subieron archivos nuevos entre uno y otro: repetí el paso 4 para tener los dos juntos. |
| No hay SSH | En hPanel, el Administrador de archivos permite comprimir una carpeta; bajá en varios `.zip` (por tandas de unos 1.000 archivos, por ejemplo) y verificá los nombres con el paso 6b. Los `.zip` de Windows también pueden alterar tildes: la verificación lo dice. |

## Qué sigue después

La descarga solo deja los datos en su lugar. Lo que sigue (etapa 1 del plan, `plan-proximos-pasos.md`) incluye **resolver los 45 grupos de nombres que chocan en el CMS** antes de migrar: renombrarlos al importar guardando la correspondencia, o cambiar la colación de `imagenes.clave`. Los 78 archivos de `colisiones.tar` son la materia prima de esa decisión.
