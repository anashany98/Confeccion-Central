#!/bin/sh
# backup-cron.sh - Backup diario de PostgreSQL ejecutÃ¡ndose dentro de un contenedor.
# ConexiÃ³n directa a la base de datos (no usa docker compose exec).
# RetenciÃ³n: borra archivos con mÃ¡s de BACKUP_RETENTION_DAYS de antigÃ¼edad.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_HOST="${PGHOST:-db}"
DB_USER="${PGUSER:-confeccion}"
DB_NAME="${PGDATABASE:-confeccion}"
TARGET_HOUR="${BACKUP_HOUR:-3}"  # hora local a la que se hace el backup diario

mkdir -p "$BACKUP_DIR"

run_backup() {
  local stamp
  stamp=$(date -u +%Y-%m-%d_%H%M%SZ)
  local file="${BACKUP_DIR}/confeccion_${stamp}.sql.gz"
  local tmp="${file}.partial"

  echo "[$(date -Iseconds)] Iniciando backup â†’ $file"
  if ! pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
      --format=plain --no-owner --no-acl \
      | gzip -9 > "$tmp"; then
    echo "[$(date -Iseconds)] ERROR: pg_dump fallÃ³" >&2
    rm -f "$tmp"
    return 1
  fi

  if ! gzip -t "$tmp"; then
    echo "[$(date -Iseconds)] ERROR: verificaciÃ³n gzip fallÃ³" >&2
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$file"
  sha256sum "$file" > "${file}.sha256"
  local size
  size=$(du -h "$file" | cut -f1)
  echo "[$(date -Iseconds)] OK: $file ($size)"

  # Limpieza por antigÃ¼edad
  find "$BACKUP_DIR" -type f \
    \( -name 'confeccion_*.sql.gz' -o -name 'confeccion_*.sql.gz.sha256' \) \
    -mtime "+$RETENTION_DAYS" -delete

  local count
  count=$(ls "$BACKUP_DIR"/confeccion_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  echo "[$(date -Iseconds)] Backups en disco: $count (retenciÃ³n: ${RETENTION_DAYS} dÃ­as)"
}

# Backup inicial al arrancar (para tener uno tras cada deploy).
run_backup || echo "[$(date -Iseconds)] Backup inicial fallÃ³ (continÃºa igualmente)" >&2

# Bucle diario: calcula horas hasta TARGET_HOUR local y duerme.
while true; do
  NOW_HOUR=$(date +%H)
  HOURS_UNTIL=$(( (TARGET_HOUR - NOW_HOUR + 24) % 24 ))
  if [ "$HOURS_UNTIL" -eq 0 ]; then HOURS_UNTIL=24; fi
  SLEEP_SECS=$(( HOURS_UNTIL * 3600 ))
  echo "[$(date -Iseconds)] PrÃ³ximo backup en ${HOURS_UNTIL} h"
  sleep "$SLEEP_SECS"
  run_backup || echo "[$(date -Iseconds)] Backup programado fallÃ³ (siguiente a las ${TARGET_HOUR}:00)" >&2
done
