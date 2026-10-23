# Paso 7 de la fase 4 (administración): plan de trabajo

**Documento temporal.** Se escribió el 22/10/2026 para arrancar el paso 7 sin releer todo. **Borrarlo al terminar el paso 7** (con `git rm`, sacando también su fila del índice de `CLAUDE.md`) y pasar a `estado-fase4.md` lo que haya quedado como decisión o pendiente duradero. Contexto general: `estado-fase4.md` (decisiones y lo hecho de los pasos 1 a 6), `pendientes.md` (secciones 1, 7 y 8) y `especificacion-articulo.md` (secciones 2, 8 y 9).

**Qué es el paso 7:** que la editorial pueda administrar sin tocar la línea de comandos ni la base: usuarios, autores, secciones y categorías, y las herramientas para revisar lo que dejó la migración. Hoy el panel solo tiene el ingreso, el listado y la edición de artículos.

Estimación: 6 a 9 horas de trabajo, en 4 o 5 sesiones (es el paso más ancho de la fase, pero cada parte es independiente). La incertidumbre grande, como siempre, es que Claude Code no puede abrir un navegador: lo que se verifica solo son los datos y las pantallas en jsdom; el aspecto y el uso real los mira Mariano.

## NO OLVIDAR (hacer vos antes de empezar)

- [ ] **Confirmar que el último push se hizo** (`git status -sb` no tiene que decir "ahead"; el 22/10/2026 `main` tenía 8 commits adelante del remoto).
- [ ] **Lista de las personas que van a usar el panel**: nombre, correo y rol (administrador, editor o redactor). Sirve para probar la parte de usuarios con datos reales y para el alta del lanzamiento. No va al chat ni a un documento con contraseñas: solo nombres y correos.
- [ ] **Ver con la editorial si hay secciones o categorías nuevas que quieran crear** y cómo quieren ordenar las secciones del menú (hoy el orden es el de la lista fija del código). Pendiente: confirmar el modelo de secciones (una sección más categorías y la marca de novedad) y el nombre "Asia" (`pendientes.md`, sección 8).
- [ ] **Definir el formato definitivo de las redes sociales de los autores** (¿se carga el usuario o la dirección completa?, ¿hace falta "otros"?). Hoy hay 4 campos: Instagram, X, Facebook y sitio web.
- [ ] Opcional: **mirar el panel actual con la editorial** (artículos, publicar, galería) y anotar lo que les cueste. Cambia las prioridades de este paso.

## Cómo arrancar (checklist de la primera sesión)

1. `Test-NetConnection 127.0.0.1 -Port 3308` (tiene que dar `True`). El 3307 no hace falta.
2. Estar en `main`, árbol limpio, y crear la rama: `git checkout -b fase4-administracion` (una sola para todo el paso; mergear con `--ff-only` al cerrar cada etapa, como hasta ahora).
3. Ninguna dependencia nueva prevista (TipTap, `react-router`, `sharp` y `zod` ya están). Si aparece una, se pregunta antes, con versión exacta y fecha de publicación (nada de menos de dos semanas).
4. Todo se desarrolla y se prueba contra `evaristo_cms_dev`. Si hay cambios de esquema (ver 7c), se aplican a `_dev` y `_test`, **no a la real** hasta la fase 7 (`db:deploy` junto con las otras migraciones de la fase 4).
5. Leer solo lo que haga falta: `estado-fase4.md` (pasos 1 a 3, 6 y las reglas del editor), `apps/api/src/auth/` y `apps/api/src/admin/`.

## Lo que hay hoy (para no repetir trabajo)

