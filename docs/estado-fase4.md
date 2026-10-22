# Fase 4 (panel y API): estado, decisiones y lo que falta

Actualizado el 22/10/2026. Pasos 1 a 3 hechos y mergeados en `main`; el paso 4 está en curso (etapas 4a y 4b hechas en la rama `fase4-editor`, sin mergear); faltan los pasos 5 a 8. El plan de la fase está en `plan-implementacion.md`, sección 7; los pendientes generales en `pendientes.md`, sección 1.

## Base de desarrollo

Se desarrolla contra **`evaristo_cms_dev`** (copia de `evaristo_cms` del 21/10/2026 con las 5 migraciones; `DATABASE_URL_DEV` en el `.env`). No contra `evaristo_cms` (la muestra verificada) ni contra `evaristo_cms_test` (los tests de la migración la vacían). La API y las herramientas la eligen con `--base-dev` (`src/entorno.ts` apunta `DATABASE_URL` a la de desarrollo y se niega si no es `evaristo_cms_dev`); `npm run dev:desarrollo -w @evaristo/api` arranca el servidor así. Las herramientas exigen elegir `--base-dev` o `--base-real`. Para recrearla: `glosario-comandos-bases.md`.

## Decisiones tomadas (21/10/2026)

1. **Hash de contraseñas: `scrypt` de `node:crypto`** (sin dependencia nueva).
2. **Sesiones: tabla propia `sesiones`** (código aleatorio de 32 bytes, en la base solo su SHA-256; cookie `httpOnly`, `SameSite=Strict`, `Path=/api`; sin `express-session`).
3. **Dependencias aceptadas** (versión exacta, fecha de publicación revisada): `zod` 4.6.5, `helmet` 8.3.0, `express-rate-limit` 8.7.1 (instaladas en `apps/api`), `react-router` 8.4.0 (instalada en `apps/panel`); `multer`, `sharp`, los paquetes de TipTap y `jsdom` (aprobadas, sin instalar).
4. **Enrutado del panel: `react-router`** (preferencia de Mariano para toda app de React).
5. **Diseño del panel: estilo propio y neutro**, sin la identidad ni los tokens del sitio (grises, un acento azul para las acciones, colores de estado solo donde informan). `apps/panel/src/estilos.css`.
6. **Autoguardado de un artículo publicado: borrador de cambios aparte.** El sitio arma cada página al pedirla, leyendo la base (no hay build), así que lo que se guarda sobre un publicado se vería al instante. Mientras se edita uno PUBLICADO o PROGRAMADO, el autoguardado va a `articulos_borradores` y el sitio sigue mostrando lo publicado hasta "Publicar cambios". Los BORRADOR se guardan directo sobre su fila.
7. **Ediciones simultáneas: avisar y no pisar.** Cada guardado manda la versión que se abrió; si otra persona guardó en el medio, el servidor responde 409 sin sobrescribir y el panel avisa "Este artículo cambió mientras lo editabas". Sin bloqueos al abrir.

## Hecho

**Paso 1: autenticación** (`apps/api/src/auth/`, `entorno.ts`, `herramientas/crear-usuario.ts`).
- Contraseñas con `scrypt` (N=32768, r=8, p=1), sal aleatoria, formato `scrypt$N$r$p$sal$hash` (los parámetros viajan con el hash), comparación en tiempo constante, de 10 a 200 caracteres.
- Sesiones de 12 horas (fijas, sin renovar con el uso). Un usuario desactivado o una sesión vencida dejan de servir en el acto. `Secure` con `NODE_ENV=production`.
- `POST /api/auth/ingresar`, `POST /api/auth/salir`, `GET /api/auth/yo`, con `zod`. El mismo 401 y el mismo mensaje para email inexistente, usuario inactivo y contraseña mal escrita (se verifica siempre contra un hash, real o de mentira). Límite de 10 fallos cada 15 minutos por dirección (los ingresos correctos no cuentan).
- Los pedidos que cambian datos se rechazan si `Origin` no es el propio sitio o `Sec-Fetch-Site` es `cross-site` o `same-site`. Roles: `exigirSesion` y `exigirRol(rol)` (el administrador pasa por todo). `helmet` y `express.json` (2 MB) solo bajo `/api`.
- Primer usuario: `npm run usuario:crear -- --base-dev --email=<email> --nombre="<nombre>" --rol=ADMINISTRADOR` (la contraseña se pide por teclado, sin mostrarse).
- Migración `20261021151549_sesiones`.
- Tests: `test:auth` (18, sin base; se comprobó con tres mutaciones que detecta fallos reales) y `test:auth-base`.

