-- AlterTable
ALTER TABLE `articulos` ADD COLUMN `altPendientes` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `encabezadoAlt` TEXT NULL,
    ADD COLUMN `encabezadoCredito` VARCHAR(255) NULL,
    ADD COLUMN `encabezadoPuntoFocalX` DOUBLE NOT NULL DEFAULT 0.5,
    ADD COLUMN `encabezadoPuntoFocalY` DOUBLE NOT NULL DEFAULT 0.5,
    ADD COLUMN `imagenEncabezadoId` INTEGER NULL,
    ADD COLUMN `redesDescripcion` TEXT NULL,
    ADD COLUMN `redesImagenId` INTEGER NULL;

-- AlterTable
ALTER TABLE `autores` ADD COLUMN `fotoAlt` VARCHAR(512) NULL,
    ADD COLUMN `fotoId` INTEGER NULL,
    ADD COLUMN `fotoPuntoFocalX` DOUBLE NOT NULL DEFAULT 0.5,
    ADD COLUMN `fotoPuntoFocalY` DOUBLE NOT NULL DEFAULT 0.5;

-- CreateTable
CREATE TABLE `imagenes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clave` VARCHAR(512) NOT NULL,
    `nombreOriginal` VARCHAR(255) NOT NULL,
    `tipoMime` VARCHAR(100) NOT NULL,
    `ancho` INTEGER NOT NULL,
    `alto` INTEGER NOT NULL,
    `bytes` INTEGER NOT NULL,
    `hash` CHAR(64) NOT NULL,
    `wpId` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `imagenes_clave_key`(`clave`),
    UNIQUE INDEX `imagenes_wpId_key`(`wpId`),
    INDEX `imagenes_nombreOriginal_idx`(`nombreOriginal`),
    INDEX `imagenes_hash_idx`(`hash`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `articulos_galeria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `articuloId` INTEGER NOT NULL,
    `imagenId` INTEGER NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `alt` TEXT NULL,
    `epigrafe` TEXT NULL,

    INDEX `articulos_galeria_articuloId_orden_idx`(`articuloId`, `orden`),
    INDEX `articulos_galeria_imagenId_idx`(`imagenId`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `fichas_tecnicas` (
    `articuloId` INTEGER NOT NULL,
    `titulo` VARCHAR(512) NULL,
    `autor` VARCHAR(512) NULL,
    `traductor` VARCHAR(255) NULL,
    `editorial` VARCHAR(255) NULL,
    `coleccion` VARCHAR(255) NULL,
    `anio` INTEGER NULL,
    `paginas` INTEGER NULL,
    `isbn` VARCHAR(20) NULL,
    `precio` VARCHAR(50) NULL,

    PRIMARY KEY (`articuloId`)
);

-- CreateTable
CREATE TABLE `usuarios` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `rol` ENUM('EDITOR', 'ADMINISTRADOR') NOT NULL DEFAULT 'EDITOR',
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `ultimoAccesoEn` DATETIME(3) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `usuarios_email_key`(`email`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `redirecciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `origen` VARCHAR(512) NOT NULL,
    `tipo` ENUM('ARTICULO', 'SLUG_ANTERIOR', 'AUTOR', 'MANUAL') NOT NULL,
    `codigo` INTEGER NOT NULL DEFAULT 301,
    `articuloId` INTEGER NULL,
    `autorId` INTEGER NULL,
    `destino` VARCHAR(512) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `redirecciones_origen_key`(`origen`),
    INDEX `redirecciones_articuloId_idx`(`articuloId`),
    INDEX `redirecciones_autorId_idx`(`autorId`),
    PRIMARY KEY (`id`)
);

-- CreateIndex
CREATE INDEX `articulos_altPendientes_idx` ON `articulos`(`altPendientes`);

-- AddForeignKey
ALTER TABLE `autores` ADD CONSTRAINT `autores_fotoId_fkey` FOREIGN KEY (`fotoId`) REFERENCES `imagenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_imagenEncabezadoId_fkey` FOREIGN KEY (`imagenEncabezadoId`) REFERENCES `imagenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_redesImagenId_fkey` FOREIGN KEY (`redesImagenId`) REFERENCES `imagenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_galeria` ADD CONSTRAINT `articulos_galeria_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_galeria` ADD CONSTRAINT `articulos_galeria_imagenId_fkey` FOREIGN KEY (`imagenId`) REFERENCES `imagenes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fichas_tecnicas` ADD CONSTRAINT `fichas_tecnicas_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redirecciones` ADD CONSTRAINT `redirecciones_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `redirecciones` ADD CONSTRAINT `redirecciones_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `autores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
