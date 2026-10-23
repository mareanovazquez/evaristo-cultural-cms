# Revista cultural Evaristo: especificación de la portada (Home)

**Nota del 23/10/2026:** hay una primera versión de la portada armada con datos reales (ver `docs/estado-fase5.md`, que dice qué se decidió por defecto con 17 secciones en lugar de 5 y qué preguntarle a la dueña de la editorial). Estado: borrador para llevar a reunión con la editorial. Cerrado el artículo (ver `especificacion-articulo.md`). Pendientes: navegación definitiva y buscador (las páginas de sección, categoría y autor ya están hechas en el sitio, ver `estado-fase3.md`). Hoy `/` muestra provisoriamente los 12 últimos artículos; la portada real espera la reunión con la editorial.

## 1. Principios

- **Contenido automático.** La portada se arma sola con lo publicado. El editor no maqueta: publica y la portada se actualiza.
- **Misma línea que el artículo.** Formato revista, sin estilos libres.
- **Un solo control editorial opcional:** el "destacado en portada" (ver sección 3, punto 3).
- **Mobile primero.** Todo tiene que leerse bien en el celular.

## 2. Estructura (de arriba hacia abajo)

Grilla de 12 columnas, ancho máximo centrado, con separación de 8 px entre bloques.

1. **Topbar** (12 col): mensaje "Conseguí todos los libros de Evaristo Editorial en nuestra tienda online". Toda la barra es un link a la tienda. Texto editable desde el panel (solo administrador).
2. **Encabezado** (12 col): nombre de la revista, EVARISTO CULTURAL, con fecha (y hora, ver puntos a confirmar).
3. **Carousel** (12 col): 3 slides. Cada una lleva la imagen de encabezado del artículo, el título y un link a la nota.
4. **Dos columnas** (6 + 6): dos secciones, cada una con sus 2 últimos artículos.
5. **Banda de 4 columnas** (3 + 3 + 3 + 3), ancho completo: los últimos 3 artículos publicados.
6. **Dos columnas** (6 + 6): las demás secciones, con sus últimos artículos.
7. **Footer institucional.**

## 3. Reglas de contenido

1. **Carousel:** las 3 últimas notas publicadas, sin repetir en la banda (ver 2).
2. **Banda de 4 columnas:** del 4.º al 6.º artículo más nuevo, para que no se repitan con el carousel. La cuarta celda es un bloque de presentación: "Últimas publicaciones" y un link "Ver todo".
3. **Destacado en portada (opcional):** casilla en el panel para que el editor fije una nota en el carousel. Si no se usa, el carousel toma las últimas 3. Propuesta: dejarlo para una segunda etapa.
4. **Bloques de sección:** cada uno muestra el nombre de la sección (con link a su página) y sus 2 últimos artículos con imagen, título, autor y fecha.
5. **Una sección sin artículos** no se muestra.
6. **Programados:** un artículo programado aparece en la portada recién en su fecha.

## 4. Carousel

- Imagen de encabezado (16:9, recorte con punto focal, ya definido en el artículo).
- Título sobre la imagen, con un degradé oscuro para que se lea con cualquier foto.
- Flechas y puntos de navegación.
- Avanza solo cada 6 segundos; se pausa al pasar el mouse o tocarlo.
- Se puede mover con teclado y deslizar en el celular.
- Cada imagen lleva su texto alternativo (ya cargado en el artículo).
- Respeta la preferencia "reducir movimiento" del dispositivo: en ese caso no avanza solo.

## 5. Encabezado y fecha

Propuesta: mostrar solo la fecha completa en español ("sábado 26 de septiembre de 2026"), calculada con zona horaria de Argentina. Un reloj en vivo suma complejidad y aporta poco en una revista.

## 6. Footer institucional (a definir)

Propuesta de contenido:

- Sobre la revista (texto corto).
- Contacto.
- Redes sociales.
- Link a la tienda de Evaristo Editorial.
- Derechos y créditos.

## 7. Celular

- Una sola columna, en el mismo orden.
- El carousel se mantiene.
- La banda de 4 columnas se apila.
- El topbar puede pasar a dos líneas.

## 8. Rendimiento y SEO

- Las imágenes se sirven en el tamaño justo para cada pantalla.
- La primera slide del carousel carga con prioridad, las demás de forma diferida.
- El H1 de la portada es el nombre de la revista; los títulos de las notas son H2 o H3.

## 9. Puntos a confirmar

**Con la dueña de la editorial (a llevar a la reunión)**

1. **Secciones de la portada.** Hay 5 secciones (reseña, ensayo, crítica, entrevista, crónica). ¿Cuáles van arriba (2) y cuáles abajo? Criterio propuesto: arriba, las que más se publican.
2. **Qué pasa con la quinta sección.** Con 2 arriba y 3 abajo, una queda sola. Opciones:
   - a) la tercera ocupa el ancho completo;
   - b) sumamos una sexta sección;
   - c) 2 arriba y 2 abajo, y la quinta solo se ve desde el menú.
3. **Texto del topbar** y destino exacto del link (home de la tienda o una colección).
4. **Contenido del footer:** texto institucional, contacto, redes, datos legales.
5. **Destacado en portada:** ¿quieren elegir a mano qué nota va en el carousel o alcanza con "las últimas 3"?

**Técnicos (los resuelvo yo)**

6. Fecha sola o fecha y hora.
7. Velocidad del carousel.
8. Cuántos artículos por bloque de sección en mobile.

## 10. Fuera de alcance por ahora

- Publicidad o banners.
- Newsletter (se puede sumar al footer más adelante).
- Bloques configurables desde el panel.
