# Paso 4 de la fase 4 (el editor): plan de trabajo en 4 etapas

**Documento temporal.** Se escribió el 21/10/2026 para arrancar el paso 4 sin releer todo. **Borrarlo al terminar el paso 4** (con `git rm`, sacando también su fila del índice de `CLAUDE.md`) y pasar a `estado-fase4.md` lo que haya quedado como decisión o pendiente duradero. Contexto general: `estado-fase4.md` (decisiones, lo hecho y los problemas del editor de la fase 0) y `pendientes.md`, sección 1.

Estimación total: 4 a 6 horas de trabajo, en 3 o 4 sesiones. La incertidumbre grande es que Claude Code no puede abrir un navegador: lo que se verifica solo es la parte de datos; la pantalla la tiene que mirar Mariano y las vueltas de ajuste dependen de eso.

## NO OLVIDAR (hacer vos antes de empezar)

Cuatro cosas de Mariano, antes de abrir la sesión de Claude Code:

- [ ] **`MEDIA_DIR` en el `.env`:** agregar la línea `MEDIA_DIR=C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\uploads-muestra\originales`. Hoy no está cargada: sin ella `/media` responde 503 y las imágenes no se ven.
- [ ] **Prender la MariaDB de WordPress (puerto 3307)**, solo si se quiere correr `test:migracion-flujo` (el 21/10/2026 no se pudo ejecutar porque estaba apagada). Si no se prende, ese test queda sin verificar otra vez.
- [ ] **Crear tu usuario del panel en la base de desarrollo**, para poder mirar el panel apenas esté la pantalla de edición: `npm run usuario:crear -- --base-dev --email=<tu email> --nombre="<tu nombre>" --rol=ADMINISTRADOR` (pide la contraseña por teclado: no se muestra ni se pega en el chat).
- [ ] **Confirmar que el último push se hizo** (`git status -sb` no tiene que decir "ahead").

Después se sigue con el checklist de abajo, que lo recorre Claude Code.

## Cómo arrancar (checklist de la primera sesión)

