# Auditoría inicial de Confección Central

> Diagnóstico congelado antes de modificar el código de producción. Fecha: 29 de julio de 2026.  
> Proyecto original respaldado en `confeccion_central_ORIGINAL_20260729-122648.zip` (SHA-256 `8FA644A188DAA3F5FB3153BE5D09DCCDF5937813CE5D64ABF7B606A94F8BF46F`).

## 1. Resumen ejecutivo

El proyecto original es un **prototipo funcional avanzado**, no una aplicación preparada para producción. Arranca con PostgreSQL y Docker, permite autenticarse, editar trabajos, generar órdenes, mostrar una vista de operario e imprimir desde el navegador. Sin embargo, varios controles empresariales esenciales solo existen en la interfaz o no se aplican en el servidor.

Los cuatro bloqueos principales comprobados son:

1. La API acepta como snapshot de una orden un documento arbitrario enviado por el navegador. Se creó una orden cuyo ancho y coste no coincidían con el trabajo guardado.
2. Un trabajo continúa siendo editable después de crear/aprobar una orden.
3. Las transiciones de estado no están controladas: un operario pudo pasar directamente de `sent` a `completed` y después volver a `received`.
4. La numeración `MAX + 1` no es segura: ocho creaciones concurrentes produjeron cinco respuestas HTTP 500 por restricciones únicas.

También son de prioridad alta la ausencia de Alembic, la creación automática de tablas y administrador al arrancar, secretos de reserva inseguros, ausencia de CSRF y limitación de intentos, auditoría incompleta, datos empresariales persistidos en `localStorage`, permisos demasiado agregados, exposición de costes al operario y un despliegue Docker sin usuario no privilegiado ni healthcheck real.

La prueba inicial disponible pasa (`3 passed`), pero sus tres casos cubren una fracción mínima del sistema y uno de ellos da por válido el salto directo de estado que el flujo empresarial prohíbe.

## 2. Arquitectura detectada

### Inventario

| Área | Contenido real |
|---|---|
| Raíz | `Dockerfile`, `docker-compose.yml`, dependencias, README, `.env.example`, `.dockerignore` |
| Backend | FastAPI síncrono, SQLAlchemy 2, Pydantic, sesiones firmadas Starlette |
| Persistencia | PostgreSQL en Docker; SQLite como reserva local; cinco tablas |
| Frontend | HTML/CSS/JavaScript sin framework; `index.html` contiene 153 KB y gran parte de la lógica |
| Integración Excel | SheetJS 0.18.5 cargado desde CDN y parseo íntegramente en navegador |
| PWA | manifest, service worker y dos iconos válidos (192 y 512 px) |
| Pruebas | `tests/conftest.py` y `tests/test_app.py`; tres pruebas de API |
| Operación | scripts básicos de backup/restauración y script PowerShell para acceso RDP |

### Puntos de entrada

- API y aplicación web: `app.main:app`.
- Contenedor: `uvicorn app.main:app`.
- Frontend: `app/static/index.html`, adaptado al backend por `app/static/central.js`.
- Base de datos: `app/database.py`.
- No existe proceso de migración ni CLI de administración inicial.

### Arquitectura real

```text
Navegador/PWA
  ├─ index.html: estado, cálculos, Excel, croquis e impresión
  ├─ central.js: sesión, sincronización, permisos y órdenes
  └─ localStorage: copia persistente de trabajos
              │
              ▼
FastAPI (main.py monolítico)
  ├─ autenticación por cookie firmada
  ├─ permisos
  ├─ trabajos como JSON completo
  ├─ órdenes con snapshot JSON
  └─ historial/impresiones
              │
              ▼
PostgreSQL
  users · jobs · history_events · cut_orders · print_logs
```

La separación declarada entre habitaciones, medidas, revisiones, cortes, estados, papelera y documentos **no existe en base de datos**. Esos conceptos están embebidos en el JSON del trabajo o se calculan en el navegador.

## 3. Funciones realmente implementadas

