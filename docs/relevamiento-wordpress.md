# Revista cultural Evaristo: relevamiento de la base de WordPress

Estado: informe del paso 1b de `prueba-inicial.md`. Fuente: dump de la base `u728005081_evaristo` exportado el 5/10/2026 (MariaDB 11.8, 152 MB). Se cargó en un MariaDB y se analizó el contenido de los 2.637 artículos publicados. Los datos de usuarios (emails, contraseñas) no se copiaron a ningún documento.

## 1. Resumen

1. **Son 2.637 artículos publicados, no ~300.** Hay además 48 borradores y 1 privado. Desde 2006 hasta 2026; el 78% salió entre 2015 y 2021.
2. **El sitio usa el editor clásico de WordPress.** Solo 2 artículos tienen bloques de Gutenberg. No hay ningún plugin de notas al pie ni de galerías activo.
3. **El 72% de los artículos no tiene etiquetas `<p>` en la base.** Los párrafos son saltos de línea que WordPress convierte al mostrar. El conversor tiene que imitar ese comportamiento.
4. **Las notas al pie son pocas y regulares.** Solo el 7% de los artículos (182 a 189) las tiene, casi todas con restos de Word y LibreOffice. Cerca de 100 se convierten de forma automática.
5. **El contenido real choca con la especificación en seis puntos** (sección 11): imágenes dentro del cuerpo, videos, secciones y categorías, etiquetas, fichas técnicas y bios.
6. **Hay 424 autores con artículos**, 200 con bio cargada en el perfil de WordPress, y varios autores institucionales.
7. **Las imágenes están en una carpeta plana** (`wp-content/uploads`, sin año ni mes): 10.975 archivos, casi todos JPG.

## 2. Tamaño y época

| Dato | Valor |
|---|---|
| Artículos publicados | 2.637 |
| Borradores / privados | 48 / 1 |
| Páginas | 5 publicadas |
| Adjuntos (imágenes y archivos) | 10.975 |
| Revisiones (no se migran) | 6.530 |
| Rango de fechas | 2006 a 2026 |
| Años más cargados | 2015 (295), 2016 (381), 2017 (332), 2020 (289), 2021 (333) |
| Largo | mediana 962 palabras; el 10% pasa de 3.400; 116 artículos superan 5.000; máximo 18.165 |
| Muy cortos (menos de 100 palabras) | 50 |

La producción casi se frena en 2022: 55 artículos en 2022, 25 en 2023 y 2 en 2026.

## 3. Cómo está escrito el contenido

El tema es *Valenti* (de Cubell Themes) y el editor es el clásico. Plugins activos relevantes: Classic Editor, Disable Comments, LiteSpeed Cache, WP Cerber (seguridad), más dos del tema. Ninguno agrega formatos propios al contenido.

| Patrón en el cuerpo | Artículos | % |
|---|---|---|
| Sin etiquetas `<p>` (párrafos por salto de línea) | 1.915 | 72,6% |
| Con `<p>` | 722 | 27,4% |
| Negrita | 1.639 | 62% |
| Itálica | 2.111 | 80% |
| Estilos en línea (`style="…"`) | 687 | 26% |
| `text-align` (centrado, derecha, justificado) | 377 | 14% |
| `&nbsp;` | 1.334 | 51% |
| `<span>` | 427 | 16% |
| Títulos internos (H1 a H6) | menos de 25 en total | menos de 1% |
| Citas `<blockquote>` | 34 | 1,3% |
| Listas | 59 | 2,2% |
| Tablas | 15 | 0,6% |
| Subrayado `<u>` | 30 | 1,1% |
| Líneas horizontales `<hr>` | 44 | 1,7% |

Conclusiones para el conversor:

- Hay que portar la lógica de `wpautop` de WordPress (los saltos de línea dobles son párrafos) y los `&nbsp;` y bloques vacíos que sobran.
- Los títulos internos casi no existen. La estructura se hace con negrita, así que no hay mucho que bajar de nivel (solo 9 H1).
- Los estilos en línea se descartan, salvo la alineación de párrafo, que se traduce a izquierda, centrado o justificado. Los colores (por ejemplo `color: #ff9900` en nombres) se pierden a propósito.
- Los corchetes que no son shortcodes de WordPress (`[risas]`, `[i]`) no se deben tocar. Solo se interpretan `[embed]`, `[caption]` y `[gallery]`.

