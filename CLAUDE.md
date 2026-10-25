# CMS Evaristo Cultural

CMS propio para reemplazar WordPress en la revista cultural Evaristo Cultural (editorial Evaristo). Hay 2.637 artículos publicados (2006 a 2026) para migrar. Los artículos nuevos los carga una persona no técnica.

**Stack:** TypeScript en todo. Monorepo con npm workspaces: `apps/sitio` (Astro, SSR en modo middleware), `apps/panel` (React + Vite), `apps/api` (Express 5) y `packages/compartido` (Prisma 7, validador, conversor, migración). MySQL 8.4 + Prisma. Editor: TipTap. Un solo proceso en el puerto 3000.

**Estado (23/10/2026):** las fases 0 a 3 están hechas (la 3 es el sitio público completo: artículo, autores, secciones, categorías, redirecciones y 404). La fase 4 (panel y API) está en curso: ingreso y sesiones, listado de artículos, API de edición con borrador de cambios y el editor del panel (pantalla de edición, alta, autoguardado, conflicto, vista previa; pasos 1 a 4); las imágenes (subida, biblioteca, punto focal del encabezado; paso 5); publicar, programar, despublicar, ficha técnica y galería con visor (paso 6); el paso 7 (administración: usuarios y roles, autores, secciones y categorías, revisión de la migración y menú lateral) está hecho en la rama `fase4-administracion`, todavía sin mergear a `main`; falta el cierre (paso 8). La fase 5 (portada) tiene una primera versión armada con datos reales para mostrarle a la dueña de la editorial (`docs/estado-fase5.md`). La fase 6 (buscador y novedades) tiene una primera versión (`docs/estado-fase6.md`). La fase 7 (migración completa y lanzamiento) no empezó. Para retomar, leer `docs/plan-proximos-pasos.md`, `docs/pendientes.md` y, de la fase 4, `docs/estado-fase4.md`.

## Reglas de trabajo

