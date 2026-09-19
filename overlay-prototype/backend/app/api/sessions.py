from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import BehaviorScore, BehaviorSession, RawEvent, Task
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import SessionStart, SessionStop
from backend.app.runtime import runtime


router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def serialize_session(item: BehaviorSession, event_count: int = 0) -> dict:
    duration = ((item.ended_at or datetime.now(UTC)) - _aware(item.started_at)).total_seconds()
    return {
        "id": item.id,
        "title": item.title,
        "workflow_type": item.workflow_type,
        "status": item.status,
        "started_at": item.started_at.isoformat(),
        "ended_at": item.ended_at.isoformat() if item.ended_at else None,
        "duration_s": max(0, round(duration, 1)),
        "event_count": event_count,
        "data_origin": item.data_origin,
    }


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


@router.post("/start")
def start_session(body: SessionStart, db: Session = Depends(get_db)) -> dict:
    behavior_session = BehaviorSession(
        title=body.title,
        workflow_type=body.workflow_type,
        device_id=body.device_id,
        status="active",
        data_origin="live_observed",
    )
    db.add(behavior_session)
    db.flush()
    task = Task(
        session_id=behavior_session.id,
        title=body.title,
        workflow_type=body.workflow_type,
        data_origin="live_observed",
    )
    db.add(task)
    record_audit(db, "session_started", session_id=behavior_session.id)
    db.commit()
    runtime.status = "COLLECTING"
    return {**serialize_session(behavior_session), "task_id": task.id}


@router.post("/{session_id}/stop")
def stop_session(session_id: str, body: SessionStop, db: Session = Depends(get_db)) -> dict:
    behavior_session = db.get(BehaviorSession, session_id)
    if not behavior_session:
        raise HTTPException(status_code=404, detail="Session not found")
    behavior_session.status = "completed"
    behavior_session.ended_at = datetime.now(UTC)
    for task in db.scalars(select(Task).where(Task.session_id == session_id)).all():
        if not task.ended_at:
            task.ended_at = behavior_session.ended_at
    record_audit(db, "session_stopped", session_id=session_id, payload={"reason": body.reason})
    db.commit()
    runtime.status = "READY"
    return serialize_session(behavior_session)


@router.get("")
def list_sessions(limit: int = 30, db: Session = Depends(get_db)) -> list[dict]:
    items = db.scalars(
        select(BehaviorSession).order_by(desc(BehaviorSession.started_at)).limit(min(limit, 100))
    ).all()
    return [
        serialize_session(
            item,
            len(db.scalars(select(RawEvent.id).where(RawEvent.session_id == item.id)).all()),
        )
        for item in items
    ]


@router.get("/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)) -> dict:
    item = db.get(BehaviorSession, session_id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    scores = db.scalars(
        select(BehaviorScore)
        .where(BehaviorScore.session_id == session_id)
        .order_by(desc(BehaviorScore.created_at))
        .limit(20)
    ).all()
    payload = serialize_session(
        item, len(db.scalars(select(RawEvent.id).where(RawEvent.session_id == item.id)).all())
    )
    payload["scores"] = [
        {
            "friction": score.friction,
            "focus": score.focus,
            "automation_potential": score.automation_potential,
            "confidence": score.confidence,
            "behavior_label": score.behavior_label,
            "created_at": score.created_at.isoformat(),
        }
        for score in scores
    ]
    return payload

