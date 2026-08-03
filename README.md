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
