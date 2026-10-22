# Revista cultural Evaristo: plan de implementación (roadmap)

Estado: borrador, actualizado el 21/10/2026. **La fase 3 (sitio público) está terminada en lo técnico** (renderizador, layout, `/media`, artículo, autores, secciones, categorías, redirecciones y 404; ver `estado-fase3.md`) y **la fase 4 (panel y API) está en curso, con los pasos 1 a 3 hechos** (ingreso y sesiones, listado, API de edición con borrador de cambios; ver `estado-fase4.md`). Se sumaron las decisiones 54 a 63. Antes, el 20/10/2026: **la fase 2 está cerrada:** el script de migración escribió en la base real los 35 artículos de la muestra (19/10/2026 el 12526 y 20/10/2026 los otros 34), verificados contra el plan y, de forma independiente, contra WordPress. Se sumaron la prueba del flujo completo contra `evaristo_cms_test`, el verificador posterior versionado, la corrección del texto plano y las decisiones 46 a 53. Detalle del diseño y de las decisiones del script en `diseno-script-migracion.md`; lo pendiente en `pendientes.md`; comandos para iniciar y detener las bases en `glosario-comandos-bases.md`; decisiones de diseño visual en `decisiones-de-diseno.md`. Antes, el 17/10/2026: pasos 4 a 13 del script y las decisiones 40 a 45; el 16/10/2026: conversor trasladado al CMS, muestra ampliada a 35 y las decisiones 29 a 39; el 13/10/2026: regla de secciones y categoría principal, inventario de etiquetas y metadatos; el 9/10/2026: taxonomía cerrada, esqueleto del CMS y modelo de datos. Complementa `especificacion-articulo.md`, `especificacion-home.md`, `especificacion-stack.md`, `prueba-inicial.md` y `relevamiento-wordpress.md`.

## 1. Criterio general

- **Primero lo que tiene más riesgo técnico y lo que más condiciona al resto.** En este proyecto eso es el editor de texto (por las notas al pie), el formato en que se guarda el cuerpo del artículo y la migración desde WordPress.
- **Primero la lectura, después la escritura.** La migración de una muestra deja contenido real en la base; con eso se construye el sitio público antes que el panel, y la vista previa del panel reutiliza lo ya hecho.
- **Desplegado desde el principio.** El entorno de pruebas existe desde la fase 1, no al final.
- **La portada, después de la reunión con la editorial.** Depende de decisiones que todavía no están tomadas (ver `especificacion-home.md`, sección 9).
- **La migración es automática y se revisa por muestreo.** Son 2.637 artículos publicados, así que no se revisa uno por uno: el conversor genera un informe de advertencias por artículo, y la revisión manual se concentra en los que quedan marcados y en una muestra de los demás. Parte de esa revisión se hace después de la importación, desde el panel (ver 10).
- **Antes de lo riesgoso, una corrida en seco de solo lectura y confirmación.** Nada se escribe en la base real sin que se haya revisado el resultado de la simulación, sin pruebas previas contra una base de pruebas, con un respaldo hecho y con la aprobación de Mariano. Cada tramo de código pasa una verificación independiente en un clon limpio antes de usarse.

## 2. Resumen de fases

| Fase | Objetivo | Depende de | Estado |
|---|---|---|---|
| 0 | Prueba del editor, relevamiento, decisiones y conversor | — | Cerrada, salvo el 5360 (depende de bajar `wp-content/uploads`). El conversor ya vive en el CMS |
| 1 | Esqueleto que funciona de punta a punta, desplegado | 0 | Esqueleto hecho en local; falta el despliegue |
| 2 | Modelo de datos y migración de la muestra de 35 artículos | 0, 1 | **Cerrada (20/10/2026).** Modelo hecho; los 35 artículos escritos en `evaristo_cms` y verificados contra el plan y contra WordPress. Queda regenerar el texto plano de 19 artículos en la fase 7 |
| 3 | Sitio público: artículo, autores, secciones y categorías | 2 | **Terminada en lo técnico (21/10/2026).** Quedan `<head>` para redes, variantes de tamaño de las imágenes, galería y ficha técnica, y el visto bueno de la directora (ver `estado-fase3.md` y `pendientes.md`). Diseño visual en `decisiones-de-diseno.md` |
| 4 | Panel de administración | 0, 3 | **En curso:** pasos 1 a 3 hechos (ingreso y sesiones, listado, API de edición). Faltan el editor, las imágenes, publicar, la administración y el cierre (ver `estado-fase4.md`) |
| 5 | Portada | 3, reunión con la editorial | Pendiente |
| 6 | Navegación, buscador y novedades | 3, especificación pendiente | Parcial: las páginas de sección y de categoría y un menú básico ya están (fase 3); faltan el buscador, las novedades y la navegación definitiva |
| 7 | Migración completa (2.637 artículos) y lanzamiento | todas | Pendiente |

Las fases 5 y 6 pueden avanzar en paralelo con la 4. Las especificaciones pendientes (navegación, buscador, sección y categoría) se escriben mientras avanzan las fases 3 y 4.

## 3. Fase 0: prueba, relevamiento, decisiones y conversor

### 3.1 Hecho

