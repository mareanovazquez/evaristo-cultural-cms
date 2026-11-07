# Plan para retomar: fase 7 y lo que falta

**Documento temporal.** Se escribió el 23/10/2026 y se reescribió el 30/10/2026 al cerrar la reorganización de secciones, para arrancar sin releer todo. **Borrarlo** (con `git rm`, sacando su fila del índice de `CLAUDE.md`) cuando la fase 7 esté en marcha y lo duradero esté en `estado-fase7.md` (a crear) y en `pendientes.md`.

## Dónde quedamos (4/11/2026, pausa a mitad de la Etapa 1)

**Para retomar mañana, empezar por acá.** Todo lo de este día está commiteado en `main` (5 commits sin subir al empezar la pausa: `ceab152` a `0ac16df`, más el de esta nota si Mariano lo pide); **el push lo hace Mariano**.

**Hecho el 4/11/2026:**
- **Etapa 0b completa**, salvo quitar la clave SSH de la Lenovo de hPanel (Mariano). Originales extraídos con `npm run extraer:originales` a `CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\originales\` (11.174 archivos: 10.975 originales con la clave del CMS y 199 fotos de autor `avatar-<id>.<ext>`), más `mapa-originales.csv` y `mapa-avatares.csv`. Copia idéntica (comparada archivo por archivo con SHA-256) en `backup2` (`E:\Proyectos frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\`). El dump del 31/10 está cargado en `evaristo_lectura_nueva` (3307).
- **Decisiones nuevas de Mariano:** 79 (39 pares que comparten archivo: el de mayúscula usa su miniatura), 80 (fotos de autor desde los avatares, texto alternativo pendiente), 81 (claves de imagen que el CMS no distingue: una lleva `-wp<id>`), 82 (los 2 publicados sin título migran como «Artículo a titular <id>»; los borradores sin título quedan afuera) y 83 (variantes de tamaño a pedido en la API).
- **Novedades:** casilla «Es novedad» en el panel que propone 90 días (decisión 78 cerrada en el código).
- **Etapa 1, puntos 1, 2, 3b y 3 (salvo variantes) hechos:** `--todos`, `--wordpress`, `--mapa`, `--avatares`, colisiones en lote, BMP a PNG y orientación EXIF.
- **Simulación completa (solo lectura, 25 s), comando para repetirla:**
  `npm run migrar -w @evaristo/compartido -- --todos --wordpress=evaristo_lectura_nueva --originales=<...\originales> --mapa=<...\mapa-originales.csv> --avatares=<...\mapa-avatares.csv>`
  Resultado: 2.654 artículos (2.637 publicados y 17 borradores; 32 borradores afuera), 9.857 imágenes con fila, 0 faltantes, 0 sin medir, 194 autores con foto, 3.088 redirecciones. Único bloqueante, esperado: falta la sección `textos` en la real (modelo viejo; se resuelve en la Etapa 3).
- **Pruebas al cerrar:** `test:migracion` 132, `test:migracion-db` 44, `test:migracion-flujo` 7, `test:pantalla` 93, typecheck limpio.

**Lo que sigue (Mariano elige el orden):**
1. ✅ **Variantes de tamaño (decisión 83), hechas el 7/11/2026:** `/media/<clave>?w=N` con caché en `MEDIA_DIR_VARIANTES` y `srcset` en el sitio (detalle en la decisión 83). Falta agregar la variable al `.env` y mirarlo en el navegador.
2. ✅ **Etapa 1, punto 4, hecho el 7/11/2026 (decisión 84):** notas al pie (4265, 4633, 34 y 1974), enlaces internos como ruta del sitio, íconos del 5360 quitados y firmas «Por …» (2 quitadas, 11 con aviso).
3. ✅ **Etapa 1, punto 5, hecho el 7/11/2026 (decisión 85):** etiquetas al buscador, feed RSS nuevo en `/feed/`, `/?p=ID`, `/wp-content/uploads/` a `/media/`, páginas fijas, archivos por fecha y paginación.
4. Después: puntos 6 a 8 de la Etapa 1, el ensayo en una copia (Etapa 2; medir ahí cuánto tarda la escritura, que todavía consulta fila por fila) y la decisión de cómo convertir la real (Etapa 3).

**Antes de seguir:** levantar la 3307 (`CMS-EVARISTO(ASSETS)\iniciar-mariadb.cmd`) y la 3308 (`Start-Service MySQL84` en PowerShell como administrador) y comprobarlas con `Test-NetConnection`.

## Dónde quedamos (30/10/2026)

**Resuelto en estos días** (el detalle y las decisiones están en `plan-implementacion.md`, `historico/plan-reorganizacion-secciones.md` y `estado-fase4.md`):

- **Reorganización de secciones y categorías (decisión 78): hecha, mergeada a `main` y subida a `origin`** (`main...origin/main`, sin «ahead», al 30/10/2026). Aprobada por la editorial el 29/10. De 17 secciones a 8 (Entrevista, Reseña, Ensayo, Crónica, Crítica, Rastros, Asia y **Textos** como comodín) más `sin-asignar` interna; los 10 temas más Poesía rumana y el Encuentro son **categorías** y no repiten secciones; **Novedades** marca el artículo (`novedadHasta`) y `/novedades/` es el archivo. Menú: Novedades, Entrevista, Reseña, Ensayo y Crónica en el primer nivel; Crítica, Rastros, Asia, Textos y Autores en «Más» (`SECCIONES_VISIBLES` = 4). Textos no tiene bloque en la portada. Las 26 `/category/<slug>/` de WordPress redirigen con 301 (campo `destino` del mapeo). Resultado sobre las 2.637: Entrevista 469, Asia 414, Reseña 348, Rastros 245, Ensayo 81, Crónica 35, Crítica 0, **Textos 1.037**, `sin-asignar` 8.
- **`evaristo_cms_dev` convertida en el lugar** (con respaldo previo): 9 secciones, 12 categorías, 35 artículos (todos migrados; se borraron los 3 de prueba del panel). Conserva el usuario, la sesión y la configuración del sitio.
- **Pruebas:** todas verdes al 30/10 (conversor 39 de taxonomía, migración, las 27 suites contra la dev y `test:pantalla` 92). Se corrigieron `test-humo` (ya no fija 17 secciones), `test-novedades-base` (archivo y paginación) y `test-portada-base` (alt vacío).
- **Del 26/10:** footer fijo (decisión 75), topbar editable (76) y banner de la portada (77).

**Estado general**

- Fase 4 (panel y API) completa en el código; falta **la prueba con alguien de la editorial** (`guia-prueba-editorial.md`) y que Mariano recorra el panel en el navegador.
- Fase 5 (portada) y fase 6 (buscador y novedades): primera versión hecha y mergeada. **A la dueña le gustó la portada en líneas generales (30/10/2026);** faltan sus respuestas concretas y los textos reales (`estado-fase5.md`, `estado-fase6.md`).
- **La real (`evaristo_cms`) conserva el modelo viejo:** 17 secciones más `sin-asignar`, los 35 artículos con su sección vieja, 8 categorías viejas y **ninguna de las nueve migraciones** de la fase 4 en adelante. La dev y la de pruebas tienen todo.
- **El código de `main` ya espera el modelo nuevo.** Apuntado a la real, el menú mostraría las secciones viejas y varias `/category/…` irían a páginas que no existen (404). Hoy no hay despliegue (fase 1 sin hosting), así que no pasa nada; **no desplegar contra la real antes de convertirla** (ver Etapa 3).
- Migraciones que esperan para la real: `sesiones`, `borradores_y_capital`, `usuarios_redactor_creador_autor`, `secciones_orden`, `articulos_avisos_revisados`, `articulos_editado_publicado_por`, `busqueda_fulltext`, `configuracion_sitio` y `banner_portada` (nueve). Al aplicarlas hay que **borrar el respaldo** de `listarSeccionesMenu` en `apps/sitio/src/lib/secciones.ts`, el de `leerTopbar` en `apps/sitio/src/lib/sitio.ts` y el de `leerBanner` en `apps/sitio/src/lib/banner.ts`.
- Las bases 3307 y 3308 se levantan a mano; Claude Code no las arranca. Comprobar con `Test-NetConnection` antes de cada tarea.

## Lo que falta de la decisión 78

1. ✅ **El «90 días por defecto» de las novedades (hecho el 4/11/2026).** En el panel, una casilla «Es novedad»: al marcarla propone hoy + 90 días (fin del día, hora local), y la fecha se puede cambiar; al desmarcarla se vacía. La ayuda explica qué pasa al vencer y, si ya venció, que desmarcarla la saca también del archivo. Prueba en `test-pantalla` (93). **Confirmado con Mariano el 4/11/2026:** pueden convivir varias novedades, cada una vence en su fecha (una nueva no reemplaza a la anterior), cualquier artículo de cualquier sección puede ser novedad, y si no hay vigentes el bloque de la portada no se muestra (sin vencimiento automático alternativo).
2. **Convertir la real**: decidido el 7/11/2026 (decisión 87), va **dentro de la migración** (los 35 se reescriben con `--sobrescribir` y después una limpieza borra las secciones y categorías viejas vacías). La limpieza está hecha (7/11/2026): `--limpiar-taxonomia` en `migrar:escribir`, con vista previa en la simulación.
3. **A confirmar con la editorial:** el nombre «Asia» para lo que era Seda; la identidad de Crítica (distinta de Reseña; arranca vacía, se carga tras la revisión manual); que Textos admita cuentos nuevos (se habló en la reunión). Y que Mariano mire el menú nuevo en escritorio y celular: no se vio en un navegador.
4. ✅ **`run-corpus` arreglado el 7/11/2026:** lee WordPress en vivo (solo lectura; `npm run corpus -w @evaristo/compartido -- [salida]`, con la 3307 levantada), con los mismos artículos que la migración y el mapeo nuevo. Ya no usa `posts.json` ni los dos archivos de `out/`.
5. ✅ **`test-flujo` (F-g), arreglado el 7/11/2026:** un informe del mismo segundo que otro ya no lo pisa (`rutaLibre` agrega `-2`, `-3`…), en la simulación y en la escritura.
6. **Revisión manual posterior a la migración:** ~1.037 de Textos (96 son Novedades de WordPress con la novedad vencida, para encontrarlos) y 8 de `sin-asignar`. 261 artículos tenían más de una sección candidata y la perdedora se descartó (es el costo de «no repetir secciones como categorías»).

## Lo que falta de lo hecho antes (no es urgente, no bloquea la fase 7)

1. **Mirar en un navegador** (Claude Code no los arranca): el menú nuevo, el topbar y el banner en escritorio y celular, el popover del usuario y la portada completa. Para verlo con los datos nuevos: `npm run build:sitio` y `npm run dev:desarrollo -w @evaristo/api` (no `npm run dev`, que lee la real), en `http://127.0.0.1:3000/`.
2. **Contenido real de la editorial:** el texto del topbar y a dónde lleva (hoy, la tienda), y las primeras imágenes del banner (1800 × 600 px, JPEG, PNG o WebP de hasta 2 MB, con su texto y su enlace).
3. **Decisión abierta: «Quiénes somos» y «Contacto».** Hoy son enlaces vacíos del footer. ¿Páginas propias con texto (un mini editor de **páginas fijas**, que además sirve para las páginas fijas de WordPress que hay que redirigir o migrar; modelo `Pagina`, pantalla en el panel y ruta pública, medio día más), enlaces a otro sitio, o se sacan por ahora? Se plantea con Mariano de a una decisión.
4. **Preguntas abiertas para la dueña** sobre la portada (qué secciones van arriba, destacado a mano) y su comentario del «lavado»; en líneas generales le gustó. Ver `estado-fase5.md`.
5. **Prueba del panel con alguien de la editorial** (`guia-prueba-editorial.md`). La dev ya no tiene artículos de prueba propios: hay que crear los que haga falta.

