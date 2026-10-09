# Evaristo Cultural CMS

CMS propio de la revista Evaristo Cultural, pensado para reemplazar el WordPress actual.

## Requisitos

- Node.js según la versión indicada en `.nvmrc` (LTS, 22.12 o superior).
- MySQL 8.4 LTS, escuchando en el puerto 3308.

## Instalación

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/mareanovazquez/evaristo-cultural-cms.git
   cd evaristo-cultural-cms
   ```
2. Instalar las dependencias a partir del lockfile:
   ```bash
   npm ci
   ```
3. Copiar el archivo de ejemplo de variables de entorno y completar la clave:
   ```bash
   cp .env.example .env
   ```
   Editá `.env` y reemplazá `CAMBIAR_CLAVE` por la clave real del usuario de MySQL.

> Las claves y el archivo `.env` nunca se commitean. Solo se versiona `.env.example`, con valores de relleno.

## Crear las bases en MySQL

Ejecutá esto con un usuario administrador de MySQL, reemplazando `CAMBIAR_CLAVE` por la clave elegida:

```sql
CREATE DATABASE evaristo_cms
  CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;
CREATE DATABASE evaristo_cms_shadow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;

CREATE USER 'evaristo'@'localhost' IDENTIFIED BY 'CAMBIAR_CLAVE';

GRANT ALL PRIVILEGES ON evaristo_cms.* TO 'evaristo'@'localhost';
GRANT ALL PRIVILEGES ON evaristo_cms_shadow.* TO 'evaristo'@'localhost';
FLUSH PRIVILEGES;
```

## Base de datos (Prisma)

El esquema vive en `packages/compartido/prisma/schema.prisma` y la configuración en `packages/compartido/prisma.config.ts`, que lee `DATABASE_URL` y `SHADOW_DATABASE_URL` del `.env` de la raíz. El cliente generado queda en `packages/compartido/src/generated/` (no se versiona: se regenera con `db:generate`).

| Comando | Para qué sirve |
| --- | --- |
| `npm run db:generate` | Genera el cliente de Prisma a partir del esquema. Hay que correrlo después de `npm ci` y cada vez que cambie `schema.prisma`. |
| `npm run db:nueva -- <nombre>` | Crea una migración nueva **sin aplicarla** y le quita la intercalación fija (ver más abajo). Es la forma de crear migraciones en este proyecto. Usa la base shadow. |
| `npm run db:migrate` | `prisma migrate dev` a secas. No lo uses para crear migraciones (ver más abajo); sirve para comprobar que no haya deriva entre el esquema y la base. |
| `npm run db:deploy` | Aplica las migraciones ya versionadas sin crear nada nuevo (`prisma migrate deploy`). Es el que corresponde en un equipo nuevo o en producción. |
| `npm run db:verificar` | Revisa que la base, todas las tablas y todas las columnas de texto usen `utf8mb4_es_0900_ai_ci`. Sale con error si algo difiere. `_prisma_migrations` se excluye del chequeo (la crea Prisma) y se muestra solo como dato. |
| `npm run db:probar` | Inserta una fila de prueba con tildes y comillas tipográficas, la lee de vuelta, muestra la intercalación de la tabla y la borra. |

> El `.env` nunca se commitea. Las migraciones (`packages/compartido/prisma/migrations/`) sí se versionan.

### Intercalación y migraciones nuevas

El proyecto usa `utf8mb4_es_0900_ai_ci` (la ñ es una letra distinta de la n). Prisma, en cambio, escribe en cada `CREATE TABLE` la cláusula `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, y las tablas quedarían con esa intercalación en lugar de heredar la de la base.

Por eso **cada migración nueva se crea con `npm run db:nueva -- <nombre>`** y no con `migrate dev` a secas: el script genera la migración, le borra esa cláusula, avisa si todavía queda algún `COLLATE` y no la aplica. Después de revisar el SQL, se aplica con `npm run db:deploy` y se comprueba con `npm run db:verificar`.

### Base shadow

Prisma recrea la base shadow (`evaristo_cms_shadow`) con la intercalación por defecto del servidor cada vez que la usa, y eso no importa: solo cuenta la intercalación de `evaristo_cms`. Por eso `db:verificar` mira únicamente `evaristo_cms`.

### Recrear la base en otro equipo

1. Crear las bases y el usuario como se indica en la sección anterior. Las dos bases tienen que crearse con `utf8mb4_es_0900_ai_ci` **antes** de correr `db:deploy`; si no, las tablas heredarían otra intercalación.
2. Completar el `.env` a partir de `.env.example`.
3. Correr `npm ci`.
4. Correr `npm run db:generate`.
5. Correr `npm run db:deploy` para aplicar las migraciones existentes. (`db:migrate` es solo para crear migraciones nuevas durante el desarrollo.)
6. Correr `npm run db:verificar` para confirmar la intercalación.
7. Opcional: `npm run db:probar` para comprobar la conexión y la codificación.

## Modelo de datos

Hoy el esquema tiene el núcleo del contenido y sus complementos:

