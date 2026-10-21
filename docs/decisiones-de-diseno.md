# Decisiones de diseño – CMS Evaristo

Oct 19, 2026 · @Mariano Vazquez

## Contexto

Este documento reúne las decisiones de diseño visual del sitio público de Evaristo Cultural, la revista cultural de la editorial Evaristo, que pasa de WordPress a un CMS propio.

El CMS evita las roturas de plugins, temas y PHP de WordPress. Hay 2.637 artículos publicados entre 2006 y 2026 para migrar. El sitio público se hace con Astro y el panel de administración con React, y los artículos nuevos los carga una persona no técnica.

La identidad visual del sitio se define acá. Los colores, la tipografía, el espaciado y los componentes sirven de base para escribir las hojas de variables del frontend. El criterio general es de revista y no de blog: todos los artículos se ven iguales y se leen en una sola columna.

## Decisiones tomadas

La paleta tiene tres colores: un acento verde agua, un blanco cálido y un negro cálido.

| Fecha | Tema | Decisión |
| --- | --- | --- |
| 19/10/2026 | Color de acento | #67beb0 |
| 19/10/2026 | Color blanco | #fefefc |
| 19/10/2026 | Color negro (textos) | #231f20 |
| 19/10/2026 | Tipografía de títulos | Fraunces (serif) |
| 19/10/2026 | Tipografía del cuerpo | Inter (sans serif) |
| 19/10/2026 | Tipografía de botones y menús | Inter (sin Roboto), variando peso y tamaño |
| 19/10/2026 | Imágenes | border-radius: 0px (esquinas rectas) |
| 19/10/2026 | Botones y tarjetas | border-radius: 4px |
| 19/10/2026 | Modo oscuro | Segunda etapa. Los tokens se nombran por función (bg, surface, text, border, accent) para poder remapearlos después sin tocar los componentes |
| 19/10/2026 | Íconos | Lucide (lucide.dev) para todo el sistema, con trazo de 1,5px |
| 20/10/2026 | Letra capital | Opcional por artículo, en el primer párrafo del cuerpo y activable desde el panel; viene desactivada por defecto en los artículos nuevos y el editor la activa con la casilla (ver Letra capital) |
| 20/10/2026 | Notas al pie | Numeradas en el texto y reunidas al final de la nota, con vínculo de ida y vuelta (ver Notas al pie) |
| 20/10/2026 | Imágenes dentro del cuerpo | Se muestran con su proporción original, sin recorte, y con una altura máxima del 80% de la altura de la pantalla. La imagen de portada y las tarjetas siguen con proporción fija (ver Imágenes dentro del cuerpo) |
| 21/10/2026 | Cita destacada | Caja con fondo accent-50, barra de 4px y comilla decorativa en #67beb0 (variante A; ver Tokens tipográficos) |
| 21/10/2026 | Sección del artículo | Etiqueta rectangular suave: fondo accent-100, texto accent-900 y esquinas de 4px (ver Etiqueta de sección) |
| 21/10/2026 | Menú del header | Seis secciones visibles (Entrevista, Reseña, Ensayo, Crónica, Crítica, Rastros), desplegable "Más" con el resto y "Autores"; en celular, un botón abre un panel con todas. Propuesta en `referencias/maquetas/header-footer-autor.html`, con textos provisorios hasta que la editorial defina contenido, logo y menú |
| 21/10/2026 | Imagen de encabezado del artículo | Proporción fija 3:2, con recorte según el punto focal; en celular, de borde a borde |
| 21/10/2026 | Fuentes | Fraunces e Inter desde Google Fonts, como en las maquetas |
| 21/10/2026 | Marca (wordmark) | "EVARISTO" en Roboto Black (900) con el negro #231f20, seguido de "CULTURAL" o "EDITORIAL" en Roboto SemiBold (600) con border-strong #a6a5a4, todo en mayúsculas y con interletrado apretado (`letter-spacing: -0.02em`, valor propuesto para ajustar). Es la única excepción a "sin Roboto": vale solo para la marca, no para botones ni menús. Ojo: #a6a5a4 sobre el fondo da 2,4:1, aceptable para un logotipo pero no para texto corriente |
| 20/10/2026 | Manual de estilo para contenido nuevo | Se va a armar para homogeneizar los artículos que vengan (ver Preguntas abiertas) |

