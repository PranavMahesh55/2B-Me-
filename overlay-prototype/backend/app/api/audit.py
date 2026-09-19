from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import AuditEvent
from backend.app.db.session import get_db


router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def list_audit_events(limit: int = 100, db: Session = Depends(get_db)) -> list[dict]:
    events = db.scalars(
        select(AuditEvent).order_by(desc(AuditEvent.created_at)).limit(min(limit, 500))
    ).all()
    return [
        {
            "id": event.id,
            "event": event.event,
            "session_id": event.session_id,
            "workflow_id": event.workflow_id,
            "plan_id": event.plan_id,
            "payload": event.payload,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]

