from __future__ import annotations

from collections.abc import Iterable

PERMISSION_LABELS: dict[str, str] = {
    "jobs_view": "Ver trabajos",
    "jobs_create": "Crear trabajos",
    "jobs_edit": "Editar trabajos",
    "jobs_delete": "Eliminar trabajos",
    "jobs_restore": "Restaurar trabajos",
    "excel_import": "Importar Excel o CSV",
    "history_view": "Consultar historial",
    "orders_view": "Ver órdenes de corte",
    "orders_create": "Crear órdenes de corte",
    "orders_approve": "Aprobar, reabrir o cancelar órdenes",
    "orders_print": "Imprimir órdenes",
    "orders_receive": "Confirmar recepción en corte",
    "orders_complete": "Finalizar órdenes de corte",
    "users_manage": "Administrar usuarios",
    "permissions_manage": "Administrar roles y permisos",
}

ALL_PERMISSIONS = frozenset(PERMISSION_LABELS)

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "admin": ALL_PERMISSIONS,
    "office": frozenset(
        {
            "jobs_view",
            "jobs_create",
            "jobs_edit",
            "excel_import",
            "history_view",
            "orders_view",
            "orders_create",
        }
    ),
    "cut": frozenset(
        {
            "orders_view",
            "orders_print",
            "orders_receive",
            "orders_complete",
        }
    ),
}


def normalize_permissions(values: Iterable[str] | None) -> list[str] | None:
    if values is None:
        return None
    return sorted({value for value in values if value in ALL_PERMISSIONS})


def permissions_for(role: str, custom: Iterable[str] | None = None) -> frozenset[str]:
    if role == "admin":
        return ALL_PERMISSIONS
    if custom is None:
        return ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(normalize_permissions(custom) or [])


def has_permission(role: str, custom: Iterable[str] | None, permission: str) -> bool:
    return permission in permissions_for(role, custom)
