# Revista cultural Evaristo: especificación del artículo (vista individual) y autores

Estado: cerrada la parte del artículo y la de autores (ficha, bio, página de autores y página individual de autor). Pendientes: navegación, buscador y páginas de sección y categoría. La portada (Home) tiene su propia especificación (`especificacion-home.md`), que asume cinco secciones y hay que replantear (ver sección 12). Actualizada el 13/10/2026 con la regla de secciones y la categoría principal ya implementadas en el conversor, el inventario de metadatos de WordPress y la decisión sobre el contador de visitas (secciones 12 y 13). Antes, el 9/10/2026: respuesta de la editorial sobre secciones y categorías (secciones 2, 3, 9, 12 y 13), decisión de autoría (8.5 y 13.1) y resultado de la validación de lo migrado (13.2). Y el 5/10/2026: el cuerpo admite imágenes, videos, tablas simples y salto de línea (sección 4), la migración se redefine con las cifras reales (sección 13) y se decide cómo tratar las imágenes migradas sin texto alternativo (secciones 4 y 13.2).

## 1. Principios

- **Todos los artículos se ven igual.** El editor elige contenido, no estilo: sin colores, tamaños ni tipografías libres. Solo los formatos listados abajo.
- **Formato revista, no blog.** Sin etiquetas libres, sin comentarios de lectores.
- **Editores no técnicos.** El panel tiene que resultar claro para personas que no son informáticas.
- **Publicación continua**, sin números ni dossiers por ahora (ver sección 10).

## 2. Clasificación

La clasificación sigue el modelo de la prensa gráfica, no el de un blog: la **sección** es el *cintillo* del artículo y la **categoría principal** es su *volanta*.

- **Sección (cintillo):** una sola por artículo, que elige el editor. Lista cerrada de 17: Entrevista, Reseña, Ensayo, Crónica, Crítica, Rastros, Asia, Poesía, Teatro, Música, Historieta, TV & Cine, Fantástico, Arte, Infantojuvenil, Libro Ilustrado y Literatura. Mezcla formatos periodísticos y temas. Crítica arranca vacía (no existía en WordPress). Rastros (literatura negra) y Asia (antes Seda) son secciones históricas de la revista, no suplementos. Se muestra como una banda o rótulo en la parte superior del artículo.
- **Categorías:** una o varias por artículo. Lista ampliable. Cada categoría tiene su propia página y funciona como filtro; no aparecen en el menú principal. Al migrar pasan como categorías las que no ganan como sección (ver sección 13).
- **Categoría principal (volanta):** opcional. Si el artículo tiene categorías, el editor marca una como principal y esa es la única que se muestra, como volanta, en una línea corta sobre el título. Si tiene una sola, es la principal. Si no tiene ninguna, no hay volanta. Por ejemplo: cintillo "Reseña" y volanta "Música". Las demás categorías no se ven en el artículo: se usan para las páginas de categoría y para los artículos relacionados.
- **Novedad:** no es una sección ni una categoría. Es un campo opcional `novedadHasta` (fecha) del artículo: si la fecha está vigente, el artículo cuenta como novedad. Los artículos migrados arrancan sin fecha.
- Solo el administrador crea, modifica o elimina secciones y categorías. Los editores eligen de un desplegable.
- **No hay etiquetas.** Las etiquetas de WordPress se guardan ocultas, como dato de archivo del artículo (ver sección 13).

## 3. Estructura del artículo (de arriba hacia abajo)

1. **Cintillo:** la sección del artículo (ver sección 2).
2. **Imagen de encabezado**: obligatoria, una sola. Con texto alternativo y crédito.
3. **Volanta** (opcional): la categoría principal, si el artículo tiene categorías (ver sección 2).
4. **Título** (es el H1 de la página).
5. **Bajada o entradilla**: opcional. Texto corto bajo el título.
6. **Autor o autores**, con enlace a su página (ver sección 8).
7. **Fecha de publicación.**
8. **Cuerpo del texto**, con imágenes, videos y tablas simples dentro del texto (ver sección 4).
9. **Notas al pie.**
10. **Ficha técnica del libro**: opcional.
11. **Galería de imágenes**: opcional, al final de la nota.
12. **Bio del autor o autores**: una por autor (ver sección 8).
13. **Artículos relacionados.**

