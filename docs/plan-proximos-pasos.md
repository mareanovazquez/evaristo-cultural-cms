# Plan para retomar: fase 7 y lo que falta

**Documento temporal.** Se escribió el 23/10/2026 y se reescribió el 30/10/2026 al cerrar la reorganización de secciones, para arrancar sin releer todo. **Borrarlo** (con `git rm`, sacando su fila del índice de `CLAUDE.md`) cuando la fase 7 esté en marcha y lo duradero esté en `estado-fase7.md` (a crear) y en `pendientes.md`.

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

1. **El «90 días por defecto» de las novedades no está implementado.** La decisión dice que una novedad nueva dura 90 días, ajustable, pero el campo «Novedad hasta» del panel (`apps/panel/src/paginas/EditarArticulo.tsx`, cerca de la línea 717) sigue vacío hasta que alguien elija una fecha. Falta que, al marcar una novedad, proponga hoy + 90 días, ajustable. Es chico; con su prueba en `test-pantalla`.
2. **Convertir la real** antes o junto con la migración completa (ver Etapa 3). Es lo único de esta reorganización que condiciona la fase 7.
3. **A confirmar con la editorial:** el nombre «Asia» para lo que era Seda; la identidad de Crítica (distinta de Reseña; arranca vacía, se carga tras la revisión manual); que Textos admita cuentos nuevos (se habló en la reunión). Y que Mariano mire el menú nuevo en escritorio y celular: no se vio en un navegador.
4. **`run-corpus` quedó desactualizado:** sus dos generadores de entrada (`consultar-categorias.ts`, `extraer-autores-por-post.ts`) ya no existen en el repo. Arreglarlo (que lea las categorías de la 3307 y aplique el mapeo nuevo, como hizo el script descartable del 30/10) o darlo de baja. Mientras, el reparto de las 2.637 se calcula con una consulta de solo lectura a la 3307.
5. **`test-flujo` (F-g) falló una vez** al contar informes de escritura, con nombre por segundo: dos informes del mismo segundo se pisan. Pasó en las repeticiones. Hacer los nombres únicos o relajar la cuenta.
6. **Revisión manual posterior a la migración:** ~1.037 de Textos (96 son Novedades de WordPress con la novedad vencida, para encontrarlos) y 8 de `sin-asignar`. 261 artículos tenían más de una sección candidata y la perdedora se descartó (es el costo de «no repetir secciones como categorías»).

## Lo que falta de lo hecho antes (no es urgente, no bloquea la fase 7)

1. **Mirar en un navegador** (Claude Code no los arranca): el menú nuevo, el topbar y el banner en escritorio y celular, el popover del usuario y la portada completa. Para verlo con los datos nuevos: `npm run build:sitio` y `npm run dev:desarrollo -w @evaristo/api` (no `npm run dev`, que lee la real), en `http://127.0.0.1:3000/`.
2. **Contenido real de la editorial:** el texto del topbar y a dónde lleva (hoy, la tienda), y las primeras imágenes del banner (1800 × 600 px, JPEG, PNG o WebP de hasta 2 MB, con su texto y su enlace).
3. **Decisión abierta: «Quiénes somos» y «Contacto».** Hoy son enlaces vacíos del footer. ¿Páginas propias con texto (un mini editor de **páginas fijas**, que además sirve para las páginas fijas de WordPress que hay que redirigir o migrar; modelo `Pagina`, pantalla en el panel y ruta pública, medio día más), enlaces a otro sitio, o se sacan por ahora? Se plantea con Mariano de a una decisión.
4. **Preguntas abiertas para la dueña** sobre la portada (qué secciones van arriba, destacado a mano) y su comentario del «lavado»; en líneas generales le gustó. Ver `estado-fase5.md`.
5. **Prueba del panel con alguien de la editorial** (`guia-prueba-editorial.md`). La dev ya no tiene artículos de prueba propios: hay que crear los que haga falta.

## Al retomar (15 minutos)

0. **El cambio de equipo se hizo el 30/10/2026:** se trabaja en la Lenovo y **lo que sigue es la descarga de WordPress** (`guia-descarga-wordpress.md`). Antes de arrancar, mirar en `plan-cambio-de-equipo.md` qué quedó de la Fase C. El Galaxy no se toca ni se vende hasta cerrarla.
1. `git status -sb`: tiene que decir `main...origin/main` sin «ahead» ni «behind».
2. `Test-NetConnection 127.0.0.1 -Port 3308` (siempre). El 3307 (WordPress) solo si se lee WordPress. Si están caídas, las levanta Mariano (`glosario-comandos-bases.md`).
3. `npm run build`, `npm run typecheck`, `npm run test:pantalla`, `npm run test:conversor` y `npm run test:migracion` para saber que arrancamos en verde.
4. **Lo que necesito de Mariano** (se puede traer en el chat, sin contraseñas):
   - **Las tres preguntas abiertas están en `guia-descarga-wordpress.md`, sección «Antes de empezar: preguntas abiertas»; empezar por ahí.** En resumen: si el plan de Hostinger **se renueva** y quién es el dueño del plan; **dónde se va a alojar** el sitio nuevo (fase 1, todavía sin decidir) y si ya hay un servicio de correo.
   - **Lugar y espacio en disco** para los `uploads` (unos 8 GB de descarga, más los derivados que se generen: conviene tener 25 GB libres).
   - Cómo se conecta por SSH al hosting (qué cliente usa). **Las credenciales no pasan por el chat ni por un documento.**
   - Si ya miró el menú, el topbar y el banner en el navegador y qué ajustó.