- **Usuarios:** tabla `usuarios` (email único en minúsculas, nombre, `passwordHash` scrypt, `rol` EDITOR o ADMINISTRADOR, `activo`, `ultimoAccesoEn`) y `sesiones`. Hay ingreso, salida, sesión de 12 horas, límite de 10 fallos cada 15 minutos, `exigirSesion` y `exigirRol(rol)` (el administrador pasa por todo), y la herramienta `npm run usuario:crear -- --base-dev …` (pide la contraseña por teclado). **No hay** pantalla ni API para crear, editar, desactivar ni cambiar contraseñas, ni para cerrar las sesiones de un usuario. En `_dev` hay 1 usuario (el de Mariano); la tabla de la base real está vacía.
- **Autores:** tabla `autores` (nombre, `slug`, `soloTexto`, `bio` en JSON, `instagram`, `x`, `facebook`, `sitioWeb`, foto con `fotoAlt` y punto focal) y relaciones con artículos (`articulos_autores`) y redirecciones `AUTOR`. En la real hay unos 424 autores con artículos (200 con bio de WordPress); en `_dev`, 25 (13 con bio, 2 de solo texto, ninguno con foto). El panel solo los **lee** (`GET /api/admin/catalogos`) para elegirlos en un artículo. El sitio ya tiene la página de cada autor, el listado y la bio en el artículo.
- **Secciones:** 17 elegibles más `sin-asignar` (interna). Salen de una **lista fija en el código** (`packages/compartido/src/secciones.ts`, cargada con `db:sembrar`). La tabla **no tiene columna de orden**: el menú usa el orden de la lista. El panel solo las lee.
- **Categorías:** 8 en `_dev` (en la real se crean por slug durante la migración). El panel solo las lee. Cada una tiene su página `/categoria/<slug>/`.
- **Avisos de la migración:** `articulos.avisosMigracion` (JSON) con la forma `{ "cuerpo": [{ "code", "count", "ejemplos" }], "titulo": ["palabra_ambigua:SEDA"], "migracion": [], "validador": [] }`. Los códigos que cita la documentación: `palabra_ambigua`, `palabra_desconocida`, `revisar_autor_en_titulo`, `titulo_vacio`, `marca_sin_nota`, `nota_duplicada`, `imagen_cuerpo_inconsistente`, `bio_con_correo`, `original_faltante`, `imagen_sin_medir`, `origen_privado` y `fecha_borrador`. Además, `articulos.altPendientes` ya cuenta las imágenes sin texto alternativo.
- **Panel:** `Estructura.tsx` tiene un solo enlace (Artículos). `Articulos.tsx` filtra solo por estado y por título.

## Roles y permisos (decidido con Mariano el 22/10/2026)

**Tres roles:** Administrador, Editor y **Redactor**. (Se pensó un cuarto, "Invitado", para quien publica una sola nota; se descartó: ese caso se resuelve con un Redactor al que después se le **revoca el acceso**, o sea, se lo desactiva. Desactivar no borra nada: su ficha de autor y sus artículos quedan intactos y con su firma, y si vuelve se reactiva.) El rol no se llama "Autor" para no mezclarlo con la firma de los artículos (el listado "Autores" del panel).

Los permisos se escriben **con nombre** (por ejemplo `autores.eliminar`, `usuarios.gestionar`, `articulos.publicar.ajenos`) en un solo lugar compartido entre la API y el panel; cada nombre se resuelve según el rol. Así sumar un rol más adelante es cambiar una tabla y no revisar todo el código. No se arma un RBAC configurable (sin pantalla para crear roles ni tabla de permisos): con tres roles fijos alcanza.

