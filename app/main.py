from __future__ import annotations

import copy
import secrets
import threading
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractContextManager, asynccontextmanager, nullcontext
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response

from .config import settings
from .database import get_db
from .history import diff_states
from .models import (
    CutOrder,
    CutOrderItem,
    HistoryEvent,
    Job,
    JobRoom,
    LoginAttempt,
    PrintLog,
    User,
    utcnow,
)
from .permissions import (
    ALL_PERMISSIONS,
    PERMISSION_LABELS,
    ROLE_PERMISSIONS,
    has_permission,
    normalize_permissions,
    permissions_for,
)
from .schemas import (
    ChangePasswordRequest,
    ImpersonateLog,
    JobSave,
    LoginRequest,
    OrderCreate,
    PrintLogCreate,
    ReopenRequest,
    StatusUpdate,
    UserCreate,
    UserUpdate,
)
from .security import hash_password, verify_password

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SQLITE_ORDER_LOCK = threading.Lock()
ORDER_LOCK_KEY = 2_026_072_900


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


def _request_meta(request: Request) -> dict[str, str]:
    return {
        "ip_address": request.client.host if request.client else "",
        "user_agent": request.headers.get("user-agent", "")[:500],
        "request_id": getattr(request.state, "request_id", ""),
    }


def add_audit(
    db: Session,
    request: Request,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    user_id: str | None = None,
    job_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    field_name: str | None = None,
    reason: str | None = None,
) -> None:
    db.add(
        HistoryEvent(
            job_id=job_id,
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            before_json=before,
            after_json=after,
            field_name=field_name,
            reason=reason,
            **_request_meta(request),
        )
    )


def user_payload(user: User) -> dict[str, Any]:
    effective = sorted(permissions_for(user.role, user.permissions_json))
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "permissions": effective,
        "custom_permissions": user.permissions_json is not None,
        "must_change_password": user.must_change_password,
        "active": user.active,
        "created_at": user.created_at.isoformat(),
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _decimal(value: Any, default: str = "0") -> Decimal:
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _positive(value: Any) -> bool:
    return _decimal(value) > 0


def _data_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        row
        for row in state.get("rows", [])
        if str(row.get("room", "")).strip()
        or _positive(row.get("width"))
        or _positive(row.get("height"))
        or str(row.get("notes", "")).strip()
    ]


def _ready_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        row
        for row in state.get("rows", [])
        if str(row.get("room", "")).strip()
        and _positive(row.get("width"))
        and _positive(row.get("height"))
    ]


def job_payload(job: Job, include_state: bool = True) -> dict[str, Any]:
    project = (job.state_json or {}).get("project", {})
    rows = _ready_rows(job.state_json or {})
    payload: dict[str, Any] = {
        "id": job.id,
        "name": job.name,
        "client": job.client,
        "status": job.status,
        "version": job.version,
        "locked": job.locked_at is not None,
        "locked_at": job.locked_at.isoformat() if job.locked_at else None,
        "deleted_at": job.deleted_at.isoformat() if job.deleted_at else None,
        "room_count": len(rows),
        "fabric": project.get("fabricName") or project.get("fabricType") or "",
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "created_by": {
            "id": job.created_by_id,
            "name": (job.created_by.full_name or job.created_by.username) if job.created_by else "",
        },
        "updated_by": job.updated_by.full_name or job.updated_by.username if job.updated_by else "",
    }
    if include_state:
        payload["state"] = job.state_json or {}
        payload["versions"] = job.versions_json or []
    return payload


CUT_PROJECT_FIELDS = {
    "mode",
    "date",
    "hotel",
    "seamstress",
    "fabricType",
    "fabricName",
    "fabricWidth",
    "confectionType",
    "hooks",
    "heightDiscount",
    "closureAdd",
    "railDeduction",
    "gather",
    "hem",
}
CUT_ROW_FIELDS = {
    "id",
    "room",
    "width",
    "height",
    "gather",
    "hem",
    "sheets",
    "opening",
    "notes",
    "status",
}


def operator_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    project = snapshot.get("project", {}) or {}
    return {
        "version": snapshot.get("version"),
        "jobId": snapshot.get("jobId"),
        "project": {key: project.get(key) for key in CUT_PROJECT_FIELDS if key in project},
        "rows": [
            {key: row.get(key) for key in CUT_ROW_FIELDS if key in row}
            for row in _ready_rows(snapshot)
        ],
    }


