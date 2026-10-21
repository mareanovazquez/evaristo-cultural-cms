# Glosario: comandos para iniciar y detener las bases (equipo "Galaxy", Windows)

Actualizado: 17/10/2026. Todo se corre en PowerShell. Las contraseñas NO se guardan acá.

## Resumen rápido

| Base | Servidor | Puerto | Cómo se maneja | Para qué se necesita |
|---|---|---|---|---|
| WordPress (solo lectura) | MariaDB 11.8.9 portable | 3307 | A mano, con `mysqld.exe` | Leer WordPress: simulación (`migrar --simular`), generar el snapshot y cualquier prompt que lea esa base |
| CMS | MySQL 8.4.11 | 3308 | Servicio de Windows `MySQL84` (inicio manual) | Prisma, el CMS, los tests con base y la escritura |

Bases del 3307: `evaristo_lectura` (prefijo `wp_`, usuario `root` sin contraseña).
Bases del 3308: `evaristo_cms` (real), `evaristo_cms_shadow` (la usa Prisma al crear migraciones) y `evaristo_cms_test` (solo para tests con base).

## Comprobar qué está arriba (siempre antes de un prompt)

```powershell
Test-NetConnection 127.0.0.1 -Port 3307   # MariaDB con WordPress
Test-NetConnection 127.0.0.1 -Port 3308   # MySQL 8.4 del CMS
```

`TcpTestSucceeded : True` = arriba. `False` = apagada. Es la comprobación confiable: `Get-NetTCPConnection` puede no mostrar nada aunque el puerto responda.

Regla: antes de un prompt que lea WordPress, comprobar el 3307. Antes de uno que use Prisma o escriba, comprobar el 3308.

## MariaDB 3307 (WordPress, portable)

**Iniciar.** En una ventana de PowerShell nueva, que queda ocupada mientras el servidor corre (dejarla abierta). Puede no imprimir nada: es normal.

```powershell
& "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\mariadb-11.8.9-winx64\bin\mysqld.exe" --no-defaults --datadir="C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\data" --bind-address=127.0.0.1 --port=3307 --max-allowed-packet=256M
```

**Comprobar que responde** (desde OTRA ventana):

```powershell
& "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\mariadb-11.8.9-winx64\bin\mariadb-admin.exe" --host=127.0.0.1 --port=3307 --user=root ping
```

Tiene que contestar `mysqld is alive`. Si da error `10061`, puede estar todavía iniciando: esperar un minuto y repetir.

**Ver el log si tarda** (por ejemplo, recuperación de InnoDB tras un apagado sucio). Buscar `ready for connections`:

```powershell
Get-ChildItem "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\data" -Filter *.err | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | ForEach-Object { Get-Content $_.FullName -Tail 20 }
```

**Detener (ordenado).** Siempre con `shutdown`, NUNCA con `Stop-Process`:

```powershell
& "C:\Users\Usuario\Documents\Proyectos frontend\CMS-EVARISTO(ASSETS)\mariadb-local\mariadb-11.8.9-winx64\bin\mariadb-admin.exe" --host=127.0.0.1 --port=3307 --user=root shutdown
```

Usar siempre las opciones largas (`--host=...`): la forma corta `-h127.0.0.1` falla en PowerShell.

## MySQL 8.4 del CMS (3308, servicio MySQL84)

Los tres comandos que cambian el estado del servicio necesitan **PowerShell como administrador**.

```powershell
Get-Service MySQL84 | Select-Object Name, Status, StartType   # estado (no requiere admin)
Start-Service MySQL84                                         # iniciar
Stop-Service MySQL84                                          # detener (es el apagado ordenado de un servicio)
```

Después de iniciar, esperar unos segundos y comprobar el 3308 con `Test-NetConnection`. Si el servicio figura `Running` pero el puerto da `False`, esperar un minuto y repetir.

## Orden recomendado

- **Al empezar a trabajar:** iniciar `MySQL84` (si hace falta) y, solo si el trabajo lee WordPress, el MariaDB del 3307. Comprobar ambos puertos.
- **Al terminar:** apagar primero el MariaDB del 3307 con `shutdown`; el servicio `MySQL84` puede quedar corriendo o detenerse con `Stop-Service`.

## NO tocar

- `MySQL80` (puerto 3306, detenido).
- Laragon.
- El proceso `mysqld.exe` huérfano PID 11864.
- Nunca `Stop-Process` sobre ninguna base de datos.

## MySQL Workbench (clientes; no arrancan ningún servidor)

- **"Evaristo"**: usuario `root`, `127.0.0.1:3308`. Para administración (crear bases o usuarios, `GRANT`). Confirmar con `SELECT @@port, VERSION(), CURRENT_USER();` (tiene que dar `3308`, `8.4.x`, `root@localhost`).
- **"Evaristo CMS (evaristo)"**: usuario `evaristo`, `127.0.0.1:3308`. Para consultar; no tiene permiso para crear bases ni dar privilegios.
- "Local instance MySQL80" y "localhostEpica" apuntan al 3306: NO usarlas para este proyecto.

Para ejecutar varias sentencias juntas: Execute All (`Ctrl+Shift+Enter`, el rayo sin cursor).

## Usuarios de la base del CMS (3308)

| Usuario | Permisos | Uso |
|---|---|---|
| `root` | todos | Administración desde Workbench |
| `evaristo` | `ALL` sobre `evaristo_cms`, `evaristo_cms_shadow` y `evaristo_cms_test` | Prisma (migraciones), CMS, tests con base |
| `evaristo_migracion` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` sobre `evaristo_cms` (sin DDL) | Solo el comando de escritura de la migración. Credenciales en la variable `DATABASE_URL_MIGRACION` del `.env` (nunca en el repo ni en el chat) |

## Claude Code

Los prompts se pegan desde la carpeta `C:\Users\Usuario\Documents\Proyectos frontend`. Claude Code no hace push: lo hace Mariano.
