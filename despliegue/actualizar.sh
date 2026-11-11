#!/usr/bin/env bash
# Actualiza el sitio en el servidor con lo último de main (docs/guia-despliegue.md, «Actualizar el sitio»). Se corre con sudo.
#
#   1) Respalda la base antes de tocar nada (respaldar.sh).
#   2) Trae los cambios (solo avance rápido: si alguien tocó algo a mano en el servidor, se corta) e instala las dependencias.
#   3) Si hay migraciones de Prisma nuevas, SE CORTA sin reiniciar: se aplican a mano, con el usuario de estructura (paso 10 de la guía).
#   4) Compila el sitio y el panel, reinicia el servicio y comprueba /api/salud.
# Si algo falla antes del paso 4, el sitio sigue funcionando con lo que tenía (el servicio no se reinicia).
set -euo pipefail

APP="${APP:-/srv/evaristo/app}"
USUARIO="${USUARIO:-evaristo}"
como() { sudo -u "$USUARIO" -H "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Correlo con sudo." >&2; exit 1; }
cd "$APP"

echo "== 1) Respaldo previo"
"$APP/despliegue/respaldar.sh"

echo "== 2) Cambios y dependencias"
antes="$(como git rev-parse --short HEAD)"
como git pull --ff-only
despues="$(como git rev-parse --short HEAD)"
echo "De $antes a $despues"
como npm ci
como npm run db:generate

echo "== 3) Migraciones pendientes"
# migrate status sale con código distinto de 0 si hay migraciones sin aplicar (o si no puede leer la base).
if ! como npm run db:estado > /tmp/evaristo-migraciones.txt 2>&1; then
  cat /tmp/evaristo-migraciones.txt
  echo
  echo "Hay migraciones nuevas (o no se pudo leer el estado). NO se reinició nada: el sitio sigue con la versión $antes."
  echo "Aplicarlas a mano según el paso 10 de docs/guia-despliegue.md y después volver a correr este script."
  exit 1
fi

echo "== 4) Compilar y reiniciar"
como npm run build
systemctl restart evaristo
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/salud > /dev/null 2>&1; then
    echo "Listo: el sitio responde con la versión $despues."
    exit 0
  fi
  sleep 1
done
echo "El servicio no responde en /api/salud. Revisar: journalctl -u evaristo -n 50" >&2
exit 1
