# Decisiones técnicas

## DT-001 — Sesiones en cookie frente a JWT

Se mantienen sesiones firmadas porque la aplicación es same-origin y empresarial. Cookie `HttpOnly` evita tokens en `localStorage`; CSRF y `auth_version` cubren mutaciones y revocación.

## DT-002 — FastAPI síncrono

SQLAlchemy se usa de forma síncrona de extremo a extremo. Uvicorn ejecuta las rutas normales sin mezclar sesiones async/sync; para la carga esperada reduce complejidad. Trabajos pesados futuros deberán ir a cola.

## DT-003 — Decimal en base y contrato

Medidas usan `Decimal`/`Numeric`. El frontend puede calcular para presentación, pero el snapshot y la persistencia no dependen de floats enviados por el cliente.

## DT-004 — Snapshot doble

Se conserva JSON congelado para reproducir exactamente el documento y `cut_order_items` normalizados para integridad, consultas y evolución.

## DT-005 — Alembic como única creación de esquema

La aplicación no llama `create_all()` ni crea administrador. La migración precede a Uvicorn y falla el despliegue si no puede completarse.

## DT-006 — Excel en navegador

SheetJS se sirve localmente y la vista previa ocurre en el cliente para respuesta inmediata. El servidor vuelve a validar el trabajo completo al guardarlo y audita el origen; el Excel nunca determina directamente una orden.

## DT-007 — PWA online-first

No se cachea `/api/` ni datos empresariales. La PWA mejora instalación y pantalla completa, pero no promete edición offline que pueda causar conflictos o exposición local.

## DT-008 — Impresión manual local

Se utiliza `window.print()` y la impresora predeterminada del PC. No se instala agente de impresión ni se concede impresión silenciosa.

## DT-009 — Docker endurecido

Imagen multi-stage fijada por digest, proceso no root, filesystem de solo lectura y capabilities eliminadas. PostgreSQL persiste solo en volumen.

## DT-010 — Restauración validada antes de destruir

La restauración completa exige confirmación y prueba temporal previa. Se prioriza recuperación comprobable sobre velocidad.

## DT-011 — Evolución desde el prototipo

El esquema inicial es para instalaciones nuevas. La conversión de una base heredada exige un proyecto de migración con datos reales; no se usa `stamp` ni transformación implícita.
