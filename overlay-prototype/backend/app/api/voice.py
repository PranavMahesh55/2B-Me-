"""Privacy-safe spoken briefings.

Audio never reaches this service. ElevenLabs is an Electron-side transport;
this route only turns the same sanitized aggregates used by the assistant into
short, inspectable copy.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.app.api.assistant import current_context
from backend.app.audit.service import record_audit
from backend.app.db.session import get_db
from backend.app.runtime import runtime


router = APIRouter(prefix="/api/voice", tags=["voice"])


class BriefingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str | None = None
    length: Literal["short", "standard"] = "standard"


@router.post("/briefing")
def briefing(body: BriefingRequest, db: Session = Depends(get_db)) -> dict:
    score, workflow, context = current_context(db, body.session_id)
    generated_at = datetime.now(UTC).isoformat()
    if not score or context is None:
        text = (
            "I am still building your local baseline. I will prepare a spoken briefing "
            "after there is observed activity to ground it in."
        )
        return {
            "text": text,
            "sections": [{"label": "Status", "text": text}],
            "grounded_in": None,
            "generated_at": generated_at,
            "has_live_data": False,
            "model_version": runtime.model_config.version,
        }

    behavior = context.behavior
    evidence = context.evidence
    focus = round(behavior["focus"] * 100)
    friction = round(behavior["friction"] * 100)
    confidence = round(behavior["confidence"] * 100)
    switches = float(evidence.get("app_switches_per_min", 0.0))
    repeat_count = int(context.workflow.get("repeat_count", 0))

    status = f"Your current focus score is {focus}, with friction at {friction}."
    evidence_text = (
        f"That is grounded in {switches:.1f} application switches per minute "
        f"and {confidence}% model confidence."
    )
    if repeat_count and workflow:
        next_step = (
            f"I found a reviewable workflow that appeared {repeat_count} times. "
            "You can open its draft, but running it will still require Touch ID."
        )
    elif friction >= 44:
        next_step = "Consider reducing context switches before continuing this task."
    else:
        next_step = "Your current rhythm does not need an interruption right now."

    # During steady focus, keep the briefing deliberately compact even when the
    # saved preference asks for the standard version.
    compact = body.length == "short" or (focus >= 70 and friction < 44)
    sections = [{"label": "Now", "text": status}]
    if not compact:
        sections.append({"label": "Evidence", "text": evidence_text})
    sections.append({"label": "Next", "text": next_step})
    text = " ".join(section["text"] for section in sections)

    record_audit(
        db,
        "voice_briefing_generated",
        session_id=score.session_id,
        workflow_id=workflow.id if workflow else None,
        payload={"length": "short" if compact else "standard"},
    )
    db.commit()
    return {
        "text": text,
        "sections": sections,
        "grounded_in": context.model_dump(),
        "generated_at": generated_at,
        "has_live_data": True,
        "model_version": score.model_version,
    }
