# Cambios aplicados

Fecha de cierre técnico: 29 de julio de 2026.

## Identificación por bloque y planta (México / Caribe) (14 de agosto de 2026)

- La relación de huecos acepta **Bloque** y **Planta** como identificadores de cada hueco, además de la habitación (o en lugar de ella).
- Se activa con el check **«Usar Bloque y Planta»** en los datos del trabajo: por defecto está desactivado y la tabla se mantiene igual que siempre (solo habitación); al activarlo aparecen las columnas Bloque y Planta y el identificador combinado se usa en validación, duplicados, impresos y etiquetas.
- Un hueco se identifica por la combinación `bloque · planta · habitación` (según estén rellenos): sirve para el control de duplicados, la búsqueda, los impresos, el cuadrante de corte, el seguimiento de producción y las etiquetas. El identificador combinado y la cabecera «Identificador» (en vez de «Habitación»/«Nº Hab.») se aplican a **todas** las hojas: relación, confección, cuadrante, tabla de cortes, rieles, producción, etiquetas y la orden impresa de la central.
- Las etiquetas de paño y su código de barras de trazabilidad usan el identificador combinado (p. ej. `CC-<trabajo>-3-2-H1` para bloque 3, planta 2).
- Importación: se detectan y asignan automáticamente columnas «Bloque», «Planta», «Torre», «Nivel» o «Piso» al pegar desde Excel o importar .xlsx; la exportación CSV/XLSX incluye las nuevas columnas.
- Backend: el servidor valida y persiste los campos, los duplicados se calculan sobre el identificador combinado (la misma habitación en bloques distintos ya no es duplicado) y la auditoría registra cambios de bloque/planta.

## Envío directo a la Zebra con agente local (un clic) (13 de agosto de 2026)

- Botón «Enviar a Zebra» en la vista de etiquetas: genera el ZPL y lo envía en un clic a la impresora por red.
- Nuevo script `scripts/zebra_agent.py <IP>`: mini-servicio local (HTTP en 127.0.0.1:8765) que recibe el ZPL de la app y lo reenvía en bruto a la Zebra por el puerto 9100. Deja el agente corriendo en el PC del taller (puede iniciarse con Windows).
- El CSP de la app permite ahora conectar solo a `http://127.0.0.1:8765` y `http://localhost:8765` (el agente local), sin ampliar nada más.
- Verificación end-to-end con impresora simulada en el puerto 9100: el ZPL llega íntegro (2 bloques ^XA/^XZ, códigos de barras ^BC y códigos de trazabilidad).
- Tests estáticos del botón, la función de envío y el agente.

## Etiquetas en formato ZPL nativo (Zebra) (13 de agosto de 2026)

- Botón «ZPL Zebra» en la vista de etiquetas: genera el **código ZPL nativo** (el formato que entiende una impresora de etiquetas Zebra) de todas las etiquetas filtradas, con el tamaño elegido (40×60, 40×50, …).
- Cada etiqueta es un bloque `^XA … ^XZ` con `^PW`/`^LL` del tamaño elegido, `^MTT` (transferencia térmica para la cinta de resina 5095), `^CI28` (UTF-8) y código de barras Code 128 con el comando nativo `^BC` de Zebra más el texto legible debajo.
- El modal permite **copiar** el ZPL o **descargar un archivo .prn** (UTF-8).
- Nuevo script `scripts/send_zpl.py` para enviar el .prn a la impresora por red: `python scripts/send_zpl.py <IP> etiquetas.prn` (puerto 9100, raw). También puede imprimirse desde Windows con la Zebra instalada (ZDesigner).
- Tests: estructura del ZPL (PW/LL/MTT/CI28/BC/escapado de caracteres especiales) y comprobación estática del botón, modal y script.

## Modo de impresión a etiqueta Zebra con tamaños configurables (13 de agosto de 2026)

- Nuevo botón «Imprimir 40 mm» en la vista de etiquetas: imprime una etiqueta por página al tamaño exacto de etiqueta, sin portada ni márgenes, pensado para impresoras de etiquetas con controlador ZDesigner (Zebra ZT231 y similares).
- **Selector de tamaño de etiqueta** en el toolbar: 40×60 (por defecto), 40×50, 40×80, 50×60 y 60×60 mm. Cada tamaño usa su `@page` nombrada (`zebra-40x60`, `zebra-40x50`, …), con ajuste de tipografía para la etiqueta corta de 40×50. La elección se recuerda con el trabajo.
- La impresión A4 de etiquetas sigue disponible como antes («Imprimir etiquetas (A4)»).
- Tests estáticos del modo Zebra (botón, páginas nombradas, una etiqueta por página y selector de tamaños).

## Etiquetas de paños para coser con código de barras de trazabilidad (13 de agosto de 2026)

