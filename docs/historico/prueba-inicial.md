# Revista cultural Evaristo: prueba inicial

Estado: pasos 1 y 2 hechos (actualizado el 6/10/2026). La prueba del editor salió bien, el relevamiento de WordPress está hecho, el conversor se probó sobre los 2.637 artículos publicados y ya incluye la normalización de títulos y el atributo `altPendiente` de las imágenes migradas sin texto alternativo. Siguen el esqueleto del proyecto (paso 3) y el modelo de datos con la migración de la muestra (paso 4). Detalla el arranque del proyecto: la fase 0 y el comienzo de la fase 2 de `plan-implementacion.md`, en el orden en que conviene hacerlos. Complementa `especificacion-stack.md`, `especificacion-articulo.md` y `relevamiento-wordpress.md`.

## 1. Objetivo

Confirmar, antes de construir el sitio y el panel, las dos piezas con más riesgo técnico:

- que **TipTap** resuelve bien las notas al pie y los formatos cerrados;
- que el contenido de **WordPress** se puede convertir al formato nuevo (JSON estructurado) sin pérdidas, y cuánto trabajo manual va a requerir.

Resultado: las dos cosas se confirmaron. TipTap funciona, y el conversor pasó los 2.637 artículos sin errores, con 2.523 sin pérdida de texto. El trabajo manual se concentra en los artículos que el conversor deja marcados (sección 5.4).

## 2. Orden de trabajo

| Paso | Qué | Depende de | Estado |
|---|---|---|---|
| 1 | Prueba del editor + relevamiento de la base de WordPress (en paralelo) | — | Hecho |
| 2 | Conversor HTML → JSON, probado sobre la muestra y sobre los 2.637 artículos; incluye normalización de títulos y `altPendiente` | 1 | Hecho (quedan el 5360 y la revisión posterior a la importación) |
| 3 | Esqueleto del proyecto (fase 1 del plan) | 1 | Pendiente |
| 4 | Modelo de datos y script de migración completo (fase 2 del plan) | 2, 3 | Pendiente |

Los pasos 1 y 2 no necesitan servidor del proyecto: se hicieron con una mini app y funciones aisladas, y el conversor lee los artículos de un archivo extraído de la base. Los pasos 2 y 3 pueden avanzar en paralelo.

## 3. Paso 1a: prueba del editor

Una mini app en React + Vite + TypeScript con TipTap 3, separada del proyecto. Se armó con Claude Code a partir de un prompt. El código vive en el repositorio de la prueba del editor (`testing-tiptap`).

### 3.1 Qué incluye

- **Formatos cerrados:** títulos H2 a H4, negrita, itálica, enlaces (solo http, https y mailto), listas, alineación por párrafo (izquierda, centrado, justificado). Sin código, tachado, subrayado ni línea horizontal.
- **Nota al pie:** nodo inline y atómico, con el texto de la nota guardado como mini documento JSON (admite itálica, negrita y enlaces). El número no se guarda: en el editor lo pone un contador de CSS y en la página lo calcula el renderizador.
- **Ventana de la nota:** modal con un mini editor; guardar, cancelar y eliminar. Una nota vacía se elimina.
- **Cita:** nodo propio con variante (textual o destacada), autor y fuente opcionales.
- **Imagen** (con texto alternativo y epígrafe), **video** (YouTube y Vimeo) y **tabla simple**, sumados después del relevamiento de WordPress, porque el contenido real los usa (ver `plan-implementacion.md`, sección 3.2).
- **`altPendiente` en la imagen** (6/10/2026): atributo opcional del nodo de imagen para las imágenes migradas sin texto alternativo. El conversor lo pone; el editor muestra un aviso visible junto a la imagen y lo quita al completar el texto; nunca lo activa en una imagen nueva. Si después se borra el texto, la marca no vuelve (pasa a ser un error del modo estricto). Una imagen decorativa nunca es pendiente.
- **Salto de línea dentro de un párrafo** (Shift+Enter), admitido porque el 17% de los artículos lo usa (versos, fichas y listas cortas). Solo dentro de párrafos: en los títulos el atajo no hace nada, el esquema no admite el salto en el contenido de un título y el pegado de un `<br>` dentro de un título lo convierte en un espacio.
- **Renderizador:** función pura de JSON a HTML, sin dependencias del editor (se reutiliza después en Astro), con la lista de notas al final y enlaces de ida y vuelta. También genera el texto plano para el buscador. Una imagen con `altPendiente` se dibuja con `alt=""` y la marca no aparece en el HTML.
- **Validador único** (`src/schema/validate.ts`), compartido con el conversor, con dos modos: estricto (panel) y de migración (conversor). Reúne las reglas de estructura (qué nodo puede ir dentro de cuál, listas y citas vacías) y las de seguridad y accesibilidad (direcciones de imagen, texto alternativo, proveedores de video, celdas de tabla). Reglas de `altPendiente`: en estricto, imagen sin texto y sin marca es error; con marca y sin texto es válida; con marca y con texto completo, con marca en una imagen decorativa o con un valor que no sea booleano es error. El validador no puede saber si una marca es legítima (viene de la migración) o la agregó alguien a mano: esa verificación, comparar con la versión guardada antes, la hace el servidor en la fase 4.
- **Interfaz:** editor a la izquierda; a la derecha, vista previa, JSON, texto plano y validación (con la cantidad de imágenes pendientes).