## Tokens tipográficos

Una fila por rol; la familia ya está definida para títulos, cuerpo y botones, y el cuerpo (18px, interlineado 1,6) está confirmado; el resto son valores propuestos para revisar.

| Rol | Familia | Tamaño | Peso (font-weight) | Estilo (font-style) | Interlineado (line-height) | Alineación (text-align) |
| --- | --- | --- | --- | --- | --- | --- |
| Título de nota (h1) | Fraunces | 44px | 600 | normal | 1,15 | izquierda |
| Subtítulo (h2) | Fraunces | 30px | 600 | normal | 1,25 | izquierda |
| Subtítulo (h3) | Fraunces | 22px | 600 | normal | 1,3 | izquierda |
| Bajada | Fraunces | 22px | 400 | normal | 1,4 | izquierda |
| Cuerpo | Inter | 18px | 400 | normal | 1,6 | izquierda |
| Cuerpo chico | Inter | 15px | 400 | normal | 1,5 | izquierda |
| Epígrafe | Inter | 14px | 400 | italic | 1,4 | izquierda |
| Cita destacada | Fraunces | 26px | 400 | italic | 1,35 | izquierda |
| Letra capital | Fraunces | 3 líneas de alto | 600 | normal | n/a | izquierda |
| Botón | Inter | 15px | 600 | normal | 1,2 | centro |
| Etiqueta | Inter | 12px | 600 | normal | 1,2 | izquierda |
| Link | Inter | heredado | 500 | normal | heredado | heredada |

La cita destacada (`blockquote.cita`, atribución en `cite`) es una caja con acento, decidida el 21/10/2026 (variante A, a pedido de la directora, que vio el diseño "lavado"): fondo accent-50 #ecf6f3, barra izquierda de 4px en #67beb0, `border-radius: 4px` y relleno de 24px (16px en celular). Lleva una comilla de apertura decorativa en Fraunces 72px, #67beb0, generada por CSS (`::before`, fuera del árbol de accesibilidad). Su atribución va en Inter 14px, #656262 (unos 5,6:1 sobre el fondo), precedida por un guion largo. Los valores son propuestos para revisar.

### Etiqueta de sección (chip)

Decidida el 21/10/2026: la sección se muestra como etiqueta suave encima del título y en las tarjetas. Fondo accent-100 #d8eee9 con texto accent-900 #374f4b (unos 7:1), Inter 12px, peso 600, mayúsculas con `letter-spacing: 0.06em`, `border-radius: 4px` (el redondeo mínimo del proyecto, así que es una etiqueta rectangular y no una píldora) y relleno de 4px por 12px. En las tarjetas lleva `width: fit-content` para no estirarse a todo el ancho de la columna. Si la etiqueta es un link, el hover usa accent-200 #b2ded6. Los valores son propuestos para revisar.

## Variaciones de color