## Al retomar (15 minutos)

0. **Leer primero «Dónde quedamos (4/11/2026)», arriba.** **El cambio de equipo y la descarga están hechos:** se trabaja en la Lenovo. **Etapa 0b: los originales están extraídos y verificados (4/11/2026); del paso 6 solo falta quitar la clave de la Lenovo de hPanel** (Mariano; la copia a `backup2` está hecha y verificada). El paso 7 también está hecho (decisión 80: fotos de autor). El Galaxy no se toca ni se vende hasta hacer la Fase D de `plan-cambio-de-equipo.md`.
1. `git status -sb`: tiene que decir `main...origin/main` sin «ahead» ni «behind».
2. `Test-NetConnection 127.0.0.1 -Port 3308` (siempre). El 3307 (WordPress) solo si se lee WordPress. Si están caídas, las levanta Mariano (`glosario-comandos-bases.md`).
3. `npm run build`, `npm run typecheck`, `npm run test:pantalla`, `npm run test:conversor` y `npm run test:migracion` para saber que arrancamos en verde.
4. **Lo que necesito de Mariano** (se puede traer en el chat, sin contraseñas):
   - Que quite la **clave SSH de la Lenovo de hPanel** (Etapa 0b, paso 6; la copia a `backup2` ya está verificada).
   - Si el titular confirmó que **renueva el plan de Hostinger** (si no, el sitio público puede quedar fuera de línea el 28/11/2026).
   - **Dónde se va a alojar** el sitio nuevo (hosting propio, en conversación con Roxana) y si ya hay un servicio de correo. **Las credenciales no pasan por el chat ni por un documento.**
   - Si ya miró el menú, el topbar y el banner en el navegador y qué ajustó.