### 3.2 Qué había que probar

1. Insertar, editar, mover (cortar y pegar, arrastrar), borrar y deshacer notas: la numeración tiene que quedar siempre bien, en el editor y en la vista previa.
2. Itálica y enlaces dentro de una nota.
3. Pegar texto desde Word o desde una web: no tienen que entrar colores, tamaños ni tipografías.
4. Citas textual y destacada, con autor y fuente.
5. Alineación por párrafo, y el justificado solo en pantallas anchas.
6. Uso desde el celular.

### 3.3 Resultado

Las notas al pie funcionan sin trucos raros y el pegado desde WordPress conserva los formatos permitidos y descarta el resto. TipTap queda confirmado; no hizo falta evaluar Lexical. Las pruebas automáticas cubren el editor (15 pruebas, incluidas las de Shift+Enter en títulos y de `altPendiente`), el renderizador y el validador.

El bloqueo de Shift+Enter en los títulos, que estaba pendiente, quedó hecho el 6/10/2026.

## 4. Paso 1b: relevamiento de la base de WordPress

Hecho el 5/10/2026 sobre el dump de la base (MariaDB 11.8, 152 MB). El informe completo está en `relevamiento-wordpress.md`.

### 4.1 Qué se relevó

- Cantidad y época de los artículos, editor usado y plugins activos.
- **Notas al pie:** cuántos artículos usan cada método. Resultado: no hay shortcodes de plugins ni notas nativas; todas son manuales (restos de Word y LibreOffice), unos 185 artículos.
- Shortcodes, embeds, galerías, tablas y títulos H1 dentro del cuerpo.
- **Bios de autor:** 200 en el perfil de usuario; unos 326 artículos terminan con un párrafo que parece una bio.
- **Imágenes:** cantidad, ubicación (carpeta plana, 10.975 archivos), rutas externas (77 en un dominio temporal) y texto alternativo (falta en el 32%).
- **Categorías y etiquetas:** 26 categorías planas y 5.959 etiquetas.

### 4.2 Resultado

- Un informe con las cantidades de cada punto y ejemplos.
- La **muestra de 30 artículos** (se pasó de ~20 porque cada uno cubre una variante distinta): los más viejos, los más cargados, y al menos uno por cada método de notas al pie, tipo de embed y forma de bio encontrados. Se guarda con su contenido crudo en `muestra-wordpress.json`.

### 4.3 Relevamientos complementarios (6/10/2026)

Hechos sobre una base local de solo lectura (MariaDB 11.8 portable, fuera del repositorio, cargada con el mismo dump; ver sección 8).

- **Categorías.** Los totales coinciden con el relevamiento y las 26 son planas (`parent = 0`). Salieron cinco planillas en `conversor/out/` (ignorada por git): categorías con totales, pares, combinaciones, ejemplos y un JSON de categorías por artículo. 1.862 artículos tienen 1 categoría, 625 tienen 2, 141 tienen 3 y 9 tienen 4: son 775 los que necesitan elegir categoría principal. México no aparece nunca como categoría única; Seda y Rastros se combinan mucho; Novedades casi siempre va sola y solo aparece en 2016, 2017, 2018 y 2022. Las variantes "Reseñas Seda", "Reseñas Rastros", "Reseñas Historietas" y "Reseñas Fantástico" casi nunca llevan además la categoría del rubro. Los datos se discuten en `plan-implementacion.md`, sección 3.4.
- **Autoría.** El autor de WordPress es la única señal de autoría que hay: solo unos 29 artículos tienen una firma en el cuerpo, y la cuenta administradora figura como última editora en casi todo (no distingue quién subió cada artículo). Las cuentas personales se toman como autor (de 27 firmas, 18 coinciden con el autor de WordPress). Las institucionales (Evaristo Cultural 234, El Festivalón 56 y Encuentro Internacional de Cultura Japonesa 53, en total 343 artículos) no permiten saber quién escribió. Cuatro cuentas más (revistaseda, Anonimo, eva y Evaristo, 29 artículos) se tratan igual, como autores de solo texto. La revisión de los casos dudosos queda para después de la importación.

