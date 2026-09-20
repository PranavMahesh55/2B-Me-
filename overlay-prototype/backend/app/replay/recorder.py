"""The recording half of the record/replay loop.

Writes a session's stored events in exactly the shape `replay.py` reads back, so
`python -m backend.app.replay.recorder <session> --out f.jsonl` followed by
`python -m backend.app.replay.replay f.jsonl` round-trips. The replayed copy is
tagged `replay_observed` by the reader, so it never masquerades as live history.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.db.models import RawEvent
from backend.app.db.session import SessionLocal, initialize_database


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



def main() -> None:
    parser = argparse.ArgumentParser(description="Record a 2Bme session to normalized JSONL")
    parser.add_argument("session_id")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    initialize_database()
    with SessionLocal() as db:
        count = record_session(db, args.session_id, args.out)
    print(
        json.dumps(
            {"session_id": args.session_id, "events": count, "path": str(args.out)},
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
