#!/bin/sh
# backup-cron.sh - Backup diario de PostgreSQL ejecutándose dentro de un contenedor.
# Conexión directa a la base de datos (no usa docker compose exec).
# Retención: borra archivos con más de BACKUP_RETENTION_DAYS de antigüedad.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_HOST="${PGHOST:-db}"
DB_USER="${PGUSER:-confeccion}"
DB_NAME="${PGDATABASE:-confeccion}"
TARGET_HOUR="${BACKUP_HOUR:-3}"  # hora local a la que se hace el backup diario

mkdir -p "$BACKUP_DIR"

wait_for_db() {
  # Tras un reinicio del demonio de Docker (p. ej. al encender el equipo),
  # depends_on no se reevalúa y PostgreSQL puede arrancar más tarde que
  # este contenedor. Se reintenta hasta 5 minutos antes de cada backup.
  local tries=0
  while [ "$tries" -lt 30 ]; do
    if pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 10
  done
  return 1
}

run_backup() {
  local stamp
  stamp=$(date -u +%Y-%m-%d_%H%M%SZ)
  local file="${BACKUP_DIR}/confeccion_${stamp}.sql.gz"
  local tmp="${file}.partial"
  local raw="${file}.sql.partial"

  echo "[$(date -Iseconds)] Iniciando backup → $file"
  # El volcado se escribe SIN comprimir para poder comprobar el código de
  # salida real de pg_dump: en una tubería `pg_dump | gzip`, sh solo reporta
  # el estado del último comando (gzip), que siempre termina 0 aunque el
  # volcado haya fallado. Así se generaban backups vacíos "válidos".
  if ! pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
      --format=plain --no-owner --no-acl > "$raw"; then
    echo "[$(date -Iseconds)] ERROR: pg_dump falló" >&2
    rm -f "$raw"
    return 1
  fi
  # Un volcado válido siempre contiene la cabecera de pg_dump.
  if ! head -n 20 "$raw" | grep -q "PostgreSQL database dump"; then
    echo "[$(date -Iseconds)] ERROR: el volcado no tiene la cabecera de pg_dump" >&2
    rm -f "$raw"
    return 1
  fi
  if ! gzip -9 < "$raw" > "$tmp"; then
    echo "[$(date -Iseconds)] ERROR: compresión gzip falló" >&2
    rm -f "$raw" "$tmp"
    return 1
  fi
  rm -f "$raw"
  if ! gzip -t "$tmp"; then
    echo "[$(date -Iseconds)] ERROR: verificación gzip falló" >&2
    rm -f "$tmp"
    return 1
  fi

  mv "$tmp" "$file"
  sha256sum "$file" > "${file}.sha256"
  local size
  size=$(du -h "$file" | cut -f1)
  echo "[$(date -Iseconds)] OK: $file ($size)"

  # Limpieza por antigüedad
  find "$BACKUP_DIR" -type f \
    \( -name 'confeccion_*.sql.gz' -o -name 'confeccion_*.sql.gz.sha256' \) \
    -mtime "+$RETENTION_DAYS" -delete

  local count
  count=$(ls "$BACKUP_DIR"/confeccion_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
  echo "[$(date -Iseconds)] Backups en disco: $count (retención: ${RETENTION_DAYS} días)"
}

# Backup inicial al arrancar (para tener uno tras cada deploy), esperando a la BD.
if wait_for_db; then
  run_backup || echo "[$(date -Iseconds)] Backup inicial falló (continúa igualmente)" >&2
else
  echo "[$(date -Iseconds)] ERROR: BD no disponible tras 5 minutos; backup inicial omitido" >&2
fi

# Bucle diario: duerme hasta la próxima hora exacta TARGET_HOUR:00:00 local
# (antes se calculaba solo con horas enteras y el backup se desplazaba cada
# día según el minuto de arranque del contenedor).
while true; do
  h=$(date +%H); m=$(date +%M); s=$(date +%S)
  # Quitar ceros iniciales para que sh no interprete "08"/"09" como octal.
  h=${h#0}; m=${m#0}; s=${s#0}
  now_secs=$((h * 3600 + m * 60 + s))
  target_secs=$((TARGET_HOUR * 3600))
  delay=$(( (target_secs - now_secs + 86400) % 86400 ))
  if [ "$delay" -eq 0 ]; then delay=86400; fi
  echo "[$(date -Iseconds)] Próximo backup en $((delay / 3600)) h $(((delay % 3600) / 60)) min"
  sleep "$delay"
  if wait_for_db; then
    run_backup || echo "[$(date -Iseconds)] Backup programado falló (siguiente a las ${TARGET_HOUR}:00)" >&2
  else
    echo "[$(date -Iseconds)] ERROR: BD no disponible; backup programado omitido" >&2
  fi
done
