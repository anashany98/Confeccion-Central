# Resultados de pruebas y verificaciones

Ejecución: 29 de julio de 2026, entorno aislado Windows + Docker Desktop, imagen Linux y PostgreSQL 17.

## Automatizadas

| Comprobación | Resultado |
|---|---|
| `pytest` | 13 passed |
| Cobertura | 81%, umbral 75% |
| Pruebas frontend Node | 5 passed |
| Black | passed |
| Ruff | passed |
| mypy | success, 10 archivos |
| Bandit | sin hallazgos |
| pip-audit | sin vulnerabilidades conocidas |
| pip check | sin dependencias rotas |
| ESLint | passed |
| Prettier | passed |
| npm audit | 0 vulnerabilidades |
| Alembic upgrade/current/check | passed |

Detalle de cobertura:

| Módulo | Cobertura |
|---|---:|
| `app/config.py` | 83% |
| `app/database.py` | 91% |
| `app/history.py` | 82% |
| `app/main.py` | 81% |
| `app/schemas.py` | 86% |
| `app/security.py` | 77% |
| Total | 81% |

`app/cli.py` aparece al 0% en la suite HTTP, pero el comando administrativo se ejecutó dos veces contra PostgreSQL: creación correcta y segunda ejecución idempotente.

Artefactos: `coverage.xml`, `htmlcov/index.html` y `artifacts/screenshots/puesto-corte.png`.

## Integración PostgreSQL real

`scripts/verify_deployment.py` comprobó:

- login de oficina y corte;
- creación/edición de trabajo;
- conflicto optimista;
- snapshot falsificado rechazado con 422;
- trabajo bloqueado con 423;
- corte sin acceso a trabajos/edición (403);
- DTO de corte sin costes ni cliente;
- salto directo a finalizada rechazado (409);
- impresión y reimpresión;
- recepción y finalización válidas;
- ocho órdenes concurrentes en trabajos distintos, todas HTTP 201 y numeración única.

El identificador persistente comprobado fue `def3bd3e-90c4-4eb8-a8b7-e6bd9b8adf3d`. Tras reiniciar API y base siguió accesible.

## Docker y restauración

- `docker compose build`: correcto.
- app y db: healthy.
- migración al arranque: correcta.
- volumen persistente tras reinicio: correcto.
- backup gzip + SHA-256: correcto.
- restauración temporal: correcta.
- restauración completa destructiva del entorno de prueba: correcta.
- healthchecks y dato persistente tras restaurar: correctos.

## Seguridad de imágenes

Trivy encontró inicialmente 35 vulnerabilidades HIGH/CRITICAL en la base anterior. Tras cambiar a Python 3.12.13 sobre Debian 12.15 fijado por digest, el escaneo final reportó 0 HIGH/CRITICAL en sistema operativo y Python. Docker Scout no pudo ejecutarse sin autenticación; Trivy fue la comprobación efectiva.

## Navegador/PWA

Se ejecutó el flujo sobre la imagen final en el navegador integrado:

- login administrativo;
- nuevo trabajo;
- carga real de `importacion_mixta.xlsx`;
- 4 filas en vista previa, 2 válidas y 2 con causa;
- celdas combinadas expandidas y duplicado detectado;
- importación real de solo 2 filas válidas;
- logout y limpieza del estado empresarial;
- login de corte;
- pantalla única sin navegación administrativa, costes ni edición;
- siguiente orden y botones grandes visibles;
- apertura del flujo de impresión.

El entorno automatizado invocó el diálogo pero no emitió `afterprint`, por lo que ese clic no creó un evento. La API de impresión/reimpresión sí fue comprobada en integración. La aceptación física de Edge/Chrome, driver, márgenes y papel A4 queda como prueba obligatoria en el PC de corte. El CLI de Playwright disponible no pudo lanzarse; se usó el control Playwright del navegador integrado.

## Advertencias no bloqueantes

- Starlette avisa de que el transporte de `TestClient` basado en httpx está deprecado; afecta a la herramienta de test futura, no al servidor.
- No se realizó una prueba con impresora física ni una auditoría de carga sostenida.
