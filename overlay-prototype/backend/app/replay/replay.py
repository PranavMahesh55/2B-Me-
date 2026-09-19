from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend.app.db.session import SessionLocal, initialize_database
from backend.app.ingestion.schemas import NormalizedEvent
from backend.app.ingestion.service import ingest_events


def replay(path: Path) -> dict:
    events: list[NormalizedEvent] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            payload = json.loads(line)
            payload["data_origin"] = "replay_observed"
            events.append(NormalizedEvent.model_validate(payload))
    initialize_database()
    result: dict = {}
    with SessionLocal() as db:
        for offset in range(0, len(events), 100):
            result = ingest_events(db, events[offset : offset + 100])
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Replay normalized 2Bme events")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    print(json.dumps(replay(args.path), indent=2, default=str))


if __name__ == "__main__":
    main()