Las tres bases (#67beb0, #fefefc, #231f20) se derivan en una escala del acento y una de neutros cálidos, y de ahí salen los roles de la interfaz. Los contrastes están calculados contra el blanco #fefefc, salvo que se indique otro fondo.

### Escala del acento

| Token | Valor | Uso | Contraste |
| --- | --- | --- | --- |
| accent-50 | #ecf6f3 | Fondo de cajas con acento, hover de tarjetas | n/a (fondo) |
| accent-100 | #d8eee9 | Texto seleccionado, etiquetas suaves | n/a (fondo) |
| accent-200 | #b2ded6 | Bordes con acento suave, separadores | n/a (decorativo) |
| accent-300 | #8dcec3 | Hover alternativo, íconos decorativos | n/a (decorativo) |
| accent-500 (base) | #67beb0 | Fondo de botón primario, etiquetas, resaltados | 2,2:1 sobre blanco; texto negro encima 7,4:1 |
| accent-600 | #5da69a | Hover del botón primario | texto negro encima 5,7:1 |
| accent-700 | #538e85 | Anillo de foco, bordes activos | 3,7:1 sobre blanco |
| accent-800 | #456e68 | Texto de links | 5,7:1 sobre blanco |
| accent-900 | #374f4b | Hover de links, texto sobre fondos claros del acento | 8,7:1 sobre blanco |

### Neutros

| Token | Valor | Uso | Contraste |
| --- | --- | --- | --- |
| bg | #fefefc | Fondo de página | base |
| surface | #f5f5f3 | Cajas y bloques alternos | n/a (fondo) |
| surface-2 | #ececea | Cajas destacadas, hover neutro | n/a (fondo) |
| border-soft | #e4e3e2 | Divisores finos | 1,3:1 (decorativo) |
| border | #d2d1d0 | Borde de tarjetas e inputs en reposo | 1,5:1 (decorativo) |
| border-strong | #a6a5a4 | Bordes decorativos más marcados | 2,4:1 |
| text | #231f20 | Texto principal | 16,2:1 |
| text-soft | #444041 | Texto secundario | 10,1:1 |
| text-muted | #656262 | Epígrafes, metadatos | 6,0:1 |
| border-input | #8f8d8d | Borde de inputs en reposo | 3,3:1 |

### Estados de los componentes

| Componente | Reposo | Hover | Foco |
| --- | --- | --- | --- |
| Botón primario | Fondo #67beb0, texto #231f20 | Fondo #5da69a, texto #231f20 | Anillo 2px #538e85, separado 2px |
| Botón secundario | Sin fondo, borde #231f20, texto #231f20 | Fondo #ecf6f3, borde #231f20 | Anillo 2px #538e85, separado 2px |
| Tarjeta | Fondo #fefefc, shadow-sm | shadow-md | Anillo 2px #538e85, separado 2px |
| Caja de contenido | Fondo #f5f5f3, sin borde | Sin cambio | n/a |
| Link | Texto #456e68, subrayado | Texto #374f4b | Anillo 2px #538e85, separado 2px |
| Input | Fondo #fefefc, borde #8f8d8d | Borde #231f20 | Borde #538e85 de 2px |

El acento puro #67beb0 no se usa para texto sobre blanco. Para texto con color se usa accent-800.

## Botones

Hay cuatro variantes en tres tamaños, todas con `border-radius: 4px`, Inter en peso 600, sin mayúsculas y con transición de 150 ms entre estados. Si lleva ícono, va a 8px del texto. Los valores de tamaño son propuestos para revisar.

### Variantes

| Variante | Reposo | Hover | Uso |
| --- | --- | --- | --- |
| Primario | Fondo #67beb0, texto #231f20 | Fondo #5da69a | Acción principal de la pantalla |
| Suave | Fondo #f5f5f3, texto #231f20, línea inferior de 2px #d2d1d0 | Fondo #ececea | Acción alternativa de peso medio |
| Contorno | Sin fondo, borde de 2px #231f20, texto #231f20 | Fondo #ecf6f3 | Acción secundaria |
| Fantasma | Sin fondo ni borde, texto #231f20 | Fondo #f5f5f3 | Acciones menores, como "Leer más" |

En todas, el foco es un anillo de 2px #538e85 separado 2px. Deshabilitado: texto #656262, sin hover, con fondo #ececea (primario y suave) o borde #d2d1d0 (contorno).

### Tamaños

| Tamaño | Alto | Relleno horizontal | Texto | Uso |
| --- | --- | --- | --- | --- |
| Small | 36px | 16px | 14px | Panel de administración, tablas, acciones dentro de tarjetas |
| Medium | 44px | 20px | 15px | Tamaño por defecto; alto mínimo cómodo para tocar en celular |
| Large | 52px | 24px | 16px | Acción principal de una página, formularios y suscripción |

## Formularios

Los campos usan etiqueta flotante: la etiqueta empieza dentro del campo y sube al borde superior, en 12px, cuando el campo recibe foco o tiene contenido. Los valores de tamaño son propuestos para revisar.

### Estados del campo de texto

| Estado | Borde | Fondo | Etiqueta |
| --- | --- | --- | --- |
| Reposo | 1px #8f8d8d | #fefefc | Dentro del campo, 16px, #656262 |
| Hover | 1px #231f20 | #fefefc | Igual que en reposo |
| Foco | 2px #538e85 | #fefefc | Arriba, 12px, #456e68 |
| Con contenido | 1px #8f8d8d | #fefefc | Arriba, 12px, #656262 |
| Error | 2px #a8261d | #fefefc | Arriba, 12px, #a8261d |
| Deshabilitado | 1px #d2d1d0 | #f5f5f3 | #656262, sin hover |

### Medidas

| Propiedad | Valor |
| --- | --- |
| Alto del campo | 56px |
| Relleno horizontal | 16px |
| Texto del campo | Inter 16px, peso 400, #231f20 (16px evita el zoom automático en iPhone) |
| Redondeo | 4px |
| Animación de la etiqueta | 150 ms |
| Texto de ayuda | 14px, #656262, a 4px debajo del campo |
| Mensaje de error | 14px, #a8261d, con ícono, debajo del campo |
| Separación entre campos | 20px |

El rojo de error (#a8261d, 7,0:1 sobre blanco) es el color de peligro del sistema (ver Avisos); el mensaje lleva ícono para que no dependa solo del color.

### Otros campos

- **Área de texto:** misma lógica, con 120px de alto mínimo.
- **Selector:** la etiqueta queda siempre arriba, porque el campo siempre muestra un valor, y lleva una flecha a la derecha.
- **Casillas y opciones:** cuadro de 24px con el texto a la derecha; marcadas, llevan fondo #67beb0 con el tilde en negro.

### Reglas del formulario

- Una sola columna.
- Los campos opcionales se marcan con "(opcional)" en la etiqueta, sin asterisco en los obligatorios.
- El botón va al final, alineado a la izquierda, en tamaño medium o large.
- Los errores se muestran al salir del campo, no mientras se escribe.

## Sombras

Hay tres niveles de elevación. El medio (`shadow-md`) es el definido; el suave y el profundo son propuestos y siguen su misma estructura: una sombra difusa más un anillo de 1px que hace de borde.

| Token | Uso |
| --- | --- |
| shadow-sm | Elementos apenas elevados: tarjetas y cajas en reposo |
| shadow-md | Tarjetas en hover, menús desplegables, popovers |
| shadow-lg | Modales, paneles laterales, avisos flotantes |

```css
--shadow-sm: rgba(0, 0, 0, 0.04) 0px 2px 8px 0px, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px;
--shadow-md: rgba(0, 0, 0, 0.05) 0px 6px 24px 0px, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px;
--shadow-lg: rgba(0, 0, 0, 0.10) 0px 16px 48px 0px, rgba(0, 0, 0, 0.08) 0px 0px 0px 1px;
```

Como el anillo de 1px ya funciona de borde, un elemento con sombra no lleva `border` aparte.

## Tarjetas

La tarjeta de nota es la principal, para listados y portada. Todas las tarjetas tienen `border-radius: 4px` y sin borde aparte, porque el anillo de la sombra ya lo cumple. Los valores de tamaño son propuestos para revisar.

### Tarjeta de nota

| Elemento | Estilo |
| --- | --- |
| Imagen | A ras de los bordes superiores; las esquinas las recorta el redondeo de la tarjeta (la imagen suelta sigue en 0px) |
| Categoría | Inter 12px, peso 600 |
| Título | Fraunces 22px (el h3 de la tabla tipográfica) |
| Bajada | Inter 15px, #444041 |
| Metadatos (autor, fecha) | Inter 14px, #656262 |

| Medida | Valor |
| --- | --- |
| Relleno interno | 24px |
| Entre imagen y texto | 16px |
| Entre elementos de texto | 8px |
| Entre tarjetas en la grilla | 24px |

### Estados

| Estado | Fondo | Sombra |
| --- | --- | --- |
| Reposo | #fefefc | shadow-sm |
| Hover | #fefefc | shadow-md |
| Foco | #fefefc | Anillo de 2px #538e85, separado 2px |

Toda la tarjeta es clicable.

### Cajas de contenido

Son distintas de las tarjetas y sirven para destacados, avisos o notas al margen. Van sin sombra, con fondo #f5f5f3 o, si llevan acento, #ecf6f3, con redondeo de 4px y relleno de 24px.

## Avisos

Hay tres formatos de aviso (modal de confirmación, aviso en la página y toast) y cuatro tipos (éxito, información, alerta y peligro). Todos llevan una barra vertical de 4px a la izquierda, la misma de la cita destacada, un ícono de Lucide de 20px y `border-radius: 4px`. Los valores son propuestos para revisar.

### Tipos

| Tipo | Barra | Ícono y título | Fondo | Ícono de Lucide |
| --- | --- | --- | --- | --- |
| Éxito | #67beb0 | #456e68 | #ecf6f3 | circle-check |
| Información | #231f20 | #231f20 | #f5f5f3 | info |
| Alerta | #c9821a | #8a5300 | #fdf4e3 | triangle-alert |
| Peligro | #a8261d | #a8261d | #fceeed | circle-alert |

El texto de todos los avisos va en #444041 (al menos 9:1 sobre cada fondo). Los íconos y títulos tienen al menos 5,2:1 sobre su fondo.

### Modal de confirmación

| Elemento | Estilo |
| --- | --- |
| Panel | Fondo #fefefc, `shadow-lg`, ancho máximo de 480px (en celular, el ancho de la pantalla menos 32px) |
| Barra lateral | 4px, del color del tipo: peligro para eliminar, información o éxito para el resto |
| Fondo detrás | #231f20 al 50% de opacidad |
| Relleno | 32px (24px en celular) |
| Título | Fraunces 22px, peso 600 (el h3) |
| Texto | Inter 15px, interlineado 1,5, #444041; el énfasis va en peso 600 y #231f20 |
| Cerrar | Ícono x de Lucide de 20px, #656262 (hover #231f20), con área táctil de 44px arriba a la derecha |
| Botones | Debajo del texto, alineados a la izquierda, a 12px entre sí, tamaño medium y sin mayúsculas |
| Separaciones | 16px entre título y texto, 32px entre texto y botones |

En una acción destructiva, el botón principal lleva fondo #a8261d y texto #fefefc (hover #8f1f17) y el botón de cancelar es fantasma. En los demás modales, el botón principal es el primario de siempre. En las acciones destructivas el foco empieza en "Cancelar". Esc y el clic afuera cierran el modal, y el foco queda dentro mientras está abierto.

### Aviso en la página

Mensaje fijo dentro de una pantalla o formulario, que se queda hasta que se resuelve. Lleva el fondo y la barra del tipo, relleno de 16px y el ícono a 12px del texto. El título es opcional (Inter 15px, peso 600, #231f20) y el texto va en Inter 15px. No tiene sombra y el botón de cerrar es opcional.

### Toast

| Propiedad | Valor |
| --- | --- |
| Estilo | Fondo #fefefc, `shadow-md`, barra del tipo, relleno de 16px, texto Inter 15px #444041 |
| Contenido | Ícono, mensaje corto, acción opcional (botón fantasma small, como "Deshacer") y cerrar |
| Ancho | Máximo 360px |
| Posición | En escritorio, abajo a la derecha, a 24px del borde; en celular, abajo, con el ancho de la pantalla menos 32px |
| Apilado | Hasta 3, a 8px entre sí |
| Duración | Éxito e información, 5 segundos; alerta y peligro no se cierran solos |
| Interacción | La cuenta regresiva se pausa con hover o foco |
| Entrada | Sube 16px mientras aparece, en 200 ms |

## Espaciado y maquetación

Las notas de lectura van en una sola columna de 680px de ancho, centrada: con Inter 18px da unos 68 caracteres por línea, dentro del rango cómodo para leer. Todo el espaciado sale de una escala de 4px. Los valores son propuestos para revisar, y los tamaños de texto para celular quedan para una etapa aparte.

### Escala de espaciado

| Token | Valor | Uso |
| --- | --- | --- |
| space-1 | 4px | Texto de ayuda bajo un campo |
| space-2 | 8px | Entre textos de una tarjeta, ícono y texto de un botón |
| space-3 | 12px | Debajo de un h3 |
| space-4 | 16px | Entre imagen y texto de una tarjeta, márgenes laterales en celular |
| space-5 | 20px | Entre campos de un formulario |
| space-6 | 24px | Relleno de tarjetas, grilla, márgenes laterales desde 768px, entre párrafos |
| space-8 | 32px | Antes de un h3, alrededor de imágenes |
| space-10 | 40px | Antes de la nota, alrededor de citas destacadas |
| space-12 | 48px | Antes de un h2, entre secciones en celular |
| space-16 | 64px | Entre secciones de una página |
| space-24 | 96px | Separaciones grandes, como el pie de página |

### Anchos y grilla

| Elemento | Valor |
| --- | --- |
| Página (listados y portada) | Ancho máximo de 1200px, centrada |
| Nota: texto | 680px, una sola columna, centrada |
| Nota: imagen de portada y fotos grandes | Hasta 960px, centradas |
| Márgenes laterales | 16px en celular, 24px desde 768px |
| Grilla de tarjetas | 1 columna hasta 639px, 2 columnas de 640px a 1023px, 3 columnas desde 1024px; 24px entre tarjetas |

### Ritmo dentro de la nota

| Elemento | Espacio arriba | Espacio abajo |
| --- | --- | --- |
| Título (h1) | 0 | 16px |
| Bajada | 0 | 24px |
| Metadatos (autor, fecha) | 0 | 40px |
| Párrafo | 0 | 24px |
| Subtítulo (h2) | 48px | 16px |
| Subtítulo (h3) | 32px | 12px |
| Imagen | 32px | 8px (hasta el epígrafe) |
| Epígrafe | 0 | 32px |
| Lista | 0 | 24px (8px entre ítems) |
| Cita destacada | 40px | 40px |

## Imágenes dentro del cuerpo

Decidido el 20/10/2026: las imágenes que van dentro del texto de la nota se muestran con su proporción original, sin recorte, y con una altura máxima del 80% de la altura de la pantalla. La razón es que las 7.372 imágenes migradas tienen proporciones muy variadas (verticales, panorámicas, retratos, escaneos) y un recorte fijo cortaría caras, portadas de libros y texto de los escaneos.

| Propiedad | Valor |
| --- | --- |
| Proporción | La original de cada imagen; sin `object-fit: cover` ni `aspect-ratio` fijo |
| Ancho | Hasta el ancho de la columna de texto (680px); no se agranda una imagen más chica que la columna |
| Altura máxima | 80% de la altura de la pantalla (`80vh`), en una variable CSS propia para poder cambiarla en una línea; con el tope, la imagen se achica manteniendo la proporción y se centra. Decidido el 20/10/2026 |
| Imagen sin medidas | Se muestra igual, con ancho de columna y alto automático; la maqueta puede saltar al cargar (a revisar en el reconocimiento de la fase 3) |
| Epígrafe | Debajo de la imagen, Inter 14px en itálica (ver Tokens tipográficos) |
| Esquinas | `border-radius: 0` |

Lo que no cambia: la imagen de portada y las tarjetas conservan proporción fija (en las muestras, 3:2; la especificación del artículo propone 16:9 para la portada, a confirmar). Las páginas de muestra (`referencias/maquetas/nota-con-notas-al-pie.html` y `referencias/maquetas/index.html`) todavía recortan la imagen del cuerpo a 3:2 con `object-fit: cover`: se corrige cuando se rehaga la muestra.

## Letra capital

La letra capital es opcional por artículo: el editor la activa con una casilla en el panel de administración. En los artículos nuevos viene desactivada por defecto (decidido el 20/10/2026). Cuando está activa, el primer párrafo del cuerpo empieza con una capital de 3 líneas de alto. Los valores son propuestos para revisar.

### Estilo

| Propiedad | Valor |
| --- | --- |
| Altura | 3 líneas de texto (`initial-letter: 3`); en navegadores que no lo soportan, como Firefox, se usa un `float` con un tamaño equivalente |
| Tipografía | Fraunces, peso 600 |
| Color | #231f20 (alternativa: #456e68, el verde oscuro de los links) |
| Espacio a la derecha | 0,12em |
| Dónde se aplica | Solo la primera letra del primer párrafo del cuerpo; no en la bajada ni en los párrafos que siguen a un subtítulo |
| Celulares | Igual, a 3 líneas |

### Opción en el panel

| Aspecto | Definición |
| --- | --- |
| Control | Casilla "Letra capital" en la ficha del artículo |
| Valor por defecto | Desactivada en los artículos nuevos; el editor la activa con la casilla. Los artículos migrados quedan con la capital desactivada |
| Dónde se guarda | Campo booleano del artículo, aparte del cuerpo en JSON; cambiar la opción no toca el contenido guardado |
| Cómo se aplica | El renderizador agrega la clase `con-capital` al primer párrafo del cuerpo cuando la casilla está activa |
| Vista previa | La vista previa del panel muestra la capital apenas se activa la casilla |
| Salvaguarda | El renderizador no la aplica si el primer bloque del cuerpo no es un párrafo que empieza con una letra (por ejemplo, si empieza con comillas, una cita, un número o una imagen) |

## Notas al pie

Las notas al pie van numeradas en el texto y se reúnen en una sección "Notas" al final del cuerpo, antes de los artículos relacionados. Cada nota se vincula con su llamada y viceversa. La muestra completa está en `referencias/maquetas/nota-con-notas-al-pie.html`. Los valores son propuestos para revisar.

### Llamada en el texto

| Propiedad | Valor |
| --- | --- |
| Formato | Número en superíndice (0,7em), peso 600, color de link (#456e68), sin subrayado |
| Posición | Después de la palabra, antes del signo de puntuación |
| Resaltado | Al volver desde la nota, la llamada se resalta con fondo accent-100 (#d8eee9) |
| Zona táctil | Ampliada con un área invisible de 10px verticales y 6px horizontales |
| Accesibilidad | `role="doc-noteref"` y `aria-label="Nota N"` |

### Sección de notas

| Propiedad | Valor |
| --- | --- |
| Título | "Notas", Fraunces 22px, peso 600 (20px en celular) |
| Separación | Línea superior de 1px #e4e3e2, 40px de margen arriba y 32px de relleno |
| Lista | Ordenada, con el número en peso 600 y color #456e68 |
| Texto de cada nota | Inter 15px, interlineado 1,5, #444041; 12px entre notas |
| Nota de destino | Al llegar desde la llamada, fondo accent-50 (#ecf6f3) con redondeo de 4px |
| Accesibilidad | `role="doc-endnotes"` en la sección y `role="doc-backlink"` en el vínculo de vuelta |

### Vínculo de vuelta

Cada nota termina con el punto final y un ícono corner-up-left de Lucide que vuelve a la llamada, a 8px del texto. El punto y el ícono van juntos (`white-space: nowrap`) para que el ícono nunca quede solo en una línea. Su zona táctil se amplía 14px alrededor del ícono y su `aria-label` es "Volver al texto (nota N)".

### Comportamiento

- El desplazamiento entre llamada y nota es suave, salvo que la persona tenga activado "reducir movimiento".
- Al saltar, queda un margen de 24px arriba para que el destino no quede pegado al borde.
- Las llamadas pueden ir en el cuerpo y también en la atribución de una cita destacada.

## Diseño para celulares

Se considera celular todo ancho hasta 639px. Los títulos bajan de tamaño para no ocupar demasiadas líneas, el cuerpo se mantiene en 18px y los elementos táctiles tienen al menos 44px. Los valores son propuestos para revisar.

### Tipografía

| Rol | Escritorio | Celular | Interlineado en celular |
| --- | --- | --- | --- |
| Título de nota (h1) | 44px | 32px | 1,2 |
| Subtítulo (h2) | 30px | 26px | 1,3 |
| Subtítulo (h3) | 22px | 20px | 1,3 |
| Bajada | 22px | 19px | 1,4 |
| Cita destacada | 26px | 22px | 1,35 |

Cuerpo, cuerpo chico, epígrafe, botón, etiqueta y link mantienen el mismo tamaño que en escritorio.

### Diferencias de maquetación

| Elemento | Escritorio | Celular |
| --- | --- | --- |
| Márgenes laterales | 24px | 16px |
| Texto de la nota | 680px, centrado | Ancho completo menos los márgenes |
| Imagen de portada y fotos grandes | Hasta 960px | De borde a borde de la pantalla; el epígrafe conserva los márgenes |
| Grilla de tarjetas | 2 o 3 columnas, 24px entre tarjetas | 1 columna, 16px entre tarjetas |
| Relleno de tarjeta | 24px | 16px |
| Espacio antes de un h2 | 48px | 40px |
| Entre secciones de una página | 64px | 48px |
| Botones de formularios y acciones principales | Ancho automático | Ancho completo |
| Estados | Hover | Presionado, con el mismo estilo que el hover |
| Zona táctil | n/a | Mínimo 44px; el botón small amplía su área clicable a 44px sin cambiar su aspecto |

## Preguntas abiertas

- [ ] Encabezado, footer y ficha de autor: hay una propuesta en `referencias/maquetas/header-footer-autor.html` (topbar, menú con "Más", panel en celular, footer de cuatro columnas, bio al final del artículo, página y listado de autores). Falta el visto bueno de Mariano y de la directora, el contenido real (logo, textos, contacto, redes) y cuáles son las seis secciones visibles.
- [x] Bio del autor 39 (id 60) con correo: el correo se sacó el 21/10/2026 directamente en la base. La del autor 40 (wpUserId 278) no tiene correo, solo un usuario de Instagram.
- [ ] Manual de estilo para los artículos nuevos: se va a armar para homogeneizar el contenido que venga (por ejemplo, longitud y forma de la bajada, uso de subtítulos, citas, notas al pie, texto alternativo y epígrafes de las imágenes, créditos). Falta definir qué cubre, quién lo escribe y en qué formato se le muestra al equipo editorial.
- [ ] Visto bueno de la directora de la editorial: se le envió `referencias/maquetas/nota-con-notas-al-pie.html` y no respondió todavía. Mientras tanto el diseño sigue como propuesta.

## Notas y referencias

### Por definir

Sin pendientes de definición por ahora.

### Términos

- **Epígrafe:** el pie de una imagen o foto. En la tabla tipográfica es Inter 14px en itálica.
- **Cita destacada:** frase que se resalta dentro del texto de la nota. Es distinta del epígrafe y tiene su propia fila en la tabla tipográfica.

### Alternativas guardadas

- **Tipografía de títulos:** si Fraunces no convence al verla implementada, las alternativas son Newsreader y Crimson Pro. La decisión vigente sigue siendo Fraunces.
- **Cómo cambiarla:** la familia de los títulos sale de una sola variable (`--font-serif`) y los tokens están por rol, así que probar otra es cambiar esa línea y revisar los tamaños de la tabla tipográfica.

### Referencias

- Muestras en el repo: `referencias/maquetas/index.html` (conjunto de componentes) y `referencias/maquetas/nota-con-notas-al-pie.html` (artículo con notas al pie, texto centrado y justificado, e imagen dentro del cuerpo).
- Documentos del proyecto: `especificacion-articulo.md`, `especificacion-home.md`, `especificacion-stack.md` y `plan-implementacion.md`.
- Repositorio: [evaristo-cultural-cms](https://github.com/mareanovazquez/evaristo-cultural-cms).
- Botones: la forma sale de una imagen de referencia con cuatro variantes (relleno, suave, contorno y fantasma). Se tomó la forma y no los colores.
