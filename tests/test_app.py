from __future__ import annotations

import copy
import uuid

import pytest
from conftest import ADMIN_PASSWORD, login, logout, sample_state, save_job
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import disabled_api_documentation


def new_id() -> str:
    return str(uuid.uuid4())


def create_user(
    client: TestClient,
    *,
    username: str,
    role: str,
    permissions: list[str] | None = None,
    active: bool = True,
) -> tuple[dict, str]:
    password = "UserPassword123!"
    response = client.post(
        "/api/users",
        json={
            "username": username,
            "full_name": username,
            "password": password,
            "role": role,
            "permissions": permissions,
        },
    )
    assert response.status_code == 201, response.text
    user = response.json()["user"]
    if not active:
        changed = client.patch(f"/api/users/{user['id']}", json={"active": False})
        assert changed.status_code == 200
    return user, password


def test_health_login_logout_and_csrf(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok", "database": "ok"}
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"username": "admin", "password": "incorrecta"}
        ).status_code
        == 401
    )
    payload = login(client)
    assert payload["user"]["role"] == "admin"

    no_csrf = TestClient(client.app)
    signed_cookie = client.cookies.get("confeccion_session")
    assert signed_cookie
    no_csrf.cookies.set("confeccion_session", signed_cookie)
    assert no_csrf.post("/api/auth/logout").status_code == 403
    logout(client)
    assert client.get("/api/auth/me").status_code == 401


def test_disabled_user_cannot_login(client: TestClient) -> None:
    login(client)
    username = f"disabled_{uuid.uuid4().hex[:8]}"
    _, password = create_user(client, username=username, role="office", active=False)
    logout(client)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 401


def test_role_and_individual_permissions_are_enforced_by_api(client: TestClient) -> None:
    login(client)
    cut_name = f"cut_{uuid.uuid4().hex[:8]}"
    _, cut_password = create_user(
        client,
        username=cut_name,
        role="cut",
        permissions=["orders_view", "orders_print", "orders_receive", "orders_complete"],
    )
    view_name = f"view_{uuid.uuid4().hex[:8]}"
    _, view_password = create_user(
        client, username=view_name, role="office", permissions=["jobs_view"]
    )
    logout(client)

    login(client, cut_name, cut_password)
    assert client.get("/api/jobs").status_code == 403
    assert client.get("/api/users").status_code == 403
    assert client.get("/api/orders").status_code == 200
    logout(client)

    login(client, view_name, view_password)
    assert client.get("/api/jobs").status_code == 200
    job_id = new_id()
    response = client.put(
        f"/api/jobs/{job_id}",
        json={
            "name": "Prohibido",
            "state": sample_state(job_id),
            "versions": [],
            "expected_version": None,
        },
    )
    assert response.status_code == 403


def test_create_edit_conflict_delete_and_restore(client: TestClient) -> None:
    login(client)
    job_id = new_id()
    first = save_job(client, job_id)
    assert first["version"] == 1
    state = sample_state(job_id)
    state["rows"][0]["height"] = "2.72"
    second = save_job(client, job_id, state=state, expected_version=1)
    assert second["version"] == 2

    stale = client.put(
        f"/api/jobs/{job_id}",
        json={
            "name": "Conflicto",
            "state": state,
            "versions": [],
            "expected_version": 1,
        },
    )
    assert stale.status_code == 409
    assert client.delete(f"/api/jobs/{job_id}").status_code == 200
    assert not any(item["id"] == job_id for item in client.get("/api/jobs").json()["items"])
    deleted = client.get("/api/jobs?include_deleted=true").json()["items"]
    assert any(item["id"] == job_id and item["deleted_at"] for item in deleted)
    assert client.post(f"/api/jobs/{job_id}/restore").status_code == 200


def test_invalid_and_duplicate_measurements_are_rejected(client: TestClient) -> None:
    login(client)
    invalid_id = new_id()
    invalid = sample_state(invalid_id)
    invalid["rows"][0]["width"] = "-1"
    response = client.put(
        f"/api/jobs/{invalid_id}",
        json={
            "name": "Inválido",
            "state": invalid,
            "versions": [],
            "expected_version": None,
        },
    )
    assert response.status_code == 422

    duplicate_id = new_id()
    duplicate = sample_state(duplicate_id)
    duplicate["rows"].append({**copy.deepcopy(duplicate["rows"][0]), "id": "other-room"})
    response = client.put(
        f"/api/jobs/{duplicate_id}",
        json={
            "name": "Duplicado",
            "state": duplicate,
            "versions": [],
            "expected_version": None,
        },
    )
    assert response.status_code == 422
    assert "duplicadas" in response.text


