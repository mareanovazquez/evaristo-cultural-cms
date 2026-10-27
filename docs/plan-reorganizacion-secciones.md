# Plan: reorganización de secciones y categorías

**Estado (27/10/2026):** propuesta. **No implementada.** Depende de la reunión con la editorial (dentro de 48 horas de esta fecha). Cuando la editorial responda, se confirma o se ajusta este plan, se registra como decisión numerada en `plan-implementacion.md` (la 78) y se implementa en la rama `fase7-secciones`.

Reabre el modelo que la editorial cerró el 7/10/2026 (`especificaciones/especificacion-articulo.md`, secciones 2 y 13).

## 1. Por qué

El modelo actual tiene 17 secciones planas más `sin-asignar`. Mezclan dos ejes: formato (Entrevista, Reseña, Ensayo, Crónica), tema (Literatura, Música, Historieta, Poesía, etc.) y las dos históricas (Rastros, Asia). Un artículo tiene una sola sección, así que «una entrevista sobre historieta» tiene que elegir entre dos ejes. Con 17 entradas del mismo nivel el menú no tiene jerarquía (Asia tiene 414 artículos y Arte 23) y la portada se pensó para 5 secciones.

## 2. Modelo propuesto

| Qué | Contenido |
|---|---|
| **Secciones (menú)** | Entrevista, Reseña, Ensayo, Crónica, Crítica (a confirmar), Rastros, Asia. |
| **Textos** | Sección para los artículos sin formato (los «huérfanos»). Visible en el sitio, pero al final del menú, dentro de «Más». |
| **Novedades** | Sigue siendo una marca temporal (`novedadHasta`), no una sección. Pasa al primer nivel del menú. La página `/novedades/` pasa a ser el **archivo** de todo lo que alguna vez fue novedad, con las vigentes arriba. |
| **Categorías** | Los 10 temas (Literatura, Música, Historieta, Poesía, TV & Cine, Teatro, Fantástico, Arte, Libro Ilustrado, Infantojuvenil) más «Poesía rumana» y «Encuentro Internacional Literatura Fantástica». **Ninguna repite una sección.** |
| **`sin-asignar`** | Se mantiene como sección interna, solo para lo que no tiene ninguna señal (hoy, unos 8 artículos). |

Un artículo tiene una sección, varias categorías (con una principal, la volanta) y, si corresponde, la marca de novedad.

## 3. Preguntas para la reunión

1. ¿Les sirve el recorte a 7 secciones de formato o históricas, con los temas como categorías?
2. **Crítica:** ¿qué la distingue de Reseña? En WordPress no existe, así que arranca vacía. Si no tiene una identidad propia, se saca.
3. **Textos:** ¿aceptan una sección comodín para los ~950 artículos sin formato? ¿Con ese nombre?
4. **Novedades de WordPress:** ¿los 102 artículos con esa categoría eran reseñas de libros recién salidos? Si sí, van a Reseña como novedades ya vencidas.
5. ¿Cuánto tiempo dura una novedad? Se propone un vencimiento por defecto (por ejemplo, 60 días) para que la persona no técnica no tenga que cargar la fecha.
6. ¿Les sirve que `/novedades/` sea el archivo de todas las novedades, con las vigentes arriba?

Si alguna respuesta cambia el modelo, se ajustan los pasos 1 a 5 de la sección 5: casi todo es configuración.

## 4. Qué se toca

Lo relevado en el código el 27/10/2026. Donde dice «a verificar» no se leyó el archivo completo.

### Migración (`packages/compartido`)