| Qué | Redactor | Editor | Administrador |
|---|---|---|---|
| Artículos: crear | Sí | Sí | Sí |
| Artículos: ver, editar, publicar, programar, despublicar y descartar cambios | Solo los **suyos** (los que creó) | Todos | Todos |
| Artículos: pasar un artículo a otra persona (cambiar el creador) | No | Sí | Sí |
| Artículos migrados (sin creador) | No | Sí | Sí |
| Biblioteca de imágenes: ver, usar y subir | Sí | Sí | Sí |
| Biblioteca: borrar una imagen (si no está en uso) | No | Sí | Sí |
| Autores: elegir como firma de un artículo | **Solo su propia ficha** | Cualquiera | Cualquiera |
| Autores: editar la propia ficha | Sí | Sí | Sí |
| Autores: crear y editar las de otros | No | Sí | Sí |
| Autores: eliminar o unir | No | No | Sí |
| Secciones y categorías: elegir | Sí | Sí | Sí |
| Secciones y categorías: crear, renombrar, unir, eliminar | No | No | Sí |
| Usuarios: alta, baja (revocar acceso), rol, restablecer contraseña | No | No | Sí |
| Mi cuenta: cambiar mi nombre y mi contraseña | Sí | Sí | Sí |
| Herramientas de revisión de la migración | No (trabajan sobre artículos ajenos) | Sí | Sí |

**Firma de un Redactor (decidido el 22/10/2026):** un Redactor solo puede firmar con **su propia ficha de autor**; un artículo con varios autores o con la firma de otra persona lo arma un Editor o un Administrador. Por eso **cada Redactor tiene que tener una ficha de autor vinculada desde el alta** (se crea o se elige una existente al crear el usuario) y un artículo nuevo suyo ya sale con esa firma. Tampoco borra imágenes de la biblioteca (no se guarda quién subió cada una).

**Un artículo "suyo" es el que creó él (decidido el 22/10/2026):** columna nueva `creadoPorId`, que además sirve de registro de quién creó cada artículo. Si un Editor crea una nota y la firma con la ficha de un Redactor, la nota no es del Redactor; un Editor o un Administrador puede **cambiar el creador** de una nota si hace falta pasársela (acción "Pasar a otra persona" en la pantalla del artículo). No cuenta quién la firma.

Los artículos migrados no tienen creador ni firma de un Redactor: solo los toca un Editor o un Administrador.

**Cambios de esquema que trae esto** (a `evaristo_cms_dev` y `_test` ahora; a la real, con las demás migraciones de la fase 4 en la fase 7): el valor `REDACTOR` en `RolUsuario`, `articulos.creadoPorId` (opcional, `SetNull` si se borrara el usuario; nunca se borran usuarios, se desactivan) y `autores.usuarioId` (opcional y único: un usuario puede tener su ficha de autor y un autor no necesita usuario; así un Redactor se firma solo con su ficha y la ficha sigue cuando se revoca su acceso). De paso queda resuelto el pendiente del paso 8 de saber quién creó cada artículo.

## Etapa 7a: usuarios — HECHA el 23/10/2026 (ver `estado-fase4.md`, «Paso 7, etapa 7a», y la decisión 68)

**Objetivo:** que un administrador gestione a las personas que usan el panel, sin línea de comandos.