def test_order_snapshot_is_authoritative_immutable_and_locks_job(client: TestClient) -> None:
    login(client)
    job_id = new_id()
    state = sample_state(job_id, width="2.40")
    save_job(client, job_id, state=state)

    forged = client.post(
        f"/api/jobs/{job_id}/orders",
        json={"expected_job_version": 1, "snapshot": {"rows": [{"width": 999}]}},
    )
    assert forged.status_code == 422
    created = client.post(f"/api/jobs/{job_id}/orders", json={"expected_job_version": 1})
    assert created.status_code == 201, created.text
    order = created.json()["order"]
    assert order["snapshot"]["rows"][0]["width"] == "2.40"

    state["rows"][0]["width"] = "9.99"
    locked = client.put(
        f"/api/jobs/{job_id}",
        json={
            "name": "Intento",
            "state": state,
            "versions": [],
            "expected_version": 1,
        },
    )
    assert locked.status_code == 423

    reopened = client.post(
        f"/api/jobs/{job_id}/reopen", json={"reason": "Corrección solicitada por oficina"}
    )
    assert reopened.status_code == 200
    save_job(client, job_id, state=state, expected_version=1)
    old = client.get(f"/api/orders/{order['id']}").json()["order"]
    assert old["snapshot"]["rows"][0]["width"] == "2.40"
    assert old["is_current"] is False


def test_order_state_machine_print_and_reprint(client: TestClient) -> None:
    login(client)
    job_id = new_id()
    save_job(client, job_id)
    order = client.post(f"/api/jobs/{job_id}/orders", json={"expected_job_version": 1}).json()[
        "order"
    ]
    order_id = order["id"]

    direct = client.patch(f"/api/orders/{order_id}/status", json={"status": "completed"})
    assert direct.status_code == 409
    printed = client.post(f"/api/orders/{order_id}/print-log", json={"document_type": "all"})
    assert printed.status_code == 201
    assert printed.json()["is_reprint"] is False
    assert (
        client.patch(f"/api/orders/{order_id}/status", json={"status": "completed"}).status_code
        == 409
    )
    assert (
        client.patch(f"/api/orders/{order_id}/status", json={"status": "received"}).status_code
        == 200
    )
    reprinted = client.post(f"/api/orders/{order_id}/print-log", json={"document_type": "cuts"})
    assert reprinted.json()["is_reprint"] is True
    assert reprinted.json()["print_count"] == 2
    completed = client.patch(f"/api/orders/{order_id}/status", json={"status": "completed"})
    assert completed.status_code == 200
    assert (
        client.patch(f"/api/orders/{order_id}/status", json={"status": "received"}).status_code
        == 409
    )


def test_operator_gets_only_required_snapshot_and_cannot_edit(client: TestClient) -> None:
    login(client)
    username = f"operator_{uuid.uuid4().hex[:8]}"
    _, password = create_user(
        client,
        username=username,
        role="cut",
        permissions=["orders_view", "orders_print", "orders_receive", "orders_complete"],
    )
    job_id = new_id()
    state = sample_state(job_id)
    save_job(client, job_id, state=state)
    order = client.post(f"/api/jobs/{job_id}/orders", json={"expected_job_version": 1}).json()[
        "order"
    ]
    logout(client)

    login(client, username, password)
    response = client.get(f"/api/orders/{order['id']}")
    assert response.status_code == 200
    snapshot = response.json()["order"]["snapshot"]
    assert "priceFabric" not in snapshot["project"]
    assert "client" not in snapshot["project"]
    assert (
        client.put(
            f"/api/jobs/{job_id}",
            json={
                "name": "Ataque",
                "state": state,
                "versions": [],
                "expected_version": 1,
            },
        ).status_code
        == 403
    )


