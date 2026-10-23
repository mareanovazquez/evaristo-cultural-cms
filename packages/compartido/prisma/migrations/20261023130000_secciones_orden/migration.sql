-- AlterTable
ALTER TABLE `secciones` ADD COLUMN `orden` INTEGER NOT NULL DEFAULT 0;

-- Orden inicial: el de la lista de secciones con la que se cargaron (los ids salen en ese orden).
UPDATE `secciones` SET `orden` = `id`;
