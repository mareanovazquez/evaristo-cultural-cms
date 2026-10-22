# Fase 3 (sitio público): qué se hizo y qué quedó abierto

Actualizado el 21/10/2026. **La fase 3 está terminada en lo técnico** (todo en `main` y ya subido al remoto por Mariano). Lo que sigue abierto está al final y, con más detalle, en `pendientes.md`, sección 2. Para el diseño visual, `decisiones-de-diseno.md`.

## Qué hay (por área)

**Renderizador** (`packages/compartido/src/render/render.ts`, exports `@evaristo/compartido/render` y `/schema`): `renderArticleBody(doc, { conCapital, prefijoIds, dimensionesImagenes })` devuelve `{ html, notesHtml, footnoteCount }`. TypeScript puro, sin DOM. Notas al pie accesibles (`doc-noteref`, `doc-endnotes`, `doc-backlink`, ícono corner-up-left; `SPRITE_ICONO_VOLVER` lo incluye el layout una vez por página), alineación `alin-centro` y `alin-justificado`, letra capital solo si el primer bloque es un párrafo que empieza con una letra, títulos acotados a h2 a h6, imágenes `figure > img.cuerpo-img` con `width` y `height` desde la tabla `imagenes` (sin estilos en línea), cita destacada `blockquote.cita` con `cite`, videos de YouTube y Vimeo, tablas, `hardBreak`, enlaces solo http, https y mailto. El validador admite títulos H2 a H4. El esquema no valida los atributos de `cita` (`variante`, `autor`, `fuente`) y `autor` y `fuente` son texto plano. Las funciones de URL (`rutaArticulo`, `rutaAutor`, `rutaSeccion`, `rutaCategoria`, `urlMedia`, `normalizarRuta`) están en `@evaristo/compartido/urls`.

**Sitio** (`apps/sitio`, Astro en modo servidor, sin build por artículo: cada página se arma al pedirla leyendo la base; por eso lo que se guarda sobre un artículo publicado se ve al instante):
- Estilos: `styles/tokens.css` (tokens por función; el modo oscuro es de segunda etapa), `base.css`, `articulo.css` (cuerpo, notas, cita, imágenes al 80vh), `sitio.css` (marca, topbar, header, footer, bio, autor, tarjetas, listados). Fuentes de Google Fonts (Fraunces, Inter y Roboto solo para la marca).
- Componentes: `Marca`, `Header` (6 secciones visibles y "Más"; en celular un panel sin JavaScript), `Footer`, `Iconos`, `Articulo`, `Bio`, `Tarjeta`, `Listado`, `Paginacion`; layout `Base.astro`.
- Páginas: `/` (provisoria: los 12 últimos artículos), `/AAAA/MM/DD/slug/` (artículo), `/author/<slug>/` y `/autores/`, `/seccion/<slug>/`, `/categoria/<slug>/`, `/404`, y `/prueba-layout/` (temporal, solo en desarrollo o con `PRUEBA_LAYOUT=1`).
- Consultas con `select` explícito (nunca `visitasWp`); un artículo se ve solo si está PUBLICADO y su `publicadoEn` ya llegó.

**Servidor** (`apps/api`): `/media/<clave>` (`media.ts`), redirecciones 301 (`redirecciones.ts`) y una página 404 del sitio para cualquier ruta que no exista (en modo middleware Astro pasa a Express lo que no reconoce). El orden es: API, `/admin`, `/media`, estáticos, redirecciones, sitio y 404.

## Decisiones tomadas

- **URL canónica del artículo: `/AAAA/MM/DD/slug/`** (la de WordPress), con la fecha de `publicadoEn` en UTC (reproduce 33 de los 34 orígenes de la muestra; el 19899 difiere por un carácter invisible del slug viejo). Fecha o barra final distintas redirigen con 301. Sin redirección para lo migrado.
- **Imagen de encabezado:** proporción fija 3:2 con punto focal, de borde a borde en celular. Imágenes del cuerpo: proporción original, altura máxima 80vh.
- **Volanta:** línea propia sobre el título, Fraunces cursiva, y es un enlace a la página de su categoría principal.
- **Cantidad de notas de un listado:** etiqueta rectangular oscura (accent-900).
- **Marca:** EVARISTO en Roboto Black (900) con el negro de la paleta y CULTURAL / EDITORIAL en Roboto SemiBold (600) con `border-strong`, mayúsculas e interletrado apretado (−0,02em).
- **Menú:** seis secciones visibles (las seis primeras de `SECCIONES`) y el resto en "Más"; "Autores" en el desplegable y el footer. Secciones internas (`sin-asignar`) sin cintillo y sin página.
- **Listados** (autor, sección, categoría): de la más nueva a la más vieja, 12 por página con `?pagina=N`; página inválida vale 1, fuera de rango da 404. Las páginas de categoría incluyen las notas que tienen la categoría entre las suyas, no solo como principal.
- **Autores:** orden alfabético por nombre (no hay campo de apellido); iniciales si no hay foto; los de solo texto no tienen página; redes: una dirección http(s) o un usuario (con o sin @), el resto se descarta.
- **Letra capital:** campo del artículo (columna `conCapital`, agregada en la fase 4), apagada por defecto, también en lo migrado. El sitio todavía no la lee (ver `pendientes.md`); `?capital=1` funciona solo en desarrollo. Ninguna regla del renderizador para firmas en el cuerpo (el 620 empieza con "Por Riordan Roett": se quita a mano en la revisión).
- **Bio del autor 39 (id 60):** se sacó el correo directamente en la base (21/10/2026).
- **Fuentes** desde Google Fonts; **dependencias** con versión exacta.
- Quedó afuera a propósito: la portada real, el buscador y el menú en celular definitivo (fases 5 y 6).