| Tabla | Qué guarda |
| --- | --- |
| `secciones` | Las 18 secciones de la revista (17 públicas y `sin-asignar`, que es interna). Se cargan con `db:sembrar`. |
| `categorias` | Las categorías de los artículos. |
| `autores` | Los autores, incluidos los que son solo texto (por ejemplo, una redacción). |
| `articulos` | Los artículos: cuerpo en JSON de TipTap, texto plano para el buscador, estado, fechas, sección y categoría principal. |
| `articulos_categorias` | Relación entre artículos y categorías. |
| `articulos_autores` | Relación entre artículos y autores, con el orden en que aparecen. |
| `imagenes` | Biblioteca de imágenes: clave del archivo original (ruta relativa en el almacenamiento), nombre original, tipo, medidas, tamaño, hash SHA-256 e id del adjunto de WordPress. |
| `articulos_galeria` | Galería de cada artículo: imagen, orden, texto alternativo y epígrafe. |
| `fichas_tecnicas` | Ficha técnica del libro reseñado (una por artículo; todos los campos son opcionales). |
| `usuarios` | Usuarios del panel, con rol `EDITOR` o `ADMINISTRADOR`. Todavía no tienen sesiones ni inicio de sesión. |
| `redirecciones` | Redirecciones desde las URLs viejas de WordPress hacia un artículo, un autor o un destino manual. |

Columnas nuevas en `articulos`: imagen de encabezado (con texto alternativo, crédito y punto focal), datos para redes (descripción e imagen que reemplazan a la bajada y al encabezado) y `altPendientes`, la cantidad de imágenes con texto alternativo pendiente. En `autores`: foto (con texto alternativo y punto focal).

El texto alternativo del encabezado, de la galería y de la foto del autor vive en cada uso y no en la biblioteca de imágenes: la misma imagen puede usarse en varios lugares con textos distintos.

> `PruebaConexion` es un modelo temporal para probar la conexión y se va a eliminar.

### Convenciones

- Los nombres de tabla van en minúscula y se fijan con `@@map("...")` en cada modelo. MySQL en Windows guarda los nombres de tabla en minúscula y en Linux respeta las mayúsculas, así que en Windows un error de mayúsculas no se vería. `npm run db:verificar` lee `schema.prisma` y falla si algún modelo (salvo `PruebaConexion`) no tiene un `@@map` en minúscula.
- Las migraciones se crean siempre con `npm run db:nueva -- <nombre>` (ver "Intercalación y migraciones nuevas").
- Las relaciones usan `Restrict` para no dejar borrar una sección, categoría o autor en uso, y `Cascade` en las tablas intermedias, la galería, la ficha técnica y las redirecciones, que se borran junto con el artículo (o con el autor, en el caso de sus redirecciones). Una imagen en uso como encabezado, en la galería, en los datos para redes o como foto de un autor tampoco se puede borrar (`Restrict`).

### Scripts del modelo

| Comando | Para qué sirve |
| --- | --- |
| `npm run db:sembrar` | Carga las 18 secciones (definidas en `packages/compartido/src/secciones.ts`). Es idempotente: se puede correr las veces que haga falta sin duplicar ni cambiar ids. |
| `npm run db:probar-modelo` | Prueba el modelo contra la base real: relaciones, orden de autores, fechas en UTC, cuerpos grandes, imágenes y sus usos, ficha técnica, usuarios, redirecciones, restricciones y unicidad. Todo lo que crea lo borra al final y no toca las secciones sembradas. |

## Servidor único (Express 5 + Panel + Astro)

Todo corre en **un solo proceso de Node** (`apps/api`):

- Express 5 atiende la API bajo `/api`. Cualquier otra ruta de `/api` responde un 404 en JSON.
- El panel de administración (React + Vite) se sirve bajo `/admin` (ver la sección siguiente).
- Para todo lo demás, Express sirve los archivos estáticos del sitio y delega en el handler SSR de Astro (adaptador `@astrojs/node` en modo `middleware`), tomado de `apps/sitio/dist/server/entry.mjs`.
- Escucha solo en `127.0.0.1`, puerto 3000 (se cambia con la variable `PORT`). El `.env` se carga con `--env-file` de Node, sin `dotenv`.
- Si el sitio todavía no se compiló, la API funciona igual y el resto responde 503 con "Falta compilar el sitio: corré npm run build:sitio".
- El orden en el servidor es: `/api`, después `/admin` y por último Astro (archivos estáticos y SSR) para todo lo demás.

### Cómo arrancar todo en local

1. Arrancar MySQL (puerto 3308).
2. `npm ci`
3. `npm run db:generate`
4. `npm run dev` (compila el sitio y el panel, y arranca el servidor)

Después abrir:

- http://127.0.0.1:3000/ : página de prueba del sitio, con las filas de `PruebaConexion` leídas de MySQL (o "Sin filas de prueba") y un texto con ñ, tildes y comillas tipográficas para comprobar la codificación UTF-8.
- http://127.0.0.1:3000/admin/ : el panel de administración (hoy, solo una pantalla de prueba).
- http://127.0.0.1:3000/api/salud : responde `{"estado":"ok","filas":N}`, o 503 con `{"estado":"error"}` si la base falla.

