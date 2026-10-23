# Fase 6: buscador y novedades

Actualizado el 23/10/2026. Primera versión hecha con valores por defecto, para que la editorial la vea y se ajuste con su opinión (la navegación definitiva se cierra con ella). Rama `fase6-buscador`.

## Buscador

- **Dónde:** `/buscar/?q=…` (`pages/buscar.astro`, `lib/busqueda.ts`), con un botón de lupa en el encabezado (escritorio y celular, y «Buscar» en el panel del celular). Los resultados llevan `noindex`.
- **Cómo busca:** texto completo de MySQL (FULLTEXT, modo booleano; dos índices nuevos en `articulos`: `articulos_busqueda` sobre título, bajada y texto plano, y `articulos_busqueda_titulo` solo sobre el título) y, además, por el **nombre de los autores**. Todas las palabras tienen que estar; vale el comienzo de una palabra (`garcia mar` encuentra «García Márquez»); entre comillas, una **frase exacta**; sin distinguir tildes ni mayúsculas (lo hace la intercalación `utf8mb4_es_0900_ai_ci`). Las palabras de menos de 3 letras no se buscan (el índice las ignora): si no queda ninguna, se avisa. Hasta 8 palabras y 120 caracteres. Lo que se escribe nunca llega al SQL como operador: solo quedan palabras (parametrizado).
- **Orden:** por relevancia (el título pesa 5 veces más que el resto) y, a igual relevancia, la más nueva. Solo notas publicadas (no borradores ni programadas).
- **Resultados:** tarjetas con sección, autor y fecha, 12 por página, y un **extracto** del texto con lo buscado resaltado (`<mark>`; se calcula en el sitio, sin tildes, y se escapa todo). La paginación conserva la búsqueda.
- **Texto plano:** `textoPlanoDe` ahora quita el guion blando (U+00AD) y otros caracteres invisibles (ancho cero, marcas de dirección), que partían las palabras en el índice. Los artículos ya guardados conservan el texto plano de antes: se regenera con el de los 19 de la decisión 53 antes de migrar (fase 7).
- **Base real:** todavía no tiene los índices (la migración `busqueda_fulltext` se aplica en la fase 7). Hasta entonces `/buscar/` responde «El buscador no está disponible por el momento» con estado 503, sin romper el sitio.
- **Test:** `test:busqueda` (contra `evaristo_cms_dev`, con el sitio compilado).

## Novedades

- **Qué es:** una nota con el campo `novedadHasta` (fecha) vigente: el panel lo pone en «Novedad hasta» y vale **hasta el final de ese día** (decisión 15: no es una sección ni una categoría; los migrados no tienen fecha).
- **Dónde se ve:**
  - **Etiqueta «Novedad»** (oscura, junto a la de la sección) en las tarjetas de todos los listados y relacionados, en los resultados del buscador y sobre el título de la nota.
  - **Página `/novedades/`**: las vigentes y publicadas, de la más nueva a la más vieja, de a 12; vacía, lo explica.
  - **Menú:** «Novedades» arriba del desplegable «Más» y en el panel del celular; y en el pie.
  - **Portada:** un bloque «Novedades» (las 2 más nuevas que no estén ya en el hero ni en la banda) que va primero entre los bloques de sección; si hay novedades, se muestran 5 secciones en vez de 6 para que los bloques queden de a pares. Una novedad recién publicada está en el hero o en la banda (lleva la etiqueta), y el bloque muestra las que no.
- **Test:** `test:novedades`.

## A confirmar con la editorial

1. ¿«Novedades» en el menú principal (hoy, dentro de «Más») o más visible? ¿Les gusta que el bloque de la portada vaya primero?
2. ¿La etiqueta «Novedad» en todas las tarjetas, o solo en algunas pantallas?
3. En WordPress «Novedades» era una sección de reseñas de libros recién salidos: las 95 notas que solo tenían esa categoría están en `sin-asignar` (fase 7). ¿Se marcan como novedad al migrar (con qué fecha) o no? Hoy el modelo las deja sin fecha.
4. ¿Les sirve el buscador como está (autor, título, texto)? ¿Quieren filtros por sección o por año?

## Para la fase 7

- Aplicar la migración `busqueda_fulltext` a la base real, regenerar el texto plano de los artículos que lo necesiten y revisar el rendimiento de la búsqueda con los 2.637 artículos (el texto de algunos pasa de 100 KB).
- Redirección de la dirección vieja `/category/novedades/` (WordPress) hacia `/novedades/`.
