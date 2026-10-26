-- CreateTable
CREATE TABLE `configuracion_sitio` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `topbarActivo` BOOLEAN NOT NULL DEFAULT true,
    `topbarTexto` VARCHAR(200) NOT NULL DEFAULT '',
    `topbarEnlace` VARCHAR(512) NULL,
    `actualizadoEn` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
);
