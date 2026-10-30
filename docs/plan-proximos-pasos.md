# Plan para retomar: fase 7 y lo que falta de la portada

**Documento temporal.** Se escribió el 23/10/2026 y se actualizó el 26/10/2026 al cerrar el día, para arrancar sin releer todo. **Borrarlo** (con `git rm`, sacando su fila del índice de `CLAUDE.md`) cuando la fase 7 esté en marcha y lo duradero esté en `estado-fase7.md` (a crear) y en `pendientes.md`.

## Dónde quedamos (26/10/2026)

**Resuelto en estos días** (el detalle y las decisiones están en `plan-implementacion.md` y `estado-fase4.md`):

- **Footer fijo en el código** (decisión 75, 25/10): logotipo, colores, tienda, Instagram y firma; cerrado hasta el visto bueno de Roxana Artal.
- **Topbar editable desde el panel** (decisión 76, 26/10; commit `0938882`): pantalla «Configuración del sitio» (se abre desde el popover del usuario, solo administrador) con interruptor, texto y enlace opcional. Tabla `configuracion_sitio`, `GET/PUT /api/admin/sitio`.
- **Banner promocional en la portada** (decisión 77, 26/10; commit `90303c9`): hasta 3 imágenes de 1800 × 600 (3:1, una sola medida), con texto alternativo obligatorio y enlace opcional, cargadas desde la misma pantalla. Una queda fija; varias rotan cada 6 s con fundido y puntos debajo. Va entre «Últimas publicaciones» y los bloques de abajo. Tabla `banner_imagenes`, `GET/PATCH/PUT /api/admin/banner`.
- `test:seguridad` se corrigió (tomaba los enlaces `<a href>` como recursos cargados y fallaba por el footer).

**Estado general**

- Fase 4 (panel y API) completa en el código; falta **la prueba con alguien de la editorial** (`guia-prueba-editorial.md`) y que Mariano recorra el panel en el navegador.
- Fase 5 (portada) y fase 6 (buscador y novedades): primera versión hecha y mergeada; falta el **feedback de la dueña** y los textos reales (`estado-fase5.md`, `estado-fase6.md`).
- **`main` está dos commits adelante de `origin/main`** (`0938882` y `90303c9`): falta el `push`, que hace Mariano. Las ramas de trabajo se borraron.
- Las bases de desarrollo (`evaristo_cms_dev`) y de pruebas (`evaristo_cms_test`) tienen **todas las migraciones**; la **real (`evaristo_cms`) no tiene ninguna de la fase 4 en adelante**.
- Migraciones que esperan para la real: `sesiones`, `borradores_y_capital`, `usuarios_redactor_creador_autor`, `secciones_orden`, `articulos_avisos_revisados`, `articulos_editado_publicado_por`, `busqueda_fulltext`, `configuracion_sitio` y `banner_portada` (nueve). Al aplicarlas hay que **borrar el respaldo** de `listarSeccionesMenu` en `apps/sitio/src/lib/secciones.ts`, el de `leerTopbar` en `apps/sitio/src/lib/sitio.ts` y el de `leerBanner` en `apps/sitio/src/lib/banner.ts`.
- Pruebas al día: `test:pantalla` 92, y `test:admin-sitio`, `test:admin-banner` y `test:banner` nuevos (los tres contra `evaristo_cms_dev` y, los de banner, con el sitio compilado).

## Lo que falta de lo hecho (no es urgente, no bloquea la fase 7)

1. **Mirar en un navegador** (Claude Code no los arranca): el topbar y el banner en escritorio y celular (fundido, puntos, el levantado al pasar el mouse, el arrastre con el dedo en el panel, el interruptor), el popover del usuario con el menú plegado y la portada completa.
2. **Contenido real de la editorial:** el texto del topbar y a dónde lleva (hoy, la tienda), y las primeras imágenes del banner (1800 × 600 px, JPEG, PNG o WebP de hasta 2 MB, con su texto y su enlace).
3. **Decisión abierta (la que más cambia el trabajo): «Quiénes somos» y «Contacto».** Hoy son enlaces vacíos del footer. ¿Páginas propias con texto (un mini editor de **páginas fijas**, que además sirve para las páginas fijas de WordPress que hay que redirigir o migrar; modelo `Pagina`, pantalla en el panel y ruta pública, medio día más), enlaces a otro sitio, o se sacan por ahora? Se plantea con Mariano de a una decisión.
4. **Feedback de la dueña** sobre la portada (estructura, qué secciones van arriba, destacado a mano) y su comentario del «lavado»; ver `estado-fase5.md`.
5. **Prueba del panel con alguien de la editorial** (`guia-prueba-editorial.md`).

