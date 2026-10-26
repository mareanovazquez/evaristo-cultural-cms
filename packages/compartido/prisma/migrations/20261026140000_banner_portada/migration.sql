-- AlterTable
ALTER TABLE `configuracion_sitio` ADD COLUMN `bannerActivo` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `banner_imagenes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orden` INTEGER NOT NULL,
    `imagenId` INTEGER NOT NULL,
    `enlace` VARCHAR(512) NULL,
    `alt` VARCHAR(200) NOT NULL,

    INDEX `banner_imagenes_orden_idx`(`orden`),
    INDEX `banner_imagenes_imagenId_idx`(`imagenId`),
    PRIMARY KEY (`id`)
);

-- AddForeignKey
ALTER TABLE `banner_imagenes` ADD CONSTRAINT `banner_imagenes_imagenId_fkey` FOREIGN KEY (`imagenId`) REFERENCES `imagenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