| Archivo | Cambio |
|---|---|
| `datos/conversor/mapeo-taxonomias.json` | `secciones` queda con las 7 más Textos. Los 10 temas pasan de `accion: "seccion"` a `accion: "categoria"` con su categoría fija. `categorias` queda solo con los temas y las 2 especiales (se sacan las de formato). `prioridadSecciones` queda con los formatos. Se agrega `prioridadCategorias` (la volanta de un artículo con varios temas, hoy la define la prioridad de secciones). `novedades` deja de ser `descartar` y suma candidata Reseña (si la editorial confirma, pregunta 4). |
| `src/conversor/taxonomia.ts` | (a) las candidatas que pierden por prioridad **no pasan a categoría** (hoy sí; esto implementa «sin categorías que repitan secciones»); (b) sin candidatas pero con categorías → Textos; sin candidatas ni categorías → `sin-asignar`; (c) `validarMapeo` ya no exige que cada sección exista como categoría; (d) `categoriaPrincipal` usa `prioridadCategorias`; (e) ids de Novedades marcados para que el artículo salga con `novedadHasta` vencida. |
| `src/conversor/convert.ts` (línea 891), `types.ts` | `novedadHasta` hoy sale siempre `null`. Para los migrados con marca de novedad sale con una fecha pasada (la de publicación). A verificar que ninguna validación pida `novedadHasta > publicadoEn`. |
| `src/secciones.ts` | La lista `SECCIONES` (la siembra) queda con las 7 + Textos + `sin-asignar`. |
| `scripts/db-sembrar.ts`, `scripts/migracion/lib/entrada-snapshot.ts`, `scripts/migracion/tests/ayudas-db.ts` | Leen `SECCIONES`; solo cambia el comentario de «18 secciones». |
| `scripts/migracion/lib/armar.ts`, `escribir.ts` | Pasan `novedadHasta` y crean las categorías nuevas. A verificar que no asuman las secciones viejas. |
| `scripts/conversor/run-corpus.ts` | Reporte de la corrida: ahora cuenta Textos. |

### Tests de la migración

| Test | Cambio |
|---|---|
| `src/conversor/tests/test-taxonomia.ts` | Casos con secciones de tema, `sin-asignar` para Novedades solo, categoría principal. Se reescriben a la nueva prioridad. |
| `scripts/migracion/tests/test-armar.ts` | Cifras de la muestra de 35 (línea 30: reparto por sección) y listas de categorías a crear (líneas 34, 212-217). |
| `datos/migracion/snapshot-wp-muestra.json` | No cambia (es el origen). |

### Sitio (`apps/sitio`)

| Archivo | Cambio |
|---|---|
| `src/components/Header.astro` | «Novedades» sale de «Más» y pasa al primer nivel. «Más» queda con Textos y Autores. |
| `src/lib/rutas.ts` (`SECCIONES_VISIBLES = 6`) | Sube a 7. |
| `src/lib/portada.ts` y `src/pages/novedades.astro` | `contarNovedades`/`notasNovedades` pasan de «vigentes» a «alguna vez novedad» (`novedadHasta` no nulo), con las vigentes primero. `esNovedad` ya compara con la fecha, así que la etiqueta solo se ve en las vigentes. La portada sigue usando solo las vigentes. Actualizar el comentario «Con 17 secciones…». |
| `src/pages/novedades.astro` | Texto de la página: pasa a ser el archivo. |
| `src/lib/secciones.ts` | No cambia: el menú sale de la base, en el orden del panel. |
| Redirecciones de `/category/<x>/` de WordPress | **No existen todavía** (`urls.ts` las deja para la fase 7). Se arma una tabla WordPress → destino: formatos e históricas a `/seccion/…`, temas a `/categoria/…`, Novedades a `/novedades/`, México a la portada. Se agrega un campo `destino` al mapeo. |

### API y panel

| Archivo | Cambio |
|---|---|
| `apps/api/src/admin/clasificacion.ts` | Sin cambios de lógica. `sin-asignar` sigue siendo la única interna. Textos es una sección normal. A verificar que borrar o renombrar secciones respete `Restrict`. |
| `apps/api/src/admin/revision.ts` (filtro `sin-asignar`) | Sin cambios. El filtro `seccion:<id>` ya existe, así que «Textos» se filtra sin tocar código. |
| `apps/panel` | Sin cambios. La pantalla de secciones ya permite reordenar y renombrar. |

### Tests del sitio, la API y el panel que probablemente se tocan (cifras fijas)

`apps/api/src/tests/test-humo.ts` (espera 17 secciones en el menú, líneas 155 y 181), `test-secciones.ts`, `test-portada-base.ts`, `test-novedades-base.ts`, `test-admin-clasificacion-base.ts`, `test-admin-revision-base.ts` y `apps/panel/src/editor/test-pantalla.tsx`. No se leyeron: la lista sale de buscar «sin-asignar», «interna» y cifras de secciones. Se corre toda la batería y se corrige lo que rompa.