1. `Test-NetConnection 127.0.0.1 -Port 3308` (tiene que dar `True`). El 3307 solo hace falta para `test:migracion-flujo`.
2. Estar en `main`, árbol limpio (`git status`), y crear la rama: `git checkout -b fase4-editor`. Una rama por etapa o una sola para todo el paso (mergear con `--ff-only` al cerrar cada etapa, como hasta ahora).
3. Tener `MEDIA_DIR` en el `.env` (o pasar `--originales=…` a los tests): `C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\uploads-muestra\originales`.
4. Tener un usuario en `evaristo_cms_dev` para probar el panel: `npm run usuario:crear -- --base-dev --email=<email> --nombre="<nombre>" --rol=ADMINISTRADOR` (pide la contraseña por teclado). Para ver el panel: `npm run build:panel`, `npm run dev:desarrollo -w @evaristo/api` y `http://127.0.0.1:3000/admin/` (o `npm run dev:panel` para recarga en caliente en `http://127.0.0.1:5173/admin/`).
5. Dependencias a instalar con versión exacta, **revisando antes la fecha de publicación** (nada de menos de dos semanas; ya están aprobadas): `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-heading`, `@tiptap/extension-table`, `@tiptap/extension-text-align` en `apps/panel`, y `jsdom` como dependencia de desarrollo. El editor de la fase 0 usa TipTap 3.31.4 y React 19.2.x; el panel usa React 19.3.0, así que hay que mirar los `peerDependencies` de `@tiptap/react`.
6. El panel todavía no depende de `@evaristo/compartido`: agregarlo (`"@evaristo/compartido": "0.0.0"`) y poner `allowImportingTsExtensions` en `apps/panel/tsconfig.json`, como en el sitio y la API, para usar `/render` y `/schema`.
7. Leer solo lo que haga falta: `estado-fase4.md` (sección del editor), y del editor viejo `..\testing-tiptap\src\editor\` (solo lectura, no se modifica).

## Etapa 4a: portar las extensiones y la prueba de ida y vuelta (HECHA el 22/10/2026)

**Objetivo:** el editor de TipTap vive en `apps/panel/src/editor/`, conserva el `imagenId` y guardar sin tocar no cambia los 35 cuerpos migrados.

- Copiar de `testing-tiptap/src/editor`: `cita.ts`, `extensions.ts`, `footnote.tsx`, `FootnoteDialog.tsx`, `imagen-alt.ts`, `imagen.tsx`, `ImagenDialog.tsx`, `tabla.ts`, `titulo.ts`, `video.tsx`, `VideoDialog.tsx` y `test-editor.ts` (183 líneas, jsdom). Cambiar los imports de `../render/render` y `../schema/validate` por `@evaristo/compartido/render` y `/schema` (no copiar el validador ni el renderizador).
- **Agregar el atributo `imagenId` al nodo de imagen** (hoy declara `src`, `alt`, `decorativa`, `epigrafe` y `altPendiente`; sin `imagenId` se pierde en las 172 imágenes migradas). Que sobreviva a `parseHTML`, `renderHTML`, copiar y pegar y a los comandos del diálogo.
- **Prueba de ida y vuelta** (`npm run test:editor` en `apps/panel`): leer los 35 cuerpos de `evaristo_cms_dev` (solo lectura, con `@evaristo/compartido/db`), cargarlos en el editor con jsdom, volver a serializar con `getJSON()` y comparar con el original. Definir de antemano qué se ignora: los atributos que el editor agrega con su valor por defecto (por ejemplo `textAlign: "left"`, `altPendiente: false`, `decorativa: false`, `epigrafe: ""`) y el orden de las claves (MySQL reordena las del JSON). Toda otra diferencia se explica o se corrige; el criterio de éxito es que los 35 den el mismo JSON de contenido.
- Pasar también los tests del editor viejo (títulos sin saltos de línea, imagen con texto alternativo, `altPendiente`) y sumar uno para `imagenId`.
- **Hecho cuando:** `test:editor` pasa con los 35, typecheck y `build:panel` sin errores, y sin tocar `testing-tiptap`.

## Etapa 4b: pantalla de edición y alta de artículos (HECHA el 22/10/2026; ver estado-fase4.md)

**Objetivo:** abrir un artículo del listado, editar todos sus campos y guardarlo con un botón (todavía sin autoguardado).

- Rutas de `react-router`: `/articulos/nuevo` y `/articulos/:id`; las filas del listado pasan a ser enlaces.
- Cargar `GET /api/admin/articulos/:id` y `GET /api/admin/catalogos`. Campos (los de `DatosSchema`): título, bajada, cuerpo (el editor), sección, categorías con la principal marcada, autores en orden (subir y bajar), imagen de encabezado con texto alternativo, crédito y punto focal, casilla de letra capital, `novedadHasta` y dirección (solo en un BORRADOR; se muestra, no se edita, en uno publicado).
- Guardar con `PUT` mandando la `version`; mostrar la lista de `problemas` de un 422 en lenguaje común y el aviso de un 409 (la interfaz del conflicto completa es la etapa 4c). Actualizar la `version` con cada respuesta.
- Alta: `POST /api/admin/articulos` con título y sección, y pasar a la pantalla de edición.
- **Imágenes antes del paso 5:** no existe todavía la subida. El diálogo de imagen del cuerpo y el selector del encabezado eligen entre las imágenes ya cargadas, no escriben la dirección. Hace falta una ruta nueva de solo lectura `GET /api/admin/imagenes?q=&pagina=` (id, clave, nombre original, medidas) con su prueba. El nodo guarda `src` (`/media/<clave>` con la clave codificada), `imagenId`, `alt`, `decorativa`, `epigrafe` y `altPendiente`, con las reglas de `imagen-alt.ts`.
- Estilo propio y neutro de `estilos.css` (formularios con etiqueta arriba, no flotante); barra de herramientas del editor accesible por teclado y que no rompa en celular.
- **Hecho cuando:** se puede abrir cualquiera de los 34 artículos, guardar sin tocar (en uno publicado queda como borrador de cambios y el sitio no cambia), crear uno nuevo, editarlo y guardarlo, y todo pasa typecheck y build. Prueba de API ya existente (`test:admin-edicion`) sigue en verde.

## Etapa 4c: autoguardado, conflictos, descarte y vista previa (HECHA el 22/10/2026; ver estado-fase4.md)

**Objetivo:** que la editora pueda trabajar sin perder nada y sin pisar a otra persona.

- **Autoguardado** con retardo (propuesta: unos 2 segundos después de la última tecla) y estado visible: "Guardado", "Guardando…", "No se pudo guardar. Probamos de nuevo…". No reenviar en bucle un 422; avisar antes de salir si hay cambios sin guardar (`beforeunload` y al cambiar de pantalla).
- **Conflicto (409):** mostrar "Este artículo cambió mientras lo editabas". Sin pisar nunca (decisión del 21/10/2026). Hay que decidir qué ofrece la pantalla (ver decisiones abajo).
- **Cambios sin publicar:** en un artículo publicado, banner "Tiene cambios sin publicar" (los publica el paso 6) y botón "Descartar los cambios" con confirmación (`DELETE …/borrador`, que ya existe).
- **Vista previa** con `renderArticleBody` de `@evaristo/compartido/render` (con `conCapital` según la casilla), mostrando el cuerpo, las notas, el encabezado y la volanta.
- **Hecho cuando:** editar un artículo publicado en dos pestañas produce el aviso en la segunda sin perder ninguno de los textos, el autoguardado no toca lo publicado (comprobable con `test:articulos`/`test:humo` y mirando el sitio) y la vista previa coincide con el sitio.

## Etapa 4d: ajustes después de mirar el panel

**Objetivo:** corregir lo que se vea al usarlo, y cerrar.

- Mariano prueba en el navegador (escritorio y celular): ingreso, listado, abrir, editar, notas al pie, imágenes, tabla, video, cita, letra capital, autoguardado, conflicto, descartar, vista previa. Se anota lo que falle o confunda.
- Pasada de accesibilidad básica (foco, etiquetas, contraste, teclado) y de mensajes de error en lenguaje común en las pantallas nuevas.
- Regresión completa: `npm run typecheck`, `npm run test:fase3` (con `MEDIA_DIR`), `test:auth`, `test:auth-base`, `test:admin-articulos`, `test:admin-edicion`, `test:editor`, `test:migracion` y `test:conversor`.
- Actualizar `estado-fase4.md` (paso 4 hecho y lo que quedó), `pendientes.md`, el README si cambió algo, y **borrar este documento**. Mergear con avance rápido.

## Decisiones para plantear (de a una, cuando toquen)

1. **Qué ofrece la pantalla ante un conflicto.** Propuesta: dos botones, "Copiar mi texto" (queda en el portapapeles para pegarlo donde haga falta) y "Cargar la versión nueva" (descarta lo local), sin "guardar de todos modos". Alternativa más trabajosa: mostrar una comparación de las dos versiones.
2. **De dónde sale el estilo de la vista previa**, si el panel tiene estilo propio y la lectura es del sitio. Propuesta: la vista previa va en un `<iframe srcdoc>` con las hojas del sitio importadas como texto (`?raw` de Vite) desde `apps/sitio/src/styles`, así queda aislada y sin duplicar CSS.
3. **Cuánto esperar antes de autoguardar** (propuesta: 2 segundos) y si se guarda también al salir de un campo.
4. **Qué herramientas lleva la barra** (las del editor viejo: títulos H2 a H4, negrita, cursiva, enlace, listas, alineación, cita textual y destacada, nota al pie, imagen, video, tabla). Confirmar que no falta ni sobra ninguna.
5. **Limitación hasta el paso 5:** sin subida, las imágenes solo se eligen de las 200 ya cargadas. Aceptable para probar el editor; para cargar notas nuevas con fotos propias hay que esperar a la etapa de imágenes.

## Riesgos y cosas que mirar

- El nodo de imagen y la nota al pie guardan datos en atributos (`attrs.content` del `footnote` es un documento anidado): cuidar que `getJSON()` los devuelva completos.
- `jsdom` no es un navegador: no reproduce selección, foco ni pegado real. Lo que pase solo en el navegador lo va a encontrar Mariano.
- Tamaño del bundle del panel con TipTap (hoy ~270 KB; va a crecer bastante). No es un problema para un panel interno, pero conviene anotarlo.
- El cuerpo más grande de la muestra es el 3306 (115 KB de JSON): probar que el editor y el autoguardado lo manejan sin trabarse.
- Los 35 cuerpos migrados pasan hoy el modo estricto del validador sin errores ni avisos; si el editor serializa algo distinto y el servidor lo rechaza, el síntoma va a ser un 422 al guardar sin haber tocado nada.
- No usar `localStorage` para guardar el texto en edición como "respaldo": la copia de seguridad es el borrador de cambios del servidor.