- Login, logout y rechazo de usuarios desactivados.
- Roles `admin`, `office` y `cut`, más lista de permisos individuales.
- Alta y modificación de usuarios.
- Listado, alta, edición optimista y borrado lógico de trabajos.
- Habitaciones y medidas dentro del JSON del trabajo.
- Comparación de cambios de proyecto/habitaciones para el historial.
- Importación visual `.xlsx`/`.xls`, CSV y pegado desde portapapeles.
- Detección de encabezados en español/inglés, asignación de columnas y conversión cm/mm/m.
- Creación y consulta de órdenes con snapshot JSON.
- Vista de operario separada, legible y con botones grandes.
- Registro de solicitudes de impresión y recuento de reimpresiones.
- Croquis básico para una o dos hojas.
- PWA instalable básica, sin cachear respuestas `/api`.
- PostgreSQL persistente mediante volumen Docker.

## 4. Funciones incompletas o simuladas

- La aprobación, bloqueo y revisión de trabajos no son controles de servidor.
- La papelera y las versiones viven dentro del documento controlado por el cliente; no hay restauración en API.
- No hay revisión formal de órdenes, reapertura con motivo, orden vigente/obsoleta ni trazabilidad de cancelación.
- La impresión registra que se pidió imprimir, no que la impresora produjo una copia. El navegador no puede confirmar una impresión física.
- La prioridad de operario equivale al orden de creación descendente; no hay prioridad ni vencimiento.
- “Terminadas hoy” cuenta terminadas sin acotar realmente al día.
- La importación no ofrece resultado por fila ni impide duplicados/filas inválidas.
- El uso sin conexión solo conserva el armazón de la aplicación. Excel depende de un CDN y los datos no se pueden operar de forma segura offline.
- No hay documentos, incidencias de corte, papelera persistente, permisos administrables como entidades, ni historial de accesos fallidos.

## 5. Errores críticos

### AU-001 — BLOQUEANTE — Snapshot de orden manipulable

- **Archivo/línea:** `app/main.py:441`, `app/schemas.py:44-45`.
- **Problema:** la API prefiere `payload.snapshot` sobre el estado guardado.
- **Impacto:** una llamada manual puede producir una orden “aprobada” con medidas o costes inventados.
- **Reproducción:** guardar el trabajo con ancho A y enviar `POST /api/jobs/{id}/orders` con ancho B; la respuesta 201 y el GET posterior conservan B.
- **Solución:** construir siempre el snapshot desde la base de datos, validar la versión esperada dentro de la misma transacción y no aceptar el snapshot del cliente.

### AU-002 — BLOQUEANTE — No se bloquean las medidas aprobadas

- **Archivo/línea:** `app/main.py:289-354`, `app/main.py:431-481`.
- **Problema:** crear una orden solo cambia `job.status`; `save_job` no comprueba ese estado.
- **Impacto:** la interfaz muestra un documento aprobado mientras el trabajo fuente puede seguir cambiando sin reapertura ni motivo.
- **Reproducción:** crear una orden y ejecutar inmediatamente `PUT /api/jobs/{id}` con otra medida; devuelve 200.
- **Solución:** campo de bloqueo, rechazo HTTP 423, reapertura privilegiada con motivo y nueva revisión.

### AU-003 — BLOQUEANTE — Máquina de estados inexistente

- **Archivo/línea:** `app/main.py:515-559`, `app/schemas.py:48-49`.
- **Problema:** cualquier estado permitido por el esquema se aplica desde cualquier estado anterior.
- **Impacto:** se omiten recepción y proceso, se reabren órdenes finalizadas y los timestamps dejan de representar el flujo real.
- **Reproducción:** como operario, cambiar `sent → completed → received`; ambas llamadas devuelven 200.
- **Solución:** tabla central de transiciones, permisos por transición, motivos obligatorios para cancelación/reapertura y estados terminales irreversibles salvo procedimiento administrativo.

### AU-004 — CRÍTICO — Numeración y revisión con condición de carrera