**Paso 2: panel con ingreso y listado** (`apps/panel/src`, `apps/api/src/admin/articulos.ts`).
- `GET /api/admin/articulos` (sesión de editor o administrador): filtro por estado, búsqueda por título sin distinguir mayúsculas ni tildes, 25 por página, ordenado por última edición, con la cantidad por estado; solo devuelve lo que la pantalla muestra (sin cuerpo, `visitasWp` ni texto plano) y la dirección pública si el artículo ya se ve en el sitio.
- Panel: `BrowserRouter` con `basename="/admin"`; pantalla de ingreso, marco con la barra superior y el botón Salir, y listado con solapas por estado, búsqueda y paginación; marca los artículos con imágenes sin texto alternativo. Todo lo que no es el ingreso exige sesión; un 401 vuelve al ingreso y después a la misma pantalla. Mensajes de error en lenguaje común (`api.ts`). El listado todavía no abre ningún artículo.
- Test: `test:admin-articulos`. `test:humo` comprueba también que Express sirve el panel, sus rutas internas y sus archivos.
- Para verlo: `npm run build:panel`, crear un usuario, `npm run dev:desarrollo -w @evaristo/api` y abrir `http://127.0.0.1:3000/admin/` (o, con recarga en caliente, `npm run dev:panel` y `http://127.0.0.1:5173/admin/`). **No se vio en un navegador.**

**Paso 3: API de edición de artículos** (`apps/api/src/admin/edicion.ts`, `datos-articulo.ts`).
- `GET /api/admin/catalogos` (secciones elegibles, categorías y autores), `GET /api/admin/articulos/:id`, `POST /api/admin/articulos` (crea un BORRADOR con dirección provisoria `borrador-<12 hex>`), `PUT /api/admin/articulos/:id` y `DELETE /api/admin/articulos/:id/borrador` (descarta los cambios sin publicar). Editores y administradores pueden editar cualquier artículo.
- Un BORRADOR se guarda directo sobre su fila (con categorías y autores en orden); uno PUBLICADO o PROGRAMADO va a su borrador de cambios. Cada guardado manda la `version` que se abrió; si no coincide, o si el artículo cambió por otro lado después de empezar el borrador, responde 409 y no pisa nada.
- Validación: `zod` para la forma (estricto: sin campos de más) y el validador compartido en modo estricto para el cuerpo; revisa que existan la sección (no una interna, salvo que el artículo ya la tuviera), las categorías, los autores y las imágenes (`imagenId` del cuerpo y del encabezado), que la categoría principal sea una de las categorías y que los puntos focales estén entre 0 y 1. La dirección solo cambia en un BORRADOR (formato `a-z0-9-` y sin repetir). Errores `422` con una lista de problemas en lenguaje común.
- `altPendiente` verificado en el servidor: la marca solo se acepta en imágenes que ya la tenían en la versión guardada (del artículo o de su borrador de cambios). Se recalcula `articulos.altPendientes` (cuerpo, encabezado sin texto alternativo y galería) en los guardados directos.
- El texto plano se calcula con `textoPlanoDe`, que pasó a `packages/compartido/src/texto-plano.ts` (export `./texto-plano`); la migración lo re-exporta.
- Esquema: columna `articulos.conCapital` (falsa por defecto) y tabla `articulos_borradores` (`datos` JSON con todos los campos editables, `baseVersion`, `usuarioId`); migración `20261021154936_borradores_y_capital`, aplicada a `evaristo_cms_dev` y a `evaristo_cms_test`, **no** a `evaristo_cms`. `Prisma` se exporta desde `@evaristo/compartido/db`; la API compila con `allowImportingTsExtensions`, como el sitio.
- Test: `test:admin-edicion` (recorre los 35: el cuerpo vuelve igual desde la API, cada publicado se guarda como borrador de cambios sin alterar nada de lo publicado y se conservan los 172 `imagenId`; conflictos, más de 30 validaciones, `altPendiente`, guardado directo, origen y tamaño; se comprobó con tres mutaciones). Los 35 cuerpos migrados pasan el modo estricto sin errores ni avisos.
- El verificador de la migración (`verificar.ts`) pedía exactamente 3 migraciones; ahora pide que no falte ninguna de las 3 originales.

