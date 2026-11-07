# Tareas para hacer con el sitio corriendo

Creado el 7/11/2026. Son ajustes que Mariano decidió hacer **a mano, desde el panel, una vez que el sitio esté publicado** (decisión 90 de `plan-implementacion.md`). No bloquean el lanzamiento. Al terminar cada una, tacharla acá; cuando estén todas, borrar este documento (con `git rm`, sacando su fila del índice de `CLAUDE.md`).

## 1. Textos alternativos «null» y «undefined» (5 imágenes)

Vinieron así de WordPress. En cada una, escribir un texto alternativo real (o dejarlo vacío, y queda como pendiente).

| Artículo (id en el CMS) | Título | Imágenes |
|---|---|---|
| 1510 | Álex de la Iglesia en estado puro | `HELHER_ESCRIBANO-A-1188.jpg` (alt «null») |
| 684 | El regreso de Yen-Tchin-King | una imagen de revistaseda.com.ar (alt «undefined»; es externa: ver también la bajada de imágenes externas, decisión 90) |
| 686 | Chile-Asia: Es tiempo de iniciar un diálogo intercultural | `chile1.jpg` (alt «undefined») |
| 687 | La felicidad de Tomo-chan | `banana1.jpg` y `banana2.jpg` (alt «undefined») |

## 2. Artículos en `sin-asignar`

El lector los ve sin nada arriba del título (sin cintillo de sección). Pasarlos a la sección que corresponda desde la ficha del artículo en el panel. Son 8 publicados (16 contando borradores); la lista sale filtrando por la sección «Sin asignar» en el listado de artículos del panel.

## 3. Borradores, uno por uno

Quedan como borrador hasta revisarlos de a uno con la editorial (publicar, corregir o borrar).
- **17 están en el CMS** como BORRADOR (la fecha de creación está en el aviso `fecha_borrador`).
- **32 no se migraron** porque no tienen título (decisión 82), entre ellos el privado 19300. Solo están en el dump de WordPress (`evaristo_lectura_nueva`): para revisarlos hay que traerlos primero (pedírselo a Claude cuando se llegue a este punto).

## 4. Revisión manual del contenido migrado

Lo de `pendientes.md`, sección 7 (títulos dudosos, notas al pie, firmas en el cuerpo, autorías, bios, textos alternativos pendientes), desde la herramienta «Revisión» del panel.