## 4. Notas al pie

Solo 182 a 189 artículos (alrededor del 7%) tienen notas. Ningún artículo usa shortcodes de plugins (`[efn_note]`, `[mfn]`, etc.) ni las notas nativas de WordPress 6.3. Todas son manuales, y casi todas son restos de pegar texto desde Word o LibreOffice.

| Variante | Cómo se ve en la base | Artículos | Conversión |
|---|---|---|---|
| Word, notas al pie emparejadas | `<a href="#_ftn1" name="_ftnref1">[1]</a>` en el texto; `<a href="#_ftnref1" name="_ftn1">[1]</a> texto` al final | 75 | automática |
| Word, notas al pie que no cierran | marcas sin notas, notas sin marcas o cantidades distintas | 32 | parcial, con revisión |
| LibreOffice | `sdfootnote1anc` / `sdfootnote1sym` | 5 | automática |
| Word, notas finales (numeración romana) | `_edn1` / `_ednref1`, marcas `[i]`, `[ii]` | 23 | automática (emparejamiento por verificar) |
| Texto plano `[1]`, `[2]`, sin ancla | marca en el texto y nota al final | 46 | probable; solo si la numeración es consecutiva |
| Dudosas | `[n]` sueltos que pueden no ser notas | 6 | revisión |
| `<sup>` numérico sin ancla | | 2 | revisión |

De los 32 que no cierran: 15 tienen notas al final pero no las marcas en el texto, 7 tienen marcas pero no las notas, 5 no tienen el enlace de vuelta y 5 tienen cantidades distintas.

- **Automáticos con alta confianza:** unos 100 artículos (75 + 5 + 23).
- **Para revisar a mano:** unos 40 (32 + 6 + 2), más los 46 de texto plano si la verificación falla.
- **Extremos:** un artículo llega a 54 notas, otros a 49 y 48. El editor ya aguanta ese volumen, y estos artículos sirven para probarlo.

## 5. Imágenes

| Dato | Valor |
|---|---|
| Adjuntos | 10.975 (JPEG 10.625, PNG 275, GIF 66, BMP 7, 1 PDF, 1 DOCX) |
| Carpeta | plana: sin subcarpetas por año o mes |
| Imagen destacada | 2.635 de 2.637 artículos |
| Artículos con imágenes dentro del cuerpo | 2.181 (82,7%) |
| Imágenes dentro del cuerpo | 7.372 (mediana 2 por artículo; máximo 70; 97 artículos con 10 o más) |
| Con `[caption]` (epígrafe) | 373 artículos, 777 imágenes |
| Sin texto alternativo | 2.431 (32%) |
| Dominio | 98% en `evaristocultural.com.ar`; 77 en `damiaea.cleopatra.urltemporal.com` (un dominio temporal); 23 en `evaristocultural.ar`; 7 en wordpress.com |

Las 77 imágenes del dominio temporal hay que buscarlas por nombre de archivo en `uploads`, porque probablemente ya no se pueden descargar de esa dirección. Las imágenes no están en el dump: hay que bajar `wp-content/uploads` del hosting para el paso 4.

## 6. Videos y embeds

| Tipo | Artículos |
|---|---|
| `[embed]` de una URL (en su mayoría YouTube) | alrededor de 470 (1.616 apariciones) |
| YouTube (enlace o embed) | 472 |
| Facebook | 55 |
| Instagram | 8 |
| `<iframe>` | 26 |
| Spotify, SoundCloud, Vimeo | 7 |
| Twitter/X | 0 |

## 7. Categorías y etiquetas

