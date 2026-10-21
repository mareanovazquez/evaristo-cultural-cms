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

## Decisiones pendientes (a plantear de a una)

1. **Hash de contraseñas.** Recomendado: `scrypt` de `node:crypto` (sin dependencia nueva). Alternativa: argon2 (dependencia nativa).
2. **Sesiones.** Recomendado: tabla propia en la base (token aleatorio de 32 bytes guardado como hash SHA-256, cookie `httpOnly`, `SameSite=Strict`, vencimiento y cierre en el servidor), sin `express-session`. Alternativa: `express-session` con un almacén.
3. **Dependencias.** Para pedir permiso: `zod` (validar lo que llega del panel), `helmet`, `express-rate-limit`, `multer` y `sharp` (imágenes), y los paquetes de TipTap. Sin ellas no se avanza más allá del login.
4. **Autoguardado de un artículo PUBLICADO.** Si se autoguarda directo sobre la fila, cada tecla cambia lo que ve el público. Opciones: no autoguardar los publicados (guardar con botón), o un "borrador de cambios" separado que se aplica al publicar de nuevo (mejor para el editor, más trabajo y una migración).
5. **Ediciones simultáneas.** Recomendado: bloqueo optimista con `actualizadoEn`: si otra persona guardó mientras tanto, el servidor rechaza y avisa, en vez de pisar.
6. **Enrutado del panel.** Recomendado: sin librería (pocas pantallas, rutas por hash). Alternativa: `react-router`.
7. **Primer administrador.** Recomendado: script de línea de comandos que pide la contraseña por teclado (nunca en el repo ni en el chat).
8. **Diseño del panel.** El panel usa los tokens y componentes de `decisiones-de-diseno.md` (botones, formularios con etiqueta flotante, avisos); decidir si comparte la hoja de estilos del sitio.

## Orden propuesto

1. Cimientos de la API: `DATABASE_URL_DEV`, JSON con límite, `helmet`, límite de intentos, usuarios y sesiones, roles, primer administrador. Con tests.
2. Panel: pantalla de ingreso, estructura, listado de artículos con filtros por estado (solo lectura).
3. Mover `textoPlanoDe` a `src`; agregar `conCapital`; API de artículos (leer, crear, editar) validando con el esquema, calculando el texto plano y verificando `altPendiente`.
4. Editor: portar con `imagenId`, prueba de ida y vuelta de los 35, guardado y borradores.
5. Biblioteca de imágenes: subida con recorte y punto focal, borrado protegido.
6. Publicar y programar, vista previa, ficha técnica y galería.
7. Autores, secciones, categorías y herramientas de revisión posterior a la migración.
8. Mensajes de error en lenguaje común y prueba con alguien de la editorial.

## Estado

Reconocimiento hecho el 21/10/2026. Sin código de la fase 4 todavía. Próximo paso: resolver las decisiones 1 a 3 y empezar por el paso 1.