| Comando | Para qué sirve |
| --- | --- |
| `npm run dev` | Compila el sitio y el panel, y arranca el servidor único. **Ni el sitio ni el panel se recompilan solos**: para ver cambios hay que volver a correr `npm run dev` (o el build correspondiente; el panel no necesita reiniciar el servidor). Para trabajar el panel con recarga en caliente, usá `npm run dev:panel`. |
| `npm run build` | Compila el sitio y después el panel. |
| `npm run build:sitio` | Compila el sitio de Astro en `apps/sitio/dist/` (no se versiona). |
| `npm run build:panel` | Compila el panel con Vite en `apps/panel/dist/` (no se versiona). |
| `npm run dev:panel` | Servidor de desarrollo de Vite para el panel, con recarga en caliente (ver más abajo). |
| `npm run dev:sitio` | `astro dev` del sitio solo, en http://127.0.0.1:4321, con recarga en caliente. No incluye la API. |
| `npm run start --workspace=@evaristo/api` | Arranca el servidor único sin compilar nada antes (pensado para producción). |

> **Apagado ordenado:** el servidor atiende SIGINT y SIGTERM (cierra el servidor y desconecta Prisma), pero en Windows no se puede probar porque ahí las señales terminan el proceso sin pasar por los handlers. Se prueba en Linux al desplegar.
>
> **Charset UTF-8:** lo pone el middleware de Astro (`apps/sitio/src/middleware.ts`) en todas las páginas HTML, así que las páginas nuevas no necesitan declararlo.

## Panel de administración (/admin)

El panel es una app React + Vite + TypeScript (`apps/panel`). **Hoy es solo una pantalla de prueba** que consulta `/api/salud` y muestra si la API responde; todavía no tiene login, rutas internas ni editor.

- **En producción:** `npm run build:panel` genera `apps/panel/dist/` y el mismo servidor Express lo sirve en http://127.0.0.1:3000/admin/. `/admin` (sin barra) redirige a `/admin/`, y cualquier ruta interna sin extensión (por ejemplo `/admin/articulos`) devuelve el `index.html` del panel. Una ruta con extensión que no existe da 404. Si el panel no está compilado, `/admin` responde 503 con "Falta compilar el panel: corré npm run build:panel"; el sitio y la API siguen funcionando, y el servidor lo comprueba en cada pedido, así que no hace falta reiniciarlo después de compilar.
- **En desarrollo, con proxy:** con el servidor Express arriba (`npm run dev` o `npm run start --workspace=@evaristo/api`), correr `npm run dev:panel` en otra terminal. Vite queda en http://127.0.0.1:5173/admin/ con recarga en caliente y reenvía `/api` al puerto 3000. El puerto 5173 es fijo: si está ocupado, Vite falla en lugar de cambiar de puerto.
- **Sin indexación:** todo lo que se sirve bajo `/admin` lleva el encabezado `X-Robots-Tag: noindex, nofollow`, y el HTML del panel incluye `<meta name="robots" content="noindex, nofollow">`.

## Estructura de carpetas

```
evaristo-cultural-cms/
├── apps/
│   ├── sitio/        # Sitio público (Astro)
│   ├── panel/        # Panel de administración (React + Vite), servido en /admin
│   └── api/          # Servidor único (Express 5): /api, /admin y el sitio de Astro
└── packages/
    └── compartido/   # Tipos, editor, renderizador, validador, conversor y schema de Prisma
```

Es un monorepo con npm workspaces. Para chequear los tipos de todos los paquetes:

```bash
npm run typecheck
```

## Cómo seguir en otro equipo

1. Al terminar cada sesión de trabajo, subir todo a GitHub (`git push`).
2. En el equipo nuevo, instalar Node (la versión de `.nvmrc`) y MySQL 8.4 en el puerto 3308.
3. Clonar el repositorio y correr `npm ci`.
4. Crear el `.env` a partir de `.env.example` y completar la clave. Las claves nunca se commitean.
5. Crear las bases de datos siguiendo la sección anterior.
6. Correr `npm run db:generate` y `npm run db:deploy` (ver la sección de base de datos).

### Windows 11: Control Inteligente de Aplicaciones

En Windows 11, el Control Inteligente de Aplicaciones (Smart App Control) puede bloquear el binario nativo del compilador de Astro y hacer fallar `astro build` y `astro dev` con el error 4551 ("Una directiva de Control de aplicaciones bloqueó este archivo"). Para comprobarlo antes de empezar, después de `npm ci`:

```bash
node -e "require('./node_modules/@astrojs/compiler-binding-win32-x64-msvc/astro.win32-x64-msvc.node'); console.log('carga OK')"
```

Si falla, revisá Seguridad de Windows → Control de aplicaciones y navegador → Control Inteligente de Aplicaciones. Desactivarlo es decisión de cada uno: en muchas versiones no se puede volver a activar sin restablecer Windows. Si la máquina la administra una organización, no se toca.