### Documentación

`especificaciones/especificacion-articulo.md` (secciones 2 y 13), `especificaciones/especificacion-home.md`, `estado-fase5.md` (bloques de portada), `estado-fase6.md` (Novedades como archivo), `plan-implementacion.md` (decisión 78), `pendientes.md`, `relevamiento-wordpress.md` (si cambia algún conteo) y el párrafo de estado de `CLAUDE.md`.

### Lo que no se toca

- `evaristo_cms` (la muestra verificada) y `evaristo_cms_test` por fuera de los tests de la migración. La base real sigue cerrada: `ESCRITURA_REAL_HABILITADA = false`.
- El esquema de Prisma: no hace falta una migración nueva. Si en la reunión piden que Textos no aparezca ni en «Más», habría que sumar una columna `enMenu` a `secciones` (una migración más, que se aplicaría a la real en la fase 7, junto con `secciones_orden`).

## 5. Pasos (rama `fase7-secciones`, base `evaristo_cms_dev`)

Antes: comprobar la base 3308 (`Test-NetConnection 127.0.0.1 -Port 3308`). Nada de lo siguiente toca la real.

1. **Mapeo y taxonomía.** Cambios en `mapeo-taxonomias.json` y `taxonomia.ts` (sección 4), con `test-taxonomia` reescrito primero. Criterio: pasan los tests y `run-corpus` da el reparto esperado (sección 6).
2. **Migración de la muestra.** `test-armar` y la migración de los 35 artículos a `evaristo_cms_test`, con cifras nuevas. Corre sin tocar la real.
3. **Siembra de secciones.** `SECCIONES` nuevas; rehacer `evaristo_cms_dev` (las secciones tienen artículos con `Restrict`, así que no se pueden borrar en el lugar). Se vacía y se vuelve a migrar la muestra con `--base-dev`.
4. **Sitio.** Menú (`Header.astro`, `rutas.ts`), Novedades como archivo y comentarios de la portada. Se mira en el navegador con datos reales de dev.
5. **Redirecciones de `/category/`.** Tabla de destinos y su test (extiende `test:redirecciones`).
6. **Tests y documentación.** Batería completa (`test:fase3` y las suites `*-base` contra dev) y los `.md` de la sección 4. Registrar la decisión 78.
7. **Merge a `main`** solo con el visto bueno de Mariano. No se hace `push` desde acá.

Los pasos 1 y 2 son los únicos que cambian el resultado de la migración; los demás son consecuencia.

## 6. Resultado esperado de la migración

Estimación a partir de la corrida del 13/10/2026 (2.637 artículos), a confirmar en el paso 1 con `run-corpus`:

| Sección | Artículos |
|---|---|
| Entrevista | 469 |
| Asia | 414 |
| Reseña | 348, más hasta 95 si Novedades se confirma como reseñas |
| Rastros | 245 |
| Ensayo | 81 |
| Crónica | 35 |
| Crítica | 0 |
| **Textos** | **~942** (los que ganaban por tema y no tienen formato) |
| `sin-asignar` | ~8 (Uncategorized y «Artículos»), o ~103 si Novedades no se confirma |

Los 942 de Textos conservan su tema como categoría, así que tienen volanta. Hoy 1.609 artículos no tienen ninguna; el número baja en la misma medida (a confirmar en el paso 1).

## 7. Riesgos y consecuencias

- **Información que se pierde.** Hoy, un artículo con «Reseñas» y «Ensayo» queda con una sección y la otra como categoría. Con «no repetir secciones como categorías», la perdedora se descarta. Es el costo de la decisión y hay que decirlo en la reunión.
- **Reseña pasa a ser prioridad frente a Ensayo y Crónica** si Novedades suma candidata Reseña: los pocos artículos con Novedades y Ensayo irían a Reseña. Revisar los casos con `run-corpus`.
- **Cifras fijas en los tests** (sección 4): hay que correr todo antes de dar por buena la rama.
- **Revisión artículo por artículo.** Mariano va a revisar los 2.600 a mano. Por eso la edición masiva de secciones en el panel queda fuera de este plan.
