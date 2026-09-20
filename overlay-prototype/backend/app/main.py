from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import assistant, audit, automation, events, metrics, recommendations, sessions, system, voice, websocket, workflows
from backend.app.api.websocket import manager
from backend.app.config.settings import settings
from backend.app.db.models import PrivacySetting
from backend.app.db.session import SessionLocal, initialize_database
from backend.app.runtime import runtime
from backend.app.synthetic.loader import seed_bootstrap_data


DEFAULT_PRIVACY = {
    "application_activity": True,
    "window_switching": True,
    "window_titles": False,
    "browser_context": True,
    "keyboard_timing": True,
    "clipboard_metadata": False,
    "visual_interpretation": False,
    "terminal_activity": True,
    "ai_analysis": True,
}


async def heartbeat() -> None:
    while True:
        await asyncio.sleep(15)
        await manager.broadcast(
            {
                "type": "system_status",
                "payload": {"status": runtime.status, "model_version": runtime.model_config.version},
            }
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    with SessionLocal() as db:
        if settings.data_mode == "synthetic":
            runtime.seeded_sessions = seed_bootstrap_data(
                db, settings.synthetic_data_path, runtime.model_config
            )
        for key, enabled in DEFAULT_PRIVACY.items():
            if not db.get(PrivacySetting, key):
                db.add(PrivacySetting(key=key, enabled=enabled))
        db.commit()
    runtime.status = "READY"
    heartbeat_task = asyncio.create_task(heartbeat())
    yield
    heartbeat_task.cancel()
    with suppress(asyncio.CancelledError):
        await heartbeat_task


app = FastAPI(
    title="2Bme Local Intelligence Service",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173", "null"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(events.router)
app.include_router(sessions.router)
app.include_router(metrics.router)
app.include_router(workflows.router)
app.include_router(recommendations.router)
app.include_router(automation.router)
app.include_router(assistant.router)
app.include_router(voice.router)
app.include_router(audit.router)
app.include_router(system.router)
app.include_router(websocket.router)


@app.get("/")
def root() -> dict:
    return {"service": "2Bme local intelligence", "status": runtime.status, "docs": "/docs"}
