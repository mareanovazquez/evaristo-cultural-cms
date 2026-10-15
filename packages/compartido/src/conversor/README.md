# Conversor de WordPress

Convierte el contenido de las entradas de WordPress (`post_content`) al documento del editor, y resuelve título, bajada, sección y categorías.

## Origen
Viene del repositorio testing-tiptap, rama `integracion-conversor`, commit `ba37c92`. Se copió sin historial.

## Validador
`src/schema/validate.ts` de este paquete es la copia canónica desde este commit. No se corrige en testing-tiptap: cualquier cambio se hace acá.

## Pruebas
```
npm run test:conversor -w @evaristo/compartido
```
Corre en cadena las 4 suites de `src/conversor/tests/` (19 + 41 + 10 + 33 pruebas). `test-integracion-titulos` usa `packages/compartido/posts.json` si existe; si no, saltea esa parte.

## Archivos
- `datos/conversor/`: léxico de títulos y mapeo de taxonomías (entradas versionadas).
- `scripts/conversor/run-corpus.ts`: convierte todo el corpus; lee `posts.json` y escribe informes en `out/`.
- `posts.json` y `out/` son salidas generadas, no se versionan (están en `.gitignore`).
