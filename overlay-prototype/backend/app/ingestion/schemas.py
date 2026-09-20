from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EventType(StrEnum):
    APPLICATION_TRANSITION = "application_transition"
    WINDOW_FOCUS = "window_focus"
    MOUSE_ACTIVITY = "mouse_activity"
    CLICK = "click"
    SCROLL = "scroll"
    KEYBOARD_ACTIVITY = "keyboard_activity"
    CORRECTION = "correction"
    CLIPBOARD_ACTION = "clipboard_action"
    NAVIGATION = "navigation"
    IDLE = "idle"
    TASK_MARKER = "task_marker"
    AUTOMATION_ACTION = "automation_action"
    FEEDBACK = "feedback"


DataOrigin = Literal[
    "synthetic_bootstrap", "live_observed", "replay_observed", "empirical_test"
]


class NormalizedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(min_length=5, max_length=120)
    timestamp: datetime
    session_id: str = Field(min_length=5, max_length=120)
    task_id: str | None = Field(default=None, max_length=120)
    device_id: str = Field(default="device_local", max_length=120)
    application: str = Field(default="Unknown", max_length=160)
    window_context: str | None = Field(default=None, max_length=240)
    event_type: EventType
    action: str = Field(min_length=1, max_length=160)
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)
    metadata: dict[str, Any] = Field(default_factory=dict)
    data_origin: DataOrigin = "live_observed"

    @field_validator("window_context")
    @classmethod
    def redact_empty_context(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value[:240] or None


class EventBatch(BaseModel):
    events: list[NormalizedEvent] = Field(min_length=1, max_length=100)


class SessionStart(BaseModel):
    title: str = Field(default="Current work session", max_length=240)
    workflow_type: str = Field(default="research_browsing", max_length=80)
    device_id: str = Field(default="device_local", max_length=120)


class SessionStop(BaseModel):
    reason: str = Field(default="manual_stop", max_length=80)


class WorkflowStepInput(BaseModel):
    application: str = Field(min_length=1, max_length=160)
    action: str = Field(min_length=1, max_length=160)


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    workflow_type: str = Field(default="custom", max_length=80)
    steps: list[WorkflowStepInput] = Field(min_length=2, max_length=20)


class WorkflowUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    steps: list[WorkflowStepInput] = Field(min_length=2, max_length=20)


class FeedbackInput(BaseModel):
    feedback: Literal["accepted", "dismissed", "not_useful", "wrong_interpretation", "do_not_suggest_again"]
    reason: str | None = Field(default=None, max_length=240)


class ApprovalInput(BaseModel):
    permissions: list[str] = Field(min_length=1, max_length=12)


class GrantTokenInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claims: dict[str, Any]
    sig: str = Field(min_length=1, max_length=256)
    alg: str = Field(min_length=1, max_length=16)


class ExecuteInput(BaseModel):
    """The body of POST /api/automation/{plan_id}/execute.

    Claim internals are deliberately not validated here. The broker is the
    authority, and a second validator that disagreed with it would answer 422
    where the contract requires a GrantErrorCode.
    """

    model_config = ConfigDict(extra="forbid")

    token: GrantTokenInput
    plan: dict[str, Any]
    tamper: Literal["resource", "param", "exp", "sig"] | None = None


class PrivacyUpdate(BaseModel):
    enabled: bool
