-- AlterTable
ALTER TABLE `articulos` ADD COLUMN `conCapital` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `articulos_borradores` (
    `articuloId` INTEGER NOT NULL,
    `datos` JSON NOT NULL,
    `baseVersion` DATETIME(3) NOT NULL,
    `usuarioId` INTEGER NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `articulos_borradores_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`articuloId`)
);

-- AddForeignKey
ALTER TABLE `articulos_borradores` ADD CONSTRAINT `articulos_borradores_articuloId_fkey` FOREIGN KEY (`articuloId`) REFERENCES `articulos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos_borradores` ADD CONSTRAINT `articulos_borradores_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