## Paso 4, etapa 4a: editor portado (22/10/2026, rama `fase4-editor`)

- Dependencias instaladas en `apps/panel` (versión exacta, fechas revisadas): TipTap 3.31.4 (`core`, `pm`, `react`, `starter-kit`, `extension-heading`, `extension-table`, `extension-text-align`; publicada el 30/09), `jsdom` 30.1.2 (04/10), `tsx` 4.23.15 y `@types/node` 24.19.1 (las mismas que ya usa el repo). Se descartaron TipTap 3.32.0 y jsdom 30.1.3 por tener menos de dos semanas. `npm` avisa que algunas dependencias de jsdom piden Node 24.15 y hay 24.14.0: jsdom carga y los tests pasan.
- El panel depende ahora de `@evaristo/compartido` (usa `/render` y `/schema`) y compila con `allowImportingTsExtensions`.
- Código en `apps/panel/src/editor/` (copiado de `testing-tiptap/src/editor`, que no se tocó). El nodo `imagen` tiene el atributo `imagenId` (se serializa solo si es un número; sobrevive a `parseHTML`/`renderHTML` con `data-imagen-id`, al diálogo y a copiar y pegar). El enlace guarda solo `href` (se sacaron `rel`, `target`, `class` y `title`, que el renderizador no usa).
- `npm run test:editor -w @evaristo/panel`: 20 pruebas del editor (15 del editor viejo + 5 de `imagenId`) y la prueba de ida y vuelta (`test-ida-vuelta.ts`): los 35 cuerpos de `evaristo_cms_dev` se cargan en TipTap, se serializan y vuelven iguales (172 `imagenId` conservados) y pasan el modo estricto. Se ignora, en los dos lados: el orden de las claves, el orden de las marcas de un texto (`<em><strong>` pasa a `<strong><em>`, igual a la vista) y los atributos con su valor por defecto (`textAlign` left, `altPendiente` false, `decorativa` false, `epigrafe` vacío, `imagenId` null, `colspan`/`rowspan` 1, `start` 1 y `type` null en listas ordenadas, `class`/`rel`/`target`/`title` null en enlaces). Se comprobó con una mutación (sin el atributo `imagenId`) que las dos pruebas fallan.
- El diálogo de imagen sigue pidiendo la dirección a mano; se cambia por la biblioteca en la etapa 4b.

## Paso 4, etapa 4b: pantalla de edición y alta (22/10/2026, rama `fase4-editor`)

