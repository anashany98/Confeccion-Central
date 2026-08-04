# Confección Central

Aplicación empresarial centralizada para preparar trabajos de confección, importar habitaciones y medidas, emitir órdenes de corte inalterables y operar el puesto de corte desde un navegador o una PWA.

## Estado de esta entrega

La revisión de producción, sus correcciones y las comprobaciones ejecutadas el 29 de julio de 2026 están documentadas en:

- [AUDITORIA.md](AUDITORIA.md): diagnóstico original, anterior a cualquier cambio.
- [CAMBIOS.md](CAMBIOS.md): correcciones aplicadas y estado final.
- [PENDIENTES.md](PENDIENTES.md): límites conocidos y trabajo futuro.
- [ARQUITECTURA.md](ARQUITECTURA.md): arquitectura técnica.
- [docs/RESULTADOS_PRUEBAS.md](docs/RESULTADOS_PRUEBAS.md): comandos y resultados reales.

## Arranque de producción

Requisitos: Docker Engine, Docker Compose v2, un dominio y HTTPS en el proxy de Coolify, Dokploy, Traefik, Caddy o Nginx.

```bash
cp .env.example .env
# Sustituya todos los valores REEMPLAZAR_...
docker compose up -d --build
docker compose --profile tools run --rm admin-init
curl -fsS http://127.0.0.1:8000/api/health
```

La respuesta esperada del healthcheck es `{"status":"ok","database":"ok"}`. El comando `admin-init` es idempotente y no crea usuarios durante cada arranque.

En producción deben mantenerse `APP_ENV=production`, `COOKIE_HTTPS_ONLY=true`, `DOCS_ENABLED=false`, un `SESSION_SECRET` aleatorio de al menos 32 caracteres y PostgreSQL. La aplicación rechaza una configuración de producción insegura.

### Despliegue en Coolify

Coolify crea los recursos a partir del repositorio de GitHub, así que basta con:

1. **Crear un nuevo recurso** en Coolify apuntando a la rama por defecto (`main`) del repositorio.
   - Build pack: `Dockerfile`. El `Dockerfile` ya está en la raíz del proyecto.
   - Puerto interno: `8000` (el `HEALTHCHECK` del Dockerfile lo valida).
2. **Servicio de base de datos**: añada un servicio PostgreSQL gestionado por Coolify. Coolify expone internamente las variables `DATABASE_URL_HOST`, `DATABASE_URL_PASSWORD`, `DATABASE_URL_USER`, `DATABASE_URL_DATABASE`. Proyecte los nombres esperados por la app en la pestaña de variables:
   - `DATABASE_URL` = `postgresql+psycopg://${DATABASE_URL_USER}:${DATABASE_URL_PASSWORD}@${DATABASE_URL_HOST}:5432/${DATABASE_URL_DATABASE}`
3. **Variables de entorno**: copie la lista de `.env.example` y defina cada valor en Coolify. Campos **obligatorios** en producción:
   - `APP_ENV=production`
   - `SESSION_SECRET` (≥ 32 caracteres aleatorios, persistente — cambiarlo fuerza re-login a todos los usuarios).
   - `COOKIE_HTTPS_ONLY=true`
   - `ALLOWED_HOSTS` con el dominio público del recurso.
   - `FORWARDED_ALLOW_IPS` con la IP (o red) del proxy terminado; por defecto Coolify suele usar `*`.
4. **Crear el administrador inicial**: abra un terminal del recurso y ejecute
   `python -m app.cli create-admin` (con `ADMIN_USERNAME`, `ADMIN_FULL_NAME` y `ADMIN_PASSWORD` como variables temporales durante el comando) o cree un recurso de un solo uso con el perfil `tools`:
   ```bash
   docker compose --profile tools run --rm admin-init
   ```
5. **HTTPS y proxy**: Coolify configura el proxy inverso automáticamente; `SESSION_COOKIE_SECURE=true` requiere `COOKIE_HTTPS_ONLY=true`. La app escucha en `0.0.0.0:8000` por dentro del contenedor.
6. **Verificación**: abra el dominio, haga login con el admin, cree un trabajo de prueba, apruebe una orden y compruebe el puesto de corte. Revise los logs del recurso si el chip de sincronización muestra `Sesión caducada` tras cada deploy (debería ser estable).

Tras cada `git push`, Coolify reconstruye la imagen y reinicia el contenedor. El `SESSION_SECRET` permanece estable (lo gestiona Coolify como variable persistente) y los trabajos abiertos se conservan; los cambios en memoria que estuvieran a media escritura y los borradores offline se restauran al re-entrar.

## Flujo funcional

```text
Oficina crea trabajo → importa/revisa medidas → crea orden
       → el servidor congela el snapshot y bloquea el trabajo
       → corte consulta → imprime localmente → recibe → finaliza
```

El servidor, no el navegador, construye el snapshot. Las órdenes conservan sus habitaciones normalizadas en `cut_order_items`, además del documento JSON congelado. Reabrir exige permiso administrativo y motivo; no se permite reabrir una orden en proceso o finalizada.

## Documentación

- [Instalación y despliegue](docs/INSTALACION.md)
- [Actualización y rollback](docs/ACTUALIZACION.md)
- [Copias y restauración](docs/COPIAS_RESTAURACION.md)
- [Manual de oficina](docs/MANUAL_OFICINA.md)
- [Manual ultra simple de operario](docs/MANUAL_OPERARIO.md)
- [Matriz de roles y permisos](docs/ROLES_PERMISOS.md)
- [Diagrama de base de datos](docs/DIAGRAMA_BD.md)
- [Flujo de órdenes](docs/FLUJO_ORDENES.md)
- [Vulnerabilidades](docs/VULNERABILIDADES.md)
- [Decisiones técnicas](docs/DECISIONES_TECNICAS.md)
- [Software de terceros](THIRD_PARTY.md)

## Desarrollo y calidad

Python 3.12 y Node.js 22 o posterior:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
pytest
ruff check app tests
black --check app tests
mypy app
bandit -c pyproject.toml -r app
pip-audit -r requirements.txt

npm ci
npm run lint
npm run format:check
npm test
npm audit --audit-level=high
```

En PowerShell active el entorno con `.\.venv\Scripts\Activate.ps1`. Sin `DATABASE_URL`, el modo de desarrollo usa SQLite; producción exige PostgreSQL.

## Impresión y PWA

La impresión es deliberadamente manual: el navegador abre el diálogo del equipo del operario y utiliza su impresora local predeterminada. No hay impresión silenciosa. El service worker no almacena respuestas de `/api/` ni datos empresariales y los datos de trabajo no se persisten en `localStorage`.

Para instalar en Windows, abra la URL HTTPS en Edge o Chrome y elija **Instalar Confección Central**. Las actualizaciones de la PWA usan una caché versionada y red prioritaria para evitar mantener una interfaz antigua.
