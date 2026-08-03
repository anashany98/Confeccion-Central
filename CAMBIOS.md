# Cambios aplicados

Fecha de cierre técnico: 29 de julio de 2026.

## Seguridad y configuración

- Configuración tipada y validada en `app/config.py`.
- Producción obliga a usar PostgreSQL, secreto de sesión de al menos 32 caracteres y hosts permitidos explícitos.
- Eliminados los secretos de reserva y la creación automática de administrador.
- Sesiones firmadas en cookie `HttpOnly`, `SameSite=Lax` y `Secure` configurable; revocación por `auth_version` al cambiar contraseña o desactivar usuario.
- Token CSRF por sesión y cabecera `X-CSRF-Token` en todas las mutaciones autenticadas.
- Limitación de intentos de acceso, bloqueo temporal y auditoría de accesos correctos/fallidos.
- Cabeceras CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, protección de frame y HSTS en HTTPS.
- `TrustedHostMiddleware`, identificador de petición y límite de tamaño de petición.
- Swagger/OpenAPI desactivado por defecto en producción.

## Roles y permisos

- Catálogo único en `app/permissions.py` con 15 permisos granulares.
- Verificación obligatoria en la API; la ocultación de controles en el frontend es solo una segunda capa.
- El DTO del operario excluye cliente, costes, versiones e información administrativa.
- Permisos individuales normalizados y validados; el administrador conserva siempre el conjunto completo.

## Base de datos y concurrencia

- Alembic añadido y configurado; revisión inicial `d4121985941e`.
- Eliminado `create_all()` del arranque de producción.
- Nuevas tablas normalizadas: habitaciones, ítems congelados de orden, intentos de acceso y documentos.
- Medidas almacenadas como `Numeric`/`Decimal`, con claves foráneas, índices, restricciones y timestamps con zona horaria.
- Numeración de órdenes protegida por bloqueo asesor de PostgreSQL.
- Bloqueo de fila y control optimista mediante `expected_job_version`.
- Borrado lógico y restauración de trabajos.

## Trabajos, órdenes y auditoría

- Snapshot de orden construido exclusivamente a partir del trabajo persistido.
- Trabajo bloqueado al emitir la orden; ediciones posteriores devuelven HTTP 423.
- Snapshot JSON e ítems de orden independientes, inalterables por la API normal.
- Revisiones numeradas; una nueva revisión deja obsoleta la anterior.
- Reapertura y cancelación exigen permiso y motivo; no se revierte una orden en proceso/finalizada.
- Máquina de estados validada en servidor.
- Auditoría enriquecida con usuario, acción, entidad, antes/después, campo, motivo, IP, agente y request ID.
- Registro diferenciado de impresión y reimpresión.

## Excel, frontend y PWA

- SheetJS 0.20.3 fijado y servido localmente; sin dependencia de CDN durante el uso.
- Importación con asignación de columnas, encabezados español/inglés, coma/punto decimal, sufijos m/cm/mm, `.xlsx`/`.xls`, hojas y celdas combinadas.
- Vista previa con errores por fila; duplicados y filas incompletas se omiten y se informa el motivo.
- Importaciones auditadas con nombre de archivo/hoja y recuentos.
- Datos empresariales retirados de `localStorage`; al salir se limpia el estado sensible en memoria.
- Conflictos de versión ya no se sobrescriben silenciosamente.
- Pantalla de corte reducida a órdenes, grandes acciones y datos imprescindibles.
- CSS de impresión A4 con control de saltos y filas indivisibles.
- Service worker v2: la API nunca se almacena en caché y los estáticos usan actualización por red.

## Docker, operación y copias

- Imagen multi-stage fijada por digest, proceso no root UID 10001, filesystem de solo lectura, `tmpfs`, capabilities eliminadas y `no-new-privileges`.
- PostgreSQL 17 Alpine fijado por digest, volumen persistente y healthcheck.
- API con healthcheck real que consulta la base de datos.
- Migraciones ejecutadas antes de iniciar Uvicorn.
- CLI idempotente `python -m app.cli create-admin`.
- Backup comprimido, checksum SHA-256, retención y archivo parcial atómico.
- Restauración destructiva exige `RESTORE_CONFIRM=YES` y realiza antes una restauración temporal.
- Script de verificación integral `scripts/verify_deployment.py`.

## Pruebas y calidad

- 13 pruebas backend de autenticación, CSRF, configuración, documentación desactivada, permisos, trabajos, conflictos, importación, auditoría, snapshot, estados, impresión/reimpresión y revocación.
- 5 pruebas frontend de PWA, recursos locales, no persistencia sensible y reglas de impresión.
- Cobertura total: 81% (umbral 75%).
- Black, Ruff, mypy, Bandit, pip-audit, ESLint, Prettier y npm audit configurados y ejecutados.
- Flujo PostgreSQL real, ocho creaciones concurrentes, reinicio, persistencia, backup, restauración temporal y restauración completa ejecutados.

Los resultados exactos, incluidos los límites de la prueba de impresión local, constan en `docs/RESULTADOS_PRUEBAS.md`.

## Rediseño visual iOS

- Interfaz renovada con una dirección visual inspirada en iOS: superficies translúcidas, tipografía de sistema, jerarquía más limpia y controles táctiles redondeados.
- Navegación, flujo de trabajo, tablas, formularios, estados y diálogos adoptan un lenguaje visual común con foco accesible y contraste operativo.
- Puesto de corte reforzado con una tarjeta prioritaria azul, métricas muy legibles y botones grandes para pantalla táctil, Edge, Chrome y sesiones RDP.
- Se conserva el diseño de impresión A4: las capas decorativas, sombras y fondos no se trasladan al documento impreso.

## Refinamiento visual limpio

- Se redujo la densidad visual sin eliminar campos ni acciones: el flujo muestra solo su información esencial, los formularios ganan respiración y las acciones secundarias quedan en segundo plano.
- Los indicadores se agrupan como una única franja de resumen y las tablas dejan de mostrar cada fila como una tarjeta independiente.
- Se eliminó la decoración de fondo para dar prioridad a las medidas, las habitaciones y los estados de producción.
