from __future__ import annotations

from pydantic import BaseModel, Field

from backend.app.llm.privacy import SanitizedBehaviorContext


class RecommendationExplanation(BaseModel):
    title: str = Field(max_length=120)
    observation: str = Field(max_length=320)
    reason: str = Field(max_length=320)
    recommendation: str = Field(max_length=320)
    confidence: float = Field(ge=0, le=0.99)


class LocalFallbackAdapter:
    """Deterministic explanation used when no optional LLM provider is configured."""

    def explain(self, context: SanitizedBehaviorContext) -> RecommendationExplanation:
        workflow = context.workflow
        repeat_count = int(workflow.get("repeat_count", 0))
        return RecommendationExplanation(
            title=f"Repeated {str(workflow.get('name', 'workflow')).lower()}",
            observation=f"The same privacy-safe sequence appeared {repeat_count} times.",
            reason="The configured repetition, predictability, and confidence gates were met.",
            recommendation="Prepare the repeated steps as a reviewable assisted workflow.",
            confidence=context.behavior["confidence"],
        )