- **Prueba del editor:** TipTap confirmado. Las notas al pie funcionan (insertar, editar, mover, borrar y deshacer), el pegado desde WordPress conserva los formatos permitidos y el esquema descarta el resto. El código de la prueba (extensiones, notas al pie, cita, renderizador) es la base del editor del panel y se reutiliza.
- **Decidido en `especificacion-stack.md`:** TypeScript en todo el proyecto; TipTap como editor; cuerpo guardado como JSON estructurado, con el HTML generado al mostrar la página (la numeración de las notas se calcula al renderizar).
- **Relevamiento de la base de WordPress:** hecho sobre el dump del 5/10/2026. Resultado en `relevamiento-wordpress.md`.
- **Muestra:** 30 artículos elegidos a propósito, con su contenido crudo, en `packages/compartido/src/conversor/tests/fixtures/muestra-wordpress.json`. Ampliada el 16/10/2026 con 5 artículos más (ver 5.4).
- **Editor ampliado:** nodos de imagen (con epígrafe), video (YouTube y Vimeo) y tabla simple, salto de línea en párrafos (bloqueado en títulos) y atributo `altPendiente` en la imagen.
- **Conversor HTML → JSON** probado sobre los 2.637 artículos: 0 errores, 2.523 sin pérdida de texto, validador en modo migración con 0 inválidos. Validador único (`validate.ts`) con modo estricto y modo migración.
- **`altPendiente`:** el conversor marca 2.431 imágenes sin texto alternativo, en 813 artículos. En modo estricto los inválidos bajaron de 813 a 1 (el 5360).
- **Normalización de títulos** aplicada al conversor, con léxico construido desde el cuerpo de los artículos. Detalle en `prueba-inicial.md`, sección 5.5.
- **Relevamiento de categorías y de autoría** sobre una base local de solo lectura (ver 3.4 y 3.5). **Taxonomía cerrada (7/10/2026)** y regla de secciones y categoría principal implementadas en el conversor (13/10/2026).
- **Conexión común a la base local:** los extractores usan `lib-conexion.ts` (3307, `evaristo_lectura`). Esos extractores se quedaron en `testing-tiptap`. **Inventario de etiquetas, postmeta y usermeta de WordPress (13/10/2026):** ver 3.6.
- **Conversor trasladado al CMS (15/10/2026, commit `162e3e5`):** copia simple, sin historial, de `testing-tiptap` (rama `integracion-conversor`, commit `ba37c92`) a `packages/compartido`. Layout: `src/conversor/` (módulos y README), `src/conversor/tests/` (4 tests y `fixtures/muestra-wordpress.json`), `src/schema/validate.ts`, `src/render/video.ts`, `datos/conversor/`, `scripts/conversor/run-corpus.ts`. Dependencia nueva: `parse5` 8.0.1. `testing-tiptap` queda como archivo de la prueba; **el `validate.ts` de `packages/compartido` es la copia canónica**. `posts.json` y `out/` son salidas generadas e ignoradas por git.
- **Script de migración (16 al 20/10/2026):** implementado completo, probado, verificado y usado. Pasos 0 a 3 (mapeo, `imagenId`, utilidades, lectura de WordPress, snapshot, `armar()` pura y validaciones puras), simulación (imágenes, validación, colisiones, ejecutor nulo, informe), escritura (categorías, autores, imágenes, artículos, relaciones y redirecciones), re-ejecución sin pisar, sobrescritura confirmada, comando de escritura aparte, `--ids`, flujo inyectable solo desde tests, `test:migracion-flujo` y verificador posterior versionado. La lista de commits está en `diseno-script-migracion.md` (sección 9) y en `pendientes.md`. HEAD verificado: `c570d19`.
- **Pruebas (versión `c570d19`):** `test:migracion` 90 con el baseline de `out/` y 89 sin él; `test:migracion-db` 43; `test:migracion-flujo` 7; `test:conversor` 24 + 41 + 10 + 33; typecheck sin errores. Cada tramo pasó una verificación independiente en clon limpio (diff contra el baseline original, revisión de cada `update` y `delete`, grafo de imports calculado por separado, pruebas de mutación): sin diferencias.
- **Entorno de pruebas del script:** `evaristo_cms_test` (`utf8mb4_es_0900_ai_ci`, 3 migraciones, creada el 17/10/2026) y el usuario de base `evaristo_migracion` (SELECT, INSERT, UPDATE y DELETE sobre `evaristo_cms` y `evaristo_cms_test`; credenciales en `DATABASE_URL_MIGRACION` del `.env`).
- **Escrituras reales:** 19/10/2026, artículo 12526; 20/10/2026, los otros 34 (ver 5.4). Respaldos previos en `C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\respaldos\`.

### 3.2 Decisiones tomadas

| # | Tema | Decisión |
|---|---|---|
| 1 | Imágenes dentro del cuerpo | Nodo de imagen en el editor, con texto alternativo y epígrafe. Los `[caption]` de WordPress pasan a ser el epígrafe. |
| 2 | Videos | Nodo de video para YouTube y Vimeo (la URL se convierte en reproductor al renderizar, con lista blanca). Facebook e Instagram pasan a enlace. |
| 3 | México, Seda y Rastros | Respuesta de la editorial (7/10/2026): Rastros y Asia (antes Seda) son secciones históricas de la revista, no suplementos. México se elimina y sus artículos se reparten entre las demás. Ya no hay rubros ni suplementos. |
| 4 | Etiquetas | Las 5.959 etiquetas (términos únicos; 9.300 asignaciones en 2.250 artículos) se guardan ocultas como dato de archivo del artículo; no se muestran ni se editan. |
| 5 | Fichas técnicas | Se migran como texto del cuerpo. Después, una segunda pasada semiautomática las pasa a los campos del formulario. |
| 6 | Bios de autores | Se importan las 200 bios que ya existen en el perfil de WordPress, como punto de partida para revisar. Para los demás autores se arma la planilla. |
| 7 | Títulos | Los de la forma "TÍTULO \| subtítulo" se dividen en título y bajada. Las mayúsculas pasan a formato oración con un léxico construido desde el cuerpo de los artículos; los dudosos se marcan para revisión. Los de la forma "AUTOR \| TÍTULO" **no se dividen**: quedan enteros y marcados para revisión posterior. Las bajadas que nombran a una persona (193) se dejan como bajada. |
| 8 | Tablas y subrayado | Se suma al editor un nodo de tabla simple. El subrayado se descarta. |
| 9 | Cantidad | 2.637 artículos publicados (no ~300): se actualizan las cifras. |
| 10 | Cintillo y volanta | La sección se muestra como cintillo. La categoría principal se muestra como volanta, que es opcional (solo si el artículo tiene categorías). Se muestra solo una categoría (la principal). |
| 11 | Imágenes migradas sin texto alternativo | El panel deja guardar el artículo con un aviso visible; el texto alternativo es obligatorio solo en las imágenes nuevas (atributo `altPendiente`). |
| 12 | Saltos de línea en títulos | No se admiten: Shift+Enter no hace nada en un título y el pegado convierte el `<br>` en un espacio. |
| 13 | Autoría | El autor de WordPress se toma como autor en las cuentas personales. Las cuentas institucionales (Evaristo Cultural, El Festivalón, Encuentro Internacional de Cultura Japonesa: 343 artículos) y cuatro más (revistaseda, Anonimo, eva y Evaristo: 29 artículos) pasan como autores de solo texto. Lo dudoso se revisa después de la importación. |
| 14 | Secciones y categorías | Una sección por artículo, que elige el editor, con 17 valores que mezclan formatos y temas (lista en `especificacion-articulo.md`, sección 2). Categorías muchos a muchos, con página propia y fuera del menú principal. Sin etiquetas visibles. |
| 15 | Novedad | No es sección ni categoría: es un campo opcional `novedadHasta` (fecha) del artículo. Los migrados arrancan sin fecha. |
| 16 | Prioridad para elegir la sección al migrar | Rastros > Asia; después formato: Entrevista > Reseña > Ensayo > Crónica; después tema: Poesía > Teatro > Música > Historieta > TV & Cine > Fantástico > Arte > Infantojuvenil > Libro Ilustrado > Literatura. Lo que no gana pasa a categoría. Rastros y Asia son innegociables: ningún formato les quita artículos. Entrevista se detecta por el título (la palabra completa "Entrevista" al comienzo del primer tramo o del tramo posterior a la barra), con excepciones por id. |
| 17 | Sección obligatoria | Todo artículo tiene sección. Los que no tienen ninguna candidata (por ejemplo, los que solo tenían Novedades) quedan en una sección interna `sin-asignar`, con un reporte (CSV) para repartirlos después. La migración no se frena por eso. |
| 18 | Texto alternativo, crédito y punto focal de las imágenes | Viven en cada uso (encabezado del artículo, fila de la galería, foto del autor), no en la biblioteca de imágenes. Un texto alternativo vacío significa pendiente. |
| 19 | Biblioteca de imágenes | La tabla `imagenes` guarda la clave relativa del archivo original, nombre original, tipo, dimensiones, tamaño, `hash` SHA-256 (con índice pero no único) y `wpId`. Las variantes de tamaño se generan desde la clave y no se guardan en la base. |
| 20 | Redirecciones | Se guarda la URL vieja de WordPress tal cual (`origen`), sin recalcularla desde `publicadoEn` (las URLs usan hora local y `publicadoEn` está en UTC). Apuntan al artículo o al autor por id, o a un destino manual. |
| 21 | Usuarios | Solo el modelo base (email, nombre, hash de contraseña, rol EDITOR o ADMINISTRADOR, activo). Las sesiones y el algoritmo del hash se definen en la fase 4; no se siembra ningún usuario. |
| 22 | Contador de visitas (13/10/2026) | El `cb_visit_counter` de WordPress (unos 4,1 millones de visitas en total) se guarda como número histórico de solo lectura en `articulos.visitasWp`. No se incrementa, es null en los artículos nuevos y no se muestra. La API de artículos no lo devuelve (`select` explícito). |
| 23 | Categoría principal al migrar (13/10/2026) | Sin categorías finales: sin volanta. Una sola: esa. Dos o más: la primera según el orden de prioridad de la decisión 16; las categorías fuera de la lista van después, en orden alfabético. Es determinista y la principal siempre está entre las categorías del artículo. |
| 24 | Datos para redes de Facebook (13/10/2026) | Las 1.230 filas de `_webdados_fb_open_graph_*` casi no tienen contenido (1 descripción y 5 imágenes). Solo esas pasan como sobrescritura; el resto usa por defecto la bajada y la imagen de encabezado. |
| 25 | Dónde vive el script de migración (15/10/2026) | Dentro de `evaristo-cultural-cms`, en `packages/compartido`, con el conversor traído una sola vez (copia simple) y escribiendo con Prisma. |
| 26 | `_wp_old_slug` (15/10/2026) | Solo slugs reales: se descartan los valores solo numéricos, los que coinciden con el slug actual y los que terminan en `__trashed`. Quedan unos 34. |
| 27 | Borradores y artículo privado (15/10/2026) | Los 48 borradores y el privado 19300 migran como BORRADOR con slug `borrador-<wpId>`. El 19300 lleva el aviso `origen_privado`. Los borradores no generan redirecciones. La API de la fase 4 rechaza publicar un artículo cuyo slug empiece con `borrador-`. Qué hacer con ellos se decide después de migrar, con la directora de la editorial. |
| 28 | Caracteres invisibles (16/10/2026) | El U+200E se limpia del slug y del título (aviso `u200e_removido`; caso 19899). Si la limpieza cambia el slug se colapsan los guiones consecutivos; la redirección conserva la URL vieja. El guion blando U+00AD no se toca en el cuerpo y se quita del texto plano del buscador (fase 6). |
| 29 | Imágenes de la muestra (15/10/2026) | Se bajan del hosting solo los originales de la muestra ampliada (202 imágenes). La carpeta `uploads` completa se baja en la fase 7. Dimensiones, bytes, hash y MIME se miden del archivo, nunca de los metadatos de WordPress. |
| 30 | Originales faltantes (16/10/2026) | Dos originales no existen en el hosting (`escanear0006.jpg` y `mankell.jpg`). No se crea fila de imagen: el artículo migra sin encabezado y con el aviso `original_faltante`. Alt y crédito del encabezado quedan en null y viajan dentro del aviso. |
| 31 | Cuerpo e imágenes (16/10/2026) | Los nodos de imagen del cuerpo llevan `imagenId` y el `src` se reescribe a `/media/<clave>`, con percent-encoding en la ruta. Panel y sitio respetan ese contrato y sirven `/media/…`. La coherencia entre `src` e `imagenId` la comprueba el script (`imagen_cuerpo_inconsistente`). |
| 32 | Segunda corrida (16/10/2026) | Los artículos que difieren de lo que produciría el script se omiten y se reportan; solo `--sobrescribir` (confirmando el ámbito) los reescribe. Una columna con hash de lo migrado queda como mejora posible. La decisión 42 la completa. |
| 33 | Errores y alcance (16/10/2026) | Si falla un artículo, rollback de ese artículo y la corrida sigue; la primera escritura real usó `--abortar-al-primer-error`. `--ids` acepta solo ids de la muestra de 35; `--todos` queda para la fase 7. |
| 34 | Base de pruebas (16/10/2026) | `evaristo_cms_test` en el mismo MySQL 8.4 (3308), con `utf8mb4_es_0900_ai_ci`; los tests con escritura corren ahí. Hecho el 17/10/2026. |
| 35 | Slug de TV & Cine y clave de imágenes (16/10/2026) | El mapeo usa `tv-y-cine`. `imagenes.clave` es el `_wp_attached_file` en NFC, sin prefijo. |
| 36 | Redirecciones de solo texto e imágenes sin medir (16/10/2026) | Las cuentas de solo texto no generan redirecciones `/author/…`. Una imagen que existe pero no se puede medir no crea fila y lleva el aviso `imagen_sin_medir`. |
| 37 | Tests y fechas (16/10/2026) | Se versiona `datos/migracion/snapshot-wp-muestra.json` para los tests puros. Los borradores toman `publicadoEn` de `post_date_gmt` si es válida; si está en ceros queda en **null** y la fecha de creación completa va dentro del aviso `fecha_borrador`. En la fase 4, al pasar de BORRADOR a PUBLICADO el panel propone la fecha actual. |
| 38 | Bios con correo y usuarios (16/10/2026) | Las bios se importan tal cual, también la del usuario 39 que trae un correo. Aviso `bio_con_correo`. Después de la importación se recrean los usuarios editores y se sanean esas bios a mano. |
| 39 | Estados de WordPress (16/10/2026) | Solo `publish`, `draft` y el privado 19300 entran al plan. Cualquier otro estado se excluye con `estado_desconocido`. |
| 40 | Aviso `bio_con_correo` (17/10/2026) | Va en **cada artículo del autor** con una bio con correo, con `wpUserId` y nombre del autor (nunca el correo). El detector reconoce un correo real y el marcador `[correo omitido]`. En la muestra, el 22255. |
| 41 | Imagen del cuerpo sin original o sin poder medir (17/10/2026) | El nodo queda sin `imagenId`, con su `src` de WordPress, y el artículo migra con el aviso. Ese `src` deja de andar al vencer el hosting (28/11/2026). Hoy hay 0 casos en la muestra. |
| 42 | Re-ejecución sin pisar (17/10/2026) | En una segunda corrida no se pisa nada de lo que existe. Solo `--sobrescribir`, con `--esperar-sobrescribir=N` igual al total de filas, reescribe lo que difiere. Los conflictos de clave de imagen y de origen de redirección no se pisan nunca. |
| 43 | Comando de escritura aparte (17/10/2026) | La escritura va por `migrar:escribir`; `migrar.ts` es exclusivo para simular. |
| 44 | Usuario de base de la escritura real e interruptor (17/10/2026) | `evaristo_migracion` con SELECT, INSERT, UPDATE y DELETE sobre `evaristo_cms` (sin DDL), credenciales en `DATABASE_URL_MIGRACION`. `ESCRITURA_REAL_HABILITADA = false` en el código, sin flag ni variable que lo cambie; cambiarlo requiere un commit aparte con aprobación de Mariano. En el destino real se pide además terminal interactiva y tipeo del nombre de la base. |
| 45 | Colisiones de slug y fecha de borradores (17/10/2026) | Dos artículos reales con slug en colisión se excluyen los dos. `fecha_borrador` guarda el `post_date` completo. |
| 46 | Clave RSA (19/10/2026) | Con la caché de autenticación fría (`caching_sha2_password`, tras un reinicio o `FLUSH PRIVILEGES`), `evaristo_migracion` fallaba con `ER_CANNOT_RETRIEVE_RSA_KEY`. Se pasa `allowPublicKeyRetrieval` solo en la conexión de escritura (host fijo 127.0.0.1). Verificado con la caché fría. |
| 47 | Flujo inyectable solo desde tests (19/10/2026) | El flujo posterior a las comprobaciones es una función (`lib/flujo-escribir.ts`) con dependencias inyectables. Las reales viven en un `WeakSet` no exportado; con dependencias de prueba el flujo se niega si el destino no es `DESTINO_PRUEBAS`. Las de prueba solo se arman en `tests/dependencias-prueba.ts`. |
| 48 | Prueba del flujo completo (19/10/2026) | `test:migracion-flujo` (7 casos) ejecuta el flujo de punta a punta contra `evaristo_cms_test` con las credenciales reales de `evaristo_migracion`, incluidas la sobrescritura (UPDATE y DELETE) y los permisos negativos. Es una suite aparte para que `test:migracion-db` no dependa de ese usuario. |
| 49 | Permisos de `evaristo_migracion` (19/10/2026) | SELECT, INSERT, UPDATE y DELETE sobre `evaristo_cms` y `evaristo_cms_test`. Recomendado dejarlo; a confirmar antes de la fase 7. |
| 50 | Ceremonia de cada escritura real (19/10/2026) | Respaldo con `mysqldump`; ensayo en seco y aprobación; commit aparte con el interruptor en `true` (sin push ni tests); Mariano ejecuta `migrar:escribir` desde su terminal interactiva; verificación en solo lectura; `git revert --no-commit` y commit con el interruptor en `false`; recién ahí el push. El `true` no queda en la rama al cierre de una sesión. |
| 51 | Verificador posterior versionado (19/10/2026) | `scripts/migracion/verificar-escritura.ts` (`npm run verificar:escritura`): compara la base contra el plan, solo SELECT, solo contra `evaristo_cms` (sin `--base`); contra `evaristo_cms_test` se usa desde los tests. Regla de correos: los de artículos y bios de autores del plan tienen que ser los del plan. Una escritura real no se repite para verificar. |
| 52 | Texto plano (20/10/2026) | `textoPlanoDe` separa las fronteras de bloque sin partir nodos con marcas e incluye epígrafes, autor y fuente de citas y notas al pie; no incluye alt, href ni datos de video. Antes, 231 de 2.637 artículos tenían más de 1 % menos palabras que el cuerpo. Ahora la secuencia de palabras coincide con un recorrido independiente en los 2.637. |
| 53 | Texto plano de los 35 ya escritos (20/10/2026) | Se regenera en la fase 7 con `--sobrescribir`, junto con el resto del corpus (solo cambia `articulos.textoPlano`). Mientras tanto, 19 artículos de `evaristo_cms` tienen el texto plano viejo y `verificar:escritura --muestra` sale con 1 (esperado). |
| 54 | URL canónica del artículo (21/10/2026) | `/AAAA/MM/DD/slug/`, la de WordPress, con la fecha de `publicadoEn` en UTC (reproduce 33 de los 34 orígenes de la muestra; el 19899 difiere por un carácter invisible del slug viejo). Fecha o barra final distintas redirigen con 301. Sin redirección para lo migrado. |
| 55 | Imágenes del artículo (20 y 21/10/2026) | En el cuerpo: proporción original, sin recorte, altura máxima 80vh, `width` y `height` desde la tabla `imagenes`. Encabezado: proporción fija 3:2 con punto focal, de borde a borde en celular. |
| 56 | Ruta `/media/<clave>` (21/10/2026) | `MEDIA_DIR` (sin ella, 503); la fila de `imagenes` decide el archivo (igualdad exacta en JavaScript), un solo segmento, tipos según `tipoMime`, `nosniff`, ETag con el SHA-256 y caché de un día. Detalle en `estado-fase3.md`. |
| 57 | Listados y volanta (21/10/2026) | `/author/<slug>/` (la URL de WordPress), `/seccion/<slug>/` y `/categoria/<slug>/` son URLs propias; de la más nueva a la más vieja, 12 por página con `?pagina=N`. Las secciones internas no tienen página. La volanta es un enlace a la categoría principal. |
| 58 | Redirecciones en el servidor (21/10/2026) | Middleware de Express después de los estáticos y antes del sitio: busca el pedido con o sin barra final y con los `%XX` en minúscula, elige la fila con igualdad exacta, no redirige si el destino es el mismo pedido y solo lleva a artículos visibles o autores con página. Las URLs de WordPress que no están en la tabla quedan para la fase 7. |
| 59 | Base de desarrollo (21/10/2026) | El panel y la API se desarrollan contra `evaristo_cms_dev` (copia de la real; `DATABASE_URL_DEV`, flag `--base-dev`). No contra la real ni contra `evaristo_cms_test`, que los tests de la migración vacían. |
| 60 | Contraseñas y sesiones (21/10/2026) | Hash `scrypt` de `node:crypto`. Sesiones en la tabla `sesiones` (código de 32 bytes, solo su SHA-256 en la base; cookie `httpOnly`, `SameSite=Strict`, `Path=/api`, 12 horas). Mismo error para email inexistente, usuario inactivo y contraseña incorrecta; límite de 10 fallos cada 15 minutos; pedidos que cambian datos solo desde el propio sitio. |
| 61 | Edición de artículos publicados (21/10/2026) | Como el sitio lee la base en cada pedido, un publicado se edita en un borrador de cambios (`articulos_borradores`) y recién "Publicar cambios" lo aplica; los BORRADOR se guardan directo. Ediciones simultáneas: cada guardado manda la versión que abrió y, si otra persona guardó antes, el servidor responde 409 sin pisar. |
| 62 | Panel (21/10/2026) | `react-router` para el enrutado (preferencia para toda app de React); estilo propio y neutro, sin la identidad del sitio; dependencias aceptadas con versión exacta: `zod`, `helmet`, `express-rate-limit`, `react-router` (instaladas), `multer`, `sharp`, TipTap y `jsdom` (sin instalar). |
| 63 | Letra capital y datos (21/10/2026) | La letra capital es una columna del artículo (`conCapital`, falsa por defecto, también en lo migrado); el renderizador no tiene ninguna regla para firmas "Por …" dentro del cuerpo (se quitan a mano en la revisión). Se sacó a mano el correo de la bio del autor 60 (`wpUserId` 39). |
| 64 | Una sola cita (22/10/2026) | Hay un único formato de cita en el sitio y el panel: la caja de la maqueta (`blockquote.cita`, fondo accent-50, barra de 4px, comilla decorativa), con autor y fuente opcionales en `<cite>`. Se sacó la "cita textual" provisoria (`figure.cita-textual`). El atributo `variante` (textual o destacada) queda en los datos por compatibilidad (el conversor lo sigue escribiendo) pero el renderizador lo ignora, así que todas las citas, incluidas las que migre el conversor desde `<blockquote>` de WordPress, salen con el diseño de la maqueta. En el panel hay un solo botón "Cita" y los campos de autor y fuente siempre disponibles. Ningún artículo de la muestra tiene nodos `cita`. |
| 65 | Subida de imágenes (22/10/2026) | Las subidas van a una carpeta propia (`MEDIA_DIR_SUBIDAS`); `/media` busca primero ahí y después en `MEDIA_DIR`, así la muestra queda intacta (en producción pueden ser la misma). Tipos JPEG, PNG, WebP y GIF decididos por el contenido real; máximo 10 MB y 8000 px por lado. Se guarda una versión normalizada: se aplica la rotación EXIF y se borran todos los metadatos (GPS, cámara, fechas), conservando el perfil de color; los GIF y WebP animados se guardan tal cual. Una imagen con el mismo contenido (SHA-256) que otra ya cargada no se vuelve a guardar: se reusa. La clave es un tramo seguro (`nombre-sin-tildes-<12 del hash>.<ext>`). Solo se puede borrar una imagen que no se use (cuerpo, borrador de cambios, encabezado, redes, galería, foto de autor); el archivo solo se borra de la carpeta de subidas. El recorte es el punto focal (no destructivo) y solo para el encabezado, que el sitio muestra en 3:2; las imágenes del cuerpo se ven enteras. Las variantes de tamaño (`srcset`) quedan para más adelante, junto con el procesamiento de las imágenes migradas (fase 7). |
| 66 | Publicar y programar (22/10/2026) | Programar es dejar el artículo PUBLICADO con una fecha futura: el sitio ya oculta lo que tiene fecha futura y lo muestra solo al llegar, sin procesos. El estado que ve el panel es calculado (programado = publicado con fecha futura); el estado `PROGRAMADO` de la base queda sin usar. Despublicar vuelve a BORRADOR conservando la dirección y la fecha (se rechaza si hay cambios sin publicar). Publicar exige sección elegida, encabezado con texto alternativo y texto; la dirección provisoria (`borrador-…`) se genera desde el título. Si la URL de un artículo que ya estuvo publicado cambia, la anterior redirige con 301; una URL que coincida con la redirección de otro artículo no se publica. |

### 3.3 Tareas pendientes

1. **Artículo 5360.** Cuatro íconos de Word (`interior/image001.gif` a `004.gif`) quedaron como imágenes sueltas con ruta relativa. Hace falta bajar `wp-content/uploads` para decidir si se rescatan o se sacan. Es el único artículo que falla en modo estricto.
2. **Revisión manual** del 593 ("Entrevista a Yasukata Tsutsui", queda en Asia por prioridad), del 18633 (título vacío, ahora en Entrevista) y de los dos títulos que empiezan con "Entrevista". Están anotados en el README del conversor.
3. **Notas al pie del 4265 (error del conversor):** cada nota tiene dos anclas (`name` y `href`) y el conversor las cuenta como dos; avisa `nota_duplicada` ×13 y no convierte ninguna. Pasa en 2 artículos del corpus.
4. **Enlaces internos:** el conversor conserva los enlaces propios al dominio y los registra en `assets.internalLinks` ("para reescribir luego"), pero no se reescriben. Hay 28 enlaces de texto a artículos (sobreviven como URL absoluta; los resuelve la redirección 301) y 28 de texto a `uploads` (solo 2 sobreviven: falta averiguar qué pasó con los otros 26). Decidir en la fase 7.
5. **Guion blando U+00AD:** el plan decía 228 apariciones en el 620; la verificación del 20/10/2026 no encontró ninguna en los cuerpos convertidos. Aclarar antes de la fase 6.

### 3.4 Taxonomía: respuesta de la editorial (7/10/2026) y resultado de la migración

La dueña de la revista respondió el mail:

- **Rastros** es la sección de literatura negra y se queda como sección.
- **Seda** era la revista de estudios asiáticos que dirigía Damián Vives; propuso conservar el nombre o cambiarlo a Asia. Quedó como **Asia**.
- **México** se elimina, y sus artículos se reparten entre las demás.
- **Novedades** era una sección de reseñas de libros recién salidos (a veces con entrevistas). En el modelo cerrado pasa a ser el campo `novedadHasta`.
- Pidió que un artículo pueda estar en varias secciones a la vez. El modelo cerrado lo resuelve con una sección, categorías con página propia y la marca de novedad.
- El resto de las categorías "está bien así".

Datos de partida del relevamiento: 26 categorías planas; 1.862 artículos con 1 categoría, 625 con 2, 141 con 3 y 9 con 4 (775 con 2 o más). Con la regla anterior quedaban 104 artículos sin sección y 589 artículos se detectaban como entrevistas por el título.

**Resultado con la regla vigente (13/10/2026, sobre los 2.637 artículos):**

| Sección | Con la regla anterior | Con la regla vigente |
|---|---|---|
| Entrevista | 0 | 469 |
| Asia | 379 | 414 |
| Reseña | 426 | 348 |
| Rastros | 190 | 245 |
| Literatura | 457 | 237 |
| Música | 189 | 172 |
| Historieta | 123 | 113 |
| `sin-asignar` | 104 | 103 |
| Poesía | 166 | 102 |
| TV & Cine | 110 | 99 |
| Ensayo | 124 | 81 |
| Teatro | 91 | 73 |
| Fantástico | 112 | 68 |
| Crónica | 47 | 35 |
| Libro Ilustrado | 34 | 32 |
| Arte | 42 | 23 |
| Infantojuvenil | 43 | 23 |

- Rastros y Asia no bajan del mínimo (190 y 379): suben a 245 y 414.
- 591 artículos son candidatos a Entrevista por el título, pero 122 quedan en Rastros o Asia por prioridad. Cambian de sección 559 artículos respecto de la regla anterior.
- `sin-asignar` (103): 95 solo con Novedades, 7 solo con Uncategorized y 1 solo con "Artículos" (el 22590). No hay slugs de WordPress sin mapear.
- Categoría principal: 1.609 artículos (61 %) sin categorías finales y, por lo tanto, sin volanta; 952 con una, 74 con dos y 2 con tres. Las dos únicas categorías fuera de la lista de prioridad ("Poesía rumana", artículo 22349, y "Encuentro Internacional Literatura Fantástica", artículo 21482) están en artículos con una sola categoría.
- La tabla `categorias` de la base real arrancó vacía: el script crea por slug (upsert) las que faltan. Con la muestra ya están creadas las ocho (entrevista, resena, ensayo, poesia, historieta, tv-y-cine, fantastico y literatura). El slug de la sección TV & Cine es `tv-y-cine`.

**Pendiente de confirmar con la editorial:** el modelo final (una sección por artículo más categorías y `novedadHasta`, en vez de varias secciones) y el nombre Asia.

### 3.5 Autoría

- El autor de WordPress es la única señal de autoría: solo unos 29 artículos tienen una firma en el cuerpo, y la cuenta administradora figura como última editora casi siempre, así que no distingue quién subió cada artículo.
- Cuentas personales: se toman como autor (de 27 firmas encontradas, 18 coinciden con el autor de WordPress y 9 no).
- Cuentas institucionales y las cuatro adicionales: autores de solo texto (caso 8.5 de la especificación del artículo). Las 7 cuentas están en `datos/migracion/cuentas.json` (ids de WordPress 1 eva, 192 Anonimo, 203 revistaseda, 245 Evaristo Cultural, 279 Evaristo, 418 Encuentro Internacional de Cultura Japonesa y 419 EL FESTIVALON), verificadas contra la base en cada corrida. `revistaseda` queda como autor de solo texto, salvo que se decida otra cosa en la revisión posterior.
- Casos para la revisión posterior a la importación: las 9 firmas que no coinciden, las 2 firmas dentro de cuentas institucionales, los 51 títulos con el autor adelante, firmas históricas cargadas por otra cuenta (por ejemplo Wilde, Fogwill, Tawfiq Al-Haqim y Roett) y variantes del mismo crédito de imagen ("Luca Frondoni" y "lucafrondoni").

### 3.6 Inventario de la base de WordPress (13/10/2026)

**Base local:** MariaDB 11.8.9 portable en 127.0.0.1:3307, base `evaristo_lectura` (cargada el 6/10/2026 desde el dump del 5/10). Se arranca a mano y se apaga con `mariadb-admin … shutdown` (comandos en `glosario-comandos-bases.md`). Todo el inventario se hizo con `SELECT` y la sesión en solo lectura. Verificado: 2.637 publicados y 48 borradores (`post_type='post'`); además hay 1 artículo privado (el 19300). `wp_terms` y `wp_term_taxonomy` tienen 6.016 filas, y `wp_term_relationships`, 12.985.

**Taxonomías:** además de `category` (26 términos, 3.571 relaciones con publicados) y `post_tag` (5.959 términos, 9.300 relaciones con publicados), hay cinco más (`bp-email-type`, `exactmetrics_note_category`, `novelist-genre`, `nav_menu`, `wp_theme`) sin artículos publicados: no afectan a la migración.

**Etiquetas:** los 5.959 son términos únicos. 5.926 se usan en artículos publicados y 31 no tienen ninguna relación. 2.250 artículos publicados tienen al menos una etiqueta (4,1 en promedio) y 387 no tienen ninguna. Las más usadas: "narrativa argentina" (169), "Poesía" (93), "Literatura argentina" (92), "Japón" (79) y "poesía argentina" (61).

**Postmeta de artículos publicados** (2.016 claves distintas, unas 1.966 son cachés de oEmbed):

| Dato | Qué hacer |
|---|---|
| `cb_visit_counter` (2.637 artículos) | Se guarda en `visitasWp` (decisión 22). |
| `_wp_old_slug` (83 artículos, 107 filas) | Sirve para redirecciones. Se descartan los valores solo numéricos (69), los 2 que coinciden con el slug actual y los terminados en `__trashed` (4 artículos: 15077, 15244, 20552 y 21831); quedan unos 34 slugs reales (decisión 26). |
| `cb_image_credit` (12 artículos) | Crédito de la imagen de encabezado. Hay variantes del mismo nombre y un valor con espacio final (4500). |
| `_thumbnail_id` (2.635 artículos; 13 con más de una fila) | Imagen de encabezado. En los 13 las dos filas apuntan al mismo adjunto; se elige la de menor `meta_id`. |
| `_webdados_fb_open_graph_*` (1.230 filas) | Casi vacías: 1 descripción (19660) y 5 imágenes con contenido (decisión 24). |
| `_yoast_wpseo_*` | Solo el artículo 13898 tiene metadatos: no aporta. |
| `cb_*` de maquetación del tema (`cb_review_checkbox` vale 0 en todos), `_edit_lock`, `_edit_last`, `_cb_dropcap`, `_wp_page_template`, `original_post_id`, `_publicize_pending`, `_wp_old_date`, cachés de oEmbed | Se descartan. |

**Usermeta:** hay 443 usuarios. Las 200 bios (`description`) coinciden con lo esperado (una trae un correo, la del usuario 39; otra, la del 278, un usuario de Instagram); `first_name` y `last_name` tienen valor en 358 y 355; `position`, `publicemail` y `googleplus` están vacíos.

**Otros datos (15 y 16/10/2026):** `gmt_offset` es 0 y no hay `timezone_string`, así que `publicadoEn` coincide con `post_date`, salvo en los borradores, que traen `post_date_gmt` en ceros. Los 48 borradores no tienen `post_name` (45 tienen contenido, 18 tienen título y 5 imagen destacada; 42 son de la cuenta "eva"). Hay un slug con un carácter invisible (el 19899). No hay colisiones de slug en el corpus con la intercalación `utf8mb4_es_0900_ai_ci`.

**Criterio de cierre de la fase 0:** el conversor transforma los 2.637 artículos sin pérdida de texto, con las notas al pie bien numeradas, y todo lo que no pudo convertir figura en las advertencias. Cumplido; queda el 5360 (3.3).

## 4. Fase 1: esqueleto de punta a punta

**Tareas:**

1. Repositorio con la estructura del proyecto: API (Express 5), sitio público (Astro), panel (React + Vite) y código compartido (tipos, editor, renderizador del cuerpo, validador y conversor).
2. Un solo servidor Node: Express monta la API en `/api`, el panel en `/admin` y las páginas de Astro como handler para el resto (adaptador de Node de Astro, `mode: 'middleware'`).
3. Prisma conectado a MySQL 8.4 (utf8mb4, intercalación en español), con un modelo de prueba.
4. Una página de Astro que lea de la base con Prisma.
5. Despliegue en el entorno de pruebas del VPS (decide los puntos de hosting y despliegue pendientes del stack).
6. Lockfile, versión de Node fijada, Renovate o Dependabot, y el principio de la documentación de instalación y despliegue.

**Estado (20/10/2026): esqueleto hecho en local**, en el repositorio `evaristo-cultural-cms` (privado, en GitHub; rama `main`; último commit verificado `c570d19`).

- Monorepo con npm workspaces: `apps/sitio` (Astro 7), `apps/panel` (React 19 + Vite 8), `apps/api` (Express 5) y `packages/compartido` (Prisma 7, cliente único, exports, conversor y validador). Node 24 (`.nvmrc`) y TypeScript 7.0.2.
- Un solo proceso en el puerto 3000: Express atiende `/api`, el panel sale en `/admin/` (con `noindex`) y Astro (SSR, modo middleware) atiende el resto. Las páginas públicas no emiten cookies.
- Prisma conectado a MySQL 8.4 (puerto 3308 en la Galaxy, instalado con el MSI; la 8.0 que ya existía sigue en el 3306, detenida). Bases `evaristo_cms`, `evaristo_cms_shadow` y `evaristo_cms_test` con `utf8mb4_es_0900_ai_ci`, un modelo de prueba y una página de prueba que lee de la base.
- Intercalación: Prisma fija `utf8mb4_unicode_ci` en las tablas. Las migraciones se crean con `npm run db:nueva -- <nombre>`, que se la quita, y `npm run db:verificar` lo comprueba (no detecta migraciones pendientes ni revisa datos; para eso se usa `prisma migrate diff`). La base shadow la recrea Prisma con la intercalación por defecto del servidor y no importa.
- Charset UTF-8 por middleware de Astro y un único cliente de Prisma (un solo pool) para la API y el sitio.
- `packages/compartido/src/generated/` (cliente de Prisma) está ignorado por git: en un clon nuevo hay que correr `prisma generate` y, para el sitio, `astro sync` antes de `typecheck`.
- README con instalación, scripts, arquitectura, el modo de ejecutar cada comando de migración, su modelo de seguridad, el orden de la "Primera escritura real" y cómo seguir en otro equipo, con la nota de Smart App Control de Windows 11 (bloqueó el binario nativo de Astro en la Galaxy).

**Falta de la fase 1:** verificar a mano `/admin/` en el navegador; el despliegue en el entorno de pruebas (tarea 5, con las definiciones del stack: hosting, almacenamiento de imágenes, método de despliegue, sesiones y correos); Renovate o Dependabot y la documentación de despliegue; helmet con una política definida a propósito; la prueba del apagado ordenado en Linux; y revisar las 6 advertencias de `npm audit` sin aplicar `audit fix`. El sitio tendrá que servir `/media/<clave>` (decisión 31), sea desde disco o desde S3/R2.

**Criterio de cierre:** la página de prueba se ve en el entorno de pruebas, servida por el mismo proceso que la API y el panel. Cumplido en local; falta en el entorno de pruebas.

## 5. Fase 2: modelo de datos y migración de la muestra

### 5.1 Modelo de datos

**Estado: hecho**, en dos tandas sobre `packages/compartido/prisma/schema.prisma`, con una prueba automática (`npm run db:probar-modelo`, 48 comprobaciones) que comprueba las relaciones, los `Restrict` y `Cascade`, las unicidades, el campo `visitasWp` con y sin valor y que un cuerpo de 5 MB y un texto plano de 2 MB se guardan y vuelven completos.

- **Tanda 5a (`219d3cb`):** `secciones` (18 sembradas, 1 interna), `categorias`, `autores`, `articulos` y las tablas intermedias `articulos_categorias` y `articulos_autores` (esta guarda el orden de los autores).
- **Tanda 5b (`06872de`):** `imagenes`, `articulos_galeria`, `fichas_tecnicas`, `usuarios` y `redirecciones`, más las columnas nuevas de `articulos` (imagen de encabezado con alt, crédito y punto focal; datos para redes; `altPendientes`) y de `autores` (foto con alt y punto focal).
- **`9e55763`:** comentario del campo `visitasWp` (sin migración nueva). Se conserva `PruebaConexion` hasta limpiar la página de prueba.

**Contenido del modelo:**

- **Artículo:** título, slug, bajada, cuerpo (JSON, con `schemaVersion` por artículo), texto plano del cuerpo (para el buscador), estado, fecha de publicación (null en los borradores migrados), sección (obligatoria), categorías (varias) y categoría principal (opcional, para la volanta), `novedadHasta` (fecha opcional), datos para redes (con sobrescritura), etiquetas originales de WordPress (campo de archivo, oculto), avisos de migración (para la revisión posterior), `altPendientes` (contador de imágenes sin texto alternativo, que calcula el servidor al guardar), `visitasWp` (contador histórico de WordPress, solo lectura, no se muestra) y `wpId`.
- **Imagen de encabezado** (con punto focal, texto alternativo y crédito) y **galería** (con epígrafes). Las imágenes dentro del cuerpo son nodos del documento que referencian a la biblioteca de imágenes con `imagenId` y `src` `/media/<clave>` (decisión 31); las migradas sin texto alternativo llevan `altPendiente`. Un artículo sin encabezado se puede guardar (2 de WordPress no tienen, más los del aviso `original_faltante`); la obligatoriedad se exige al publicar, en la API.
- **Biblioteca de imágenes (`imagenes`):** obligatorios clave, nombre original, tipo MIME, ancho, alto, bytes y hash; solo `wpId` acepta null (y es único).
- **Ficha técnica del libro:** una por artículo, con todos los campos opcionales. El autor es el del libro, en texto libre.
- **Autores** (con bio, foto y redes), incluidos los autores que no son personas (cuentas institucionales, solo texto).
- **Secciones** (las 17, más la interna `sin-asignar`, con slug único) y **categorías** (lista ampliable, con página propia), con sus relaciones: una sección por artículo y categorías muchos a muchos.
- **Usuarios y roles** (EDITOR y ADMINISTRADOR), sin sesiones todavía.
- **Tabla de redirecciones:** URLs viejas de artículos (`/año/mes/día/slug/`), slugs anteriores (`_wp_old_slug`) y `/author/…` (no para autores de solo texto), más destinos manuales.
- **Convenciones:** nombres de tabla en minúscula con `@@map` (MySQL en Windows guarda los nombres en minúscula y en Linux respeta las mayúsculas). Migraciones con `npm run db:nueva -- <nombre>` y comprobación con `npm run db:verificar`, que también revisa que los 11 modelos tengan `@@map` en minúscula y que las 12 tablas usen la intercalación correcta.
- **Borrados:** `Restrict` en sección, categoría, autor e imagen en uso; `Cascade` en las tablas intermedias, la galería, la ficha técnica y las redirecciones de un artículo o autor que se borra.

**Lo que la base no valida y tienen que validar la API y el script de migración:**

- que la categoría principal esté entre las categorías del artículo;
- que cada redirección tenga exactamente uno de los tres destinos (`articuloId`, `autorId` o `destino`);
- que los puntos focales estén entre 0 y 1;
- que no se borre una imagen usada en el cuerpo de un artículo (esas referencias no son claves foráneas);
- que el `src` `/media/<clave>` de un nodo de imagen corresponda a su `imagenId` (lo comprueba el script);
- que el email del usuario se guarde en minúsculas;
- que `visitasWp` no se devuelva hacia el sitio ni el panel (`select` explícito en la API);
- que no se publique un artículo con slug `borrador-…` (decisión 27);
- que `articulos_galeria`, que no tiene clave única, no duplique filas en una segunda corrida (el script la reemplaza dentro de una transacción).

**Comportamiento de la intercalación `es_0900_ai_ci` (comprobado):** los slugs y los emails que solo difieren en mayúsculas o tildes se rechazan como duplicados (la base distingue ñ de n). El script de migración revisa las colisiones de slug antes de insertar, y verifica que las columnas (`slug`, `origen`, `clave`) usen realmente esa intercalación. Un login por email no distingue "prúeba@" de "prueba@".

### 5.2 Script y conversor de migración

Vive en `packages/compartido` (decisión 25). Diseño completo, decisiones y estado en `diseno-script-migracion.md`. Lee de la base de WordPress (la base local `evaristo_lectura`, ver 3.6) y escribe en el CMS con Prisma, con simulación por defecto, un destino fijado a `127.0.0.1:3308`, transacción por artículo y re-ejecución sin pisar (decisión 42). La lógica de armado es una función pura (`armar()`), que se prueba con un snapshot versionado de WordPress. La escritura va por un comando aparte (decisión 43), con un usuario de base de solo datos y un interruptor de código que la mantiene cerrada salvo durante cada escritura real (decisiones 44 y 50). Por cada artículo:

- **Párrafos:** aplica la lógica de `wpautop` de WordPress, porque el 72% de los artículos no tiene `<p>` en la base. Limpia los `&nbsp;` y los bloques vacíos.
- **Formatos:** conserva negrita, itálica, enlaces, listas, citas, tablas y la alineación de párrafo. Descarta colores, tipografías, tamaños, estilos en línea y subrayado. Baja de nivel los H1 del cuerpo.
- **Shortcodes:** interpreta solo `[embed]`, `[caption]` y `[gallery]`. Los corchetes que no son shortcodes no se tocan.
- **Imágenes:** `[caption]` y `<img>` pasan a nodos de imagen con epígrafe, `imagenId` y `src` `/media/<clave>`. Se descargan los originales de `wp-content/uploads` (carpeta plana, 10.975 archivos), se reprocesan y se reescriben las rutas. Las 77 del dominio temporal se buscan por nombre de archivo. Las que no tienen texto alternativo (2.431, en 813 artículos) quedan con `altPendiente`. Ancho, alto, bytes, hash y MIME se miden del archivo. El crédito del encabezado sale de `cb_image_credit` (12 artículos); si hay más de una fila de `_thumbnail_id` (13 casos), se elige la de menor `meta_id`. Si el original no existe o no se puede medir, no se crea fila (decisiones 30, 36 y 41).
- **Videos:** YouTube y Vimeo pasan a nodos de video. Facebook e Instagram pasan a enlace.
- **Notas al pie:** según las variantes de 5.3.
- **Títulos:** división y normalización según `prueba-inicial.md`, sección 5.5. Los "AUTOR | TÍTULO" quedan enteros y marcados. Se limpia el U+200E (decisión 28).
- **Texto plano para el buscador:** función pura del cuerpo (decisión 52).
- **Clasificación:** aplica la tabla de mapeo y el orden de prioridad de la decisión 16, pasa el resto a categorías (creándolas por slug si faltan), elige la categoría principal con la regla de la decisión 23, deja `novedadHasta` vacío, manda a `sin-asignar` los artículos sin sección posible y guarda las etiquetas ocultas. Detecta los slugs que chocan antes de insertar.
- **Fichas técnicas:** quedan como texto del cuerpo.
- **Autores y bios:** crea los autores con nombre y slug (las 7 cuentas de `cuentas.json` como solo texto), importa las bios existentes tal cual (también la que trae un correo, con el aviso `bio_con_correo`; decisiones 38 y 40), genera la planilla con las bios que encuentra al final de los artículos y las saca del cuerpo solo cuando está seguro.
- **Datos para redes:** pasa como sobrescritura solo las descripciones e imágenes de Facebook que tienen contenido.
- **Contador de visitas:** guarda `cb_visit_counter` en `visitasWp` (decisión 22).
- **Borradores y privado:** migran como BORRADOR con slug `borrador-<wpId>` (decisiones 27 y 37). Cualquier otro estado se excluye (decisión 39).
- **Redirecciones:** genera las 301 de artículos publicados, slugs anteriores y autores con página, con la URL vieja tal cual (decisión 20).
- **Metadatos que se descartan:** maquetación del tema (`cb_*`), cachés de oEmbed, `original_post_id`, `_publicize_pending` y Yoast (ver 3.6).
- **Re-ejecutable:** usa `wpId` y `wpUserId`. Una segunda corrida no pisa nada de lo que existe; solo `--sobrescribir` confirmado lo reescribe (decisiones 32 y 42).
- **Informe:** registra por artículo todo lo que no pudo convertir, para la revisión manual.

### 5.3 Notas al pie en WordPress

No hay shortcodes de plugins ni notas nativas de WordPress 6.3. Todas son manuales, con restos de Word y LibreOffice (unos 185 artículos, el 7%):

| Variante | Artículos | Conversión |
|---|---|---|
| Word, notas al pie (`_ftn1` / `_ftnref1`) emparejadas | 75 | Automática |
| Word, notas al pie que no cierran (marcas sin notas, notas sin marcas o cantidades distintas) | 32 | Parcial, con revisión |
| LibreOffice (`sdfootnote`) | 5 | Automática |
| Word, notas finales con numeración romana (`_edn1`) | 23 | Automática, emparejamiento por verificar |
| Texto plano `[1]`, `[2]`, sin ancla | 46 | Solo si la numeración es consecutiva |
| Dudosas y `<sup>` sin ancla | 8 | Revisión |

Regla general: se convierte solo cuando el emparejamiento número–nota es claro; si no, el texto queda como está y el artículo se marca para revisión. El artículo con más notas tiene 54. Caso conocido: el 4265 (cada nota con dos anclas, `name` y `href`) no convierte ninguna.

### 5.4 Muestra de 35 artículos

Elegida a propósito para cubrir cada variante: los más viejos, el más largo, los más cargados de imágenes, cada variante de notas al pie, los embeds, las tablas, las fichas técnicas, las bios y un autor institucional (detalle en `relevamiento-wordpress.md`, sección 12). Son 30 artículos (`muestra-wordpress.json`) más 5 de la ampliación del 15/10/2026 (`datos/migracion/muestra-extra.json`):

| Id | Casos que cubre |
|---|---|
| 19660 | Crédito de imagen de encabezado y datos de Facebook (descripción e imagen) |
| 19899 | Slug y título con U+200E |
| 12526 | `_wp_old_slug` real |
| 15244 | `_wp_old_slug` terminado en `__trashed` (se descarta) |
| 22546 | Borrador (slug `borrador-<wpId>`, `post_date_gmt` en ceros) |

El artículo privado 19300 no está en la muestra: su regla se prueba con un test sintético.

**Simulación (17/10/2026):** 35 convertidos y 0 inválidos; 34 PUBLICADO y 1 BORRADOR (22546); 58 redirecciones (34 de artículo, 23 de autor y 1 de slug anterior); 25 autores (2 de solo texto); 0 colisiones de slug; 8 categorías a crear. Imágenes: 202 distintas (34 de encabezado, 169 del cuerpo y 1 de Facebook), 200 con archivo medido (192 JPEG, 4 PNG y 4 GIF, 25.246.976 bytes) y 2 sin original (2462 y 22546); 172 nodos de imagen del cuerpo enlazados. Avisos: `fecha_borrador` en el 22546 y `bio_con_correo` en el 22255. Tres artículos sin encabezado: 2462, 22546 y 22590 (este no tiene `_thumbnail_id` en WordPress).

**Escritura real (19 y 20/10/2026):** 19/10/2026, el 12526 (`culpables-dellutri`: sección ensayo, categoría literatura, autor 278, imagen `culpa.jpg`, 3 redirecciones); 20/10/2026, los otros 34 con `--muestra --esperar-articulos=35 --abortar-al-primer-error`: `estado ok`, 34 escritos, 1 sin cambios, 0 fallidos, 55 redirecciones creadas y 3 sin cambios, 0 conflictos. Conteos de `evaristo_cms`: 35 artículos, 35 `articulos_autores`, 12 `articulos_categorias`, 25 autores, 8 categorías, 200 imágenes, 58 redirecciones, 18 secciones y 3 `_prisma_migrations`; galería y fichas en 0.

**Verificación:** `verificar:escritura --muestra`: 35 artículos, 1.059 comprobaciones, 0 diferencias. **Comparación independiente contra WordPress** (script propio sin código de la migración): 0 diferencias duras en identidad y estado, autoría y bios, clasificación, títulos, redirecciones (58 como conjunto), integridad y privacidad; las 200 imágenes coinciden en hash, bytes, MIME y dimensiones medidos del archivo. Los únicos correos de la base son los del cuerpo del 16691 (escritos por su autor) y la bio del 39. A revisar (41 casos, todos explicados): enlaces a imágenes, notas al pie del 4265 y diferencias de texto plano (corregidas en `c570d19`; pendiente regenerarlas en la fase 7: decisión 53).

**Criterio de cierre: cumplido (20/10/2026).** El modelo de datos está hecho, el script se probó contra la base de pruebas y se usó en la base real, la muestra migrada coincide con WordPress sin pérdida de contenido y lo que no se pudo convertir quedó marcado.

## 6. Fase 3: sitio público (artículo y autores)

Especificaciones cerradas, por eso va primero. Las decisiones de diseño visual que se van tomando están en `decisiones-de-diseno.md` (con páginas de muestra en `referencias/maquetas/index.html` y `referencias/maquetas/nota-con-notas-al-pie.html`). Antes de escribir código se hace un reconocimiento técnico de solo lectura: estado del sitio de Astro, dónde está el renderizador de la prueba del editor, inventario real de nodos y atributos de los 35 artículos, cómo servir `/media/<clave>` (carpeta de originales configurable, sin salirse de la carpeta) y un plan por pasos con el aspecto intercambiable por variables CSS. Estado: **terminada en lo técnico (21/10/2026)**, ver `estado-fase3.md`. Quedaron fuera a propósito la portada real, el buscador y el menú en celular definitivo; siguen abiertos el `<head>` para redes (falta la URL base), las variantes de tamaño de las imágenes, la galería y la ficha técnica, y el visto bueno de la directora.

**Tareas:**

1. Renderizador del cuerpo: títulos, formatos, citas, alineación (con justificado y división silábica en pantallas anchas), notas al pie, imágenes con epígrafe (las pendientes con `alt` vacío; el `src` es `/media/<clave>`), videos (iframe con lista blanca) y tablas.
2. Página del artículo completa, en el orden de la especificación: cintillo, imagen de encabezado, volanta, título, bajada, autores, fecha, cuerpo, notas, ficha técnica, galería (con visor), bios y relacionados.
3. Página individual de autor y listado de autores (incluidos los autores que no son personas, solo como texto).
4. Imágenes en el tamaño justo para cada pantalla, metadatos para redes y marcado para buscadores (incluida la ficha técnica). Servir `/media/<clave>`.
5. Cabeceras de caché definidas en un solo lugar.
6. Página 404 propia del sitio.

**Reglas:** no devolver `visitasWp` (select explícito en cada consulta); los borradores no se muestran al público; páginas sin cookies; las rutas del artículo tienen que convivir con las 58 redirecciones 301 ya cargadas (ver `pendientes.md`: los enlaces internos de texto apuntan a la forma vieja `/AAAA/MM/DD/slug/`).

**Criterio de cierre:** los artículos de la muestra migrados se ven correctamente en celular y escritorio. *Cumplido en las pruebas automáticas (34 artículos con 200, imágenes, notas, autores, secciones y categorías); falta mirarlo en un navegador, en celular y en escritorio.*

**Qué se hizo respecto de las tareas:** 1, 2 y 3 hechas (la ficha técnica y la galería de la tarea 2 no se muestran todavía: ninguno de los 35 artículos las tiene); 4 parcial (`/media/<clave>` hecha; faltan los tamaños por pantalla y los metadatos para redes); 5 sin hacer como lugar único (las cabeceras de caché de `/media` y del sitio están donde se sirve cada cosa); 6 hecha. Además se hicieron las páginas de sección y de categoría, las redirecciones 301 en el servidor y la prueba de humo.

## 7. Fase 4: panel de administración

**Estado (21/10/2026):** en curso; ver `estado-fase4.md` (decisiones, lo hecho y lo que falta). Hecho: de la tarea 1, el ingreso, las sesiones, el límite de intentos, los roles y el alta del primer usuario por línea de comandos (falta la pantalla de usuarios y la recuperación de contraseña); la tarea 2; de la tarea 3, la API de edición con autoguardado en borrador de cambios y aviso de conflicto (falta toda la pantalla y el editor); la tarea 4 (`altPendiente` verificado en el servidor). Sin empezar: 5 (la vista de imágenes pendientes; la columna `altPendientes` ya se calcula), 6, 7, 8, 9, 10 y 11.

**Tareas:**

1. Login, sesiones, límite de intentos y roles (editor y administrador). Hay que definir el algoritmo del hash de contraseñas y dónde se guardan las sesiones; el email se guarda en minúsculas. Alta de los usuarios editores que van a seguir publicando (los de WordPress hay que recrearlos).
2. Listado de artículos con filtros por estado.
3. Alta y edición de artículos con el editor de la fase 0, incluidos los nodos de imagen (con `imagenId`), video y tabla: sección (una), categorías con la principal marcada (la API valida que sea una de ellas), `novedadHasta`, autoguardado, borradores, programación, confirmación al publicar. Al publicar se exige imagen de encabezado y texto alternativo en lo nuevo, se rechaza un slug que empiece con `borrador-` y, si el artículo venía de BORRADOR migrado (con `publicadoEn` null), se propone la fecha actual. La API no devuelve `visitasWp`. El texto plano se calcula con la misma función pura `textoPlanoDe` que usa la migración (decisión 52).
4. **Verificación de `altPendiente` en el servidor:** el servidor compara con la versión guardada antes y acepta la marca solo en imágenes que ya la tenían. Al guardar, recalcula `altPendientes`.
5. **Vista de artículos con imágenes pendientes de texto alternativo,** para completarlas de a poco (se apoya en `altPendientes`).
6. Vista previa, usando el renderizador de la fase 3.
7. Subida de imágenes con recorte y punto focal (validado entre 0 y 1), tanto para el encabezado como para las imágenes del cuerpo. No se puede borrar una imagen que esté en uso, ni siquiera dentro del cuerpo de un artículo (se detecta por `imagenId`).
8. Ficha técnica y galería.
9. Fichas de autor (con los permisos definidos) y gestión de secciones y categorías (solo administrador). Categorías y autores con artículos no se borran: en vez de "borrar" una categoría, el panel ofrece "unir con otra".
10. **Herramientas de la revisión posterior a la importación** (ver 10): filtros por aviso de migración (títulos, notas al pie, bios, `bio_con_correo`, autores, `original_faltante`, `imagen_sin_medir`, `origen_privado`, `fecha_borrador`) y vista de los artículos en `sin-asignar` y de los borradores migrados.
11. Mensajes de error en lenguaje común en todo el panel.

**Criterio de cierre:** un editor no técnico puede cargar y publicar una nota completa sin ayuda. Conviene probarlo con alguien de la editorial.

## 8. Fase 5: portada

Después de la reunión con la dueña de la editorial (secciones, quinta sección, topbar, footer, destacado). La especificación de portada se pensó con cinco secciones; con las 17 secciones del modelo cerrado hay que replantear los bloques antes de la reunión.

**Tareas:** topbar, encabezado con fecha, carousel (isla de React, con las reglas de accesibilidad de la especificación), bloques de sección, banda de últimas publicaciones y footer institucional.

## 9. Fase 6: especificaciones pendientes

1. Escribir las especificaciones de navegación, buscador y de cómo se muestran las novedades (`novedadHasta`). *Las páginas de sección y de categoría se hicieron en la fase 3 sin especificación aparte (URL propia, de la más nueva a la más vieja, 12 por página); si la editorial pide otra cosa, se ajustan.*
2. Implementarlas: menú definitivo, buscador FULLTEXT (quitando el guion blando U+00AD del texto plano) y novedades.

## 10. Fase 7: migración completa y lanzamiento

**Tareas:**

1. **Volver a exportar la base** justo antes de la migración (el dump actual es del 5/10/2026) y bajar `wp-content/uploads` completo del hosting. El hosting (Hostinger, plan compartido) vence el 28/11/2026: hacerlo antes de esa fecha y confirmar con el dueño del plan si se renueva. `uploads` pesa unos 7,9 GB con todos los derivados, en carpeta plana; hay acceso SSH. **El `tar` de Windows altera los nombres con tildes y símbolos:** usar otra herramienta y verificar los nombres contra `_wp_attached_file` (sensible a mayúsculas). Regenerar `snapshot-wp-muestra.json` si cambia la base.
2. Correr la migración de los 2.637 artículos publicados (más los 48 borradores y el privado 19300) con `--todos`, `--esperar-articulos=N` y la política de errores acordada, con la ceremonia de la decisión 50. Antes: decidir si hace falta una librería de imágenes (`imagen_sin_medir`), revisar los avisos de imágenes del cuerpo sin original (decisión 41), cambiar la consulta de colisiones de slug (hoy una por artículo) por una que escale, **regenerar el texto plano de los 35 ya escritos (decisión 53, `--sobrescribir`)**, decidir qué hacer con los enlaces internos de texto (28 a artículos y 28 a uploads), corregir las notas al pie del 4265 y, si se prevé re-migrar con editores trabajando, la columna con hash de lo migrado (decisión 32).
3. **Revisión por muestreo:** revisar a mano los artículos marcados por el conversor y una muestra de los demás, repartida por época, sección y tipo de contenido. Para los 2.637 conviene repetir la comparación independiente contra WordPress que se hizo con la muestra.
4. Repartir los artículos de `sin-asignar` (103) y cargar o completar las bios, fotos y redes de los autores desde la planilla (424 autores con artículos).
5. Redirecciones 301 de artículos, slugs anteriores y `/author/…`, y verificación de las URLs viejas más visitadas.
6. Backups funcionando (base e imágenes) y restauración probada al menos una vez.
7. Revisión final: celular, accesibilidad, velocidad, metadatos para redes.
8. Cambio de DNS a producción y seguimiento de errores 404 en los primeros días.
9. Documentación de instalación, despliegue y actualización terminada.

**Sumado en las fases 3 y 4 (21/10/2026):** (a) aplicar a `evaristo_cms` las migraciones `sesiones` y `borradores_y_capital` con `db:deploy` **antes** de migrar (el cliente de Prisma ya espera `articulos.conCapital` y `migrar:escribir` y `verificar:escritura` fallan contra una base sin esa columna; el verificador ya acepta más de 3 migraciones); (b) las redirecciones de las URLs viejas que no están en la tabla (`/category/…`, `/tag/…`, `/feed/`, `/?p=ID`, `/wp-content/uploads/…`, páginas fijas) y confirmar con el corpus completo que la fecha UTC de `publicadoEn` reproduce las URLs de los artículos (en la muestra, 33 de 34); (c) variantes de tamaño de las imágenes, `canonical` y `og:image`, y que el sitio lea `conCapital`; (d) crear los usuarios editores con `usuario:crear` o con la pantalla de usuarios; (e) cada pedido al sitio consulta `redirecciones`: poner una caché en memoria si la carga lo pide.

### Después de la importación: plan de revisión manual

Se arma con la planilla de avisos (`avisos-por-articulo.csv`, columna `revision_humana`) [Nota 21/10/2026: el CSV de `referencias/datos/` es un resumen por artículo, sin esa columna; la versión con `revision_humana` la genera `packages/compartido/scripts/conversor/run-corpus.ts` en `out/`, ignorado por git.] y se hace desde el panel, de a poco:

- **Usuarios editores:** recrear los que van a seguir publicando (la tabla `usuarios` no se siembra).
- **Bios con correo:** sanear a mano la del usuario 39 y las que marque `bio_con_correo`. Y el correo escrito por su autor en el cuerpo del 16691.
- Títulos: `palabra_ambigua` (361), `palabra_desconocida` (66), `revisar_autor_en_titulo` (51), `titulo_vacio` (2, artículos 5562 y 5602) y las 193 bajadas que nombran a una persona. Más el 19899.
- Imágenes pendientes de texto alternativo (813 artículos) y artículos con los avisos `original_faltante` e `imagen_sin_medir` (incluidas las imágenes del cuerpo que quedaron con el `src` del dominio viejo).
- Notas al pie que no cierran (unos 40, incluido el 4265), tablas y posibles bios en el cuerpo.
- Autoría: 9 firmas que no coinciden con el autor de WordPress, 2 firmas en cuentas institucionales y las cuentas de solo texto.
- Artículos en `sin-asignar` (reparto de sección), incluidos el 22255 y el 22590 ya publicados.
- **Borradores (48) y artículo privado 19300:** decidir si se publican o se eliminan, con la directora de la editorial.
- Entrevistas dudosas: 593 y 18633. Artículos con slug numérico (4265 y 15027). El artículo 5360.

### Después del lanzamiento

- **Segunda pasada de fichas técnicas:** un script semiautomático pasa a campos las ~369 fichas de libro escritas como texto.

## 11. Riesgos principales

- **Volumen:** 2.637 artículos y 10.975 imágenes. La revisión manual de todo no es realista, así que depende de que el conversor registre bien lo que no pudo convertir y de que la comparación independiente contra WordPress se repita para el corpus completo.
- **Párrafos sin `<p>`:** el 72% de los artículos depende de la lógica de `wpautop`. Es un punto de falla silencioso: se probó a fondo con la muestra y la comparación contra WordPress no encontró pérdidas.
- **Notas al pie:** el editor ya está probado. En la migración, unos 40 artículos con notas que no cierran necesitan revisión manual, y el 4265 (dos anclas por nota) es un error del conversor.
- **Imágenes:** hay que descargarlas del hosting (no vienen en el dump), y hay 77 que apuntan a un dominio temporal. Hay originales que ya no existen en el hosting (2 en la muestra), así que en la migración completa habrá más casos de `original_faltante`; si el faltante es una imagen del cuerpo, el artículo conserva el `src` del dominio viejo y se rompe cuando venza el hosting (decisión 41). Las dimensiones de WordPress no son confiables (2 de 200 difieren en la muestra): se miden del archivo. Un formato que el script no sepa medir (hoy mide JPEG, PNG y GIF) produciría `imagen_sin_medir`.
- **Contrato del cuerpo:** el cuerpo referencia la biblioteca con `imagenId` y `/media/<clave>` (decisión 31). El validador acepta el atributo, pero el panel y el sitio tienen que respetarlo antes de cargar cuerpos reales; si el editor del panel descarta atributos desconocidos del nodo imagen, hay que ajustarlo. **Confirmado el 21/10/2026:** el nodo de imagen del editor de la fase 0 no declara `imagenId`, así que guardar un artículo migrado lo perdería en las 172 imágenes; el paso 4 de la fase 4 lo agrega y lo prueba con los 35 cuerpos (la API de edición ya conserva el `imagenId` cuando se lo mandan).
- **Enlaces internos:** el conversor los conserva como URL absoluta del dominio viejo (los de texto a artículos) o los convierte en nodos de imagen (los de imagen a `uploads`), pero no los reescribe. Mientras el sitio nuevo viva en el mismo dominio, las redirecciones 301 los resuelven.
- **Escritura en la base real:** hecha dos veces con la ceremonia de la decisión 50 (respaldo, ensayo en seco, interruptor `true` en un commit aparte sin push, escritura interactiva, verificación y revert). El riesgo que queda es escalar a 2.637 artículos con `--todos` (consulta de colisiones que no escala, tiempos de transacción, más casos de imágenes sin original) y no olvidar regenerar el texto plano de los 19 artículos de la decisión 53. Las barreras: interruptor de código, destinos fijos, usuario de base sin DDL, confirmaciones (cantidad exacta de artículos y tipeo del nombre de la base), comando aparte que la simulación no alcanza, flujo con dependencias reales no falsificables y segunda barrera en `escribir.ts`.
- **Hosting:** el plan de Hostinger vence el 28/11/2026 y el sitio está compartido con el usuario (el dueño del plan es otra persona). La exportación final de la base y la descarga completa de `uploads` (unos 7,9 GB) tienen que hacerse antes de esa fecha.
- **Nombres de archivo con tildes en Windows:** `tar` los altera (ya pasó en la muestra). Usar otra vía para la descarga completa y verificar los nombres.
- **Taxonomía:** el modelo está cerrado y verificado (Rastros y Asia no pierden artículos). Falta confirmar con la editorial que una sección por artículo más categorías alcanza. Los 103 artículos sin sección posible quedan en `sin-asignar` hasta repartirlos.
- **Volanta ausente en el 61 % de los artículos migrados:** consistente con la especificación (opcional), pero conviene mirar cómo se ve el sitio.
- **Slugs que chocan:** la base compara sin distinguir mayúsculas ni tildes; hoy no hay colisiones en el corpus y el script revisa antes de insertar.
- **Datos personales en bios y cuerpos:** las bios se importan tal cual y una trae un correo (decisión 38); el cuerpo del 16691 también trae un correo escrito por su autor. Es información que el autor publicó, pero hay que sanearla a mano. El snapshot versionado los redacta y los informes del script no incluyen correos ni bios.
- **Reglas que la base no hace cumplir:** varias validaciones (categoría principal entre las categorías, destino único de las redirecciones, puntos focales, imágenes en uso dentro del cuerpo, email en minúsculas, no devolver `visitasWp`, no publicar slugs `borrador-`) dependen de la API (ver 5.1). Hay que escribirlas en la fase 4 y probarlas.
- **Re-migrar con ediciones manuales en curso:** el script no pisa nada de lo existente (decisión 42), pero no distingue una edición manual de una diferencia que genera el propio script; si se prevé re-migrar con editores trabajando, hay que sumar la columna con hash antes de la fase 7.
- **Base local de WordPress en Windows:** el MariaDB portable se arranca a mano y convive con MySQL80 (detenido), MySQL84 (CMS) y un `mysqld.exe` huérfano (PID 11864) que no se toca. Los prompts de Claude Code no pueden arrancar servidores: hay que comprobar los puertos antes. En PowerShell hay que usar las opciones largas de `mariadb-admin`.
- **Portada con 17 secciones:** el esquema de cinco secciones de la especificación ya no alcanza; se replantea con la editorial.
- **Avisos de títulos:** unos 480 avisos de revisión humana, concentrados en palabras ambiguas. Son correcciones rápidas, pero hay que hacerlas.
- **Autoría en cuentas institucionales:** el autor de WordPress no dice quién escribió esos 343 artículos (más 29 de cuentas adicionales); quedan como autores de solo texto.
- **Herramientas nuevas en Windows:** Smart App Control bloqueó un binario nativo de Astro en la Galaxy. En la Lenovo conviene comprobarlo antes de empezar. TypeScript 7 funciona con el stack actual; si una herramienta nueva falla por esa versión, se fija una anterior.
- **Dos copias del validador:** el `validate.ts` de `packages/compartido` es la canónica; la de `testing-tiptap` ya no se corrige.
- **Decisiones de la editorial:** la portada y el footer dependen de la reunión; el resto del plan no se frena por eso.
