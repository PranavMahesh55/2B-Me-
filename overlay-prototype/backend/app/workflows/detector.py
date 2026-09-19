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
        counts = Counter(tuple(tokens[index : index + size]) for index in range(len(tokens) - size + 1))
        for sequence, count in counts.items():
            if count < 2:
                continue
            weight = size * count
            if weight > best_weight:
                best = (sequence, count)
                best_weight = weight
    return best


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
    tokens = list(features.get("tokens", []))
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
            confidence=float(score["confidence"]),
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
    workflow.confidence = float(score["confidence"])
    return workflow