def order_payload(
    order: CutOrder,
    *,
    include_snapshot: bool = False,
    print_count: int = 0,
    operator: bool = False,
) -> dict[str, Any]:
    snapshot = order.snapshot_json or {}
    project = snapshot.get("project", {})
    rows = _ready_rows(snapshot)
    payload: dict[str, Any] = {
        "id": order.id,
        "order_number": order.order_number,
        "job_id": order.job_id,
        "job_name": order.job.name if order.job else project.get("hotel", ""),
        "fabric": project.get("fabricName") or project.get("fabricType") or "",
        "revision": order.revision,
        "status": order.status,
        "is_current": order.is_current,
        "room_count": len(rows),
        "panel_count": sum(max(1, int(_decimal(row.get("sheets"), "1"))) for row in rows),
        "created_by": (
            order.created_by.full_name or order.created_by.username if order.created_by else ""
        ),
        "created_at": order.created_at.isoformat(),
        "updated_at": order.updated_at.isoformat(),
        "received_at": order.received_at.isoformat() if order.received_at else None,
        "printed_at": order.printed_at.isoformat() if order.printed_at else None,
        "completed_at": order.completed_at.isoformat() if order.completed_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "print_count": print_count,
    }
    if not operator:
        payload["client"] = project.get("client", "")
        payload["reason"] = order.reason
    if include_snapshot:
        payload["snapshot"] = operator_snapshot(snapshot) if operator else snapshot
    return payload


def _session_csrf(request: Request) -> str:
    token = request.session.get("csrf_token")
    if not isinstance(token, str):
        token = secrets.token_urlsafe(32)
        request.session["csrf_token"] = token
    return token


def csrf_protect(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"} or request.url.path == "/api/auth/login":
        return
    if not request.url.path.startswith("/api/") or not request.session.get("user_id"):
        return
    expected = request.session.get("csrf_token", "")
    supplied = request.headers.get("x-csrf-token", "")
    if not expected or not supplied or not secrets.compare_digest(str(expected), supplied):
        raise HTTPException(status_code=403, detail="Token CSRF ausente o no válido")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # El esquema se gestiona exclusivamente con Alembic.
    yield


docs_url = "/docs" if settings.docs_enabled else None
openapi_url = "/openapi.json" if settings.docs_enabled else None
app = FastAPI(
    title="Confección Central",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=docs_url,
    redoc_url=None,
    openapi_url=openapi_url,
    dependencies=[Depends(csrf_protect)],
)

# Sentry (opcional: solo se inicializa si SENTRY_DSN está definido).
if settings.sentry_dsn:
    import logging

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release="confeccion-central@2.0.0",
        traces_sample_rate=0.0,  # Solo errores, sin tracing
        send_default_pii=False,  # No enviar datos personales
        integrations=[
            FastApiIntegration(transaction_style="url"),
            StarletteIntegration(),
            LoggingIntegration(level=None, event_level=logging.ERROR),
        ],
        before_send_transaction=lambda event, hint: None,  # No enviar transactions
    )

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    session_cookie="confeccion_session",
    same_site="lax",
    https_only=settings.cookie_https_only,
    max_age=60 * 60 * settings.session_hours,
)
if settings.allowed_hosts and settings.allowed_hosts != ("*",):
    # El HEALTHCHECK del Dockerfile y las sondas de Coolify consultan
    # 127.0.0.1 desde dentro del propio contenedor; sin estos alias el
    # TrustedHostMiddleware respondería 400 y el rolling update haría
    # rollback de un servicio que en realidad está sano.
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[*settings.allowed_hosts, "127.0.0.1", "localhost"],
    )


@app.middleware("http")
async def security_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request.state.request_id = request.headers.get("x-request-id", str(uuid.uuid4()))[:36]
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_request_bytes:
        return JSONResponse(
            status_code=413, content={"detail": "La solicitud supera el tamaño permitido"}
        )
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # browser.sentry-cdn.com / *.sentry.io solo se usan si SENTRY_DSN está definido
    # (index.html carga el SDK dinámicamente); sin DSN estas entradas son inertes.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://browser.sentry-cdn.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self' https://*.sentry.io; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    if settings.cookie_https_only:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Request-ID"] = request.state.request_id
    return response


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Sesión no iniciada")
    user = db.get(User, user_id)
    session_version = request.session.get("auth_version")
    if not user or not user.active or session_version != user.auth_version:
        request.session.clear()
        raise HTTPException(status_code=401, detail="Usuario o sesión no válidos")
    return user


def require_permission(permission: str) -> Callable[..., User]:
    if permission not in ALL_PERMISSIONS:
        raise RuntimeError(f"Permiso desconocido: {permission}")

    def dependency(user: User = Depends(current_user)) -> User:
        if not has_permission(user.role, user.permissions_json, permission):
            raise HTTPException(status_code=403, detail="No tiene permisos para esta acción")
        return user

    return dependency


