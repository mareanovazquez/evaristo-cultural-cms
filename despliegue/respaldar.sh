#!/usr/bin/env bash
# Respaldo diario del sitio en el servidor (docs/guia-despliegue.md, «Respaldos»). Lo corre evaristo-respaldo.timer como root.
#
#   1) La base: mysqldump con --single-transaction (una foto coherente sin frenar el sitio), comprimido con gzip. Se comprueba que el
#      volcado terminó («-- Dump completed») y que el .gz se puede leer antes de darlo por bueno.
#   2) Las imágenes subidas desde el panel (MEDIA_DIR_SUBIDAS): un .tar.gz. Los originales migrados no cambian y ya tienen tres copias
#      fuera del servidor (Lenovo, backup2 y Drive), así que no se respaldan todos los días.
#   3) Borra los respaldos de más de DIAS días. Nunca borra el que acaba de hacer.
#
# Credenciales: un archivo de opciones de MySQL legible solo por root (CREDENCIALES), nunca en la línea de comandos ni en el repo.
# Variables (con su valor por defecto):
#   BASE=evaristo_cms   DESTINO=/var/backups/evaristo   CREDENCIALES=/etc/evaristo/respaldo.cnf
#   SUBIDAS=/srv/evaristo/datos/subidas   DIAS=14   MYSQL_BIN=(vacío: los del PATH)
set -euo pipefail
umask 077

BASE="${BASE:-evaristo_cms}"
DESTINO="${DESTINO:-/var/backups/evaristo}"
CREDENCIALES="${CREDENCIALES:-/etc/evaristo/respaldo.cnf}"
SUBIDAS="${SUBIDAS:-/srv/evaristo/datos/subidas}"
DIAS="${DIAS:-14}"
BIN="${MYSQL_BIN:+$MYSQL_BIN/}"

fallar() {
  echo "FALLÓ: $*" >&2
  exit 1
}

[[ "$BASE" =~ ^[A-Za-z0-9_]+$ ]] || fallar "nombre de base inválido: $BASE"
[[ "$DIAS" =~ ^[0-9]+$ ]] && ((DIAS >= 1)) || fallar "DIAS tiene que ser un número de 1 o más: $DIAS"
[ -r "$CREDENCIALES" ] || fallar "no se puede leer el archivo de credenciales $CREDENCIALES"

fecha="$(date -u +%Y-%m-%dT%H%M%SZ)"
mkdir -p "$DESTINO/base" "$DESTINO/subidas"

# ---------------------------------------------------------------- 1) la base
final="$DESTINO/base/$BASE-$fecha.sql.gz"
tmp="$DESTINO/base/.$BASE-$fecha.sql"
trap 'rm -f "$tmp" "$tmp.gz"' EXIT

"${BIN}mysqldump" --defaults-extra-file="$CREDENCIALES" \
  --single-transaction --no-tablespaces --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 --result-file="$tmp" "$BASE"

tail -n 1 "$tmp" | grep -q '^-- Dump completed' || fallar "el volcado de $BASE no terminó bien"
gzip -9 "$tmp"
gzip -t "$tmp.gz" || fallar "el .gz del volcado no se puede leer"
mv "$tmp.gz" "$final"
echo "Base: $final ($(du -h "$final" | cut -f1))"

# ---------------------------------------------------------------- 2) las imágenes subidas desde el panel
if [ -d "$SUBIDAS" ]; then
  final_subidas="$DESTINO/subidas/subidas-$fecha.tar.gz"
  # --force-local: que «C:» en una ruta no se tome como otra máquina (solo pasa al probarlo en Windows; en Linux no cambia nada).
  tar --force-local -czf "$final_subidas.part" -C "$SUBIDAS" .
  tar --force-local -tzf "$final_subidas.part" > /dev/null || fallar "el .tar.gz de las subidas no se puede leer"
  mv "$final_subidas.part" "$final_subidas"
  echo "Subidas: $final_subidas ($(du -h "$final_subidas" | cut -f1), $(tar --force-local -tzf "$final_subidas" | grep -vc '/$') archivos)"
else
  echo "Subidas: no existe $SUBIDAS todavía (se crea con la primera imagen subida desde el panel); no hay nada que respaldar."
fi

# ---------------------------------------------------------------- 3) rotación
borrados=$(find "$DESTINO/base" "$DESTINO/subidas" -maxdepth 1 -type f \( -name '*.sql.gz' -o -name '*.tar.gz' \) \
  ! -path "$final" ${final_subidas:+! -path "$final_subidas"} -mtime +"$DIAS" -print -delete | wc -l)
echo "Rotación: $borrados respaldo(s) de más de $DIAS días borrados."