- API (solo administrador): listar, crear (email, nombre, rol —Administrador, Editor o Redactor— y contraseña inicial), cambiar nombre y rol, activar y desactivar, restablecer la contraseña de otro, y cerrar todas sus sesiones. Cada persona puede cambiar **su propia** contraseña (pidiendo la actual) y su nombre. Validar con `zod`, mensajes en lenguaje común, email en minúsculas y único.
- Reglas de seguridad: no se puede dejar al sistema sin ningún administrador activo (ni cambiándole el rol ni desactivándolo ni siendo uno mismo); un usuario desactivado pierde sus sesiones en el acto; la contraseña nunca se devuelve ni se registra; el límite de intentos sigue valiendo. Al desactivar no se borra: los borradores de cambios guardan quién editó (`usuarioId`).
- **Roles y permisos con nombre** (ver la sección anterior): la tabla de permisos en un módulo compartido (`@evaristo/compartido`), `exigirPermiso(nombre)` en la API y el mismo mapa en el panel para mostrar u ocultar. Con **`creadoPorId`**: guardarlo al crear un artículo, y que todas las rutas de artículos (leer, guardar, publicar, publicar cambios, despublicar, descartar cambios, eliminar) comprueben que un Redactor sea el dueño (lo ajeno responde 404, no 403, para no revelar que existe) y que el listado le muestre solo los suyos.
- **Revocar el acceso** (desactivar) con una acción clara en la pantalla ("Revocar acceso" / "Volver a dar acceso"), que corta las sesiones, conserva todo lo suyo y no toca su ficha de autor.
- **Vincular un usuario con su ficha de autor** (crear la ficha al dar de alta, o elegir una existente) y que un artículo nuevo de un Redactor lleve su firma por defecto y que un Redactor no pueda cambiarla ni sumar otras (la API lo rechaza, no solo el panel).
- Pantalla "Usuarios" (solo se ve con rol administrador) y "Mi cuenta" (cambiar nombre y contraseña) para todos.
- Incluye dos pendientes del paso 8 que son de esta parte: **cerrar todas las sesiones de un usuario** y **limpiar las sesiones vencidas** (`borrarSesionesVencidas` existe y no la llama nadie: puede correr al arrancar y cada tanto).
- Tests: `test:admin-usuarios` contra `evaristo_cms_dev` (permisos por rol, alta y duplicados, el último administrador, contraseña débil, sesiones que se cortan, que no se filtre el hash), más pantallas en `test:pantalla`.
- **Hecho cuando:** un administrador crea un **redactor** desde el panel, ese redactor ingresa, crea y publica un artículo suyo, no ve ni puede abrir los de otros (ni por la dirección) ni el menú de administración, y el administrador le revoca el acceso: su sesión deja de servir, su ficha y su artículo siguen en el sitio con su firma, y se le puede volver a dar acceso.

## Etapa 7b: autores

**Objetivo:** que la editorial cargue y corrija autores, y unir los duplicados que dejó WordPress.

- API: listar con búsqueda y paginado (son ~424), leer, crear, editar y (solo administrador) eliminar y **unir con otro**. Eliminar solo si no tiene artículos; unir pasa los artículos del autor sobrante al elegido (en una transacción, sin repetir autor en un artículo y conservando el orden), crea la redirección `AUTOR` de la dirección vieja y borra al sobrante.
- Ficha: nombre, dirección (`slug`: formato validado, único; si cambia, la dirección vieja pasa a redirigir), "no es una persona" (`soloTexto`: sin página ni bio), **bio** de hasta 500 caracteres con itálica y enlaces (sin listas ni títulos; el correo escrito en una bio es un aviso conocido: `bio_con_correo`), **foto** cuadrada con punto focal y texto alternativo (se reutiliza el selector de imágenes y el control de punto focal) y **redes** (campos fijos, opcionales, con el formato que se defina).
- **Vínculo con los usuarios:** una ficha puede estar enlazada a un usuario (`autores.usuarioId`); el listado lo muestra y un Redactor edita solo la suya. Revocar el acceso de un usuario no borra ni oculta su ficha.
- Pantalla "Autores": listado con búsqueda, cantidad de artículos y marcas (sin bio, sin foto, de solo texto), formulario de edición con vista de cómo se ve en la página del autor, y para el administrador "Unir con otro" y "Eliminar" con confirmación. En el formulario de un artículo, poder **crear un autor nuevo** sin salir de la pantalla.
- Tests: `test:admin-autores` (permisos, validaciones, slug único y redirección, unir sin perder artículos ni repetir autores, eliminar con artículos rechazado, la bio guardada como JSON válido para el renderizador) y pantallas.
- **Hecho cuando:** se corrige una bio y una foto, se une "Luca Frondoni" con "lucafrondoni" y los artículos de los dos quedan en uno, la dirección vieja redirige y el sitio muestra la ficha nueva.

## Etapa 7c: secciones y categorías (solo administrador)

**Objetivo:** que el administrador cree, renombre, una y elimine secciones y categorías (incluye el pedido de Mariano del 22/10/2026: **poder crear secciones nuevas**).