- **Archivo/línea:** `app/main.py:417-428`, `app/main.py:454-466`.
- **Problema:** número y revisión se calculan con `MAX + 1` sin bloqueo.
- **Impacto:** errores 500 y órdenes parcialmente competidoras en uso concurrente.
- **Reproducción:** ocho POST concurrentes sobre el mismo trabajo produjeron 3 respuestas 201 y 5 respuestas 500 (`UniqueViolation`).
- **Solución:** contador transaccional/bloqueo asesor de PostgreSQL, bloqueo de fila para revisión y traducción segura de conflictos.

### AU-005 — CRÍTICO — Esquema creado y alterado al arrancar

- **Archivo/línea:** `app/main.py:123-147`.
- **Problema:** `create_all` y un `ALTER TABLE` manual sustituyen a migraciones.
- **Impacto:** despliegues no reproducibles, cambios no reversibles y riesgo de divergencia entre entornos.
- **Reproducción:** no existen `alembic.ini` ni revisiones; el lifespan modifica la base al importar/arrancar.
- **Solución:** Alembic, revisión inicial, `alembic upgrade head` antes de servir y prohibir `create_all` en producción.

## 6. Riesgos de seguridad

### AU-006 — CRÍTICO — Secretos y administrador de reserva

- **Archivo/línea:** `app/main.py:123-131`, `app/main.py:150-157`, `.env.example`.
- **Problema:** contraseña inicial y clave de sesión conocidas si faltan variables.
- **Impacto:** apropiación de cuenta administrativa o falsificación de sesión por mala configuración.
- **Reproducción:** arrancar sin `ADMIN_PASSWORD`/`SESSION_SECRET`; se aceptan los valores codificados.
- **Solución:** validación obligatoria en producción, eliminar valores de reserva y CLI explícita e idempotente para el primer administrador.

### AU-007 — ALTO — Ausencia de CSRF

- **Archivo/línea:** todos los POST/PUT/PATCH/DELETE de `app/main.py`; cookie en `app/main.py:150-158`.
- **Problema:** autenticación basada en cookie sin token CSRF.
- **Impacto:** un sitio externo puede intentar acciones con la sesión de un usuario.
- **Reproducción:** las mutaciones aceptan cookie válida sin cabecera ni token adicional.
- **Solución:** token CSRF ligado a sesión para métodos mutadores, conservar `SameSite=Lax`, `Secure` y origen/host controlado.

### AU-008 — ALTO — Sin limitación ni auditoría de login

- **Archivo/línea:** `app/main.py:198-206`.
- **Problema:** intentos ilimitados; los fallos no dejan evento.
- **Impacto:** fuerza bruta sin trazabilidad.
- **Reproducción:** repetir credenciales erróneas; siempre 401, sin bloqueo ni registro.
- **Solución:** contador/ventana por usuario e IP, bloqueo temporal y auditoría sin almacenar contraseñas.

### AU-009 — ALTO — Datos sensibles en `localStorage`

- **Archivo/línea:** `app/static/index.html:464-547`, `app/static/index.html:825`, `app/static/index.html:1149`; logout `app/static/central.js:195-200`.
- **Problema:** trabajos completos y costes sobreviven al logout en un equipo compartido.
- **Impacto:** el siguiente usuario o un XSS puede recuperar información empresarial.
- **Reproducción:** abrir DevTools tras cerrar sesión; las claves siguen presentes.
- **Solución:** estado empresarial solo en servidor/memoria, limpiar claves heredadas y no cachear API.

### AU-010 — ALTO — Operario recibe costes y snapshot completo

- **Archivo/línea:** `app/main.py:502-512`, función `order_payload`.
- **Problema:** el mismo DTO se usa para oficina y corte.
- **Impacto:** exposición innecesaria de costes, cliente y campos administrativos mediante llamada directa.
- **Reproducción:** GET de orden como `cut`; `snapshot.project.priceFabric` está presente.
- **Solución:** DTO específico de operario y allowlist de campos/filas.

