-- AlterTable
ALTER TABLE `articulos` ADD COLUMN `creadoPorId` INTEGER NULL;

-- AlterTable
ALTER TABLE `autores` ADD COLUMN `usuarioId` INTEGER NULL;

-- AlterTable
ALTER TABLE `usuarios` ADD COLUMN `debeCambiarClave` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `rol` ENUM('REDACTOR', 'EDITOR', 'ADMINISTRADOR') NOT NULL DEFAULT 'EDITOR';

-- CreateIndex
CREATE UNIQUE INDEX `autores_usuarioId_key` ON `autores`(`usuarioId`);

-- AddForeignKey
ALTER TABLE `autores` ADD CONSTRAINT `autores_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_creadoPorId_fkey` FOREIGN KEY (`creadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
