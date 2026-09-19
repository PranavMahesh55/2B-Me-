from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.api.websocket import manager
from backend.app.db.models import PrivacySetting
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import PrivacyUpdate
from backend.app.runtime import runtime


router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/status")
def system_status() -> dict:
    return {
        "status": runtime.status,
        "service": "2Bme local intelligence",
        "local_only": True,
        "data_mode": "synthetic_bootstrap_baseline",
        "seeded_baseline_sessions": runtime.seeded_sessions,
        "model_version": runtime.model_config.version,
        "websocket_clients": len(manager.connections),
    }


@router.post("/system/pause")
async def pause_system() -> dict:
    runtime.status = "PAUSED"
    payload = {"status": runtime.status}
    await manager.broadcast({"type": "system_status", "payload": payload})
    return payload


@router.post("/system/resume")
async def resume_system() -> dict:
    runtime.status = "COLLECTING"
    payload = {"status": runtime.status}
    await manager.broadcast({"type": "system_status", "payload": payload})
    return payload


@router.get("/privacy")
def privacy_settings(db: Session = Depends(get_db)) -> dict[str, bool]:
    return {item.key: item.enabled for item in db.scalars(select(PrivacySetting)).all()}


@router.put("/privacy/{key}")
def update_privacy(key: str, body: PrivacyUpdate, db: Session = Depends(get_db)) -> dict:
    setting = db.get(PrivacySetting, key)
    if not setting:
        setting = PrivacySetting(key=key, enabled=body.enabled)
        db.add(setting)
    else:
        setting.enabled = body.enabled
    db.commit()
    return {"key": key, "enabled": setting.enabled}