## 4. Cuerpo del texto

- **Títulos internos:** H2 a H4 (propuesta; se puede ampliar hasta H6 si hace falta). El H1 se reserva para el título del artículo, por SEO y accesibilidad. En la migración, los H1 dentro del cuerpo se bajan de nivel.
- **Formato de texto:** negrita, itálica, enlaces, listas. Los enlaces admiten solo http, https y mailto. No hay subrayado (en la migración se descarta).
- **Salto de línea dentro de un párrafo** (Shift+Enter): para versos, fichas y listas cortas, donde el corte de línea tiene sentido y no corresponde un párrafo nuevo. Se dibuja como un salto simple, sin el espacio de un párrafo. No se admite dentro de los títulos internos ni del título del artículo.
- **Alineación por párrafo:** izquierda por defecto; se puede cambiar a centrado o justificado.
  - El justificado usa división silábica automática y, de ser necesario, se aplica solo en pantallas anchas para evitar espacios excesivos en el celular.
- **Citas:** formato propio para citas textuales, con autor y fuente opcionales. Propuesta a confirmar: sumar un segundo formato de cita destacada (*pull quote*).
- **Imágenes dentro del texto:** la imagen se coloca en el punto exacto donde va. Lleva texto alternativo (obligatorio, o marcarla como decorativa) y epígrafe opcional. El documento guarda una referencia a la biblioteca de imágenes; solo se admiten direcciones http(s) o rutas propias del sitio. Es distinta de la imagen de encabezado (sección 5) y de la galería final (sección 6). **Regla para imágenes nuevas:** el texto alternativo es obligatorio. **Regla para imágenes migradas sin texto alternativo:** el panel deja guardar el artículo, muestra un aviso visible junto a cada imagen pendiente y no exige completarlas (ver 13.2).
- **Videos:** se pega la dirección de YouTube o Vimeo y se muestra el reproductor al renderizar la página (lista blanca de proveedores). Los enlaces de Facebook o Instagram quedan como enlace común.
- **Tablas simples:** filas, celdas de encabezado y celdas con texto. Sin celdas combinadas.
- **Notas al pie:**
  - La persona escribe la nota en una ventana en el punto exacto del texto.
  - Numeración automática (1, 2, 3…).
  - Enlace de ida y vuelta entre el número y la nota.
  - Las notas se muestran al final del artículo con su formato específico.
- **Validación:** el cuerpo se guarda como JSON estructurado y se valida contra un único esquema (`src/schema/validate.ts`), con dos modos: **estricto** para lo que se escribe en el panel (por ejemplo, la imagen nueva sin texto alternativo se rechaza) y **de migración** para lo que viene de WordPress (lo que no es un riesgo de seguridad pasa con un aviso). Ver sección 13.2.

## 5. Imagen de encabezado

- Una sola, obligatoria.
- Proporción fija para que todas queden parejas (propuesta: 16:9), con recorte y punto focal.
- Texto alternativo y crédito del fotógrafo.
- El sistema redimensiona y comprime automáticamente.

## 6. Galería de imágenes (opcional)

- Va al final de la nota.
- Cada imagen puede tener su epígrafe.
- Visor ampliado al hacer clic (propuesta).

## 7. Ficha técnica del libro (opcional)

Formulario con campos fijos, que se muestra al final de la nota si se usa:

- Título
- Autor
- Traductor
- Editorial
- Colección
- Año
- Páginas
- ISBN
- Precio (opcional)

Los campos estructurados permiten después enlazar con el catálogo de la editorial y marcar el libro para buscadores.

## 8. Autores

### 8.1 Ficha del autor (en el panel)

