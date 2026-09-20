from __future__ import annotations

from dataclasses import dataclass

from backend.app.config.settings import ModelConfig


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class ScoreResult:
    friction: float
    focus: float
    automation_potential: float
    confidence: float
    behavior_label: str
    evidence: dict[str, float | int | str | bool]

    def as_dict(self) -> dict:
        return {
            "friction": self.friction,
            "focus": self.focus,
            "automation_potential": self.automation_potential,
            "confidence": self.confidence,
            "behavior_label": self.behavior_label,
            "evidence": self.evidence,
        }


class ScoringEngine:
    def __init__(self, config: ModelConfig):
        self.config = config

    def normalize(self, name: str, value: float) -> float:
        bounds = self.config.normalization[name]
        span = bounds["max"] - bounds["min"]
        return clamp((value - bounds["min"]) / span) if span else 0.0

    def score(self, features: dict) -> ScoreResult:
        normalized = {
            name: self.normalize(name, float(features.get(name, 0.0)))
            for name in self.config.normalization
            if name in features
        }
        app_switching = normalized.get("app_switches_per_min", 0.0)
        backtracking = normalized.get("backtrack_rate", 0.0)
        corrections = normalized.get("correction_rate", 0.0)
        hesitation = normalized.get("hesitation_ms_p50", 0.0)
        idle = normalized.get("idle_ratio", 0.0)
        navigation = normalized.get("navigation_efficiency", 1.0)
        sequence_entropy = normalized.get("action_sequence_entropy", 0.0)
        duration = normalized.get("duration_over_baseline", 0.0)
        repetitions = normalized.get("repeated_action_ratio", 0.0)
        repeat_count = normalized.get("workflow_repeat_count", 0.0)
        predictability = normalized.get("predictable_sequence_score", 0.0)
        time_spent = self.normalize("time_spent_s", float(features.get("duration_s", 0.0)))
        sustained = clamp(float(features.get("sustained_active_ratio", 1.0)))
        keystroke_momentum = normalized.get("keystrokes_per_min", 0.0)

        fw = self.config.weights["friction"]
        friction = (
            fw["backtrack_rate"] * backtracking
            + fw["correction_rate"] * corrections
            + fw["navigation_inefficiency"] * (1 - navigation)
            + fw["app_switching"] * app_switching
            + fw["hesitation"] * hesitation
            + fw["idle_fragmentation"] * idle
            + fw["duration_over_baseline"] * duration
            + fw["sequence_entropy"] * sequence_entropy
        )

        fow = self.config.weights["focus"]
        focus = (
            fow["inverse_app_switching"] * (1 - app_switching)
            + fow["inverse_idle_fragmentation"] * (1 - idle)
            + fow["navigation_efficiency"] * navigation
            + fow["inverse_sequence_entropy"] * (1 - sequence_entropy)
            + fow["inverse_backtracking"] * (1 - backtracking)
            + fow["sustained_active_ratio"] * sustained
            # Typing volume is momentum: a session where the user is actually
            # producing reads differently from one that is merely not switching.
            + fow["keystroke_momentum"] * keystroke_momentum
        )

        aw = self.config.weights["automation"]
        automation = (
            aw["repeated_action_ratio"] * repetitions
            + aw["predictable_sequence_score"] * predictability
            + aw["normalized_workflow_repeat_count"] * repeat_count
            + aw["normalized_time_spent"] * time_spent
            + aw["app_switching"] * app_switching
            + aw["correction_rate"] * corrections
            + aw["inverse_sequence_entropy"] * (1 - sequence_entropy)
        )

        cw = self.config.weights["confidence"]
        confidence = (
            cw["base"]
            + cw["predictable_sequence_score"] * predictability
            + cw["normalized_repeat_count"] * repeat_count
            + cw["inverse_sequence_entropy"] * (1 - sequence_entropy)
        )

        friction = round(clamp(friction), 4)
        focus = round(clamp(focus), 4)
        automation = round(clamp(automation), 4)
        confidence = round(clamp(confidence, high=0.99), 4)
        thresholds = self.config.thresholds
        raw_repeat_count = int(features.get("workflow_repeat_count", 0))

        if (
            automation >= float(thresholds["automation_potential"])
            and raw_repeat_count >= int(thresholds["automation_repeat_count"])
        ):
            label = "automation_candidate"
        elif friction >= float(thresholds["friction_high"]):
            label = "high_friction"
        elif friction >= float(thresholds["friction_moderate"]):
            label = "moderate_friction"
        else:
            label = "focused_or_low_friction"

        return ScoreResult(
            friction=friction,
            focus=focus,
            automation_potential=automation,
            confidence=confidence,
            behavior_label=label,
            evidence={
                "app_switches_per_min": float(features.get("app_switches_per_min", 0.0)),
                "backtrack_rate": float(features.get("backtrack_rate", 0.0)),
                "repeated_action_ratio": float(features.get("repeated_action_ratio", 0.0)),
                "workflow_repeat_count": raw_repeat_count,
                "keystrokes_per_min": round(float(features.get("keystrokes_per_min", 0.0)), 2),
                "predictable_sequence_score": float(features.get("predictable_sequence_score", 0.0)),
                "model_version": self.config.version,
            },
        )