- **Rutas del panel:** `/articulos/nuevo` y `/articulos/:id`; en el listado, el título de cada fila es un enlace y hay un botón "Nuevo artículo".
- **`EditarArticulo`** (`apps/panel/src/paginas/`): carga el artículo y los catálogos, y arma el formulario con todos los campos de `DatosSchema`: título, bajada, cuerpo (`EditorCuerpo`), sección, categorías con la principal marcada, autores en orden (subir, bajar, quitar, agregar), imagen de encabezado (miniatura, texto alternativo, crédito y punto focal en porcentaje de 0 a 100), letra capital, `novedadHasta` (fecha; fin de ese día en hora local) y dirección (editable solo en un BORRADOR). Botón Guardar (todavía sin autoguardado) con estado visible ("Sin cambios", "Hay cambios sin guardar", "Guardado a las …"). Manda la `version` que abrió y usa la que devuelve cada guardado; un cambio hecho mientras se guardaba no se da por guardado. Un 422 muestra la lista de `problemas`; un 409 muestra "Este artículo cambió mientras lo editabas", bloquea Guardar y ofrece "Cargar la versión nueva" (la interfaz completa del conflicto es la etapa 4c). Si el artículo tiene borrador de cambios, avisa que hay cambios sin publicar.
- **`NuevoArticulo`:** título y sección, `POST /api/admin/articulos` y pasa a la pantalla de edición.
- **`EditorCuerpo`** (`apps/panel/src/editor/`): el editor de la fase 0 con su barra de herramientas en español: párrafo, títulos 2 a 4, negrita, cursiva, enlace (solo http, https y mailto), viñetas, numerada, alineación (izquierda, centro, justificado), cita textual y destacada (con autor y fuente), nota al pie, imagen, video, tabla (con sus opciones de fila y columna) y deshacer y rehacer. Cada botón tiene nombre accesible y estado (`aria-pressed`). Decisión sobre qué herramientas lleva la barra: se dejaron las del editor viejo, sin sumar ni sacar ninguna (queda para revisar al mirar el panel, etapa 4d).
- **Imágenes (hasta el paso 5 no hay subida):** el diálogo de imagen del cuerpo y el selector del encabezado eligen de la biblioteca (`SelectorImagen`: búsqueda por nombre de archivo, paginado de 24, miniaturas). El nodo guarda `imagenId`, `src` (`/media/<clave codificada>`), `alt`, `decorativa`, `epigrafe` y `altPendiente` con las reglas de `imagen-alt.ts`. Al cambiar la imagen del encabezado se borran su texto alternativo y su crédito (eran de la anterior). `vite.config.ts` también reenvía `/media` al puerto 3000 para `dev:panel`.
- **API:** nueva `GET /api/admin/imagenes?q=&pagina=` (`apps/api/src/admin/imagenes.ts`; solo `id`, `clave`, `nombreOriginal`, `ancho` y `alto`; 24 por página, solo lectura). `GET /api/admin/articulos/:id` devuelve además `imagenEncabezado` (id, clave y nombre) para mostrar su miniatura. `ErrorApi` del panel lleva ahora la lista `problemas` de los 422.
- **Tests:** `test:admin-imagenes` (200 imágenes, 9 páginas, búsqueda, filtros inválidos y sin campos de más), `test:admin-edicion` (suma la comprobación de `imagenEncabezado`) y `test:pantalla` en el panel (9 pruebas con jsdom y la API simulada: abrir un borrador con todos los campos, guardar sin tocar manda el mismo cuerpo y la versión que se abrió, ediciones, 422, 409 y recarga, selector del encabezado, imagen nueva en el cuerpo, alta y artículo publicado con la dirección de solo lectura; se comprobó con una mutación que detecta una versión equivocada). `entorno-jsdom.ts` responde "sin medidas" a los rangos que ProseMirror pide a jsdom. `comparar-cuerpos.ts` es la comparación de la ida y vuelta, compartida con `test:pantalla`.
- **Sin ver en un navegador.** El bundle del panel pasó de ~270 KB a ~770 KB (240 KB comprimido) por TipTap; para un panel interno es aceptable, pero queda anotado (si hiciera falta: partir el código con `import()` dinámico).
- **Pendiente de esta etapa:** la pantalla no avisa al salir con cambios sin guardar (4c); un artículo en BORRADOR con la dirección `borrador-…` no se puede publicar todavía (paso 6).

## El editor de la fase 0 (a portar en el paso 4)

Está en `testing-tiptap/src/editor` (unas 1.100 líneas) y `App.tsx` (793 líneas: barra de herramientas, diálogos y pestañas de vista previa, JSON, texto y validación). TipTap 3.31.4 (`core`, `pm`, `react`, `starter-kit`, `extension-heading`, `extension-table`, `extension-text-align`) y React 19.2.x; tiene un test sin navegador con jsdom (`test:editor`, 183 líneas). Ya resuelve títulos H2 a H4 en una línea, citas textual y destacada con autor y fuente, notas al pie con ventana de edición, imagen con alt, decorativa, epígrafe y `altPendiente`, video de YouTube y Vimeo, tablas simples sin celdas combinadas, alineación izquierda, centro y justificado, y enlaces solo http, https y mailto.

**Problemas a resolver al portar:**
1. **El nodo de imagen no tiene el atributo `imagenId`** (sus atributos son `src`, `alt`, `decorativa`, `epigrafe` y `altPendiente`). Un artículo migrado que se abra y se guarde en ese editor perdería el `imagenId` de todas sus imágenes: se romperían `width` y `height` y la regla de no borrar una imagen en uso. Hay que agregarlo, con un test que cargue y guarde los 35 sin cambios.
2. El editor viaja con su propia copia del validador, el renderizador y `video.ts`: en el monorepo hay que usar `@evaristo/compartido/schema` y `/render`.
3. El diálogo de imagen pide escribir la dirección (`src`) a mano; el panel necesita elegir de la biblioteca (`imagenId` y `/media/<clave>`).
4. Prueba de ida y vuelta: cargar cada uno de los 35 cuerpos en el editor y volver a serializarlos tiene que dar el mismo JSON (o diferencias explicadas).
5. TipTap y jsdom no están en el monorepo (se instalan con versión exacta).

## Lo que falta