Cada autor tiene una ficha con campos fijos:

- **Nombre** (y slug para la URL).
- **Bio:** una sola, corta, que se usa en todos los lugares donde aparece. Límite de unos 400 a 500 caracteres. Texto simple con itálica y enlaces, sin listas ni títulos (los enlaces sirven, por ejemplo, para mencionar un libro del autor).
- **Foto:** opcional. Cuadrada, con recorte y texto alternativo.
- **Redes sociales:** campos fijos y todos opcionales: Instagram, X, Facebook, sitio web y otros que hagan falta.

### 8.2 Bio en el artículo

- Va al final de la nota, después de la ficha técnica y la galería, y antes de los artículos relacionados.
- Muestra la foto (chica) junto al texto de la bio. Sin foto, se muestra solo el texto.
- Las redes sociales **no** se muestran en la bio del artículo; están en la página del autor.
- Con varios autores: una bio debajo de otra, en el mismo orden que en el encabezado.
- Un autor sin bio: ese bloque no se muestra, sin dejar huecos.
- El nombre del autor en el encabezado enlaza a su página individual.

### 8.3 Página de autores (listado)

- Una página con todos los autores, uno debajo de otro.
- Cada autor es clickeable y lleva a su página individual.

### 8.4 Página individual del autor

- Nombre (es el H1 de la página), foto, redes sociales y bio.
- Lista de los artículos que escribió para la revista, del más nuevo al más viejo, con imagen, título, sección y fecha.

### 8.5 Autores que no son personas

Autores como "Redacción" o notas colectivas aparecen solo como texto: sin página propia, sin bio y sin enlace. En la base actual existen varios: las cuentas institucionales "Evaristo Cultural" (234 artículos), "El Festivalón" (56) y "Encuentro Internacional de Cultura Japonesa" (53), que suman 343, y cuatro cuentas más (revistaseda, Anonimo, eva y Evaristo: 29 artículos). Todas pasan como autores de solo texto, porque el autor de WordPress no dice quién escribió esos artículos (ver 13.1). Si se prefiere mostrar `revistaseda` con otro nombre, se decide en la revisión posterior a la importación.

### 8.6 Permisos

- El editor puede cargar y modificar autores.
- El administrador puede, además, eliminarlos.
- Un autor con notas publicadas no se puede eliminar.

## 9. Metadatos y flujo editorial

- **Autores:** uno o varios por artículo (ver sección 8).
- **Estados:** borrador, publicado, programado para una fecha.
- **Novedad:** campo opcional `novedadHasta` (ver sección 2).
- **Datos para redes:** descripción e imagen. Por defecto se toman de la bajada y de la imagen de encabezado, y se pueden sobrescribir.
- **Artículos relacionados:** al final de cada nota. Primero los de la misma sección y después los que comparten categorías, aunque sean de otra sección.
- **Panel:** autoguardado, borradores, vista previa antes de publicar, botón claro de "Publicar" con confirmación y mensajes de error en lenguaje común.
- **Roles:** editor (carga y publica artículos, carga y modifica autores) y administrador (gestiona usuarios, secciones y categorías, y elimina autores).
- **Contador de visitas histórico:** los artículos migrados conservan el número de visitas que tenían en WordPress, como dato de archivo. No se muestra en la revista ni en el panel y no se incrementa; se trae a pantalla solo si más adelante hace falta.

## 10. Ampliación futura: colecciones (dossiers o números)

Hoy no se construye. El modelo queda abierto para sumarlo sin tocar lo ya cargado: una entidad opcional "colección" con título, descripción, imagen y lista ordenada de artículos. Un artículo puede pertenecer a ninguna, una o varias colecciones. Implicaría una tabla nueva, una pantalla en el panel y una página pública.

## 11. Fuera de alcance

- Comentarios de lectores.
- Etiquetas visibles (las de WordPress se conservan ocultas).
- Estilos libres (colores, tamaños, tipografías).

## 12. Puntos a confirmar

