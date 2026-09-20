from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.config.settings import ModelConfig
from backend.app.db.models import BehaviorSession, Recommendation, WorkflowDefinition
from backend.app.llm.adapter import get_explainer
from backend.app.llm.privacy import ContextSanitizer


def create_recommendation_if_warranted(
    db: Session,
    behavior_session: BehaviorSession,
    score: dict,
    model_config: ModelConfig,
    workflow: WorkflowDefinition | None = None,
) -> Recommendation | None:
    confidence_gate = float(model_config.thresholds["recommendation_confidence"])
    if float(score["confidence"]) < confidence_gate:
        return None

    evidence = score.get("evidence", {})
    recommendation_class: str | None = None

    if workflow and (
        workflow.automation_potential >= float(model_config.thresholds["automation_potential"])
        and workflow.repeat_count >= int(model_config.thresholds["automation_repeat_count"])
    ):
        recommendation_class = "automation"
    elif float(score["friction"]) >= 0.60 and float(evidence.get("app_switches_per_min", 0.0)) >= 4.2:
        recommendation_class = "workflow_consolidation"
    elif float(evidence.get("backtrack_rate", 0.0)) >= 0.45:
        recommendation_class = "friction_reduction"

    if not recommendation_class:
        return None

    # The branches above decide only WHICH class applies. The wording comes from
    # the explanation boundary, which sees a sanitized context and nothing else,
    # so swapping in a provider changes every recommendation at once and still
    # cannot reach raw events, window titles or application names.
    explanation = get_explainer().explain(
        ContextSanitizer().sanitize(
            {
                "name": workflow.name,
                "repeat_count": workflow.repeat_count,
                "average_duration_s": workflow.average_duration_s,
            }
            if workflow
            else None,
            score,
        ),
        recommendation_class,
    )

    existing = db.scalar(
        select(Recommendation)
        .where(
            Recommendation.session_id == behavior_session.id,
            Recommendation.recommendation_class == recommendation_class,
            Recommendation.suppress_forever.is_(False),
        )
        .order_by(desc(Recommendation.created_at))
    )
    now = datetime.now(UTC)
    existing_cooldown = existing.cooldown_until if existing else None
    if existing_cooldown and existing_cooldown.tzinfo is None:
        existing_cooldown = existing_cooldown.replace(tzinfo=UTC)
    if existing and (not existing_cooldown or existing_cooldown > now):
        return existing

    recurrence = min(1.0, float(evidence.get("workflow_repeat_count", 0)) / 10)
    priority = round(
        0.25 * float(score["confidence"])
        + 0.20 * recurrence
        + 0.15 * float(score["friction"])
        + 0.10 * 0.5,
        4,
    )
    item = Recommendation(
        workflow_id=workflow.id if workflow else None,
        session_id=behavior_session.id,
        recommendation_class=recommendation_class,
        title=explanation.title,
        observation=explanation.observation,
        reason=explanation.reason,
        recommendation=explanation.recommendation,
        confidence=float(score["confidence"]),
        priority=priority,
        evidence=evidence,
        cooldown_until=now + timedelta(minutes=int(model_config.thresholds["recommendation_cooldown_minutes"])),
        data_origin=behavior_session.data_origin,
        model_version=model_config.version,
    )
    db.add(item)
    db.flush()
    record_audit(
        db,
        "recommendation_generated",
        session_id=behavior_session.id,
        workflow_id=workflow.id if workflow else None,
        payload={"recommendation_id": item.id, "class": recommendation_class},
    )
    return item