## Antes de empezar mañana (27/10/2026, 15 minutos)

1. `git status -sb`: tiene que decir `main...origin/main` **sin «ahead»** si Mariano ya hizo el `push` (hoy está `ahead 2`); `git pull` si hace falta.
2. `Test-NetConnection 127.0.0.1 -Port 3308` (siempre). El 3307 (WordPress) solo si se lee WordPress.
3. `npm run build` y las pruebas rápidas (`npm run typecheck`, `npm run test:pantalla`) para saber que arrancamos en verde.
4. **Lo que necesito de Mariano** (se puede traer en el chat, sin contraseñas):
   - Si el plan de Hostinger **se renueva** y quién es el dueño del plan; **dónde se va a alojar** el sitio nuevo (fase 1, todavía sin decidir) y si ya hay un servicio de correo.
   - **Lugar y espacio en disco** para los `uploads` (unos 8 GB de descarga, más los derivados que se generen: conviene tener 25 GB libres).
   - Cómo se conecta por SSH al hosting (qué cliente usa). **Las credenciales no pasan por el chat ni por un documento.**
   - Si ya miró el topbar y el banner en el navegador y qué ajustó (ver arriba).

## Orden sugerido para mañana

1. **Primero la descarga de WordPress** (fase 7, etapa 0): es lo único con fecha límite y tarda horas. Dejar la guía lista (`docs/guia-descarga-wordpress.md`) y a Mariano descargando en segundo plano mientras seguimos.
2. **Fase 7, etapa 1**: lo técnico que no depende de la descarga (fase 7).
3. **Si hay tiempo o llegan los contenidos:** «Quiénes somos» y «Contacto» (punto 3 de arriba) y lo que salga de mirar el topbar y el banner en el navegador.

---

## Fase 7 (migración completa y lanzamiento)

Lista completa en `plan-implementacion.md` (sección 10) y `pendientes.md` (sección 6). La migración **real** no empieza hasta tener el dump nuevo y los `uploads`; mientras, se avanza en lo que no depende de eso.

### Etapa 0: descarga de WordPress (Mariano, **antes del 28/11/2026**; al 27/10/2026 faltan 32 días)

- **Bajar `wp-content/uploads` completo** (unos 7,9 GB, carpeta plana, ~10.975 archivos) por SSH y **volver a exportar la base** (`mysqldump`) justo antes de migrar. El plan de Hostinger vence el 28/11: confirmar si se renueva.
- **Trampa conocida:** el `tar` de Windows altera los nombres con tildes y símbolos. Usar `rsync` (desde WSL, si hay) o un cliente SFTP que respete los nombres (por ejemplo WinSCP), y **verificar los nombres contra `_wp_attached_file`** de la base nueva, sensible a mayúsculas.
- **Primero, el 27/10/2026:** yo escribo la guía paso a paso (`docs/guia-descarga-wordpress.md`) y un script de verificación que compare la carpeta descargada con lo que dice la base (faltantes, sobrantes, nombres alterados, tamaños en cero). Se corre cuando termine la descarga.
- Guardar el dump y los `uploads` fuera del repositorio (`CMS-EVARISTO(ASSETS)`), y **respaldar** todo en un segundo lugar.

### Etapa 1: lo técnico que no depende de la descarga (Claude)

En este orden (de lo que más condiciona a lo que menos):

