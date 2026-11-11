#!/usr/bin/env bash
# Prueba que el respaldo de la base se puede restaurar (docs/guia-despliegue.md, «Respaldos»). Lo corre evaristo-respaldo.service como
# root justo después de respaldar.sh, de madrugada, cuando nadie edita.
#
#   1) Carga el respaldo (el más nuevo, o el que se pase como argumento) en una base aparte, PRUEBA (por defecto <BASE>_restauracion),
#      creada de cero con la misma intercalación que la real.
#   2) La compara con la base original, tabla por tabla: las mismas tablas, la misma cantidad de filas y el mismo CHECKSUM TABLE.
#      Se salta `sesiones`, que cambia con cada ingreso al panel.
#   3) Borra la base de prueba (también si algo falla).
# La base original solo se lee. Código 0: el respaldo restaura bien; 1: algo falló (lo dice).
#
# Variables: las mismas de respaldar.sh (BASE, DESTINO, CREDENCIALES, MYSQL_BIN) y PRUEBA. El usuario de CREDENCIALES necesita SELECT
# sobre BASE y ALL sobre PRUEBA (ver despliegue/usuarios-mysql.sql).
set -euo pipefail
umask 077

BASE="${BASE:-evaristo_cms}"
DESTINO="${DESTINO:-/var/backups/evaristo}"
CREDENCIALES="${CREDENCIALES:-/etc/evaristo/respaldo.cnf}"
PRUEBA="${PRUEBA:-${BASE}_restauracion}"
BIN="${MYSQL_BIN:+$MYSQL_BIN/}"
VOLATILES=" sesiones "

fallar() {
  echo "FALLÓ: $*" >&2
  exit 1
}

[[ "$BASE" =~ ^[A-Za-z0-9_]+$ && "$PRUEBA" =~ ^[A-Za-z0-9_]+$ ]] || fallar "nombres de base inválidos: $BASE, $PRUEBA"
[ "$PRUEBA" != "$BASE" ] || fallar "la base de prueba no puede ser la misma que la original"
[[ "$PRUEBA" == *_restauracion ]] || fallar "la base de prueba tiene que terminar en _restauracion (se borra al final): $PRUEBA"
[ -r "$CREDENCIALES" ] || fallar "no se puede leer el archivo de credenciales $CREDENCIALES"

archivo="${1:-$(ls -1t "$DESTINO"/base/"$BASE"-*.sql.gz 2>/dev/null | head -n 1 || true)}"
[ -n "$archivo" ] && [ -r "$archivo" ] || fallar "no hay respaldo para probar en $DESTINO/base"
echo "Respaldo: $archivo"

sql() { "${BIN}mysql" --defaults-extra-file="$CREDENCIALES" --default-character-set=utf8mb4 -N -B "$@"; }
borrar_prueba() { sql -e "DROP DATABASE IF EXISTS \`$PRUEBA\`" || true; }
trap borrar_prueba EXIT

intercalacion="$(sql -e "SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$BASE'")"
[ -n "$intercalacion" ] || fallar "no existe la base $BASE"
sql -e "DROP DATABASE IF EXISTS \`$PRUEBA\`; CREATE DATABASE \`$PRUEBA\` CHARACTER SET utf8mb4 COLLATE $intercalacion"

inicio=$SECONDS
gzip -dc "$archivo" | sql "$PRUEBA" || fallar "la carga del respaldo en $PRUEBA dio error"
echo "Cargado en $PRUEBA en $((SECONDS - inicio)) s."

tablas() { sql -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$1' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"; }
originales="$(tablas "$BASE")"
restauradas="$(tablas "$PRUEBA")"
[ "$originales" = "$restauradas" ] || fallar "las tablas no coinciden: $(diff <(echo "$originales") <(echo "$restauradas") | tr '\n' ' ')"

diferencias=0
filas_total=0
while IFS= read -r t; do
  [[ "$VOLATILES" == *" $t "* ]] && continue
  n_orig="$(sql -e "SELECT COUNT(*) FROM \`$BASE\`.\`$t\`")"
  n_rest="$(sql -e "SELECT COUNT(*) FROM \`$PRUEBA\`.\`$t\`")"
  c_orig="$(sql -e "CHECKSUM TABLE \`$BASE\`.\`$t\`" | cut -f2)"
  c_rest="$(sql -e "CHECKSUM TABLE \`$PRUEBA\`.\`$t\`" | cut -f2)"
  filas_total=$((filas_total + n_rest))
  if [ "$n_orig" != "$n_rest" ] || [ "$c_orig" != "$c_rest" ]; then
    echo "  DISTINTA  $t: $n_orig filas en $BASE, $n_rest en la restauración (checksum $c_orig / $c_rest)"
    diferencias=$((diferencias + 1))
  fi
done <<< "$originales"

cantidad="$(echo "$originales" | wc -l | tr -d ' ')"
if [ "$diferencias" -gt 0 ]; then
  fallar "$diferencias tabla(s) distintas. Si alguien editó entre el respaldo y la prueba, repetir: respaldar.sh y después este script."
fi
echo "Restauración probada: $cantidad tablas iguales ($filas_total filas; sin contar: $VOLATILES)."
