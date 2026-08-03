# Backups automatizados

> Política de copias de seguridad para Confección Central.
> Para una herramienta interna, perder datos es el peor escenario posible. Esto
> intenta que sea muy difícil que pase.

## TL;DR

- **Cuándo**: diario a las 03:00 (hora local del VPS, configurado con `BACKUP_HOUR`).
- **Dónde**: volumen Docker `confeccion_central_confeccion_backups` montado en `/backups` dentro del contenedor.
- **Cuántos**: 30 días de retención (configurable con `BACKUP_RETENTION_DAYS`).
- **Cómo se hacen**: `pg_dump` desde el servicio `backup` (imagen `postgres:17-alpine`), gzip -9, sha256.
- **Cómo se verifican**: gzip integrity check + sha256. Restaura con `scripts/test-restore.sh` antes de producción.

## Comprobación rápida

```bash
# Ver últimos backups
docker exec confeccion_central-backup-1 ls -lh /backups/

# Ver logs del último backup
docker logs --tail 30 confeccion_central-backup-1

# Verificar integridad de un backup concreto
docker exec confeccion_central-backup-1 gzip -t /backups/confeccion_2026-07-30_*.sql.gz
```

## Restaurar un backup

⚠️ **Restaurar sobreescribe la base de datos actual.** Haz un backup adicional antes.

### Probar primero sin tocar la DB real

`scripts/test-restore.sh` carga el backup en una base de datos temporal y
verifica que la migración de Alembic coincide:

```bash
bash scripts/test-restore.sh backups/confeccion_2026-07-30_030000Z.sql.gz
```

Si el script termina con "Restauración temporal verificada", el backup es válido.

### Restaurar de verdad (sobreescribe la DB)

```bash
# Confirmar explícitamente la sobrescritura
RESTORE_CONFIRM=YES bash scripts/restore.sh backups/confeccion_2026-07-30_030000Z.sql.gz
```

El script:
1. Verifica gzip y sha256.
2. Llama a `test-restore.sh` con el mismo archivo.
3. Para la app (para no tener conexiones activas).
4. Cierra conexiones, dropea y recrea la base de datos.
5. Carga el backup.
6. Reinicia la app.

## Si todo se rompe (disaster recovery)

Si pierdes acceso al VPS o la DB queda corrupta:

1. **Levantar un VPS limpio** con Docker.
2. **Crear el volumen de backups** y restaurar desde el último que tengas.
3. **Clonar el repo** y hacer `docker compose up -d`.
4. **Cargar el backup** con `restore.sh`.

## Mejoras futuras (cuando se justifique)

- **Off-site**: rclone sincronizando `/backups` a Backblaze B2 o S3 cada 6h.
  Coste estimado: ~$0.005/GB/mes. Útil si el VPS entero muere.
- **Verificación automática**: cron semanal que coge el último backup y hace
  `test-restore.sh`. Avisa por email/Telegram si falla.
- **Métricas**: número de backups, tamaño total, último backup exitoso expuesto
  en `/api/health` para monitorizar con UptimeRobot.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `BACKUP_DIR` | `/backups` | Carpeta dentro del contenedor |
| `BACKUP_RETENTION_DAYS` | `30` | Días que se conservan los archivos |
| `BACKUP_HOUR` | `3` | Hora local del VPS a la que se hace el backup diario |

Los archivos dentro del contenedor se nombran
`confeccion_YYYY-MM-DD_HHMMSSZ.sql.gz` + `.sha256` (mismo nombre con extensión extra).
