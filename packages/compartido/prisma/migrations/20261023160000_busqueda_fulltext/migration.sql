-- CreateIndex
CREATE FULLTEXT INDEX `articulos_busqueda` ON `articulos`(`titulo`, `bajada`, `textoPlano`);

-- CreateIndex
CREATE FULLTEXT INDEX `articulos_busqueda_titulo` ON `articulos`(`titulo`);
