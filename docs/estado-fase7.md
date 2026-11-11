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
| — | Paquete de garantía para la directora: `CMS-EVARISTO(ASSETS)\entrega-roxana-2026-11-11\` (copia de `wordpress.sql`, `uploads-completo.tar` y `lista-completa.tsv` del 31/10, hashes verificados, `LEEME.txt` con cómo restaurarlo en un WordPress nuevo y `SHA256SUMS.txt`). Mariano lo sube a Google Drive, compartido solo con ella | 11/11/2026 |
| — | Copia navegable sin conexión para la directora (`copia:navegable`): `CMS-EVARISTO(ASSETS)\copia-navegable-2026-11-11\` y `copia-navegable-evaristo-cultural-2026-11-11.zip` (1,34 GB, 13.873 archivos). Los 2.637 publicados de 2.637, 3.783 páginas, 10.060 recursos, 0 enlaces rotos (revisados archivo por archivo), imágenes de hasta 1200 px, tipografías incluidas, sin buscador. «Pathfinder.jpg» está dañada en el origen y va como original | 11/11/2026 |

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
| `copia:navegable` (`apps/api`) con `--originales` y `--salida` (carpeta nueva) | Copia del sitio público que se abre desde el disco, sin servidor ni internet. Lee la real en solo lectura (como `test:humo`). Necesita `build:sitio`; después de reiniciar `MySQL84`, entrar una vez con el usuario `evaristo` (`pendientes.md`, sección 9). Unos 6 minutos |

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
5. **«Quiénes somos» y contacto.** «Quiénes somos» sigue en `#` (falta el texto de la editorial). **Contacto, el front está hecho (11/11/2026):** `/contacto/` con nombre, correo y mensaje, etiqueta flotante y errores al salir del campo (los primeros campos de formulario del sitio público: `.campo`, `.campo-error`, `.aviso-pagina` y `.btn--grande` en `sitio.css`), una trampa para robots (`sitio`) y el enlace del footer. La validación y los textos de los avisos están en `@evaristo/compartido/contacto`, para que la API use los mismos. Con JavaScript manda un JSON por `fetch` a `POST /api/contacto` y muestra el resultado sin recargar (200 enviado, 400 faltan datos, 429 demasiados mensajes, otro error); sin JavaScript manda el formulario y la API tiene que volver a `/contacto/?estado=enviado|datos|limite|error`. No usa la base. **La API está hecha (11/11/2026, `apps/api/src/contacto.ts`):** `POST /api/contacto` valida con `validarContacto`, exige que el pedido venga del propio sitio (`protegerOrigen`, que se sacó de `crearAuth` para compartirlo), limita a 5 mensajes enviados por hora y por dirección (los datos mal no gastan el cupo), contesta como enviado sin mandar nada si viene la trampa `sitio`, y responde JSON si el pedido es JSON o redirige con 303 a `/contacto/?estado=…` si es un formulario común. El envío es una función que se le pasa (`EnviarContacto`); `armarCorreoContacto` arma el correo (a la editorial, con Reply-To a quien escribió y el nombre en una sola línea) y **el envío por SMTP está hecho con `nodemailer` 10.2.1** (aprobada e instalada el 11/11/2026): se configura con `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_SEGURO`, `SMTP_USUARIO`, `SMTP_CLAVE`, `CONTACTO_DESTINO` y `CORREO_REMITENTE` (README y `.env.example`); una configuración incompleta corta el arranque. Sin `SMTP_HOST`, en desarrollo el mensaje se anota en la consola y la página dice «enviado»; en producción responde 503 («No pudimos enviar el mensaje»). Pruebas: `npm run test:contacto` (24, sin base ni correo; una arma el correo real con nodemailer sin mandarlo). **Falta para que llegue de verdad:** los datos SMTP del hosting, el correo de la editorial donde tienen que llegar los mensajes y una dirección remitente del dominio; y probar un envío real una vez que estén. La copia navegable deja afuera `/contacto/`.
6. **`<head>`:** `canonical`, `og:image` y `description` (depende de `SITIO_URL`).
7. **Primer administrador** en la real (`npm run usuario:crear -- --base-real`) y los usuarios de la editorial.
8. **Revisión final:** celular, accesibilidad, velocidad, metadatos para redes. Después, cambio de DNS y seguimiento de los 404 los primeros días.
9. **Cierre de la fase 4 (paso 8):** la prueba del panel con alguien de la editorial (`guia-prueba-editorial.md`).

**Próximo paso propuesto** (no depende del proveedor): preparar el despliegue para un VPS genérico (punto 2) junto con el arreglo de la conexión (punto 3).
