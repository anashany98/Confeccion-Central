from __future__ import annotations

import argparse
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx


class Api:
    def __init__(self, base_url: str) -> None:
        self.client = httpx.Client(base_url=base_url, timeout=20)
        self.csrf = ""

    def login(self, username: str, password: str) -> dict[str, Any]:
        response = self.client.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        response.raise_for_status()
        result = response.json()
        self.csrf = result["csrf_token"]
        return result

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            headers["X-CSRF-Token"] = self.csrf
        return self.client.request(method, path, headers=headers, **kwargs)


def state(job_id: str, room: str = "101") -> dict[str, Any]:
    return {
        "version": 4,
        "jobId": job_id,
        "project": {
            "hotel": f"Verificación {job_id[-6:]}",
            "client": "Cliente de prueba",
            "mode": 2,
            "gather": "2",
            "heightDiscount": "0.02",
            "fabricName": "Tela de prueba",
            "priceFabric": "99.95",
        },
        "rows": [
            {
                "id": f"room-{job_id[-8:]}",
                "room": room,
                "width": "2.40",
                "height": "2.70",
                "gather": "2",
                "hem": "0.25",
                "sheets": 2,
                "opening": "central",
                "notes": "Prueba automática",
                "status": "pending",
            }
        ],
    }


def save(api: Api, job_id: str, version: int | None = None) -> dict[str, Any]:
    payload_state = state(job_id)
    response = api.request(
        "PUT",
        f"/api/jobs/{job_id}",
        json={
            "name": payload_state["project"]["hotel"],
            "state": payload_state,
            "versions": [],
            "expected_version": version,
            "change_source": "excel",
        },
    )
    response.raise_for_status()
    return response.json()["job"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("VERIFY_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--admin-user", default=os.getenv("VERIFY_ADMIN_USER", "admin"))
    parser.add_argument("--admin-password", default=os.getenv("VERIFY_ADMIN_PASSWORD"))
    args = parser.parse_args()
    if not args.admin_password:
        raise SystemExit("Falta VERIFY_ADMIN_PASSWORD o --admin-password")

    suffix = uuid.uuid4().hex[:8]
    office_name = f"verify_office_{suffix}"
    cut_name = f"verify_cut_{suffix}"
    password = f"Verify-{suffix}-Password!"
    admin = Api(args.base_url)
    admin.login(args.admin_user, args.admin_password)

    health = admin.request("GET", "/api/health")
    assert health.json() == {"status": "ok", "database": "ok"}
    for username, role, permissions in (
        (
            office_name,
            "office",
            [
                "jobs_view",
                "jobs_create",
                "jobs_edit",
                "jobs_delete",
                "jobs_restore",
                "excel_import",
                "history_view",
                "orders_view",
                "orders_create",
            ],
        ),
        (
            cut_name,
            "cut",
            ["orders_view", "orders_print", "orders_receive", "orders_complete"],
        ),
    ):
        created = admin.request(
            "POST",
            "/api/users",
            json={
                "username": username,
                "full_name": username,
                "password": password,
                "role": role,
                "permissions": permissions,
            },
        )
        assert created.status_code == 201, created.text

    office = Api(args.base_url)
    office.login(office_name, password)
    job_id = str(uuid.uuid4())
    created_job = save(office, job_id)
    assert created_job["version"] == 1
    assert office.request("GET", f"/api/jobs/{job_id}/history").status_code == 200

    forged = office.request(
        "POST",
        f"/api/jobs/{job_id}/orders",
        json={"expected_job_version": 1, "snapshot": {"rows": [{"width": 999}]}},
    )
    assert forged.status_code == 422
    order_response = office.request(
        "POST", f"/api/jobs/{job_id}/orders", json={"expected_job_version": 1}
    )
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()["order"]
    assert order["snapshot"]["rows"][0]["width"] == "2.40"
    save_attempt = office.request(
        "PUT",
        f"/api/jobs/{job_id}",
        json={
            "name": "Modificación bloqueada",
            "state": state(job_id),
            "versions": [],
            "expected_version": 1,
        },
    )
    assert save_attempt.status_code == 423

    cut = Api(args.base_url)
    cut.login(cut_name, password)
    assert cut.request("GET", "/api/jobs").status_code == 403
    operator_order = cut.request("GET", f"/api/orders/{order['id']}").json()["order"]
    assert "priceFabric" not in operator_order["snapshot"]["project"]
    assert "client" not in operator_order["snapshot"]["project"]
    assert (
        cut.request(
            "PATCH", f"/api/orders/{order['id']}/status", json={"status": "completed"}
        ).status_code
        == 409
    )
    first_print = cut.request(
        "POST", f"/api/orders/{order['id']}/print-log", json={"document_type": "all"}
    )
    assert first_print.json()["is_reprint"] is False
    assert (
        cut.request(
            "PATCH", f"/api/orders/{order['id']}/status", json={"status": "received"}
        ).status_code
        == 200
    )
    second_print = cut.request(
        "POST", f"/api/orders/{order['id']}/print-log", json={"document_type": "cuts"}
    )
    assert second_print.json()["is_reprint"] is True
    assert (
        cut.request(
            "PATCH", f"/api/orders/{order['id']}/status", json={"status": "completed"}
        ).status_code
        == 200
    )
    assert (
        cut.request(
            "PUT",
            f"/api/jobs/{job_id}",
            json={
                "name": "Ataque",
                "state": state(job_id),
                "versions": [],
                "expected_version": 1,
            },
        ).status_code
        == 403
    )

    concurrent_jobs = [str(uuid.uuid4()) for _ in range(8)]
    for concurrent_id in concurrent_jobs:
        save(office, concurrent_id)

    def create_concurrent_order(concurrent_id: str) -> tuple[int, str]:
        worker = Api(args.base_url)
        worker.login(office_name, password)
        response = worker.request(
            "POST",
            f"/api/jobs/{concurrent_id}/orders",
            json={"expected_job_version": 1},
        )
        number = response.json().get("order", {}).get("order_number", "")
        return response.status_code, number

    with ThreadPoolExecutor(max_workers=8) as pool:
        concurrent_results = list(pool.map(create_concurrent_order, concurrent_jobs))
    assert all(code == 201 for code, _ in concurrent_results), concurrent_results
    numbers = [number for _, number in concurrent_results]
    assert len(set(numbers)) == len(numbers)

    print(
        json.dumps(
            {
                "status": "ok",
                "persistent_job_id": job_id,
                "order_id": order["id"],
                "concurrent_orders": numbers,
                "office_user": office_name,
                "cut_user": cut_name,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
