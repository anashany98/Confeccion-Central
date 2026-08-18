from __future__ import annotations

from sqlalchemy import func, select

from app.cli import create_admin
from app.database import SessionLocal
from app.models import User


def test_create_admin_creates_user() -> None:
    assert create_admin("cli_admin", "Admin de pruebas", "CliPassword123!") == 0
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == "cli_admin"))
    assert user is not None
    assert user.role == "admin"
    assert user.full_name == "Admin de pruebas"


def test_create_admin_is_idempotent() -> None:
    assert create_admin("cli_admin", "Admin de pruebas", "CliPassword123!") == 0
    with SessionLocal() as db:
        count = db.scalar(select(func.count(User.id)).where(User.username == "cli_admin"))
    assert count == 1


def test_create_admin_rejects_short_password() -> None:
    assert create_admin("cli_short", "Corta", "corta") == 2
    with SessionLocal() as db:
        assert db.scalar(select(User).where(User.username == "cli_short")) is None
