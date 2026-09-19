from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.api.websocket import manager
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import EventBatch
from backend.app.ingestion.service import ingest_events


router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("/batch")
async def post_event_batch(batch: EventBatch, db: Session = Depends(get_db)) -> dict:
    payload = ingest_events(db, batch.events)
    if payload.get("has_live_data"):
        await manager.broadcast({"type": "behavior_update", "payload": payload})
        if payload.get("workflow"):
            await manager.broadcast({"type": "workflow_updated", "payload": payload["workflow"]})
        if payload.get("recommendation"):
            await manager.broadcast(
                {"type": "recommendation_created", "payload": payload["recommendation"]}
            )
    return payload