## Orden sugerido

1. **Primero la descarga de WordPress** (fase 7, etapa 0): es lo único con fecha límite (**28/11/2026**, quedan 29 días al 30/10) y tarda horas. La guía y el script de verificación **ya existen** (`docs/guia-descarga-wordpress.md`, `npm run verificar:descarga`; 30/10/2026): falta que Mariano confirme los datos del hosting y empiece a bajar en segundo plano mientras se sigue.
2. **El 90 días por defecto** (punto 1 de «Lo que falta de la decisión 78»), que es chico y deja cerrada la reorganización.
3. **Fase 7, etapa 1:** lo técnico que no depende de la descarga.
4. **Si hay tiempo o llegan los contenidos:** «Quiénes somos» y «Contacto» y lo que salga de mirar el sitio en el navegador.

---

## Fase 7 (migración completa y lanzamiento)

Lista completa en `plan-implementacion.md` (sección 10) y `pendientes.md` (sección 6). La migración **real** no empieza hasta tener el dump nuevo y los `uploads`; mientras, se avanza en lo que no depende de eso. **Mariano la hace otro día** (dicho el 30/10/2026): la descarga de la etapa 0 sigue teniendo fecha límite aunque la migración no.

### Etapa 0: descarga de WordPress (Mariano, **antes del 28/11/2026**)

- **Bajar `wp-content/uploads` completo** (unos 7,9 GB, carpeta plana, ~10.975 archivos) por SSH y **volver a exportar la base** (`mysqldump`) justo antes de migrar. El plan de Hostinger vence el 28/11: confirmar si se renueva.
- **Guía y verificación listas (30/10/2026):** `docs/guia-descarga-wordpress.md` (paso a paso) y `npm run verificar:descarga` (compara la carpeta bajada con la base de WordPress y con una lista hecha en el servidor: faltantes, nombres alterados, tamaños cero o distintos, sobrantes; solo lectura; 16 pruebas en `test:migracion`).
- **Dos trampas conocidas:** (1) el `tar` de Windows altera los nombres con tildes y símbolos. En este equipo hay `ssh`, `scp` y `sftp` (OpenSSH) pero **no hay `rsync` ni WinSCP**: la guía recomienda instalar WinSCP (reanuda) o usar `scp`. **Verificar los nombres contra `_wp_attached_file`** de la base nueva, sensible a mayúsculas. (2) **39 grupos de imágenes (78 archivos) solo difieren en las mayúsculas** (`TAPA.jpg` / `tapa.jpg`): en Windows uno pisa al otro. La guía los aparta en el servidor en un `colisiones.tar`.
- Guardar el dump y los `uploads` fuera del repositorio (`CMS-EVARISTO(ASSETS)`), y **respaldar** todo en un segundo lugar.

### Etapa 1: lo técnico que no depende de la descarga (Claude)

En este orden (de lo que más condiciona a lo que menos):

1. **Resolver las colisiones de nombres de imagen (descubierto el 30/10/2026).** En la base de WordPress hay **45 grupos de claves** (`_wp_attached_file`) que el CMS no distingue: 39 solo por mayúsculas (`TAPA.jpg` / `tapa.jpg`; 78 archivos) y 6 por una tilde (`Perón.jpg` / `peron.jpg`). `imagenes.clave` es única y su colación (`utf8mb4_es_0900_ai_ci`) no distingue mayúsculas ni tildes, así que la segunda fila de cada grupo **falla al insertarse** y la migración con `--todos` no puede completarse. Opciones: renombrar los colisionantes al importar (con sufijo estable) guardando la correspondencia y actualizando las referencias de los artículos, o cambiar la colación de `imagenes.clave` a binaria (migración de esquema, con su prueba). Además, en Windows los 78 de mayúsculas no caben en una carpeta: están en `colisiones.tar`. Decidir con Mariano antes de `--todos`.
2. **`--todos`** en `migrar` y `migrar:escribir` (hoy rechazado) y la **consulta de colisiones de slug en lote** (hoy una por artículo; no escala a 2.637). Con su política de errores y pruebas.
3. **Procesamiento de imágenes:** hoy el script mide JPEG, PNG y GIF sin librerías; otro formato da `imagen_sin_medir`, y falta la orientación EXIF 5 a 8. Con `sharp` (ya aprobado en `apps/api`; en `packages/compartido` sería una dependencia nueva: **preguntar antes**, versión exacta y fecha). Revisar de paso las variantes de tamaño (las fotos migradas son chicas: la mediana mide 700 px).
4. **Arreglos de datos conocidos:** el 4265 (dos anclas por nota al pie), los enlaces internos de texto (28 a artículos y 28 a `uploads`; falta averiguar qué pasó con 26), el 5360 (cuatro íconos de Word con ruta relativa) y los originales faltantes `escanear0006.jpg` y `mankell.jpg`. Contar cuántos artículos empiezan con «Por …» (firmas dentro del cuerpo).
5. **Redirecciones que faltan:** `/tag/…`, `/feed/`, `/?p=ID`, `/wp-content/uploads/…` y las páginas fijas (las `/category/…` ya están, decisión 78); confirmar con el corpus completo que la fecha UTC de `publicadoEn` reproduce las URLs viejas (en la muestra, 33 de 34). Caché en memoria si la carga lo pide.
6. **Permiso** de `evaristo_migracion` sobre `evaristo_cms_test` (dejarlo o revocarlo).
7. **Buscador con los 2.637:** probar el rendimiento (algunos textos pasan de 100 KB).
8. **`run-corpus`** y el nombre de los informes de `test-flujo` (ver arriba).

