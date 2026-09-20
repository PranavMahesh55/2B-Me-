from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.db.models import (
    BehaviorScore,
    BehaviorSession,
    FeatureWindow,
    PrivacySetting,
    RawEvent,
    SyntheticBaseline,
    Task,
)
from backend.app.features.extractor import extract_features
from backend.app.ingestion.schemas import NormalizedEvent
from backend.app.recommendations.service import create_recommendation_if_warranted
from backend.app.runtime import runtime
from backend.app.workflows.detector import detect_workflow


SENSITIVE_METADATA_KEYS = {
    "content",
    "text",
    "clipboard_content",
    "clipboard_contents",
    "keystrokes",
    "password",
    "secret",
}


def _privacy(db: Session) -> dict[str, bool]:
    return {row.key: row.enabled for row in db.scalars(select(PrivacySetting)).all()}


def _sanitized_metadata(metadata: dict) -> dict:
    return {
        key: value
        for key, value in metadata.items()
        if key.lower() not in SENSITIVE_METADATA_KEYS
        and not any(term in key.lower() for term in ("password", "secret", "token"))
    }


def ingest_events(db: Session, incoming: list[NormalizedEvent]) -> dict:
    if runtime.status == "PAUSED":
        return {"accepted": 0, "ignored": len(incoming), "status": "PAUSED", "has_live_data": False}
    privacy = _privacy(db)
    event_ids = [item.event_id for item in incoming]
    existing_ids = set(
        db.scalars(select(RawEvent.event_id).where(RawEvent.event_id.in_(event_ids))).all()
    )
    accepted = 0
    touched_sessions: set[str] = set()

    for event in incoming:
        if event.event_id in existing_ids:
            continue
        behavior_session = db.get(BehaviorSession, event.session_id)
        if not behavior_session:
            behavior_session = BehaviorSession(
                id=event.session_id,
                device_id=event.device_id,
                title="Observed work session",
                data_origin=event.data_origin,
            )
            db.add(behavior_session)
        task_id = event.task_id
        if task_id and not db.get(Task, task_id):
            db.add(
                Task(
                    id=task_id,
                    session_id=event.session_id,
                    title="Observed task",
                    workflow_type=behavior_session.workflow_type,
                    data_origin=event.data_origin,
                )
            )

        application = event.application if privacy.get("application_activity", True) else "Private application"
        window_context = event.window_context
        if not privacy.get("window_titles", True):
            window_context = None
        if event.event_type == "navigation" and not privacy.get("browser_context", True):
            window_context = None
        if event.event_type == "clipboard_action" and not privacy.get("clipboard_metadata", False):
            continue
        if event.event_type == "application_transition" and not privacy.get("window_switching", True):
            continue

        db.add(
            RawEvent(
                event_id=event.event_id,
                timestamp=event.timestamp,
                session_id=event.session_id,
                task_id=task_id,
                device_id=event.device_id,
                application=application,
                window_context=window_context,
                event_type=str(event.event_type),
                action=event.action,
                duration_ms=event.duration_ms,
                metadata_json=_sanitized_metadata(event.metadata),
                data_origin=event.data_origin,
            )
        )
        touched_sessions.add(event.session_id)
        accepted += 1

    db.flush()
    latest_payload: dict = {"accepted": accepted, "duplicates": len(incoming) - accepted}
    for session_id in touched_sessions:
        behavior_session = db.get(BehaviorSession, session_id)
        events = list(
            db.scalars(
                select(RawEvent)
                .where(RawEvent.session_id == session_id)
                .order_by(RawEvent.timestamp)
            ).all()
        )
        baseline = db.get(SyntheticBaseline, behavior_session.workflow_type)
        baseline_duration = (
            float(baseline.averages.get("duration_s", 900.0)) if baseline else 900.0
        )
        features = extract_features(events, baseline_duration_s=baseline_duration)
        first_score = runtime.scoring.score(features).as_dict()
        workflow = detect_workflow(
            db, behavior_session, features, first_score, runtime.model_config
        )
        if workflow:
            features["workflow_repeat_count"] = workflow.repeat_count
        score = runtime.scoring.score(features).as_dict()
        score = _blend_with_bootstrap(db, score, baseline, features)
        if workflow:
            workflow.automation_potential = score["automation_potential"]
            workflow.confidence = score["confidence"]

        task_id = next((event.task_id for event in reversed(events) if event.task_id), None)
        db.add(
            FeatureWindow(
                session_id=session_id,
                task_id=task_id,
                window_type="whole_task",
                features={
                    key: value
                    for key, value in features.items()
                    if key not in {"tokens", "workflow_tokens"}
                },
                data_origin=behavior_session.data_origin,
                model_version=runtime.model_config.version,
            )
        )
        stored_score = BehaviorScore(
            session_id=session_id,
            task_id=task_id,
            friction=score["friction"],
            focus=score["focus"],
            automation_potential=score["automation_potential"],
            confidence=score["confidence"],
            behavior_label=score["behavior_label"],
            evidence=score["evidence"],
            data_origin=behavior_session.data_origin,
            model_version=runtime.model_config.version,
        )
        db.add(stored_score)
        db.flush()
        recommendation = create_recommendation_if_warranted(
            db, behavior_session, score, runtime.model_config, workflow
        )
        latest_payload = {
            "accepted": accepted,
            "duplicates": len(incoming) - accepted,
            "session_id": session_id,
            "task_id": task_id,
            "session_title": behavior_session.title,
            "workflow_type": behavior_session.workflow_type,
            "duration_s": features["duration_s"],
            "friction": score["friction"],
            "focus": score["focus"],
            "automation_potential": score["automation_potential"],
            "confidence": score["confidence"],
            "behavior_label": score["behavior_label"],
            "evidence": score["evidence"],
            "data_origin": behavior_session.data_origin,
            "model_version": runtime.model_config.version,
            "workflow": _workflow_payload(workflow) if workflow else None,
            "recommendation": _recommendation_payload(recommendation) if recommendation else None,
            "has_live_data": True,
        }
    db.commit()
    runtime.status = "COLLECTING" if accepted else runtime.status
    return latest_payload


