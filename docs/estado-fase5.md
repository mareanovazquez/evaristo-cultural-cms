# Fase 5: portada (primera versión para mostrar a la dueña de la editorial)

Actualizado el 23/10/2026. La dueña de la editorial dio el visto bueno para **diseñar y mostrarle algo armado** y ajustar con su opinión (no piensa en abstracto: quiere ver la portada). Esta es la primera versión, hecha con los datos reales de la base de desarrollo. La especificación original (`especificaciones/especificacion-home.md`) es de antes de que las secciones pasaran de 5 a 17; lo que sigue dice qué se hizo y qué quedó para preguntarle.

## Qué hay (rama `fase5-portada`)

La portada (`/`) se arma sola con lo publicado: el editor no maqueta. De arriba hacia abajo:

1. **Topbar** y **menú** (ya existían, con el texto provisorio de la tienda).
2. **Fecha** del día en español, con la zona de Argentina («Viernes, 23 de octubre de 2026»). El nombre de la revista del menú es el `h1` de la portada (no hay un título repetido ni oculto); en las demás páginas es solo un enlace.
3. **Carrusel** (`components/Carrusel.astro`): las 3 notas más nuevas, con la imagen de encabezado (16:9 en escritorio y 4:3 en celular, recorte por punto focal), la sección, el título sobre un degradé oscuro y la fecha y el autor. Toda la diapositiva es un enlace. Flechas, puntos y botón de pausa. Avanza solo cada 6 segundos y se detiene con el mouse encima, con el foco adentro, con la pestaña oculta y con la pausa; con «reducir movimiento» del sistema **no arranca** (y no muestra la pausa). Se mueve con las flechas del teclado y se desliza con el dedo; sin JavaScript queda una tira deslizable. Es JavaScript propio y chico (no hizo falta sumar React al sitio); la política de seguridad lo permite con su hash.
4. **Dos bloques de sección** (`components/BloqueSeccion.astro`): cada uno con el nombre de la sección (enlace a su página), «Ver todo» y sus 2 notas más nuevas.
5. **Banda de cuatro columnas**: «Últimas publicaciones» con «Ver todo» más las notas 4.ª a 6.ª más nuevas. El «Ver todo» lleva a la página nueva `/ultimas/` (todas las notas, de la más nueva a la más vieja, de a 12).
6. **Más bloques de sección** (hasta 4 más, de a dos columnas).
7. **Footer** (el de siempre, con textos provisorios).

**Reglas.** Las secciones que se muestran son **las 6 con la publicación más reciente** (sin «Sin asignar»); cada bloque muestra sus 2 notas más nuevas **que no estén ya en el carrusel ni en la banda**, así no se repite nada; una sección sin notas para mostrar no aparece; un artículo programado aparece recién en su fecha y un borrador nunca. En celular todo va en una columna, en el mismo orden.

## Qué se decidió por defecto (para que ella lo corrija)

- **Qué secciones van en la portada.** La especificación pensaba en 5 secciones fijas; con 17 no caben. Se eligió un criterio automático (las 6 más activas) para tener algo que mostrar. Puede ser fijo (que la editorial elija cuáles y en qué orden) o seguir siendo automático.
- **Cuántas notas por bloque y cuántos bloques:** 2 notas por sección y 6 secciones (`SECCIONES_EN_PORTADA` y `NOTAS_POR_BLOQUE` en `apps/sitio/src/lib/portada.ts`).
- **La fecha** va sola (sin hora ni reloj), como proponía la especificación.
- **El «destacado en portada»** (elegir a mano qué nota va en el carrusel) **no está**: el carrusel toma siempre las 3 más nuevas. La especificación proponía dejarlo para una segunda etapa.
- **Diseño visual:** usa los tokens y componentes que ya tiene el sitio (Fraunces e Inter, verde agua, tarjetas con esquinas de 4 px). No hay maqueta aprobada de la portada: **esto es la propuesta**.

## Para preguntarle a la dueña (mostrándole la portada)

1. ¿Le gusta la estructura (carrusel, dos secciones, banda, más secciones)? ¿Qué sacaría o agregaría?
2. **Secciones:** ¿cuáles quiere arriba y en qué orden, o prefiere que la portada elija las más activas?
3. **Carrusel:** ¿alcanza con «las 3 últimas» o quieren elegir a mano la nota destacada?
4. **Textos reales:** topbar (texto y a qué página de la tienda lleva), footer (texto institucional, contacto, redes, datos legales), «Quiénes somos».
5. **Novedades:** ¿cómo quieren que se vea una nota marcada como novedad (`novedadHasta`)? (Fase 6.)
6. Lo del «lavado» que dijo del diseño: ¿falta color, otra tipografía, más marca? (Pendiente de la fase 3.)

## Cómo se ve (para mostrarla)

`npm run build` y `npm run dev:desarrollo -w @evaristo/api`, y abrir `http://127.0.0.1:3000/`. La base de desarrollo tiene solo 35 artículos de muestra: con más contenido (el real) los bloques se llenan más. **No se vio en un navegador todavía** (Claude Code no puede abrirlo): hay que mirar el carrusel, el degradé sobre fotos claras y oscuras, y el celular.

## Tests

- `test:portada` (nuevo, contra `evaristo_cms_dev`): el carrusel tiene las 3 notas más nuevas en orden y con su accesibilidad (`aria-roledescription`, «1 de 3», texto alternativo de la imagen, la primera con prioridad), la banda las 3 siguientes, los bloques salen de las secciones más activas y no repiten notas, una nota recién publicada es la primera, y lo programado y los borradores no aparecen; `/ultimas/` pagina y da 404 fuera de rango.
- `test:humo` se actualizó a la portada nueva; `test:seguridad` ya comprueba que cada script en línea tenga su hash.

## Pendiente de esta fase

- Mirarla en el navegador y ajustar con el feedback de la dueña.
- Textos reales del topbar y el footer; «Quiénes somos» y «Contacto» (hoy son enlaces vacíos).
- El destacado en portada, si lo piden.
- Variantes de tamaño de las imágenes (hoy el carrusel usa el original; ver `pendientes.md`, sección 2).