- Formato de etiqueta rediseñado por completo: ahora se genera **una etiqueta por hoja (paño)** — no una por habitación — para coserla en el tejido.
- Cada etiqueta incluye un **código de barras Code 128B** con el código de trazabilidad `CC-<trabajo>-<habitación>-H<hoja>` (6 primeros caracteres del id del trabajo + habitación normalizada + número de hoja), con el texto del código debajo por si no hay lector.
- El generador de barras es propio (`code128Pattern` en `logic.js`, sin dependencias ni CDN — la app es offline): patrón estándar Code 128B con dígito de control y zona de silencio, renderizado como SVG nítido para impresión.
- La etiqueta muestra obra, número de corte, habitación, medida de corte (ancho × alto), hoja x/y con lado (ÚNICA/IZQ/DER), hueco, fruncido, tela y fecha.
- Estilo de etiqueta cosida: borde negro, compacto, código de barras a lo ancho y tipografía monoespaciada; reglas de impresión ajustadas (3 columnas, alto ~46 mm).
- Tests: patrón Code 128B con checksum verificado para «AB», código real de trazabilidad, y comprobación estática de la etiqueta con barras.

## Añadido de cierre configurable: desplegable 0,06 m / 0,15 m (13 de agosto de 2026)

- El campo «Añadido para cierre (m)» de la vista de confección pasa de valor fijo a un desplegable con 0,06 m y 0,15 m, enlazado a `state.project.closureAdd` (mismo mecanismo que el resto de campos del proyecto).
- El cálculo del panel (`panelWidth`) usa ahora el valor elegido y cae a 0,06 m por defecto si no hay valor (proyectos antiguos).
- La hoja impresa de confección muestra el añadido elegido en lugar del «0,06 m (fijo)».
- Tests: cálculo con 0,06/0,15 y sin valor, y comprobación estática del desplegable y su enlace.

## Margen de 10 cm en el aviso de ancho de tela (13 de agosto de 2026)

- El aviso de ancho de corte ahora salta con un margen de seguridad de 10 cm antes del límite: si el ancho de corte queda a menos de 10 cm del ancho de la tela (o lo supera), se marca la fila y salta la alerta.
- Mensaje diferenciado: «Ancho de corte X m a menos de 10 cm del ancho de tela (Y m)» cuando se acerca, y «Ancho de corte X m excede el ancho de tela (Y m)» cuando lo supera.
- Aplicado en `calcRowFor` (lógica pura) y en `validateAll` (revisión visual); la alerta emergente sigue cubriendo ambos casos. Test nuevo del margen en `logic.test.mjs`.

## Acceso con correo completo como usuario (11 de agosto de 2026)

- El nombre de usuario acepta ahora el correo completo (con `@`): `UserCreate` admite `[a-z0-9._@-]` en lugar de prohibir la `@`, manteniendo el resto de validación (3-80 caracteres, normalización a minúsculas).
- Los usuarios ya creados pueden convertirse a su correo con un `UPDATE` (script `tmp/a_email.sql`, idempotente por username exacto).
- Test nuevo: un usuario creado con correo entra sin problemas por la API.

## Política de contraseñas a 10 caracteres (11 de agosto de 2026)

- El mínimo de contraseña pasa de 12 a 10 caracteres en creación de usuarios, cambio de contraseña y CLI (decisión del negocio; el bloqueo de intentos de acceso se mantiene).

## Aviso y alerta: alto de corte vs ancho de tela (11 de agosto de 2026)

- Nuevo aviso cuando el alto de corte de una habitación supera el ancho de la tela (no cabe en un solo ancho del rollo): «Alto de corte X m no cabe en el ancho de tela (Y m)».
- El aviso aparece en la barra de revisión automática, en el indicador de la fila y en el contador de incidencias (igual que los demás avisos), y dispara una alerta emergente única al detectarlo.
- También se conectó a la revisión visual el aviso preexistente «Ancho de corte excede el ancho de tela» (antes solo vivía en la lógica pura y sus tests); la alerta emergente cubre ahora ambos casos (ancho o alto).
- Ambos se añadieron a `calcRowFor` (lógica pura) con sus tests.

## Trabajos independientes por usuario (11 de agosto de 2026)

- `GET /api/jobs` ahora devuelve solo los trabajos del usuario autenticado (`scope=mine`).
- Nuevo `scope=others` para ver los trabajos de los compañeros (con `created_by` nombre en cada ítem) y `scope=all` exclusivo de administración (`users_manage`).
- El payload de trabajo incluye `created_by` (id y nombre) para mostrar el autor en la interfaz.
- Editar (`PUT`) o eliminar (`DELETE`) un trabajo ajeno devuelve 403 salvo administradores.
- El modal de trabajos tiene dos pestañas: «Mis trabajos» y «Compañeros», con el autor visible en cada tarjeta ajena; los trabajos de compañeros se abren en solo lectura (se pueden ver y duplicar, no editar), y ya no se abre automáticamente un trabajo de otro usuario al entrar.
- Al crear o duplicar un trabajo se vuelve a la pestaña «Mis trabajos».
- Tests: alcance por autor, visibilidad de compañeros, 403 en edición/borrado ajeno y `scope=all` restringido; comprobación estática del modal en frontend.

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
