from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import BehaviorScore, BehaviorSession, FeatureWindow
from backend.app.db.session import get_db
from backend.app.runtime import runtime


router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _score_payload(db: Session, score: BehaviorScore) -> dict:
    behavior_session = db.get(BehaviorSession, score.session_id)
    feature_window = db.scalar(
        select(FeatureWindow)
        .where(FeatureWindow.session_id == score.session_id)
        .order_by(desc(FeatureWindow.created_at))
    )
    return {
        "session_id": score.session_id,
        "task_id": score.task_id,
        "session_title": behavior_session.title if behavior_session else "Observed work session",
        "workflow_type": behavior_session.workflow_type if behavior_session else "unknown",
        "duration_s": (feature_window.features or {}).get("duration_s", 0) if feature_window else 0,
        "friction": score.friction,
        "focus": score.focus,
        "automation_potential": score.automation_potential,
        "confidence": score.confidence,
        "behavior_label": score.behavior_label,
        "evidence": score.evidence,
        "data_origin": score.data_origin,
        "model_version": score.model_version,
        "has_live_data": score.data_origin == "live_observed",
        "created_at": score.created_at.isoformat(),
    }


@router.get("/current")
def current_metrics(session_id: str | None = None, db: Session = Depends(get_db)) -> dict:
    query = select(BehaviorScore)
    if session_id:
        query = query.where(BehaviorScore.session_id == session_id)
    score = db.scalar(query.order_by(desc(BehaviorScore.created_at)))
    if score:
        return _score_payload(db, score)
    return {
        "session_id": None,
        "task_id": None,
        "session_title": "Waiting for observed activity",
        "workflow_type": None,
        "duration_s": 0,
        "friction": 0,
        "focus": 0,
        "automation_potential": 0,
        "confidence": 0,
        "behavior_label": "collecting_baseline",
        "evidence": {},
        "data_origin": None,
        "model_version": runtime.model_config.version,
        "has_live_data": False,
    }


@router.get("/history")
def metric_history(
    limit: int = 60,
    session_id: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(BehaviorScore)
    if session_id:
        query = query.where(BehaviorScore.session_id == session_id)
    scores = db.scalars(
        query.order_by(desc(BehaviorScore.created_at)).limit(min(limit, 240))
    ).all()
    return [_score_payload(db, score) for score in reversed(scores)]
