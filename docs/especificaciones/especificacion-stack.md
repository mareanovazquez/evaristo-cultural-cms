# Revista cultural Evaristo: stack tecnológico

Estado: borrador. Definidas las piezas principales, el lenguaje, el editor de texto y el formato de guardado del cuerpo; pendientes los puntos de la sección 12. Complementa `especificacion-articulo.md`, `especificacion-home.md` y `plan-implementacion.md`.

## 1. Principios

- **Evitar la obsolescencia de WordPress.** Sin plugins de terceros: cada función (notas al pie, ficha técnica, galería, autores) es código propio, hecho a la medida de la especificación.
- **Pocas dependencias, maduras y conocidas.** Cada librería que se suma es un "pequeño plugin" que hay que mantener.
- **Mantenimiento previsible.** Versiones fijadas y actualizaciones planificadas, no urgentes (ver sección 10).
- **Sin sobredimensionar.** Volumen actual: una o dos publicaciones por semana, sin varios editores trabajando a la vez. La arquitectura permite escalar con cambios de configuración, no de diseño (ver sección 9).

## 2. Resumen

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript en todo el proyecto |
| Sitio público | Astro en modo servidor (SSR), con islas de React donde haga falta interacción |
| Panel de administración | React + Vite (SPA), servido en `/admin` |
| Editor de texto del panel | TipTap (sujeto a la prueba de la fase 0 del plan) |
| Backend / API | Node.js (LTS) + Express 5 |
| Base de datos | MySQL 8.4 LTS |
| Acceso a datos | Prisma (esquema en código, migraciones automáticas) |
| Imágenes | sharp (redimensión, compresión, recorte con punto focal) |

Todo corre en **un solo servidor Node**: Express atiende la API, sirve el panel y monta las páginas de Astro como un handler más (adaptador de Node de Astro, opción `mode: 'middleware'`). Un proceso, un deploy, un dominio, sin CORS.

```
/api/...   → API de Express (para el panel)
/admin     → build estático del panel en React
el resto   → páginas de Astro renderizadas en el servidor
```

## 3. Lenguaje: TypeScript

- Todo el proyecto (API, panel y sitio público) en TypeScript.
- Prisma genera los tipos de los modelos, y zod los de lo que llega del panel: los mismos tipos se comparten entre el backend, el panel y las páginas de Astro.
- Reduce errores al modificar el modelo de datos y facilita que otra persona continúe el proyecto.

## 4. Sitio público: Astro

- **Modo servidor (SSR).** Las páginas se arman al pedirlas, con los datos de la base. Lo publicado o corregido se ve en la siguiente visita, sin rebuilds.
- Motivos frente al modo estático:
  - Los **artículos programados** aparecen solos en su fecha, filtrando por fecha en la consulta (el modo estático necesitaría un cron que dispare rebuilds).
  - La **fecha de la portada** sale del servidor, con zona horaria de Argentina (en modo estático quedaría fija en el día del último build).
  - Cada cambio de contenido, incluida una corrección menor, no implica reconstruir todo el sitio.
- **Acceso a datos:** las páginas de Astro usan el mismo cliente de Prisma que la API, sin pasar por ella.
- **Islas:** la página es HTML sin JavaScript y solo los componentes interactivos cargan JS (por ejemplo, el carousel de la portada o el visor de la galería). Pueden escribirse en React y compartirse con el panel.
- Se descartan React como SPA para el sitio público (página vacía hasta cargar el JS, sin previsualización en redes, SEO más débil) y Next.js (resuelve lo anterior, pero carga más JavaScript del que necesita una revista).

## 5. Panel de administración: React + Vite

- SPA: está detrás de un login, no se indexa ni se comparte y es muy interactivo.
- Cubre todo lo definido en la especificación del artículo: autoguardado, borradores, vista previa, programación, confirmación al publicar y mensajes de error en lenguaje común.
- **Editor de texto: TipTap** (basado en ProseMirror). Se configura solo con los formatos cerrados de la especificación: títulos H2 a H4, negrita, itálica, enlaces, listas, citas, alineación por párrafo y notas al pie. Las notas al pie son una extensión propia (nodo de TipTap) con ventana de edición en el punto exacto del texto.
- La elección queda confirmada si la prueba de la fase 0 (ver `plan-implementacion.md`) sale bien. Si no, la alternativa es Lexical.

## 6. Formato de guardado del cuerpo del artículo

- El cuerpo se guarda como **JSON estructurado** (el documento nativo de TipTap/ProseMirror), no como HTML.
- El HTML se genera al mostrar la página, con un renderizador propio en Astro. La vista previa del panel usa el mismo renderizador.
- **Notas al pie:** cada nota vive dentro del documento, en el punto donde se insertó. La numeración (1, 2, 3…), los enlaces de ida y vuelta y la lista final se calculan al renderizar: si se agrega, borra o mueve una nota, el orden se corrige solo.
- **Ventajas:**
  - Los formatos quedan cerrados de verdad: el documento solo admite los tipos de nodo definidos, y lo que llega del panel se valida contra ellos.
  - Cambiar el diseño del artículo no obliga a tocar el contenido guardado.
  - El script de migración tiene un destino claro: convertir el HTML y los shortcodes de WordPress a este JSON.
