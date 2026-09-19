from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Settings:
    project_root: Path = PROJECT_ROOT
    host: str = os.getenv("BEHAVIOR_HOST", "127.0.0.1")
    port: int = int(os.getenv("BEHAVIOR_PORT", "8765"))
    data_mode: str = os.getenv("BEHAVIOR_DATA_MODE", "synthetic")
    model_path: Path = Path(
        os.getenv(
            "BEHAVIOR_MODEL_PATH",
            str(PROJECT_ROOT / "config" / "behavior_model_v0.synthetic.json"),
        )
    )
    synthetic_data_path: Path = Path(
        os.getenv(
            "BEHAVIOR_SYNTHETIC_DATA_PATH",
            str(PROJECT_ROOT / "data" / "synthetic_behavior_sessions.csv"),
        )
    )
    database_path: Path = Path(
        os.getenv(
            "BEHAVIOR_DATABASE_PATH",
            str(PROJECT_ROOT / "backend" / "data" / "behavior.db"),
        )
    )
    event_flush_ms: int = int(os.getenv("BEHAVIOR_EVENT_FLUSH_MS", "750"))

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path}"


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    data_origin: str
    description: str
    normalization: dict[str, dict[str, float]]
    weights: dict[str, dict[str, float]]
    thresholds: dict[str, float | int]
    personal_baseline_blend: list[dict[str, Any]]

    @classmethod
    def load(cls, path: Path) -> "ModelConfig":
        return cls.model_validate(json.loads(path.read_text(encoding="utf-8")))


settings = Settings()

