from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field

from backend.app.llm.privacy import SanitizedBehaviorContext


class RecommendationExplanation(BaseModel):
    title: str = Field(max_length=120)
    observation: str = Field(max_length=320)
    reason: str = Field(max_length=320)
    recommendation: str = Field(max_length=320)
    confidence: float = Field(ge=0, le=0.99)


class BehaviorExplainer(Protocol):
    """The only shape an explanation provider may take.

    It receives a SanitizedBehaviorContext and nothing else, which is what makes
    the boundary meaningful: a provider cannot reach raw events, window titles or
    application names even if it wanted to.
    """

    def explain(self, context: SanitizedBehaviorContext, kind: str = "automation") -> RecommendationExplanation: ...


class LocalFallbackAdapter:
    """Deterministic explanation used when no optional LLM provider is configured."""

    def explain(
        self, context: SanitizedBehaviorContext, kind: str = "automation"
    ) -> RecommendationExplanation:
        workflow = context.workflow
        repeat_count = int(workflow.get("repeat_count", 0))
        evidence = context.evidence
        confidence = context.behavior["confidence"]

        if kind == "workflow_consolidation":
            switches = float(evidence.get("app_switches_per_min", 0.0))
            return RecommendationExplanation(
                title="Reduce cross-application switching",
                observation=f"This task moved between applications {switches:.1f} times per minute.",
                reason="Frequent switches and elevated friction occurred in the same task window.",
                recommendation="Keep the reference context beside the working application.",
                confidence=confidence,
            )

        if kind == "friction_reduction":
            backtrack = float(evidence.get("backtrack_rate", 0.0))
            return RecommendationExplanation(
                title="Reduce repeated backtracking",
                observation=f"Contexts were reopened at a rate of {backtrack:.2f} during this task.",
                reason="Backtracking crossed the configured behavioral threshold.",
                recommendation="Pin the two most-used contexts before continuing.",
                confidence=confidence,
            )

        return RecommendationExplanation(
            title=f"Assist with {str(workflow.get('name', 'workflow')).lower()}",
            observation=f"The same privacy-safe sequence appeared {repeat_count} times.",
            reason="The configured repetition, predictability, and confidence gates were met.",
            recommendation="Prepare the repeated steps as a reviewable assisted workflow.",
            confidence=confidence,
        )


def get_explainer() -> BehaviorExplainer:
    """The single place a provider is chosen.

    No external provider ships in this build, so this always returns the local
    fallback. The seam exists so one can be added without widening what leaves
    the machine -- whatever is returned here still only ever sees a
    SanitizedBehaviorContext.
    """
    return LocalFallbackAdapter()

