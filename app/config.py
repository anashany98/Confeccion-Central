from __future__ import annotations

import os
import secrets
from dataclasses import dataclass


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
    session_secret = os.getenv("SESSION_SECRET", "").strip()
    production = app_env == "production"
    allowed_hosts = _csv_env("ALLOWED_HOSTS", "*" if not production else "")
    cookie_https_only = _bool_env("COOKIE_HTTPS_ONLY", production)

    errors: list[str] = []
    if production and not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        errors.append("DATABASE_URL debe apuntar a PostgreSQL en producción")
    if production and len(session_secret) < 32:
        errors.append("SESSION_SECRET debe tener al menos 32 caracteres en producción")
    if production and not allowed_hosts:
        errors.append("ALLOWED_HOSTS es obligatorio en producción")
    if production and not cookie_https_only:
        errors.append("COOKIE_HTTPS_ONLY debe ser true en producción")
    if not session_secret:
        session_secret = secrets.token_urlsafe(48)
    if errors:
        raise RuntimeError("; ".join(errors))

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
