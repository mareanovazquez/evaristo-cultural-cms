# Fase 4 (panel y API): reconocimiento y estado

Actualizado el 21/10/2026. Reconocimiento de solo lectura del estado actual, del editor de la fase 0 (`testing-tiptap`, rama `integracion-conversor`, archivo: no se modifica) y de lo que hay que decidir antes de escribir código. El plan de la fase está en `plan-implementacion.md`, sección 7.

## Base de desarrollo

Se desarrolla contra **`evaristo_cms_dev`** (copia de `evaristo_cms` hecha el 21/10/2026; `DATABASE_URL_DEV` en el `.env`). No contra `evaristo_cms` (la muestra verificada) ni contra `evaristo_cms_test` (los tests de la migración la vacían). Para que Prisma, la API y el sitio usen la de desarrollo hay que apuntar `DATABASE_URL` a ella al arrancar: `prisma.config.ts` y `db.ts` leen `DATABASE_URL` y hoy no conocen `DATABASE_URL_DEV` (pendiente de resolver en el paso 1). Detalle de cómo recrearla: `glosario-comandos-bases.md`.

## Qué hay hoy

- **`apps/panel`:** una página de bienvenida (React 19.3.0 + Vite 8.3.4, servida en `/admin/`; en desarrollo Vite proxea `/api` al 3000). Sin router, sin editor, sin estilos del sistema de diseño.
- **`apps/api`:** Express 5 con `/api/salud`, `/media`, redirecciones y el montaje del sitio y del panel. **Sin autenticación, sin sesiones y sin parseo de cuerpos JSON.**
- **Tabla `usuarios`:** existe (`email`, `nombre`, `passwordHash`, `rol` EDITOR/ADMINISTRADOR, `activo`, `ultimoAccesoEn`) y está vacía. No hay tabla de sesiones.
- **Dependencias del backend que el stack prevé y no están:** `helmet`, `express-session`, `express-rate-limit`, `multer`, `sharp`, `zod`, `pino`, `compression`. En `node_modules` aparecen `zod`, `sharp` y `cookie`, pero solo como dependencias de otros paquetes (Astro): no se pueden usar sin declararlas.
- **Validador y renderizador:** ya están en `@evaristo/compartido` (`./schema`, `./render`) y sirven para validar en el servidor y para la vista previa.

## El editor de la fase 0 (a portar)

Está en `testing-tiptap/src/editor` (unas 1.100 líneas) y `App.tsx` (793 líneas, barra de herramientas, diálogos y pestañas de vista previa, JSON, texto y validación). Usa TipTap 3.31.4 (`core`, `pm`, `react`, `starter-kit`, `extension-heading`, `extension-table`, `extension-text-align`) y React 19.2.x. Tiene un test sin navegador con jsdom (`test:editor`, 183 líneas).

Lo que ya resuelve: títulos H2 a H4 en una línea (`titulo.ts`), citas textual y destacada con autor y fuente (`cita.ts`), notas al pie con ventana de edición (`footnote.tsx`, `FootnoteDialog.tsx`), imagen con alt, decorativa, epígrafe y `altPendiente` (`imagen.tsx`, `imagen-alt.ts`), video de YouTube y Vimeo, tablas simples sin celdas combinadas, alineación izquierda, centro y justificado, y enlaces solo http, https y mailto.

### Problemas encontrados (hay que resolverlos al portar)

1. **El nodo de imagen no tiene el atributo `imagenId`.** Sus atributos son `src`, `alt`, `decorativa`, `epigrafe` y `altPendiente`. Un artículo migrado que se abra y se guarde en este editor **pierde el `imagenId` de todas sus imágenes**: se rompen `width` y `height` y la regla de no borrar una imagen en uso. Hay que agregar el atributo, con test que cargue y guarde los 35 artículos sin cambios.
2. **El editor viaja con su propia copia del validador, el renderizador y `video.ts`** (`testing-tiptap/src/schema`, `src/render`). En el monorepo hay que usar `@evaristo/compartido/schema` y `/render`, no copiar.
3. **El diálogo de imagen pide escribir la dirección (`src`) a mano.** El panel necesita elegir de la biblioteca (`imagenId` y `/media/<clave>`) y subir con recorte y punto focal (tarea 7).
4. **Prueba de ida y vuelta:** hay que verificar que cargar cada uno de los 35 cuerpos en el editor y volver a serializarlos da el mismo JSON (o diferencias explicadas). Es la prueba que protege los datos migrados.
5. **Dependencias de TipTap y de jsdom:** no están en el monorepo. El monorepo fija versiones exactas (sin `^`).
6. **`textoPlanoDe` (la función que calcula el texto del buscador) vive en `packages/compartido/scripts/migracion/lib/utilidades.ts`**, no en `src`. La API no puede importarla por los exports del paquete. Hay que moverla a `src` (por ejemplo `src/texto-plano.ts`, con export `./texto-plano`) y dejar un re-export en el script de migración, con los tests actuales de `test-utilidades.ts` como red de seguridad (decisión 52).

