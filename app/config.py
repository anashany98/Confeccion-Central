from __future__ import annotations

import contextlib
import os
import secrets
import sys
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _strip_env_alias(value: str, name: str) -> str:
    """Acepta ``NAME=value`` o ``NAME = value`` pegados por error.

    Algunos paneles de Coolify/Dokploy guardan literalmente lo pegado en
    el campo de valor, incluyendo el prefijo del nombre de la variable.
    Si el valor empieza por ``NAME=`` (con espacios opcionales), lo
    recortamos y dejamos un aviso en stderr para que el operador corrija
    el panel cuando pueda.
    """
    if not value:
        return value
    head, sep, rest = value.partition("=")
    if sep and head.strip().upper() == name.upper():
        print(
            f"[config] AVISO: {name} lleva un prefijo '{name}=' en su valor; "
            "lo recorto, pero conviene corregir el panel de Coolify.",
            file=sys.stderr,
        )
        return rest.strip()
    return value


def _dev_session_secret() -> str:
    """Secreto estable para desarrollo.

    Sin SESSION_SECRET, cada proceso generaba uno aleatorio y todos los
    reinicios (o deploys) invalidaban las sesiones: los guardados pendientes
    acababan en 401 y el usuario veía "Error al guardar" al arrancar.
    En dev persistimos el secreto en .secrets/ para sobrevivir reinicios.
    En producción SESSION_SECRET sigue siendo obligatorio por entorno.
    """
    secret_file = BASE_DIR / ".secrets" / "dev_session_secret"
    try:
        if secret_file.exists():
            value = secret_file.read_text().strip()
            if len(value) >= 32:
                return value
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        value = secrets.token_urlsafe(48)
        secret_file.write_text(value)
        with contextlib.suppress(OSError):  # Windows: permisos POSIX no aplicables
            os.chmod(secret_file, 0o600)
        return value
    except OSError:
        return secrets.token_urlsafe(48)


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _csv_env(name: str, default: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.getenv(name, default).split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_url: str
    session_secret: str
    cookie_https_only: bool
    session_hours: int
    allowed_hosts: tuple[str, ...]
    docs_enabled: bool
    login_max_failures: int
    login_window_minutes: int
    login_lock_minutes: int
    max_request_bytes: int
    sentry_dsn: str
    admin_password: str

    @property
    def production(self) -> bool:
        return self.app_env == "production"


def load_settings() -> Settings:
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    database_url = os.getenv("DATABASE_URL", "sqlite:///./confeccion.db").strip()
    database_url = _strip_env_alias(database_url, "DATABASE_URL")
    session_secret = os.getenv("SESSION_SECRET", "").strip()
    production = app_env == "production"
    # En producción Coolify (y algunos proxies) sirve la URL con prefijo
    # `postgres://` (sin la `ql`); SQLAlchemy 2.x no la reconoce. Aceptamos los
    # tres esquemas habituales y normalizamos al driver psycopg antes de
    # crear el motor, para que el operador pueda pegar la URL tal cual.
    allowed_hosts = _csv_env("ALLOWED_HOSTS", "*" if not production else "")
    cookie_https_only = _bool_env("COOKIE_HTTPS_ONLY", production)

    errors: list[str] = []
    if production and not database_url.startswith(
        ("postgresql://", "postgresql+psycopg://", "postgres://")
    ):
        errors.append("DATABASE_URL debe apuntar a PostgreSQL en producción")
    if production and len(session_secret) < 32:
        errors.append("SESSION_SECRET debe tener al menos 32 caracteres en producción")
    if production and not allowed_hosts:
        errors.append("ALLOWED_HOSTS es obligatorio en producción")
    if production and not cookie_https_only:
        errors.append("COOKIE_HTTPS_ONLY debe ser true en producción")
    if not session_secret:
        session_secret = _dev_session_secret()
    if errors:
        raise RuntimeError("; ".join(errors))

    # SQLAlchemy 2.x sólo entiende `postgresql://` y `postgresql+psycopg://`.
    # Si el operador pegó `postgres://` (alias de libpq) o `postgresql://`
    # sin driver, lo normalizamos al driver psycopg.
    if database_url.startswith("postgres://"):
        database_url = "postgresql+psycopg://" + database_url[len("postgres://") :]
    elif database_url.startswith("postgresql://"):
        database_url = "postgresql+psycopg" + database_url[len("postgresql") :]

    return Settings(
        app_env=app_env,
        database_url=database_url,
        session_secret=session_secret,
        cookie_https_only=cookie_https_only,
        session_hours=max(1, min(int(os.getenv("SESSION_HOURS", "12")), 168)),
        allowed_hosts=allowed_hosts,
        docs_enabled=_bool_env("DOCS_ENABLED", not production),
        login_max_failures=max(3, min(int(os.getenv("LOGIN_MAX_FAILURES", "5")), 20)),
        login_window_minutes=max(1, min(int(os.getenv("LOGIN_WINDOW_MINUTES", "15")), 120)),
        login_lock_minutes=max(1, min(int(os.getenv("LOGIN_LOCK_MINUTES", "15")), 1440)),
        max_request_bytes=max(
            64 * 1024, min(int(os.getenv("MAX_REQUEST_BYTES", "5242880")), 50 * 1024 * 1024)
        ),
        sentry_dsn=os.getenv("SENTRY_DSN", "").strip(),
        admin_password=os.getenv("ADMIN_PASSWORD", "").strip(),
    )


settings = load_settings()