- **26 categorías, todas planas** (sin jerarquía). 1.862 artículos tienen 1 categoría, 625 tienen 2, 141 tienen 3 y 9 tienen 4. Las más usadas: Literatura (543), México (407), Seda (403), Reseñas (380), Música (225), Rastros (212), Poesía (202), Historieta (195), TV & Cine (176), Fantástico (158), Ensayo (126), Teatro (104), Novedades (102).
- **Mezclan secciones, géneros y rubros propios de la revista.** Hay variantes como "Reseñas Seda" o "Reseñas Historietas". "México", "Seda" y "Rastros" no encajan en la lista de secciones ni de categorías de la especificación.
- **5.959 etiquetas** con 9.300 usos. Las más usadas: narrativa argentina (169), Poesía (93), Literatura argentina (92), Japón (79).

## 8. Autores y bios

- **424 usuarios** de WordPress tienen artículos (de 443 en total). Cada usuario es un autor.
- **Los más productivos:** Damián Blas Vives (351), "Evaristo Cultural" (234), Luis Adrián Vives (231), Nicolás Ferraro (151), Candelita Gómez (136), Roxana Artal (88).
- **Autores que no son personas:** "Evaristo Cultural", "El Festivalón" (56), "Encuentro Internacional de Cultura Japonesa" (53), entre otros. Corresponden al caso 8.5 de la especificación.
- **Bios en el perfil de usuario:** 200 usuarios tienen el campo `description` cargado.
- **Bios dentro del cuerpo:** unos 326 artículos terminan con un párrafo que parece una bio ("nació en…", "es escritor…"). Solo 12 tienen un `<hr>` antes. Sin separador claro, la detección es incierta y hay que apoyarse en la revisión.
- **Redes:** el perfil guarda un campo "googleplus" (obsoleto) y "position". No hay Instagram, X ni Facebook.

## 9. Fichas técnicas y créditos en el texto

Están escritos como texto, no como datos:

- **Fichas de libro** ("Editorial: …", "Páginas: …"): unos 369 artículos.
- **Fichas de obra de teatro o cine** ("Dirección:", "Elenco:", "Intérpretes:"): 78 artículos.
- **Créditos de fotos o ilustraciones** ("Foto:", "Ilustración:"): 99 artículos.

## 10. Metadatos y datos que no se migran

- **Datos para redes:** 1.230 artículos tienen descripción e imagen propias para Facebook (plugin Webdados Open Graph). Encajan con los "datos para redes" sobrescribibles de la especificación.
- **SEO:** no hay Yoast ni otro plugin de títulos y descripciones.
- **Extracto:** solo 2 artículos lo usan, así que no sirve de fuente para la bajada.
- **Visitas:** el tema guarda un contador de visitas (`cb_visit_counter`) en todos los artículos, útil si se quiere un ranking de "más leídos".
- **Títulos:** 1.522 tienen la forma "TÍTULO | subtítulo" y 1.040 están en mayúsculas.
- **URLs viejas:** `/%year%/%monthnum%/%day%/%postname%/`. 83 artículos tienen además un slug anterior (`_wp_old_slug`) que también necesita redirección.
- **No se migra:** revisiones, tablas de WP Cerber y LiteSpeed, BuddyPress (solo quedan emails de plantilla), menús y opciones del tema, la mayoría de los metadatos `cb_*`, `_edit_lock`, `_oembed_*`.

## 11. Contrastes con la especificación (decisiones a tomar)

| # | Punto | Lo que dice la especificación | Lo que hay | Recomendación |
|---|---|---|---|---|
| 1 | **Imágenes dentro del cuerpo** | Solo imagen de encabezado y galería al final | 82,7% de los artículos, 7.372 imágenes, 373 artículos con epígrafe | Sumar al editor un nodo "imagen" con texto alternativo y epígrafe. Convertir todo a galería final pierde la posición de cada imagen |
| 2 | **Videos** | No se menciona | 472 artículos con YouTube; Facebook 55, Instagram 8 | Nodo "video" limitado a YouTube y Vimeo (la URL se convierte en iframe al renderizar, con lista blanca). Facebook e Instagram, como enlace |
| 3 | **Secciones y categorías** | Sección: 5 valores. Categorías: lista cerrada | 26 categorías planas, con México, Seda y Rastros | Hace falta una tabla de equivalencias; definirla con la editorial (ver pregunta abajo) |
| 4 | **Etiquetas** | No hay | 5.959 etiquetas | No mostrarlas, pero guardarlas en un campo de archivo del artículo para no perderlas |
| 5 | **Ficha técnica** | Formulario con campos fijos | ~369 fichas escritas como texto | Migrar primero como texto del cuerpo; después, una segunda pasada semiautomática que las convierta a campos |
| 6 | **Bios** | Se cargan a mano desde el panel | 200 bios ya existen en el perfil de usuario; 326 artículos con bio al final | Importar las 200 existentes como punto de partida y revisar las demás con la planilla |
| 7 | **Títulos** | Título + bajada separados | 1.522 con "título \| subtítulo", 1.040 en mayúsculas | Dividir en el `\|`: lo anterior es el título, lo posterior es la bajada. Para las mayúsculas, decidir si se normalizan |
| 8 | **Tablas, subrayado** | No se admiten en el editor | 15 artículos con tablas, 30 con subrayado | Revisión manual de las tablas; el subrayado se descarta |
| 9 | **Cantidad** | ~300 artículos | 2.637 | Actualizar la especificación (sección 13) y el plan |

