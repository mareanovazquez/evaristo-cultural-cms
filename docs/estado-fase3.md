# Fase 3 (sitio público): estado para retomar

Actualizado el 20/10/2026, 13:00. Resumen del reconocimiento de solo lectura de Claude Code (HEAD `c570d19`, árbol limpio, sin archivos modificados) y de las decisiones tomadas hoy. Ante cualquier diferencia con `plan-implementacion.md` valen `pendientes.md` y esta nota.

## Dónde quedamos

**Paso 1 hecho (21/10/2026, rama `fase3-renderizador`, sin merge ni push):** `@evaristo/compartido` exporta `./schema` y `./render`; el renderizador está en `packages/compartido/src/render/render.ts` (opciones `conCapital`, `prefijoIds`, `dimensionesImagenes`; constante `SPRITE_ICONO_VOLVER` para que el layout la incluya una vez por página). Tests: `npm run test:render` (38, puros), `npm run test:render-35` (lee `evaristo_cms` en el 3308, solo SELECT y sesión READ ONLY) y `npm run render:preview-35 -- --originales=<carpeta>` (páginas en `CMS-EVARISTO(ASSETS)\previews-fase3\`, con CSS neutro). El validador admite títulos H2 a H4; el renderizador acota a 2..6. El esquema no valida los atributos de `cita` (`variante`, `autor`, `fuente`), y `autor` y `fuente` son texto plano: una llamada a nota en la atribución de una cita destacada no es posible hoy, solo dentro del texto de la cita.

**Paso 2 hecho (21/10/2026, misma rama, sin mergear):** en `apps/sitio/src`: `styles/` (`tokens.css` con los tokens por función, `base.css`, `articulo.css` con el cuerpo y las notas, `sitio.css` con marca, topbar, header, footer, bio, autor y tarjetas), `components/` (`Marca`, `Header`, `Footer`, `Iconos` con el sprite, `Articulo`), `layouts/Base.astro` (Google Fonts, sprite una vez por página, salto al contenido) y `lib/rutas.ts`. El menú sale de `SECCIONES` (6 visibles, el resto en "Más"; en celular un panel sin JavaScript). Se agregó `allowImportingTsExtensions` al `tsconfig` del sitio para poder importar `@evaristo/compartido/render`. Modo oscuro: solo quedan nombrados los tokens.
- Páginas temporales, que se borran en el paso 4: `/prueba-layout/` (artículo sintético con cita destacada, tabla, video, notas y bio) y `/prueba-layout/<wpId>` (un PUBLICADO real; `?capital=1` activa la capital). Solo responden en `astro dev` o con `PRUEBA_LAYOUT=1`; si no, 404.
- Para verlas: `npm run dev:sitio` con el 3308 arriba (`/prueba-layout/` no necesita base), o `$env:PRUEBA_LAYOUT=1; npm run dev` (puerto 3000). Las imágenes del cuerpo no cargan hasta el paso 3 (`/media`).
- Provisorio y sin destino todavía: URLs de sección (`/seccion/<slug>/`) y de autores (`/autores/`), enlaces de la tienda, redes, "Quiénes somos" y "Contacto", y los textos del topbar y del footer. El botón de búsqueda de la maqueta no se implementó (no hay buscador).
- No verificado: no se miró en un navegador (Claude Code no arranca servidores); solo typecheck y `build:sitio`.

**Paso 3 hecho (21/10/2026, rama `fase3-media`, sin mergear):** `apps/api/src/media.ts` sirve `GET`/`HEAD /media/<clave>` y `crearApp` la monta después de `/admin` y antes de los estáticos y el SSR. Configuración: `MEDIA_DIR` en el `.env` (ruta absoluta; sin ella, 503; está en `.env.example`). Como propuso el reconocimiento: la fila de `imagenes` decide el archivo (igualdad exacta en JavaScript); un solo segmento, sin `/`, `\`, NUL, `.`, `..` ni barras codificadas; tipos jpeg/png/gif/webp según `tipoMime`; `nosniff`; ETag con el SHA-256 y 304; `Cache-Control: public, max-age=86400`; 404 sin fila, sin archivo, carpeta u oculto; 405 con `Allow`; 400 si la codificación es inválida. Tests: `npm run test:media` (10, puros) y `npm run test:media-originales -- --originales="<carpeta>"` (base real en solo lectura: 200 de 200 imágenes con bytes y SHA-256 correctos; 172 de 172 de los cuerpos con 200). Las imágenes solo se ven con el servidor único (`npm run dev`, puerto 3000): `dev:sitio` (4321) no incluye la API.

**Próximo paso:** decidir la URL del artículo (antes del paso 4), sacar el correo de la bio del autor 39 y seguir con el paso 4 (vista del artículo).

Antes de pegar cualquier prompt que use Prisma: comprobar el 3308 con `Test-NetConnection`. El prompt se pega desde `C:\Users\Usuario\Documents\Proyectos frontend`, sin push.

## Decisiones tomadas el 20/10/2026

- Imágenes dentro del cuerpo: proporción original, sin recorte, altura máxima 80vh (ver `decisiones-de-diseno.md`).
- Letra capital: desactivada por defecto, se activa desde el editor (ver `decisiones-de-diseno.md`).
- Manual de estilo para los artículos nuevos: se va a armar; falta definir qué cubre, quién lo escribe y el formato.
- Orden de trabajo: el paso 1 es solo el renderizador con tests y los 35 renderizados; la ruta `/media/<clave>` queda para el paso 3.
- El renderizador agrega `width` y `height` a las imágenes del cuerpo desde la tabla `imagenes` (mapa de dimensiones por `imagenId`, consultado una vez por artículo). Si falta una medida, la imagen sale igual sin esos atributos.
- 21/10/2026: Roxana Artal (directora) devolvió que el diseño está bien pero "un poco lavado". Se trabaja primero el artículo, antes del header y el footer: cita destacada como caja con acento (variante A, decidida) y sección como etiqueta rectangular suave (accent-100, decidida). Maquetas `nota-con-notas-al-pie.html` e `index.html` actualizadas. Falta confirmar con ella si "lavado" es el color, la tipografía o la falta de elementos de marca. El renderizador del paso 1 debe emitir una sola cita destacada (`blockquote.cita` con `cite`) en vez de `figure.cita-textual` y `figure.cita-destacada`.
- La directora de la editorial recibió `referencias/maquetas/nota-con-notas-al-pie.html` y todavía no respondió. El diseño sigue como propuesta; no frena el paso 1.

## Resumen del reconocimiento

**apps/sitio:** Astro 7.3.8 con `@astrojs/node` 11.1.7, `output: "server"` y modo middleware, montado en Express (`apps/api/src/app.ts`) después de `/api`, `/admin` y `express.static`. Hay una sola página de prueba (`src/pages/index.astro`); no hay layouts, componentes, CSS ni fuentes. No existe la ruta `/media`. El `dist` es del 09/10 y hay que recompilar con `npm run build:sitio` tras cada cambio. `@evaristo/compartido` solo exporta `.`, `./db` y `./secciones`: habrá que agregar exports para el validador, `video.ts` y el renderizador. Typecheck sin errores.

**Renderizador:** está en `testing-tiptap/src/render/render.ts` (rama `integracion-conversor`, 235 líneas, TypeScript puro sin DOM, `npm run test:render` pasa). Exporta `renderArticleBody(doc)` con `{ html, notesHtml, footnoteCount }`. Soporta los nodos y marcas del esquema. Para portarlo: cambiar imports relativos (`../schema/validate`, `./video`), usar el `video.ts` ya presente en `packages/compartido/src/render/` y el validador canónico de `packages/compartido/src/schema/validate.ts`.

**Diferencias entre el renderizador y el diseño decidido (el paso 1 las corrige):**
- Notas al pie: el renderizador usa `class="notas"` y un `↩` de texto. El diseño pide `notas-al-pie`, `role="doc-noteref"`, `doc-endnotes` y `doc-backlink`, `aria-label` ("Nota N", "Volver al texto (nota N)"), ícono corner-up-left de Lucide y `white-space: nowrap` para el punto y el ícono.
- Alineación: el renderizador emite `align-*` y admite derecha. El diseño usa `alin-centro` y `alin-justificado`; la derecha no existe en la especificación.
- Letra capital: no está contemplada. Va como opción `conCapital`, apagada por defecto, con la salvaguarda (solo si el primer bloque es un párrafo que empieza con una letra).
- Ids de notas: pueden chocar si hay varios artículos en una página; se agrega un prefijo opcional.
- Títulos internos: acotar el nivel para que nunca salga un `h1` en el cuerpo.
- Imágenes: hoy no emite `width` ni `height` (se agregan desde `imagenes`); con `altPendiente` o decorativa sale `alt=""`; siempre `loading="lazy"`.
- Citas: el renderizador emite `figure.cita-textual` y `figure.cita-destacada`; el diseño define solo la cita destacada. No hay citas en los 35: el test usa un caso sintético.

**Inventario de los 35:** nodos principales: paragraph 3.217, footnote 178, imagen 172, hardBreak 44, listItem 29, video 15 (todos YouTube), orderedList 10, heading 4 (nivel 2 en uno, nivel 3 en tres), tabla 1 (artículo 5296, 4 filas, 1 celda por fila, sin encabezados), bulletList 2. Sin nodos `cita`. Marcas: italic 1.180, bold 778, link 39. Alineación: justify en 328 párrafos y center en 8. Imágenes: 147 con alt, 25 con `altPendiente`, 35 con epígrafe. Notas: solo párrafos, texto y saltos de línea.
- Artículos con notas al pie: 620, 1555, 1569, 2462, 3026, 4262, 4265, 4364, 4424, 4507, 5214, 5287, 12939. El 4265 tiene 1 nodo `footnote` y 32 marcas `[n]` como texto (error del conversor); debe mostrarse tal cual, sin romper.
- Videos: 720, 12939, 15027 (11), 19899, 21382. `altPendiente`: 720, 15021, 15027, 16691, 19660, 19899, 22024, 22590.
- Cuerpo más grande: 3306 (123 KB de JSON).
- Estados: 34 PUBLICADO y 1 BORRADOR (22546). 32 de 35 tienen imagen de encabezado (fuera del cuerpo); 2462 y 22546 no la tienen (originales faltantes) y 22590 no tiene `_thumbnail_id`.
- Autores: 25, 13 con bio, 2 de solo texto. **La bio del autor 39 contiene un correo:** una página pública de autor lo publicaría; hay que decidir qué hacer antes del paso 5.

**Propuesta para `/media/<clave>` (paso 3):** variable `MEDIA_DIR` (sin ella, 503 claro); ruta Express `GET`/`HEAD /media/:clave` antes de `express.static` y del SSR; un solo segmento, se rechaza `/`, `\`, `..`, NUL y barra codificada; se decodifica con `decodeURIComponent` (400 si falla); la ruta del archivo sale de la fila de `imagenes` (igualdad exacta en JavaScript, porque la colación del SQL es laxa), nunca del texto de la URL, y se comprueba que quede dentro de `MEDIA_DIR`; `res.sendFile` con `root` y `dotfiles: "deny"`; tipo de contenido desde `tipoMime`, `nosniff`; ETag con el SHA-256 y 304; `Cache-Control: public, max-age=86400` (sin `immutable`); 404 sin fila o sin archivo; 405 para otros métodos. Hechos medidos: 200 imágenes (192 JPEG, 4 PNG, 4 GIF), 25,2 MB, 4 claves con caracteres fuera de `[A-Za-z0-9._-]`, y el `src` guardado está codificado con `encodeURIComponent`.

## Plan por pasos (del informe, con dos correcciones)

0. Decisiones previas: URL del artículo y bio del 39.
1. Exports de `compartido` y renderizador portado con tests y los 35 renderizados. **Hecho el 21/10/2026 (rama `fase3-renderizador`).**
2. Tokens y layout base. **Hecho el 21/10/2026 (rama `fase3-renderizador`).** Corrección: la tipografía es Fraunces e Inter (no de sistema) y el modo oscuro es de segunda etapa; solo se nombran los tokens por función (bg, surface, text, border, accent).
3. Ruta `/media/:clave` (propuesta de arriba). **Hecho el 21/10/2026 (rama `fase3-media`).**
4. Vista del artículo (filtra `estado = PUBLICADO` y `publicadoEn <= ahora`; los 2 sin encabezado se muestran sin imagen de encabezado).
5. Vista de autores (`/author/<slug>/`; 404 para los 2 de solo texto).
6. Redirecciones (middleware con 301; los 58 orígenes de la muestra).
7. Build y prueba de humo (los 34 publicados responden 200 y el borrador 404).

## Decisiones que quedan abiertas

- **URL del artículo (antes del paso 4):** `redirecciones.origen` guarda la URL vieja de WordPress y apunta al artículo por id, pero el esquema de la URL nueva no está definido. Opciones: dejar la vieja `/AAAA/MM/DD/slug/` como canónica, o una nueva con 301 desde la vieja.
- **Bio del autor 39 con correo (antes del paso 5):** qué hacer con el correo (ver también docs/pendientes.md, sección 5).
- Manual de estilo para los artículos nuevos.
- Navegación y menú en celular.
- Visto bueno de la directora.
- Si las fuentes (Fraunces e Inter) se cargan desde Google Fonts, como en las muestras, o se sirven desde el propio sitio (antes del paso 2).

## Pendientes de la migración (no frenan la fase 3)

Los de `pendientes.md`: commit chico de README y tests del verificador, notas al pie del 4265, enlaces internos y los 26 enlaces de texto a uploads sin destino conocido, y el permiso de `evaristo_migracion` sobre `evaristo_cms_test`.

## Archivos temporales del reconocimiento

Scripts de solo lectura, fuera del repo: `f3-inventario.mjs`, `f3-autores.mjs` y `f3-bios.mjs`, en la carpeta `scratchpad` de la sesión de Claude Code (en `AppData\Local\Temp\claude\...`).
