from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SanitizedBehaviorContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow: dict[str, str | int | float]
    behavior: dict[str, float]
    evidence: dict[str, float | int]


class ContextSanitizer:
    """Converts internal records into content-free behavioral evidence."""

    allowed_evidence = {
        "app_switches_per_min",
        "backtrack_rate",
        "repeated_action_ratio",
        "workflow_repeat_count",
        "predictable_sequence_score",
        "observed_task_count",
    }

    def sanitize(self, workflow: dict | None, score: dict) -> SanitizedBehaviorContext:
        safe_workflow = {
            "name": (workflow or {}).get("name", "Observed workflow"),
            "repeat_count": int((workflow or {}).get("repeat_count", 0)),
            "average_duration_s": float((workflow or {}).get("average_duration_s", 0.0)),
        }
        evidence = score.get("evidence", {})
        safe_evidence = {
            key: value
            for key, value in evidence.items()
            if key in self.allowed_evidence and isinstance(value, (int, float))
        }
        return SanitizedBehaviorContext(
            workflow=safe_workflow,
            behavior={
                "friction": float(score.get("friction", 0.0)),
                "focus": float(score.get("focus", 0.0)),
                "automation_potential": float(score.get("automation_potential", 0.0)),
                "confidence": float(score.get("confidence", 0.0)),
            },
            evidence=safe_evidence,
        )