- Niveles de título internos: H2 a H4 o hasta H6.
- Un solo formato de cita, o cita textual más cita destacada.
- Proporción de la imagen de encabezado (16:9 propuesto).
- Ubicación exacta del cintillo (sobre la imagen de encabezado o pegado al título): detalle de diseño a definir con la portada y la navegación.
- **Modelo de secciones con la editorial.** La dueña pidió que un artículo pueda estar en varias secciones a la vez (por ejemplo, una entrevista sobre un libro negro recién publicado en Novedades, Reseñas, Literatura y Rastros). El modelo cerrado lo resuelve con una sección, categorías con página propia y la marca de novedad. Hay que confirmárselo, junto con el nombre "Asia" para la sección que era Seda.
- **Artículos en `sin-asignar`:** qué muestra el sitio público mientras no se repartan (propuesta: se publican sin cintillo). Son 103 en la migración.
- **Volanta en los artículos migrados:** el 61 % (1.609 de 2.637) queda sin categorías y, por lo tanto, sin volanta. La especificación la define como opcional; conviene mirar cómo se ve el sitio antes de decidir si hace falta asignar categorías a más artículos.
- **Portada:** `especificacion-home.md` se pensó con cinco secciones (reseña, ensayo, crítica, entrevista, crónica). Con 17 secciones hay que replantear los bloques antes de la reunión con la editorial.
- Página de autores (propuestas, sin confirmar):
  - Orden del listado: alfabético por apellido (alternativas: por cantidad de artículos o por último publicado).
  - Qué muestra cada autor en el listado: foto y nombre, y quizás una línea corta de la bio.
  - Autores sin artículos publicados: no aparecen en el listado.
  - Dónde se enlaza el listado: en el menú o el footer, a definir con la navegación.
  - Si la lista de artículos de un autor se pagina cuando son muchos.

Decidido el 5/10/2026:

- **Imágenes migradas sin texto alternativo (813 artículos).** El panel deja guardar esos artículos con un aviso visible y exige el texto alternativo solo en las imágenes nuevas (ver 13.2).
- **Cintillo y volanta.** La sección se muestra como cintillo y la categoría principal como volanta. Se muestra solo una categoría (la principal); las demás sirven para archivo y artículos relacionados (ver sección 2).

Decidido el 9/10/2026 (tras la respuesta de la editorial):

- **Secciones:** una por artículo, lista cerrada de 17 que mezcla formatos y temas. Rastros y Asia son secciones históricas; México se elimina; no hay rubros ni suplementos (ver sección 2).
- **Categorías:** varias por artículo, con página propia, fuera del menú principal.
- **Novedad:** campo opcional `novedadHasta`, no una sección.
- **Volanta:** opcional. Se muestra la categoría principal si el artículo tiene categorías.
- **Relacionados:** primero la misma sección, después las categorías compartidas.
- **Autoría:** el autor de WordPress se toma como autor en las cuentas personales; las cuentas institucionales y cuatro más pasan como autores de solo texto (ver 8.5 y 13.1).

Decidido el 13/10/2026:

- **Categoría principal al migrar:** sin categorías, sin volanta; con una sola, esa; con dos o más, la primera según el orden de prioridad de las secciones, y las categorías que no están en esa lista van después, en orden alfabético. Hoy solo dos categorías ("Poesía rumana" y "Encuentro Internacional Literatura Fantástica") están fuera de la lista, y las dos en artículos con una sola categoría.
- **Contador de visitas de WordPress:** se guarda como número histórico por artículo, no se muestra y no se incrementa (ver sección 9).
- **Datos para redes de Facebook:** las 1.230 filas de WordPress casi no tienen contenido, así que solo pasan las que lo tienen (ver sección 13).

## 13. Migración desde WordPress (2.637 artículos publicados, 2006 a 2026)

Estado: relevamiento hecho, conversor probado y regla de secciones y categoría principal implementadas (ver `relevamiento-wordpress.md`, `prueba-inicial.md` y `plan-implementacion.md`, secciones 3 y 5). La migración es automática y se revisa por muestreo: son demasiados artículos para revisarlos uno por uno.

