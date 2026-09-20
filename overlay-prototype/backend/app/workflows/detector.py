from __future__ import annotations

import hashlib
from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.audit.service import record_audit
from backend.app.config.settings import ModelConfig
from backend.app.db.models import (
    BehaviorSession,
    WorkflowDefinition,
    WorkflowInstance,
)


def _candidate(tokens: list[str]) -> tuple[tuple[str, ...], int] | None:
    best: tuple[tuple[str, ...], int] | None = None
    best_weight = 0
    for size in range(3, min(7, len(tokens) + 1)):
        sequences = {
            tuple(tokens[index : index + size])
            for index in range(len(tokens) - size + 1)
        }
        for sequence in sequences:
            if len(set(sequence)) < 2:
                continue
            count = 0
            index = 0
            while index <= len(tokens) - size:
                if tuple(tokens[index : index + size]) == sequence:
                    count += 1
                    index += size
                else:
                    index += 1
            if count < 2:
                continue
            weight = size * count
            if weight > best_weight:
                best = (sequence, count)
                best_weight = weight
    return best


def is_meaningful_workflow(workflow: WorkflowDefinition) -> bool:
    if workflow.signature.startswith("manual:"):
        return True
    steps = workflow.steps or []
    identities = {
        (str(step.get("application", "")).strip().lower(), str(step.get("action", "")).strip().lower())
        for step in steps
    }
    ignored_actions = {"active", "focus", "blur", "visible", "hidden"}
    ignored_apps = {"2bme", "electron"}
    return (
        len(steps) >= 3
        and len(identities) >= 2
        and any(action not in ignored_actions for _, action in identities)
        and any(application not in ignored_apps for application, _ in identities)
        and workflow.repeat_count >= 2
    )


def _workflow_confidence(sequence: tuple[str, ...], occurrence_count: int, predictability: float) -> float:
    sample_strength = min(1.0, occurrence_count / 5.0)
    diversity = min(1.0, (len(set(sequence)) - 1) / 2.0)
    return round(min(0.95, 0.45 * predictability + 0.35 * sample_strength + 0.20 * diversity), 4)


def _graph(sequence: tuple[str, ...]) -> dict:
    node_counts = Counter(sequence)
    edge_counts = Counter(zip(sequence, sequence[1:]))
    outgoing: dict[str, int] = defaultdict(int)
    for (source, _), count in edge_counts.items():
        outgoing[source] += count
    return {
        "nodes": [{"id": token, "count": count} for token, count in node_counts.items()],
        "edges": [
            {
                "from": source,
                "to": target,
                "transition_count": count,
                "probability": round(count / outgoing[source], 4),
            }
            for (source, target), count in edge_counts.items()
        ],
    }


def _display_step(token: str) -> dict[str, str]:
    app_part, action_part = token.split("|", 1)
    return {
        "application": app_part.removeprefix("APP:").replace("_", " ").title(),
        "action": action_part.removeprefix("ACTION:").replace("_", " ").lower(),
    }


def detect_workflow(
    db: Session,
    behavior_session: BehaviorSession,
    features: dict,
    score: dict,
    model_config: ModelConfig,
) -> WorkflowDefinition | None:
    tokens = list(features.get("workflow_tokens", []))
    found = _candidate(tokens)
    if not found:
        return None
    sequence, occurrence_count = found
    signature = hashlib.sha256("→".join(sequence).encode("utf-8")).hexdigest()[:24]
    workflow = db.scalar(
        select(WorkflowDefinition).where(WorkflowDefinition.signature == signature)
    )
    steps = [_display_step(token) for token in sequence]
    apps = list(dict.fromkeys(step["application"] for step in steps))
    predictability = float(features.get("predictable_sequence_score", 0.0))
    confidence = _workflow_confidence(sequence, occurrence_count, predictability)

    if not workflow:
        name = " → ".join(apps[:3]) if apps else "Repeated workflow"
        workflow = WorkflowDefinition(
            signature=signature,
            name=f"{name} workflow",
            workflow_type=behavior_session.workflow_type,
            steps=steps,
            graph=_graph(sequence),
            repeat_count=occurrence_count,
            average_duration_s=float(features.get("duration_s", 0.0)) / occurrence_count,
            predictability=predictability,
            automation_potential=float(score["automation_potential"]),
            confidence=confidence,
            data_origin=behavior_session.data_origin,
            model_version=model_config.version,
        )
        db.add(workflow)
        db.flush()
        record_audit(
            db,
            "workflow_detected",
            session_id=behavior_session.id,
            workflow_id=workflow.id,
            payload={"signature": signature, "repeat_count": occurrence_count},
        )

    instance = db.scalar(
        select(WorkflowInstance).where(
            WorkflowInstance.workflow_id == workflow.id,
            WorkflowInstance.session_id == behavior_session.id,
        )
    )
    if not instance:
        db.add(
            WorkflowInstance(
                workflow_id=workflow.id,
                session_id=behavior_session.id,
                sequence=list(sequence),
                occurrence_count=occurrence_count,
                duration_s=float(features.get("duration_s", 0.0)),
                data_origin=behavior_session.data_origin,
            )
        )
    elif occurrence_count > instance.occurrence_count:
        workflow.repeat_count += occurrence_count - instance.occurrence_count
        instance.occurrence_count = occurrence_count
        instance.duration_s = float(features.get("duration_s", 0.0))

    workflow.predictability = predictability
    workflow.automation_potential = float(score["automation_potential"])
    workflow.confidence = confidence
    return workflow