### AU-011 — MEDIO — Endurecimiento HTTP insuficiente

- **Archivo/línea:** `app/main.py:150-158`, `Dockerfile:12`.
- **Problema:** sin CSP, HSTS configurable, `nosniff`, frame protection, TrustedHost ni ocultación de `/docs`; proxy headers se confían de forma amplia.
- **Impacto:** mayor superficie para XSS/clickjacking/host-header y mala atribución de IP.
- **Reproducción:** inspeccionar respuesta `/`; no contiene cabeceras de seguridad y `/docs` devuelve 200.
- **Solución:** middleware de cabeceras, hosts/proxies configurables y documentación desactivable en producción.

### AU-012 — MEDIO — Dependencia Excel remota sin SRI

- **Archivo/línea:** `app/static/index.html:392`.
- **Problema:** SheetJS se ejecuta desde CDN sin integridad ni copia local.
- **Impacto:** riesgo de cadena de suministro y fallo de importación sin Internet.
- **Reproducción:** bloquear `cdn.jsdelivr.net`; el diálogo no puede leer Excel.
- **Solución:** servir una versión fijada y auditada desde la propia imagen.

## 7. Problemas de base de datos

### AU-013 — ALTO — Modelo empresarial reducido a JSON

- **Archivo/línea:** `app/models.py:34-49`.
- **Problema:** habitaciones, medidas, versiones, papelera y costes se almacenan en `state_json`.
- **Impacto:** no hay FK, tipos decimales, restricciones, índices ni consultas eficientes sobre esos datos.
- **Reproducción:** inspeccionar PostgreSQL: solo existen cinco tablas.
- **Solución:** evolución gradual a tablas normalizadas para habitaciones/medidas/revisiones; mantener snapshot JSON inmutable para órdenes.

### AU-014 — ALTO — Auditoría eliminable en cascada

- **Archivo/línea:** `app/models.py:55-67`, `app/models.py:72-100`.
- **Problema:** historial, órdenes e impresiones dependen de cascadas destructivas.
- **Impacto:** un borrado físico futuro puede borrar la evidencia.
- **Reproducción:** las FK de PostgreSQL muestran `ON DELETE CASCADE`.
- **Solución:** `RESTRICT`/`SET NULL`, política append-only y permisos DB separados para auditoría.

### AU-015 — ALTO — Floats y validación arbitraria

- **Archivo/línea:** `app/schemas.py:36-45`, cálculos en `app/static/index.html` y `central.js`.
- **Problema:** el backend acepta `dict[str, Any]`; medidas y costes son números binarios del navegador.
- **Impacto:** redondeos inconsistentes y datos imposibles/extraños dentro del documento.
- **Reproducción:** enviar claves o tipos no previstos; Pydantic acepta el diccionario.
- **Solución:** esquema estricto de proyecto/habitación, Decimal serializado como texto decimal y límites empresariales.

### AU-016 — MEDIO — Historial incompleto

- **Archivo/línea:** `app/models.py:55-67`, `app/history.py:36-113`.
- **Problema:** faltan IP, agente, motivo, campo estructurado y eventos globales; más de 40 cambios se colapsan.
- **Impacto:** no permite reconstrucción forense completa.
- **Reproducción:** revisar columnas de `history_events` y realizar una importación grande.
- **Solución:** ampliar evento append-only y conservar detalle por fila con identificador de lote.

### AU-017 — MEDIO — Sin paginación ni consultas acotadas

- **Archivo/línea:** `app/main.py:280-285`, `app/main.py:484-499`.
- **Problema:** trabajos devuelve cada JSON completo y órdenes devuelve toda la historia.
- **Impacto:** latencia y memoria crecientes con cientos/miles de habitaciones.
- **Reproducción:** crear trabajos voluminosos y GET `/api/jobs`.
- **Solución:** resumen paginado, endpoint de detalle, filtros y límites máximos.

## 8. Problemas de permisos

### AU-018 — ALTO — Permisos demasiado agregados y duplicados

