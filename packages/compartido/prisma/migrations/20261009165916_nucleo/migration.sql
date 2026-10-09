-- CreateTable
CREATE TABLE `secciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(100) NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `interna` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `secciones_slug_key`(`slug`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `categorias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(150) NOT NULL,
    `nombre` VARCHAR(150) NOT NULL,

    UNIQUE INDEX `categorias_slug_key`(`slug`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `autores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wpUserId` INTEGER NULL,
    `slug` VARCHAR(255) NOT NULL,
    `nombre` VARCHAR(255) NOT NULL,
    `soloTexto` BOOLEAN NOT NULL DEFAULT false,
    `bio` JSON NULL,
    `instagram` VARCHAR(255) NULL,
    `x` VARCHAR(255) NULL,
    `facebook` VARCHAR(255) NULL,
    `sitioWeb` VARCHAR(255) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `autores_wpUserId_key`(`wpUserId`),
    UNIQUE INDEX `autores_slug_key`(`slug`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `articulos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wpId` INTEGER NULL,
    `slug` VARCHAR(255) NOT NULL,
    `titulo` VARCHAR(512) NOT NULL,
    `bajada` TEXT NULL,
    `cuerpo` JSON NOT NULL,
    `schemaVersion` INTEGER NOT NULL DEFAULT 1,
    `textoPlano` LONGTEXT NOT NULL,
    `estado` ENUM('BORRADOR', 'PUBLICADO', 'PROGRAMADO') NOT NULL DEFAULT 'BORRADOR',
    `publicadoEn` DATETIME(3) NULL,
    `novedadHasta` DATETIME(3) NULL,
    `seccionId` INTEGER NOT NULL,
    `categoriaPrincipalId` INTEGER NULL,
    `etiquetasWp` JSON NULL,
    `avisosMigracion` JSON NULL,
    `visitasWp` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    UNIQUE INDEX `articulos_wpId_key`(`wpId`),
    UNIQUE INDEX `articulos_slug_key`(`slug`),
    INDEX `articulos_estado_publicadoEn_idx`(`estado`, `publicadoEn`),
    INDEX `articulos_seccionId_publicadoEn_idx`(`seccionId`, `publicadoEn`),
    PRIMARY KEY (`id`)
);

-- CreateTable
CREATE TABLE `articulos_categorias` (
    `articuloId` INTEGER NOT NULL,
    `categoriaId` INTEGER NOT NULL,

    INDEX `articulos_categorias_categoriaId_idx`(`categoriaId`),
    PRIMARY KEY (`articuloId`, `categoriaId`)
);

-- CreateTable
CREATE TABLE `articulos_autores` (
    `articuloId` INTEGER NOT NULL,
    `autorId` INTEGER NOT NULL,
    `orden` INTEGER NOT NULL DEFAULT 0,

    INDEX `articulos_autores_autorId_idx`(`autorId`),
    PRIMARY KEY (`articuloId`, `autorId`)
);

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_seccionId_fkey` FOREIGN KEY (`seccionId`) REFERENCES `secciones`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_categoriaPrincipalId_fkey` FOREIGN KEY (`categoriaPrincipalId`) REFERENCES `categorias`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_categorias` ADD CONSTRAINT `articulos_categorias_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_categorias` ADD CONSTRAINT `articulos_categorias_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `categorias`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_autores` ADD CONSTRAINT `articulos_autores_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_autores` ADD CONSTRAINT `articulos_autores_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `autores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
