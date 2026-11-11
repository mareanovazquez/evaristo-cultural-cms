-- CreateTable
CREATE TABLE `recuperaciones_clave` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tokenHash` CHAR(64) NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `venceEn` DATETIME(3) NOT NULL,
    `usadoEn` DATETIME(3) NULL,

    UNIQUE INDEX `recuperaciones_clave_tokenHash_key`(`tokenHash`),
    INDEX `recuperaciones_clave_usuarioId_idx`(`usuarioId`),
    INDEX `recuperaciones_clave_venceEn_idx`(`venceEn`),
    PRIMARY KEY (`id`)
);

-- AddForeignKey
ALTER TABLE `recuperaciones_clave` ADD CONSTRAINT `recuperaciones_clave_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
