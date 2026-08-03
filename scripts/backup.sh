#!/usr/bin/env sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-./backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}
DB_USER=${POSTGRES_USER:-confeccion}
DB_NAME=${POSTGRES_DB:-confeccion}
STAMP=$(date -u +%Y-%m-%d_%H%M%SZ)
FILE="${BACKUP_DIR}/confeccion_${STAMP}.sql.gz"
TMP="${FILE}.partial"

mkdir -p "$BACKUP_DIR"
trap 'rm -f "$TMP"' EXIT INT TERM

docker compose exec -T db pg_dump \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip -9 > "$TMP"

gzip -t "$TMP"
mv "$TMP" "$FILE"
trap - EXIT INT TERM
sha256sum "$FILE" > "${FILE}.sha256"

find "$BACKUP_DIR" -type f \( -name 'confeccion_*.sql.gz' -o -name 'confeccion_*.sql.gz.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

echo "Copia verificada: $FILE"
echo "Checksum: ${FILE}.sha256"
