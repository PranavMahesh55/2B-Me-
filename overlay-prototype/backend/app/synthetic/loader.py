from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.config.settings import ModelConfig
from backend.app.db.models import ModelConfigRecord, SyntheticBaseline


NUMERIC_FIELDS = (
    "duration_s",
    "app_switches_per_min",
    "backtrack_rate",
    "repeated_action_ratio",
    "correction_rate",
    "hesitation_ms_p50",
    "idle_ratio",
    "navigation_efficiency",
    "action_sequence_entropy",
    "workflow_repeat_count",
    "predictable_sequence_score",
    "friction_score",
    "focus_score",
    "automation_potential",
    "model_confidence",
)


def load_synthetic_baselines(path: Path) -> dict[str, dict]:
    aggregates: dict[str, dict] = defaultdict(lambda: {"count": 0, "sums": defaultdict(float)})
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row.get("data_origin") != "synthetic_bootstrap":
                raise ValueError("Synthetic bootstrap rows must preserve data_origin=synthetic_bootstrap")
            bucket = aggregates[row["workflow_type"]]
            bucket["count"] += 1
            for field in NUMERIC_FIELDS:
                bucket["sums"][field] += float(row[field])
    return {
        workflow_type: {
            "session_count": values["count"],
            "averages": {
                field: round(values["sums"][field] / values["count"], 6)
                for field in NUMERIC_FIELDS
            },
        }
        for workflow_type, values in aggregates.items()
    }


def seed_bootstrap_data(db: Session, path: Path, model_config: ModelConfig) -> int:
    existing_config = db.scalar(
        select(ModelConfigRecord).where(ModelConfigRecord.version == model_config.version)
    )
    if not existing_config:
        db.add(
            ModelConfigRecord(
                version=model_config.version,
                data_origin=model_config.data_origin,
                config=model_config.model_dump(mode="json"),
                active=True,
            )
        )

    baselines = load_synthetic_baselines(path)
    for workflow_type, values in baselines.items():
        baseline = db.get(SyntheticBaseline, workflow_type)
        if baseline:
            baseline.session_count = values["session_count"]
            baseline.averages = values["averages"]
            baseline.model_version = model_config.version
        else:
            db.add(
                SyntheticBaseline(
                    workflow_type=workflow_type,
                    session_count=values["session_count"],
                    averages=values["averages"],
                    model_version=model_config.version,
                )
            )
    db.commit()
    return sum(item["session_count"] for item in baselines.values())