- **Buscador:** además del JSON se guarda una versión en texto plano del cuerpo, generada al guardar, para el índice FULLTEXT (ver sección 8).

## 7. Backend: Express 5

Middleware previstos:

- **helmet:** cabeceras de seguridad.
- **express-session** con cookies httpOnly: sesión del panel (más simple y seguro que JWT para pocos editores).
- **express-rate-limit:** límite de intentos en el login.
- **multer + sharp:** subida y procesamiento de imágenes.
- **zod:** validación de lo que llega del panel (artículos, fichas técnicas, autores).
- **compression** y **pino:** compresión y logs.
- **Roles** (editor y administrador): middleware propio, sin librería.

## 8. Base de datos: MySQL + Prisma

- **MySQL 8.4 LTS** (la 8.0 terminó su soporte en abril de 2026). MariaDB es alternativa válida según el hosting.
- Codificación **utf8mb4** con intercalación en español (por ejemplo `utf8mb4_es_0900_ai_ci`): tildes, ñ y comillas tipográficas correctas, y orden alfabético correcto en el listado de autores.
- **Prisma:** los modelos se definen en `schema.prisma` y Prisma crea las tablas y genera las migraciones versionadas (`prisma migrate`). Las relaciones muchos a muchos (artículo–autores, artículo–categorías) se declaran en una línea.
- Prisma 7 usa un adaptador del driver para conectarse: arrancar con la versión actual y seguir su guía de MySQL.
- **Cuerpo del artículo:** columna JSON para el documento y columna de texto para la versión en texto plano (ver sección 6).
- **Buscador:** búsqueda de texto completo de MySQL (FULLTEXT) sobre título, bajada y texto plano del cuerpo, mediante consulta directa (`$queryRaw`), porque en Prisma todavía está en vista previa. Alcanza para el volumen de la revista; ignora tildes, pero no reconoce variantes de palabras.
- **Migración desde WordPress:** como WordPress también usa MySQL, la base vieja se puede leer directamente con SQL, además del XML o la API.
- **Backups:** `mysqldump` diario por cron, guardado fuera del servidor. Las imágenes se respaldan aparte.

## 9. Rendimiento y escalado

Con el volumen actual alcanza un VPS chico con todo junto (Node y MySQL), sin caché o con una caché corta. Si el tráfico crece, en este orden:

1. **CDN adelante** (por ejemplo, Cloudflare): Astro envía `Cache-Control` con `s-maxage` y `stale-while-revalidate`, y el CDN atiende los picos.
2. **Imágenes servidas desde el CDN.**
3. **Más recursos o instancias** del servidor, solo con muchísimo tráfico.

Lo que se deja listo desde el inicio:

- Páginas públicas sin cookies ni sesión, para poder cachearlas enteras. El login queda solo en `/admin`.
- Cabeceras de caché definidas en un solo lugar (middleware de Astro).
- Imágenes con URLs que cambian si cambia el archivo, para cachearlas por mucho tiempo.

## 10. Mantenimiento

- Versiones fijadas (lockfile) y Node en versión LTS.
- Revisión de dependencias una o dos veces por año, con aviso automático de pendientes (Renovate o Dependabot).
- Parches de seguridad del backend aplicados cuando salen, aparte de esa rutina.
- Documentación breve de instalación, despliegue y actualización, para que otra persona pueda continuar el proyecto.
- Argumento para la editorial: el mantenimiento pasa a ser previsible y presupuestable (mantenimiento anual).

## 11. Alternativas evaluadas

- **Sequelize:** descartado. La versión 7 lleva años en alfa y el desarrollo avanza lento.
- **Strapi / Payload (CMS headless):** ahorrarían construir el panel, pero atan el proyecto a su ciclo de versiones mayores, el panel es genérico y las piezas específicas (notas al pie) igual hay que programarlas. Payload, además, vive dentro de Next.js y no trabaja con MySQL. Se sigue con desarrollo a medida.
- **Guardar el cuerpo como HTML:** descartado. Obliga a limpiar y validar HTML libre, no garantiza los formatos cerrados y complica la numeración automática de las notas al pie.

## 12. Puntos a definir

1. **Hosting:** proveedor del VPS, dominio y certificado.
2. **Almacenamiento de imágenes:** disco del servidor o almacenamiento de objetos (tipo S3 / R2).
3. **Despliegue:** PM2, Docker u otro; si hay entorno de pruebas además de producción.
4. **Dónde se guardan las sesiones** del panel (MySQL o memoria).
5. **Envío de correos** (recuperación de contraseña), si hace falta.

### Decididos

- **Lenguaje:** TypeScript (sección 3).
- **Editor de texto:** TipTap, a confirmar con la prueba de la fase 0 (sección 5).
- **Formato del cuerpo:** JSON estructurado, renderizado a HTML al mostrar (sección 6).