## Faltantes del modelo de datos para esta fase

- **Letra capital:** campo booleano del artículo (`conCapital`), aparte del cuerpo; hoy no existe. El sitio ya tiene el interruptor (`?capital=1` en desarrollo).
- **Tabla de sesiones** (si las sesiones van en la base).
- **Control de ediciones simultáneas** (ver decisiones).
- **Borrador de cambios de un artículo ya publicado** (ver decisiones).
- Verificar si hace falta un campo para recordar quién creó o editó un artículo (no está en el modelo).

## Decisiones tomadas (21/10/2026)

1. **Hash de contraseñas: `scrypt` de `node:crypto`** (sin dependencia nueva).
2. **Sesiones: tabla propia `sesiones` en la base** (código aleatorio de 32 bytes guardado como SHA-256, cookie `httpOnly` y `SameSite=Strict`, vencimiento y cierre en el servidor). Sin `express-session`.
3. **Dependencias aceptadas** (versiones exactas): `zod`, `helmet` y `express-rate-limit` (paso 1); `multer` y `sharp` (imágenes); paquetes de TipTap y `jsdom` (editor y sus tests); `react-router` (panel).
5. **Diseño del panel: estilo propio y neutro** (decidido el 21/10/2026): no comparte la identidad ni los tokens del sitio. Grises, un único acento azul para las acciones y colores de estado solo donde informan algo (`apps/panel/src/estilos.css`).
4. **Enrutado del panel: `react-router`** (decidido el 21/10/2026; es la preferencia de Mariano para las aplicaciones de React). Se instala con versión exacta, revisando antes la fecha de publicación.

## Decisiones pendientes (a plantear de a una)

1. **Autoguardado de un artículo PUBLICADO.** Si se autoguarda directo sobre la fila, cada tecla cambia lo que ve el público. Opciones: no autoguardar los publicados (guardar con botón), o un "borrador de cambios" separado que se aplica al publicar de nuevo (mejor para el editor, más trabajo y una migración).
2. **Ediciones simultáneas.** Recomendado: bloqueo optimista con `actualizadoEn`: si otra persona guardó mientras tanto, el servidor rechaza y avisa, en vez de pisar.

## Orden propuesto

1. Cimientos de la API: `DATABASE_URL_DEV`, JSON con límite, `helmet`, límite de intentos, usuarios y sesiones, roles, primer administrador. Con tests.
2. Panel: pantalla de ingreso, estructura, listado de artículos con filtros por estado (solo lectura).
3. Mover `textoPlanoDe` a `src`; agregar `conCapital`; API de artículos (leer, crear, editar) validando con el esquema, calculando el texto plano y verificando `altPendiente`.
4. Editor: portar con `imagenId`, prueba de ida y vuelta de los 35, guardado y borradores.
5. Biblioteca de imágenes: subida con recorte y punto focal, borrado protegido.
6. Publicar y programar, vista previa, ficha técnica y galería.
7. Autores, secciones, categorías y herramientas de revisión posterior a la migración.
8. Mensajes de error en lenguaje común y prueba con alguien de la editorial.

## Paso 1 hecho (21/10/2026, rama `fase4-auth`, sin mergear)