def _require_user_permission(user: User, permission: str) -> None:
    if not has_permission(user.role, user.permissions_json, permission):
        raise HTTPException(status_code=403, detail="No tiene permisos para esta acción")


@app.get("/api/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Base de datos no disponible") from exc
    return {"status": "ok", "database": "ok"}


def disabled_api_documentation() -> None:
    raise HTTPException(status_code=404, detail="Documentación de API desactivada")


if not settings.docs_enabled:
    for documentation_path in ("/docs", "/redoc", "/openapi.json"):
        app.add_api_route(
            documentation_path,
            disabled_api_documentation,
            methods=["GET"],
            include_in_schema=False,
        )


@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> dict[str, Any]:
    username = payload.username
    now = utcnow()
    ip_address = _request_meta(request)["ip_address"]
    window_start = now - timedelta(minutes=settings.login_window_minutes)
    recent_failures = (
        db.scalar(
            select(func.count(LoginAttempt.id)).where(
                LoginAttempt.username == username,
                LoginAttempt.ip_address == ip_address,
                LoginAttempt.successful.is_(False),
                LoginAttempt.created_at >= window_start,
            )
        )
        or 0
    )
    user = db.scalar(select(User).where(User.username == username))
    locked_until = _aware(user.locked_until) if user else None
    throttled = recent_failures >= settings.login_max_failures or (
        locked_until is not None and locked_until > now
    )
    valid = bool(
        user
        and user.active
        and not throttled
        and verify_password(payload.password, user.password_hash)
    )
    db.add(
        LoginAttempt(
            username=username,
            ip_address=ip_address,
            successful=valid,
            user_id=user.id if user else None,
            user_agent=_request_meta(request)["user_agent"],
        )
    )
    if not valid:
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
        add_audit(
            db,
            request,
            action="login_failed",
            entity_type="user",
            entity_id=user.id if user else username,
            summary=f"Acceso fallido para {username}",
            user_id=user.id if user else None,
            after={"throttled": throttled},
        )
        db.commit()
        code = 429 if throttled else 401
        detail = (
            "Demasiados intentos. Inténtelo más tarde"
            if throttled
            else "Usuario o contraseña incorrectos"
        )
        raise HTTPException(status_code=code, detail=detail)

    assert user is not None
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["auth_version"] = user.auth_version
    csrf_token = _session_csrf(request)
    add_audit(
        db,
        request,
        action="login_success",
        entity_type="user",
        entity_id=user.id,
        summary=f"Inicio de sesión de {user.username}",
        user_id=user.id,
    )
    db.commit()
    return {"user": user_payload(user), "csrf_token": csrf_token}


@app.post("/api/auth/logout")
def logout(
    request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, bool]:
    add_audit(
        db,
        request,
        action="logout",
        entity_type="user",
        entity_id=user.id,
        summary=f"Cierre de sesión de {user.username}",
        user_id=user.id,
    )
    db.commit()
    request.session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    return {"user": user_payload(user), "csrf_token": _session_csrf(request)}