## `/media/<clave>`

`MEDIA_DIR` en el `.env` (ruta absoluta; sin ella, 503). La fila de `imagenes` decide el archivo (igualdad exacta en JavaScript, porque la colación del SQL es laxa), nunca el texto de la URL; un solo segmento, sin `/`, `\`, NUL, `.`, `..` ni barras codificadas; tipos jpeg, png, gif y webp según `tipoMime`; `nosniff`; ETag con el SHA-256 y 304; `Cache-Control: public, max-age=86400`; 404 sin fila, sin archivo, carpeta u archivo oculto; 405 con `Allow`; 400 si la codificación es inválida. En la muestra: 200 imágenes (192 JPEG, 4 PNG, 4 GIF), 25,2 MB, 4 claves con caracteres fuera de `[A-Za-z0-9._-]`; el `src` guardado en los cuerpos está codificado con `encodeURIComponent`. Las imágenes solo se ven con el servidor único (`npm run dev`, puerto 3000): `dev:sitio` (4321) no incluye la API.

## Redirecciones

Las 58 de la muestra (34 de artículo, 1 de slug anterior y 23 de autor): 56 ya son la URL canónica y se atienden sin redirigir; 2 redirigen con 301 (el slug anterior `culpables` y el 19899). Busca el pedido y su variante con o sin barra final, con los `%XX` en minúscula como los guarda WordPress; destinos solo si el artículo está publicado y su fecha ya llegó (o el autor tiene página); un destino igual al pedido no redirige; la consulta (`?a=b`) se conserva; si la base falla, el pedido sigue al sitio. **No cubre** las URLs viejas que no están en la tabla (`/category/…`, `/tag/…`, `/feed/`, `/?p=ID`, `/wp-content/uploads/…`, páginas fijas): fase 7.

## Tests (todos pasan al 21/10/2026)

`test:render` (38), `test:render-35` (los 35 desde la base, solo lectura: 178 notas, 172 imágenes, 15 videos, 1 tabla), `test:media` (10), `test:media-originales` (200 de 200 imágenes con bytes y SHA-256 correctos; 172 de 172 de los cuerpos con 200), `test:redirecciones` (14), `test:redirecciones-base` (58), `test:articulos` (34 con 200, el borrador con 404, 301 con fecha o barra equivocadas), `test:autores` (23 con 200, 2 con 404, ninguna página con un correo), `test:secciones` (17 con 200, 32 notas en orden, Asia en 2 páginas), `test:categorias` (8 con 200, 9 volantas como enlace correcto y 25 sin volanta), `test:humo` (API, portada, estilos, artículos, 404 del sitio, autores, redirecciones, panel, enlaces internos e imágenes). Todo junto: `npm run test:fase3` (compila el sitio; necesita `MEDIA_DIR`). `npm run render:preview-35 -- --originales=<carpeta>` genera una vista previa estática de los 35 en `CMS-EVARISTO(ASSETS)\previews-fase3\`. **No se vio ninguna página en un navegador** (Claude Code no arranca servidores).

## Inventario de los 35 artículos de la muestra

Nodos: paragraph 3.217, footnote 178, imagen 172, hardBreak 44, listItem 29, video 15 (todos YouTube), orderedList 10, heading 4, tabla 1 (el 5296), bulletList 2. Sin nodos `cita`. Marcas: italic 1.180, bold 778, link 39. Alineación: justify en 328 párrafos y center en 8. Imágenes: 147 con alt, 25 con `altPendiente`, 35 con epígrafe. Estados: 34 PUBLICADO y 1 BORRADOR (22546). 32 de 35 tienen imagen de encabezado (el 2462 y el 22546 no tienen el original; el 22590 no tiene `_thumbnail_id`), todos sin texto alternativo; sin galería ni fichas técnicas. Autores: 25, 13 con bio, 2 de solo texto; ninguno con foto ni redes. Secciones: Asia 17, Ensayo 4, Literatura 3, Rastros 3, Música 2, `sin-asignar` 2, y 1 cada una Entrevista, Poesía, Reseña y Teatro; Crítica no tiene notas. Categorías: 8; 9 artículos con volanta.
- Notas al pie: 620, 1555, 1569, 2462, 3026, 4262, 4265, 4364, 4424, 4507, 5214, 5287, 12939. El 4265 tiene 1 nodo `footnote` y marcas `[n]` como texto (error del conversor); se muestran tal cual.
- Videos: 720, 12939, 15027 (11), 19899, 21382. `altPendiente`: 720, 15021, 15027, 16691, 19660, 19899, 22024, 22590. Cuerpo más grande: el 3306 (115 KB de JSON).

## Qué quedó abierto

Ver `pendientes.md`, sección 2: `<head>` para redes (hace falta la URL base), variantes de tamaño de las imágenes, galería y ficha técnica, botón de búsqueda, mirar el sitio en un navegador, visto bueno de la directora, manual de estilo, textos provisorios del topbar y el footer. La portada real (fase 5) y el buscador y las novedades (fase 6) siguen sin empezar.

Antes de cualquier tarea que use Prisma hay que comprobar el 3308 con `Test-NetConnection`; los prompts se pegan desde `C:\Users\Usuario\Documents\Proyectos frontend`, sin push.
