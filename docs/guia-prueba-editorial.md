# Guía para la prueba del panel con la editorial

Es el **criterio de cierre de la fase 4**: una persona de la editorial, que no es técnica, **carga y publica una nota completa sin ayuda**. Esta guía sirve para preparar la prueba, para conducirla sin ayudar de más y para anotar lo que pase.

Se hizo el 23/10/2026. Las partes entre corchetes `[ ]` son para completar durante la prueba.

## Antes de empezar (lo prepara Mariano o quien dé soporte)

1. **Base y datos.** La prueba se hace contra `evaristo_cms_dev` (una copia): todo lo que se cargue se puede borrar sin consecuencias. Comprobar que la base 3308 esté arriba.
2. **Construir y arrancar.** `npm run build` desde la raíz y `npm run dev:desarrollo -w @evaristo/api`. Abrir `http://127.0.0.1:3000/admin/` en el navegador que usa la persona (el de siempre, no el de uno).
3. **Un usuario para la prueba.** Desde «Usuarios» (con la cuenta de administración): crear a la persona con el rol **Redactor** (o Editor, según quién sea en la editorial), con su nombre real, una contraseña provisoria y la ficha de autor creada con su nombre. Pasarle la contraseña en persona. **No usar tu usuario.**
4. **Materiales de la nota.** Tener a mano un texto real (una reseña o una nota corta, con un subtítulo y una cita), **una foto** para la imagen principal y, si se puede, una segunda foto para el texto. Cualquier nota de WordPress sirve como original: la prueba es de carga, no de escritura.
5. **Cómo observar.** Alguien se sienta al costado **sin tocar el mouse ni el teclado**. Si hay una pantalla compartida o grabación, mejor. Se anota todo lo que cuesta, aunque la persona lo resuelva sola.

## Qué se le dice a la persona (y nada más)

> «Vamos a probar el panel nuevo, no a evaluarte a vos: si algo no se entiende, el problema es del panel. Pensá en voz alta. Cargá esta nota y publicala como lo harías normalmente. No te voy a ayudar, pero anoto todo lo que dudes.»

Reglas de quien observa:

- **No explicar, no señalar con el dedo, no adelantar.** Si la persona pregunta, contestar «¿qué esperarías que pase?».
- Dejar pasar **un minuto** antes de ayudar. Si hay que ayudar, se anota como **«con ayuda»** y qué se le dijo.
- No corregir los errores de la persona antes de que los vea.

## Tareas (en este orden)

Para cada una se anota: **¿pudo sola? (sí / con ayuda / no)**, el **tiempo aproximado** y **qué dudó o dijo**.

| # | Tarea | Qué se espera | Sola | Tiempo | Qué pasó |
|---|---|---|---|---|---|
| 1 | Ingresar con el email y la contraseña provisoria. | Entra y el panel le pide elegir una contraseña propia. | [ ] | [ ] | [ ] |
| 2 | Elegir su contraseña (la anota donde quiera). | Cambia la contraseña y llega a los artículos. | [ ] | [ ] | [ ] |
| 3 | Crear un artículo nuevo con título y sección. | Llega a la pantalla de edición con el artículo en «Borrador». | [ ] | [ ] | [ ] |
| 4 | Pegar o escribir el texto, con un subtítulo y una cita. | El texto queda con formato; se ve «Guardado» o similar. | [ ] | [ ] | [ ] |
| 5 | Agregar una nota al pie. | La nota se crea y aparece numerada. | [ ] | [ ] | [ ] |
| 6 | Poner la imagen principal (subirla de su computadora) con su texto alternativo. | La foto se ve en el panel; entiende para qué sirve el texto alternativo. | [ ] | [ ] | [ ] |
| 7 | Agregar una imagen dentro del texto, con epígrafe. | Aparece en el lugar del cursor. | [ ] | [ ] | [ ] |
| 8 | Elegir categorías (y cuál es la principal) y el autor. | Entiende qué es cada cosa; el autor ya viene con su firma. | [ ] | [ ] | [ ] |
| 9 | Mirar la vista previa. | Entiende que es cómo se va a ver en el sitio. | [ ] | [ ] | [ ] |
| 10 | Publicar la nota. | El panel le dice qué falta (si falta algo) y la publica; entiende qué dirección va a tener. | [ ] | [ ] | [ ] |
| 11 | Abrir la nota en el sitio. | Encuentra el enlace «Ver en el sitio». | [ ] | [ ] | [ ] |
| 12 | Corregir una palabra y publicar el cambio. | Entiende que los cambios no se ven hasta «Publicar cambios». | [ ] | [ ] | [ ] |
| 13 | Programar otra nota para dentro de una hora (o la fecha de mañana). | Elige la fecha y entiende que sale sola. | [ ] | [ ] | [ ] |
| 14 | Despublicar la primera nota. | Entiende qué pasa (vuelve a borrador). | [ ] | [ ] | [ ] |

Si la persona va a administrar (Editor o Administrador), sumar:

| # | Tarea | Qué se espera | Sola | Tiempo | Qué pasó |
|---|---|---|---|---|---|
| 15 | Completar la bio y la foto de un autor. | Encuentra «Autores» y entiende el contador de caracteres. | [ ] | [ ] | [ ] |
| 16 | Revisar una nota de la migración con un aviso («Revisión») y marcar el aviso como revisado. | Entiende la cola de revisión. | [ ] | [ ] | [ ] |
| 17 | Asignar la sección a una nota que está en «Sin asignar». | La encuentra y la asigna sin abrirla. | [ ] | [ ] | [ ] |

## Después de las tareas (5 minutos de preguntas)

- ¿Qué fue lo **más difícil o confuso**?
- ¿Hubo algún momento en que **no supiste si se había guardado** o **qué tenías que hacer**?
- ¿Hay alguna palabra del panel que **no entendiste**? (por ejemplo «texto alternativo», «volanta», «dirección», «borrador de cambios»)
- ¿Qué **te faltó**?
- Del 1 al 5, ¿qué tan cómoda te sentirías **cargando notas sola**?

## Cómo se decide si se aprobó

La fase 4 se da por cerrada si, **en las tareas 1 a 14**:

- la persona completó **al menos 12 sin ayuda** (y las que necesitaron ayuda no fueron la 3, la 4 ni la 10: **crear, escribir y publicar** son lo esencial);
- **ningún mensaje** de error o de aviso la dejó trabada sin entender qué hacer;
- no perdió texto (si algo se perdió, es un problema grave aunque la tarea se haya terminado).

Todo lo demás es una lista de mejoras: se ordena por cuántas veces apareció y por cuánto trabó.

## Cómo se anota lo que pasó

Al terminar, pasar las observaciones a una lista con estas columnas (se puede hacer en un documento aparte; **no con el nombre de la persona**: «Redactora 1»):

| Qué pasó | Tarea | Cuántas veces | Gravedad (trabó / dudó / molestó) | Qué se propone |
|---|---|---|---|---|
| [ ] | [ ] | [ ] | [ ] | [ ] |

Los problemas que salgan se suman a `docs/pendientes.md` (sección de la fase 4) y se arreglan antes de repetir la prueba con otra persona. Con **dos o tres personas** de la editorial se ve la mayoría de los problemas.

## Después de la prueba

- Borrar los artículos, autores y usuarios de prueba (o descartar la base `evaristo_cms_dev` y recrearla desde la real, ver `docs/glosario-comandos-bases.md`).
- Anotar la fecha, quién participó (por rol), el resultado de las 14 tareas y las mejoras en `docs/estado-fase4.md`.
