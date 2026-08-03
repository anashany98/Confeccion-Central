# Manual de instalación y despliegue

## Requisitos

- VPS Linux x86-64 con Docker Engine y Docker Compose v2.
- 2 CPU, 4 GB RAM y 20 GB libres como mínimo recomendado para el piloto.
- Dominio HTTPS gestionado por Coolify, Dokploy o un proxy equivalente.
- SMTP no es necesario en esta versión.

## Preparación

```bash
git clone <repositorio> confeccion_central
cd confeccion_central
cp .env.example .env
chmod 600 .env
```

Edite `.env` y sustituya todos los valores `REEMPLAZAR_...`. Genere secretos distintos:

```bash
openssl rand -hex 32
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Condiciones obligatorias:

- `POSTGRES_PASSWORD`: secreto único.
- `SESSION_SECRET`: aleatorio, mínimo 32 caracteres.
- `ADMIN_PASSWORD`: mínimo 12 caracteres; se recomiendan 16 o más.
- `ALLOWED_HOSTS`: dominio público, `localhost` y, solo si se necesita, la IP.
- `COOKIE_HTTPS_ONLY=true`.
- `DOCS_ENABLED=false`.
- Restrinja `FORWARDED_ALLOW_IPS` a la IP o subred del proxy cuando la plataforma la facilite.

No versionar `.env`.

## Inicio

```bash
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 app
curl -fsS http://127.0.0.1:8000/api/health
```

El contenedor ejecuta `alembic upgrade head` antes de arrancar. Compruebe la revisión:

```bash
docker compose exec -T app alembic current
```

## Administrador inicial

```bash
docker compose --profile tools run --rm admin-init
```

El comando es idempotente: crea el usuario una sola vez. Cambie o retire `ADMIN_PASSWORD` del panel de la plataforma después del bootstrap. No se crea ningún usuario implícitamente al reiniciar.

## Proxy, Coolify y Dokploy

Publique el servicio `app`, puerto interno `8000`, con HTTPS. Configure:

- healthcheck: `/api/health`;
- WebSocket: no requerido;
- volumen: `confeccion_postgres`;
- reinicio: `unless-stopped`;
- variables de `.env`;
- backup externo programado.

No publique el puerto 5432. Si el proxy es otro contenedor, mantenga ambos en una red privada y limite `FORWARDED_ALLOW_IPS`.

## Comprobaciones de aceptación

1. Entre como administrador.
2. Cree usuarios de oficina y corte.
3. Oficina: cree trabajo, importe `tests/fixtures/importacion_mixta.xlsx`, revise historial y emita orden.
4. Confirme que el trabajo queda bloqueado.
5. Corte: compruebe que solo aparece el puesto, imprima, reciba y finalice.
6. Reinicie ambos servicios y confirme persistencia.
7. Ejecute backup y restauración temporal según `COPIAS_RESTAURACION.md`.

## Desarrollo HTTP local

Solo en una máquina de desarrollo:

```env
APP_ENV=development
COOKIE_HTTPS_ONLY=false
ALLOWED_HOSTS=localhost,127.0.0.1
```

Nunca traslade esos valores a producción.