- Categorías: crear, renombrar, cambiar la dirección (con redirección de la vieja), **unir con otra** (pasa los artículos y corrige las volantas) y eliminar solo si está vacía.
- Secciones: crear, renombrar, eliminar solo si está vacía y **ordenar**. Hoy no hay columna de orden: hace falta una **migración de Prisma** (`orden`, con el orden actual como valor inicial) y que el menú del sitio y los desplegables la usen. Esa migración se aplica a `_dev` y `_test` y queda pendiente para la real (se suma a `sesiones` y `borradores_y_capital` en el `db:deploy` de la fase 7). La lista fija de `secciones.ts` pasa a ser solo la carga inicial (`db:sembrar`), no la fuente de verdad.
- La sección interna `sin-asignar` no se puede renombrar, ordenar ni borrar, y no se elige.
- Pantalla "Secciones y categorías" con cantidad de artículos de cada una.
- Tests: `test:admin-clasificacion` (permisos, crear con dirección única, unir sin dejar categorías repetidas ni volantas inválidas, eliminar solo vacías, el orden de las secciones en el sitio) y pantallas.
- **Hecho cuando:** el administrador crea una sección "Cine argentino", la ordena, un editor la elige en un artículo, el sitio la muestra en el menú y en su página; y une dos categorías sin perder artículos.

## Etapa 7d: herramientas de revisión posterior a la migración

**Objetivo:** que se pueda recorrer de a poco lo que dejó la migración (`pendientes.md`, sección 7: 2.431 imágenes sin texto alternativo en 813 artículos, ~361 palabras ambiguas en títulos, títulos vacíos, notas que no cierran, bios con correo, 103 artículos en `sin-asignar`, 48 borradores y 1 privado).

- Listado de artículos con **más filtros**: por aviso de la migración (cada código), con imágenes sin texto alternativo (`altPendientes > 0`), por sección (incluido `sin-asignar`), por autor, sin autor, borradores migrados (`wpId` con estado BORRADOR) y el privado. Con el conteo de cada filtro y enlaces desde un tablero "Revisión".
- Marcar un aviso como **revisado** para que deje de aparecer en la cola (decisión pendiente: columna nueva o quitar el aviso del JSON; ver abajo).
- Acciones rápidas: asignar sección a un artículo de `sin-asignar` desde la lista, sin abrirlo entero; abrir el artículo en la pantalla de edición ya posicionado en lo que hay que corregir (imágenes pendientes, por ejemplo).
- Borradores migrados y el privado 19300: decidir con la directora si se publican o se eliminan (hace falta poder **eliminar un borrador**, hoy no se puede; solo administrador y con confirmación).
- Tests: `test:admin-revision` (filtros por código contra los avisos reales de `_dev`, conteos, marcar revisado, asignar sección) y pantallas.
- **Hecho cuando:** se encuentra y se corrige un artículo con una palabra ambigua en el título y uno con imágenes pendientes, ambos salen de la cola, y la cola de `sin-asignar` se vacía de a uno.

## Etapa 7e: cierre del paso 7

- Menú del panel: Artículos, Autores, Secciones y categorías, Usuarios (solo administrador), Revisión (editor y administrador) y Mi cuenta; con los permisos de la tabla de roles, también en la API (no alcanza con esconder botones).
- Regresión completa: `npm run typecheck`, `test:fase3`, `test:auth`, `test:auth-base`, `test:admin-articulos`, `test:admin-edicion`, `test:admin-imagenes`, `test:admin-subida`, `test:admin-publicacion`, `test:admin-galeria-ficha`, los de este paso, `test:editor`, `test:pantalla`, `test:migracion` y `test:conversor`.
- Actualizar `estado-fase4.md`, `pendientes.md` (migraciones nuevas para la real), el README (herramientas y tests) y la decisión numerada del plan; **borrar este documento**; mergear con avance rápido.

## Decisiones para plantear (de a una, cuando toquen)