- **Archivo/línea:** `app/permissions.py:5-40`, `app/static/central.js:57-63`.
- **Problema:** `jobs_edit` también crea; `orders_create` también aprueba; usuarios y permisos comparten permiso. La matriz está duplicada en JavaScript.
- **Impacto:** no puede aplicarse la matriz solicitada y frontend/backend pueden divergir.
- **Reproducción:** revisar los diez permisos reales frente a los permisos empresariales requeridos.
- **Solución:** catálogo backend único con permisos granulares y endpoint de metadatos para la UI.

### AU-019 — MEDIO — Rol oficina sobredimensionado

- **Archivo/línea:** `app/permissions.py:20-31`.
- **Problema:** oficina obtiene por defecto borrar, aprobar/crear e imprimir.
- **Impacto:** incumple mínimo privilegio y la regla “crear órdenes si tiene permiso”.
- **Reproducción:** login como oficina sin permisos personalizados.
- **Solución:** defaults conservadores y asignación explícita de acciones sensibles.

## 9. Problemas de impresión

### AU-020 — ALTO — Registro no representa una impresión confirmada

- **Archivo/línea:** `app/main.py:562-590`, impresión en `app/static/central.js`; `app/static/index.html:997`.
- **Problema:** el registro se crea antes o independientemente del resultado del diálogo; cancelar también puede contabilizarse.
- **Impacto:** trazabilidad de copias incorrecta.
- **Reproducción:** pulsar imprimir y cancelar el diálogo; el contador aumenta.
- **Solución:** registrar “solicitud/diálogo cerrado” mediante `afterprint`, marcar reimpresión y documentar que el navegador no confirma papel físico.

### AU-021 — MEDIO — Composición y paginado frágiles

- **Archivo/línea:** generador de impresión en `app/static/central.js`, estilos de impresión en `app/static/index.html`.
- **Problema:** `imprimir todo` duplica contenido, usa ventana escrita dinámicamente y no protege todas las filas/croquis ante saltos.
- **Impacto:** páginas repetidas, filas cortadas o desbordes según Edge/Chrome e impresora.
- **Reproducción:** vista previa de una orden extensa.
- **Solución:** plantilla imprimible única, CSS A4 con `break-inside`, pruebas PDF de varias longitudes y cabecera repetida.

## 10. Problemas de despliegue

### AU-022 — ALTO — Contenedor ejecutado como root y sin healthcheck

- **Archivo/línea:** `Dockerfile:1-12`, `docker-compose.yml:1-16`.
- **Problema:** no se crea `USER`; la imagen no declara healthcheck y Compose solo comprueba PostgreSQL.
- **Impacto:** mayor impacto de compromiso y despliegues que parecen sanos aunque API/DB no funcionen juntas.
- **Reproducción:** inspeccionar imagen y `docker compose ps`; app no tiene estado health.
- **Solución:** usuario no root, healthcheck que consulte DB, `read_only`/tmpfs/capabilities y dependencias sanas.

### AU-023 — ALTO — Dependencias y arranque no reproducibles

- **Archivo/línea:** `requirements.txt`, `Dockerfile:7-12`.
- **Problema:** rangos flotantes; el build resolvió versiones distintas del entorno local. No hay migración en arranque.
- **Impacto:** dos despliegues del mismo commit pueden comportarse de forma distinta.
- **Reproducción:** comparar versiones locales con la imagen construida.
- **Solución:** versiones exactas, auditoría, hash/lock cuando proceda y comando de migración.

### AU-024 — MEDIO — Backup/restauración sin garantías

- **Archivo/línea:** `scripts/backup.sh:4-8`, `scripts/restore.sh:14-18`.
- **Problema:** no hay retención, checksum, verificación, copia externa ni restauración temporal; la restauración destruye antes de validar.
- **Impacto:** copia corrupta o error operativo sin recuperación rápida.
- **Reproducción:** revisar scripts; no existe prueba automatizada.
- **Solución:** manifiesto SHA-256, `gzip -t`, retención, test de restauración a DB temporal y documentación/cron.

