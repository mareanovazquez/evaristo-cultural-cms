#!/usr/bin/env bash
# Deja una copia del último respaldo de la base y del último de las subidas en ~/respaldos-para-bajar de quien lo corre con sudo, para
# bajarlos a la Lenovo con scp (docs/guia-despliegue.md, paso 9, «Copia fuera del servidor»). Los respaldos originales son solo de root.
set -euo pipefail

DESTINO="${DESTINO:-/var/backups/evaristo}"
[ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] || { echo "Correlo con sudo desde tu usuario." >&2; exit 1; }
casa="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
salida="$casa/respaldos-para-bajar"

mkdir -p "$salida"
for patron in "$DESTINO/base/*.sql.gz" "$DESTINO/subidas/*.tar.gz"; do
  ultimo="$(ls -1t $patron 2>/dev/null | head -n 1 || true)"
  [ -n "$ultimo" ] || { echo "No hay respaldos en $(dirname "$patron")"; continue; }
  install -m 600 -o "$SUDO_USER" -g "$SUDO_USER" "$ultimo" "$salida/"
  echo "Listo para bajar: $salida/$(basename "$ultimo") ($(du -h "$ultimo" | cut -f1))"
done
chown "$SUDO_USER:$SUDO_USER" "$salida" && chmod 700 "$salida"
