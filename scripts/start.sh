#!/usr/bin/env sh
set -eu

# Diagnóstico temporal: imprime el estado del entorno en runtime para
# detectar env vars vacíos, malformados o con prefijo equivocado. Mantener
# mientras dure la fase de despliegue; se puede retirar cuando el stack
# en Coolify esté estable. Las contraseñas se redactan a '****'.
mask_pwd() {
  printf '%s' "$1" | sed -E 's#://[^:@/]+:[^@/]+@#://user:****@#'
}
echo "[diag] APP_ENV=${APP_ENV:-<unset>}"
echo "[diag] SESSION_SECRET set? $([ -n "${SESSION_SECRET:-}" ] && echo yes || echo no)"
echo "[diag] ALLOWED_HOSTS=${ALLOWED_HOSTS:-<unset>}"
echo "[diag] COOKIE_HTTPS_ONLY=${COOKIE_HTTPS_ONLY:-<unset>}"
echo "[diag] DATABASE_URL_PREFIX=$(printf '%s' "${DATABASE_URL:-}" | cut -c1-32)<len=$(printf '%s' "${DATABASE_URL:-}" | wc -c)>"
echo "[diag] DATABASE_URL_MASKED=$(mask_pwd "${DATABASE_URL:-}")"

echo "Aplicando migraciones de base de datos..."
alembic upgrade head

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
