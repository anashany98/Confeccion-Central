from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TEST_DB = Path(__file__).parent / "test_confeccion.db"
if TEST_DB.exists():
    TEST_DB.unlink()

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["SESSION_SECRET"] = "test-only-session-secret-not-for-production"
os.environ["COOKIE_HTTPS_ONLY"] = "false"
os.environ["ALLOWED_HOSTS"] = "*"
os.environ["DOCS_ENABLED"] = "true"

alembic = Config(str(ROOT / "alembic.ini"))
command.upgrade(alembic, "head")

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

ADMIN_PASSWORD = "TestPassword123!"

with SessionLocal() as db:
    db.add(
        User(
            username="admin",
            full_name="Administrador de pruebas",
            password_hash=hash_password(ADMIN_PASSWORD),
            role="admin",
        )
    )
    db.commit()


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def login(
    client: TestClient, username: str = "admin", password: str = ADMIN_PASSWORD
) -> dict[str, Any]:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    payload = response.json()
    client.headers["X-CSRF-Token"] = payload["csrf_token"]
    return payload


def logout(client: TestClient) -> None:
    response = client.post("/api/auth/logout")
    assert response.status_code == 200, response.text
    client.headers.pop("X-CSRF-Token", None)


def sample_state(job_id: str, *, room: str = "101", width: str = "2.40") -> dict[str, Any]:
    return {
        "version": 4,
        "jobId": job_id,
        "project": {
            "hotel": "Hotel Prueba",
            "client": "Cliente",
            "mode": 2,
            "gather": "2",
            "heightDiscount": "0.02",
            "fabricName": "Visillo",
            "priceFabric": "19.95",
            "priceConfection": "7.25",
        },
        "rows": [
            {
                "id": f"room-{job_id[-4:]}",
                "room": room,
                "width": width,
                "height": "2.70",
                "gather": "2",
                "hem": "0.25",
                "sheets": 2,
                "opening": "central",
                "notes": "",
                "status": "pending",
            }
        ],
    }


def save_job(
    client: TestClient,
    job_id: str,
    *,
    state: dict[str, Any] | None = None,
    expected_version: int | None = None,
    source: str = "manual",
) -> dict[str, Any]:
    current = state or sample_state(job_id)
    response = client.put(
        f"/api/jobs/{job_id}",
        json={
            "name": current["project"]["hotel"],
            "state": current,
            "versions": [],
            "expected_version": expected_version,
            "change_source": source,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["job"]
