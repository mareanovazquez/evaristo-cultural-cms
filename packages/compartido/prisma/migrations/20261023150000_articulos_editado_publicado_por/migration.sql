-- AlterTable
ALTER TABLE `articulos` ADD COLUMN `editadoPorId` INTEGER NULL,
    ADD COLUMN `publicadoPorId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_editadoPorId_fkey` FOREIGN KEY (`editadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `articulos` ADD CONSTRAINT `articulos_publicadoPorId_fkey` FOREIGN KEY (`publicadoPorId`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