- **Fuente:** la base de WordPress (dump `.sql`, exportado el 5/10/2026), cargada en una base local de solo lectura y leída con SQL. Se vuelve a exportar justo antes de la migración final, y se baja `wp-content/uploads` completo del hosting.
- **Alcance:** 2.637 artículos publicados. Los 48 borradores migran como borradores. Las revisiones no se migran.
- **Slugs y redirecciones 301:** se conservan los slugs. Se redirigen las URLs viejas (`/año/mes/día/slug/`), los slugs anteriores (`_wp_old_slug`: 83 artículos y 107 filas; se descartan los valores solo numéricos y los que coinciden con el slug actual, así que quedan unos 36 slugs reales) y los de autor (`/author/…`).
- **Párrafos y formatos:** el 72% de los artículos no tiene etiquetas `<p>` en la base, así que el conversor aplica la lógica de `wpautop`. Conserva negrita, itálica, enlaces, listas, citas, tablas y alineación de párrafo. Descarta colores, tipografías, tamaños, estilos en línea y subrayado. Los H1 del cuerpo se bajan de nivel.
- **Saltos de línea:** se conservan dentro de los párrafos (aparecen en unos 450 artículos: versos, fichas y listas cortas). Dentro de un título se reemplazan por un espacio.
- **Shortcodes:** solo se interpretan `[embed]`, `[caption]` y `[gallery]`. Los corchetes que no son shortcodes (`[risas]`, marcas de nota) no se tocan.
- **Imágenes:** 2.181 artículos tienen imágenes dentro del cuerpo (7.372 en total). Pasan a nodos de imagen; el `[caption]` pasa a ser el epígrafe. Se descargan los originales, se reprocesan y se reescriben las rutas. Las 77 que apuntan a un dominio temporal se buscan por nombre de archivo. El 32% no tiene texto alternativo y queda marcado; se completan de a poco desde el panel (ver 13.2).
- **Imagen de encabezado:** sale de `_thumbnail_id` (2.635 artículos; 2 no tienen). Si un artículo tiene más de una fila (13 casos), se elige una. El crédito sale de `cb_image_credit` (12 artículos).
- **Videos:** YouTube y Vimeo pasan a nodos de video; Facebook e Instagram, a enlace.
- **Notas al pie:** unos 185 artículos (7%), todas manuales y con restos de Word o LibreOffice. Se convierten solo cuando el emparejamiento número–nota es claro; si no, el texto queda como está y el artículo se marca para revisión.
- **Títulos:** los de la forma "TÍTULO | subtítulo" se dividen en título y bajada (se dividen 1.489), y las mayúsculas (1.040 títulos) pasan a formato oración con un léxico de nombres propios, siglas y palabras comunes construido desde el cuerpo de los artículos. Los dudosos quedan marcados para revisión posterior (`palabra_ambigua` 361 y `palabra_desconocida` 66). Los de la forma "AUTOR | TÍTULO" **no se dividen**: quedan enteros y marcados con `revisar_autor_en_titulo` (51 artículos), para corregirlos desde el panel. Los 2 títulos vacíos (artículos 5562 y 5602) quedan vacíos con el aviso `titulo_vacio`. Las 193 bajadas que nombran a una persona se dejan como bajada (suelen nombrar al autor de la obra reseñada).
- **Clasificación:** la editorial respondió el 7/10/2026 y el modelo quedó cerrado (ver sección 2). Las categorías de WordPress se asignan con una tabla de mapeo editable (`data/mapeo-taxonomias.json` en el conversor), sin reglas fijas en el código. Para elegir la sección de cada artículo se usa un orden de prioridad; lo que no gana pasa a categoría y la sección ganadora no se repite como categoría:
  1. **Rastros y Asia primero.** Son secciones históricas y ningún formato les quita artículos.
  2. **Formato:** Entrevista, Reseña, Ensayo, Crónica. Entrevista se detecta por el título (la palabra completa "Entrevista" al comienzo del primer tramo o del tramo posterior a la barra), con excepciones por id (2388 y 19565 sí; 648, 9485 y 20919 no).
  3. **Tema:** Poesía, Teatro, Música, Historieta, TV & Cine, Fantástico, Arte, Infantojuvenil, Libro Ilustrado, Literatura.

  Normalizaciones: Seda pasa a Asia; "Reseñas Seda" y "Reseñas Rastros" cuentan como candidatas a Asia o Rastros además de Reseña; "Reseñas Historietas" y "Reseñas Fantástico" pasan a sección Reseña más categoría Historieta o Fantástico; "Series TV" pasa a TV & Cine; "Uncategorized" y "Artículos" se descartan; México se descarta como categoría y sus artículos conservan las demás; Novedades deja de ser categoría y esos artículos arrancan con `novedadHasta` vacío (los ids quedan guardados aparte). El artículo 21482 va a Fantástico con la categoría "Encuentro Internacional Literatura Fantástica". Las demás limpiezas (por ejemplo "Poesia" sin tilde o "TV & CINE" en mayúsculas) se resuelven en la tabla de mapeo.

  **Resultado (13/10/2026):** Entrevista 469, Asia 414, Reseña 348, Rastros 245, Literatura 237, Música 172, Historieta 113, `sin-asignar` 103, Poesía 102, TV & Cine 99, Ensayo 81, Teatro 73, Fantástico 68, Crónica 35, Libro Ilustrado 32, Arte 23 e Infantojuvenil 23. Rastros y Asia no bajan de los mínimos de la corrida anterior (190 y 379). Quedan para revisión manual el 593 (una entrevista en Asia, por prioridad) y el 18633 (en Entrevista).

  **Sin sección posible:** los artículos que no tienen ninguna candidata quedan en una sección interna `sin-asignar` (103: 95 solo con Novedades, 7 solo con Uncategorized y el 22590, solo con "Artículos"), con un reporte (CSV) para repartirlos después. La migración no se frena por eso.

  **Categoría principal (volanta):** como WordPress no tiene el concepto, el conversor la elige con el mismo orden de prioridad entre las categorías que quedan (las que no están en la lista van después, en orden alfabético); se corrige desde el panel si hace falta. Resultado: 1.609 artículos sin categorías (sin volanta), 952 con una, 74 con dos y 2 con tres.
