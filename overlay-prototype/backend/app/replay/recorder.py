from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import RawEvent


def record_session(db: Session, session_id: str, output_path: Path) -> int:
    events = db.scalars(
        select(RawEvent)
        .where(RawEvent.session_id == session_id)
        .order_by(RawEvent.timestamp)
    ).all()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(
                json.dumps(
                    {
                        "event_id": event.event_id,
                        "timestamp": event.timestamp.isoformat(),
                        "session_id": event.session_id,
                        "task_id": event.task_id,
                        "device_id": event.device_id,
                        "application": event.application,
                        "window_context": event.window_context,
                        "event_type": event.event_type,
                        "action": event.action,
                        "duration_ms": event.duration_ms,
                        "metadata": event.metadata_json,
                        "data_origin": event.data_origin,
                    },
                    separators=(",", ":"),
                )
                + "\n"
            )
    return len(events)

