-- Base y usuarios de MySQL del servidor. docs/guia-despliegue.md, paso 4.
-- Se corre una sola vez como root (ver la guía): mysql --host=127.0.0.1 --port=3308 --user=root --password < /tmp/usuarios.sql
--
-- ANTES: reemplazar CLAVE_APP, CLAVE_ESQUEMA y CLAVE_RESPALDO por tres claves largas y distintas (por ejemplo, cada una con
-- `openssl rand -hex 24`: solo letras y números, para que no haya que codificarlas en la URL del .env). Usar una copia temporal de este archivo y borrarla después: las claves van solo en el .env del servidor
-- y en /etc/evaristo/respaldo.cnf, nunca en el repo.

CREATE DATABASE evaristo_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_es_0900_ai_ci;

-- La app (sitio, panel y API): solo datos, sin poder cambiar tablas. Es la de DATABASE_URL en el .env.
CREATE USER 'evaristo_app'@'localhost' IDENTIFIED BY 'CLAVE_APP';
GRANT SELECT, INSERT, UPDATE, DELETE ON evaristo_cms.* TO 'evaristo_app'@'localhost';

-- La carga inicial de la base y las migraciones de Prisma (db:deploy): estructura y datos. Se usa solo a mano.
CREATE USER 'evaristo'@'localhost' IDENTIFIED BY 'CLAVE_ESQUEMA';
GRANT ALL ON evaristo_cms.* TO 'evaristo'@'localhost';

-- Los respaldos: leer la real y usar la base de prueba de la restauración (despliegue/probar-restauracion.sh).
CREATE USER 'evaristo_respaldo'@'localhost' IDENTIFIED BY 'CLAVE_RESPALDO';
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON evaristo_cms.* TO 'evaristo_respaldo'@'localhost';
GRANT ALL ON evaristo_cms_restauracion.* TO 'evaristo_respaldo'@'localhost';
