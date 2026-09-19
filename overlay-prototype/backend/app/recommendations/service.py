from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.config.settings import ModelConfig
from backend.app.db.models import BehaviorSession, Recommendation, WorkflowDefinition


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
    title = observation = reason = recommendation = ""

    if workflow and (
        workflow.automation_potential >= float(model_config.thresholds["automation_potential"])
        and workflow.repeat_count >= int(model_config.thresholds["automation_repeat_count"])
    ):
        recommendation_class = "automation"
        title = f"Assist with {workflow.name.lower()}"
        observation = f"This sequence has repeated {workflow.repeat_count} times."
        reason = "Its steps are consistent enough to prepare a restricted assisted workflow."
        recommendation = "Prepare the repeated steps for review before anything changes in another app."
    elif float(score["friction"]) >= 0.60 and float(evidence.get("app_switches_per_min", 0.0)) >= 4.2:
        recommendation_class = "workflow_consolidation"
        title = "Reduce cross-application switching"
        observation = "This task is moving between applications unusually often."
        reason = "Frequent switches and elevated friction occurred in the same task window."
        recommendation = "Keep the reference context beside the working application."
    elif float(evidence.get("backtrack_rate", 0.0)) >= 0.45:
        recommendation_class = "friction_reduction"
        title = "Reduce repeated backtracking"
        observation = "The same contexts are being reopened during this task."
        reason = "Backtracking crossed the configured behavioral threshold."
        recommendation = "Pin the two most-used contexts before continuing."

    if not recommendation_class:
        return None

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
    if existing and (not existing.cooldown_until or existing.cooldown_until > now):
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
        title=title,
        observation=observation,
        reason=reason,
        recommendation=recommendation,
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