def _blend_with_bootstrap(
    db: Session,
    score: dict,
    baseline: SyntheticBaseline | None,
    features: dict,
) -> dict:
    if not baseline:
        return score
    observed_tasks = int(
        db.scalar(select(func.count(Task.id)).where(Task.data_origin == "live_observed")) or 0
    )
    band = next(
        item
        for item in runtime.model_config.personal_baseline_blend
        if item["max_observed_tasks"] is None
        or observed_tasks <= int(item["max_observed_tasks"])
    )
    bootstrap_weight = float(band["bootstrap"])
    personal_weight = float(band["personal"])
    mapping = {
        "friction": "friction_score",
        "focus": "focus_score",
        "automation_potential": "automation_potential",
    }
    for score_key, baseline_key in mapping.items():
        score[score_key] = round(
            bootstrap_weight * float(baseline.averages[baseline_key])
            + personal_weight * float(score[score_key]),
            4,
        )
    repeat_count = int(features.get("workflow_repeat_count", 0))
    if (
        score["automation_potential"]
        >= float(runtime.model_config.thresholds["automation_potential"])
        and repeat_count >= int(runtime.model_config.thresholds["automation_repeat_count"])
    ):
        score["behavior_label"] = "automation_candidate"
    elif score["friction"] >= float(runtime.model_config.thresholds["friction_high"]):
        score["behavior_label"] = "high_friction"
    elif score["friction"] >= float(runtime.model_config.thresholds["friction_moderate"]):
        score["behavior_label"] = "moderate_friction"
    else:
        score["behavior_label"] = "focused_or_low_friction"
    score["evidence"] = {
        **score["evidence"],
        "baseline_workflow_type": baseline.workflow_type,
        "bootstrap_baseline_weight": bootstrap_weight,
        "personal_baseline_weight": personal_weight,
        "observed_task_count": observed_tasks,
    }
    return score


def _workflow_payload(workflow) -> dict | None:
    if not workflow:
        return None
    return {
        "id": workflow.id,
        "name": workflow.name,
        "workflow_type": workflow.workflow_type,
        "steps": workflow.steps,
        "repeat_count": workflow.repeat_count,
        "average_duration_s": workflow.average_duration_s,
        "predictability": workflow.predictability,
        "automation_potential": workflow.automation_potential,
        "confidence": workflow.confidence,
        "data_origin": workflow.data_origin,
    }


def _recommendation_payload(item) -> dict | None:
    if not item:
        return None
    return {
        "id": item.id,
        "workflow_id": item.workflow_id,
        "class": item.recommendation_class,
        "title": item.title,
        "observation": item.observation,
        "reason": item.reason,
        "recommendation": item.recommendation,
        "confidence": item.confidence,
        "priority": item.priority,
        "evidence": item.evidence,
        "status": item.status,
        "data_origin": item.data_origin,
    }