1. **Orden de las partes.** Propuesta: usuarios (7a), autores (7b), secciones y categorías (7c) y revisión (7d). Alternativa: empezar por la revisión si la editorial va a arrancar a limpiar la migración enseguida.
2. **Contraseña de un usuario nuevo.** Propuesta: el administrador la escribe (o se genera una) y se la comunica a la persona, que la cambia en su primer ingreso; sin correo todavía no hay otra forma segura. Alternativa: esperar a definir el envío de correos y usar un enlace de activación (depende de la fase 1: hosting y correos).
3. **Unir autores.** Qué pasa con la bio, la foto y las redes del sobrante (propuesta: se conserva lo del elegido y solo se completa lo que le falte) y si se avisa antes qué artículos se mueven.
4. **Redes sociales:** usuario o dirección completa, y si se agrega un campo "otros" (es cambio de esquema).
5. **Bio:** reutilizar el editor chico de la nota al pie (negrita, itálica y enlace) quitando la negrita, con contador de caracteres. Confirmar el límite de 500.
6. **Secciones:** si además de crear y renombrar se permite ocultar una sección (sin borrarla) y si cambiar su dirección genera redirección. Depende de confirmar con la editorial el modelo de secciones.
7. **Categorías:** unir y eliminar solo vacías; y si la dirección vieja de una categoría redirige.
8. **Cómo se marca un aviso como revisado:** columna nueva (`revisadoEn` o un JSON de códigos resueltos) o quitar el aviso del JSON. Propuesta: guardar qué avisos se resolvieron y quién, sin borrar el original.
9. ~~**Roles y permisos.**~~ Resuelto el 22/10/2026 (ver "Roles y permisos"). Un Redactor solo firma con su propia ficha y no borra imágenes (decidido). Un artículo "suyo" es el que creó (decidido). Un posible agregado futuro, sin hacer: fecha de vencimiento opcional del acceso (que se desactive solo).

## Riesgos y cosas que mirar

- **424 autores:** la lista tiene que paginar y buscar; el selector de autores del artículo (hoy un desplegable con todos) va a quedar largo y conviene pasarlo a un buscador.
- **Unir y eliminar** tocan muchas filas (artículos, redirecciones): siempre en una transacción y con una prueba que cuente antes y después.
- **Propiedad de los artículos:** si falta la comprobación del dueño en una sola ruta, un Redactor podría tocar lo de otra persona. Hay que probarlas todas con un Redactor (lista, lectura, guardado, publicación, despublicación, borrador de cambios, subida y borrado) y que lo ajeno dé 404.
- **Quedarse sin administrador:** la regla del último administrador activo tiene que estar en la API y en las pruebas.
- **Filtros por aviso:** los avisos son un JSON con tres formas (`cuerpo` con `code`, y `titulo` con "codigo:detalle"); las consultas se hacen con `JSON_TABLE` o `JSON_SEARCH` y conviene medirlas con los 2.637 artículos reales.
- **Migración de esquema (7c, y quizá 7d y 7b):** solo a `_dev` y `_test`; la real queda para la fase 7. No olvidar anotarlas en `pendientes.md`.
- **Seguridad:** cada ruta nueva con `exigirRol` y prueba de que un editor recibe 403; nada de contraseñas en logs, URLs ni respuestas; las contraseñas se piden por teclado también en las herramientas.
- **Slug de autor, sección o categoría:** si cambia, la dirección vieja tiene que redirigir; hay que cuidar que no choque con la de otro (como pasó con las de artículos).
- **No usar `localStorage`** para guardar nada en edición (la regla del paso 4 sigue valiendo).

## Qué NO entra en el paso 7 (queda para el paso 8)

Recuperación de contraseña por correo, política de `helmet` del sitio y el panel, `trust proxy`, límite de intentos que sobreviva a reinicios, registro de quién creó y editó cada artículo (más allá del creador, que se guarda desde el paso 7, y de lo que ya guarda el borrador de cambios), pruebas de las pantallas con una persona de la editorial, y el criterio de cierre de la fase (un editor no técnico carga y publica una nota completa sin ayuda).
