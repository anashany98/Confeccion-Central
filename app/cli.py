from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import select

from .database import SessionLocal
from .models import User
from .security import hash_password


def create_admin(username: str | None, full_name: str | None, password: str | None) -> int:
    username = (username or os.getenv("ADMIN_USERNAME") or "admin").strip().lower()
    full_name = (full_name or os.getenv("ADMIN_FULL_NAME") or "Administrador").strip()
    password = password or os.getenv("ADMIN_PASSWORD")
    if not password and sys.stdin.isatty():
        password = getpass.getpass("Contraseña del administrador: ")
    if not password or len(password) < 10:
        print("La contraseña debe tener al menos 10 caracteres.", file=sys.stderr)
        return 2
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.username == username))
        if existing:
            print(f"El usuario {username} ya existe; no se ha modificado.")
            return 0
        user = User(
            username=username,
            full_name=full_name,
            password_hash=hash_password(password),
            role="admin",
            permissions_json=None,
        )
        db.add(user)
        db.commit()
        print(f"Administrador {username} creado.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Administración de Confección Central")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-admin", help="Crea el administrador inicial")
    create.add_argument("--username")
    create.add_argument("--full-name")
    create.add_argument("--password")
    args = parser.parse_args()
    if args.command == "create-admin":
        return create_admin(args.username, args.full_name, args.password)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
