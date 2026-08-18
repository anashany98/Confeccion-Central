from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .permissions import ALL_PERMISSIONS

Role = Literal["admin", "office", "cut"]
Opening = Literal["central", "left", "right"]
OrderStatus = Literal["sent", "received", "printed", "in_process", "completed", "cancelled"]


def _decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        value = value.strip().replace(" ", "").replace(",", ".")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError("Debe ser un número decimal válido") from exc


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginRequest(ApiModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower()


class UserCreate(ApiModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9._@-]+$")
    full_name: str = Field(default="", max_length=160)
    password: str = Field(min_length=10, max_length=200)
    role: Role = "office"
    permissions: list[str] | None = None

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip().lower()
        # Permite el correo completo (con @) o un usuario clásico.
        if not re.fullmatch(r"[a-z0-9._@-]{3,80}", value):
            raise ValueError("Use un correo o letras, números, punto, guion o guion bajo")
        return value

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        unknown = sorted(set(values) - ALL_PERMISSIONS)
        if unknown:
            raise ValueError(f"Permisos desconocidos: {', '.join(unknown)}")
        return sorted(set(values))


class UserUpdate(ApiModel):
    full_name: str | None = Field(default=None, max_length=160)
    password: str | None = Field(default=None, min_length=10, max_length=200)
    role: Role | None = None
    permissions: list[str] | None = None
    active: bool | None = None

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, values: list[str] | None) -> list[str] | None:
        return UserCreate.validate_permissions(values)


class RoomState(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=80)
    block: str = Field(default="", max_length=120)
    floor: str = Field(default="", max_length=120)
    room: str = Field(default="", max_length=120)
    width: Decimal | None = None
    height: Decimal | None = None
    gather: Decimal | None = None
    hem: Decimal | None = None
    sheets: int | None = Field(default=None, ge=1, le=10)
    opening: Opening = "central"
    notes: str = Field(default="", max_length=2000)
    status: str = Field(default="pending", max_length=30)

    _parse_width = field_validator("width", mode="before")(_decimal)
    _parse_height = field_validator("height", mode="before")(_decimal)
    _parse_gather = field_validator("gather", mode="before")(_decimal)
    _parse_hem = field_validator("hem", mode="before")(_decimal)

    @property
    def label(self) -> str:
        return " · ".join(
            part for part in (self.block.strip(), self.floor.strip(), self.room.strip()) if part
        )

    @property
    def has_data(self) -> bool:
        return bool(self.label or self.width is not None or self.height is not None or self.notes)

    @model_validator(mode="after")
    def validate_complete_row(self) -> RoomState:
        if not self.has_data:
            return self
        if not self.label:
            raise ValueError("Falta el identificador (habitación, bloque o planta)")
        if self.width is None or self.width <= 0 or self.width > Decimal("100"):
            raise ValueError("El ancho debe estar entre 0 y 100 m")
        if self.height is None or self.height <= 0 or self.height > Decimal("30"):
            raise ValueError("La altura debe estar entre 0 y 30 m")
        if self.gather is not None and not Decimal("0.1") <= self.gather <= Decimal("10"):
            raise ValueError("El fruncido debe estar entre 0,1 y 10")
        if self.hem is not None and not Decimal("0") <= self.hem <= Decimal("10"):
            raise ValueError("El bajo y cresta debe estar entre 0 y 10 m")
        return self


class ProjectState(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    hotel: str = Field(default="", max_length=200)
    client: str = Field(default="", max_length=200)
    fabricName: str = Field(default="", max_length=200)
    fabricType: str = Field(default="", max_length=120)
    priceFabric: Decimal | None = None
    priceConfection: Decimal | None = None
    priceInstallation: Decimal | None = None
    margin: Decimal | None = None

    _parse_price_fabric = field_validator("priceFabric", mode="before")(_decimal)
    _parse_price_confection = field_validator("priceConfection", mode="before")(_decimal)
    _parse_price_installation = field_validator("priceInstallation", mode="before")(_decimal)
    _parse_margin = field_validator("margin", mode="before")(_decimal)

    @model_validator(mode="after")
    def validate_money(self) -> ProjectState:
        for name in ("priceFabric", "priceConfection", "priceInstallation"):
            value = getattr(self, name)
            if value is not None and (value < 0 or value > Decimal("1000000")):
                raise ValueError(f"{name} está fuera de rango")
        if self.margin is not None and not Decimal("-100") <= self.margin <= Decimal("10000"):
            raise ValueError("El margen está fuera de rango")
        return self


class JobState(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: int = Field(default=4, ge=1, le=1000)
    jobId: str = Field(min_length=1, max_length=80)
    project: ProjectState
    rows: list[RoomState] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def validate_duplicates(self) -> JobState:
        seen: set[str] = set()
        duplicates: set[str] = set()
        for row in self.rows:
            if not row.has_data:
                continue
            key = row.label.casefold()
            if key in seen:
                duplicates.add(row.label or row.room)
            seen.add(key)
        if duplicates:
            raise ValueError(f"Identificadores duplicados: {', '.join(sorted(duplicates)[:10])}")
        return self


class JobSave(ApiModel):
    name: str = Field(default="Trabajo sin nombre", max_length=200)
    state: JobState
    versions: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    expected_version: int | None = Field(default=None, ge=1)
    change_source: Literal["manual", "excel", "csv", "clipboard", "restore"] = "manual"
    reason: str | None = Field(default=None, max_length=500)


class OrderCreate(ApiModel):
    expected_job_version: int = Field(ge=1)
    reason: str | None = Field(default=None, max_length=500)


class StatusUpdate(ApiModel):
    status: Literal["received", "in_process", "completed", "cancelled"]
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def require_cancel_reason(self) -> StatusUpdate:
        if self.status == "cancelled" and not (self.reason or "").strip():
            raise ValueError("La cancelación requiere un motivo")
        return self


class ReopenRequest(ApiModel):
    reason: str = Field(min_length=3, max_length=500)


class ImpersonateLog(ApiModel):
    """Body mínimo para registrar un evento de "Ver como" en el audit log."""

    target_id: str = Field(min_length=1, max_length=64)


class ChangePasswordRequest(ApiModel):
    """Body para el endpoint POST /api/auth/change-password.

    - new_password: obligatorio, mínimo 10 caracteres (alineado con el form de
      creación de usuarios).
    - current_password: requerido solo cuando el usuario NO tiene el flag
      `must_change_password` activo (cambio voluntario). En el flujo forzado
      por política de seguridad, el flag está activo y se omite.
    """

    new_password: str = Field(min_length=10, max_length=200)
    current_password: str | None = Field(default=None, max_length=200)


class PrintLogCreate(ApiModel):
    document_type: Literal["order", "cuts", "confection", "sketches", "labels", "all"] = "all"