1. **`--todos`** en `migrar` y `migrar:escribir` (hoy rechazado) y la **consulta de colisiones de slug en lote** (hoy una por artículo; no escala a 2.637). Con su política de errores y pruebas.
2. **Procesamiento de imágenes:** hoy el script mide JPEG, PNG y GIF sin librerías; otro formato da `imagen_sin_medir`, y falta la orientación EXIF 5 a 8. Con `sharp` (ya aprobado en `apps/api`; en `packages/compartido` sería una dependencia nueva: **preguntar antes**, versión exacta y fecha). Revisar de paso las variantes de tamaño (las fotos migradas son chicas: la mediana mide 700 px).
3. **Arreglos de datos conocidos:** el 4265 (dos anclas por nota al pie), los enlaces internos de texto (28 a artículos y 28 a `uploads`; falta averiguar qué pasó con 26), el 5360 (cuatro íconos de Word con ruta relativa) y los originales faltantes `escanear0006.jpg` y `mankell.jpg`. Contar cuántos artículos empiezan con «Por …» (firmas dentro del cuerpo).
4. **Redirecciones que faltan:** `/category/…` (incluida `/category/novedades/` → `/novedades/`), `/tag/…`, `/feed/`, `/?p=ID`, `/wp-content/uploads/…` y las páginas fijas; confirmar con el corpus completo que la fecha UTC de `publicadoEn` reproduce las URLs viejas (en la muestra, 33 de 34). Caché en memoria si la carga lo pide.
5. **Permiso** de `evaristo_migracion` sobre `evaristo_cms_test` (dejarlo o revocarlo).
6. **Buscador con los 2.637:** probar el rendimiento (algunos textos pasan de 100 KB).

### Etapa 2: ensayo general en una copia (Claude y Mariano)

- Restaurar un respaldo de `evaristo_cms` en una base de ensayo, **aplicar las nueve migraciones**, y correr la migración completa con el dump y los `uploads` nuevos: medir tiempo, errores y avisos. Es el único modo de saber qué va a pasar antes de tocar la real.
- Revisar los resultados con la herramienta «Revisión» del panel (avisos, imágenes sin texto alternativo, `sin-asignar`, borradores).

### Etapa 3: la migración real

- **Ceremonia de la decisión 50:** respaldo con `mysqldump --result-file`; ensayo en seco y aprobación; commit aparte con `ESCRITURA_REAL_HABILITADA = true` (sin push ni tests); Mariano ejecuta `migrar:escribir` en su terminal interactiva; verificación en solo lectura; `git revert --no-commit` y commit con el interruptor en `false`; recién ahí el push. **Nunca dejar el `true` al cerrar una sesión.**
- **Antes:** aplicar las nueve migraciones a `evaristo_cms` con `db:deploy` (con respaldo previo) y regenerar el texto plano de los 19 artículos de la decisión 53 (con `--sobrescribir`).
- **Después:** comparación independiente contra WordPress con los 2.637, revisión por muestreo, reparto de `sin-asignar` (8) y revisión de Textos (~1.037, 96 de ellos Novedades de WordPress con la novedad vencida; decisión 78), bios y fotos de los 424 autores, y decidir con la dueña qué hacer con los 48 borradores y el privado 19300.

### Etapa 4: lanzamiento (depende de la fase 1)

- **Hosting, almacenamiento de imágenes, método de despliegue y correo** (todavía sin decidir): sin esto no hay fecha de lanzamiento ni recuperación de contraseña. Es una decisión de Mariano y la editorial.
- Backups funcionando (base e imágenes) y **restauración probada** una vez; revisión final (celular, accesibilidad, velocidad, metadatos para redes); cambio de DNS y seguimiento de 404 los primeros días; documentación de instalación, despliegue y actualización.

### Decisiones para plantear (de a una)

1. **Hosting y correo** (cuándo se decide y con quién): condiciona el lanzamiento.
2. **Variantes de tamaño de las imágenes:** hacerlas al migrar (conviene, para el hero y las tarjetas) o después.
3. ~~Qué pasa con las notas de «Novedades» de WordPress~~: resuelto el 29/10/2026 (decisión 78). Migran con la novedad vencida (su fecha de publicación), en su formato o en Textos.
4. **Borradores migrados y privado 19300:** publicar, eliminar o dejar.
5. **Páginas fijas de WordPress** (Quiénes somos, Contacto, etc.): se migran, se reescriben o se redirigen.

## Qué NO se hace mañana

- No se escribe en la base real ni se abre `ESCRITURA_REAL_HABILITADA`.
- No se aplican migraciones a `evaristo_cms` sin respaldo y sin aprobación explícita.
- No se hace push (lo hace Mariano) ni se tocan `MySQL80`, Laragon ni el `mysqld.exe` huérfano.
