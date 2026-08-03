from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def uuid_str() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin','office','cut')", name="ck_user_role"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), default="")
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default="office", index=True)
    permissions_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    password_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint("status IN ('draft','in_cut','cut_completed')", name="ck_job_status"),
        CheckConstraint("version >= 1", name="ck_job_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    code: Mapped[str] = mapped_column(String(40), default="", index=True)
    name: Mapped[str] = mapped_column(String(200), default="Trabajo sin nombre", index=True)
    client: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    state_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    versions_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    updated_by: Mapped[User | None] = relationship(foreign_keys=[updated_by_id])
    rooms: Mapped[list[JobRoom]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobRoom.position"
    )


class JobRoom(Base):
    __tablename__ = "job_rooms"
    __table_args__ = (
        UniqueConstraint("job_id", "source_id", name="uq_job_room_source"),
        CheckConstraint("width_m > 0", name="ck_job_room_width_positive"),
        CheckConstraint("height_m > 0", name="ck_job_room_height_positive"),
        CheckConstraint("sheets BETWEEN 1 AND 10", name="ck_job_room_sheets"),
        CheckConstraint("opening IN ('central','left','right')", name="ck_job_room_opening"),
        Index("ix_job_room_job_position", "job_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    source_id: Mapped[str] = mapped_column(String(80))
    room_code: Mapped[str] = mapped_column(String(120), index=True)
    width_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    height_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    gather: Mapped[Any] = mapped_column(Numeric(8, 4))
    hem_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    sheets: Mapped[int] = mapped_column(SmallInteger)
    opening: Mapped[str] = mapped_column(String(20), default="central")
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="pending")
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    job: Mapped[Job] = relationship(back_populates="rooms")


class HistoryEvent(Base):
    __tablename__ = "history_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(40), index=True)
    entity_type: Mapped[str] = mapped_column(String(40), default="job")
    entity_id: Mapped[str] = mapped_column(String(80), default="")
    summary: Mapped[str] = mapped_column(String(500))
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    field_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )

    user: Mapped[User | None] = relationship()


class CutOrder(Base):
    __tablename__ = "cut_orders"
    __table_args__ = (
        UniqueConstraint("job_id", "revision", name="uq_order_job_revision"),
        CheckConstraint(
            "status IN ('sent','received','printed','in_process','completed','cancelled')",
            name="ck_order_status",
        ),
        CheckConstraint("revision >= 1", name="ck_order_revision"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    order_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="sent", index=True)
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    job: Mapped[Job] = relationship()
    created_by: Mapped[User | None] = relationship()
    items: Mapped[list[CutOrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="CutOrderItem.position"
    )


class CutOrderItem(Base):
    __tablename__ = "cut_order_items"
    __table_args__ = (
        CheckConstraint("width_m > 0", name="ck_order_item_width_positive"),
        CheckConstraint("height_m > 0", name="ck_order_item_height_positive"),
        CheckConstraint("sheets BETWEEN 1 AND 10", name="ck_order_item_sheets"),
        CheckConstraint("opening IN ('central','left','right')", name="ck_order_item_opening"),
        Index("ix_order_item_order_position", "order_id", "position"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    order_id: Mapped[str] = mapped_column(
        ForeignKey("cut_orders.id", ondelete="RESTRICT"), index=True
    )
    source_room_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    room_code: Mapped[str] = mapped_column(String(120))
    width_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    height_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    gather: Mapped[Any] = mapped_column(Numeric(8, 4))
    hem_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    sheets: Mapped[int] = mapped_column(SmallInteger)
    measure_per_sheet_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    fabric_m: Mapped[Any] = mapped_column(Numeric(12, 4))
    opening: Mapped[str] = mapped_column(String(20), default="central")
    notes: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)

    order: Mapped[CutOrder] = relationship(back_populates="items")


class PrintLog(Base):
    __tablename__ = "print_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    order_id: Mapped[str] = mapped_column(
        ForeignKey("cut_orders.id", ondelete="RESTRICT"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    document_type: Mapped[str] = mapped_column(String(40), default="all")
    is_reprint: Mapped[bool] = mapped_column(Boolean, default=False)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User | None] = relationship()


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = (Index("ix_login_attempt_lookup", "username", "ip_address", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    username: Mapped[str] = mapped_column(String(80), index=True)
    ip_address: Mapped[str] = mapped_column(String(64), default="", index=True)
    successful: Mapped[bool] = mapped_column(Boolean, default=False)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (CheckConstraint("size_bytes >= 0", name="ck_document_size"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