## 5. Paso 2: conversor HTML → JSON

Una función aislada que recibe el HTML de un artículo de WordPress y devuelve el documento JSON del editor más una lista de advertencias, y desde el 6/10/2026 también el título y la bajada normalizados. Vive en la carpeta `conversor/` del repositorio de la prueba del editor (rama `integracion-conversor`) y comparte el validador con el editor. Tiene un README con los pasos para repetir el proceso en otra máquina.

### 5.1 Qué hace

- Aplica la lógica de `wpautop` de WordPress, porque el 72% de los artículos no tiene etiquetas `<p>` en la base.
- Convierte párrafos, títulos (los H1 bajan a H2), negrita, itálica, enlaces, listas, citas, tablas y alineación. Los saltos de línea dentro de un párrafo se conservan; dentro de un título pasan a un espacio.
- Convierte `[caption]` y las imágenes del cuerpo a nodos de imagen, y las direcciones de YouTube y Vimeo (`[embed]` o enlaces) a nodos de video. Las imágenes sin texto alternativo salen con `altPendiente: true`.
- Convierte las notas al pie de las variantes de Word, LibreOffice y texto plano al nodo de nota al pie. Las notas hechas a mano se convierten solo cuando el emparejamiento número–nota es claro; si no, el texto queda como está y se agrega una advertencia.
- Descarta los estilos en línea, las clases, el subrayado y las etiquetas no permitidas.
- Normaliza el título y separa la bajada (ver 5.5).
- Registra como advertencia todo lo que no pudo convertir o merece revisión: imágenes con ruta relativa, saltos de línea en títulos, notas que no cierran, posibles bios en el cuerpo y los avisos del título.

Quedan para el script completo del paso 4: la descarga y el reprocesado de las imágenes, la galería, la ficha técnica, los autores y las redirecciones.

### 5.2 Cómo se prueba

- Un extractor (`conversor/scripts/extraer-posts.ts`) lee los 2.637 artículos publicados de la base de WordPress y genera `posts.json`, que no se sube al repositorio. El conversor se ejecuta sobre ese archivo.
- La muestra de 30 artículos (`conversor/fixtures/`) tiene su salida de referencia (`muestra-convertida.json`). El conversor tiene que reproducirla sin diferencias.
- Cada resultado pasa por el validador compartido en modo migración. Las pruebas automáticas cubren el conversor (19), los títulos (41) y la integración de títulos (10).
- Las advertencias se juntan en un reporte por artículo (`reporte-por-articulo.json`) y en un CSV con una fila por aviso (`avisos-por-articulo.csv`, columna `revision_humana`). [Nota 21/10/2026: el CSV de `referencias/datos/` es un resumen por artículo, sin esa columna; la versión con `revision_humana` la genera `packages/compartido/scripts/conversor/run-corpus.ts` en `out/`, ignorado por git.]
- Control de que el cuerpo no cambia: un hash del cuerpo convertido de los 2.637 artículos, antes y después de cada cambio del conversor.

### 5.3 Resultado

| Qué se midió | Resultado |
|---|---|
| Artículos convertidos | 2.637 |
| Errores del conversor / documentos inválidos | 0 / 0 |
| Sin pérdida de texto | 2.523 |
| Con alguna palabra perdida | 114, de los cuales 2 superan el 1% (numeraciones romanas de notas) |
| Muestra de 30 contra la salida de referencia | 0 diferencias |
| Validador en modo migración | 0 errores |
| Validador en modo estricto | 1 inválido (el 5360, por 4 imágenes con ruta relativa). Antes de `altPendiente` eran 813, todos por imagen sin texto alternativo |
| Imágenes marcadas con `altPendiente` | 2.431, en 813 artículos |

Se cumplió el criterio de cierre: los artículos se convierten sin pérdida de texto en su gran mayoría, las notas al pie quedan numeradas por el renderizador y todo lo que no se pudo convertir figura en las advertencias.

### 5.4 Qué queda para revisión manual

