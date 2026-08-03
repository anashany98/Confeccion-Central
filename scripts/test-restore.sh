#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Uso: $0 backups/archivo.sql.gz" >&2
  exit 2
fi

FILE=$1
DB_USER=${POSTGRES_USER:-confeccion}
TEMP_DB="confeccion_restore_test_$(date -u +%Y%m%d%H%M%S)"
if [ ! -f "$FILE" ]; then
  echo "No existe: $FILE" >&2
  exit 2
fi

gzip -t "$FILE"
if [ -f "${FILE}.sha256" ]; then sha256sum -c "${FILE}.sha256"; fi

cleanup() {
  docker compose exec -T db dropdb -U "$DB_USER" --if-exists "$TEMP_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose exec -T db createdb -U "$DB_USER" -O "$DB_USER" "$TEMP_DB"
gzip -dc "$FILE" | docker compose exec -T db psql -U "$DB_USER" -d "$TEMP_DB" -v ON_ERROR_STOP=1
docker compose exec -T db psql -U "$DB_USER" -d "$TEMP_DB" -v ON_ERROR_STOP=1 -At \
  -c "SELECT version_num FROM alembic_version;" \
  -c "SELECT count(*) FROM users;" \
  -c "SELECT count(*) FROM jobs;"

echo "Restauración temporal verificada en $TEMP_DB."
