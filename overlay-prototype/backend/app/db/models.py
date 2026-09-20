from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.session import Base


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now_utc() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("user"))
    display_name: Mapped[str] = mapped_column(String, default="Local user")


class Device(TimestampMixin, Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("device"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, default="Local device")


class BehaviorSession(TimestampMixin, Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("sess"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    device_id: Mapped[str] = mapped_column(String, default="device_local")
    title: Mapped[str] = mapped_column(String, default="Current work session")
    workflow_type: Mapped[str] = mapped_column(String, default="research_browsing")
    status: Mapped[str] = mapped_column(String, default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")

    tasks: Mapped[list["Task"]] = relationship(back_populates="session")
    events: Mapped[list["RawEvent"]] = relationship(back_populates="session")


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("task"))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    title: Mapped[str] = mapped_column(String, default="Current task")
    workflow_type: Mapped[str] = mapped_column(String, default="research_browsing")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")

    session: Mapped[BehaviorSession] = relationship(back_populates="tasks")


class RawEvent(Base):
    __tablename__ = "raw_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("evt"))
    event_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    device_id: Mapped[str] = mapped_column(String, default="device_local")
    application: Mapped[str] = mapped_column(String, default="Unknown")
    window_context: Mapped[str | None] = mapped_column(String, nullable=True)
    event_type: Mapped[str] = mapped_column(String, index=True)
    action: Mapped[str] = mapped_column(String)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

    session: Mapped[BehaviorSession] = relationship(back_populates="events")


class FeatureWindow(Base):
    __tablename__ = "feature_windows"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("feat"))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    window_type: Mapped[str] = mapped_column(String, default="whole_task")
    features: Mapped[dict] = mapped_column(JSON)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    model_version: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class BehaviorScore(Base):
    __tablename__ = "behavior_scores"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("score"))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    friction: Mapped[float] = mapped_column(Float)
    focus: Mapped[float] = mapped_column(Float)
    automation_potential: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    behavior_label: Mapped[str] = mapped_column(String)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    model_version: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class WorkflowDefinition(TimestampMixin, Base):
    __tablename__ = "workflow_definitions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("wf"))
    signature: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    workflow_type: Mapped[str] = mapped_column(String, default="unknown")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    graph: Mapped[dict] = mapped_column(JSON, default=dict)
    repeat_count: Mapped[int] = mapped_column(Integer, default=1)
    average_duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    predictability: Mapped[float] = mapped_column(Float, default=0.0)
    automation_potential: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    model_version: Mapped[str] = mapped_column(String)


class WorkflowInstance(Base):
    __tablename__ = "workflow_instances"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("wfi"))
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow_definitions.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    sequence: Mapped[list] = mapped_column(JSON)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Recommendation(TimestampMixin, Base):
    __tablename__ = "recommendations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("rec"))
    workflow_id: Mapped[str | None] = mapped_column(ForeignKey("workflow_definitions.id"), nullable=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id"), nullable=True)
    recommendation_class: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    observation: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    priority: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="active")
    last_shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dismiss_count: Mapped[int] = mapped_column(Integer, default=0)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suppress_forever: Mapped[bool] = mapped_column(Boolean, default=False)
    data_origin: Mapped[str] = mapped_column(String, default="live_observed")
    model_version: Mapped[str] = mapped_column(String)


class RecommendationFeedback(Base):
    __tablename__ = "recommendation_feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("feedback"))
    recommendation_id: Mapped[str] = mapped_column(ForeignKey("recommendations.id"), index=True)
    feedback: Mapped[str] = mapped_column(String)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class AutomationPlan(TimestampMixin, Base):
    __tablename__ = "automation_plans"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("plan"))
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflow_definitions.id"), index=True)
    actions: Mapped[list] = mapped_column(JSON)
    required_permissions: Mapped[list] = mapped_column(JSON)
    safety_level: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String, default="awaiting_approval")


class AutomationRun(Base):
    __tablename__ = "automation_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("run"))
    plan_id: Mapped[str] = mapped_column(ForeignKey("automation_plans.id"), index=True)
    status: Mapped[str] = mapped_column(String)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PermissionGrant(Base):
    """Superseded by GrantReceipt.

    An approval boolean with no attestation behind it is not an authorization:
    anything that could write this row could also authorize itself. Kept so the
    existing table and any rows in it stay readable; nothing writes it now, and
    execute_plan no longer reads plan.status == "approved".
    """

    __tablename__ = "permission_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("perm"))
    plan_id: Mapped[str] = mapped_column(ForeignKey("automation_plans.id"), index=True)
    capability: Mapped[str] = mapped_column(String)
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class GrantReceipt(Base):
    """What the broker returned for a verified grant (§2's receipt).

    A new table rather than columns on permission_grants: initialize_database()
    only calls Base.metadata.create_all(), which creates missing tables but never
    adds columns, and the project has no alembic migrations. Altering the old
    table would silently do nothing on any existing dev database.
    """

    __tablename__ = "grant_receipts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("grant"))
    plan_id: Mapped[str] = mapped_column(ForeignKey("automation_plans.id"), index=True)
    # A second, independent replay barrier. If this ever fires, the broker's
    # spent store has a bug.
    jti: Mapped[str] = mapped_column(String, unique=True, index=True)
    outcome: Mapped[str] = mapped_column(String, index=True)
    audit_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audit_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    executed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("audit"))
    event: Mapped[str] = mapped_column(String, index=True)
    session_id: Mapped[str | None] = mapped_column(String, nullable=True)
    workflow_id: Mapped[str | None] = mapped_column(String, nullable=True)
    plan_id: Mapped[str | None] = mapped_column(String, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)


class ModelConfigRecord(Base):
    __tablename__ = "model_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: new_id("model"))
    version: Mapped[str] = mapped_column(String, unique=True)
    data_origin: Mapped[str] = mapped_column(String)
    config: Mapped[dict] = mapped_column(JSON)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class SyntheticBaseline(Base):
    __tablename__ = "synthetic_baselines"

    workflow_type: Mapped[str] = mapped_column(String, primary_key=True)
    session_count: Mapped[int] = mapped_column(Integer)
    averages: Mapped[dict] = mapped_column(JSON)
    data_origin: Mapped[str] = mapped_column(String, default="synthetic_bootstrap")
    model_version: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class PrivacySetting(TimestampMixin, Base):
    __tablename__ = "privacy_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
