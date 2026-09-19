from __future__ import annotations

from dataclasses import dataclass, field

from backend.app.config.settings import ModelConfig, settings
from backend.app.scoring.engine import ScoringEngine


@dataclass
class RuntimeState:
    status: str = "STARTING"
    model_config: ModelConfig = field(default_factory=lambda: ModelConfig.load(settings.model_path))
    seeded_sessions: int = 0

    def __post_init__(self) -> None:
        self.scoring = ScoringEngine(self.model_config)


runtime = RuntimeState()