- **Etiquetas:** los 5.959 términos únicos de WordPress (9.300 asignaciones en 2.250 artículos) se guardan ocultos. Las demás taxonomías de la base no tienen artículos publicados.
- **Contador de visitas:** el `cb_visit_counter` (en los 2.637 artículos) se guarda como número histórico, sin mostrarlo.
- **Fichas técnicas:** se migran como texto del cuerpo. Después, una segunda pasada semiautomática las pasa a los campos del formulario (unas 369 fichas de libro).
- **Datos para redes y SEO:** las 1.230 filas de `_webdados_fb_open_graph_*` casi no tienen contenido (1 descripción y 5 imágenes); solo esas pasan como sobrescritura y el resto usa la bajada y la imagen de encabezado. Tampoco hay Yoast útil: solo el artículo 13898 tiene metadatos.
- **Links internos** entre artículos: se reescriben.
- **Muestra:** se migran primero 30 artículos elegidos a propósito (cada uno cubre una variante: los más viejos, los más cargados, cada método de notas al pie, embeds, tablas, fichas, bios), para ajustar el script antes de correr los 2.637.
- **Resultado del conversor** sobre los 2.637 artículos: 0 errores, 0 documentos inválidos en modo migración y 2.523 sin pérdida de texto. De los 114 con alguna palabra perdida, solo 2 superan el 1% (numeraciones romanas de notas).
- **Revisión manual:** se concentra en los artículos marcados por el conversor (unos 40 con notas al pie que no cierran, tablas, bios dudosas, imágenes sin texto alternativo, títulos con aviso y artículos en `sin-asignar`) y en una muestra de los demás, repartida por época, sección y tipo de contenido.

