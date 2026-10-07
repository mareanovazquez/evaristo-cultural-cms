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

## Estructura de carpetas

```
evaristo-cultural-cms/
├── apps/
│   ├── sitio/        # Sitio público (Astro)
│   ├── panel/        # Panel de administración (React + Vite)
│   └── api/          # API (Express 5)
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
