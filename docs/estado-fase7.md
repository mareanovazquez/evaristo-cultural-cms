# Fase 7: migración completa y lanzamiento

Estado al 7/11/2026. Lo duradero de la fase 7. El plan con el que se llegó hasta acá, etapa por etapa, está en `plan-proximos-pasos.md` (temporal); las decisiones, en `plan-implementacion.md` (79 a 90); los pendientes técnicos, en `pendientes.md`; lo manual para después del lanzamiento, en `tareas-con-el-sitio-corriendo.md`.

## Dónde estamos

**La migración está hecha y verificada.** Falta el lanzamiento, que espera la decisión del hosting.

**Esperando a la editorial** (Mariano le escribe a la directora el 7/11/2026):
- que elija el hosting, o al menos ponga un tope de presupuesto (al 11/11/2026 Roxana ya tiene las opciones de hosting y las está evaluando);
- el texto de «Quiénes somos».

**Lo que Mariano tiene en mente:** cambios en el front para que el sitio se vea «menos lavado» (el comentario de la directora), y un formulario de contacto en lugar de una página con datos.

## Lo hecho

| Etapa | Qué | Cuándo |
|---|---|---|
| 0 | Descarga definitiva de WordPress (base y `wp-content/uploads`, 7,54 GB) | 31/10/2026 |
| 0b | Originales extraídos con la clave del CMS (10.975, `wordpress-2026-10-31\originales`, con `mapa-originales.csv`) y copiados a `backup2` | 4/11/2026 |
| 1 | Trabajo técnico previo: variantes de tamaño de las imágenes (83), arreglos de datos (84), URLs viejas de WordPress y feed RSS (85), limpieza de la taxonomía vieja (87), correos fuera de las bios (89) | 4 al 7/11/2026 |
| 2 | Ensayo general en `evaristo_cms_test` (88): estado ok en 1 min 46 s, 0 diferencias; encontró y se arreglaron un conflicto de claves de imagen y dos falsos positivos del verificador | 7/11/2026 |
| 3 | **Migración real** con la ceremonia de la decisión 50: respaldo, las 9 migraciones pendientes, intento en seco (37 filas a reescribir), escritura, verificación y el interruptor de vuelta en `false` | 7/11/2026 |
| — | Sitio sin los respaldos para la base vieja y letra capital desde el artículo | 7/11/2026 |
| — | Las 10 imágenes del cuerpo que apuntaban a otros sitios, bajadas y guardadas; el píxel de Gmail del 552, quitado (90) | 7/11/2026 |

**Resultado de la migración:** 2.619 artículos creados y 35 reescritos, 0 fallidos y 0 conflictos. La real quedó con:
- 2.654 artículos (2.637 publicados y 17 borradores);
- 424 autores (194 con foto);
- 10.061 imágenes;
- 3.088 redirecciones;
- 9 secciones y 12 categorías del modelo nuevo.

La limpieza borró 10 secciones y 3 categorías viejas. Verificación independiente contra WordPress (`verificar:escritura --todos`): 69.931 comprobaciones y 0 diferencias. Las pruebas del sitio contra la real pasan con el corpus completo, salvo `test:humo` por los 4 textos alternativos «null» (manual, después del lanzamiento).

**Respaldos de la real** en `CMS-EVARISTO(ASSETS)\respaldos\`:
- `evaristo_cms-antes-migracion-completa-2026-11-07T1531Z.sql`;
- `evaristo_cms-antes-imagenes-externas-2026-11-07T1833Z.sql`.

## Herramientas de la fase

| Comando | Para qué |
|---|---|
| `migrar:escribir` (con `--todos`, `--sobrescribir --esperar-sobrescribir=N`, `--limpiar-taxonomia`) | La migración; solo con el interruptor abierto y desde la terminal de Mariano |
| `verificar:escritura --todos --wordpress=evaristo_lectura_nueva` con `--originales`, `--mapa` y `--avatares` | Comparación independiente contra WordPress (sin el mapa da diferencias falsas de imágenes). Desde el 7/11/2026 marca los 8 artículos de las imágenes externas en el control (f): es esperado |
| `ensayo:preparar` y `ensayo:migrar` | Ensayo en `evaristo_cms_test` con una copia de la real |
| `imagenes:externas` (`apps/api`) | Baja las imágenes externas de una lista fija revisada; ya no queda ninguna |
| `npm run corpus` | El conversor sobre todo WordPress, en vivo |

Al pegar comandos largos en PowerShell, la terminal puede cortarlos en varios renglones y ejecutar solo el primero. Conviene armar los argumentos en variables cortas (`$X = @(...)` y `npm run ... -- @X`), como se hizo en la migración.

## Lo que falta para el lanzamiento (Etapa 4)

1. **Hosting.** Hace falta un **VPS**: un hosting compartido de PHP no sirve. Requisitos:
   - Ubuntu 24.04 con SSH y root;
   - 2 GB de RAM como mínimo (4 GB cómodo);
   - 40 GB de SSD;
   - Node 22.12 o más nuevo y MySQL 8.4;
   - HTTPS con Let's Encrypt (nginx o Caddy);
   - control de los DNS;
   - correo saliente (SMTP) para el formulario de contacto y la recuperación de contraseña;
   - snapshots.

   Lo decide la editorial.
2. **Despliegue** (se puede preparar para un VPS genérico antes de elegir proveedor):
   - guía de instalación;
   - el servicio que mantiene el proceso prendido;
   - subir la base (dump) y la carpeta `wordpress-2026-10-31\originales`, que con las 10 externas pesa unos 2,3 GB;
   - variables del `.env` del servidor: `MEDIA_DIR`, `MEDIA_DIR_SUBIDAS`, `MEDIA_DIR_VARIANTES`, `SITIO_URL` y `TRUST_PROXY`.
3. **Que Prisma conecte solo después de un reinicio de MySQL** (`allowPublicKeyRetrieval`; `pendientes.md`, sección 9). En el servidor, si no, el sitio no levanta solo después de un reinicio.
4. **Respaldos automáticos** de la base y las imágenes, con una restauración probada.
5. **«Quiénes somos» y contacto.** Hoy los dos enlaces del footer van a `#`. El formulario de contacto necesita una dependencia de envío de correo (se consulta antes) y el SMTP del hosting.
6. **`<head>`:** `canonical`, `og:image` y `description` (depende de `SITIO_URL`).
7. **Primer administrador** en la real (`npm run usuario:crear -- --base-real`) y los usuarios de la editorial.
8. **Revisión final:** celular, accesibilidad, velocidad, metadatos para redes. Después, cambio de DNS y seguimiento de los 404 los primeros días.
9. **Cierre de la fase 4 (paso 8):** la prueba del panel con alguien de la editorial (`guia-prueba-editorial.md`).

**Próximo paso propuesto** (no depende del proveedor): preparar el despliegue para un VPS genérico (punto 2) junto con el arreglo de la conexión (punto 3).
