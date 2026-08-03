#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Uso: RESTORE_CONFIRM=YES $0 backups/archivo.sql.gz" >&2
  exit 2
fi
if [ "${RESTORE_CONFIRM:-}" != "YES" ]; then
  echo "Restauración cancelada. Exporte RESTORE_CONFIRM=YES para confirmar." >&2
  exit 2
fi

FILE=$1
DB_USER=${POSTGRES_USER:-confeccion}
DB_NAME=${POSTGRES_DB:-confeccion}
if [ ! -f "$FILE" ]; then
  echo "No existe: $FILE" >&2
  exit 2
fi

gzip -t "$FILE"
if [ -f "${FILE}.sha256" ]; then
  sha256sum -c "${FILE}.sha256"
fi

"$(dirname "$0")/test-restore.sh" "$FILE"

APP_STOPPED=0
cleanup() {
  if [ "$APP_STOPPED" -eq 1 ]; then docker compose start app >/dev/null; fi
}
trap cleanup EXIT INT TERM

docker compose stop app
APP_STOPPED=1
docker compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"
gzip -dc "$FILE" | docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
docker compose start app
APP_STOPPED=0
trap - EXIT INT TERM

echo "Restauración finalizada y aplicación reiniciada."
