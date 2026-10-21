# CMS Evaristo Cultural

CMS propio para reemplazar WordPress en la revista cultural Evaristo Cultural (editorial Evaristo). Hay 2.637 artículos publicados (2006 a 2026) para migrar. Los artículos nuevos los carga una persona no técnica.

**Stack:** TypeScript en todo. Monorepo con npm workspaces: `apps/sitio` (Astro, SSR en modo middleware), `apps/panel` (React + Vite), `apps/api` (Express 5) y `packages/compartido` (Prisma 7, validador, conversor, migración). MySQL 8.4 + Prisma. Editor: TipTap. Un solo proceso en el puerto 3000.

**Estado:** la fase 2 (modelo de datos y migración de la muestra de 35 artículos) está cerrada. La fase 3 (sitio público) está por empezar. Para retomar, leer `docs/estado-fase3.md` y `docs/pendientes.md`.

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
- Al tomar una decisión o cambiar el estado, actualizar el `.md` correspondiente en `docs/` en el mismo trabajo (estado, pendientes, decisiones de diseño o decisión numerada del plan).

## Índice de documentación

Leer solo lo que la tarea necesite.

| Archivo | Qué contiene y cuándo leerlo |
|---|---|
| `docs/estado-fase3.md` | Dónde quedamos en la fase 3, decisiones del 20/10 y próximo paso. Leer al retomar. |
| `docs/pendientes.md` | Estado técnico vivo (bases, tests, commits) y lista de pendientes. Leer al empezar y antes de planificar. |
| `docs/plan-implementacion.md` | Roadmap de fases 0 a 7, decisiones 1 a 53 y riesgos. Largo: buscar la fase o decisión, no leerlo entero. |
| `docs/decisiones-de-diseno.md` | Paleta, tipografía, tokens, componentes, notas al pie, letra capital, celular. Leer antes de tocar CSS o UI. |
| `docs/especificaciones/especificacion-articulo.md` | Artículo, autores, secciones y categorías, migración desde WordPress. Leer antes de tocar modelo de datos, validador, plantillas o migración. |
| `docs/especificaciones/especificacion-home.md` | Portada. Solo en la fase 5. |
| `docs/especificaciones/especificacion-stack.md` | Principios y elección del stack. Para decisiones de arquitectura. |
| `docs/diseno-script-migracion.md` | Diseño, modo de uso, seguridad y tests del script de migración. Leer antes de tocar `packages/compartido/scripts/migracion`. |
| `docs/relevamiento-wordpress.md` | Datos de la base de WordPress de origen. Para dudas sobre el contenido a migrar. |
| `docs/glosario-comandos-bases.md` | Comandos para iniciar y detener las bases en Windows. |
| `docs/historico/prueba-inicial.md` | Prueba de TipTap y del conversor; la sección 5.5 es la normalización de títulos. Histórico. |
| `referencias/maquetas/` | Muestras HTML. `nota-con-notas-al-pie.html` es la vigente, `index.html` el conjunto de componentes. Solo para trabajo visual. |
| `referencias/datos/` | `muestra-convertida.json` (30 artículos, ~1,5 MB: la muestra original, sin los 5 de la ampliación) y `avisos-por-articulo.csv` (resumen por artículo, sin la columna `revision_humana`). **No leer** salvo pedido expreso: son salidas de referencia del conversor. Los correos están tapados con `[correo omitido]`. |
