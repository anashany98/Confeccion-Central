# Manual de copias y restauración

## Qué se copia

`scripts/backup.sh` ejecuta `pg_dump` de PostgreSQL, comprime con gzip, valida el archivo, lo mueve de forma atómica y genera SHA-256. El volumen Docker por sí solo no es una copia.

## Copia manual

```bash
mkdir -p backups
./scripts/backup.sh
ls -lh backups/
sha256sum -c backups/confeccion_FECHA.sql.gz.sha256
```

Variables: `BACKUP_DIR` y `BACKUP_RETENTION_DAYS` (30 días por defecto).

## Programación

Ejemplo diario a las 02:30:

```cron
30 2 * * * cd /opt/confeccion_central && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Conserve al menos:

- 30 copias diarias locales;
- 12 semanales externas;
- una copia antes de cada actualización.

Sincronice `*.sql.gz` y `*.sha256` a un almacenamiento externo cifrado con credenciales de solo escritura cuando sea posible. Restrinja permisos; una copia contiene datos personales y empresariales.

## Prueba no destructiva

```bash
./scripts/test-restore.sh backups/confeccion_FECHA.sql.gz
```

El script crea una base temporal, restaura con `ON_ERROR_STOP`, consulta revisión Alembic y recuentos, y elimina la base aun si falla.

## Restauración completa

```bash
RESTORE_CONFIRM=YES ./scripts/restore.sh backups/confeccion_FECHA.sql.gz
```

El script:

1. verifica gzip y checksum;
2. ejecuta la restauración temporal;
3. detiene `app`;
4. termina conexiones y recrea la base;
5. restaura con parada ante error;
6. reinicia `app`.

Después:

```bash
docker compose ps
curl -fsS http://127.0.0.1:8000/api/health
docker compose exec -T app alembic current
```

Compruebe un trabajo y una orden conocidos. No restaure mientras usuarios escriben.

## Prueba ejecutada en esta auditoría

Se generó `confeccion_2026-07-29_110622Z.sql.gz`, se validó su checksum, se restauró en una base temporal (revisión `d4121985941e`, 3 usuarios y 9 trabajos) y después se ejecutó una restauración completa en el entorno aislado. Tras reiniciar, la API y PostgreSQL quedaron healthy y el trabajo persistente siguió accesible.