- Si hay que decidir algo con Mariano, preguntar de a una decisión y de forma concreta.
- No hacer `push`: lo hace Mariano. Los prompts se pegan desde `C:\Users\Usuario\Documents\Proyectos frontend`.
- La escritura en la base real está cerrada por `ESCRITURA_REAL_HABILITADA = false`. No abrirla sin aprobación explícita y nunca dejarla en `true` al cerrar una sesión. Ceremonia completa: decisión 50 de `docs/plan-implementacion.md`.
- Antes de cualquier tarea que use Prisma o escriba, comprobar la base 3308; antes de una que lea WordPress, la 3307: `Test-NetConnection 127.0.0.1 -Port <puerto>`. Claude Code no arranca servidores.
- No tocar `MySQL80`, Laragon ni el `mysqld.exe` huérfano (PID 11864). Nunca `Stop-Process` sobre una base.
- Respaldos con `mysqldump --result-file` (el `>` de PowerShell guarda en UTF-16).
- Credenciales solo en `.env` (`DATABASE_URL_MIGRACION`, documentada en el README, sección de la primera escritura real); nunca en el repo, en un documento ni en el chat.
- Windows/PowerShell: usar opciones largas en `mariadb-admin` (`--host=...`). El `tar` de Windows altera nombres con tildes.
- No devolver `visitasWp` hacia el sitio ni el panel (`select` explícito).
- El panel y la API se desarrollan contra `evaristo_cms_dev` (flag `--base-dev`, variable `DATABASE_URL_DEV`); nunca contra `evaristo_cms` (la muestra verificada) ni `evaristo_cms_test` (la vacían los tests de la migración). Las migraciones de la fase 4 no se aplican a la base real hasta la fase 7.
- Dependencias nuevas: preguntar antes, con versión exacta y revisando la fecha de publicación (no usar versiones de menos de dos semanas). Instaladas con su versión aprobada: TipTap 3.31.4, `jsdom` 30.1.2 y `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0 y `@dnd-kit/utilities` 3.2.2 (ordenar secciones arrastrando; aprobadas por Mariano el 23/10/2026, publicadas en 2023-2024) en `apps/panel`; `multer` 2.4.0, `@types/multer` 2.3.0 y `sharp` 0.35.5 en `apps/api`. Hoy no hay ninguna aprobada sin instalar. Enrutado del panel: `react-router`.
- Al tomar una decisión o cambiar el estado, actualizar el `.md` correspondiente en `docs/` en el mismo trabajo (estado, pendientes, decisiones de diseño o decisión numerada del plan).

## Índice de documentación

Leer solo lo que la tarea necesite.

| Archivo | Qué contiene y cuándo leerlo |
|---|---|
| `docs/estado-fase3.md` | Fase 3 (sitio público): qué hay, decisiones, tests, inventario de los 35 artículos y qué quedó abierto. Leer antes de tocar el sitio. |
| `docs/plan-proximos-pasos.md` | **Temporal (borrar cuando la fase 7 esté en marcha).** Plan para retomar el 24/10/2026: topbar editable (el footer es fijo en el código, decisión 75) y la fase 7 (descarga de WordPress antes del 28/11/2026, trabajo técnico previo, ensayo en copia, migración real y lanzamiento), con las decisiones a plantear. Leer al empezar. |
| `docs/estado-fase6.md` | Fase 6 (buscador y novedades): qué hay, cómo busca, dónde se ven las novedades, qué falta confirmar con la editorial y qué queda para la fase 7. Leer antes de tocar el buscador o las novedades. |
| `docs/estado-fase5.md` | Fase 5 (portada): qué hay, qué se decidió por defecto, qué preguntarle a la dueña de la editorial y qué falta. Leer antes de tocar la portada. |
| `docs/estado-fase4.md` | Fase 4 (panel y API): decisiones, lo hecho (pasos 1 a 5, con las reglas y cosas a tener en cuenta del editor) y lo que falta (pasos 6 a 8). Leer al retomar la fase 4. |
| `docs/guia-prueba-editorial.md` | Guía para la prueba del panel con la editorial (criterio de cierre de la fase 4): preparación, tareas, cómo observar y cómo decidir si se aprobó. Leer al preparar o analizar esa prueba. |
| `docs/pendientes.md` | Estado técnico vivo (bases, tests, commits) y lista de pendientes. Leer al empezar y antes de planificar. |
| `docs/plan-implementacion.md` | Roadmap de fases 0 a 7, decisiones 1 a 67 y riesgos. Largo: buscar la fase o decisión, no leerlo entero. |
| `docs/decisiones-de-diseno.md` | Paleta, tipografía, tokens, componentes, notas al pie, letra capital, celular. Leer antes de tocar CSS o UI. |
| `docs/especificaciones/especificacion-articulo.md` | Artículo, autores, secciones y categorías, migración desde WordPress. Leer antes de tocar modelo de datos, validador, plantillas o migración. |
| `docs/especificaciones/especificacion-home.md` | Portada. Solo en la fase 5. |
| `docs/especificaciones/especificacion-stack.md` | Principios y elección del stack. Para decisiones de arquitectura. |
| `docs/diseno-script-migracion.md` | Diseño, modo de uso, seguridad y tests del script de migración. Leer antes de tocar `packages/compartido/scripts/migracion`. |
| `docs/relevamiento-wordpress.md` | Datos de la base de WordPress de origen. Para dudas sobre el contenido a migrar. |
| `docs/glosario-comandos-bases.md` | Comandos para iniciar y detener las bases en Windows, usuarios de MySQL, y cómo aplicar migraciones a la base de desarrollo. |
| `docs/historico/prueba-inicial.md` | Prueba de TipTap y del conversor; la sección 5.5 es la normalización de títulos. Histórico. |
| `referencias/maquetas/` | Muestras HTML. `nota-con-notas-al-pie.html` es la vigente, `index.html` el conjunto de componentes. Solo para trabajo visual. |
| `referencias/datos/` | `muestra-convertida.json` (30 artículos, ~1,5 MB: la muestra original, sin los 5 de la ampliación) y `avisos-por-articulo.csv` (resumen por artículo, sin la columna `revision_humana`). **No leer** salvo pedido expreso: son salidas de referencia del conversor. Los correos están tapados con `[correo omitido]`. |