def test_history_records_import_source_and_request_metadata(client: TestClient) -> None:
    login(client)
    job_id = new_id()
    save_job(client, job_id, source="excel")
    events = client.get(f"/api/jobs/{job_id}/history").json()["items"]
    assert events
    assert any(event["action"] == "import" for event in events)
    assert all(event["ip"] for event in events)
    assert all(event["user_agent"] for event in events)


def test_password_change_revokes_existing_session(client: TestClient) -> None:
    login(client)
    username = f"revoke_{uuid.uuid4().hex[:8]}"
    user, password = create_user(client, username=username, role="office")

    second = TestClient(client.app)
    login(second, username, password)
    changed = client.patch(f"/api/users/{user['id']}", json={"password": "ChangedPassword123!"})
    assert changed.status_code == 200
    assert second.get("/api/auth/me").status_code == 401


def test_usernames_accept_full_email(client: TestClient) -> None:
    login(client)
    email = f"prueba{uuid.uuid4().hex[:6]}@correo.com"
    email_user, email_password = create_user(client, username=email, role="office")
    assert email_user["username"] == email
    logout(client)
    payload = login(client, email, email_password)
    assert payload["user"]["id"] == email_user["id"]


def test_production_defaults_are_not_exposed_in_api(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    login(client)
    catalog = client.get("/api/permissions").json()
    keys = {item["key"] for item in catalog["permissions"]}
    assert {"jobs_create", "excel_import", "orders_approve", "permissions_manage"} <= keys
    assert ADMIN_PASSWORD not in client.get("/openapi.json").text


def test_production_rejects_insecure_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:password@db/confeccion")
    monkeypatch.setenv("SESSION_SECRET", "a" * 48)
    monkeypatch.setenv("ALLOWED_HOSTS", "confeccion.example.com")
    monkeypatch.setenv("COOKIE_HTTPS_ONLY", "false")
    with pytest.raises(RuntimeError, match="COOKIE_HTTPS_ONLY"):
        load_settings()


def test_disabled_api_documentation_returns_not_found() -> None:
    with pytest.raises(HTTPException) as error:
        disabled_api_documentation()
    assert error.value.status_code == 404


def test_jobs_are_scoped_by_owner_with_others_tab(client: TestClient) -> None:
    login(client)  # admin crea un trabajo
    admin_job_id = new_id()
    save_job(client, admin_job_id, state=sample_state(admin_job_id, room="101"))

    office_name = f"office_{uuid.uuid4().hex[:8]}"
    office, office_password = create_user(client, username=office_name, role="office")
    logout(client)

    # El usuario de oficina solo ve sus propios trabajos en el listado por defecto.
    login(client, office_name, office_password)
    mine = client.get("/api/jobs").json()["items"]
    assert all(item["created_by"]["id"] == office["id"] for item in mine)

    # El trabajo del admin aparece en "compañeros" identificando a su autor.
    others = client.get("/api/jobs?scope=others").json()["items"]
    assert any(
        item["id"] == admin_job_id and item["created_by"]["name"] == "Administrador de pruebas"
        for item in others
    )

    # No puede editar ni eliminar un trabajo ajeno.
    state = sample_state(admin_job_id)
    state["rows"][0]["height"] = "2.80"
    assert (
        client.put(
            f"/api/jobs/{admin_job_id}",
            json={
                "name": "Intento ajeno",
                "state": state,
                "versions": [],
                "expected_version": 1,
            },
        ).status_code
        == 403
    )
    assert client.delete(f"/api/jobs/{admin_job_id}").status_code == 403
    # scope=all es solo de administración.
    assert client.get("/api/jobs?scope=all").status_code == 403

    # La oficina crea su propio trabajo y el admin lo ve en "compañeros".
    office_job_id = new_id()
    save_job(client, office_job_id, state=sample_state(office_job_id, room="202"))
    mine = client.get("/api/jobs").json()["items"]
    assert any(item["id"] == office_job_id for item in mine)
    logout(client)

    login(client)  # admin
    admin_others = client.get("/api/jobs?scope=others").json()["items"]
    assert any(
        item["id"] == office_job_id and item["created_by"]["name"] == office_name
        for item in admin_others
    )
    all_jobs = client.get("/api/jobs?scope=all").json()["items"]
    assert {item["id"] for item in all_jobs} >= {admin_job_id, office_job_id}