### Etapa 2: ensayo general en una copia (Claude y Mariano)

- Restaurar un respaldo de `evaristo_cms` en una base de ensayo, **aplicar las nueve migraciones**, **convertir sus secciones y categorías al modelo nuevo** (ver Etapa 3) y correr la migración completa con el dump y los `uploads` nuevos: medir tiempo, errores y avisos. Es el único modo de saber qué va a pasar antes de tocar la real.
- Revisar los resultados con la herramienta «Revisión» del panel (avisos, imágenes sin texto alternativo, `sin-asignar`, Textos, borradores).

### Etapa 3: la migración real

- **Ceremonia de la decisión 50:** respaldo con `mysqldump --result-file`; ensayo en seco y aprobación; commit aparte con `ESCRITURA_REAL_HABILITADA = true` (sin push ni tests); Mariano ejecuta `migrar:escribir` en su terminal interactiva; verificación en solo lectura; `git revert --no-commit` y commit con el interruptor en `false`; recién ahí el push. **Nunca dejar el `true` al cerrar una sesión.**
- **Antes:** aplicar las nueve migraciones a `evaristo_cms` con `db:deploy` (con respaldo previo) y regenerar el texto plano de los 19 artículos de la decisión 53 (con `--sobrescribir`).
- **Antes (nuevo, decisión 78): convertir la real al modelo nuevo.** Hoy tiene 17 secciones y los 35 artículos con la sección vieja. `db:sembrar` solo **crea** las que faltan (Textos) y no borra las viejas; el verificador posterior ya espera 9 secciones (`SECCIONES.length`) y marcaría la diferencia. Dos caminos: (a) **conversión en el lugar**, como se hizo en la dev el 30/10 (reaplicar a cada artículo la sección, categorías y volanta que calcula `armar`, subir las secciones nuevas y borrar las viejas ya vacías; el script era descartable y no se guardó, hay que rehacerlo, con modo de prueba que deshace la transacción); o (b) **re-migrar los 35 con `--sobrescribir`** y borrar después las secciones y categorías viejas. Con respaldo previo y aprobación. Decidirlo con Mariano.
- **Después:** comparación independiente contra WordPress con los 2.637, revisión por muestreo, reparto de `sin-asignar` (8) y revisión de Textos (~1.037, 96 de ellos Novedades de WordPress con la novedad vencida), bios y fotos de los 424 autores, y decidir con la dueña qué hacer con los 48 borradores y el privado 19300.

### Etapa 4: lanzamiento (depende de la fase 1)

- **Hosting, almacenamiento de imágenes, método de despliegue y correo** (todavía sin decidir): sin esto no hay fecha de lanzamiento ni recuperación de contraseña. Es una decisión de Mariano y la editorial.
- Backups funcionando (base e imágenes) y **restauración probada** una vez; revisión final (celular, accesibilidad, velocidad, metadatos para redes); cambio de DNS y seguimiento de 404 los primeros días; documentación de instalación, despliegue y actualización.

### Decisiones para plantear (de a una)

1. **Hosting y correo** (cuándo se decide y con quién): condiciona el lanzamiento.
2. **Cómo convertir la real** (en el lugar o re-migrando los 35): ver Etapa 3.
3. **Cómo resolver las 45 colisiones de nombres de imagen** (renombrar al importar o colación binaria): ver Etapa 1, punto 1.
4. **Variantes de tamaño de las imágenes:** hacerlas al migrar (conviene, para el hero y las tarjetas) o después.
5. **Borradores migrados y privado 19300:** publicar, eliminar o dejar.
6. **Páginas fijas de WordPress** (Quiénes somos, Contacto, etc.): se migran, se reescriben o se redirigen.

## Qué NO se hace al retomar

- No se escribe en la base real ni se abre `ESCRITURA_REAL_HABILITADA`.
- No se aplican migraciones ni se convierte `evaristo_cms` sin respaldo y sin aprobación explícita.
- No se hace push (lo hace Mariano) ni se tocan `MySQL80`, Laragon ni el `mysqld.exe` huérfano.
