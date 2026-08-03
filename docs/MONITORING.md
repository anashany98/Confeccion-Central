# Monitorización de errores (Sentry)

> Cómo capturar errores JS del frontend y excepciones del backend para una
> herramienta interna. Opcional: si no pones `SENTRY_DSN`, todo este código
> es no-op.

## Por qué

Una herramienta interna se cae, el operario cierra la pestaña, y tú no te
enteras hasta que alguien se queja. Sentry captura el error con contexto
(navegador, URL, datos del proyecto, stack trace) y te lo enseña en un panel.

## Setup (10 minutos)

1. Crea cuenta gratuita en https://sentry.io (5.000 eventos/mes gratis, más
   que suficiente para una herramienta interna).
2. Crea un proyecto Python (para el backend) y un proyecto JavaScript (para
   el frontend). O un solo proyecto "React" / "Browser" y reusar el DSN.
3. Copia el DSN del proyecto.
4. Añade a `.env`:
   ```
   SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
   ```
5. `docker compose up -d --build app` para que la app coja el cambio.

## Qué se reporta

### Backend (Python)

- Excepciones no capturadas en endpoints de la API.
- Errores 5xx.
- Stack trace completo + contexto de la request (sin datos personales:
  `send_default_pii=False`).

### Frontend (JS)

- Errores JS no capturados (`window.onerror`).
- Promesas rechazadas sin handler (`unhandledrejection`).
- Filtrados automáticamente:
  - `ResizeObserver` (ruido benigno del navegador).
  - `NetworkError when attempting to fetch resource` (errores de red sin contexto).
  - `Loading chunk` (pérdida de conexión con assets estáticos).

## Qué NO se reporta (intencionado)

- Datos personales de usuarios (nombre, email, etc.).
- Traces / performance (`traces_sample_rate: 0`).
- Logs de info/debug, solo ERROR.

## Comprobar que funciona

### Backend

```bash
# Forzar un error 500
curl http://localhost:8001/api/jobs/algo-que-no-existe
# En Sentry, debería aparecer el 404 (configurado) o 500 si forzamos.
```

### Frontend

Abre la consola del navegador y ejecuta:
```js
throw new Error("test sentry desde el navegador");
```
Espera 5-10 segundos y comprueba en Sentry → Issues.

## Sin Sentry (estado actual)

Si no pones `SENTRY_DSN`:
- El backend no inicializa el SDK (ver `if settings.sentry_dsn:` en `main.py`).
- El frontend no carga el bundle de Sentry (ver `if(!window.APP_CONFIG.sentryDsn)return;` en `index.html`).
- `/api/config.js` devuelve `sentryDsn: null`.
- Cero overhead, cero dependencias externas.

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `SENTRY_DSN` | `""` | DSN del proyecto. Vacío = deshabilitado |

## Privacidad / Compliance

Sentry recibe:
- Mensaje de error y stack trace.
- URL, navegador, OS del usuario.
- Variables de entorno NO se envían (`send_default_pii=False`).

NO recibe:
- Contenido de filas (habitaciones, medidas, etc.).
- Credenciales (ni Sentry ni el código tiene acceso a `SESSION_SECRET`).
- Datos personales explícitos.

Como es una herramienta interna con 5-10 usuarios, este nivel es suficiente.
Si en algún momento la app sale a usuarios externos, revisar y aumentar
`sendDefaultPii` o auto-mascarar más.