### AU-025 — MEDIO — Falta operación Coolify/Dokploy

- **Archivo/línea:** `README.md`, `docker-compose.yml`.
- **Problema:** no hay procedimientos de instalación, actualización, rollback, proxy/HTTPS ni creación inicial.
- **Impacto:** despliegue dependiente del conocimiento del autor.
- **Reproducción:** intentar desplegar desde cero solo con README.
- **Solución:** manuales reproducibles y checklist por plataforma.

## 11. Problemas de experiencia de usuario

### AU-026 — ALTO — Importación admite filas defectuosas

- **Archivo/línea:** importador dentro de `app/static/index.html`.
- **Problema:** la vista previa cuenta incidencias, pero no explica cada error ni bloquea duplicados o habitación vacía.
- **Impacto:** medidas defectuosas llegan al trabajo y el usuario no sabe qué corregir.
- **Reproducción:** importar `tests/fixtures/importacion_mixta.xlsx`; prepara cuatro filas, incluida una duplicada y otra sin habitación, indicando solo “1 necesita revisión”.
- **Solución:** resultado por fila con código/motivo, deduplicación configurable y aplicar solo filas válidas.

### AU-027 — MEDIO — Frontend monolítico y responsabilidades duplicadas

- **Archivo/línea:** `app/static/index.html` (1-1163), `app/static/central.js`.
- **Problema:** estado, DOM, cálculos, importación e impresión conviven en un HTML de 153 KB; varios cálculos/permisos están duplicados.
- **Impacto:** regresiones difíciles de aislar y pruebas unitarias casi imposibles.
- **Reproducción:** inventario de funciones y constantes.
- **Solución:** extraer módulos progresivamente sin rediseño visual.

### AU-028 — MEDIO — Croquis insuficiente

- **Archivo/línea:** generador de croquis en `app/static/index.html`.
- **Problema:** representa una/dos hojas, pero no modela apertura central/izquierda/derecha como dato estructurado.
- **Impacto:** interpretación ambigua para corte/confección.
- **Reproducción:** no existe campo de apertura; solo puede escribirse en observaciones.
- **Solución:** campo validado, etiquetas izquierda/derecha y pruebas visuales de las tres aperturas.

### AU-029 — BAJO — PWA sin ciclo de actualización

- **Archivo/línea:** `app/static/sw.js:1-12`.
- **Problema:** caché `v1` manual, cache-first de estáticos y sin aviso de nueva versión.
- **Impacto:** equipos pueden conservar una UI antigua tras desplegar.
- **Reproducción:** actualizar un estático sin cambiar `CACHE`.
- **Solución:** cache versionada por build, aviso/recarga controlada y limpieza al logout.

## 12. Calidad de pruebas

### AU-030 — ALTO — Cobertura insuficiente y comportamiento incorrecto codificado

- **Archivo/línea:** `tests/test_app.py`, `tests/conftest.py`.
- **Problema:** tres pruebas; faltan importación, snapshots, concurrencia, auditoría, backup, persistencia, seguridad y E2E. Una prueba permite finalizar desde `sent`.
- **Impacto:** los defectos bloqueantes no impiden publicar.
- **Reproducción:** `py -3.11 -m pytest -q` devuelve `3 passed`; revisar casos.
- **Solución:** pruebas unitarias/integración/API/E2E y cobertura con umbral.

### Herramientas ejecutadas en la línea base

| Comando | Resultado inicial |
|---|---|
| `py -3.11 -m pytest -q` | 3 passed, 1 warning |
| `py -3.11 -m ruff check app tests` | Sin errores |
| `py -3.11 -m pip_audit -r requirements.txt` | Sin vulnerabilidades conocidas |
| Build Docker | Correcto |
| Compose PostgreSQL + API | Arranca; DB healthy; API sin health propio |
| Prueba concurrente de órdenes | 3×201, 5×500 |
| Playwright CLI | No disponible en el paquete invocado; se usó navegador integrado para la prueba visual |