**Paso 4: el editor** (lo más grande).
- ~~Portar las extensiones de TipTap con `imagenId`, y la prueba de ida y vuelta de los 35 con jsdom.~~ Hecho (etapa 4a).
- Pantalla de edición: título, bajada, editor del cuerpo, sección, categorías con la principal marcada, autores en orden, imagen de encabezado (con texto alternativo, crédito y punto focal), letra capital (casilla), `novedadHasta`, dirección (solo en un borrador).
- Alta de un artículo nuevo; abrir un artículo desde el listado.
- Autoguardado con retardo y estado visible ("Guardado", "Guardando…", "No se pudo guardar"); aviso de conflicto con opción de ver los cambios o copiar el propio texto; "Descartar los cambios sin publicar"; aviso de que hay cambios sin publicar en un artículo publicado.
- Vista previa con el renderizador compartido (`conCapital` incluido).
- Mensajes de error en lenguaje común.

**Paso 5: imágenes.**
- Subida con `multer` y procesamiento con `sharp` (tipo real del archivo, tamaño máximo, orientación EXIF, medidas, SHA-256, clave segura), guardado en `MEDIA_DIR`.
- Recorte y punto focal (validado entre 0 y 1) para el encabezado y las imágenes del cuerpo; biblioteca con búsqueda por nombre; texto alternativo y epígrafe en cada uso.
- No se puede borrar una imagen en uso (cuerpo, encabezado, galería, foto de autor, imagen para redes). Variantes de tamaño (ver `pendientes.md`).

**Paso 6: publicar.**
- Pasar a PUBLICADO o PROGRAMADO, y "Publicar cambios" (aplicar el borrador de cambios al artículo y borrarlo).
- Reglas al publicar: exigir imagen de encabezado y texto alternativo en lo nuevo, rechazar un slug que empiece con `borrador-`, proponer la fecha actual si `publicadoEn` es null, y generar el slug desde el título; si cambia el slug de uno publicado, crear la redirección `SLUG_ANTERIOR`.
- Definir qué significa PROGRAMADO (hoy el sitio muestra un artículo cuando `publicadoEn` ya llegó, así que no hace falta un proceso que lo cambie de estado) y cómo se despublica.
- Ficha técnica y galería (con su texto alternativo), y que el sitio las muestre.
- El sitio lee `conCapital` cuando las migraciones lleguen a la base real.

**Paso 7: administración.**
- Fichas de autor (bio de hasta 500 caracteres con itálica y enlaces, foto con recorte, redes con el formato definitivo); secciones y categorías (solo administrador; "unir con otra" en vez de borrar); usuarios (alta, baja, cambio de rol y de contraseña).
- Herramientas de la revisión posterior a la migración: filtros por aviso (títulos, notas al pie, bios, `bio_con_correo`, autores, `original_faltante`, `imagen_sin_medir`, `origen_privado`, `fecha_borrador`), vista de artículos con imágenes pendientes (`altPendientes`), de los `sin-asignar` y de los borradores migrados.

**Paso 8: cierre.**
- Mensajes de error en lenguaje común en todo el panel y prueba con alguien de la editorial: **criterio de cierre de la fase** (un editor no técnico carga y publica una nota completa sin ayuda).
- Seguridad: política de `helmet` para el sitio y el panel (Google Fonts, YouTube, Vimeo), `trust proxy` según el hosting, límite de intentos que sobreviva a reinicios, cerrar todas las sesiones de un usuario, limpiar las vencidas (hoy no hay quien llame a `borrarSesionesVencidas`), recuperación de contraseña (depende de definir el envío de correos) y registro de quién creó y editó cada artículo.
- Pruebas de las pantallas del panel (hoy solo typecheck y build).

**Para cerrar la fase y lanzar:** aplicar a `evaristo_cms` las migraciones `sesiones` y `borradores_y_capital` con `db:deploy` antes de la migración completa de la fase 7 (el cliente de Prisma ya espera `conCapital` y los scripts de la migración fallan contra una base sin esa columna), y recrear los usuarios editores.

## Limitaciones conocidas de lo hecho

El límite de intentos vive en memoria (se reinicia con el servidor) y detrás de un proxy hay que configurar `trust proxy` para que cuente la dirección real; no hay recuperación de contraseña ni cierre de todas las sesiones de un usuario; la sesión no se renueva con el uso; el listado no abre artículos; las pantallas del panel no se probaron en un navegador.