Autenticación de la API, sobre `evaristo_cms_dev`:
- **Contraseñas:** `src/auth/clave.ts`, `scrypt` (N=32768, r=8, p=1), sal aleatoria, formato `scrypt$N$r$p$sal$hash` (los parámetros viajan con el hash), comparación en tiempo constante, mínimo de 10 y máximo de 200 caracteres.
- **Sesiones:** tabla `sesiones` (migración `20261021151549_sesiones`, aplicada **solo** a `evaristo_cms_dev`; hay que aplicarla a `evaristo_cms` con `db:deploy` al lanzar). La cookie `evaristo_sesion` lleva un código aleatorio de 32 bytes; en la base queda solo su SHA-256. `httpOnly`, `SameSite=Strict`, `Path=/api` (las páginas públicas no llevan cookies), `Secure` con `NODE_ENV=production`, 12 horas de vida. Un usuario desactivado o una sesión vencida dejan de servir en el acto.
- **Rutas:** `POST /api/auth/ingresar`, `POST /api/auth/salir`, `GET /api/auth/yo`, con `zod`. El mismo 401 y el mismo mensaje para email inexistente, usuario inactivo y contraseña mal escrita (se verifica siempre contra un hash, real o de mentira). Límite de intentos con `express-rate-limit`: 10 fallos cada 15 minutos por dirección; los ingresos correctos no cuentan.
- **Origen:** los pedidos que cambian datos se rechazan si `Origin` no es el propio sitio o `Sec-Fetch-Site` es `cross-site` o `same-site`.
- **Roles:** `exigirSesion` y `exigirRol(rol)` (el administrador pasa por todo). Todavía no hay rutas protegidas reales.
- **API:** `helmet` y `express.json` (límite 2 MB) montados solo en `/api`. Los pedidos mal formados dan 400 y los demasiado grandes 413. El sitio y el panel no llevan `helmet` todavía: su política de contenido (fuentes de Google, YouTube y Vimeo) se diseña aparte.
- **Base de desarrollo:** `--base-dev` (`src/entorno.ts`) apunta `DATABASE_URL` a `DATABASE_URL_DEV` y se niega si no es `evaristo_cms_dev`. `npm run dev:desarrollo -w @evaristo/api` arranca la API así. Las herramientas exigen elegir `--base-dev` o `--base-real`.
- **Primer usuario:** `npm run usuario:crear -- --base-dev --email=<email> --nombre="<nombre>" --rol=ADMINISTRADOR` pide la contraseña por teclado, sin mostrarla.
- **Tests:** `npm run test:auth` (18, sin base: repositorio en memoria y reloj controlable; se comprobó con tres mutaciones que detectan fallos reales) y `npm run test:auth-base` (contra `evaristo_cms_dev`, con un usuario temporal que se borra; se niega a correr contra otra base).
- **Dependencias agregadas (versión exacta):** `zod` 4.6.5 (la 4.6.6 y la 4.6.7 tenían menos de dos semanas), `helmet` 8.3.0 y `express-rate-limit` 8.7.1, solo en `apps/api`.

Limitaciones conocidas: el límite de intentos vive en memoria (se reinicia con el servidor) y detrás de un proxy hay que configurar `trust proxy` para que cuente la dirección real; no hay recuperación de contraseña ni cierre de todas las sesiones de un usuario; la sesión no se renueva con el uso (12 horas fijas).

## Paso 2 hecho (21/10/2026, rama `fase4-panel`, sin mergear)

- **API:** `GET /api/admin/articulos` (`src/admin/articulos.ts`), protegida por sesión (editor o administrador) y por la revisión de origen. Filtro por estado, búsqueda por título (sin distinguir mayúsculas ni tildes), 25 por página, ordenado por última edición, con la cantidad por estado para las solapas. Devuelve solo lo que la pantalla muestra (sin cuerpo, `visitasWp` ni texto plano) y la dirección pública del artículo si ya se ve en el sitio.
- **Panel:** `react-router` 8.4.0 (versión exacta; la 8.5.0 tenía 2 días), `BrowserRouter` con `basename="/admin"`. Pantallas: ingreso (`paginas/Ingreso.tsx`), marco con la barra superior y el botón Salir (`Estructura.tsx`) y el listado de artículos con solapas por estado, búsqueda y paginación (`paginas/Articulos.tsx`). Todo lo que no es el ingreso exige sesión (`RutaProtegida`); si el servidor responde 401, se vuelve al ingreso y después a la misma pantalla. Los mensajes de error están en lenguaje común (`api.ts`). El listado todavía no abre ningún artículo: el editor es el paso 4.
- **Tests:** `npm run test:admin-articulos` (contra `evaristo_cms_dev`, con usuario temporal: sin sesión 401; totales, solapas, estados, paginación sin repetidos, orden, búsqueda, filtros inválidos y que la respuesta no traiga campos de más). La prueba de humo ahora también comprueba que Express sirve el panel y sus rutas internas, sus archivos, y que la API del panel exige sesión.
- **No hay pruebas de las pantallas del panel** (no hay entorno de pruebas de React en el repo): solo typecheck y build; hay que mirarlas en el navegador.
- Para verlo: `npm run build:panel`, crear un usuario con `npm run usuario:crear -- --base-dev …`, `npm run dev:desarrollo -w @evaristo/api` y abrir `http://127.0.0.1:3000/admin/`. Con recarga en caliente: la API como antes y `npm run dev:panel` (`http://127.0.0.1:5173/admin/`).

## Estado

Reconocimiento y pasos 1 y 2 hechos el 21/10/2026. Próximo paso: el paso 3 (mover `textoPlanoDe` a `src`, agregar `conCapital` y la API para leer, crear y editar artículos), que necesita las decisiones 1 (autoguardado de publicados) y 2 (ediciones simultáneas).