`pip check` del Python global encontró incompatibilidades de paquetes ajenos al proyecto; no se atribuyen al repositorio y se validará el entorno aislado de la imagen.

## 13. Deuda técnica

- `main.py` y `index.html` concentran demasiadas responsabilidades.
- No existe capa de servicios/transacciones ni repositorios.
- Contratos frontend/backend se basan en JSON arbitrario.
- No existe configuración tipada por entorno.
- No hay formato/lint/tipos/cobertura para todo el proyecto.
- No hay pruebas de componentes ni suite E2E mantenible.
- No existe observabilidad estructurada, request ID ni política de retención.
- No existe estrategia documentada de evolución del JSON hacia tablas normalizadas.

## 14. Prioridades

### P0 — Antes de cualquier producción

1. Snapshot autoritativo, bloqueo y revisiones.
2. Máquina de estados y numeración concurrente.
3. Alembic y bootstrap administrativo explícito.
4. Secretos obligatorios, CSRF, login throttling y DTO de operario.
5. Pruebas de permisos directas, snapshot, estados y concurrencia.

### P1 — Antes del piloto

1. Auditoría ampliada y no destructiva.
2. Importación con errores por fila.
3. Eliminar datos empresariales de `localStorage`.
4. Docker no-root, healthchecks y dependencias fijadas.
5. Backup verificado y restauración temporal.
6. Plantilla de impresión validada en PDF.

### P2 — Evolución planificada

1. Normalizar habitaciones/medidas/revisiones/documentos.
2. Modularizar frontend/backend.
3. Incidencias, prioridad y planificación del puesto de corte.
4. Actualización PWA y capacidades offline cuidadosamente acotadas.
5. Pruebas de carga y observabilidad de producción.

---

Este informe diferencia expresamente código ejecutado, prototipo y ausencia funcional. Los resultados finales, tras las correcciones, se añadirán sin borrar esta fotografía inicial.

## Apéndice — estado después de las correcciones

La fotografía anterior se conserva para que cada riesgo original sea trazable. El estado final verificado el 29 de julio de 2026 es:

| Grupo | Estado final |
|---|---|
| AU-001 snapshot | Corregido: el cliente ya no envía el documento de orden; el servidor congela trabajo e ítems |
| AU-002 bloqueo | Corregido: trabajo bloqueado, API 423 y reapertura administrativa con motivo |
| AU-003 estados | Corregido: transiciones permitidas en servidor |
| AU-004 concurrencia | Corregido: 8/8 órdenes concurrentes creadas con números únicos |
| AU-005/AU-006 migraciones/bootstrap | Corregido: Alembic y CLI idempotente |
| AU-007/AU-008 secretos/CSRF/login | Corregido |
| AU-009/AU-010 permisos/DTO corte | Corregido |
| AU-011 auditoría | Corregido para acciones implementadas, incluidas autenticación e impresión |
| AU-012 localStorage | Corregido: no persiste datos empresariales |
| AU-013 a AU-016 base/transacciones | Corregido mediante tablas normalizadas, Decimal, FK, constraints y locks |
| AU-017 importación | Corregido: vista previa, errores por fila, unidades, duplicados y combinadas |
| AU-018 a AU-021 órdenes/operario/impresión | Corregido en servidor e interfaz; aceptación física de impresión pendiente |
| AU-022/AU-023 Docker/despliegue | Corregido y escaneado |
| AU-024 backup | Corregido y probado con restauración temporal y completa |
| AU-025 a AU-029 PWA/UX/croquis | Correcciones razonables aplicadas; incidencias estructuradas y doble aprobación quedan planificadas |
| AU-030 pruebas | Ampliado a 13 backend + 5 frontend, 81% cobertura e integración PostgreSQL |

No se borró ni reclasificó ningún hallazgo inicial. El detalle de implementación está en `CAMBIOS.md`; los límites restantes en `PENDIENTES.md`; los comandos y resultados ejecutados en `docs/RESULTADOS_PRUEBAS.md`.