**Pregunta para la editorial:** ¿qué son "México", "Seda" y "Rastros"? ¿Son secciones de la revista, suplementos, rubros de un autor o un tema? De la respuesta depende cómo se reparten entre sección y categoría.

## 12. Muestra de artículos

El archivo `packages/compartido/src/conversor/tests/fixtures/muestra-wordpress.json` tiene 30 artículos con su contenido crudo (sin datos de usuarios), elegidos para cubrir cada patrón. Se pasó de ~20 a 30 porque cada uno cubre una variante distinta.

| ID | Año | Qué prueba |
|---|---|---|
| 1555 | 2006 | El más viejo; notas Word |
| 5372 | 2008 | Primeros años, con imágenes |
| 2462 | 2008 | Notas Word emparejadas, cantidad normal |
| 620 | 2009 | Notas Word emparejadas, cantidad extrema (54 notas) |
| 4424 | 2006 | Word: notas al final sin marcas en el texto |
| 4262 | 2007 | Word: marcas sin notas al final |
| 5287 | 2007 | Word: cantidad de marcas y notas no coincide |
| 4513 | 2006 | Word: falta algún enlace de vuelta |
| 3026 | 2009 | Notas de LibreOffice |
| 4364 | 2006 | Notas `[1]` como texto plano |
| 19 | 2008 | Marcas romanas `[i]` sin ancla |
| 12939 | 2017 | Notas finales de Word (`_edn`) |
| 10929 | 2016 | Superíndice sin ancla |
| 22024 | 2022 | Bio tras `<hr>`; autor institucional |
| 10730 | 2016 | Muchísimas imágenes |
| 4265 | 2007 | Imágenes con `[caption]` |
| 15027 | 2018 | Muchos `[embed]` de video |
| 21382 | 2021 | `<iframe>` |
| 16691 | 2019 | Embed de Instagram |
| 15021 | 2018 | Embed de Facebook |
| 5296 | 2007 | Tablas |
| 1569 | 2006 | Títulos internos, cita y lista |
| 5214 | 2007 | H1 dentro del cuerpo |
| 3306 | 2010 | El más largo (18.165 palabras) |
| 720 | 2015 | Muy corto |
| 22590 | 2026 | Bloques de Gutenberg |
| 14791 | 2018 | Estilos en línea y alineaciones |
| 3433 | 2008 | Ficha de libro en el texto |
| 4507 | 2006 | Ficha de teatro o cine en el texto |
| 22255 | 2022 | Párrafos por saltos de línea, sin `<p>` |

## 13. Próximos pasos

1. Revisar la muestra y decidir los puntos de la sección 11, sobre todo el 1 y el 2, porque agregan nodos al editor.
2. Con las decisiones, ajustar el editor de la prueba (nodos de imagen y de video) y actualizar `plan-implementacion.md`, `prueba-inicial.md` y la sección 13 de `especificacion-articulo.md` (cifras y alcance).
3. Construir el conversor HTML → JSON y probarlo contra los 30 artículos de la muestra.
4. Bajar `wp-content/uploads` del hosting antes del paso 4, y volver a exportar la base justo antes de la migración final.