- Artículos con notas al pie que no cierran (unos 40).
- Artículos con tablas y posibles bios en el cuerpo.
- 813 artículos con imágenes pendientes de texto alternativo: ya se pueden guardar con aviso y se completan de a poco desde el panel (ver `especificacion-articulo.md`, sección 13.2).
- El artículo 5360: cuatro íconos pequeños de un documento de Word (`interior/image001.gif` a `004.gif`) que el conversor deja como imágenes sueltas con ruta relativa. Para decidir si se rescatan o se sacan hay que revisar los archivos en `wp-content/uploads`, que todavía no están descargados.
- Los 114 artículos con alguna palabra perdida, empezando por los 2 que superan el 1%.
- Los avisos de títulos (ver 5.5), después de la importación.
- Las cuentas institucionales y las firmas que no coinciden con el autor de WordPress (ver 4.3).

### 5.5 Normalización de títulos (hecha el 6/10/2026)

Funciona con un léxico de nombres propios, siglas y palabras comunes construido desde el cuerpo de los 2.637 artículos (agrupando con y sin tilde), y una función única (`normalizarTitulo`) que usan el script de propuesta y el conversor. El léxico completo (117 mil filas) se genera en `out/`; en `conversor/data/lexico-titulos.csv` se versiona una versión recortada (6.212 filas, 401 KB) que da exactamente la misma salida sobre estos títulos. Si cambia el corpus hay que regenerarla.

Reglas principales:

- Divide en el primer `|`, también cuando no tiene espacios. Lo anterior es el título y lo posterior, la bajada.
- Pasa los títulos en mayúsculas a formato oración: nombre propio capitalizado, sigla y numeral romano en mayúsculas, palabra común en minúscula, partículas (e, y, de, van, von) en minúscula entre nombres, tildes restauradas cuando el corpus las trae en el 95% o más de los casos.
- Palabra que no está en el corpus: minúscula con aviso `palabra_desconocida`, salvo que esté pegada a un nombre propio. Palabra del corpus sin clasificar: se capitaliza (con aviso `palabra_ambigua`) si aparece más veces capitalizada que en minúscula o en empate.
- Los títulos "AUTOR | TÍTULO" (acciones `posible_autor` y `autor_en_titulo`, 51 en total) **no se dividen**: quedan enteros y con el aviso `revisar_autor_en_titulo`. Los dos títulos vacíos (5562 y 5602) quedan vacíos con el aviso `titulo_vacio`. Un título que empieza con barra (18633) pierde la barra y conserva el aviso.
- Las 193 bajadas que nombran a una persona se dejan como bajada (nombran al autor de la obra reseñada); se corrigen a mano si hace falta.

Resultado sobre los 2.637 artículos: 1.097 sin barra, 1.489 divididos, 37 `posible_autor` y 14 `autor_en_titulo`. Avisos de revisión humana: 361 `palabra_ambigua`, 66 `palabra_desconocida`, 51 `revisar_autor_en_titulo` y 2 `titulo_vacio`. Los cambios están en la rama `integracion-conversor`.

## 6. Paso 3: esqueleto del proyecto

Es la fase 1 del plan (ver `plan-implementacion.md`, sección 4): repositorio con API (Express 5), sitio público (Astro), panel (React + Vite) y código compartido; un solo servidor Node; Prisma conectado a MySQL 8.4; una página de prueba que lea de la base; despliegue en el entorno de pruebas.

El renderizador, el validador y el editor de la prueba, y el conversor del paso 2, pasan al código compartido.

## 7. Paso 4: modelo de datos y migración de la muestra

Es la fase 2 del plan (ver `plan-implementacion.md`, sección 5): `schema.prisma` completo y el script de migración, que lee la base de WordPress, usa el conversor del paso 2, procesa las imágenes, crea los autores e importa las bios existentes, arma la planilla de bios y escribe en la base nueva, primero solo sobre la muestra de 30 artículos.

## 8. Qué hace falta para arrancar

- Una copia de la base de WordPress (dump `.sql`) y una MariaDB o MySQL donde cargarla, para extraer los artículos y para el script de migración. En el equipo de desarrollo hay una MariaDB 11.8 portable (sin servicio de Windows, escuchando solo en 127.0.0.1:3307, base `evaristo_lectura`) cargada con el dump. Hay que usar MariaDB y no MySQL 8.0, porque el dump viene de MariaDB 11.8 y MySQL 8.0 puede no reconocer sus intercalaciones.
- Node LTS y Claude Code en el equipo, para el editor y el conversor.
- La carpeta `wp-content/uploads` del hosting, para el procesamiento de imágenes del paso 4 y para resolver el artículo 5360. Todavía no está descargada.