## Orden sugerido

1. **Descarga de WordPress hecha el 31/10/2026 y definitiva** (paquete con todo `uploads` y base completa, verificados en la Lenovo y en `backup2`; ver `guia-descarga-wordpress.md`, «Descarga hecha»). Mariano confirmó el 31/10/2026 que no se va a publicar nada nuevo en WordPress, así que no hace falta repetirla ni volver a exportar antes de migrar. La clave de la Lenovo se quita de hPanel después de verificar los originales. Falta extraerlos del paquete y compararlos con la base. El 28/11/2026 ya no es un riesgo para los datos, pero si el plan de Hostinger no se renueva, el sitio público puede quedar fuera de línea.
2. **Extraer y verificar los originales** (Etapa 0b): **hecho el 4/11/2026**, la descarga alcanza para migrar (todos los adjuntos tienen archivo; 39 con su miniatura, decisión 79). Respaldados y verificados en `backup2` el mismo día.
3. ~~**El 90 días por defecto**~~: hecho el 4/11/2026; la reorganización de secciones queda cerrada en el código (falta convertir la real, Etapa 3).
4. **Fase 7, etapas 1 a 3:** adaptar el código, ensayar en una copia y hacer la migración real, en ese orden.
5. **Si hay tiempo o llegan los contenidos:** «Quiénes somos» y «Contacto» y lo que salga de mirar el sitio en el navegador.

