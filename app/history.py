from __future__ import annotations

from typing import Any

PROJECT_LABELS = {
    "hotel": "Obra / hotel",
    "client": "Cliente",
    "date": "Fecha",
    "seamstress": "Costurera",
    "fabricType": "Tipo de tela",
    "fabricName": "Nombre de la tela",
    "fabricWidth": "Ancho de tela",
    "confectionType": "Tipo de confección",
    "mode": "Número de hojas",
    "gather": "Fruncido general",
    "hem": "Bajo y cresta general",
    "priceFabric": "Precio de tela",
    "priceConfection": "Precio de confección",
    "priceInstallation": "Precio de instalación",
    "margin": "Margen",
}
ROW_LABELS = {
    "block": "Bloque",
    "floor": "Planta",
    "room": "Habitación",
    "width": "Ancho",
    "height": "Altura",
    "gather": "Fruncido",
    "hem": "Bajo y cresta",
    "sheets": "Número de hojas",
    "notes": "Observaciones",
    "status": "Estado",
}


def _clean(value: Any) -> Any:
    if value == "":
        return None
    return value


def _row_label(row: dict[str, Any]) -> str:
    return " · ".join(
        str(row.get(key, "")).strip()
        for key in ("block", "floor", "room")
        if str(row.get(key, "")).strip()
    )


def diff_states(before: dict[str, Any] | None, after: dict[str, Any]) -> list[dict[str, Any]]:
    if not before:
        rows = [r for r in after.get("rows", []) if _row_has_data(r)]
        return [
            {
                "action": "create",
                "entity_type": "job",
                "entity_id": str(after.get("jobId", "")),
                "summary": f"Trabajo creado con {len(rows)} habitaciones",
                "before": None,
                "after": {"project": after.get("project", {}), "rooms": len(rows)},
            }
        ]

    events: list[dict[str, Any]] = []
    old_project = before.get("project", {}) or {}
    new_project = after.get("project", {}) or {}
    for key, label in PROJECT_LABELS.items():
        old, new = _clean(old_project.get(key)), _clean(new_project.get(key))
        if old != new:
            events.append(
                {
                    "action": "update",
                    "entity_type": "project",
                    "entity_id": key,
                    "summary": (
                        f"{label}: {old if old is not None else 'vacío'} → "
                        f"{new if new is not None else 'vacío'}"
                    ),
                    "before": {key: old},
                    "after": {key: new},
                }
            )

    old_rows = {
        str(r.get("id")): r for r in before.get("rows", []) if r.get("id") and _row_has_data(r)
    }
    new_rows = {
        str(r.get("id")): r for r in after.get("rows", []) if r.get("id") and _row_has_data(r)
    }

    for row_id in new_rows.keys() - old_rows.keys():
        row = new_rows[row_id]
        events.append(
            {
                "action": "create",
                "entity_type": "room",
                "entity_id": row_id,
                "summary": f"Habitación {_row_label(row) or 'sin identificar'} añadida",
                "before": None,
                "after": _row_snapshot(row),
            }
        )
    for row_id in old_rows.keys() - new_rows.keys():
        row = old_rows[row_id]
        events.append(
            {
                "action": "delete",
                "entity_type": "room",
                "entity_id": row_id,
                "summary": f"Habitación {_row_label(row) or 'sin identificar'} eliminada",
                "before": _row_snapshot(row),
                "after": None,
            }
        )
    for row_id in old_rows.keys() & new_rows.keys():
        old_row, new_row = old_rows[row_id], new_rows[row_id]
        changes: dict[str, dict[str, Any]] = {}
        for key, label in ROW_LABELS.items():
            old, new = _clean(old_row.get(key)), _clean(new_row.get(key))
            if old != new:
                changes[label] = {"before": old, "after": new}
        if changes:
            room = _row_label(new_row) or _row_label(old_row) or "sin identificar"
            names = ", ".join(changes.keys())
            events.append(
                {
                    "action": "update",
                    "entity_type": "room",
                    "entity_id": row_id,
                    "summary": f"Habitación {room}: {names}",
                    "before": {k: v["before"] for k, v in changes.items()},
                    "after": {k: v["after"] for k, v in changes.items()},
                }
            )

    if len(events) > 40:
        return [
            {
                "action": "bulk_update",
                "entity_type": "job",
                "entity_id": str(after.get("jobId", "")),
                "summary": f"Actualización masiva: {len(events)} cambios",
                "before": {"rooms": len(old_rows)},
                "after": {"rooms": len(new_rows)},
            }
        ]
    return events


def _row_has_data(row: dict[str, Any]) -> bool:
    return bool(
        str(row.get("room", "")).strip()
        or row.get("width")
        or row.get("height")
        or str(row.get("notes", "")).strip()
    )


def _row_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    return {key: row.get(key) for key in ROW_LABELS}
