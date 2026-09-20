from datetime import UTC, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    BehaviorScore,
    BehaviorSession,
    FeatureWindow,
    RawEvent,
    SyntheticBaseline,
)
from backend.app.db.session import get_db
from backend.app.features.extractor import extract_features
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


@router.get("/rhythm")
def rhythm_series(
    session_id: str | None = None,
    points: int = 36,
    span_minutes: int = 60,
    db: Session = Depends(get_db),
) -> dict:
    """A genuinely windowed focus series.

    /metrics/history is not a rhythm: every BehaviorScore is recomputed over the
    whole session, so consecutive points re-aggregate the same events and the
    line flattens as the session grows -- 60 stored points can hold a single
    distinct value. This evaluates the same scorer over a trailing window at
    each step instead, so the series reflects when the work happened.
    """
    points = max(4, min(points, 120))
    span = timedelta(minutes=max(5, min(span_minutes, 480)))

    if session_id:
        behavior_session = db.get(BehaviorSession, session_id)
    else:
        # The most recently STARTED session is often an empty one; the session
        # with the newest event is the one the user is actually working in.
        newest = db.scalar(select(RawEvent).order_by(desc(RawEvent.timestamp)))
        behavior_session = db.get(BehaviorSession, newest.session_id) if newest else None
    if not behavior_session:
        return {"session_id": None, "span_minutes": span.total_seconds() / 60, "points": []}

    events = list(
        db.scalars(
            select(RawEvent)
            .where(RawEvent.session_id == behavior_session.id)
            .order_by(RawEvent.timestamp)
        ).all()
    )
    if len(events) < 2:
        return {"session_id": behavior_session.id, "span_minutes": span.total_seconds() / 60, "points": []}

    def aware(value):
        return value if value.tzinfo else value.replace(tzinfo=UTC)

    last = aware(events[-1].timestamp)
    first = max(aware(events[0].timestamp), last - span)
    total = (last - first).total_seconds()
    if total <= 0:
        return {"session_id": behavior_session.id, "span_minutes": span.total_seconds() / 60, "points": []}

    baseline = db.get(SyntheticBaseline, behavior_session.workflow_type)
    baseline_duration = float(baseline.averages.get("duration_s", 900.0)) if baseline else 900.0
    # A trailing window wide enough to hold several events. Too narrow and a
    # window holding two transitions scores as perfect focus, so the whole
    # series saturates at 100; too wide and it converges on the whole-session
    # aggregate this endpoint exists to avoid.
    window = timedelta(seconds=min(max(total / 8, 240), 900))

    series = []
    for index in range(points):
        at = first + timedelta(seconds=total * (index + 1) / points)
        bucket = [event for event in events if at - window <= aware(event.timestamp) <= at]
        if len(bucket) < 2:
            continue
        features = extract_features(bucket, baseline_duration_s=baseline_duration)
        score = runtime.scoring.score(features).as_dict()
        series.append(
            {
                "at": at.isoformat(),
                "minutes_ago": round((last - at).total_seconds() / 60, 1),
                "focus": round(score["focus"], 4),
                "friction": round(score["friction"], 4),
                "confidence": round(score["confidence"], 4),
                "events": len(bucket),
            }
        )

    return {
        "session_id": behavior_session.id,
        "span_minutes": span.total_seconds() / 60,
        "window_seconds": round(window.total_seconds()),
        "points": series,
    }