---

## Fase 7 (migración completa y lanzamiento)

Lista completa en `plan-implementacion.md` (sección 10) y `pendientes.md` (sección 6). La migración **real** no empieza hasta tener el dump nuevo y los `uploads`; mientras, se avanza en lo que no depende de eso. **Mariano la hace otro día** (dicho el 30/10/2026): la descarga de la etapa 0 sigue teniendo fecha límite aunque la migración no.

### Etapa 0: descarga de WordPress (hecha el 31/10/2026)

- **Bajado y definitivo:** `uploads-completo.tar` (143.609 archivos, 7,54 GB) y `wordpress.sql` (50 tablas), en `CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\` y en `backup2`, con los SHA-256 comprobados. No se repite, porque no se publica nada nuevo en WordPress.
- **Detalle:** `docs/guia-descarga-wordpress.md`, sección «Descarga hecha el 31/10/2026».
- **Limpieza:** `~/descarga` ya se borró del servidor. La clave SSH de la Lenovo se quita de hPanel al terminar la Etapa 0b.

### Etapa 0b: extraer y verificar los originales (pasos 1 a 5 hechos el 4/11/2026)

**Por qué:** la migración busca cada imagen por su `_wp_attached_file`, pero en el paquete no todos los nombres coinciden. Cruce hecho el 31/10/2026 entre `lista-completa.tsv` y el dump, solo por nombre:

| Adjuntos | Qué pasa | Cómo se resuelve |
|---|---|---|
| 10.682 | El nombre coincide exacto | Se extrae tal cual. |
| 249 | El nombre en disco está en la codificación vieja CP850 (`rese¤a.jpg` es `reseña.jpg`) | Se decodifica y coincide. |
| 39 | **Pares que solo difieren en las mayúsculas: la base tiene los dos, pero en disco hay un solo archivo** | Ver paso 4. |
| 5 | El archivo tiene una cola en la extensión (`.jpg0`, `.png000`) | Se quita la cola. |
| **10.975** | **Total: todos tienen un archivo candidato** | Falta comprobar el contenido. |

**Corrige lo anterior:** no hay 78 archivos que choquen en una carpeta de Windows, sino 39 archivos que usan dos adjuntos cada uno. `escanear0006.jpg` y `mankell.jpg` no faltan: están como `Escanear0006.jpg` y `Mankell.jpg`. Los 132.208 archivos con forma de miniatura no se extraen: la migración no los usa y quedan en el paquete.

**Pasos (1 a 5 hechos el 4/11/2026; faltan el 6, que necesita a Mariano, y el 7):**

1. ✅ **Cargar el dump aparte.** `evaristo_lectura_nueva` en la 3307 (SHA-256 del dump comprobado; no trae `USE` ni `CREATE DATABASE`; carga en 20 s, sin errores): 50 tablas, 2.637 publicados, 48 borradores, 1 privado y 10.975 adjuntos con 10.975 claves distintas. `evaristo_lectura` no se tocó.
2. ✅ **Extractor:** `npm run extraer:originales -- --paquete=<tar> --base=evaristo_lectura_nueva [--destino=<carpeta>]` (`scripts/migracion/extraer-originales.ts` y `lib/extraer-originales.ts`; 14 pruebas en `test-extraer-originales.ts`, dentro de `test:migracion`). Sin dependencias nuevas. Lee el `.tar` en bytes (GNU con nombres largos `L`, pax y ustar; comprueba la suma de control de cada encabezado), y empareja en el orden exacto, CP850, cola y mayúsculas; dos candidatos en un nivel es error. Sin `--destino` solo informa. No pisa nada: las carpetas tienen que estar vacías y el mapa no tiene que existir. La lectura de los adjuntos pasó a `lib/adjuntos-wp.ts`, compartida con `verificar:descarga`.
3. ✅ **Extraído** a `CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\`: `originales\` (10.975 archivos, 2,53 GB, uno por adjunto, cada uno con su **clave del CMS**: la de `_wp_attached_file` salvo 45 renombrados con `-wp<id>`, decisión 81) y `mapa-originales.csv` (10.975 filas: id, clave, clave_cms, nombre en el paquete, coincidencia, con quién comparte, bytes y SHA-256). Se re-extrajo así el mismo 4/11 (la primera versión tenía las 39 miniaturas en una carpeta `reemplazos\` aparte). Cifras: 10.643 exactos, 249 CP850, 5 con cola, 39 dueños por mayúsculas y 39 miniaturas. Sin faltantes ni ambiguos.
4. ✅ **Los 39 pares: decisión 79** (`plan-implementacion.md`). En los 39 el archivo es del adjunto en minúscula (coinciden sus medidas); los de mayúscula usan su miniatura proporcional más grande, renombrada con `-wp<id>` (decisión 81).
5. ✅ **Verificado:** el mapa contra el disco: 10.975 archivos, todos con su tamaño y su SHA-256, sin sobrantes; y las 10.975 `clave_cms` son distintas con la colación real de `imagenes.clave`. (`verificar:descarga` compara con los nombres de WordPress, así que sobre esta carpeta marca los 45 renombrados: es esperado.) Medidas contra `_wp_attachment_metadata`: 10.901 coinciden; 39 son las miniaturas (más chicas, como se decidió); 25 no declaran medidas; 8 son BMP (uno, `cosecha-roja1.jpg`, es un BMP con extensión `.jpg`), que el medidor sin dependencias no lee; y 2 no son imágenes (un PDF y un DOCX). Esos 10 van a la Etapa 1, punto 3.
   - **Ojo al copiar:** hay archivos cuya ruta pasa de 260 caracteres (por ejemplo, uno de La Vanguardia de ~200 caracteres de nombre). El Explorador y PowerShell 5.1 fallan con ellos; Node, `robocopy` y la mayoría de las herramientas modernas no. Comprobar la copia con hashes.
6. ◐ **Respaldar y cerrar.** **Copia hecha y verificada el 4/11/2026:** `originales\` y `mapa-originales.csv` (la versión con las claves del CMS, que reemplazó a la de la mañana) están en `backup2` (`E:\Proyectos frontend\CMS-EVARISTO(ASSETS)\wordpress-2026-10-31\`), copiados con `robocopy` (11 minutos), con los 10.975 archivos comprobados contra el SHA-256 del mapa y el mapa idéntico. **Falta: que Mariano quite la clave de la Lenovo de hPanel.** Plan original: Copiar `originales\` y `mapa-originales.csv` a `backup2`, comprobar los hashes contra el mapa y quitar la clave de la Lenovo de hPanel. El paquete `.tar` se conserva siempre: es la copia fiel.
7. ✅ **Lo que no es un adjunto (mirado el 4/11/2026).** Sin contar las miniaturas, hay 649 archivos que ningún adjunto pide: 606 en `avatars` (199 fotos de autor de 300 × 300, 199 `bpthumb`, 12 fotos sueltas y los `.htaccess`), 16 imágenes en la raíz que **ningún artículo ni página usa** (comprobado como URL, original o miniatura, con una consulta de control), y restos de plugins (`wpallimport`, `wp-cerber`, `wp-rollback`, `.htaccess`, `nohup.out`). **Los avatares sirven: decisión 80** (se importan como fotos de autor). Todo lo demás queda en el paquete.

### Etapa 1: lo técnico que no depende de la descarga (Claude)

En este orden (de lo que más condiciona a lo que menos):

1. ✅ **Colisiones de nombres de imagen: resuelto el 4/11/2026, decisión 81** (45 pares con la colación real; uno se renombra con `-wp<id>`; regla en `lib/claves-cms.ts`, aplicada en el extractor y en `armar`). Lo que sigue es historia: **(descubierto el 30/10/2026).** En la base de WordPress hay **unos 45 grupos de claves** (`_wp_attached_file`) que el CMS no distingue: 39 solo por mayúsculas (`TAPA.jpg` / `tapa.jpg`) y unos 6 por una tilde (`Perón.jpg` / `peron.jpg`). Un conteo aproximado con el dump del 31/10 dio 46 grupos: **recontarlos con la colación real**. `imagenes.clave` es única y su colación (`utf8mb4_es_0900_ai_ci`) no distingue mayúsculas ni tildes, así que la segunda fila de cada grupo **falla al insertarse** y la migración con `--todos` no puede completarse. Opciones: renombrar los colisionantes al importar (con sufijo estable) guardando la correspondencia y actualizando las referencias de los artículos, o cambiar la colación de `imagenes.clave` a binaria (migración de esquema, con su prueba). Depende del paso 4 de la Etapa 0b. Decidir con Mariano antes de `--todos`.
2. ✅ **`--todos` y colisiones en lote (hecho el 4/11/2026).** `--todos` se acepta en `migrar` y `migrar:escribir` (para escribir exige `--esperar-articulos=N`, como siempre; `--abortar-al-primer-error` sigue igual) y lee de WordPress todos los artículos a migrar (`post_type = post`, estados publish, draft, private, future y pending), en vivo y sin la fixture de la muestra. Nueva opción **`--wordpress=<base>`**, solo `evaristo_lectura` (por defecto, la de las pruebas) o `evaristo_lectura_nueva` (el dump definitivo); la verificación del servidor exige la base pedida. Las dos bases son iguales en lo que lee la migración: la nueva tiene 5 entradas menos (estaban en la papelera) y los contadores de visitas más recientes. Las colisiones de slug contra el CMS y las de autores van **en lote** (una consulta cada 500, con `VALUES ROW … JOIN`). Pruebas: `test-validar` (1.200 artículos en 3 consultas), `test-conexiones`, `test-comando`, `test-simulacion`; `test:migracion-db` (43) y `test:migracion-flujo` (7) en verde contra MySQL real.
   - **Simulación completa (solo lectura), 4/11/2026:** `npm run migrar -w @evaristo/compartido -- --todos --wordpress=evaristo_lectura_nueva --originales=<...\originales>` contra la real: **2.686 artículos en 56 segundos**, sin errores del programa. Con la decisión 82 entran **2.654 (2.637 publicados y 17 borradores)** y quedan afuera 32, todos borradores, como decidió Mariano: 30 sin título, el privado 19300 (sin título) y el 2498, que tiene todo el texto en el título (6.500 caracteres). Los **2 publicados sin título** (el 5562 y el 5602, de 2008, con unos 21.000 caracteres y slug numérico) migran como «Artículo a titular 5562» y «Artículo a titular 5602», con el aviso `titulo_provisorio` (decisión 82). 9.868 imágenes referenciadas y 9.805 con fila (2,26 GB); 39 `original_faltante` (los renombrados, porque todavía no hay `--mapa`) y 8 `imagen_sin_medir` (los BMP). 3.085 redirecciones; 7 categorías a crear; 398 autores nuevos y 25 existentes. El único bloqueante es el esperado: falta la sección `textos` en la real (modelo viejo; Etapa 3). Informe en `packages/compartido/out/migracion/2026-11-04T185630Z-simular.md`.
   - Queda para el ensayo (Etapa 2): la escritura (`escribir.ts`) sigue consultando por fila las imágenes y los autores dentro de la transacción; medir cuánto tarda con 2.652 artículos antes de decidir si hace falta pasarla a lote.
3. **Procesamiento de imágenes (4/11/2026):** ✅ los **8 BMP** (todos de 24 bits sin compresión; uno con extensión `.jpg`) se convierten a **PNG al extraer**, sin dependencias (`bmpAPng` y `marcarBmps` en `lib/extraer-originales.ts`; la clave del CMS pasa a `.png` en el mapa); comprobados con `sharp` de `apps/api`: idénticos píxel a píxel. ✅ La **orientación EXIF 5 a 8** (10 fotos: 9 con 6 y 1 con 8) intercambia ancho y alto al medir (`orientacionExif` en `lib/imagenes.ts`). Simulación completa: **0 originales faltantes y 0 imágenes sin medir** (9.857 con fila: 9.555 JPEG, 241 PNG y 61 GIF). Re-extraído (11.174 archivos) y copiado otra vez a `backup2`. ✅ **Variantes de tamaño: decisión 83**, hechas el 7/11/2026 (a pedido en la API con caché en disco y `srcset` en el sitio).
3b. ✅ **Leer los originales nuevos (hecho el 4/11/2026):** `--mapa=<mapa-originales.csv>` en `migrar`, `migrar:escribir` y `verificar:escritura`; `simular` lo lee con `leerMapaCsv` y `lib/mapa-originales.ts` (`clavesDesdeMapa`) le pasa a `armar` las `clavesCms` (los 45 renombrados) y los `originalesReducidos` (los 39 miniaturas). Si el mapa no corresponde a la base de WordPress que se lee (falta un adjunto o tiene otra clave), la corrida se detiene. Sin `--mapa`, todo sigue como antes. Simulación completa con el mapa (solo lectura, 28 s): **0 originales faltantes**, 9.849 imágenes con fila, 8 `imagen_sin_medir` (los BMP), `original_reducido` en 36 artículos y `titulo_provisorio` en 2. Comando: `npm run migrar -w @evaristo/compartido -- --todos --wordpress=evaristo_lectura_nueva --originales=<...\originales> --mapa=<...\mapa-originales.csv>`. ✅ **Fotos de autor (decisión 80), hechas el 4/11/2026:** el extractor saca el avatar grande de cada usuario a la carpeta de originales como `avatar-<id>.<ext>` (199) y escribe `mapa-avatares.csv`; `--avatares=<mapa-avatares.csv>` en los tres comandos; `armar` arma `fotosAutor` solo para autores que son personas y con la foto medida; `escribirBase` crea la imagen (sin `wpId`) y la asigna como `fotoId` solo si el autor no tenía foto, sin tocar `fotoAlt` (queda pendiente). La verificación cuenta esas imágenes y comprueba que cada autor quedó con foto. Pruebas: T22 de `armar`, la de avatares del extractor y una con base (crear, asignar, no pisar una foto cargada a mano, repetir sin cambios, conflicto). Simulación completa con `--mapa` y `--avatares` (25 s): 194 autores con foto. Re-extraído el 4/11 (11.174 archivos: 10.975 originales y 199 fotos) y copiado otra vez a `backup2`.
4. ✅ **Arreglos de datos conocidos (hecho el 7/11/2026, decisión 84).** Notas al pie: las anclas dobles de Word y el texto de la nota en el párrafo siguiente; cambian el 4265 (13 notas), el 4633 (5), el 34 (6) y el 1974. Enlaces a otros artículos (28): ruta del sitio. Los 26 de uploads «perdidos» eran enlaces vacíos; los 2 del 17576 esperan la redirección de `/wp-content/uploads/` (punto 5). 5360: los 4 íconos de Word se sacan con aviso. Firmas «Por …»: 13 (2 quitadas por repetir al autor, 11 con el aviso `firma_en_cuerpo`). Simulación completa del 7/11 (solo lectura): sin cambios en las cifras salvo esos avisos, y ya no queda ningún artículo inválido en modo estricto. Quedan para la revisión manual las notas que no cierran (el 620 tiene el ancla al final de la nota, el 2435 tiene 59 marcas sin nota y el 34 una primera nota «Notas:» que ya salía así).
5. ✅ **Redirecciones que faltan (hecho el 7/11/2026, decisión 85).** Reglas puras en `packages/compartido/src/rutas-wordpress.ts` y tres consultas puntuales en la API (`?p=`, `?author=` y uploads). Confirmado con el corpus completo: WordPress tenía la hora en UTC, así que la fecha de las 2.637 URLs viejas coincide con la canónica. Sin caché en memoria (no hace falta: las reglas no consultan la base). Pruebas: 8 nuevas en `test:redirecciones` (25) y la de `test:humo` contra la base. Falta definir `SITIO_URL` cuando haya dominio (el feed usa el origen del pedido mientras tanto).
6. ✅ **Permiso** de `evaristo_migracion` sobre `evaristo_cms_test`: se deja (decisión 86, 7/11/2026).
7. **Buscador con los 2.637:** probar el rendimiento (algunos textos pasan de 100 KB).
8. ✅ **`run-corpus`** y el nombre de los informes de `test-flujo`: hechos el 7/11/2026. Corrida del corpus definitivo (2.686 artículos): 0 caídas, 0 inválidos, ninguno con más del 1 % de pérdida de texto (máximo 0,54 %; 206 palabras de 4.079.152, todas pegotes del original como «tiempo65»). La métrica ya no cuenta como perdidos los números romanos de las marcas de nota (hasta el xcix).

### Etapa 2: ensayo general en una copia (Claude y Mariano)

- Restaurar un respaldo de `evaristo_cms` en una base de ensayo, **aplicar las nueve migraciones**, **convertir sus secciones y categorías al modelo nuevo** (ver Etapa 3) y correr la migración completa con el dump del 31/10 y los originales extraídos: medir tiempo, errores y avisos. Es el único modo de saber qué va a pasar antes de tocar la real.
- Revisar los resultados con la herramienta «Revisión» del panel (avisos, imágenes sin texto alternativo, `sin-asignar`, Textos, borradores).

### Etapa 3: la migración real

- **Ceremonia de la decisión 50:** respaldo con `mysqldump --result-file`; ensayo en seco y aprobación; commit aparte con `ESCRITURA_REAL_HABILITADA = true` (sin push ni tests); Mariano ejecuta `migrar:escribir` en su terminal interactiva; verificación en solo lectura; `git revert --no-commit` y commit con el interruptor en `false`; recién ahí el push. **Nunca dejar el `true` al cerrar una sesión.**
- **Antes:** aplicar las nueve migraciones a `evaristo_cms` con `db:deploy` (con respaldo previo) y regenerar el texto plano de los 19 artículos de la decisión 53 (con `--sobrescribir`).
- **Antes (nuevo, decisión 78): convertir la real al modelo nuevo.** Hoy tiene 17 secciones y los 35 artículos con la sección vieja. `db:sembrar` solo **crea** las que faltan (Textos) y no borra las viejas; el verificador posterior ya espera 9 secciones (`SECCIONES.length`) y marcaría la diferencia. **Decidido el 7/11/2026 (decisión 87): re-migrar los 35 con `--sobrescribir` dentro de la migración completa** y después una limpieza que borra las secciones y categorías viejas vacías y ajusta nombre y orden (la secuencia completa, de 7 pasos, está en la decisión 87). La limpieza está hecha y probada (7/11/2026, `--limpiar-taxonomia`); la vista previa sobre la real dice que se borran 10 secciones y 3 categorías viejas y no queda nada viejo con artículos. Con respaldo previo y aprobación.
- **Después:** comparación independiente contra WordPress con los 2.637, revisión por muestreo, reparto de `sin-asignar` (8) y revisión de Textos (~1.037, 96 de ellos Novedades de WordPress con la novedad vencida), bios y fotos de los 424 autores, y decidir con la dueña qué hacer con los 48 borradores y el privado 19300.

### Etapa 4: lanzamiento (depende de la fase 1)

- **Hosting, almacenamiento de imágenes, método de despliegue y correo** (todavía sin decidir): sin esto no hay fecha de lanzamiento ni recuperación de contraseña. Es una decisión de Mariano y la editorial.
- Backups funcionando (base e imágenes) y **restauración probada** una vez; revisión final (celular, accesibilidad, velocidad, metadatos para redes); cambio de DNS y seguimiento de 404 los primeros días; documentación de instalación, despliegue y actualización.

### Decisiones para plantear (de a una)

1. **Hosting y correo** (cuándo se decide y con quién): condiciona el lanzamiento. Al 31/10/2026, Mariano y Roxana están hablando de abrir un hosting propio para que la propiedad quede en la editorial; todavía no está decidido.
2. ~~**Cómo convertir la real**~~: decidido el 7/11/2026, dentro de la migración (decisión 87).
3. **Qué hacer con los 39 pares que comparten un archivo** (Etapa 0b, paso 4) y **cómo resolver las colisiones de nombres de imagen** (renombrar al importar o colación binaria; Etapa 1, punto 1).
4. ~~**Variantes de tamaño de las imágenes**~~: decidido (83) y hecho el 7/11/2026, a pedido en la API.
5. **Borradores migrados y privado 19300:** publicar, eliminar o dejar.
6. ~~**Páginas fijas de WordPress**~~: resuelto el 7/11/2026 (decisión 85). En WordPress solo había home, rastros, historieta, literatura y la de ejemplo, y se redirigen; «Quiénes somos» y «Contacto» no existen allá, así que siguen siendo la decisión abierta del footer.

## Qué NO se hace al retomar

- No se escribe en la base real ni se abre `ESCRITURA_REAL_HABILITADA`.
- No se aplican migraciones ni se convierte `evaristo_cms` sin respaldo y sin aprobación explícita.
- No se hace push (lo hace Mariano) ni se tocan `MySQL80`, Laragon ni el `mysqld.exe` huérfano.