@app.post("/api/auth/change-password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Cambia la contraseña del usuario actual.

    - Si el flag `must_change_password` está activo, NO se exige la contraseña
      actual (el usuario acaba de autenticarse para llegar aquí).
    - Si el flag está en False, se exige la contraseña actual para confirmar.
    - En ambos casos, la nueva contraseña debe tener al menos 10 caracteres
      y se persiste hasheada con scrypt.
    """
    if not user.must_change_password and (
        not payload.current_password
        or not verify_password(payload.current_password, user.password_hash)
    ):
        raise HTTPException(status_code=400, detail="Contraseña actual incorrecta")
    forced_change = user.must_change_password  # antes de desactivarlo
    user.password_hash = hash_password(payload.new_password)
    user.password_changed_at = utcnow()
    user.must_change_password = False
    # Solo invalidamos las demás sesiones cuando el cambio es voluntario.
    # En un cambio forzado (must_change_password estaba activo) la sesión
    # actual debe seguir siendo válida, si no el usuario queda deslogeado
    # justo después de cumplir la política.
    if not forced_change:
        user.auth_version += 1
    db.commit()
    add_audit(
        db,
        request,
        action="password_change",
        entity_type="user",
        entity_id=user.id,
        summary=(
            f"{user.full_name or user.username} cambió su contraseña"
            + (" (forzada por política)" if forced_change else "")
        ).strip(),
        user_id=user.id,
    )
    db.commit()
    return {"ok": True, "user": user_payload(user)}


@app.get("/api/permissions")
def permission_catalog(_: User = Depends(current_user)) -> dict[str, Any]:
    return {
        "permissions": [{"key": key, "label": label} for key, label in PERMISSION_LABELS.items()],
        "roles": {role: sorted(values) for role, values in ROLE_PERMISSIONS.items()},
    }


@app.get("/api/users")
def list_users(
    _: User = Depends(require_permission("users_manage")), db: Session = Depends(get_db)
) -> dict[str, Any]:
    users = db.scalars(select(User).order_by(User.created_at)).all()
    return {"items": [user_payload(user) for user in users]}


@app.post("/api/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    current: User = Depends(require_permission("users_manage")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.role != "office" or payload.permissions is not None:
        _require_user_permission(current, "permissions_manage")
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=409, detail="El nombre de usuario ya existe")
    user = User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        permissions_json=normalize_permissions(payload.permissions),
    )
    db.add(user)
    db.flush()
    add_audit(
        db,
        request,
        action="user_create",
        entity_type="user",
        entity_id=user.id,
        summary=f"Usuario {user.username} creado",
        user_id=current.id,
        after={"username": user.username, "role": user.role, "active": user.active},
    )
    db.commit()
    db.refresh(user)
    return {"user": user_payload(user)}


@app.patch("/api/users/{user_id}")
def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    current: User = Depends(require_permission("users_manage")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    values = payload.model_dump(exclude_unset=True)
    if {"role", "permissions"} & values.keys():
        _require_user_permission(current, "permissions_manage")
    if user.id == current.id and values.get("active") is False:
        raise HTTPException(status_code=400, detail="No puede desactivar su propio usuario")
    if user.role == "admin" and values.get("active") is False:
        active_admins = (
            db.scalar(
                select(func.count(User.id)).where(User.role == "admin", User.active.is_(True))
            )
            or 0
        )
        if active_admins <= 1:
            raise HTTPException(
                status_code=400, detail="No puede desactivar el último administrador"
            )
    before = {
        "full_name": user.full_name,
        "role": user.role,
        "permissions": user.permissions_json,
        "active": user.active,
    }
    security_changed = False
    if "full_name" in values:
        user.full_name = values["full_name"] or ""
    if values.get("password"):
        user.password_hash = hash_password(values["password"])
        user.password_changed_at = utcnow()
        security_changed = True
    if values.get("role"):
        user.role = values["role"]
        security_changed = True
        if "permissions" not in values:
            user.permissions_json = None
    if "permissions" in values:
        user.permissions_json = normalize_permissions(values["permissions"])
        security_changed = True
    if "active" in values:
        user.active = values["active"]
        security_changed = True
    if security_changed:
        user.auth_version += 1
    user.updated_at = utcnow()
    add_audit(
        db,
        request,
        action="user_update",
        entity_type="user",
        entity_id=user.id,
        summary=f"Usuario {user.username} modificado",
        user_id=current.id,
        before=before,
        after={
            "full_name": user.full_name,
            "role": user.role,
            "permissions": user.permissions_json,
            "active": user.active,
            "password_changed": bool(values.get("password")),
        },
    )
    db.commit()
    db.refresh(user)
    return {"user": user_payload(user)}


def _sync_rooms(db: Session, job: Job, state: dict[str, Any]) -> None:
    db.execute(delete(JobRoom).where(JobRoom.job_id == job.id))
    for position, row in enumerate(_ready_rows(state)):
        db.add(
            JobRoom(
                job_id=job.id,
                source_id=str(row["id"]),
                room_code=str(row["room"]).strip(),
                width_m=_decimal(row["width"]),
                height_m=_decimal(row["height"]),
                gather=_decimal(row.get("gather"), "1"),
                hem_m=_decimal(row.get("hem"), "0"),
                sheets=max(1, int(_decimal(row.get("sheets"), "1"))),
                opening=row.get("opening") or "central",
                notes=str(row.get("notes") or ""),
                status=str(row.get("status") or "pending"),
                position=position,
            )
        )


@app.get("/api/jobs")
def list_jobs(
    scope: str = Query(default="mine", pattern="^(mine|others|all)$"),
    include_deleted: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("jobs_view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(Job)
    count_query = select(func.count(Job.id))
    # Los trabajos son por autor: "mine" son los propios, "others" los de los
    # compañeros y "all" (solo administración) todos.
    if scope == "all":
        _require_user_permission(user, "users_manage")
        owner_cond = None
    elif scope == "others":
        owner_cond = or_(Job.created_by_id != user.id, Job.created_by_id.is_(None))
    else:
        owner_cond = Job.created_by_id == user.id
    if owner_cond is not None:
        query = query.where(owner_cond)
        count_query = count_query.where(owner_cond)
    if not include_deleted:
        query = query.where(Job.deleted_at.is_(None))
        count_query = count_query.where(Job.deleted_at.is_(None))
    else:
        _require_user_permission(user, "jobs_restore")
    total = db.scalar(count_query) or 0
    jobs = db.scalars(
        query.order_by(Job.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {
        "items": [job_payload(job, include_state=True) for job in jobs],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.put("/api/jobs/{job_id}")
def save_job(
    job_id: str,
    payload: JobSave,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    is_new = job is None
    _require_user_permission(user, "jobs_create" if is_new else "jobs_edit")
    if job and job.created_by_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo el autor del trabajo puede editarlo")
    if job and job.deleted_at:
        raise HTTPException(status_code=410, detail="El trabajo fue eliminado")
    if job and job.locked_at:
        raise HTTPException(
            status_code=423, detail="El trabajo está bloqueado por una orden aprobada"
        )
    if job and payload.expected_version != job.version:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Otro usuario ha modificado el trabajo",
                "server_version": job.version,
                "job": job_payload(job, include_state=True),
            },
        )
    if payload.change_source in {"excel", "csv", "clipboard"}:
        _require_user_permission(user, "excel_import")

    state = payload.state.model_dump(mode="json")
    state["jobId"] = job_id
    project = state.get("project", {}) or {}
    name = (payload.name or project.get("hotel") or "Trabajo sin nombre").strip()
    client = str(project.get("client", "")).strip()

    if is_new:
        job = Job(
            id=job_id,
            name=name,
            client=client,
            state_json=state,
            versions_json=payload.versions,
            created_by_id=user.id,
            updated_by_id=user.id,
            version=1,
        )
        db.add(job)
        db.flush()
        events = diff_states(None, state)
    else:
        assert job is not None
        before = copy.deepcopy(job.state_json or {})
        events = diff_states(before, state)
        job.name = name
        job.client = client
        job.state_json = state
        job.versions_json = payload.versions
        job.updated_by_id = user.id
        job.updated_at = utcnow()
        job.version += 1

    assert job is not None
    _sync_rooms(db, job, state)
    if not events:
        add_audit(
            db,
            request,
            action="save_no_changes",
            entity_type="job",
            entity_id=job.id,
            summary=f"Trabajo {job.name} guardado sin cambios",
            user_id=user.id,
            job_id=job.id,
            reason=payload.reason,
        )
    for event in events:
        add_audit(
            db,
            request,
            action="import" if payload.change_source != "manual" else event["action"],
            entity_type=event["entity_type"],
            entity_id=event["entity_id"],
            summary=event["summary"],
            user_id=user.id,
            job_id=job.id,
            before=event["before"],
            after=event["after"],
            reason=payload.reason or payload.change_source,
        )
    db.commit()
    db.refresh(job)
    return {"job": job_payload(job, include_state=True), "created": is_new, "changes": len(events)}


@app.delete("/api/jobs/{job_id}")
def delete_job(
    job_id: str,
    request: Request,
    user: User = Depends(require_permission("jobs_delete")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job or job.deleted_at:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    if job.locked_at:
        raise HTTPException(
            status_code=423, detail="No se puede eliminar un trabajo con una orden vigente"
        )
    if job.created_by_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Solo el autor del trabajo puede eliminarlo")
    job.deleted_at = utcnow()
    job.updated_by_id = user.id
    add_audit(
        db,
        request,
        action="delete",
        entity_type="job",
        entity_id=job.id,
        summary=f"Trabajo {job.name} eliminado",
        user_id=user.id,
        job_id=job.id,
        before={"name": job.name},
    )
    db.commit()
    return {"ok": True}


@app.post("/api/jobs/{job_id}/restore")
def restore_job(
    job_id: str,
    request: Request,
    user: User = Depends(require_permission("jobs_restore")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job or not job.deleted_at:
        raise HTTPException(status_code=404, detail="Trabajo eliminado no encontrado")
    deleted_at = job.deleted_at
    job.deleted_at = None
    job.updated_by_id = user.id
    job.updated_at = utcnow()
    add_audit(
        db,
        request,
        action="restore",
        entity_type="job",
        entity_id=job.id,
        summary=f"Trabajo {job.name} restaurado",
        user_id=user.id,
        job_id=job.id,
        before={"deleted_at": deleted_at.isoformat()},
        after={"deleted_at": None},
    )
    db.commit()
    return {"job": job_payload(job, include_state=True)}


@app.get("/api/jobs/{job_id}/history")
def job_history(
    job_id: str,
    limit: int = Query(default=150, ge=1, le=500),
    _: User = Depends(require_permission("history_view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if not db.get(Job, job_id):
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    events = db.scalars(
        select(HistoryEvent)
        .where(HistoryEvent.job_id == job_id)
        .order_by(HistoryEvent.created_at.desc())
        .limit(limit)
    ).all()
    return {
        "items": [
            {
                "id": event.id,
                "action": event.action,
                "entity_type": event.entity_type,
                "entity_id": event.entity_id,
                "summary": event.summary,
                "before": event.before_json,
                "after": event.after_json,
                "field": event.field_name,
                "reason": event.reason,
                "ip": event.ip_address,
                "user_agent": event.user_agent,
                "created_at": event.created_at.isoformat(),
                "user": event.user.full_name or event.user.username if event.user else "Sistema",
            }
            for event in events
        ]
    }


@app.post("/api/audit/impersonate-start")
def audit_impersonate_start(
    payload: ImpersonateLog,
    request: Request,
    current: User = Depends(require_permission("users_manage")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Registra el inicio de una sesión de "Ver como" en el audit log.

    La impersonación en sí es solo frontend (no cambia la sesión del backend),
    pero queremos que quede constancia de quién impersonó a quién y cuándo.
    """
    target = db.get(User, payload.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Usuario objetivo no encontrado")
    if target.id == current.id:
        raise HTTPException(
            status_code=400, detail="No tiene sentido impersonar a tu propio usuario"
        )
    add_audit(
        db,
        request,
        action="impersonate_start",
        entity_type="user",
        entity_id=target.id,
        summary=(
            f"{current.full_name or current.username} empezó a impersonar a "
            f"{target.full_name or target.username} ({target.role})"
        ),
        user_id=current.id,
        after={
            "target_username": target.username,
            "target_full_name": target.full_name,
            "target_role": target.role,
        },
    )
    db.commit()
    return {"ok": True, "logged_at": utcnow().isoformat()}


@app.post("/api/audit/impersonate-stop")
def audit_impersonate_stop(
    payload: ImpersonateLog,
    request: Request,
    current: User = Depends(require_permission("users_manage")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Registra el fin de una sesión de "Ver como" en el audit log."""
    target_username = ""
    target_full_name = ""
    target_role = ""
    target = db.get(User, payload.target_id)
    if target:
        target_username = target.username
        target_full_name = target.full_name or ""
        target_role = target.role
    add_audit(
        db,
        request,
        action="impersonate_stop",
        entity_type="user",
        entity_id=payload.target_id,
        summary=(
            f"{current.full_name or current.username} salió de impersonar a "
            f"{target_full_name or target_username or '?'}"
        ),
        user_id=current.id,
        after={
            "target_username": target_username,
            "target_full_name": target_full_name,
            "target_role": target_role,
        },
    )
    db.commit()
    return {"ok": True, "logged_at": utcnow().isoformat()}


def _order_transaction_lock(db: Session) -> AbstractContextManager[Any]:
    if db.bind and db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": ORDER_LOCK_KEY})
        return nullcontext()
    return SQLITE_ORDER_LOCK


def next_order_number(db: Session) -> str:
    year = datetime.now(UTC).year
    prefix = f"OC-{year}-"
    last = db.scalar(
        select(func.max(CutOrder.order_number)).where(CutOrder.order_number.like(f"{prefix}%"))
    )
    sequence = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{sequence:04d}"


def _add_order_items(db: Session, order: CutOrder, snapshot: dict[str, Any]) -> None:
    for position, row in enumerate(_ready_rows(snapshot)):
        width = _decimal(row["width"])
        gather = _decimal(row.get("gather"), "1")
        sheets = max(1, int(_decimal(row.get("sheets"), "1")))
        fabric = width * gather
        db.add(
            CutOrderItem(
                order_id=order.id,
                source_room_id=str(row.get("id") or ""),
                room_code=str(row["room"]).strip(),
                width_m=width,
                height_m=_decimal(row["height"]),
                gather=gather,
                hem_m=_decimal(row.get("hem"), "0"),
                sheets=sheets,
                measure_per_sheet_m=fabric / Decimal(sheets),
                fabric_m=fabric,
                opening=row.get("opening") or "central",
                notes=str(row.get("notes") or ""),
                position=position,
            )
        )


@app.post("/api/jobs/{job_id}/orders", status_code=status.HTTP_201_CREATED)
def create_order(
    job_id: str,
    payload: OrderCreate,
    request: Request,
    user: User = Depends(require_permission("orders_create")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    with _order_transaction_lock(db):
        job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
        if not job or job.deleted_at:
            raise HTTPException(status_code=404, detail="Trabajo no encontrado")
        if job.locked_at:
            raise HTTPException(status_code=423, detail="El trabajo ya tiene una orden vigente")
        if payload.expected_job_version != job.version:
            raise HTTPException(status_code=409, detail="El trabajo cambió antes de aprobarse")
        snapshot = copy.deepcopy(job.state_json or {})
        rows = _data_rows(snapshot)
        invalid = [
            row
            for row in rows
            if not str(row.get("room", "")).strip()
            or not _positive(row.get("width"))
            or not _positive(row.get("height"))
        ]
        if not rows:
            raise HTTPException(status_code=422, detail="El trabajo no contiene habitaciones")
        if invalid:
            names = [str(row.get("room") or "sin número") for row in invalid[:8]]
            raise HTTPException(
                status_code=422, detail=f"Hay habitaciones incompletas: {', '.join(names)}"
            )
        revision = (
            db.scalar(select(func.max(CutOrder.revision)).where(CutOrder.job_id == job_id)) or 0
        ) + 1
        db.execute(
            update(CutOrder)
            .where(CutOrder.job_id == job_id, CutOrder.is_current.is_(True))
            .values(is_current=False)
        )
        order = CutOrder(
            order_number=next_order_number(db),
            job_id=job_id,
            revision=revision,
            status="sent",
            snapshot_json=snapshot,
            created_by_id=user.id,
            reason=payload.reason,
            is_current=True,
        )
        db.add(order)
        db.flush()
        _add_order_items(db, order, snapshot)
        job.status = "in_cut"
        job.locked_at = utcnow()
        job.approved_at = job.locked_at
        job.updated_by_id = user.id
        add_audit(
            db,
            request,
            action="order_create",
            entity_type="order",
            entity_id=order.id,
            summary=f"Orden {order.order_number} creada, revisión {revision}",
            user_id=user.id,
            job_id=job.id,
            after={
                "order_number": order.order_number,
                "revision": revision,
                "job_version": job.version,
                "snapshot_rooms": len(rows),
            },
            reason=payload.reason,
        )
        db.commit()
        db.refresh(order)
    return {"order": order_payload(order, include_snapshot=True)}


@app.post("/api/jobs/{job_id}/reopen")
def reopen_job(
    job_id: str,
    payload: ReopenRequest,
    request: Request,
    user: User = Depends(require_permission("orders_approve")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job or job.deleted_at:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    if not job.locked_at:
        raise HTTPException(status_code=409, detail="El trabajo no está bloqueado")
    current_orders = db.scalars(
        select(CutOrder).where(CutOrder.job_id == job_id, CutOrder.is_current.is_(True))
    ).all()
    if any(order.status in {"in_process", "completed"} for order in current_orders):
        raise HTTPException(
            status_code=409, detail="No se puede reabrir una orden en proceso o finalizada"
        )
    for order in current_orders:
        order.is_current = False
        order.reason = payload.reason
    locked_at = job.locked_at
    job.locked_at = None
    job.status = "draft"
    job.updated_by_id = user.id
    add_audit(
        db,
        request,
        action="job_reopen",
        entity_type="job",
        entity_id=job.id,
        summary=f"Trabajo {job.name} reabierto para revisión",
        user_id=user.id,
        job_id=job.id,
        before={"locked_at": locked_at.isoformat()},
        after={"locked_at": None},
        reason=payload.reason,
    )
    db.commit()
    return {"job": job_payload(job, include_state=True)}


@app.get("/api/orders")
def list_orders(
    order_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    user: User = Depends(require_permission("orders_view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(CutOrder)
    count_query = select(func.count(CutOrder.id))
    if order_status:
        query = query.where(CutOrder.status == order_status)
        count_query = count_query.where(CutOrder.status == order_status)
    total = db.scalar(count_query) or 0
    orders = db.scalars(
        query.order_by(CutOrder.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    order_ids = [order.id for order in orders]
    counts: dict[str, int] = {}
    if order_ids:
        count_rows = db.execute(
            select(PrintLog.order_id, func.count(PrintLog.id))
            .where(PrintLog.order_id.in_(order_ids))
            .group_by(PrintLog.order_id)
        ).all()
        counts = {order_id: count for order_id, count in count_rows}
    operator = user.role == "cut"
    return {
        "items": [
            order_payload(order, print_count=counts.get(order.id, 0), operator=operator)
            for order in orders
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.get("/api/orders/{order_id}")
def get_order(
    order_id: str,
    user: User = Depends(require_permission("orders_view")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = db.get(CutOrder, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    print_count = (
        db.scalar(select(func.count(PrintLog.id)).where(PrintLog.order_id == order.id)) or 0
    )
    return {
        "order": order_payload(
            order,
            include_snapshot=True,
            print_count=print_count,
            operator=user.role == "cut",
        )
    }


@app.patch("/api/orders/{order_id}/status")
def update_order_status(
    order_id: str,
    payload: StatusUpdate,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = db.scalar(select(CutOrder).where(CutOrder.id == order_id).with_for_update())
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    target = payload.status
    required = {
        "received": "orders_receive",
        "in_process": "orders_receive",
        "completed": "orders_complete",
        "cancelled": "orders_approve",
    }[target]
    _require_user_permission(user, required)
    allowed: dict[str, set[str]] = {
        "sent": {"received", "cancelled"},
        "printed": (
            {"received", "in_process", "completed", "cancelled"}
            if order.received_at
            else {"received", "cancelled"}
        ),
        "received": {"in_process", "completed", "cancelled"},
        "in_process": {"completed", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    }
    old = order.status
    if target == old:
        raise HTTPException(status_code=409, detail="La orden ya se encuentra en ese estado")
    if target not in allowed.get(old, set()):
        raise HTTPException(status_code=409, detail=f"Transición no permitida: {old} → {target}")
    now = utcnow()
    order.status = target
    order.updated_at = now
    if target == "received":
        order.received_at = now
    elif target == "completed":
        order.completed_at = now
        order.job.status = "cut_completed"
    elif target == "cancelled":
        order.cancelled_at = now
        order.is_current = False
        order.reason = payload.reason
        order.job.status = "draft"
        order.job.locked_at = None
    add_audit(
        db,
        request,
        action="order_status",
        entity_type="order",
        entity_id=order.id,
        summary=f"Orden {order.order_number}: {old} → {target}",
        user_id=user.id,
        job_id=order.job_id,
        before={"status": old},
        after={"status": target},
        reason=payload.reason,
    )
    db.commit()
    db.refresh(order)
    return {"order": order_payload(order, include_snapshot=True, operator=user.role == "cut")}


@app.post("/api/orders/{order_id}/print-log", status_code=status.HTTP_201_CREATED)
def log_print(
    order_id: str,
    payload: PrintLogCreate,
    request: Request,
    user: User = Depends(require_permission("orders_print")),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = db.scalar(select(CutOrder).where(CutOrder.id == order_id).with_for_update())
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="No se puede imprimir una orden cancelada")
    count = db.scalar(select(func.count(PrintLog.id)).where(PrintLog.order_id == order.id)) or 0
    reprint = count > 0
    db.add(
        PrintLog(
            order_id=order.id,
            user_id=user.id,
            document_type=payload.document_type,
            is_reprint=reprint,
            ip_address=_request_meta(request)["ip_address"],
            user_agent=_request_meta(request)["user_agent"],
        )
    )
    if order.status in {"sent", "received"}:
        order.status = "printed"
    order.printed_at = utcnow()
    add_audit(
        db,
        request,
        action="reprint" if reprint else "print",
        entity_type="order",
        entity_id=order.id,
        summary=(
            f"Reimpresión solicitada de {order.order_number}: {payload.document_type}"
            if reprint
            else f"Impresión solicitada de {order.order_number}: {payload.document_type}"
        ),
        user_id=user.id,
        job_id=order.job_id,
        after={"document_type": payload.document_type, "is_reprint": reprint},
    )
    db.commit()
    return {
        "ok": True,
        "print_count": count + 1,
        "is_reprint": reprint,
        "status": order.status,
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/api/config.js", include_in_schema=False)
def frontend_config() -> Response:
    """Configuración pública expuesta al frontend (Sentry DSN, etc.)."""
    payload = {
        "sentryDsn": settings.sentry_dsn or None,
        "environment": settings.app_env,
    }
    # JSON.stringify evita inyección; se sirve como JS ejecutable.
    import json as _json

    body = f"window.APP_CONFIG={_json.dumps(payload)};"
    return Response(content=body, media_type="application/javascript; charset=utf-8")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str) -> FileResponse:
    candidate = (STATIC_DIR / path).resolve()
    static_root = STATIC_DIR.resolve()
    if path and candidate.is_file() and candidate.is_relative_to(static_root):
        return FileResponse(candidate)
    return FileResponse(STATIC_DIR / "index.html")
