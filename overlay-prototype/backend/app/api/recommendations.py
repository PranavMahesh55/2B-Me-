from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.db.models import Recommendation, RecommendationFeedback
from backend.app.db.session import get_db
from backend.app.ingestion.schemas import FeedbackInput
from backend.app.ingestion.service import _recommendation_payload
from backend.app.runtime import runtime


router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get("")
def list_recommendations(db: Session = Depends(get_db)) -> list[dict]:
    items = db.scalars(
        select(Recommendation)
        .where(Recommendation.status == "active", Recommendation.suppress_forever.is_(False))
        .order_by(desc(Recommendation.priority), desc(Recommendation.created_at))
    ).all()
    return [_recommendation_payload(item) for item in items]


@router.post("/{recommendation_id}/feedback")
def add_feedback(
    recommendation_id: str,
    body: FeedbackInput,
    db: Session = Depends(get_db),
) -> dict:
    item = db.get(Recommendation, recommendation_id)
    if not item:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    db.add(
        RecommendationFeedback(
            recommendation_id=item.id,
            feedback=body.feedback,
            reason=body.reason,
        )
    )
    if body.feedback in {"dismissed", "not_useful", "wrong_interpretation"}:
        item.dismiss_count += 1
        if item.dismiss_count >= 2:
            item.cooldown_until = datetime.now(UTC) + timedelta(
                hours=int(runtime.model_config.thresholds["dismissed_cooldown_hours"])
            )
    elif body.feedback == "do_not_suggest_again":
        item.suppress_forever = True
        item.status = "suppressed"
    elif body.feedback == "accepted":
        item.status = "accepted"
    record_audit(
        db,
        "recommendation_feedback",
        session_id=item.session_id,
        workflow_id=item.workflow_id,
        payload={"recommendation_id": item.id, "feedback": body.feedback},
    )
    db.commit()
    return {"ok": True, "recommendation": _recommendation_payload(item)}

