# Manual de actualización y rollback

## Antes de actualizar

1. Lea `CAMBIOS.md`, `PENDIENTES.md` y las nuevas revisiones de `migrations/`.
2. Anuncie una ventana de mantenimiento.
3. Cree y verifique una copia:

```bash
./scripts/backup.sh
./scripts/test-restore.sh backups/confeccion_FECHA.sql.gz
```

4. Guarde el identificador de la imagen/commit actual:

```bash
git rev-parse HEAD
docker image inspect confeccion-central:2.0.0 --format '{{.Id}}'
```

## Actualización normal

```bash
git fetch --all --prune
git checkout <version-aprobada>
docker compose config
docker compose build --pull
docker compose up -d
docker compose exec -T app alembic current
curl -fsS http://127.0.0.1:8000/api/health
docker compose logs --tail=150 app
```

Ejecute las comprobaciones funcionales de instalación. Las migraciones son automáticas hacia delante, pero deben ensayarse antes con una copia si contienen transformaciones de datos.

## Actualizar desde el prototipo anterior

La migración inicial `d4121985941e` crea un esquema nuevo; no transforma automáticamente las cinco tablas JSON del prototipo. Procedimiento obligatorio:

1. Conservar el ZIP original y un `pg_dump`.
2. Crear un entorno separado con la nueva versión.
3. Preparar un conversor específico usando una muestra anonimizada de la base real.
4. Comparar usuarios, trabajos, habitaciones, órdenes e historial.
5. Obtener aprobación de negocio.
6. Repetir la conversión durante la ventana de mantenimiento.

No ejecute `alembic stamp` para aparentar una migración sin transformar datos.

## Rollback de aplicación

Si la migración fue solo compatible/aditiva:

```bash
git checkout <commit-anterior>
docker compose build
docker compose up -d
```

Si el esquema cambió de forma incompatible, el rollback seguro es restaurar la copia previa:

```bash
RESTORE_CONFIRM=YES ./scripts/restore.sh backups/confeccion_FECHA.sql.gz
```

La restauración detiene la API, valida primero en una base temporal, reemplaza la base y reinicia la aplicación. Documente causa, tiempos y verificación posterior.

## Verificación posterior

- `/api/health` responde base `ok`;
- `alembic current` coincide con la versión;
- login y permisos directos funcionan;
- orden reciente conserva su snapshot;
- impresión y finalización funcionan;
- no hay excepciones nuevas en logs;
- se genera un backup posterior a la actualización.