### 13.1 Migración de autores

Son 424 autores con artículos. Las bios, fotos y redes se completan desde el panel una vez migrado el contenido. El script hace lo siguiente:

1. **Crea los autores** con nombre y slug, para que cada artículo migrado quede enlazado a su autor. **Criterio de autoría:** el autor de WordPress se toma como autor en las cuentas personales. Es la única señal que hay: solo 29 artículos tienen una firma en el cuerpo (2 en cuentas institucionales y 27 en personales; de esas 27, 18 coinciden con el autor de WordPress y 9 no), y la cuenta administradora figura como última editora en casi todo, así que no distingue quién subió cada artículo.
2. **Importa las 200 bios que ya existen** en el perfil de usuario de WordPress (de 443 usuarios), como punto de partida para revisar.
3. **Genera una planilla de autores** con nombre, cantidad de notas y el texto de bio que encuentre (en el perfil o al final de las notas), para cargar o revisar sin ir nota por nota.
4. **Saca la bio del cuerpo de la nota** solo cuando está seguro de que es una bio. Unos 326 artículos terminan con un párrafo que parece una bio y solo 12 tienen una línea horizontal antes, así que la detección es incierta: si hay duda, el párrafo queda en el cuerpo y el artículo se marca para revisión.
5. **Conserva los slugs de autor** de WordPress (`/author/nombre`) y arma redirecciones 301 hacia las nuevas páginas de autor.
6. **Autores que no son personas** (caso 8.5): las cuentas institucionales y las cuatro adicionales (372 artículos en total) se crean como autores de solo texto.

Las fotos y las redes no están en WordPress (el perfil solo guarda un campo obsoleto de Google+, vacío en todos los usuarios), así que se cargan a mano. Quedan para la revisión posterior a la importación: las 9 firmas que no coinciden con el autor de WordPress, las 2 firmas dentro de cuentas institucionales y los 51 títulos con el autor adelante.

### 13.2 Validación de lo migrado

Todo documento pasa por el mismo validador que usa el panel, en modo migración. Los errores de seguridad (direcciones `javascript:` o `data:`, proveedores de video no admitidos) siguen siendo errores. Lo demás se registra como aviso en el informe por artículo:

- imagen sin texto alternativo (2.431 imágenes en 813 artículos), que el conversor marca con `altPendiente`;
- imagen con ruta relativa (1 artículo, el 5360: cuatro íconos de un documento de Word que quedaron como imágenes sueltas en medio del texto; queda para revisión manual);
- salto de línea dentro de un título, reemplazado por un espacio (2 artículos).

En modo migración los 2.637 artículos pasan sin errores. En modo estricto falla 1, el 5360. Los 813 artículos con imágenes sin texto alternativo pasan gracias a `altPendiente`.

**Decisión (5/10/2026), aplicada el 6/10/2026:** el panel deja guardar un artículo migrado aunque tenga imágenes sin texto alternativo. Cada imagen pendiente muestra un aviso visible en el editor, y el texto alternativo sigue siendo obligatorio para las imágenes nuevas. Consecuencias:

- El nodo de imagen tiene el atributo `altPendiente`: el conversor lo pone en las imágenes sin texto alternativo y el editor lo quita al completar el texto. Una imagen decorativa nunca es pendiente.
- El validador estricto acepta `altPendiente: true` solo en una imagen sin texto alternativo; una imagen sin texto y sin la marca se rechaza.
- El validador no puede saber si la marca es legítima (viene de la migración) o la agregó alguien a mano. Esa verificación la hace el servidor en la fase 4: compara con la versión guardada antes y acepta la marca solo en imágenes que ya la tenían.
- Se prevé una vista de "artículos con imágenes pendientes de texto alternativo" en el panel, para completarlas de a poco.
