from __future__ import annotations

from sqlalchemy.orm import Session

from backend.app.db.models import AuditEvent


def record_audit(
    db: Session,
    event: str,
    *,
    session_id: str | None = None,
    workflow_id: str | None = None,
    plan_id: str | None = None,
    payload: dict | None = None,
) -> AuditEvent:
    audit = AuditEvent(
        event=event,
        session_id=session_id,
        workflow_id=workflow_id,
        plan_id=plan_id,
        payload=payload or {},
    )
    db.add(audit)
    return audit

